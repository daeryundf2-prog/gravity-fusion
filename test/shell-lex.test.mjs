import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pyShlex, pySplit, psTokenize } from "../plugin/hooks/lib/shell-lex.mjs";
import { findPython, runPythonJson } from "./helpers/python.mjs";

/**
 * Deterministic PRNG (Mulberry32) for reproducible fuzzing.
 * @param {number} seed
 */
function createPrng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build test corpus of at least 400 inputs.
 * Combines:
 * 1. String constants extracted via AST from native-gravity shell guard tests
 * 2. Hand-written edge cases
 * 3. Seeded deterministic pseudo-random fuzz strings
 */
function buildCorpus() {
  const corpusSet = new Set();

  // 1. AST extraction from native-gravity tests
  const upstreamTests = [
    "C:/Users/Daeryun/.gemini/antigravity/scratch/native-gravity/tests/test_zen_shell_guard.py",
    "C:/Users/Daeryun/.gemini/antigravity/scratch/native-gravity/tests/test_excavator_shell_guard.py",
  ].filter((p) => fs.existsSync(p));

  if (upstreamTests.length > 0) {
    try {
      const pyCode = [
        "import sys, json, ast",
        "files = json.loads(sys.stdin.read())",
        "strings = set()",
        "special = ' ;&|\\\\<>$`(){}#\"\\'\\n\\t'",
        "for path in files:",
        "    with open(path, 'r', encoding='utf-8') as f:",
        "        tree = ast.parse(f.read(), filename=path)",
        "    for node in ast.walk(tree):",
        "        if isinstance(node, ast.Constant) and isinstance(node.value, str):",
        "            val = node.value",
        "            if any(ch in val for ch in special):",
        "                strings.add(val)",
        "print(json.dumps(sorted(strings)))",
      ].join("\n");
      const astStrings = runPythonJson(pyCode, upstreamTests);
      for (const s of astStrings) {
        corpusSet.add(s);
      }
    } catch (err) {
      console.warn("Could not extract AST strings from upstream tests:", err.message);
    }
  }

  // 2. Hand-written edge cases
  const handWritten = [
    // Unbalanced quotes
    '"',
    "'",
    '"foo',
    "'foo",
    'foo"',
    "foo'",
    'foo"bar',
    "foo'bar",
    '"foo"bar"',
    "'foo'bar'",
    '"foo\\"',
    "'foo\\'",
    // Backslash at end
    "\\",
    "foo\\",
    "foo \\",
    "foo bar\\",
    "foo\\\\",
    '"foo\\',
    "'foo\\",
    '"foo\\\\',
    // Escaped quotes inside double quotes
    '"foo\\"bar"',
    '""',
    '""""',
    '"\\""',
    '"foo\\"bar\\"baz"',
    '"hello \\"world\\" test"',
    '"a\\"b\\"c"',
    '"\\"quoted\\" and \\"more\\""',
    // Single quotes containing backslashes
    "'foo\\bar'",
    "'\\'",
    "'\\\\'",
    "'foo\\'",
    "'a\\b\\c'",
    "'\\n\\t'",
    '\'\\"escaped\\"\'',
    // Adjacent quotes
    '""',
    "''",
    "''''",
    '""foo',
    "''foo",
    'foo""',
    "foo''",
    'foo""bar',
    "foo''bar",
    '"a""b"',
    "'a''b'",
    '"a"\'b\'',
    '\'a\'"b"',
    '"a" "b"',
    "'a' 'b'",
    '--foo="bar""baz"',
    "--foo='bar''baz'",
    // Punctuation edge cases
    ";;",
    "&&&",
    "|&",
    ";",
    ";;;",
    "&",
    "&&",
    "|",
    "||",
    "|||",
    ";&",
    "&;",
    "|;",
    ";|",
    ";&|",
    "||&&;;",
    "foo;;bar",
    "foo &&& bar",
    "foo |& bar",
    "foo;;&&||bar",
    ";;foo",
    "foo;;",
    // Unicode letters
    "한글",
    "한글 명령어",
    "가나다;라마바",
    'utf8_한글="값"',
    "αβγ",
    "café au lait",
    "こんにちは",
    "你好 世界",
    "'한글 따옴표'",
    '"한글 쌍따옴표"',
    "명령어 --옵션=값",
    "hello👋world",
    // Tabs, CRLF, whitespace
    "\t",
    "foo\tbar",
    "foo\t\tbar",
    "\tfoo\t",
    "\r\n",
    "foo\r\nbar",
    "\r\nfoo",
    "foo\r\n",
    "\r",
    "foo\rbar",
    "",
    " ",
    "   ",
    "\t  \r\n  \t",
    "   foo   ",
    "\t\tfoo\t\t",
    "\r\nfoo\r\n",
    // Comments
    "# comment",
    "#",
    "## comment",
    "foo # comment",
    "foo#bar",
    "foo #bar\nbaz",
    "#line1\n#line2\ncmd",
    "#line1\ncmd\n#line3",
    "cmd1 #c1\ncmd2 #c2",
    '""#comment',
    "''#comment",
    "foo#bar\n",
    "#start",
    "mid #comment",
    "mid#comment",
    // Punctuation inside quotes
    '"a;b"',
    "'a;b'",
    '"a&b"',
    "'a&b'",
    '"a|b"',
    "'a|b'",
    '"a;b&c|d"',
    "'a;b&c|d'",
    '";;&&|&"',
    "';;&&|&'",
    '"foo ; bar && baz | qux"',
    "'foo ; bar && baz | qux'",
    '"foo # not a comment"',
    "'foo # not a comment'",
    // Complex combinations
    "echo \"hello world\" | grep -v 'test;123' ; ls -la",
    "git status && (git diff || git log -1)",
    "env NTG_ZEN_VERIFY=1 cat file.txt ; echo done",
    "NTG_EXCAVATOR=1 sudo apt-get update && sudo apt-get upgrade",
    "command --arg='val 1' --other=\"val 2\" ; \\#notcomment",
  ];

  for (const s of handWritten) {
    corpusSet.add(s);
  }

  // 3. Deterministic pseudo-random fuzzing
  const prng = createPrng(0xdeadbeef);
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789 \t\n\"'\\;&|#";
  const targetFuzzCount = 350;

  for (let i = 0; i < targetFuzzCount; i++) {
    const len = Math.floor(prng() * 25) + 1;
    let s = "";
    for (let j = 0; j < len; j++) {
      const idx = Math.floor(prng() * alphabet.length);
      s += alphabet[idx];
    }
    corpusSet.add(s);
  }

  return Array.from(corpusSet);
}

