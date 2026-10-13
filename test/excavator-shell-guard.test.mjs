import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluate,
  MARKER,
  PRIVILEGE,
  FULL_UPGRADE,
  REASONS,
  classify_command,
  classify_shell,
  classify_ps,
  is_full_upgrade,
} from '../plugin/hooks/excavator-shell-guard.mjs';

import { findPython } from './helpers/python.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK_SCRIPT = path.join(REPO_ROOT, 'plugin', 'hooks', 'excavator-shell-guard.mjs');
const UPSTREAM_PYTHON_SCRIPT = path.resolve(REPO_ROOT, '../native-gravity/hooks/excavator-shell-guard.py');

function makePayload(command, toolName = 'run_command') {
  return {
    toolCall: {
      name: toolName,
      args: {
        CommandLine: command,
      },
    },
  };
}

describe('excavator-shell-guard: Upstream 33 POSIX vectors', () => {
  const allowVectors = [
    'sudo brightnessctl -d intel_backlight set 50%',
    'sudo cat /sys/class/backlight/intel_backlight/brightness',
    'sudo somecmd -S value',
    'grep \'sudo -S\' README.md',
    'pacman -S vim',
    'apt install foo',
  ];

  const privilegeVectors = [
    'echo candidate | sudo -S id',
    'cat pwfile | sudo -S id',
    'sudo -S id < pwfile',
    'sudo -nS id',
    'su -',
    'sudo su -',
    'pkexec bash',
    'env pkexec bash',
    'command ssh root@localhost',
    'command cat ~/.zsh_history',
    'sudo cat ~/.bash_history',
    'bash -c \'sudo su -\'',
    'for p in a b; do echo $p | sudo -S id; done',
  ];

  const fullUpgradeVectors = [
    'sudo pacman -Syu',
    'yay -Syu',
    'paru -Syu',
    'sudo apt upgrade',
    'sudo apt-get upgrade',
    'sudo apt full-upgrade',
    'sudo apt-get dist-upgrade',
    'sudo dnf upgrade',
    'sudo dnf system-upgrade',
    'sudo yum update',
    'sudo zypper dup',
    'bash -c \'sudo apt upgrade\'',
  ];

  const unmarkedVectors = [
    'sudo apt upgrade',
    'sudo su -',
  ];

  it('allows task-relevant sudo and downstream dash S (6 vectors)', () => {
    for (const cmd of allowVectors) {
      const payload = makePayload(MARKER + cmd);
      const res = evaluate(payload);
      assert.equal(res.decision, 'allow', `Should allow: ${cmd}`);
    }
  });

  it('denies privilege acquisition drift (13 vectors)', () => {
    for (const cmd of privilegeVectors) {
      const payload = makePayload(MARKER + cmd);
      const res = evaluate(payload);
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[PRIVILEGE], `Reason mismatch for: ${cmd}`);
    }
  });

  it('denies full system upgrades (12 vectors)', () => {
    for (const cmd of fullUpgradeVectors) {
      const payload = makePayload(MARKER + cmd);
      const res = evaluate(payload);
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[FULL_UPGRADE], `Reason mismatch for: ${cmd}`);
    }
  });

  it('leaves unmarked commands unaffected (2 vectors)', () => {
    for (const cmd of unmarkedVectors) {
      const payload = makePayload(cmd);
      const res = evaluate(payload);
      assert.equal(res.decision, 'allow', `Should allow unmarked: ${cmd}`);
    }
  });
});

