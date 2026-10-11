#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const repoRoot = path.resolve(__dirname, '..');

export function parseCliArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        options[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
          options[key] = argv[++i];
        } else {
          options[key] = true;
        }
      }
    }
  }
  return options;
}

export function collectUpstreamFiles(upstreamDir) {
  const relPaths = [];

  function scanDir(subDir, filterFn) {
    const dirPath = path.join(upstreamDir, subDir);
    if (!fs.existsSync(dirPath)) return;
    try {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) return;
    } catch {
      return;
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && filterFn(entry.name)) {
        relPaths.push(`${subDir}/${entry.name}`);
      }
    }
  }

  function checkFile(relPath) {
    const filePath = path.join(upstreamDir, relPath);
    if (fs.existsSync(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          relPaths.push(relPath);
        }
      } catch {
        // ignore
      }
    }
  }

  scanDir('agents', (name) => name.endsWith('.md'));
  scanDir('rules', (name) => name.endsWith('.md'));
  scanDir('skills', (name) => name.endsWith('.md'));
  scanDir('hooks', (name) => name.endsWith('.py'));
  checkFile('hooks.json');
  scanDir('tests', (name) => name.startsWith('test_') && name.endsWith('.py'));
  checkFile('VERSION');
  checkFile('package.json');

  return relPaths.sort();
}

export function hashFile(absPath) {
  const buf = fs.readFileSync(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function getGitCommit(upstreamDir) {
  try {
    const commit = execFileSync('git', ['-C', upstreamDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return commit || null;
  } catch {
    return null;
  }
}

export function getLazyVersion(lazyDir) {
  if (!lazyDir) return null;
  const pluginJsonPath = path.join(lazyDir, 'plugin.json');
  try {
    if (fs.existsSync(pluginJsonPath)) {
      const content = fs.readFileSync(pluginJsonPath, 'utf8');
      const data = JSON.parse(content);
      return data.version || null;
    }
  } catch {
    return null;
  }
  return null;
}

export function generateLockData({ upstreamDir, lazyDir }) {
  const commit = getGitCommit(upstreamDir);
  const filePaths = collectUpstreamFiles(upstreamDir);

  const files = {};
  for (const relPath of filePaths) {
    const absPath = path.join(upstreamDir, ...relPath.split('/'));
    files[relPath] = hashFile(absPath);
  }

  const sortedFiles = {};
  for (const k of Object.keys(files).sort()) {
    sortedFiles[k] = files[k];
  }

  const lazyVersion = getLazyVersion(lazyDir);

  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    upstream: {
      repo: 'sleegme/native-gravity',
      commit,
      files: sortedFiles,
    },
    lazyantigravity: {
      version: lazyVersion,
    },
  };
}

export function lockUpstream(options = {}) {
  const defaultUpstream = process.env.GF_UPSTREAM || path.resolve(repoRoot, '../native-gravity');
  const defaultLock = path.join(repoRoot, 'UPSTREAM.lock.json');
  const defaultLazy = process.env.GF_LAZY || path.resolve(repoRoot, '../LAZYANTIGRAVITY');

  const upstreamDir = path.resolve(options.upstream || defaultUpstream);
  const lockFile = path.resolve(options.lock || defaultLock);
  const lazyDir = options.lazy ? path.resolve(options.lazy) : path.resolve(defaultLazy);

  if (!fs.existsSync(upstreamDir)) {
    throw new Error(`Upstream directory not found: ${upstreamDir}`);
  }

  const lockData = generateLockData({ upstreamDir, lazyDir });
  fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2) + '\n', 'utf8');
  return { lockFile, lockData };
}

function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    const entryPath = path.resolve(process.argv[1]);
    const modulePath = path.resolve(fileURLToPath(importMetaUrl));
    return entryPath.toLowerCase() === modulePath.toLowerCase();
  } catch {
    return false;
  }
}

if (isMain(import.meta.url)) {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  try {
    const { lockFile, lockData } = lockUpstream(cliArgs);
    console.log(`Locked upstream to ${lockFile}`);
    console.log(`Commit: ${lockData.upstream.commit}`);
    console.log(`Tracked files: ${Object.keys(lockData.upstream.files).length}`);
    console.log(`LazyAntigravity version: ${lockData.lazyantigravity.version}`);
  } catch (err) {
    console.error(`Error locking upstream: ${err.message}`);
    process.exit(1);
  }
}
