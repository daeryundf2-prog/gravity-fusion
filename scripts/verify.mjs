#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export function isMain(importMetaUrl) {
  if (!process.argv || !process.argv[1]) return false;
  try {
    const entryUrl = pathToFileURL(path.resolve(process.argv[1])).href;
    const targetUrl = String(importMetaUrl || '');
    if (process.platform === 'win32') {
      return entryUrl.toLowerCase() === targetUrl.toLowerCase();
    }
    return entryUrl === targetUrl;
  } catch {
    return false;
  }
}

export function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatterText = match[1];
  const body = match[2];
  const lines = frontmatterText.split('\n');
  const frontmatter = {};

  let currentKey = null;
  let currentList = null;

  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const val = keyMatch[2].trim();
      if (val === '') {
        currentList = [];
        frontmatter[currentKey] = currentList;
      } else if (val.startsWith('[') && val.endsWith(']')) {
        frontmatter[currentKey] = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
        currentList = null;
      } else {
        frontmatter[currentKey] = val.replace(/^['"]|['"]$/g, '');
        currentList = null;
      }
    } else if (currentList && line.match(/^\s*-\s*(\S+)\s*$/)) {
      const itemMatch = line.match(/^\s*-\s*(\S+)\s*$/);
      currentList.push(itemMatch[1].replace(/^['"]|['"]$/g, ''));
    }
  }

  return { frontmatter, body };
}

export function checkIS1(repo) {
  const pluginDir = path.join(repo, 'plugin');
  const rulesPath = path.join(pluginDir, 'rules');
  const errors = [];

  if (fs.existsSync(rulesPath)) {
    errors.push(`plugin/rules directory must not exist: found ${rulesPath}`);
  }

  return {
    id: 'IS-1',
    name: 'plugin/rules does not exist',
    ok: errors.length === 0,
    errors,
  };
}

export function checkIS2(repo) {
  const pluginDir = path.join(repo, 'plugin');
  const errors = [];

  function scanPyFiles(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanPyFiles(full);
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        errors.push(`Found .py file in plugin: ${path.relative(repo, full).replace(/\\/g, '/')}`);
      }
    }
  }
  scanPyFiles(pluginDir);

  const hooksPath = path.join(pluginDir, 'hooks.json');
  if (fs.existsSync(hooksPath)) {
    const content = fs.readFileSync(hooksPath, 'utf8');
    if (/python3/i.test(content)) {
      errors.push('Found reference to "python3" in plugin/hooks.json');
    }
    if (/\.py\b/i.test(content) || /\.py['"]/i.test(content)) {
      errors.push('Found reference to "*.py" in plugin/hooks.json');
    }
  } else {
    errors.push('plugin/hooks.json does not exist');
  }

  return {
    id: 'IS-2',
    name: 'Zero .py files in plugin/ and zero python references in hooks.json',
    ok: errors.length === 0,
    errors,
  };
}

export function checkIS3(repo) {
  const agentsDir = path.join(repo, 'plugin', 'agents');
  const errors = [];

  if (!fs.existsSync(agentsDir)) {
    return {
      id: 'IS-3',
      name: 'PowerShell markers only in generated agents',
      ok: false,
      errors: ['plugin/agents directory does not exist'],
    };
  }

  const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  if (agentFiles.length === 0) {
    return {
      id: 'IS-3',
      name: 'PowerShell markers only in generated agents',
      ok: false,
      errors: ['No agent files found in plugin/agents'],
    };
  }

  const compatPattern = /is also recognized|POSIX form/i;
  const markerRegex = /(?:env\s+)?NTG_(?:ZEN_VERIFY|EXCAVATOR)\s*=\s*['"]?1['"]?/gi;

  for (const file of agentFiles) {
    const fullPath = path.join(agentsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      markerRegex.lastIndex = 0;
      let m;
      while ((m = markerRegex.exec(line)) !== null) {
        const idx = m.index;
        const prefix = line.slice(Math.max(0, idx - 5), idx);
        if (!prefix.toLowerCase().endsWith('$env:')) {
          if (!compatPattern.test(line)) {
            errors.push(
              `${file}:${i + 1}: Unescaped/unqualified POSIX marker found: "${line.trim()}"`
            );
          }
        }
      }
    }
  }

  return {
    id: 'IS-3',
    name: 'PowerShell markers only in generated agents',
    ok: errors.length === 0,
    errors,
  };
}

export function checkIS5(repo) {
  const contractsPath = path.join(repo, 'contracts', 'agy-tools.json');
  const agentsDir = path.join(repo, 'plugin', 'agents');
  const errors = [];

  if (!fs.existsSync(contractsPath)) {
    return {
      id: 'IS-5',
      name: 'Agent tools subset and read-only boundaries',
      ok: false,
      errors: ['contracts/agy-tools.json does not exist'],
    };
  }

  const contracts = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));
  const builtinTools = new Set(contracts.builtinAgentTools || []);
  const writeTools = new Set(contracts.writeTools || [
    'write_to_file',
    'replace_file_content',
    'multi_replace_file_content',
  ]);
  const readOnlyRoles = new Set(['jaguar', 'steamroller', 'strix-halo', 'zen']);

  if (!fs.existsSync(agentsDir)) {
    return {
      id: 'IS-5',
      name: 'Agent tools subset and read-only boundaries',
      ok: false,
      errors: ['plugin/agents directory does not exist'],
    };
  }

  const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  for (const file of agentFiles) {
    const fullPath = path.join(agentsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter } = parseFrontmatter(content);
    const roleName = frontmatter.name || path.basename(file, '.md');
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];

    for (const tool of tools) {
      if (!builtinTools.has(tool) && tool !== 'call_mcp_tool') {
        errors.push(`${roleName} has invalid tool "${tool}" (not in agy-tools builtinAgentTools)`);
      }
    }

    if (readOnlyRoles.has(roleName)) {
      for (const tool of tools) {
        if (writeTools.has(tool)) {
          errors.push(`Read-only role "${roleName}" has forbidden write tool "${tool}"`);
        }
      }
      if (roleName !== 'zen' && tools.includes('run_command')) {
        errors.push(`Read-only role "${roleName}" has forbidden tool "run_command"`);
      }
    }
  }

  return {
    id: 'IS-5',
    name: 'Agent tools subset and read-only boundaries',
    ok: errors.length === 0,
    errors,
  };
}

