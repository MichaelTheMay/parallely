import { Codex, type ThreadEvent, type ThreadItem } from '@openai/codex-sdk';
import type { AgentExecResult, BackendDriver, BackendDriverCallbacks, BackendDriverInput, ParsedBackendEvent, TokenUsage } from '../types.js';
import { EMPTY_USAGE, runCommand } from '../utils.js';

function toDisplayLines(prefix: string, text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `${prefix}${line}`);
}

function itemToEvent(item: ThreadItem): ParsedBackendEvent {
  const result: ParsedBackendEvent = {};

  if (item.type === 'agent_message') {
    const text = item.text;
    result.message = text.length > 200 ? text.slice(0, 200) + '...' : text;
    result.displayLines = toDisplayLines('Assistant: ', text);
  }

  if (item.type === 'command_execution') {
    const lines: string[] = [`$ ${item.command}`];
    if (item.aggregated_output) {
      for (const l of item.aggregated_output.split('\n')) {
        if (l.trim()) lines.push(l);
      }
    }
    result.displayLines = lines;
  }

  if (item.type === 'file_change') {
    result.displayLines = item.changes.map((c) => `${c.kind}: ${c.path}`);
  }

  if (item.type === 'reasoning') {
    const text = item.text;
    result.displayLines = [`Reasoning: ${text.length > 120 ? text.slice(0, 120) + '...' : text}`];
  }

  if (item.type === 'error') {
    result.displayLines = [`Error: ${item.message}`];
  }

  return result;
}

export function createCodexDriver(): BackendDriver {
  return {
    async checkVersion(): Promise<void> {
      const result = await runCommand('codex', ['--version'], { allowFailure: true });
      if (result.code !== 0) {
        throw new Error('Codex CLI not found. Install: npm install -g @openai/codex');
      }
    },

    buildArgs(input): { command: string; args: string[] } {
      const args: string[] = input.sessionId ? ['exec', 'resume', '--json'] : ['exec', '--json'];
      if (input.yolo) {
        args.push('--full-auto');
      }
      if (input.model) {
        args.push('-m', input.model);
      }
      if (input.sessionId) {
        args.push(input.sessionId);
      }
      args.push(input.prompt);
      return { command: 'codex', args };
    },

    parseStdoutLine(parsed: Record<string, unknown>): ParsedBackendEvent {
      const result: ParsedBackendEvent = {};

      if (parsed.type === 'thread.started' && typeof parsed.thread_id === 'string') {
        result.sessionId = parsed.thread_id;
      }

      if (
        (parsed.type === 'usage' || parsed.type === 'turn.completed') &&
        typeof parsed.usage === 'object' &&
        parsed.usage !== null
      ) {
        const u = parsed.usage as Record<string, number>;
        result.tokenIncrement = {
          input: u.input_tokens ?? 0,
          cachedInput: u.cached_input_tokens ?? u.cached_tokens ?? 0,
          output: u.output_tokens ?? 0,
        };
      }

      if (parsed.type === 'item.completed' && typeof parsed.item === 'object' && parsed.item !== null) {
        const item = parsed.item as Record<string, unknown>;
        if (item.type === 'agent_message' && typeof item.text === 'string') {
          const text = item.text;
          result.message = text.length > 200 ? text.slice(0, 200) + '...' : text;
          result.displayLines = toDisplayLines('Assistant: ', text);
        }
        if (item.type === 'user_message' && typeof item.text === 'string') {
          result.displayLines = toDisplayLines('You: ', item.text);
        }
      }

      if (parsed.type === 'message' && typeof parsed.content === 'string') {
        const text = parsed.content;
        result.message = text.length > 200 ? text.slice(0, 200) + '...' : text;
        result.displayLines = toDisplayLines('Assistant: ', text);
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

    async execute(
      input: BackendDriverInput,
      callbacks: BackendDriverCallbacks,
      signal: AbortSignal,
    ): Promise<AgentExecResult> {
      const startMs = Date.now();

      const codex = new Codex();

      const threadOptions = {
        model: input.model,
        workingDirectory: input.cwd,
        sandboxMode: input.yolo ? 'danger-full-access' as const : 'workspace-write' as const,
        approvalPolicy: input.yolo ? 'never' as const : 'on-request' as const,
      };

      const thread = input.sessionId
        ? codex.resumeThread(input.sessionId, threadOptions)
        : codex.startThread(threadOptions);

      const usage: TokenUsage = { ...EMPTY_USAGE };
      let lastMessage: string | undefined;
      let sessionId: string | undefined = input.sessionId;

      try {
        const { events } = await thread.runStreamed(input.prompt, { signal });

        for await (const event of events) {
          switch (event.type) {
            case 'thread.started':
              sessionId = event.thread_id;
              callbacks.onEvent({ sessionId: event.thread_id });
              break;

            case 'turn.completed': {
              const u = event.usage;
              const increment: TokenUsage = {
                input: u.input_tokens,
                cachedInput: u.cached_input_tokens,
                output: u.output_tokens,
              };
              usage.input += increment.input;
              usage.cachedInput += increment.cachedInput;
              usage.output += increment.output;
              callbacks.onEvent({ tokenIncrement: increment });
              break;
            }

            case 'turn.failed':
              callbacks.onOutput(`Turn failed: ${event.error.message}`, 'stderr');
              break;

            case 'item.started':
            case 'item.updated':
            case 'item.completed': {
              const parsed = itemToEvent(event.item);
              if (parsed.message) {
                lastMessage = parsed.message;
              }
              if (parsed.displayLines?.length) {
                for (const line of parsed.displayLines) {
                  callbacks.onOutput(line, 'stdout');
                }
              }
              if (parsed.message || parsed.displayLines) {
                callbacks.onEvent(parsed);
              }
              break;
            }
          }
        }

        return {
          exitCode: 0,
          usage,
          timedOut: false,
          durationMs: Date.now() - startMs,
          lastMessage,
          sessionId: sessionId ?? thread.id ?? undefined,
          stderr: '',
        };
      } catch (err) {
        const isAbort = signal.aborted;
        const message = err instanceof Error ? err.message : String(err);
        return {
          exitCode: isAbort ? 137 : 1,
          usage,
          timedOut: isAbort,
          timeoutReason: isAbort ? 'overall' : undefined,
          durationMs: Date.now() - startMs,
          lastMessage: message,
          sessionId: sessionId ?? thread.id ?? undefined,
          stderr: message,
        };
      }
    },
  };
}
