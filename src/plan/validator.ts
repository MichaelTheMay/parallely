import type { PlanSection, ValidationResult, ValidationWarning } from '../types.js';

export function validatePlan(sections: PlanSection[]): ValidationResult {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  if (sections.length === 0) {
    errors.push('Plan has no sections');
    return { valid: false, sections, errors, warnings };
  }

  for (const section of sections) {
    // Must have a body
    if (!section.body.trim()) {
      errors.push(`${section.filename}: empty body (no agent instructions)`);
    }

    // Title should be present
    if (!section.title || section.title === section.slug) {
      warnings.push({
        file: section.filename,
        message: 'no title in frontmatter — using filename as title',
      });
    }

    // Files list is recommended
    if (section.files.length === 0) {
      warnings.push({
        file: section.filename,
        message: 'no files listed — overlap detection disabled for this section',
      });
    }

    // Acceptance criteria recommended
    if (section.acceptance.length === 0) {
      warnings.push({
        file: section.filename,
        message: 'no acceptance criteria listed',
      });
    }
  }

  // Check for file overlaps between sections
  const fileToSections = new Map<string, string[]>();
  for (const section of sections) {
    for (const pattern of section.files) {
      // For exact file paths (non-glob), check overlaps
      if (!pattern.includes('*')) {
        const existing = fileToSections.get(pattern) ?? [];
        existing.push(section.title);
        fileToSections.set(pattern, existing);
      }
    }
  }

  for (const [file, owners] of fileToSections) {
    if (owners.length > 1) {
      warnings.push({
        file,
        message: `file claimed by multiple sections: ${owners.join(', ')} — may cause merge conflicts`,
      });
    }
  }

  // Check for glob overlaps (heuristic: same directory prefix)
  const dirPrefixes = new Map<string, string[]>();
  for (const section of sections) {
    for (const pattern of section.files) {
      if (pattern.includes('*')) {
        const prefix = pattern.split('*')[0]!;
        const existing = dirPrefixes.get(prefix) ?? [];
        existing.push(section.title);
        dirPrefixes.set(prefix, existing);
      }
    }
  }

  for (const [prefix, owners] of dirPrefixes) {
    if (owners.length > 1) {
      warnings.push({
        file: `${prefix}*`,
        message: `glob pattern overlaps between sections: ${owners.join(', ')} — may cause merge conflicts`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    sections,
    errors,
    warnings,
  };
}
