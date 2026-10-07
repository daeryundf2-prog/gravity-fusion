import test from 'node:test';
import assert from 'node:assert/strict';
import { PS_PREFIX_RE, splitPsMarker, isMarkedCommand } from '../plugin/hooks/lib/markers.mjs';

test('PS_PREFIX_RE exports compiled regular expressions', () => {
  assert.ok(PS_PREFIX_RE.NTG_ZEN_VERIFY instanceof RegExp);
  assert.ok(PS_PREFIX_RE.NTG_EXCAVATOR instanceof RegExp);
  assert.equal(PS_PREFIX_RE.NTG_ZEN_VERIFY.flags.includes('i'), true);
  assert.equal(PS_PREFIX_RE.NTG_EXCAVATOR.flags.includes('i'), true);
});

test('splitPsMarker matches single and double quoted values', () => {
  const single = splitPsMarker("$env:NTG_ZEN_VERIFY='1'; git status", 'NTG_ZEN_VERIFY');
  assert.deepEqual(single, { matched: true, body: 'git status' });

  const double = splitPsMarker('$env:NTG_ZEN_VERIFY="1"; git status', 'NTG_ZEN_VERIFY');
  assert.deepEqual(double, { matched: true, body: 'git status' });

  // Mismatched quotes must NOT match
  const mismatched = splitPsMarker('$env:NTG_ZEN_VERIFY=\'1"; git status', 'NTG_ZEN_VERIFY');
  assert.deepEqual(mismatched, { matched: false });
});

test('splitPsMarker handles spaces around equals and semicolon', () => {
  const variations = [
    "$env:NTG_ZEN_VERIFY = '1'; ls",
    "$env:NTG_ZEN_VERIFY= '1'; ls",
    "$env:NTG_ZEN_VERIFY ='1'; ls",
    "$env:NTG_ZEN_VERIFY  =  '1'  ;  ls",
    "   $env:NTG_ZEN_VERIFY = '1'; ls",
  ];
  for (const cmd of variations) {
    const res = splitPsMarker(cmd, 'NTG_ZEN_VERIFY');
    assert.equal(res.matched, true, `Failed on: ${cmd}`);
    assert.equal(res.body, 'ls', `Unexpected body for: ${cmd}`);
  }
});

test('splitPsMarker is case-insensitive for $ENV: and variable name', () => {
  const cases = [
    "$ENV:NTG_ZEN_VERIFY='1'; dir",
    "$Env:NTG_ZEN_VERIFY='1'; dir",
    "$env:ntg_zen_verify='1'; dir",
    "$ENV:ntg_zen_verify='1'; dir",
  ];
  for (const cmd of cases) {
    const res = splitPsMarker(cmd, 'NTG_ZEN_VERIFY');
    assert.equal(res.matched, true, `Failed on: ${cmd}`);
    assert.equal(res.body, 'dir');
  }
});

test('splitPsMarker rejects missing semicolon', () => {
  const noSemi = "$env:NTG_ZEN_VERIFY='1' git status";
  assert.deepEqual(splitPsMarker(noSemi, 'NTG_ZEN_VERIFY'), { matched: false });
});

test('splitPsMarker rejects values other than 1', () => {
  const falsy = [
    "$env:NTG_ZEN_VERIFY='0'; git status",
    '$env:NTG_ZEN_VERIFY="0"; git status',
    "$env:NTG_ZEN_VERIFY='2'; git status",
    "$env:NTG_ZEN_VERIFY=1; git status",
    "$env:NTG_ZEN_VERIFY=''; git status",
  ];
  for (const cmd of falsy) {
    assert.deepEqual(splitPsMarker(cmd, 'NTG_ZEN_VERIFY'), { matched: false }, `Should reject ${cmd}`);
  }
});

test('splitPsMarker rejects prefix not anchored at start', () => {
  const notStart = [
    "echo hello; $env:NTG_ZEN_VERIFY='1'; git status",
    "cd .. && $env:NTG_ZEN_VERIFY='1'; git status",
    "cmd /c $env:NTG_ZEN_VERIFY='1'; git status",
  ];
  for (const cmd of notStart) {
    assert.deepEqual(splitPsMarker(cmd, 'NTG_ZEN_VERIFY'), { matched: false }, `Should reject ${cmd}`);
  }
});

test('splitPsMarker supports NTG_EXCAVATOR marker', () => {
  const exc = splitPsMarker("$env:NTG_EXCAVATOR='1'; python test.py", 'NTG_EXCAVATOR');
  assert.deepEqual(exc, { matched: true, body: 'python test.py' });

  const wrong = splitPsMarker("$env:NTG_ZEN_VERIFY='1'; python test.py", 'NTG_EXCAVATOR');
  assert.deepEqual(wrong, { matched: false });
});

test('splitPsMarker rejects non-string inputs gracefully', () => {
  assert.deepEqual(splitPsMarker(null, 'NTG_ZEN_VERIFY'), { matched: false });
  assert.deepEqual(splitPsMarker(undefined, 'NTG_ZEN_VERIFY'), { matched: false });
  assert.deepEqual(splitPsMarker(12345, 'NTG_ZEN_VERIFY'), { matched: false });
  assert.deepEqual(splitPsMarker({}, 'NTG_ZEN_VERIFY'), { matched: false });
});

test('isMarkedCommand recognizes both PowerShell and POSIX prefix forms', () => {
  // PowerShell form
  assert.equal(isMarkedCommand("$env:NTG_ZEN_VERIFY='1'; git status", 'NTG_ZEN_VERIFY'), true);
  assert.equal(isMarkedCommand("$env:NTG_EXCAVATOR='1'; node app.js", 'NTG_EXCAVATOR'), true);

  // POSIX form
  assert.equal(isMarkedCommand("NTG_EXCAVATOR=1 python foo.py", 'NTG_EXCAVATOR'), true);
  assert.equal(isMarkedCommand("NTG_ZEN_VERIFY=1 git diff", 'NTG_ZEN_VERIFY'), true);
  assert.equal(isMarkedCommand("env NTG_ZEN_VERIFY=1 git diff", 'NTG_ZEN_VERIFY'), true);

  // Unmarked / invalid commands
  assert.equal(isMarkedCommand("git status", 'NTG_ZEN_VERIFY'), false);
  assert.equal(isMarkedCommand("node app.js", 'NTG_EXCAVATOR'), false);
  assert.equal(isMarkedCommand("echo NTG_EXCAVATOR=1 node app.js", 'NTG_EXCAVATOR'), false);
  assert.equal(isMarkedCommand("NTG_EXCAVATOR=0 node app.js", 'NTG_EXCAVATOR'), false);
  assert.equal(isMarkedCommand(null, 'NTG_ZEN_VERIFY'), false);
});
