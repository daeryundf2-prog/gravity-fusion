#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  repoRoot,
  parseCliArgs,
  collectUpstreamFiles,
  hashFile,
  getGitCommit,
  getLazyVersion,
} from './lock-upstream.mjs';

export function checkUpstream(options = {}) {
  const defaultUpstream = process.env.GF_UPSTREAM || 'C:/Users/Daeryun/.gemini/antigravity/scratch/native-gravity';
  const defaultLock = path.join(repoRoot, 'UPSTREAM.lock.json');
  const defaultLazy = 'C:/Users/Daeryun/.gemini/config/plugins/lazyantigravity';

  const upstreamDir = path.resolve(options.upstream || defaultUpstream);
  const lockFile = path.resolve(options.lock || defaultLock);
  const lazyDir = options.lazy ? path.resolve(options.lazy) : path.resolve(defaultLazy);

  if (!fs.existsSync(lockFile)) {
    throw new Error(`Lock file not found: ${lockFile}`);
  }

  if (!fs.existsSync(upstreamDir)) {
    throw new Error(`Upstream directory not found: ${upstreamDir}`);
  }

  const lockContent = fs.readFileSync(lockFile, 'utf8');
  const lockData = JSON.parse(lockContent);

  const expectedCommit = lockData.upstream?.commit ?? null;
  const expectedFiles = lockData.upstream?.files ?? {};
  const expectedLazyVersion = lockData.lazyantigravity?.version ?? null;

  const currentCommit = getGitCommit(upstreamDir);
  const currentFilePaths = collectUpstreamFiles(upstreamDir);

  const currentFiles = {};
  for (const relPath of currentFilePaths) {
    const absPath = path.join(upstreamDir, ...relPath.split('/'));
    currentFiles[relPath] = hashFile(absPath);
  }

  const currentLazyVersion = getLazyVersion(lazyDir);

  const changed = [];
  const removed = [];
  const added = [];

  for (const relPath of Object.keys(expectedFiles)) {
    if (!(relPath in currentFiles)) {
      removed.push(relPath);
    } else if (expectedFiles[relPath] !== currentFiles[relPath]) {
      changed.push({
        file: relPath,
        expected: expectedFiles[relPath],
        current: currentFiles[relPath],
      });
    }
  }

  for (const relPath of Object.keys(currentFiles)) {
    if (!(relPath in expectedFiles)) {
      added.push(relPath);
    }
  }

  const commitMismatch = expectedCommit !== currentCommit;
  const lazyMismatch = expectedLazyVersion !== currentLazyVersion;
  const hasDrift = changed.length > 0 || added.length > 0 || removed.length > 0 || commitMismatch;

  return {
    ok: !hasDrift,
    drift: hasDrift,
    upstreamDir,
    lockFile,
    upstream: {
      repo: lockData.upstream?.repo || 'sleegme/native-gravity',
      commit: {
        expected: expectedCommit,
        current: currentCommit,
        match: !commitMismatch,
      },
      files: {
        changed,
        added,
        removed,
        totalTracked: currentFilePaths.length,
      },
    },
    lazyantigravity: {
      expectedVersion: expectedLazyVersion,
      currentVersion: currentLazyVersion,
      match: !lazyMismatch,
      warning: lazyMismatch
        ? `Version mismatch: expected ${expectedLazyVersion}, current ${currentLazyVersion}`
        : null,
    },
  };
}

function printHumanReport(result) {
  console.log('=== UPSTREAM DRIFT CHECK REPORT ===');
  console.log(`Upstream Directory: ${result.upstreamDir}`);
  console.log(`Lock File:          ${result.lockFile}`);
  console.log();

  console.log('Commit:');
  console.log(`  Lock:    ${result.upstream.commit.expected || '(none)'}`);
  console.log(`  Current: ${result.upstream.commit.current || '(none)'}`);
  console.log(`  Status:  ${result.upstream.commit.match ? 'MATCH' : 'MISMATCH'}`);
  console.log();

  console.log('Files:');
  console.log(`  Changed (${result.upstream.files.changed.length}):`);
  for (const c of result.upstream.files.changed) {
    console.log(`    - ${c.file} (expected ${c.expected}, got ${c.current})`);
  }
  console.log(`  Added (${result.upstream.files.added.length}):`);
  for (const a of result.upstream.files.added) {
    console.log(`    - ${a}`);
  }
  console.log(`  Removed (${result.upstream.files.removed.length}):`);
  for (const r of result.upstream.files.removed) {
    console.log(`    - ${r}`);
  }
  console.log();

  console.log('LazyAntigravity:');
  console.log(`  Lock:    ${result.lazyantigravity.expectedVersion || '(none)'}`);
  console.log(`  Current: ${result.lazyantigravity.currentVersion || '(none)'}`);
  if (!result.lazyantigravity.match) {
    console.log(`  Status:  WARNING: ${result.lazyantigravity.warning}`);
  } else {
    console.log('  Status:  MATCH');
  }
  console.log();

  if (result.drift) {
    console.log('Verdict: DRIFT DETECTED (exit 1)');
  } else {
    console.log('Verdict: PASS (clean, exit 0)');
  }
}

function printJsonReport(result) {
  const jsonReport = {
    ok: result.ok,
    drift: result.drift,
    upstream: {
      repo: result.upstream.repo,
      commit: result.upstream.commit,
      files: {
        changed: result.upstream.files.changed.map((c) => c.file),
        added: result.upstream.files.added,
        removed: result.upstream.files.removed,
        totalTracked: result.upstream.files.totalTracked,
        details: {
          changed: result.upstream.files.changed,
        },
      },
    },
    lazyantigravity: result.lazyantigravity,
  };
  console.log(JSON.stringify(jsonReport, null, 2));
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
    const result = checkUpstream(cliArgs);
    if (cliArgs.json) {
      printJsonReport(result);
    } else {
      printHumanReport(result);
    }
    process.exit(result.drift ? 1 : 0);
  } catch (err) {
    if (cliArgs.json) {
      console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
    } else {
      console.error(`Error checking upstream: ${err.message}`);
    }
    process.exit(1);
  }
}
