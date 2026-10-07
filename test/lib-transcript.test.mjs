import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  normalizeKey,
  iterDicts,
  iterToolCalls,
  textContent,
  toolName,
  decodeHubValue,
  parseArgs,
  readTranscript,
  firstInboundText,
  bannerRole,
  inboundRole,
  pairInvokeResults,
} from '../plugin/hooks/lib/transcript.mjs';

test('normalizeKey normalizes hyphens and casing', () => {
  assert.equal(normalizeKey('agent-name'), 'agent_name');
  assert.equal(normalizeKey('CUSTOM_AGENT_NAME'), 'custom_agent_name');
  assert.equal(normalizeKey('selected-Agent-NAME'), 'selected_agent_name');
  assert.equal(normalizeKey(''), '');
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey(undefined), '');
});

test('iterDicts recursively yields all plain objects', () => {
  const tree = {
    a: 1,
    nested: { b: 2, arr: [{ c: 3 }, 4] },
    empty: {},
  };
  const dicts = Array.from(iterDicts(tree));
  assert.equal(dicts.length, 4); // tree, nested, arr[0], empty
  assert.equal(dicts[0], tree);
  assert.deepEqual(dicts[2], { c: 3 });

  // Primitives and arrays alone yield their internal dicts
  assert.equal(Array.from(iterDicts(42)).length, 0);
  assert.equal(Array.from(iterDicts([1, 2, 'str'])).length, 0);
  assert.equal(Array.from(iterDicts([{ x: 1 }])).length, 1);
});

test('iterToolCalls yields tool calls across different nesting conventions', () => {
  const record = {
    step_index: 1,
    tool_calls: [
      { name: 'run_command', args: { CommandLine: 'dir' } },
      { name: 'view_file', args: '{"AbsolutePath":"file.txt"}' },
    ],
    nested: {
      toolCall: { name: 'send_message', args: {} },
      tool_call: { name: 'invoke_subagent', args: {} },
    },
  };

  const calls = Array.from(iterToolCalls(record));
  const names = calls.map((c) => toolName(c));
  assert.ok(names.includes('run_command'));
  assert.ok(names.includes('view_file'));
  assert.ok(names.includes('send_message'));
  assert.ok(names.includes('invoke_subagent'));
});

test('textContent joins all string nodes with newlines', () => {
  const data = {
    title: 'Hello',
    body: {
      intro: 'World',
      tags: ['one', 'two'],
    },
  };
  const text = textContent(data);
  assert.equal(text, 'Hello\nWorld\none\ntwo');
  assert.equal(textContent('plain string'), 'plain string');
  assert.equal(textContent(123), '');
});

test('toolName returns trimmed lowercase name', () => {
  assert.equal(toolName({ name: '  Run_Command  ' }), 'run_command');
  assert.equal(toolName({ name: 'VIEW_FILE' }), 'view_file');
  assert.equal(toolName({}), '');
  assert.equal(toolName(null), '');
});

test('decodeHubValue decodes JSON strings and preserves non-JSON strings', () => {
  // Valid JSON string literals
  assert.equal(decodeHubValue('"zen"'), 'zen');
  assert.equal(decodeHubValue('  "bulldozer"  '), 'bulldozer');

  // Valid JSON array/object literals
  assert.deepEqual(decodeHubValue('[1, 2, 3]'), [1, 2, 3]);
  assert.deepEqual(decodeHubValue('{"Model":"flash"}'), { Model: 'flash' });

  // Non-JSON strings: must return input unchanged
  assert.equal(decodeHubValue('C:\\x'), 'C:\\x');
  assert.equal(decodeHubValue('"unterminated'), '"unterminated');
  assert.equal(decodeHubValue('[unterminated'), '[unterminated');
  assert.equal(decodeHubValue('{unterminated'), '{unterminated');
  assert.equal(decodeHubValue('hello world'), 'hello world');
  assert.equal(decodeHubValue('123'), '123');
  assert.equal(decodeHubValue('true'), 'true');
  assert.equal(decodeHubValue(''), '');

  // Non-strings
  assert.equal(decodeHubValue(123), 123);
  assert.equal(decodeHubValue(null), null);
  assert.equal(decodeHubValue(true), true);
  assert.deepEqual(decodeHubValue([1, 2]), [1, 2]);
});

