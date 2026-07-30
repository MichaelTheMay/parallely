import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePlanDir } from '../src/plan/parser';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallely-parser-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePlan(filename: string, contents: string): void {
  fs.writeFileSync(path.join(tmpDir, filename), contents);
}

describe('parsePlanDir', () => {
  it('parses title, files, and acceptance from frontmatter', () => {
    writePlan(
      '01-auth.md',
      `---
title: Auth System
files:
  - src/auth/**
  - src/middleware/auth.ts
acceptance:
  - JWT login works
  - Tests pass
---

# Auth System

Implement JWT auth.`,
    );

    const [section] = parsePlanDir(tmpDir);
    expect(section.title).toBe('Auth System');
    expect(section.files).toEqual(['src/auth/**', 'src/middleware/auth.ts']);
    expect(section.acceptance).toEqual(['JWT login works', 'Tests pass']);
    expect(section.body).toContain('Implement JWT auth.');
    expect(section.slug).toBe('01-auth');
    expect(section.index).toBe(0);
  });

  it('falls back to the slug when no title is present', () => {
    writePlan('db-layer.md', `# No frontmatter here\n\nDo the thing.`);
    const [section] = parsePlanDir(tmpDir);
    expect(section.title).toBe('db-layer');
    expect(section.files).toEqual([]);
    expect(section.acceptance).toEqual([]);
  });

  it('sorts files alphabetically and assigns sequential indices', () => {
    writePlan('02-second.md', `---\ntitle: Second\n---\nBody two`);
    writePlan('01-first.md', `---\ntitle: First\n---\nBody one`);
    writePlan('03-third.md', `---\ntitle: Third\n---\nBody three`);

    const sections = parsePlanDir(tmpDir);
    expect(sections.map((s) => s.title)).toEqual(['First', 'Second', 'Third']);
    expect(sections.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('ignores non-markdown files', () => {
    writePlan('01-real.md', `---\ntitle: Real\n---\nBody`);
    writePlan('notes.txt', 'ignore me');
    writePlan('README', 'ignore me too');

    const sections = parsePlanDir(tmpDir);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Real');
  });

  it('supports an inline value on the same line as a list key', () => {
    writePlan('01-inline.md', `---\ntitle: Inline\nfiles: src/only.ts\n---\nBody`);
    const [section] = parsePlanDir(tmpDir);
    expect(section.files).toEqual(['src/only.ts']);
  });

  it('throws when the plan directory does not exist', () => {
    expect(() => parsePlanDir(path.join(tmpDir, 'nope'))).toThrow(/not found/);
  });

  it('throws when the plan directory has no markdown files', () => {
    writePlan('notes.txt', 'nothing here');
    expect(() => parsePlanDir(tmpDir)).toThrow(/No \.md files/);
  });
});