export function checkIS8(repo) {
  const agentsDir = path.join(repo, 'plugin', 'agents');
  const skillsDir = path.join(repo, 'plugin', 'skills');
  const errors = [];

  const agentNames = new Map();
  if (fs.existsSync(agentsDir)) {
    const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    for (const file of agentFiles) {
      const content = fs.readFileSync(path.join(agentsDir, file), 'utf8');
      const { frontmatter } = parseFrontmatter(content);
      const name = frontmatter.name || path.basename(file, '.md');
      if (!agentNames.has(name)) {
        agentNames.set(name, []);
      }
      agentNames.get(name).push(file);
    }
  }

  const skillNames = new Map();
  if (fs.existsSync(skillsDir)) {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
        let skillName = entry.name;
        if (fs.existsSync(skillPath)) {
          const content = fs.readFileSync(skillPath, 'utf8');
          const { frontmatter } = parseFrontmatter(content);
          if (frontmatter.name) {
            skillName = frontmatter.name;
          }
        }
        if (!skillNames.has(skillName)) {
          skillNames.set(skillName, []);
        }
        skillNames.get(skillName).push(entry.name);
      }
    }
  }

  for (const [name, files] of agentNames.entries()) {
    if (files.length > 1) {
      errors.push(`Agent name collision: "${name}" defined in multiple files: ${files.join(', ')}`);
    }
  }

  for (const [name, dirs] of skillNames.entries()) {
    if (dirs.length > 1) {
      errors.push(`Skill name collision: "${name}" defined in multiple skills: ${dirs.join(', ')}`);
    }
  }

  for (const [name, files] of agentNames.entries()) {
    if (skillNames.has(name)) {
      errors.push(
        `Collision between agent and skill: "${name}" (agent in ${files.join(', ')}, skill in ${skillNames.get(name).join(', ')})`
      );
    }
  }

  return {
    id: 'IS-8',
    name: 'No name collisions among plugin skills and agents',
    ok: errors.length === 0,
    errors,
  };
}

