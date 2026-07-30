import { describe, expect, it } from 'bun:test';
import type { PlanSection } from '../src/types';
import { validatePlan } from '../src/plan/validator';

function section(overrides: Partial<PlanSection> = {}): PlanSection {
  return {
    filename: '01-section.md',
    index: 0,
    title: 'Section',
    files: ['src/section/**'],
    acceptance: ['It works'],
    body: 'Do the thing.',
    slug: '01-section',
    ...overrides,
  };
}

describe('validatePlan', () => {
  it('accepts a well-formed plan with no errors or warnings', () => {
    const result = validatePlan([section()]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('flags an empty plan as invalid', () => {
    const result = validatePlan([]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Plan has no sections');
  });

  it('errors when a section has an empty body', () => {
    const result = validatePlan([section({ body: '   ' })]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('empty body'))).toBe(true);
  });

  it('warns when the title equals the slug (no real title)', () => {
    const result = validatePlan([section({ title: '01-section' })]);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.message.includes('no title'))).toBe(true);
  });

  it('warns when a section lists no files', () => {
    const result = validatePlan([section({ files: [] })]);
    expect(result.warnings.some((w) => w.message.includes('overlap detection disabled'))).toBe(
      true,
    );
  });

  it('warns when a section lists no acceptance criteria', () => {
    const result = validatePlan([section({ acceptance: [] })]);
    expect(result.warnings.some((w) => w.message.includes('no acceptance criteria'))).toBe(true);
  });

  it('warns when two sections claim the same exact file', () => {
    const result = validatePlan([
      section({ filename: 'a.md', title: 'A', slug: 'a', files: ['src/shared.ts'] }),
      section({ filename: 'b.md', title: 'B', slug: 'b', files: ['src/shared.ts'] }),
    ]);
    const overlap = result.warnings.find((w) => w.file === 'src/shared.ts');
    expect(overlap?.message).toContain('claimed by multiple sections');
    expect(overlap?.message).toContain('A');
    expect(overlap?.message).toContain('B');
  });

  it('warns when two sections share a glob directory prefix', () => {
    const result = validatePlan([
      section({ filename: 'a.md', title: 'A', slug: 'a', files: ['src/api/*'] }),
      section({ filename: 'b.md', title: 'B', slug: 'b', files: ['src/api/*.ts'] }),
    ]);
    const overlap = result.warnings.find((w) => w.message.includes('glob pattern overlaps'));
    expect(overlap).toBeDefined();
    expect(overlap?.file).toBe('src/api/*');
  });

  it('does not warn about overlap when exact files differ', () => {
    const result = validatePlan([
      section({ filename: 'a.md', title: 'A', slug: 'a', files: ['src/a.ts'] }),
      section({ filename: 'b.md', title: 'B', slug: 'b', files: ['src/b.ts'] }),
    ]);
    expect(result.warnings.some((w) => w.message.includes('claimed by multiple'))).toBe(false);
  });
});
