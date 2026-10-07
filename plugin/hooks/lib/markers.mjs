/**
 * PowerShell prefix regular expressions for Native Gravity markers.
 * Case-insensitive, anchored at start after optional leading whitespace.
 * Format: ^\s*\$env:NAME\s*=\s*(['"])1\1\s*;\s*
 */
export const PS_PREFIX_RE = {
  NTG_ZEN_VERIFY: /^\s*\$env:NTG_ZEN_VERIFY\s*=\s*(['"])1\1\s*;\s*/i,
  NTG_EXCAVATOR: /^\s*\$env:NTG_EXCAVATOR\s*=\s*(['"])1\1\s*;\s*/i,
};

/**
 * Splits a command string by its PowerShell marker prefix, if present.
 * @param {string} command - Full command line.
 * @param {string} name - Marker name ('NTG_ZEN_VERIFY' | 'NTG_EXCAVATOR').
 * @returns {{matched: false} | {matched: true, body: string}}
 */
export function splitPsMarker(command, name) {
  if (typeof command !== 'string') {
    return { matched: false };
  }
  const re = PS_PREFIX_RE[name] || new RegExp(`^\\s*\\$env:${name}\\s*=\\s*(['"])1\\1\\s*;\\s*`, 'i');
  const match = command.match(re);
  if (!match) {
    return { matched: false };
  }
  return {
    matched: true,
    body: command.slice(match[0].length),
  };
}

/**
 * Checks whether a command string begins with a recognized marker prefix.
 * Supports both PowerShell fusion markers and POSIX upstream markers.
 * @param {string} command - Full command line.
 * @param {string} name - Marker name ('NTG_ZEN_VERIFY' | 'NTG_EXCAVATOR').
 * @returns {boolean}
 */
export function isMarkedCommand(command, name) {
  if (typeof command !== 'string') {
    return false;
  }
  if (splitPsMarker(command, name).matched) {
    return true;
  }
  if (command.startsWith(name + '=1 ')) {
    return true;
  }
  if (name === 'NTG_ZEN_VERIFY' && command.startsWith('env ' + name + '=1 ')) {
    return true;
  }
  return false;
}
