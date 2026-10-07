#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const ROLES = [
  'bulldozer',
  'piledriver',
  'excavator',
  'bobcat',
  'puma',
  'jaguar',
  'steamroller',
  'strix-halo',
  'zen',
];

export const ORCHESTRATION_ROLES = new Set(['bulldozer', 'piledriver', 'steamroller']);
export const MCP_OPT_IN_ROLES = new Set(['excavator', 'bobcat', 'jaguar', 'zen', 'strix-halo']);

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

export function parseMarkdown(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid frontmatter structure');
  }
  return {
    frontmatterText: match[1],
    bodyText: match[2],
  };
}

export function parseFrontmatterBlocks(frontmatterText) {
  const lines = frontmatterText.split('\n');
  const blocks = [];
  let currentKey = null;
  let currentLines = [];

  for (const line of lines) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
    if (keyMatch) {
      if (currentKey !== null) {
        blocks.push({ key: currentKey, lines: currentLines });
      }
      currentKey = keyMatch[1];
      currentLines = [line];
    } else {
      if (currentKey !== null) {
        currentLines.push(line);
      } else if (line.trim() !== '') {
        currentLines.push(line);
      }
    }
  }
  if (currentKey !== null) {
    blocks.push({ key: currentKey, lines: currentLines });
  }
  return blocks;
}

export function extractTools(blockLines) {
  const tools = [];
  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i];
    if (i === 0) {
      const inlineMatch = line.match(/^tools:\s*\[(.*)\]\s*$/);
      if (inlineMatch) {
        return inlineMatch[1]
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      }
    }
    const itemMatch = line.match(/^\s*-\s*(\S+)\s*$/);
    if (itemMatch) {
      tools.push(itemMatch[1].replace(/^['"]|['"]$/g, ''));
    }
  }
  return tools;
}

export function buildAgent({
  roleName,
  roleContent,
  harnessContent,
  orchestrationContent,
  withMcp = false,
}) {
  const { frontmatterText, bodyText } = parseMarkdown(roleContent);
  const blocks = parseFrontmatterBlocks(frontmatterText);

  // 1. Ensure no rules: frontmatter key exists
  const filteredBlocks = blocks.filter((b) => b.key !== 'rules');

  // 2. Adjust tools block
  const toolsBlockIndex = filteredBlocks.findIndex((b) => b.key === 'tools');
  let tools = [];
  if (toolsBlockIndex !== -1) {
    tools = extractTools(filteredBlocks[toolsBlockIndex].lines);
  }

  if (withMcp && MCP_OPT_IN_ROLES.has(roleName)) {
    if (!tools.includes('call_mcp_tool')) {
      tools.push('call_mcp_tool');
    }
  } else {
    tools = tools.filter((t) => t !== 'call_mcp_tool');
  }

  const updatedToolLines = ['tools:'];
  for (const t of tools) {
    updatedToolLines.push(`  - ${t}`);
  }

  if (toolsBlockIndex !== -1) {
    filteredBlocks[toolsBlockIndex] = {
      key: 'tools',
      lines: updatedToolLines,
    };
  } else {
    filteredBlocks.push({
      key: 'tools',
      lines: updatedToolLines,
    });
  }

  // Assemble frontmatter
  const frontmatterOutput = filteredBlocks.flatMap((b) => b.lines).join('\n');

  // Assemble body
  let assembledBody = bodyText.trim();
  if (ORCHESTRATION_ROLES.has(roleName)) {
    assembledBody += '\n\n---\n\n## Orchestration Delta\n\n' + orchestrationContent.trim();
  }
  assembledBody += '\n\n---\n\n## Shared Harness\n\n' + harnessContent.trim() + '\n';

  return `---\n${frontmatterOutput}\n---\n\n${assembledBody}`;
}

export function buildAgents({ repoRoot: targetRepo = repoRoot, withMcp = false } = {}) {
  const rolesDir = path.join(targetRepo, 'src', 'roles');
  const sharedDir = path.join(targetRepo, 'src', 'shared');
  const outputDir = path.join(targetRepo, 'plugin', 'agents');

  const harnessPath = path.join(sharedDir, 'harness.md');
  const orchestrationPath = path.join(sharedDir, 'orchestration.md');

  if (!fs.existsSync(harnessPath)) {
    throw new Error(`Missing harness file: ${harnessPath}`);
  }
  if (!fs.existsSync(orchestrationPath)) {
    throw new Error(`Missing orchestration file: ${orchestrationPath}`);
  }

  const harnessContent = fs.readFileSync(harnessPath, 'utf8');
  const orchestrationContent = fs.readFileSync(orchestrationPath, 'utf8');

  fs.mkdirSync(outputDir, { recursive: true });

  const generated = [];

  for (const role of ROLES) {
    const rolePath = path.join(rolesDir, `${role}.md`);
    if (!fs.existsSync(rolePath)) {
      throw new Error(`Missing role source: ${rolePath}`);
    }
    const roleContent = fs.readFileSync(rolePath, 'utf8');
    const agentMd = buildAgent({
      roleName: role,
      roleContent,
      harnessContent,
      orchestrationContent,
      withMcp,
    });
    const destPath = path.join(outputDir, `${role}.md`);
    fs.writeFileSync(destPath, agentMd, 'utf8');
    generated.push(destPath);
  }

  const probePath = path.join(outputDir, 'gf-mcp-probe.md');
  if (withMcp) {
    const probeContent = [
      '---',
      'name: gf-mcp-probe',
      'description: Live MCP converter probe agent for verifying tool converter registration.',
      'tools:',
      '  - view_file',
      '  - call_mcp_tool',
      'mainAgent: false',
      'subagent: true',
      'model: flash',
      'commandExecutionPolicy: sandbox',
      '---',
      '',
      '# MCP Live Probe',
      '',
      'Diagnostic subagent for verifying whether the Antigravity executor successfully initializes with `call_mcp_tool` registered in tools.',
      '',
    ].join('\n');
    fs.writeFileSync(probePath, probeContent, 'utf8');
    generated.push(probePath);
  } else {
    if (fs.existsSync(probePath)) {
      fs.unlinkSync(probePath);
    }
  }

  return generated;
}

if (isMain(import.meta.url)) {
  const withMcp = process.argv.includes('--mcp');
  const files = buildAgents({ withMcp });
  console.log(`Successfully generated ${files.length} agent(s) (withMcp=${withMcp})`);
}
