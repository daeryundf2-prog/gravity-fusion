import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readStdin, parseJsonObject, emit, isMain } from '../plugin/hooks/lib/io.mjs';

test('parseJsonObject parses valid JSON objects', () => {
  const result = parseJsonObject('{"decision":"allow","reason":"ok"}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { decision: 'allow', reason: 'ok' });
});

test('parseJsonObject rejects non-object JSON values', () => {
  const cases = [
    'null',
    'true',
    'false',
    '123',
    '"string"',
    '[1, 2, 3]',
    '[]',
  ];
  for (const c of cases) {
    const res = parseJsonObject(c);
    assert.equal(res.ok, false, `Expected ${c} to fail object check`);
    assert.ok(typeof res.error === 'string');
  }
});

test('parseJsonObject rejects invalid JSON syntax', () => {
  const invalid = ['{', '{unquoted: true}', '{"a": 1,}', 'not json'];
  for (const c of invalid) {
    const res = parseJsonObject(c);
    assert.equal(res.ok, false);
    assert.ok(res.error.length > 0);
  }
});

test('parseJsonObject rejects non-string input', () => {
  const nonStrings = [null, undefined, 123, {}, []];
  for (const val of nonStrings) {
    const res = parseJsonObject(val);
    assert.equal(res.ok, false);
    assert.match(res.error, /Expected string input/);
  }
});

test('emit writes single JSON line to stdout', () => {
  const originalWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    emit({ decision: 'allow', reason: 'passed' });
    assert.equal(captured, JSON.stringify({ decision: 'allow', reason: 'passed' }) + '\n');
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('isMain detects entry point correctly and handles win32 drive letter casing', () => {
  // Imported module should NOT be main
  assert.equal(isMain('file:///non/existent/script.mjs'), false);
  assert.equal(isMain(null), false);
  assert.equal(isMain(undefined), false);

  if (process.argv[1]) {
    const entryUrl = pathToFileURL(path.resolve(process.argv[1])).href;
    assert.equal(isMain(entryUrl), true);

    // Test case-insensitive drive letter variance on Windows
    if (process.platform === 'win32' && entryUrl.includes('file:///')) {
      const flipped = entryUrl.replace(/file:\/\/\/([A-Za-z]):/, (_, drive) => {
        return `file:///${drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase()}:`;
      });
      assert.equal(isMain(flipped), true);
    }
  }
});

test('readStdin reads stdin and strips UTF-8 BOM in child process', async () => {
  const scriptPath = path.resolve('plugin/hooks/lib/io.mjs');
  const runner = `
    import { readStdin } from ${JSON.stringify(pathToFileURL(scriptPath).href)};
    const content = await readStdin();
    process.stdout.write(JSON.stringify({ text: content, len: content.length, firstCode: content.charCodeAt(0) }));
  `;

  // Test with UTF-8 BOM (\uFEFF)
  const child = spawn(process.execPath, ['--input-type=module', '-e', runner]);
  const bomBuffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"hello":"world"}', 'utf8')]);
  child.stdin.write(bomBuffer);
  child.stdin.end();

  let out = '';
  for await (const chunk of child.stdout) {
    out += chunk;
  }
  const parsed = JSON.parse(out);
  assert.equal(parsed.text, '{"hello":"world"}');
  assert.notEqual(parsed.firstCode, 0xfeff);

  // Test without BOM
  const child2 = spawn(process.execPath, ['--input-type=module', '-e', runner]);
  child2.stdin.write(Buffer.from('plain input', 'utf8'));
  child2.stdin.end();

  let out2 = '';
  for await (const chunk of child2.stdout) {
    out2 += chunk;
  }
  const parsed2 = JSON.parse(out2);
  assert.equal(parsed2.text, 'plain input');
});
