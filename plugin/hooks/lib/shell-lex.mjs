/**
 * @fileoverview CPython 3.12 shlex and PowerShell-subset lexical analyzer.
 */

/**
 * CPython 3.12 shlex lexer faithful port.
 */
class Shlex {
  /**
   * @param {string} instream
   * @param {{ posix?: boolean, punctuationChars?: string | boolean, whitespaceSplit?: boolean, commenters?: string }} [options]
   */
  constructor(instream, { posix = true, punctuationChars = "", whitespaceSplit = false, commenters = "#" } = {}) {
    this.chars = Array.from(typeof instream === "string" ? instream : "");
    this.pos = 0;
    this.posix = Boolean(posix);
    this.eof = this.posix ? null : "";
    this.commenters = typeof commenters === "string" ? commenters : "";
    this.wordchars = "abcdfeghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
    if (this.posix) {
      this.wordchars += "ßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ";
    }
    this.whitespace = " \t\r\n";
    this.whitespaceSplit = Boolean(whitespaceSplit);
    this.quotes = "'\"";
    this.escape = "\\";
    this.escapedquotes = '"';
    this.state = " ";
    this.pushback = [];
    this.lineno = 1;
    this.token = "";

    if (punctuationChars === true) punctuationChars = "();<>|&";
    this.punctuationChars = typeof punctuationChars === "string" ? punctuationChars : "";
    if (this.punctuationChars) {
      this._pushback_chars = [];
      this.wordchars += "~-./*?=";
      const puncSet = new Set(this.punctuationChars);
      this.wordchars = Array.from(this.wordchars).filter((c) => !puncSet.has(c)).join("");
    }
  }

  _readChar() {
    return this.pos < this.chars.length ? this.chars[this.pos++] : "";
  }

  _readLine() {
    let line = "";
    while (this.pos < this.chars.length) {
      const ch = this.chars[this.pos++];
      line += ch;
      if (ch === "\n") break;
    }
    return line;
  }

  pushToken(tok) {
    this.pushback.push(tok);
  }

  getToken() {
    if (this.pushback.length > 0) return this.pushback.pop();
    const raw = this.readToken();
    return raw === this.eof ? this.eof : raw;
  }

  readToken() {
    let quoted = false;
    let escapedstate = " ";
    while (true) {
      const nextchar = (this.punctuationChars && this._pushback_chars?.length)
        ? this._pushback_chars.pop()
        : this._readChar();
      if (nextchar === "\n") this.lineno += 1;

      if (this.state === null) {
        this.token = ""; break;
      } else if (this.state === " ") {
        if (!nextchar) {
          this.state = null; break;
        } else if (this.whitespace.includes(nextchar)) {
          if (this.token || (this.posix && quoted)) break;
          continue;
        } else if (this.commenters && this.commenters.includes(nextchar)) {
          this._readLine(); this.lineno += 1;
        } else if (this.posix && this.escape.includes(nextchar)) {
          escapedstate = "a"; this.state = nextchar;
        } else if (this.wordchars.includes(nextchar)) {
          this.token = nextchar; this.state = "a";
        } else if (this.punctuationChars && this.punctuationChars.includes(nextchar)) {
          this.token = nextchar; this.state = "c";
        } else if (this.quotes.includes(nextchar)) {
          if (!this.posix) this.token = nextchar;
          this.state = nextchar;
        } else if (this.whitespaceSplit) {
          this.token = nextchar; this.state = "a";
        } else {
          this.token = nextchar;
          if (this.token || (this.posix && quoted)) break;
          continue;
        }
      } else if (this.quotes.includes(this.state)) {
        quoted = true;
        if (!nextchar) throw new Error("No closing quotation");
        if (nextchar === this.state) {
          if (!this.posix) { this.token += nextchar; this.state = " "; break; }
          this.state = "a";
        } else if (this.posix && this.escape.includes(nextchar) && this.escapedquotes.includes(this.state)) {
          escapedstate = this.state; this.state = nextchar;
        } else {
          this.token += nextchar;
        }
      } else if (this.escape.includes(this.state)) {
        if (!nextchar) throw new Error("No escaped character");
        if (this.quotes.includes(escapedstate) && nextchar !== this.state && nextchar !== escapedstate) {
          this.token += this.state;
        }
        this.token += nextchar;
        this.state = escapedstate;
      } else if (this.state === "a" || this.state === "c") {
        if (!nextchar) {
          this.state = null; break;
        } else if (this.whitespace.includes(nextchar)) {
          this.state = " ";
          if (this.token || (this.posix && quoted)) break;
          continue;
        } else if (this.commenters && this.commenters.includes(nextchar)) {
          this._readLine(); this.lineno += 1;
          if (this.posix) {
            this.state = " ";
            if (this.token || (this.posix && quoted)) break;
            continue;
          }
        } else if (this.state === "c") {
          if (this.punctuationChars && this.punctuationChars.includes(nextchar)) {
            this.token += nextchar;
          } else {
            if (!this.whitespace.includes(nextchar)) this._pushback_chars.push(nextchar);
            this.state = " "; break;
          }
        } else if (this.posix && this.quotes.includes(nextchar)) {
          this.state = nextchar;
        } else if (this.posix && this.escape.includes(nextchar)) {
          escapedstate = "a"; this.state = nextchar;
        } else if (
          this.wordchars.includes(nextchar) || this.quotes.includes(nextchar) ||
          (this.whitespaceSplit && (!this.punctuationChars || !this.punctuationChars.includes(nextchar)))
        ) {
          this.token += nextchar;
        } else {
          if (this.punctuationChars) this._pushback_chars.push(nextchar);
          else this.pushback.push(nextchar);
          this.state = " ";
          if (this.token || (this.posix && quoted)) break;
          continue;
        }
      }
    }
    let result = this.token;
    this.token = "";
    if (this.posix && !quoted && result === "") result = null;
    return result;
  }