// Ensure the corpus is at least 400
const corpus = buildCorpus();

// --------------------------------------------------------------------------
// Differential verification against CPython 3.12
// --------------------------------------------------------------------------

test("differential verification against real Python 3.12", async (t) => {
  const py = findPython();
  if (!py) {
    console.warn("WARNING: Python interpreter not found! Skipping differential tests.");
    t.skip("python not found");
    return;
  }

  assert(corpus.length >= 400, `Corpus must be at least 400 inputs, got ${corpus.length}`);
  console.log(`Differential testing corpus size: ${corpus.length} inputs`);

  // Configuration 1: Zen shell guard configuration
  // posix=True, punctuation_chars=";&|", whitespace_split=True, commenters="#"
  await t.test("Zen configuration: posix=true, punctuationChars=';&|', whitespaceSplit=true, commenters='#'", () => {
    const pyResults = runPythonJson(
      `
import sys, json, shlex
inputs = json.loads(sys.stdin.read())
results = []
for s in inputs:
    try:
        lex = shlex.shlex(s, posix=True, punctuation_chars=";&|")
        lex.whitespace_split = True
        lex.commenters = "#"
        results.append({"tokens": list(lex)})
    except Exception as e:
        results.append({"error": str(e)})
print(json.dumps(results))
`,
      corpus
    );

    let mismatchCount = 0;
    for (let i = 0; i < corpus.length; i++) {
      const s = corpus[i];
      let jsResult;
      try {
        const tokens = pyShlex(s, {
          posix: true,
          punctuationChars: ";&|",
          whitespaceSplit: true,
          commenters: "#",
        });
        jsResult = { tokens };
      } catch (e) {
        jsResult = { error: e.message };
      }

      try {
        assert.deepStrictEqual(jsResult, pyResults[i]);
      } catch (err) {
        mismatchCount++;
        console.error(`Zen mismatch on input [${i}]: ${JSON.stringify(s)}`);
        console.error(`  JS:     ${JSON.stringify(jsResult)}`);
        console.error(`  Python: ${JSON.stringify(pyResults[i])}`);
        throw err;
      }
    }
    assert.strictEqual(mismatchCount, 0, "Expected zero mismatches in Zen configuration");
  });

  // Configuration 2: Excavator shell guard configuration
  // posix=True, punctuation_chars=";&|", whitespace_split=True, commenters=""
  await t.test("Excavator configuration: posix=true, punctuationChars=';&|', whitespaceSplit=true, commenters=''", () => {
    const pyResults = runPythonJson(
      `
import sys, json, shlex
inputs = json.loads(sys.stdin.read())
results = []
for s in inputs:
    try:
        lex = shlex.shlex(s, posix=True, punctuation_chars=";&|")
        lex.whitespace_split = True
        lex.commenters = ""
        results.append({"tokens": list(lex)})
    except Exception as e:
        results.append({"error": str(e)})
print(json.dumps(results))
`,
      corpus
    );

    let mismatchCount = 0;
    for (let i = 0; i < corpus.length; i++) {
      const s = corpus[i];
      let jsResult;
      try {
        const tokens = pyShlex(s, {
          posix: true,
          punctuationChars: ";&|",
          whitespaceSplit: true,
          commenters: "",
        });
        jsResult = { tokens };
      } catch (e) {
        jsResult = { error: e.message };
      }

      try {
        assert.deepStrictEqual(jsResult, pyResults[i]);
      } catch (err) {
        mismatchCount++;
        console.error(`Excavator mismatch on input [${i}]: ${JSON.stringify(s)}`);
        console.error(`  JS:     ${JSON.stringify(jsResult)}`);
        console.error(`  Python: ${JSON.stringify(pyResults[i])}`);
        throw err;
      }
    }
    assert.strictEqual(mismatchCount, 0, "Expected zero mismatches in Excavator configuration");
  });

  // Configuration 3: shlex.split posix (comments=False, posix=True)
  await t.test("pySplit posix without comments: comments=false, posix=true", () => {
    const pyResults = runPythonJson(
      `
import sys, json, shlex
inputs = json.loads(sys.stdin.read())
results = []
for s in inputs:
    try:
        results.append({"tokens": shlex.split(s, comments=False, posix=True)})
    except Exception as e:
        results.append({"error": str(e)})
print(json.dumps(results))
`,
      corpus
    );

    let mismatchCount = 0;
    for (let i = 0; i < corpus.length; i++) {
      const s = corpus[i];
      let jsResult;
      try {
        const tokens = pySplit(s, { comments: false, posix: true });
        jsResult = { tokens };
      } catch (e) {
        jsResult = { error: e.message };
      }

      try {
        assert.deepStrictEqual(jsResult, pyResults[i]);
      } catch (err) {
        mismatchCount++;
        console.error(`pySplit mismatch on input [${i}]: ${JSON.stringify(s)}`);
        console.error(`  JS:     ${JSON.stringify(jsResult)}`);
        console.error(`  Python: ${JSON.stringify(pyResults[i])}`);
        throw err;
      }
    }
    assert.strictEqual(mismatchCount, 0, "Expected zero mismatches in pySplit configuration");
  });

  // Configuration 4: shlex.split posix with comments=True
  await t.test("pySplit posix with comments: comments=true, posix=true", () => {
    const pyResults = runPythonJson(
      `
import sys, json, shlex
inputs = json.loads(sys.stdin.read())
results = []
for s in inputs:
    try:
        results.append({"tokens": shlex.split(s, comments=True, posix=True)})
    except Exception as e:
        results.append({"error": str(e)})
print(json.dumps(results))
`,
      corpus
    );

    let mismatchCount = 0;
    for (let i = 0; i < corpus.length; i++) {
      const s = corpus[i];
      let jsResult;
      try {
        const tokens = pySplit(s, { comments: true, posix: true });
        jsResult = { tokens };
      } catch (e) {
        jsResult = { error: e.message };
      }

      try {
        assert.deepStrictEqual(jsResult, pyResults[i]);
      } catch (err) {
        mismatchCount++;
        console.error(`pySplit(comments=true) mismatch on input [${i}]: ${JSON.stringify(s)}`);
        console.error(`  JS:     ${JSON.stringify(jsResult)}`);
        console.error(`  Python: ${JSON.stringify(pyResults[i])}`);
        throw err;
      }
    }
    assert.strictEqual(mismatchCount, 0, "Expected zero mismatches in pySplit(comments=true) configuration");
  });
});

