import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Checks whether a value is a plain dictionary object.
 * @param {any} value
 * @returns {boolean}
 */
function isDict(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Expands leading tilde in a path to the user's home directory.
 * @param {string} filepath
 * @returns {string}
 */
function expandHome(filepath) {
  if (!filepath || typeof filepath !== 'string') return '';
  if (filepath === '~') {
    return os.homedir();
  }
  if (filepath.startsWith('~/') || filepath.startsWith('~\\')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

/**
 * Normalizes an object key by replacing hyphens with underscores and lowercasing.
 * @param {any} key
 * @returns {string}
 */
export function normalizeKey(key) {
  if (key === null || key === undefined) return '';
  return String(key).replace(/-/g, '_').toLowerCase();
}

/**
 * Deeply yields all dictionary objects contained in value.
 * @param {any} value
 * @returns {Generator<object>}
 */
export function* iterDicts(value) {
  if (isDict(value)) {
    yield value;
    for (const child of Object.values(value)) {
      yield* iterDicts(child);
    }
  } else if (Array.isArray(value)) {
    for (const child of value) {
      yield* iterDicts(child);
    }
  }
}

/**
 * Traverses an object or record and yields all tool call structures.
 * Supports toolCall, tool_call, and direct call objects with name & args.
 * @param {any} value
 * @returns {Generator<object>}
 */
export function* iterToolCalls(value) {
  for (const node of iterDicts(value)) {
    const nestedCall = node.toolCall;
    if (isDict(nestedCall)) {
      yield nestedCall;
    }
    const nestedUnder = node.tool_call;
    if (isDict(nestedUnder)) {
      yield nestedUnder;
    }
    if (
      typeof node.name === 'string' &&
      (isDict(node.args) || typeof node.args === 'string')
    ) {
      yield node;
    }
  }
}

/**
 * Extracts and concatenates all string values in an object structure with newlines.
 * @param {any} value
 * @returns {string}
 */
export function textContent(value) {
  const parts = [];
  function walk(node) {
    if (typeof node === 'string') {
      parts.push(node);
    } else if (isDict(node)) {
      for (const child of Object.values(node)) {
        walk(child);
      }
    } else if (Array.isArray(node)) {
      for (const child of node) {
        walk(child);
      }
    }
  }
  walk(value);
  return parts.join('\n');
}

/**
 * Returns the normalized (trimmed, lowercase) name of a tool call.
 * @param {object} call
 * @returns {string}
 */
export function toolName(call) {
  if (!call || typeof call !== 'object') return '';
  return String(call.name || '').trim().toLowerCase();
}

/**
 * JSON-decodes a value if it is a string representation of a JSON string,
 * array, or object literal (starts with '"', '[', or '{').
 * Otherwise returns the input unchanged. Never throws.
 * @param {any} v
 * @returns {any}
 */
export function decodeHubValue(v) {
  if (typeof v !== 'string') {
    return v;
  }
  const trimmed = v.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return v;
    }
  }
  return v;
}

/**
 * Parses arguments of a tool call into an object and decodes JSON-encoded
 * string values produced by AGY hub runtimes.
 * @param {object} call
 * @returns {object}
 */
export function parseArgs(call) {
  if (!call || typeof call !== 'object') return {};
  let args = call.args;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      args = isDict(parsed) ? parsed : {};
    } catch {
      return {};
    }
  } else if (!isDict(args)) {
    return {};
  }
  const decoded = {};
  for (const [key, value] of Object.entries(args)) {
    decoded[key] = decodeHubValue(value);
  }
  return decoded;
}

/**
 * Reads a JSONL transcript file into an array of records.
 * Follows upstream semantics (~ expansion, skipping empty lines, preserving
 * non-JSON lines as strings). Plus hub rules: if any record has non-empty
 * truncated_fields and a sibling transcript_full.jsonl exists, replaces
 * each truncated record by the full record with matching step_index.
 * Never throws.
 * @param {string|object} pathValue
 * @returns {any[]}
 */
export function readTranscript(pathValue) {
  if (!pathValue) return [];
  try {
    const rawPath = expandHome(String(pathValue));
    const fullPath = path.resolve(rawPath);
    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      return [];
    }

    const lines = content.split(/\r?\n/);
    const records = [];
    let hasTruncated = false;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        records.push(obj);
        if (
          obj &&
          typeof obj === 'object' &&
          Array.isArray(obj.truncated_fields) &&
          obj.truncated_fields.length > 0
        ) {
          hasTruncated = true;
        }
      } catch {
        records.push(line);
      }
    }

    if (hasTruncated) {
      const dir = path.dirname(fullPath);
      const basename = path.basename(fullPath);
      if (basename.toLowerCase() !== 'transcript_full.jsonl') {
        const siblingPath = path.join(dir, 'transcript_full.jsonl');
        try {
          if (fs.existsSync(siblingPath)) {
            const siblingContent = fs.readFileSync(siblingPath, 'utf8');
            const siblingLines = siblingContent.split(/\r?\n/);
            const fullMap = new Map();
            for (const sline of siblingLines) {
              if (!sline.trim()) continue;
              try {
                const sobj = JSON.parse(sline);
                if (sobj && typeof sobj === 'object' && sobj.step_index !== undefined) {
                  fullMap.set(sobj.step_index, sobj);
                }
              } catch {}
            }
            for (let i = 0; i < records.length; i++) {
              const rec = records[i];
              if (
                rec &&
                typeof rec === 'object' &&
                Array.isArray(rec.truncated_fields) &&
                rec.truncated_fields.length > 0 &&
                rec.step_index !== undefined &&
                fullMap.has(rec.step_index)
              ) {
                records[i] = fullMap.get(rec.step_index);
              }
            }
          }
        } catch {
          // Ignore sibling read errors; never throw
        }
      }
    }

    return records;
  } catch {
    return [];
  }
}

