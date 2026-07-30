import { describe, expect, it } from 'bun:test';
import {
  EMPTY_USAGE,
  addUsage,
  elapsed,
  formatTokens,
  generateRunId,
  pathExists,
  resolveSpawn,
  slugify,
} from '../src/utils';

describe('slugify', () => {
  it('strips the .md extension', () => {
    expect(slugify('auth-system.md')).toBe('auth-system');
  });

  it('lowercases and replaces non-alphanumerics with single dashes', () => {
    expect(slugify('01 Auth System!.md')).toBe('01-auth-system');
  });

  it('collapses runs of dashes and trims leading/trailing dashes', () => {
    expect(slugify('--Foo__Bar--.md')).toBe('foo-bar');
  });

  it('keeps digits intact', () => {
    expect(slugify('03-database.md')).toBe('03-database');
  });
});

describe('formatTokens', () => {
  it('renders small numbers verbatim', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('renders thousands with a K suffix', () => {
    expect(formatTokens(1_000)).toBe('1.0K');
    expect(formatTokens(12_400)).toBe('12.4K');
  });

  it('renders millions with an M suffix', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });
});

describe('addUsage', () => {
  it('sums each token field independently', () => {
    const a = { input: 10, cachedInput: 5, output: 2 };
    const b = { input: 3, cachedInput: 1, output: 8 };
    expect(addUsage(a, b)).toEqual({ input: 13, cachedInput: 6, output: 10 });
  });

  it('is a no-op when adding EMPTY_USAGE', () => {
    const a = { input: 7, cachedInput: 4, output: 9 };
    expect(addUsage(a, EMPTY_USAGE)).toEqual(a);
  });

  it('does not mutate its arguments', () => {
    const a = { input: 1, cachedInput: 1, output: 1 };
    const b = { input: 2, cachedInput: 2, output: 2 };
    addUsage(a, b);
    expect(a).toEqual({ input: 1, cachedInput: 1, output: 1 });
    expect(b).toEqual({ input: 2, cachedInput: 2, output: 2 });
  });
});

describe('elapsed', () => {
  it('formats a duration as "Xm SSs" with zero-padded seconds', () => {
    const start = new Date(Date.now() - 125_000).toISOString(); // 2m 05s ago
    expect(elapsed(start)).toBe('2m 05s');
  });

  it('reports 0m 00s for a just-started timestamp', () => {
    expect(elapsed(new Date().toISOString())).toBe('0m 00s');
  });
});

describe('generateRunId', () => {
  it('produces an id of the form YYYYMMDD-<8 base36 chars>', () => {
    expect(generateRunId()).toMatch(/^\d{8}-[a-z0-9]{1,8}$/);
  });

  it('produces distinct ids across calls', () => {
    expect(generateRunId()).not.toBe(generateRunId());
  });
});

describe('pathExists', () => {
  it('returns true for a path that exists', () => {
    expect(pathExists(import.meta.dir)).toBe(true);
  });

  it('returns false for a path that does not exist', () => {
    expect(pathExists('/definitely/not/a/real/path/xyzzy')).toBe(false);
  });
});

describe('resolveSpawn', () => {
  it('passes command and args through unchanged on non-Windows platforms', () => {
    if (process.platform === 'win32') return; // behaviour differs on Windows
    const result = resolveSpawn('codex', ['--help']);
    expect(result).toEqual({ command: 'codex', args: ['--help'] });
  });
});