test('parseArgs parses both upstream plain args and hub JSON-encoded args', () => {
  // Upstream plain args
  const plainCall = {
    name: 'run_command',
    args: { CommandLine: 'dir', Cwd: 'C:\\test' },
  };
  assert.deepEqual(parseArgs(plainCall), { CommandLine: 'dir', Cwd: 'C:\\test' });

  // Hub JSON-encoded string values
  const hubCall = {
    name: 'invoke_subagent',
    args: {
      TypeName: '"zen"',
      Subagents: '[{"Model":"flash","Role":"Verifier"}]',
    },
  };
  const parsedHub = parseArgs(hubCall);
  assert.equal(parsedHub.TypeName, 'zen');
  assert.deepEqual(parsedHub.Subagents, [{ Model: 'flash', Role: 'Verifier' }]);

  // JSON string serialized args
  const stringifiedCall = {
    name: 'run_command',
    args: '{"CommandLine":"echo hi"}',
  };
  assert.deepEqual(parseArgs(stringifiedCall), { CommandLine: 'echo hi' });

  // Invalid / empty args
  assert.deepEqual(parseArgs({}), {});
  assert.deepEqual(parseArgs({ args: 'invalid json' }), {});
  assert.deepEqual(parseArgs({ args: null }), {});
  assert.deepEqual(parseArgs(null), {});
});

