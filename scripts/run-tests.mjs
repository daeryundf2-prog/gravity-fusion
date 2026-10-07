#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const testDir = path.join(repoRoot, 'test');

function enumerateTestFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...enumerateTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
      results.push(relPath);
    }
  }
  return results;
}

const allTestFiles = enumerateTestFiles(testDir).sort();
const filterArgs = process.argv.slice(2);

let selectedFiles = allTestFiles;
if (filterArgs.length > 0) {
  selectedFiles = allTestFiles.filter((file) => {
    const basename = path.basename(file);
    return filterArgs.some((filter) => basename.includes(filter) || file.includes(filter));
  });
}

if (allTestFiles.length === 0) {
  console.log('No test files found in test/');
  process.exit(0);
}

if (selectedFiles.length === 0) {
  console.error(`No test files matched filters: ${filterArgs.join(', ')}`);
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...selectedFiles], {
  cwd: repoRoot,
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error('Failed to spawn test runner:', err);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
