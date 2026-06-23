import type { Backend, BackendDriver } from '../types.js';
import { createClaudeCodeDriver } from './claude-code.js';
import { createCodexDriver } from './codex.js';
import { createOpenCodeDriver } from './opencode.js';

export function getDriver(backend: Backend): BackendDriver {
  switch (backend) {
    case 'claude-code':
      return createClaudeCodeDriver();
    case 'codex':
      return createCodexDriver();
    case 'opencode':
      return createOpenCodeDriver();
  }
}