describe('excavator-shell-guard: Differential testing against upstream Python', () => {
  const pythonPath = findPython();

  function runPythonHook(payload) {
    if (!pythonPath) {
      return null;
    }
    const result = spawnSync(pythonPath, [UPSTREAM_PYTHON_SCRIPT], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      timeout: 10000,
    });
    if (result.status !== 0) {
      throw new Error(`Python script failed (${result.status}): ${result.stderr || result.stdout}`);
    }
    return JSON.parse(result.stdout);
  }

  it('matches Python output exactly on all 33 upstream vectors', (t) => {
    if (!pythonPath || !fs.existsSync(UPSTREAM_PYTHON_SCRIPT)) {
      t.skip('Python interpreter or upstream script not found for differential tests');
      return;
    }

    const all33Vectors = [
      // 6 allow
      { cmd: MARKER + 'sudo brightnessctl -d intel_backlight set 50%', expectedDecision: 'allow' },
      { cmd: MARKER + 'sudo cat /sys/class/backlight/intel_backlight/brightness', expectedDecision: 'allow' },
      { cmd: MARKER + 'sudo somecmd -S value', expectedDecision: 'allow' },
      { cmd: MARKER + "grep 'sudo -S' README.md", expectedDecision: 'allow' },
      { cmd: MARKER + 'pacman -S vim', expectedDecision: 'allow' },
      { cmd: MARKER + 'apt install foo', expectedDecision: 'allow' },
      // 13 privilege
      { cmd: MARKER + 'echo candidate | sudo -S id', expectedDecision: 'deny' },
      { cmd: MARKER + 'cat pwfile | sudo -S id', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo -S id < pwfile', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo -nS id', expectedDecision: 'deny' },
      { cmd: MARKER + 'su -', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo su -', expectedDecision: 'deny' },
      { cmd: MARKER + 'pkexec bash', expectedDecision: 'deny' },
      { cmd: MARKER + 'env pkexec bash', expectedDecision: 'deny' },
      { cmd: MARKER + 'command ssh root@localhost', expectedDecision: 'deny' },
      { cmd: MARKER + 'command cat ~/.zsh_history', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo cat ~/.bash_history', expectedDecision: 'deny' },
      { cmd: MARKER + "bash -c 'sudo su -'", expectedDecision: 'deny' },
      { cmd: MARKER + 'for p in a b; do echo $p | sudo -S id; done', expectedDecision: 'deny' },
      // 12 full upgrade
      { cmd: MARKER + 'sudo pacman -Syu', expectedDecision: 'deny' },
      { cmd: MARKER + 'yay -Syu', expectedDecision: 'deny' },
      { cmd: MARKER + 'paru -Syu', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo apt upgrade', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo apt-get upgrade', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo apt full-upgrade', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo apt-get dist-upgrade', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo dnf upgrade', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo dnf system-upgrade', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo yum update', expectedDecision: 'deny' },
      { cmd: MARKER + 'sudo zypper dup', expectedDecision: 'deny' },
      { cmd: MARKER + "bash -c 'sudo apt upgrade'", expectedDecision: 'deny' },
      // 2 unmarked
      { cmd: 'sudo apt upgrade', expectedDecision: 'allow' },
      { cmd: 'sudo su -', expectedDecision: 'allow' },
    ];

    assert.equal(all33Vectors.length, 33, 'Must contain all 33 upstream vectors');

    for (const { cmd, expectedDecision } of all33Vectors) {
      const payload = makePayload(cmd);
      const nodeRes = evaluate(payload);
      const pyRes = runPythonHook(payload);

      assert.equal(nodeRes.decision, expectedDecision, `Node decision mismatch for: ${cmd}`);
      assert.deepEqual(nodeRes, pyRes, `Node vs Python mismatch for: ${cmd}`);
    }
  });

  it('matches Python output on empty body and non-run_command input', (t) => {
    if (!pythonPath || !fs.existsSync(UPSTREAM_PYTHON_SCRIPT)) {
      t.skip('Python interpreter or upstream script not found');
      return;
    }

    const cases = [
      makePayload(MARKER),
      makePayload(MARKER + '   '),
      makePayload(MARKER + 'echo 1', 'other_tool'),
      {},
    ];

    for (const payload of cases) {
      const nodeRes = evaluate(payload);
      const pyRes = runPythonHook(payload);
      assert.deepEqual(nodeRes, pyRes, `Payload mismatch: ${JSON.stringify(payload)}`);
    }
  });
});

describe('excavator-shell-guard: Windows privilege detection', () => {
  const psPrefix = "$env:NTG_EXCAVATOR='1'; ";

  it('denies runas in any form', () => {
    const vectors = [
      'runas /user:admin cmd',
      'runas /user:Administrator "powershell -NoProfile"',
      'runas.exe /user:admin notepad',
      'C:\\Windows\\System32\\runas.exe /user:admin cmd',
      '/usr/bin/runas /user:admin cmd',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[PRIVILEGE]);
    }
  });

  it('denies cmdkey /list', () => {
    const vectors = [
      'cmdkey /list',
      'cmdkey /list:target',
      'cmdkey.exe /LIST',
      'C:\\Windows\\System32\\cmdkey.exe /list',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[PRIVILEGE]);
    }
  });

  it('denies vaultcmd /list*', () => {
    const vectors = [
      'vaultcmd /list',
      'vaultcmd /listcreds',
      'vaultcmd /listschema',
      'vaultcmd.exe /LISTPROPERTIES',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[PRIVILEGE]);
    }
  });

  it('denies reg save or export of SAM, SECURITY, or SYSTEM hives', () => {
    const vectors = [
      'reg save HKLM\\SAM sam.save',
      'reg save HKEY_LOCAL_MACHINE\\SAM sam.hive',
      'reg export HKLM\\SECURITY sec.reg',
      'reg export HKEY_LOCAL_MACHINE\\SECURITY sec.reg',
      'reg save HKLM\\SYSTEM sys.save',
      'reg.exe save HKEY_LOCAL_MACHINE\\SYSTEM sys.hive',
      'reg save HKLM/SAM sam.save',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[PRIVILEGE]);
    }
  });

  it('allows benign reg queries', () => {
    const res = evaluate(makePayload(psPrefix + 'reg query HKLM\\Software'));
    assert.equal(res.decision, 'allow');
  });

  it('denies reading ConsoleHost_history.txt or HistorySavePath', () => {
    const vectors = [
      'Get-Content ConsoleHost_history.txt',
      'Get-Content $HOME\\AppData\\Roaming\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt',
      'gc ConsoleHost_history.txt',
      'cat ConsoleHost_history.txt',
      'type ConsoleHost_history.txt',
      'Select-String password ConsoleHost_history.txt',
      'sls secret ConsoleHost_history.txt',
      'Select-String password (Get-PSReadLineOption).HistorySavePath',
      'Get-Content (Get-PSReadLineOption).HistorySavePath',
      'more ConsoleHost_history.txt',
      'findstr /i secret ConsoleHost_history.txt',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[PRIVILEGE]);
    }
  });

  it('denies loops containing runas or -Credential', () => {
    const vectors = [
      'foreach ($p in $passwords) { runas /user:admin cmd }',
      'foreach ($p in $passwords) { Test-Admin -Credential $p }',
      'for ($i = 0; $i -lt 10; $i++) { runas /user:admin cmd }',
      'for ($i = 0; $i -lt 10; $i++) { Test-Admin -Credential $cred }',
      '$passwords | ForEach-Object { runas /user:admin $_ }',
      '$passwords | ForEach-Object { Test-Admin -Credential $_ }',
      '$passwords | % { runas /user:admin $_ }',
      '$passwords | % { Test-Admin -Credential $_ }',
      '$passwords | foreach { Test-Admin -Credential $_ }',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[PRIVILEGE]);
    }
  });
});

