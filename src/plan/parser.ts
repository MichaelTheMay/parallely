import fs from 'node:fs';
import path from 'node:path';
import type { PlanSection } from '../types.js';
import { slugify } from '../utils.js';

/**
 * Minimal hand-rolled frontmatter parser.
 * Supports three fields: title (string), files (list), acceptance (list).
 */
function parseFrontmatter(raw: string): {
  title: string;
  files: string[];
  acceptance: string[];
  body: string;
} {
  const title = '';
  const files: string[] = [];
  const acceptance: string[] = [];

  if (!raw.startsWith('---')) {
    return { title, files, acceptance, body: raw };
  }

  const endIdx = raw.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { title, files, acceptance, body: raw };
  }

  const frontmatter = raw.slice(4, endIdx);
  const body = raw.slice(endIdx + 4).trim();

  let currentList: string[] | null = null;
  let parsedTitle = '';

  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim();

    // List item
    if (trimmed.startsWith('- ')) {
      if (currentList) {
        currentList.push(trimmed.slice(2).trim());
      }
      continue;
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();

    currentList = null;

    switch (key) {
      case 'title':
        parsedTitle = value;
        break;
      case 'files':
        currentList = files;
        if (value) files.push(value);
        break;
      case 'acceptance':
        currentList = acceptance;
        if (value) acceptance.push(value);
        break;
    }
  }

  return { title: parsedTitle, files, acceptance, body };
}

export function parsePlanDir(planDir: string): PlanSection[] {
  if (!fs.existsSync(planDir)) {
    throw new Error(`Plan directory not found: ${planDir}`);
  }

  const entries = fs.readdirSync(planDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  if (entries.length === 0) {
    throw new Error(`No .md files found in plan directory: ${planDir}`);
  }

  return entries.map((filename, index) => {
    const content = fs.readFileSync(path.join(planDir, filename), 'utf-8');
    const { title, files, acceptance, body } = parseFrontmatter(content);
    const slug = slugify(filename);

    return {
      filename,
      index,
      title: title || slug,
      files,
      acceptance,
      body,
      slug,
    };
  });
}