test('readTranscript handles missing files, tilde paths, and garbage lines', () => {
  // Missing file returns []
  assert.deepEqual(readTranscript(''), []);
  assert.deepEqual(readTranscript(null), []);
  assert.deepEqual(readTranscript('C:/non/existent/path/never_existed.jsonl'), []);

  // Garbage lines kept as strings, empty lines skipped
  const tempDir = path.join(os.tmpdir(), `gf-test-transcript-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const testFile = path.join(tempDir, 'mixed.jsonl');
  fs.writeFileSync(
    testFile,
    '{"step_index":0,"source":"USER_EXPLICIT"}\n\nnot a json line\n{"step_index":1}\n',
    'utf8'
  );

  try {
    const records = readTranscript(testFile);
    assert.equal(records.length, 3);
    assert.deepEqual(records[0], { step_index: 0, source: 'USER_EXPLICIT' });
    assert.equal(records[1], 'not a json line');
    assert.deepEqual(records[2], { step_index: 1 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('readTranscript loads all hub-2.21.0 test fixtures', () => {
  const fixturesDir = path.resolve('test/fixtures/hub-2.21.0');
  const files = [
    'default-ready.jsonl',
    'bulldozer-go.jsonl',
    'bulldozer-nogo.jsonl',
    'bulldozer-no-zen.jsonl',
    'bulldozer-resend.jsonl',
    'piledriver-go.jsonl',
    'excavator-stale.jsonl',
    'excavator-ps-marker.jsonl',
    'excavator-go-fresh.jsonl',
    'multi-invoke.jsonl',
    'subagent-jaguar.jsonl',
  ];

  for (const file of files) {
    const fullPath = path.join(fixturesDir, file);
    const records = readTranscript(fullPath);
    assert.ok(Array.isArray(records), `Fixture ${file} should parse to an array`);
    assert.ok(records.length > 0, `Fixture ${file} should have at least 1 record`);
    for (const rec of records) {
      assert.equal(typeof rec, 'object', `Record in ${file} should be parsed object`);
      assert.ok('step_index' in rec, `Record in ${file} must have step_index`);
    }
  }
});

test('readTranscript substitutes truncated records from sibling transcript_full.jsonl', () => {
  const truncatedPath = path.resolve('test/fixtures/hub-2.21.0/truncated/transcript.jsonl');
  const records = readTranscript(truncatedPath);

  assert.equal(records.length, 5);
  // Record 3 originally had truncated_fields: ["content"] with "<truncated 2048 bytes>"
  // Sibling transcript_full.jsonl contains the full content with "VERDICT: GO"
  const step3 = records[3];
  assert.equal(step3.step_index, 3);
  assert.ok(step3.content.includes('VERDICT: GO'), 'Step 3 must have full verdict after substitution');
  assert.ok(!step3.content.includes('<truncated'), 'Step 3 should not have truncation marker');
});

test('firstInboundText extracts USER_INPUT and SYSTEM_MESSAGE channel 3 text', () => {
  // Channel 3: USER_INPUT with <USER_REQUEST> and <ADDITIONAL_METADATA>
  const userRecords = [
    {
      step_index: 0,
      type: 'USER_INPUT',
      content: '<USER_REQUEST>\nNTG_ROLE: bulldozer\nDo the task\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nTime: 12:00\n</ADDITIONAL_METADATA>',
    },
  ];
  assert.equal(firstInboundText(userRecords), 'NTG_ROLE: bulldozer\nDo the task');

  // Plain USER_INPUT without wrapper
  const plainUser = [
    {
      step_index: 0,
      type: 'USER_INPUT',
      content: 'NTG_ROLE: piledriver\nPlan system',
    },
  ];
  assert.equal(firstInboundText(plainUser), 'NTG_ROLE: piledriver\nPlan system');

  // Channel 3: SYSTEM_MESSAGE with [Message] ... content= ... </SYSTEM_MESSAGE>
  const subagentRecords = [
    {
      step_index: 0,
      type: 'SYSTEM_MESSAGE',
      content: 'Wrapper text\n<SYSTEM_MESSAGE>\n[Message] timestamp=12:00 sender=parent content=NTG_ROLE: jaguar\nExplore files\n</SYSTEM_MESSAGE>',
    },
  ];
  assert.equal(firstInboundText(subagentRecords), 'NTG_ROLE: jaguar\nExplore files');

  // None present
  assert.equal(firstInboundText([]), null);
  assert.equal(firstInboundText([{ type: 'PLANNER_RESPONSE' }]), null);
});

test('inboundRole extracts role from NTG_ROLE line or ## Role heading', () => {
  const records1 = [
    {
      type: 'USER_INPUT',
      content: '<USER_REQUEST>\nNTG_ROLE: bulldozer\nStart\n</USER_REQUEST>',
    },
  ];
  assert.equal(inboundRole(records1), 'bulldozer');

  const records2 = [
    {
      type: 'USER_INPUT',
      content: '## Role\nexcavator\nFix problem',
    },
  ];
  assert.equal(inboundRole(records2), 'excavator');

  const recordsSubagent = [
    {
      type: 'SYSTEM_MESSAGE',
      content: '[Message] sender=p content=NTG_ROLE: jaguar\nFind code',
    },
  ];
  assert.equal(inboundRole(recordsSubagent), 'jaguar');

  const recordsNone = [
    {
      type: 'USER_INPUT',
      content: 'Just do something ordinary without role marker',
    },
  ];
  assert.equal(inboundRole(recordsNone), null);
});

test('bannerRole extracts role from the single first PLANNER_RESPONSE with non-empty content', () => {
  const valid = [
    { type: 'USER_INPUT', content: 'test' },
    { type: 'PLANNER_RESPONSE', content: 'NTG_ROLE: bulldozer\nExecuting work' },
  ];
  assert.equal(bannerRole(valid), 'bulldozer');

  // Only the first PLANNER_RESPONSE is examined: if it has non-empty content without banner, returns null
  const noBannerFirst = [
    { type: 'PLANNER_RESPONSE', content: 'I am starting work' },
    { type: 'PLANNER_RESPONSE', content: 'NTG_ROLE: bulldozer\nLate banner' },
  ];
  assert.equal(bannerRole(noBannerFirst), null);

  // PLANNER_RESPONSE with tool_calls only (no content) skips to the first one with string content
  const toolCallFirst = [
    { type: 'PLANNER_RESPONSE', content: '', tool_calls: [{ name: 'run_command', args: {} }] },
    { type: 'PLANNER_RESPONSE', content: 'NTG_ROLE: piledriver\nFirst non-empty response' },
  ];
  assert.equal(bannerRole(toolCallFirst), 'piledriver');

  assert.equal(bannerRole([]), null);
});

test('pairInvokeResults pairs invoke_subagent calls with GENERIC result records', () => {
  // Test multi-invoke fixture
  const multiFixturePath = path.resolve('test/fixtures/hub-2.21.0/multi-invoke.jsonl');
  const records = readTranscript(multiFixturePath);
  const pairs = pairInvokeResults(records);

  assert.equal(pairs.length, 1);
  const pair = pairs[0];
  assert.equal(pair.recordIndex, 1);
  assert.equal(pair.callIndex, 0);
  assert.equal(toolName(pair.call), 'invoke_subagent');
  assert.deepEqual(pair.childIds, ['jaguar-child-101', 'zen-child-102']);
  assert.deepEqual(pair.logUris, [
    'file:///C:/Users/Daeryun/.gemini/antigravity/brain/jaguar-child-101/.system_generated/logs/transcript.jsonl',
    'file:///C:/Users/Daeryun/.gemini/antigravity/brain/zen-child-102/.system_generated/logs/transcript.jsonl',
  ]);

  // Test single invoke fixture (bulldozer-go)
  const singlePath = path.resolve('test/fixtures/hub-2.21.0/bulldozer-go.jsonl');
  const singleRecords = readTranscript(singlePath);
  const singlePairs = pairInvokeResults(singleRecords);

  assert.equal(singlePairs.length, 1);
  assert.deepEqual(singlePairs[0].childIds, ['zen-child-001']);
});
