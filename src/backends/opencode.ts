import type { BackendDriver, ParsedBackendEvent, TokenUsage } from '../types.js';
import { runCommand } from '../utils.js';

function toDisplayLines(prefix: string, text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `${prefix}${line}`);
}

export function createOpenCodeDriver(): BackendDriver {
  return {
    async checkVersion(): Promise<void> {
      const result = await runCommand('opencode', ['--version'], { allowFailure: true });
      if (result.code !== 0) {
        throw new Error('OpenCode CLI not found. See: https://github.com/opencode-ai/opencode');
      }
    },

    buildArgs(input): { command: string; args: string[] } {
      const args = ['run', '--format', 'json'];
      if (input.model) {
        args.push('--model', input.model);
      }
      if (input.sessionId) {
        args.push('--session', input.sessionId);
      }
      args.push(input.prompt);
      return { command: 'opencode', args };
    },

    parseStdoutLine(parsed: Record<string, unknown>): ParsedBackendEvent {
      const result: ParsedBackendEvent = {};

      if (typeof parsed.sessionID === 'string') {
        result.sessionId = parsed.sessionID;
      }

      if (typeof parsed.tokens === 'object' && parsed.tokens !== null) {
        const t = parsed.tokens as Record<string, number>;
        result.tokenIncrement = {
          input: t.input ?? 0,
          cachedInput: t.cached ?? 0,
          output: t.output ?? 0,
        };
      }

      if (
        typeof parsed.part === 'object' &&
        parsed.part !== null &&
        typeof (parsed.part as Record<string, unknown>).sessionID === 'string'
      ) {
        result.sessionId = (parsed.part as Record<string, string>).sessionID;
      }

      if (
        parsed.type === 'step_finish' &&
        typeof parsed.part === 'object' &&
        parsed.part !== null &&
        typeof (parsed.part as Record<string, unknown>).tokens === 'object' &&
        (parsed.part as Record<string, unknown>).tokens !== null
      ) {
        const part = parsed.part as Record<string, unknown>;
        const tokens = part.tokens as Record<string, unknown>;
        const cache = (tokens.cache && typeof tokens.cache === 'object')
          ? (tokens.cache as Record<string, unknown>)
          : undefined;
        result.tokenIncrement = {
          input: typeof tokens.input === 'number' ? tokens.input : 0,
          cachedInput: cache && typeof cache.read === 'number' ? cache.read : 0,
          output: typeof tokens.output === 'number' ? tokens.output : 0,
        };
      }

      if (
        (parsed.type === 'text' || parsed.type === 'message') &&
        typeof parsed.part === 'object' &&
        parsed.part !== null &&
        typeof (parsed.part as Record<string, unknown>).text === 'string'
      ) {
        const text = (parsed.part as Record<string, string>).text;
        result.message = text.length > 200 ? text.slice(0, 200) + '...' : text;
        result.displayLines = toDisplayLines('Assistant: ', text);
      } else if (typeof parsed.message === 'string') {
        const text = parsed.message;
        result.message = text.length > 200 ? text.slice(0, 200) + '...' : text;
        result.displayLines = toDisplayLines('Assistant: ', text);
      }

      return result;
    },
  };
}
