#!/usr/bin/env bun

// react-reconciler requires NODE_ENV=production for React 19 compat
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const packageDir = path.resolve(path.dirname(filePath), '..');
const distEntry = path.join(packageDir, 'dist', 'index.js');
const srcEntry = path.join(packageDir, 'src', 'index.tsx');

let entry = '';
if (fs.existsSync(distEntry)) {
  entry = distEntry;
} else if (fs.existsSync(srcEntry)) {
  process.stderr.write(
    `[aeon] Built bundle missing (${distEntry}). Running from source.\n` +
      `[aeon] To build once: (cd ${packageDir} && bun run build)\n`,
  );
  entry = srcEntry;
} else {
  process.stderr.write(
    '[aeon] Could not find a runnable entrypoint.\n' +
      `[aeon] Expected one of:\n` +
      `  - ${distEntry}\n` +
      `  - ${srcEntry}\n`,
  );
  process.exit(1);
}

await import(pathToFileURL(entry).href);
