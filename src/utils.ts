import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { TokenUsage } from './types.js';

export const EMPTY_USAGE: TokenUsage = { input: 0, cachedInput: 0, output: 0 };

/**
 * Windows: `spawn` cannot exec the `.cmd`/`.ps1` shims that npm installs for
 * global CLIs (there is no real `<cmd>.exe` on PATH). Using `shell: true`
 * "works" but concatenates args without escaping (Node DEP0190), so a prompt
 * containing `& | > "` breaks command parsing.
 *
 * npm shims for node CLIs ultimately run `node <pkg>/bin/<x>.js`. We resolve the
 * `.cmd` shim, extract that JS entry, and return `{ command: node, args:[js,...] }`
 * so the real spawn can run with `shell:false` and let Node escape argv natively.
 * Non-Windows, already-resolved paths, and non-node shims pass through unchanged.
 */
export function resolveSpawn(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args };
  // Already an explicit path or has an extension — leave it.
  if (command.includes('/') || command.includes('\\') || path.extname(command)) {
    return { command, args };
  }
  const pathExt = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';');
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    // Prefer a real executable if one exists — spawn it directly.
    for (const ext of pathExt) {
      const exe = path.join(dir, command + ext);
      if (/\.(exe|com)$/i.test(ext) && pathExists(exe)) {
        return { command: exe, args };
      }
    }
    // Otherwise look for a .cmd shim and rewrite to node + its JS entry.
    const cmd = path.join(dir, command + '.cmd');
    if (pathExists(cmd)) {
      try {
        const body = fs.readFileSync(cmd, 'utf8');
        const m = body.match(/"%dp0%\\([^"]+\.js)"/i) ?? body.match(/([^\s"]+\.js)/i);
        if (m) {
          const js = path.isAbsolute(m[1]) ? m[1] : path.join(dir, m[1]);
          if (pathExists(js)) return { command: process.execPath, args: [js, ...args] };
        }
      } catch {
        // fall through
      }
      return { command: cmd, args }; // last resort; caller adds shell:true
    }
  }
  return { command, args };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function pathExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  opts?: { cwd?: string; allowFailure?: boolean },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const r = resolveSpawn(command, args);
    const child = spawn(r.command, r.args, {
      cwd: opts?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Only need a shell if resolveSpawn left an unresolved .cmd shim.
      shell: r.command.toLowerCase().endsWith('.cmd'),
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (opts?.allowFailure) {
        resolve({ code: 1, stdout, stderr: stderr || err.message });
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !opts?.allowFailure) {
        reject(new Error(`${command} ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim()}`));
      } else {
        resolve({ code: exitCode, stdout, stderr });
      }
    });
  });
}

export function slugify(filename: string): string {
  return filename
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function generateRunId(): string {
  const date = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 10);
  return `${date}-${rand}`;
}

export function elapsed(startIso: string): string {
  const ms = Date.now() - new Date(startIso).getTime();
  const totalSecs = Math.floor(ms / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    output: a.output + b.output,
  };
}