describe('excavator-shell-guard: Windows full-upgrade detection', () => {
  const psPrefix = "$env:NTG_EXCAVATOR='1'; ";

  it('denies winget full upgrade (--all, -r, --recurse)', () => {
    const vectors = [
      'winget upgrade --all',
      'winget upgrade -r',
      'winget upgrade --recurse',
      'winget.exe upgrade --all --silent',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[FULL_UPGRADE]);
    }
  });

  it('allows single-package winget upgrade', () => {
    const res = evaluate(makePayload(psPrefix + 'winget upgrade git'));
    assert.equal(res.decision, 'allow');
  });

  it('denies choco upgrade all and cup all', () => {
    const vectors = [
      'choco upgrade all',
      'choco.exe upgrade all -y',
      'choco up all',
      'cup all',
      'cup.exe all -y',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[FULL_UPGRADE]);
    }
  });

  it('allows single-package choco upgrade', () => {
    assert.equal(evaluate(makePayload(psPrefix + 'choco upgrade git')).decision, 'allow');
    assert.equal(evaluate(makePayload(psPrefix + 'cup git')).decision, 'allow');
  });

  it('denies scoop update (*, --all, -a)', () => {
    const vectors = [
      'scoop update *',
      'scoop update --all',
      'scoop update -a',
      'scoop.exe update *',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[FULL_UPGRADE]);
    }
  });

  it('allows single-package scoop update', () => {
    assert.equal(evaluate(makePayload(psPrefix + 'scoop update git')).decision, 'allow');
  });

  it('denies Install-WindowsUpdate', () => {
    const res = evaluate(makePayload(psPrefix + 'Install-WindowsUpdate'));
    assert.equal(res.decision, 'deny');
    assert.equal(res.reason, REASONS[FULL_UPGRADE]);
  });

  it('denies Update-Module with no name', () => {
    const vectors = [
      'Update-Module',
      'Update-Module -Force',
      'Update-Module -AcceptLicense',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[FULL_UPGRADE]);
    }
  });

  it('allows Update-Module with a specific module name', () => {
    assert.equal(evaluate(makePayload(psPrefix + 'Update-Module Az')).decision, 'allow');
    assert.equal(evaluate(makePayload(psPrefix + 'Update-Module -Name Az')).decision, 'allow');
    assert.equal(evaluate(makePayload(psPrefix + 'Update-Module -Name:Az')).decision, 'allow');
  });

  it('denies usoclient update scan/install actions', () => {
    const vectors = [
      'usoclient StartInstall',
      'usoclient StartInteractiveScan',
      'usoclient ScanInstallWait',
      'usoclient.exe StartInstall',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[FULL_UPGRADE]);
    }
  });

  it('denies wuauclt update actions', () => {
    const vectors = [
      'wuauclt /updatenow',
      'wuauclt /detectnow',
      'wuauclt.exe /updatenow',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[FULL_UPGRADE]);
    }
  });

  it('denies Get-WindowsUpdate with -Install', () => {
    const vectors = [
      'Get-WindowsUpdate -Install',
      'Get-WindowsUpdate -Install -AcceptAll',
      'Get-WindowsUpdate -Install:true',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
      assert.equal(res.reason, REASONS[FULL_UPGRADE]);
    }
  });

  it('allows Get-WindowsUpdate query without -Install', () => {
    assert.equal(evaluate(makePayload(psPrefix + 'Get-WindowsUpdate')).decision, 'allow');
  });
});

