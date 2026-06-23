import type { BackendDriver, ParsedBackendEvent, TokenUsage } from '../types.js';
import { runCommand } from '../utils.js';

function toDisplayLines(prefix: string, text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `${prefix}${line}`);
}

function getSessionId(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed.session_id === 'string') return parsed.session_id;
  if (typeof parsed.sessionId === 'string') return parsed.sessionId;
  if (
    typeof parsed.message === 'object' &&
    parsed.message !== null &&
    typeof (parsed.message as Record<string, unknown>).session_id === 'string'
  ) {
    return (parsed.message as Record<string, string>).session_id;
  }
  return undefined;
}

export function createClaudeCodeDriver(): BackendDriver {
  return {
    async checkVersion(): Promise<void> {
      const result = await runCommand('claude', ['--version'], { allowFailure: true });
      if (result.code !== 0) {
        throw new Error('Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code');
      }
    },

    buildArgs(input): { command: string; args: string[] } {
      const args = [
        '--print',
        '--output-format', 'stream-json',
        '--max-turns', '200',
        '--verbose',
      ];
      if (input.yolo) {
        args.push('--dangerously-skip-permissions');
      }
      if (input.model) {
        args.push('--model', input.model);
      }
      if (input.sessionId) {
        args.push('--resume', input.sessionId);
      }
      args.push(input.prompt);
      return { command: 'claude', args };
    },

    parseStdoutLine(parsed: Record<string, unknown>): ParsedBackendEvent {
      const result: ParsedBackendEvent = {};
      const sessionId = getSessionId(parsed);
      if (sessionId) {
        result.sessionId = sessionId;
      }

      if (parsed.type === 'result' && typeof parsed.usage === 'object' && parsed.usage !== null) {
        const u = parsed.usage as Record<string, number>;
        result.tokenIncrement = {
          input: u.input_tokens ?? 0,
          cachedInput: u.cache_read_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
        };
      }

      if (parsed.type === 'assistant' && typeof parsed.message === 'object' && parsed.message !== null) {
        const msg = parsed.message as Record<string, unknown>;
        if (Array.isArray(msg.content)) {
          const lines: string[] = [];
          for (const block of msg.content) {
            if (
              typeof block === 'object' &&
              block !== null &&
              (block as Record<string, unknown>).type === 'text' &&
              typeof (block as Record<string, unknown>).text === 'string'
            ) {
              const text = (block as Record<string, string>).text;
              result.message = text.length > 200 ? text.slice(0, 200) + '...' : text;
              lines.push(...toDisplayLines('Assistant: ', text));
            }
            if (
              typeof block === 'object' &&
              block !== null &&
              (block as Record<string, unknown>).type === 'tool_use' &&
              typeof (block as Record<string, unknown>).name === 'string'
            ) {
              lines.push(`Tool: ${(block as Record<string, string>).name}`);
            }
          }
          if (lines.length > 0) {
            result.displayLines = lines;
          }
        }
      }

      if (
        parsed.type === 'error' &&
        typeof parsed.message === 'string' &&
        !result.displayLines
      ) {
        result.displayLines = [`Error: ${parsed.message}`];
      }

      return result;
    },
  };
}
