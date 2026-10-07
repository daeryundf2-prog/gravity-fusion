import { pathToFileURL } from 'node:url';
import path from 'node:path';

/**
 * Reads all of stdin as UTF-8, stripping an initial UTF-8 BOM if present.
 * @returns {Promise<string>}
 */
export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  let text = Buffer.concat(chunks).toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}

/**
 * Parses JSON text and ensures the result is a non-null, non-array object.
 * @param {string} text
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function parseJsonObject(text) {
  if (typeof text !== 'string') {
    return { ok: false, error: 'Expected string input' };
  }
  try {
    const val = JSON.parse(text);
    if (typeof val !== 'object' || val === null || Array.isArray(val)) {
      return { ok: false, error: 'Parsed JSON is not an object' };
    }
    return { ok: true, value: val };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Writes an object as a single JSON line to stdout.
 * @param {any} obj
 */
export function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/**
 * Determines whether the given module URL corresponds to the process entry point.
 * Performs case-insensitive comparison on win32 to handle drive letter variances.
 * @param {string|URL} importMetaUrl
 * @returns {boolean}
 */
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
