import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluate, inspectCommand } from '../plugin/hooks/zen-shell-guard.mjs';
import { findPython } from './helpers/python.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const upstreamGuard = path.resolve(repoRoot, '../native-gravity/hooks/zen-shell-guard.py');
const nodeGuard = path.resolve(repoRoot, 'plugin/hooks/zen-shell-guard.mjs');

function commandPayload(command) {
  return {
    toolCall: {
      name: 'run_command',
      args: {
        CommandLine: command,
        Cwd: repoRoot,
        WaitMsBeforeAsync: 0,
      },
    },
    stepIdx: 0,
    conversationId: 'synthetic-zen-verification',
  };
}

function runNodeCli(payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync(process.execPath, [nodeGuard], {
    input: raw,
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Node CLI exited with ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim());
}

function runPythonCli(pyPath, payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync(pyPath, [upstreamGuard], {
    input: raw,
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Python CLI exited with ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim());
}

// 74+ upstream test vectors from native-gravity/tests/test_zen_shell_guard.py
const UPSTREAM_READ_ONLY = [
  'NTG_ZEN_VERIFY=1 git status --short',
  'NTG_ZEN_VERIFY=1 git --no-optional-locks diff --stat',
  'NTG_ZEN_VERIFY=1 git log -3 --oneline',
  'NTG_ZEN_VERIFY=1 git show HEAD:README.md',
  // native-gravity #106 / #121: read-only branch listing and untracked-file listing
  'NTG_ZEN_VERIFY=1 git branch',
  'NTG_ZEN_VERIFY=1 git branch --show-current',
  'NTG_ZEN_VERIFY=1 git branch -vv -a',
  'NTG_ZEN_VERIFY=1 git branch --list feat/*',
  'NTG_ZEN_VERIFY=1 git branch --sort committerdate',
  'NTG_ZEN_VERIFY=1 git ls-files --others --exclude-standard',
  'NTG_ZEN_VERIFY=1 git ls-files -o',
  'NTG_ZEN_VERIFY=1 cat README.md | head -n 10',
  'NTG_ZEN_VERIFY=1 rg --line-number TODO scripts',
  'NTG_ZEN_VERIFY=1 grep -n contract docs/specs/file.md',
  'env NTG_ZEN_VERIFY=1 sha256sum README.md',
  'NTG_ZEN_VERIFY=1 ls -la && wc -l README.md',
  'NTG_ZEN_VERIFY=1 test -f README.md || pwd',
  'NTG_ZEN_VERIFY=1 node --check scripts/spine.mjs',
  'NTG_ZEN_VERIFY=1 python3 --version',
  'NTG_ZEN_VERIFY=1 cat \'file with spaces.txt\'',
];

const UPSTREAM_MUTATIONS_AND_BYPASSES = [
  'rm -rf project',
  'mv a b',
  'cp a b',
  'touch artifact',
  'mkdir output',
  'chmod +x script',
  'ln -s a b',
  'truncate -s 0 artifact',
  'sed -i s/a/b/ file',
  'sed --in-place s/a/b/ file',
  'echo changed > artifact',
  'cat a >> b',
  'cat a 2>errors',
  'cat a | tee b',
  'git commit -am changed',
  'git checkout other',
  'git push origin main',
  'git reset --hard',
  'git clean -fd',
  'git add .',
  'git apply patch',
  'git branch new',
  'git branch -D main',
  'git branch -m old new',
  'git branch --delete main',
  'git branch --set-upstream-to=origin/main',
  'git diff -o artifact',
  'git config x y',
  'git diff --output=artifact',
  'git log -oartifact',
  'git show --output artifact',
  'git diff --ext-diff',
  'git diff --textconv',
  'git -c alias.x=push x',
  'git diff --out=artifact',
  'git log --out artifact',
  'git cat-file --filters HEAD:a',
  'npm install',
  'npm test',
  'apt full-upgrade',
  'pacman -Syu',
  'dnf system-upgrade',
  'zypper dup',
  'pip install pkg',
  'prettier --write .',
  'ruff check --fix .',
  'cargo fmt',
  'python3 -c \'open("a","w").write("x")\'',
  'node -e \'require("fs").writeFileSync("a","x")\'',
  'python3 project_test.py',
  'node tests/test_spine.mjs',
  'bash -c \'rm a\'',
  'sh -c \'touch a\'',
  'eval \'rm a\'',
  'env sh -c \'rm a\'',
  'sudo rm a',
  'command rm a',
  'exec rm a',
  'find . -delete',
  'find . -exec rm a ;',
  'xargs rm',
  'rg --pre=touch pattern .',
  'rg --hostname-bin=touch pattern .',
  'awk \'BEGIN {system("touch a")}\'',
  'sort -o a b',
  'uniq a b',
  'git status; rm a',
  'git status && rm a',
  'git status || rm a',
  'git status\nrm a',
  'git status & rm a',
  'cat a | rm b',
  'git status # comment\nrm a',
  'cat $(touch a)',
  'cat `touch a`',
  'cat <(touch a)',
  '(touch a)',
  '{ touch a; }',
  'r\\m a',
  './git status',
  'env PATH=/tmp/hostile git status',
  'NTG_ZEN_VERIFY=0 rm a',
  'node --check --import=mutator.mjs',
  'cat \'unterminated',
];

const UPSTREAM_UNMARKED = [
  'git commit -m change',
  'NTG_EXCAVATOR=1 sudo systemctl status example',
];

const UPSTREAM_HIDDEN_OR_DISABLED = [
  'env -u NTG_ZEN_VERIFY rm a',
  'NTG_ZEN_VERIFY=0 rm a',
  'bash -c \'NTG_ZEN_VERIFY=1 rm a\'',
  'echo NTG_ZEN_VERIFY=1; rm a',
];

const UPSTREAM_MALFORMED = [
  '{',
  '[]',
  {},
  { toolCall: {} },
  { toolCall: { name: 'run_command', args: {} } },
  { toolCall: { name: 'run_command', args: { CommandLine: 42 } } },
];

describe('zen-shell-guard upstream vectors (evaluate)', () => {
  test('upstream marked read-only commands allowed', () => {
    for (const cmd of UPSTREAM_READ_ONLY) {
      const res = evaluate(commandPayload(cmd));
      assert.equal(
        res.decision,
        'allow',
        `Expected allow for: ${cmd}, got ${JSON.stringify(res)}`
      );
      assert.equal(res.reason, 'Marked read-only verification command');
    }
  });

  test('upstream marked mutations and bypasses denied', () => {
    for (const raw of UPSTREAM_MUTATIONS_AND_BYPASSES) {
      const cmd = 'NTG_ZEN_VERIFY=1 ' + raw;
      const res = evaluate(commandPayload(cmd));
      assert.equal(
        res.decision,
        'deny',
        `Expected deny for: ${cmd}, got ${JSON.stringify(res)}`
      );
      assert.equal(res.reason, 'Zen permits only read-only verification commands');
    }
  });

  test('upstream unmarked commands allowed (outside boundary)', () => {
    for (const cmd of UPSTREAM_UNMARKED) {
      const res = evaluate(commandPayload(cmd));
      assert.equal(
        res.decision,
        'allow',
        `Expected allow for: ${cmd}, got ${JSON.stringify(res)}`
      );
      assert.equal(res.reason, 'Outside the Zen-marked boundary');
    }
  });

  test('upstream hidden marker or disabled marker denied', () => {
    for (const cmd of UPSTREAM_HIDDEN_OR_DISABLED) {
      const res = evaluate(commandPayload(cmd));
      assert.equal(
        res.decision,
        'deny',
        `Expected deny for: ${cmd}, got ${JSON.stringify(res)}`
      );
      assert.equal(res.reason, 'Zen permits only read-only verification commands');
    }
  });

  test('upstream malformed inputs fail closed', () => {
    for (const payload of UPSTREAM_MALFORMED) {
      if (typeof payload === 'string') {
        const cliRes = runNodeCli(payload);
        assert.equal(cliRes.decision, 'deny');
      } else {
        const expected = payload.toolCall && Object.keys(payload.toolCall).length === 0
          ? 'allow'
          : 'deny';
        const res = evaluate(payload);
        assert.equal(
          res.decision,
          expected,
          `Expected ${expected} for payload ${JSON.stringify(payload)}, got ${JSON.stringify(res)}`
        );
      }
    }
  });
});

describe('zen-shell-guard differential test suite against Python', () => {
  const pyPath = findPython();

  test('differential check for all POSIX test vectors against Python', (t) => {
    if (!pyPath) {
      t.skip('Python interpreter not found for differential testing');
      return;
    }

    // 1. Read-only commands
    for (const cmd of UPSTREAM_READ_ONLY) {
      const payload = commandPayload(cmd);
      const pyRes = runPythonCli(pyPath, payload);
      const nodeRes = evaluate(payload);
      assert.deepEqual(
        nodeRes,
        pyRes,
        `Mismatch on valid command: ${cmd}\nNode: ${JSON.stringify(nodeRes)}\nPy:   ${JSON.stringify(pyRes)}`
      );
    }

    // 2. Mutations and bypasses
    for (const raw of UPSTREAM_MUTATIONS_AND_BYPASSES) {
      const cmd = 'NTG_ZEN_VERIFY=1 ' + raw;
      const payload = commandPayload(cmd);
      const pyRes = runPythonCli(pyPath, payload);
      const nodeRes = evaluate(payload);
      assert.deepEqual(
        nodeRes,
        pyRes,
        `Mismatch on mutation/bypass: ${cmd}\nNode: ${JSON.stringify(nodeRes)}\nPy:   ${JSON.stringify(pyRes)}`
      );
    }

    // 3. Unmarked commands
    for (const cmd of UPSTREAM_UNMARKED) {
      const payload = commandPayload(cmd);
      const pyRes = runPythonCli(pyPath, payload);
      const nodeRes = evaluate(payload);
      assert.deepEqual(
        nodeRes,
        pyRes,
        `Mismatch on unmarked command: ${cmd}\nNode: ${JSON.stringify(nodeRes)}\nPy:   ${JSON.stringify(pyRes)}`
      );
    }

    // 4. Hidden / disabled markers
    for (const cmd of UPSTREAM_HIDDEN_OR_DISABLED) {
      const payload = commandPayload(cmd);
      const pyRes = runPythonCli(pyPath, payload);
      const nodeRes = evaluate(payload);
      assert.deepEqual(
        nodeRes,
        pyRes,
        `Mismatch on wrapper/disabled: ${cmd}\nNode: ${JSON.stringify(nodeRes)}\nPy:   ${JSON.stringify(pyRes)}`
      );
    }

    // 5. Malformed inputs CLI parity
    for (const payload of UPSTREAM_MALFORMED) {
      const pyRes = runPythonCli(pyPath, payload);
      const nodeRes = runNodeCli(payload);
      assert.equal(
        nodeRes.decision,
        pyRes.decision,
        `Mismatch on malformed payload: ${JSON.stringify(payload)}`
      );
    }
  });
});

describe('zen-shell-guard PowerShell read-only grammar', () => {
  const validPsCommands = [
    // Get-Content / gc / cat / type
    "$env:NTG_ZEN_VERIFY='1'; Get-Content README.md",
    "$env:NTG_ZEN_VERIFY='1'; gc README.md",
    "$env:NTG_ZEN_VERIFY='1'; cat README.md",
    "$env:NTG_ZEN_VERIFY='1'; type README.md",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content -Path README.md -TotalCount 10",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content README.md -Tail 5",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content README.md -Stream Zone.Identifier",
    "$env:NTG_ZEN_VERIFY='1'; cat 'file with spaces.txt'",
    '$env:NTG_ZEN_VERIFY="1"; cat "file with spaces.txt"',
    "  $env:NTG_ZEN_VERIFY = '1' ; Get-Content README.md",
    '  $ENV:ntg_zen_verify  =  "1"  ;  GET-CONTENT README.md',

    // Get-ChildItem / gci / ls / dir
    "$env:NTG_ZEN_VERIFY='1'; Get-ChildItem",
    "$env:NTG_ZEN_VERIFY='1'; Get-ChildItem -Path src -Recurse -File",
    "$env:NTG_ZEN_VERIFY='1'; gci src",
    "$env:NTG_ZEN_VERIFY='1'; ls src",
    "$env:NTG_ZEN_VERIFY='1'; dir src",

    // Select-String / sls
    '$env:NTG_ZEN_VERIFY=\'1\'; Select-String -Pattern "test" -Path README.md',
    '$env:NTG_ZEN_VERIFY=\'1\'; sls -Pattern "TODO" -Path package.json -SimpleMatch',
    '$env:NTG_ZEN_VERIFY=\'1\'; Select-String -Pattern "err" -Path logs.txt -CaseSensitive -Quiet',

    // Get-FileHash, Test-Path, Get-Item/gi, Resolve-Path/rvpa, Get-Location/gl/pwd
    "$env:NTG_ZEN_VERIFY='1'; Get-FileHash README.md -Algorithm SHA256",
    "$env:NTG_ZEN_VERIFY='1'; Test-Path package.json",
    "$env:NTG_ZEN_VERIFY='1'; Get-Item package.json",
    "$env:NTG_ZEN_VERIFY='1'; gi package.json",
    "$env:NTG_ZEN_VERIFY='1'; Resolve-Path .",
    "$env:NTG_ZEN_VERIFY='1'; rvpa .",
    "$env:NTG_ZEN_VERIFY='1'; Get-Location",
    "$env:NTG_ZEN_VERIFY='1'; gl",
    "$env:NTG_ZEN_VERIFY='1'; pwd",

    // Measure-Object, Select-Object, Sort-Object, Where-Object, Compare-Object, Format-Table, Format-List, Out-String
    "$env:NTG_ZEN_VERIFY='1'; Measure-Object -Line",
    "$env:NTG_ZEN_VERIFY='1'; measure -Line -Word -Character",
    "$env:NTG_ZEN_VERIFY='1'; Select-Object -First 5",
    "$env:NTG_ZEN_VERIFY='1'; select -Last 10",
    "$env:NTG_ZEN_VERIFY='1'; Sort-Object -Descending",
    "$env:NTG_ZEN_VERIFY='1'; sort -Property Length",
    "$env:NTG_ZEN_VERIFY='1'; Where-Object -Property Length -GT 0",
    "$env:NTG_ZEN_VERIFY='1'; where -Property Length -GT 0",
    "$env:NTG_ZEN_VERIFY='1'; Compare-Object -ReferenceObject a -DifferenceObject b",
    "$env:NTG_ZEN_VERIFY='1'; compare -ReferenceObject a -DifferenceObject b",
    "$env:NTG_ZEN_VERIFY='1'; diff -ReferenceObject a -DifferenceObject b",
    "$env:NTG_ZEN_VERIFY='1'; Format-Table -AutoSize",
    "$env:NTG_ZEN_VERIFY='1'; ft -Property Name, Length",
    "$env:NTG_ZEN_VERIFY='1'; Format-List",
    "$env:NTG_ZEN_VERIFY='1'; fl",
    "$env:NTG_ZEN_VERIFY='1'; Out-String",

    // Pipelines
    '$env:NTG_ZEN_VERIFY=\'1\'; Get-Content README.md | Select-String "contract"',
    "$env:NTG_ZEN_VERIFY='1'; Get-ChildItem -Recurse | Where-Object -Property Length -GT 0 | Measure-Object -Line",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content README.md | Select-Object -First 10 | Format-Table",
    "$env:NTG_ZEN_VERIFY='1'; cat README.md | Out-String",
    "$env:NTG_ZEN_VERIFY='1'; git log --oneline | Select-Object -First 5",

    // Multiple commands separated by ; or \n
    "$env:NTG_ZEN_VERIFY='1'; Get-Content README.md; Get-ChildItem",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content README.md\nGet-ChildItem",

    // Git commands
    "$env:NTG_ZEN_VERIFY='1'; git status",
    "$env:NTG_ZEN_VERIFY='1'; git status --short",
    "$env:NTG_ZEN_VERIFY='1'; git --no-optional-locks diff --stat",
    "$env:NTG_ZEN_VERIFY='1'; git log -3 --oneline",
    "$env:NTG_ZEN_VERIFY='1'; git show HEAD:README.md",
    "$env:NTG_ZEN_VERIFY='1'; git.exe status",
    "$env:NTG_ZEN_VERIFY='1'; GIT.EXE status",

    // Node / Python commands
    "$env:NTG_ZEN_VERIFY='1'; node --version",
    "$env:NTG_ZEN_VERIFY='1'; node.exe -V",
    "$env:NTG_ZEN_VERIFY='1'; python --version",
    "$env:NTG_ZEN_VERIFY='1'; python3.exe --version",
    "$env:NTG_ZEN_VERIFY='1'; node --check scripts/build-agents.mjs",
  ];

  test('valid PowerShell read-only verification commands allowed', () => {
    for (const cmd of validPsCommands) {
      const res = evaluate(commandPayload(cmd));
      assert.equal(
        res.decision,
        'allow',
        `Expected allow for PS command: ${cmd}, got ${JSON.stringify(res)}`
      );
      assert.equal(res.reason, 'Marked read-only verification command');
    }
  });
});

describe('zen-shell-guard adversarial bypass corpus', () => {
  const deniedPsCommands = [
    // 1. Attempts to use $ (variables, subexpressions)
    "$env:NTG_ZEN_VERIFY='1'; $(touch pwn)",
    "$env:NTG_ZEN_VERIFY='1'; cat $(touch pwn)",
    "$env:NTG_ZEN_VERIFY='1'; $x = 1",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content $env:TEMP/file",
    '$env:NTG_ZEN_VERIFY=\'1\'; Select-String "$foo" file',
    '$env:NTG_ZEN_VERIFY=\'1\'; "${x}"',

    // 2. Attempts to use backtick (escaping, line continuation)
    "$env:NTG_ZEN_VERIFY='1'; r`m file",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content `\n rm file",

    // 3. Attempts to use subexpression / grouping ( )
    "$env:NTG_ZEN_VERIFY='1'; (Get-Content file)",
    "$env:NTG_ZEN_VERIFY='1'; (rm file)",
    "$env:NTG_ZEN_VERIFY='1'; (Get-ChildItem).Name",

    // 4. Attempts to use script block { }
    "$env:NTG_ZEN_VERIFY='1'; & { rm file }",
    "$env:NTG_ZEN_VERIFY='1'; { touch pwn }",
    "$env:NTG_ZEN_VERIFY='1'; Where-Object { $_.Name -eq 'x' }",

    // 5. Attempts to use indexing / type literal [ ]
    "$env:NTG_ZEN_VERIFY='1'; [System.IO.File]::Delete('file')",
    "$env:NTG_ZEN_VERIFY='1'; [int]1",
    "$env:NTG_ZEN_VERIFY='1'; $arr[0]",
    "$env:NTG_ZEN_VERIFY='1'; dir [a-z]*",

    // 6. Attempts to use static member ::
    "$env:NTG_ZEN_VERIFY='1'; ::",

    // 7. Attempts to use stop-parsing --%
    "$env:NTG_ZEN_VERIFY='1'; --% rm file",
    "$env:NTG_ZEN_VERIFY='1'; git --% commit",

    // 8. Attempts to use splatting @
    "$env:NTG_ZEN_VERIFY='1'; @(1, 2)",
    "$env:NTG_ZEN_VERIFY='1'; cat @params",
    "$env:NTG_ZEN_VERIFY='1'; @{ a = 1 }",

    // 9. Attempts to use comments #
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file # comment\nrm file",
    "$env:NTG_ZEN_VERIFY='1'; # comment",

    // 10. Attempts to use redirection >, <
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file > out.txt",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file >> out.txt",
    "$env:NTG_ZEN_VERIFY='1'; cat < file",
    "$env:NTG_ZEN_VERIFY='1'; cat 2> errors",

    // 11. Attempts to use call operator &
    "$env:NTG_ZEN_VERIFY='1'; & rm file",
    '$env:NTG_ZEN_VERIFY=\'1\'; & "git" status',

    // 12. Attempts to pipe to mutating / forbidden cmdlets
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file | Out-File out.txt",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file | Tee-Object out.txt",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file | ForEach-Object { rm $_ }",
    "$env:NTG_ZEN_VERIFY='1'; Get-ChildItem | Remove-Item",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file | Set-Content file2",
    "$env:NTG_ZEN_VERIFY='1'; cat file | rm other",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file | Add-Content file2",

    // 13. Attempts to use -Wait
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -Wait",
    "$env:NTG_ZEN_VERIFY='1'; gc file -Wait",
    "$env:NTG_ZEN_VERIFY='1'; cat file -Wait",
    "$env:NTG_ZEN_VERIFY='1'; cat file -w",
    "$env:NTG_ZEN_VERIFY='1'; type file -wait",
    "$env:NTG_ZEN_VERIFY='1'; Select-Object -Wait",
    "$env:NTG_ZEN_VERIFY='1'; select -wai",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -wa",

    // 14. Attempts to use common parameters and abbreviations
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -OutVariable myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -ov myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -ov:myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -outv myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -outvar myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -out myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -OutBuffer 10",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -ob 10",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -outb 10",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -PipelineVariable myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -pv myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -pipe myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -ErrorVariable myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -ev myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -err myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -WarningVariable myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -wv myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -warn myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -InformationVariable myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -iv myVar",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file -info myVar",

    // 15. Nested or disabled markers
    "$env:NTG_ZEN_VERIFY='1'; $env:NTG_ZEN_VERIFY='1'; Get-Content file",
    "$env:NTG_ZEN_VERIFY='1'; $env:NTG_ZEN_VERIFY='0'; rm file",
    "$env:NTG_ZEN_VERIFY='0'; Get-Content file",

    // 16. Execution / mutation cmdlets
    "$env:NTG_ZEN_VERIFY='1'; Invoke-Expression 'rm file'",
    "$env:NTG_ZEN_VERIFY='1'; iex 'rm file'",
    "$env:NTG_ZEN_VERIFY='1'; Start-Process notepad",
    "$env:NTG_ZEN_VERIFY='1'; saps notepad",
    "$env:NTG_ZEN_VERIFY='1'; Set-Item file 1",
    "$env:NTG_ZEN_VERIFY='1'; New-Item file",
    "$env:NTG_ZEN_VERIFY='1'; Remove-Item file",
    "$env:NTG_ZEN_VERIFY='1'; ri file",
    "$env:NTG_ZEN_VERIFY='1'; Invoke-WebRequest http://evil.com",
    "$env:NTG_ZEN_VERIFY='1'; iwr http://evil.com",
    "$env:NTG_ZEN_VERIFY='1'; curl http://evil.com",
    "$env:NTG_ZEN_VERIFY='1'; wget http://evil.com",
    "$env:NTG_ZEN_VERIFY='1'; ForEach-Object -MemberName Delete",

    // 17. Empty segments / syntax errors
    "$env:NTG_ZEN_VERIFY='1'; ; Get-Content file",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file;",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file |",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content file ;; Get-Content file",
    "$env:NTG_ZEN_VERIFY='1'; Get-Content 'unterminated",
    "$env:NTG_ZEN_VERIFY='1';",
    "$env:NTG_ZEN_VERIFY='1';   ",
  ];

  test('all adversarial bypasses denied', () => {
    for (const cmd of deniedPsCommands) {
      const res = evaluate(commandPayload(cmd));
      assert.equal(
        res.decision,
        'deny',
        `Expected deny for adversarial command: ${cmd}, got ${JSON.stringify(res)}`
      );
      assert.equal(res.reason, 'Zen permits only read-only verification commands');
    }
  });
});

describe('zen-shell-guard CLI integration', () => {
  test('valid command through child process stdin', () => {
    const res = runNodeCli(commandPayload('NTG_ZEN_VERIFY=1 git status --short'));
    assert.deepEqual(res, {
      decision: 'allow',
      reason: 'Marked read-only verification command',
    });
  });

  test('valid PowerShell command through child process stdin', () => {
    const res = runNodeCli(commandPayload("$env:NTG_ZEN_VERIFY='1'; Get-Content README.md"));
    assert.deepEqual(res, {
      decision: 'allow',
      reason: 'Marked read-only verification command',
    });
  });

  test('denied command through child process stdin', () => {
    const res = runNodeCli(commandPayload('NTG_ZEN_VERIFY=1 rm -rf project'));
    assert.deepEqual(res, {
      decision: 'deny',
      reason: 'Zen permits only read-only verification commands',
    });
  });

  test('outside boundary through child process stdin', () => {
    const res = runNodeCli(commandPayload('git commit -m "outside"'));
    assert.deepEqual(res, {
      decision: 'allow',
      reason: 'Outside the Zen-marked boundary',
    });
  });

  test('malformed JSON input through child process stdin', () => {
    const res = runNodeCli('{');
    assert.equal(res.decision, 'deny');
    assert.match(res.reason, /^Malformed hook input:/);
  });
});