  *[Symbol.iterator]() {
    while (true) {
      const token = this.getToken();
      if (token === this.eof) break;
      yield token;
    }
  }
}

/**
 * Exact emulation of CPython 3.12 shlex.shlex iteration.
 * @param {string} input
 * @param {{ posix?: boolean, punctuationChars?: string | boolean, whitespaceSplit?: boolean, commenters?: string }} [options]
 * @returns {string[]}
 */
export function pyShlex(input, { posix = true, punctuationChars = "", whitespaceSplit = false, commenters = "#" } = {}) {
  const lex = new Shlex(input, { posix, punctuationChars, whitespaceSplit, commenters });
  return Array.from(lex);
}

/**
 * Exact emulation of CPython 3.12 shlex.split.
 * @param {string} input
 * @param {{ comments?: boolean, posix?: boolean }} [options]
 * @returns {string[]}
 */
export function pySplit(input, { comments = false, posix = true } = {}) {
  if (input === null || input === undefined) throw new Error("s argument must not be None");
  const lex = new Shlex(input, { posix, whitespaceSplit: true, commenters: comments ? "#" : "" });
  return Array.from(lex);
}

/**
 * @typedef {{ ok: true, segments: string[][], separators: string[] } | { ok: false, error: string }} PsTokenizeResult
 */

/**
 * PowerShell-subset tokenizer: whitespace split; single quotes ('' = literal '),
 * double quotes (contents literal; callers reject $ and backtick before);
 * separators: ';' '|' and newline (newline = ';').
 * Empty segment => ok:false. Unterminated quote => ok:false.
 * @param {string} input
 * @returns {PsTokenizeResult}
 */
export function psTokenize(input) {
  if (typeof input !== "string") return { ok: false, error: "Input must be a string" };
  const chars = Array.from(input);
  const n = chars.length;
  const segments = [];
  const separators = [];
  let currentSegment = [];
  let currentToken = null;

  let i = 0;
  while (i < n) {
    const ch = chars[i];
    // Separators outside quotes: ';', '|', '\n' (and '\r\n')
    if (ch === ";" || ch === "|" || ch === "\n" || (ch === "\r" && i + 1 < n && chars[i + 1] === "\n")) {
      if (currentToken !== null) { currentSegment.push(currentToken); currentToken = null; }
      if (currentSegment.length === 0) return { ok: false, error: "Empty segment" };
      const sep = ch === "|" ? "|" : ";";
      i += ch === "\r" ? 2 : 1;
      separators.push(sep);
      segments.push(currentSegment);
      currentSegment = [];
      continue;
    }
    // Whitespace outside quotes
    if (ch === " " || ch === "\t" || ch === "\r") {
      if (currentToken !== null) { currentSegment.push(currentToken); currentToken = null; }
      i++;
      continue;
    }
    // Quotes: single quotes ('' = literal ') and double quotes ("" = literal ")
    if (ch === "'" || ch === '"') {
      if (currentToken === null) currentToken = "";
      const quoteChar = ch;
      i++;
      let closed = false;
      while (i < n) {
        if (chars[i] === quoteChar) {
          if (i + 1 < n && chars[i + 1] === quoteChar) {
            currentToken += quoteChar; i += 2;
          } else {
            closed = true; i++; break;
          }
        } else {
          currentToken += chars[i++];
        }
      }
      if (!closed) return { ok: false, error: `Unterminated ${quoteChar === "'" ? "single" : "double"} quote` };
      continue;
    }
    // Unquoted character
    if (currentToken === null) currentToken = "";
    currentToken += ch;
    i++;
  }

  if (currentToken !== null) { currentSegment.push(currentToken); currentToken = null; }
  if (currentSegment.length === 0) return { ok: false, error: "Empty segment" };
  segments.push(currentSegment);
  return { ok: true, segments, separators };
}