describe('excavator-shell-guard: Windows elevation allowed & target recursion', () => {
  const psPrefix = "$env:NTG_EXCAVATOR='1'; ";

  it('allows gsudo with benign commands', () => {
    const vectors = [
      'gsudo echo 1',
      'gsudo git status',
      'gsudo --loadProfile git status',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'allow', `Should allow: ${cmd}`);
    }
  });

  it('denies gsudo with dangerous targets', () => {
    const vectors = [
      'gsudo winget upgrade --all',
      'gsudo runas /user:admin cmd',
      'gsudo choco upgrade all',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
    }
  });

  it('allows Start-Process -Verb RunAs with benign targets', () => {
    const vectors = [
      'Start-Process -Verb RunAs -FilePath git -ArgumentList "status"',
      'Start-Process -Verb RunAs -FilePath notepad',
      'Start-Process -FilePath git -ArgumentList status -Verb RunAs',
      'saps -Verb RunAs -FilePath git -Args status',
      'start -Verb RunAs git status',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'allow', `Should allow: ${cmd}`);
    }
  });

  it('denies Start-Process -Verb RunAs with upgrade or privilege targets', () => {
    const vectors = [
      'Start-Process -Verb RunAs -FilePath winget -ArgumentList "upgrade --all"',
      'Start-Process -Verb RunAs -FilePath cmd -ArgumentList "/c runas /user:admin notepad"',
      'saps -Verb RunAs -FilePath choco -ArgumentList "upgrade all"',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
    }
  });
});