/**
 * Extracts the first inbound task message text (Channel 3).
 * Examines the first record that is USER_INPUT (stripping <USER_REQUEST> wrapper
 * and anything from <ADDITIONAL_METADATA> onwards) or SYSTEM_MESSAGE with [Message] ... content=.
 * @param {any[]} records
 * @returns {string|null}
 */
export function firstInboundText(records) {
  if (!Array.isArray(records)) return null;

  for (const record of records) {
    if (!isDict(record)) continue;
    const type = String(record.type || '').trim().toUpperCase();

    if (type === 'USER_INPUT') {
      let raw = typeof record.content === 'string' ? record.content : textContent(record);
      if (!raw) continue;
      const metaIdx = raw.indexOf('<ADDITIONAL_METADATA>');
      if (metaIdx !== -1) {
        raw = raw.slice(0, metaIdx);
      }
      const reqMatch = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      if (reqMatch) {
        raw = reqMatch[1];
      } else {
        raw = raw.replace(/<\/?USER_REQUEST>/g, '');
      }
      return raw.trim();
    }

    if (type === 'SYSTEM_MESSAGE') {
      const raw = typeof record.content === 'string' ? record.content : textContent(record);
      if (raw && raw.includes('[Message]') && raw.includes('content=')) {
        const contentIdx = raw.indexOf('content=');
        let payload = raw.slice(contentIdx + 'content='.length);
        const endTagIdx = payload.indexOf('</SYSTEM_MESSAGE>');
        if (endTagIdx !== -1) {
          payload = payload.slice(0, endTagIdx);
        }
        return payload.trim();
      }
    }
  }

  return null;
}

/**
 * Identifies the role from the first inbound task message (Channel 3).
 * Matches ^NTG_ROLE:\s*([A-Za-z][A-Za-z0-9_-]*)\s*$ on the first non-empty line,
 * or upstream ## Role\n<role> markdown heading.
 * @param {any[]} records
 * @returns {string|null}
 */
export function inboundRole(records) {
  const text = firstInboundText(records);
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^\s*NTG_ROLE:\s*([A-Za-z][A-Za-z0-9_-]*)\s*$/i);
    if (match) {
      return match[1].toLowerCase();
    }
    break;
  }

  const roleHeadingMatch = text.match(/^\s*#+\s*Role\s*\r?\n\s*([A-Za-z][A-Za-z0-9_-]*)/m);
  if (roleHeadingMatch) {
    return roleHeadingMatch[1].toLowerCase();
  }

  return null;
}

/**
 * Identifies the role from the banner line of the first PLANNER_RESPONSE (Channel 4).
 * Only that single first PLANNER_RESPONSE record with non-empty content is examined.
 * @param {any[]} records
 * @returns {string|null}
 */
export function bannerRole(records) {
  if (!Array.isArray(records)) return null;

  for (const record of records) {
    if (!isDict(record)) continue;
    const type = String(record.type || '').trim().toUpperCase();
    if (type === 'PLANNER_RESPONSE') {
      const content = record.content;
      if (typeof content === 'string' && content.trim().length > 0) {
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim()) continue;
          const match = line.match(/^\s*NTG_ROLE:\s*([A-Za-z][A-Za-z0-9_-]*)\s*$/i);
          if (match) {
            return match[1].toLowerCase();
          }
          break;
        }
        // Only that single record is examined
        return null;
      }
    }
  }

  return null;
}

/**
 * Pairs each invoke_subagent tool call in a PLANNER_RESPONSE with its corresponding
 * following GENERIC result record containing "Created the following subagents:".
 * Extracts childIds and logUris in order.
 * @param {any[]} records
 * @returns {Array<{callIndex: number, recordIndex: number, call: object, childIds: string[], logUris: string[]}>}
 */
export function pairInvokeResults(records) {
  if (!Array.isArray(records)) return [];

  const results = [];
  const claimedGenericIndices = new Set();

  for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
    const record = records[recordIndex];
    if (!isDict(record)) continue;

    const type = String(record.type || '').trim().toUpperCase();
    if (type !== 'PLANNER_RESPONSE') continue;

    const toolCalls = Array.isArray(record.tool_calls)
      ? record.tool_calls
      : Array.from(iterToolCalls(record));

    for (let callIndex = 0; callIndex < toolCalls.length; callIndex++) {
      const call = toolCalls[callIndex];
      if (toolName(call) !== 'invoke_subagent') continue;

      const childIds = [];
      const logUris = [];

      for (let gIdx = recordIndex + 1; gIdx < records.length; gIdx++) {
        if (claimedGenericIndices.has(gIdx)) continue;
        const gRec = records[gIdx];
        if (!isDict(gRec)) continue;

        const gType = String(gRec.type || '').trim().toUpperCase();
        if (gType === 'GENERIC') {
          const content = String(gRec.content || '');
          if (content.includes('Created the following subagents:')) {
            claimedGenericIndices.add(gIdx);
            for (const m of content.matchAll(/"conversationId":\s*"([^"]+)"/g)) {
              childIds.push(m[1].trim());
            }
            for (const m of content.matchAll(/"logAbsoluteUri":\s*"([^"]+)"/g)) {
              logUris.push(m[1].trim());
            }
            break;
          }
        }
      }

      results.push({
        callIndex,
        recordIndex,
        call,
        childIds,
        logUris,
      });
    }
  }

  return results;
}