export function checkIS10(repo) {
  const pluginReadme = path.join(repo, 'plugin', 'README.md');
  const rootReadme = path.join(repo, 'README.md');
  const readmePath = fs.existsSync(pluginReadme) ? pluginReadme : rootReadme;
  const errors = [];

  if (!fs.existsSync(readmePath)) {
    return {
      id: 'IS-10',
      name: 'README exists and contains all required sections',
      ok: false,
      errors: ['README.md not found in plugin/ or repo root'],
    };
  }

  const content = fs.readFileSync(readmePath, 'utf8');
  const requiredSections = [
    { key: 'Install', pattern: /(?:install|설치)/i },
    { key: 'Usage', pattern: /(?:usage|사용|역할|role)/i },
    { key: 'Troubleshooting', pattern: /(?:troubleshoot|문제\s*해결)/i },
    { key: 'MCP', pattern: /\bmcp\b/i },
    { key: 'Live Verification', pattern: /(?:live\s*verification|라이브\s*검증)/i },
    { key: 'Uninstall', pattern: /(?:uninstall|제거)/i },
    { key: 'Coexistence', pattern: /(?:coexistence|공존)/i },
  ];

  for (const { key, pattern } of requiredSections) {
    if (!pattern.test(content)) {
      errors.push(`README missing required section: "${key}"`);
    }
  }

  return {
    id: 'IS-10',
    name: 'README exists and contains all required sections',
    ok: errors.length === 0,
    errors,
  };
}

export function checkIS15(repo) {
  const agentsDir = path.join(repo, 'plugin', 'agents');
  const errors = [];

  if (!fs.existsSync(agentsDir)) {
    return {
      id: 'IS-15',
      name: 'Default build contains zero instances of call_mcp_tool in tools',
      ok: false,
      errors: ['plugin/agents directory does not exist'],
    };
  }

  const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  for (const file of agentFiles) {
    if (file === 'gf-mcp-probe.md') {
      errors.push('gf-mcp-probe.md must be omitted in default build');
    }
    const fullPath = path.join(agentsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const { frontmatter } = parseFrontmatter(content);
    const tools = Array.isArray(frontmatter.tools) ? frontmatter.tools : [];
    if (tools.includes('call_mcp_tool')) {
      errors.push(`Agent "${file}" has call_mcp_tool in tools array in default build`);
    }
  }

  return {
    id: 'IS-15',
    name: 'Default build contains zero instances of call_mcp_tool in tools',
    ok: errors.length === 0,
    errors,
  };
}

export function verifyAll({ repoRoot: targetRepo = repoRoot } = {}) {
  const results = [
    checkIS1(targetRepo),
    checkIS2(targetRepo),
    checkIS3(targetRepo),
    checkIS5(targetRepo),
    checkIS8(targetRepo),
    checkIS10(targetRepo),
    checkIS15(targetRepo),
  ];

  const passed = results.filter((r) => r.ok).map((r) => r.id);
  const failed = results.filter((r) => !r.ok).map((r) => r.id);
  const allErrors = results.flatMap((r) => r.errors);

  return {
    ok: failed.length === 0,
    passed,
    failed,
    results,
    errors: allErrors,
  };
}

if (isMain(import.meta.url)) {
  const isJson = process.argv.includes('--json');
  const outcome = verifyAll();

  if (isJson) {
    console.log(JSON.stringify(outcome, null, 2));
  } else {
    for (const r of outcome.results) {
      if (r.ok) {
        console.log(`[PASS] ${r.id}: ${r.name}`);
      } else {
        console.error(`[FAIL] ${r.id}: ${r.name}`);
        for (const err of r.errors) {
          console.error(`  - ${err}`);
        }
      }
    }
    if (outcome.ok) {
      console.log(`\nAll ${outcome.results.length} IS criteria passed.`);
    } else {
      console.error(`\n${outcome.failed.length} IS criteria failed.`);
    }
  }

  process.exit(outcome.ok ? 0 : 1);
}