describe('excavator-shell-guard: Windows recursive shells', () => {
  const psPrefix = "$env:NTG_EXCAVATOR='1'; ";

  it('denies powershell / pwsh wrapping full-upgrade or privilege', () => {
    const vectors = [
      'powershell -Command "winget upgrade --all"',
      'powershell -c "runas /user:admin cmd"',
      'pwsh -Command "choco upgrade all"',
      'pwsh -c "vaultcmd /list"',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
    }
  });

  it('denies cmd /c and /k wrapping full-upgrade or privilege', () => {
    const vectors = [
      'cmd /c "winget upgrade --all"',
      'cmd /k "runas /user:admin notepad"',
      'cmd /c "echo 1 && winget upgrade --all"',
      'cmd /c echo 1 & winget upgrade --all',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'deny', `Should deny: ${cmd}`);
    }
  });

  it('allows powershell and cmd wrapping benign commands', () => {
    const vectors = [
      'powershell -Command "git status"',
      'pwsh -c "echo 1"',
      'cmd /c "dir"',
      'cmd /c "echo hello"',
    ];
    for (const cmd of vectors) {
      const res = evaluate(makePayload(psPrefix + cmd));
      assert.equal(res.decision, 'allow', `Should allow: ${cmd}`);
    }
  });

  it('stops recursion beyond depth 2', () => {
    // depth 0: powershell -c
    // depth 1: cmd /c
    // depth 2: powershell -c
    // depth 3: winget upgrade --all (exceeds depth 2 ceiling)
    const deepCmd = 'powershell -c "cmd /c \\"powershell -c \\\\\\"winget upgrade --all\\\\\\"\\""';
    const res = evaluate(makePayload(psPrefix + deepCmd));
    assert.equal(res.decision, 'allow', 'Should allow when depth exceeds ceiling');
  });
});

describe('excavator-shell-guard: Edge cases and CLI integration', () => {
  it('denies empty body with exact message', () => {
    const cases = [
      'NTG_EXCAVATOR=1 ',
      'NTG_EXCAVATOR=1    ',
      "$env:NTG_EXCAVATOR='1'; ",
      '$env:NTG_EXCAVATOR="1";   ',
    ];
    for (const cmd of cases) {
      const res = evaluate(makePayload(cmd));
      assert.equal(res.decision, 'deny');
      assert.equal(res.reason, 'Excavator shell command was empty.');
    }
  });

  it('allows unmarked commands', () => {
    assert.equal(evaluate(makePayload('winget upgrade --all')).decision, 'allow');
    assert.equal(evaluate(makePayload('runas /user:admin cmd')).decision, 'allow');
    assert.equal(evaluate(makePayload('sudo apt upgrade')).decision, 'allow');
  });

  it('allows non-run_command tool calls', () => {
    assert.equal(evaluate(makePayload(MARKER + 'sudo apt upgrade', 'read_file')).decision, 'allow');
  });

  it('fails open on malformed input objects', () => {
    assert.equal(evaluate(null).decision, 'allow');
    assert.equal(evaluate(undefined).decision, 'allow');
    assert.equal(evaluate({}).decision, 'allow');
    assert.equal(evaluate('not an object').decision, 'allow');
  });

  it('spawns CLI hook directly and processes JSON on stdin', () => {
    const runCli = (input) => {
      const res = spawnSync('node', [HOOK_SCRIPT], {
        input: typeof input === 'string' ? input : JSON.stringify(input),
        encoding: 'utf8',
        cwd: REPO_ROOT,
        timeout: 5000,
      });
      assert.equal(res.status, 0, `CLI exited with ${res.status}: ${res.stderr}`);
      return JSON.parse(res.stdout.trim());
    };

    // Allow case
    const allowOut = runCli(makePayload(MARKER + 'git status'));
    assert.equal(allowOut.decision, 'allow');

    // Deny case
    const denyOut = runCli(makePayload(MARKER + 'sudo apt upgrade'));
    assert.equal(denyOut.decision, 'deny');
    assert.equal(denyOut.reason, REASONS[FULL_UPGRADE]);

    // Empty body case
    const emptyOut = runCli(makePayload(MARKER + '  '));
    assert.equal(emptyOut.decision, 'deny');
    assert.equal(emptyOut.reason, 'Excavator shell command was empty.');

    // Malformed JSON case (fails open)
    const malformedOut = runCli('invalid json {{{');
    assert.equal(malformedOut.decision, 'allow');
  });
});
