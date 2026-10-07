import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const lockScriptPath = path.join(repoRoot, 'scripts', 'lock-upstream.mjs');
const checkScriptPath = path.join(repoRoot, 'scripts', 'check-upstream.mjs');

const upstreamSourceDir = process.env.GF_UPSTREAM || 'C:/Users/Daeryun/.gemini/antigravity/scratch/native-gravity';

describe('upstream provenance lock and drift detection', () => {
  let tempDir;
  let tempUpstreamDir;
  let tempLockFile;
  let zenRelPath;
  let zenFile;
  let originalZenBytes;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-test-upstream-'));
    tempUpstreamDir = path.join(tempDir, 'upstream');
    tempLockFile = path.join(tempDir, 'UPSTREAM.lock.json');

    fs.mkdirSync(path.join(tempUpstreamDir, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tempUpstreamDir, 'hooks'), { recursive: true });

    // Copy 4 small files from upstream to temp upstream directory
    const copyPairs = [
      ['VERSION', 'VERSION'],
      ['package.json', 'package.json'],
      ['agents/zen.md', 'agents/zen.md'],
      ['hooks/zen-shell-guard.py', 'hooks/zen-shell-guard.py'],
    ];

    for (const [srcRel, destRel] of copyPairs) {
      const srcAbs = path.join(upstreamSourceDir, srcRel);
      const destAbs = path.join(tempUpstreamDir, destRel);
      if (fs.existsSync(srcAbs)) {
        fs.copyFileSync(srcAbs, destAbs);
      } else {
        // Fallback dummy content if source directory is absent
        fs.writeFileSync(destAbs, `content for ${srcRel}\n`, 'utf8');
      }
    }

    zenRelPath = 'agents/zen.md';
    zenFile = path.join(tempUpstreamDir, zenRelPath);
    originalZenBytes = fs.readFileSync(zenFile);
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('1. lock then check exits 0 when untampered', () => {
    const lockRes = spawnSync(process.execPath, [
      lockScriptPath,
      '--upstream', tempUpstreamDir,
      '--lock', tempLockFile,
    ], { encoding: 'utf8' });

    assert.equal(lockRes.status, 0, `lock-upstream failed: ${lockRes.stderr || lockRes.stdout}`);
    assert.ok(fs.existsSync(tempLockFile), 'lock file should be created');

    const checkRes = spawnSync(process.execPath, [
      checkScriptPath,
      '--upstream', tempUpstreamDir,
      '--lock', tempLockFile,
    ], { encoding: 'utf8' });

    assert.equal(checkRes.status, 0, `check-upstream should exit 0: ${checkRes.stderr || checkRes.stdout}`);
    assert.match(checkRes.stdout, /Verdict:\s*PASS/i);
  });

  test('2. flip one byte causes check to exit 1 and report names the file', () => {
    const modifiedBytes = Buffer.from(originalZenBytes);
    modifiedBytes[0] = modifiedBytes[0] ^ 0x01;
    fs.writeFileSync(zenFile, modifiedBytes);

    const checkRes = spawnSync(process.execPath, [
      checkScriptPath,
      '--upstream', tempUpstreamDir,
      '--lock', tempLockFile,
    ], { encoding: 'utf8' });

    assert.equal(checkRes.status, 1, 'check-upstream should exit 1 on byte modification');
    assert.match(checkRes.stdout, /agents\/zen\.md/, 'report must name the modified file');
    assert.match(checkRes.stdout, /Changed \(1\)/);

    // Restore file for next tests
    fs.writeFileSync(zenFile, originalZenBytes);
  });

  test('3. add a file causes check to exit 1 and report names the added file', () => {
    const newFileRel = 'agents/extra-agent.md';
    const newFileAbs = path.join(tempUpstreamDir, newFileRel);
    fs.writeFileSync(newFileAbs, 'extra agent content\n', 'utf8');

    const checkRes = spawnSync(process.execPath, [
      checkScriptPath,
      '--upstream', tempUpstreamDir,
      '--lock', tempLockFile,
    ], { encoding: 'utf8' });

    assert.equal(checkRes.status, 1, 'check-upstream should exit 1 on added file');
    assert.match(checkRes.stdout, /agents\/extra-agent\.md/, 'report must name added file');
    assert.match(checkRes.stdout, /Added \(1\)/);

    // Clean up added file
    fs.unlinkSync(newFileAbs);
  });

  test('4. remove a file causes check to exit 1 and report names the removed file', () => {
    const versionFile = path.join(tempUpstreamDir, 'VERSION');
    const versionBackup = fs.readFileSync(versionFile);
    fs.unlinkSync(versionFile);

    const checkRes = spawnSync(process.execPath, [
      checkScriptPath,
      '--upstream', tempUpstreamDir,
      '--lock', tempLockFile,
    ], { encoding: 'utf8' });

    assert.equal(checkRes.status, 1, 'check-upstream should exit 1 on removed file');
    assert.match(checkRes.stdout, /VERSION/, 'report must name removed file');
    assert.match(checkRes.stdout, /Removed \(1\)/);

    // Restore removed file
    fs.writeFileSync(versionFile, versionBackup);
  });
});