// --------------------------------------------------------------------------
// psTokenize unit tests
// --------------------------------------------------------------------------

test("psTokenize unit tests", async (t) => {
  await t.test("basic commands without quotes", () => {
    const res = psTokenize("Get-Content file.txt");
    assert.deepStrictEqual(res, {
      ok: true,
      segments: [["Get-Content", "file.txt"]],
      separators: [],
    });
  });

  await t.test("single quotes and '' escaping", () => {
    // Normal single quote
    assert.deepStrictEqual(psTokenize("Get-Item 'my file.txt'"), {
      ok: true,
      segments: [["Get-Item", "my file.txt"]],
      separators: [],
    });

    // Escaped single quote: ''
    assert.deepStrictEqual(psTokenize("Write-Output 'it''s alive'"), {
      ok: true,
      segments: [["Write-Output", "it's alive"]],
      separators: [],
    });

    // Multiple escaped single quotes
    assert.deepStrictEqual(psTokenize("'a''b''c'"), {
      ok: true,
      segments: [["a'b'c"]],
      separators: [],
    });

    // Empty single quotes
    assert.deepStrictEqual(psTokenize("Get-Content ''"), {
      ok: true,
      segments: [["Get-Content", ""]],
      separators: [],
    });
  });

  await t.test("double quotes and literal contents", () => {
    assert.deepStrictEqual(psTokenize('Get-Item "C:\\Program Files\\app"'), {
      ok: true,
      segments: [["Get-Item", "C:\\Program Files\\app"]],
      separators: [],
    });

    // Escaped double quotes: ""
    assert.deepStrictEqual(psTokenize('Write-Output "hello ""world"""'), {
      ok: true,
      segments: [["Write-Output", 'hello "world"']],
      separators: [],
    });

    // Empty double quotes
    assert.deepStrictEqual(psTokenize('gc ""'), {
      ok: true,
      segments: [["gc", ""]],
      separators: [],
    });
  });

  await t.test("quotes with embedded separators and spaces", () => {
    assert.deepStrictEqual(psTokenize("Get-Content 'file;with|separators\nand newline'"), {
      ok: true,
      segments: [["Get-Content", "file;with|separators\nand newline"]],
      separators: [],
    });

    assert.deepStrictEqual(psTokenize('Select-String "pattern;with|pipe"'), {
      ok: true,
      segments: [["Select-String", "pattern;with|pipe"]],
      separators: [],
    });
  });

  await t.test("separators: ; | and newline (normalized to ;)", () => {
    // Semicolon
    assert.deepStrictEqual(psTokenize("Get-Item a ; Get-Item b"), {
      ok: true,
      segments: [["Get-Item", "a"], ["Get-Item", "b"]],
      separators: [";"],
    });

    // Pipe
    assert.deepStrictEqual(psTokenize("Get-Content a | Select-String b"), {
      ok: true,
      segments: [["Get-Content", "a"], ["Select-String", "b"]],
      separators: ["|"],
    });

    // Newline
    assert.deepStrictEqual(psTokenize("Get-Item a \n Get-Item b"), {
      ok: true,
      segments: [["Get-Item", "a"], ["Get-Item", "b"]],
      separators: [";"],
    });

    // CRLF newline
    assert.deepStrictEqual(psTokenize("Get-Item a \r\n Get-Item b"), {
      ok: true,
      segments: [["Get-Item", "a"], ["Get-Item", "b"]],
      separators: [";"],
    });

    // Mixed separators
    assert.deepStrictEqual(psTokenize("cmd1 ; cmd2 | cmd3 \n cmd4 \r\n cmd5"), {
      ok: true,
      segments: [["cmd1"], ["cmd2"], ["cmd3"], ["cmd4"], ["cmd5"]],
      separators: [";", "|", ";", ";"],
    });
  });

  await t.test("leading, trailing, and inter-token whitespace", () => {
    assert.deepStrictEqual(psTokenize("   \t  Get-ChildItem   -Path   C:\\foo   \t  "), {
      ok: true,
      segments: [["Get-ChildItem", "-Path", "C:\\foo"]],
      separators: [],
    });

    assert.deepStrictEqual(psTokenize("  cmd1  ;  cmd2  |  cmd3  "), {
      ok: true,
      segments: [["cmd1"], ["cmd2"], ["cmd3"]],
      separators: [";", "|"],
    });
  });

  await t.test("empty segment -> ok:false", () => {
    // Empty string
    assert.deepStrictEqual(psTokenize(""), { ok: false, error: "Empty segment" });

    // Whitespace only
    assert.deepStrictEqual(psTokenize("   \t  \r  "), { ok: false, error: "Empty segment" });

    // Leading separator
    assert.deepStrictEqual(psTokenize("; cmd"), { ok: false, error: "Empty segment" });
    assert.deepStrictEqual(psTokenize("| cmd"), { ok: false, error: "Empty segment" });
    assert.deepStrictEqual(psTokenize("\n cmd"), { ok: false, error: "Empty segment" });
    assert.deepStrictEqual(psTokenize("\r\n cmd"), { ok: false, error: "Empty segment" });

    // Trailing separator
    assert.deepStrictEqual(psTokenize("cmd ;"), { ok: false, error: "Empty segment" });
    assert.deepStrictEqual(psTokenize("cmd |"), { ok: false, error: "Empty segment" });
    assert.deepStrictEqual(psTokenize("cmd \n"), { ok: false, error: "Empty segment" });
    assert.deepStrictEqual(psTokenize("cmd \r\n"), { ok: false, error: "Empty segment" });

    // Consecutive separators
    assert.deepStrictEqual(psTokenize("cmd1 ; ; cmd2"), { ok: false, error: "Empty segment" });
    assert.deepStrictEqual(psTokenize("cmd1 | | cmd2"), { ok: false, error: "Empty segment" });
    assert.deepStrictEqual(psTokenize("cmd1 ; | cmd2"), { ok: false, error: "Empty segment" });
    assert.deepStrictEqual(psTokenize("cmd1 \n \n cmd2"), { ok: false, error: "Empty segment" });
    assert.deepStrictEqual(psTokenize("cmd1 ;\n cmd2"), { ok: false, error: "Empty segment" });
  });

  await t.test("unterminated quote -> ok:false", () => {
    assert.deepStrictEqual(psTokenize("Get-Content 'unterminated"), {
      ok: false,
      error: "Unterminated single quote",
    });

    assert.deepStrictEqual(psTokenize('Get-Content "unterminated'), {
      ok: false,
      error: "Unterminated double quote",
    });

    assert.deepStrictEqual(psTokenize("cmd1 ; cmd2 'open quote"), {
      ok: false,
      error: "Unterminated single quote",
    });

    assert.deepStrictEqual(psTokenize('cmd1 | cmd2 "open quote'), {
      ok: false,
      error: "Unterminated double quote",
    });
  });

  await t.test("adjacent unquoted and quoted tokens", () => {
    assert.deepStrictEqual(psTokenize("--file=\"my file.txt\""), {
      ok: true,
      segments: [["--file=my file.txt"]],
      separators: [],
    });

    assert.deepStrictEqual(psTokenize("-Path='C:\\dir'"), {
      ok: true,
      segments: [["-Path=C:\\dir"]],
      separators: [],
    });
  });
});
