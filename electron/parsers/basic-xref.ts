/**
 * BASIC variable cross-reference builder.
 * Scans detokenized BASIC listings for variable references
 * and builds a map of variable name → line numbers.
 */

import type { BasicListing, BasicToken } from './basic-detokenizer';

export interface XRefEntry {
  name: string;
  kind: 'numeric' | 'string' | 'array-num' | 'array-str' | 'fn';
  assignments: number[];  // line numbers where assigned (LET, FOR, DIM, READ, INPUT)
  reads: number[];        // line numbers where read (everywhere else)
}

export interface XRefResult {
  entries: XRefEntry[];
}

// Tokens that introduce variable assignments
const ASSIGN_KEYWORDS = new Set(['LET', 'FOR', 'DIM', 'READ', 'INPUT', 'DEF FN']);

/**
 * Build a cross-reference from a BASIC listing.
 */
export function buildXRef(listing: BasicListing): XRefResult {
  const varMap = new Map<string, { kind: XRefEntry['kind']; assignments: Set<number>; reads: Set<number> }>();

  for (const line of listing.lines) {
    const scan = scanLine(line.tokens);
    const vars = extractVariables(line.tokens, scan);

    // Determine which variables are being assigned on this line
    const assignedVars = findAssignedVars(line.tokens, scan);

    for (const v of vars) {
      let entry = varMap.get(v.name);
      if (!entry) {
        entry = { kind: v.kind, assignments: new Set(), reads: new Set() };
        varMap.set(v.name, entry);
      }
      if (assignedVars.has(v.name)) {
        entry.assignments.add(line.lineNumber);
      } else {
        entry.reads.add(line.lineNumber);
      }
    }
  }

  const entries: XRefEntry[] = [];
  for (const [name, data] of varMap) {
    entries.push({
      name,
      kind: data.kind,
      assignments: [...data.assignments].sort((a, b) => a - b),
      reads: [...data.reads].sort((a, b) => a - b),
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries };
}

interface VarRef {
  name: string;
  kind: XRefEntry['kind'];
}

/**
 * A line reduced to just the characters the user typed as code: keywords and
 * the contents of string literals are blanked out, and anything from a REM
 * onwards is dropped.
 *
 * Keywords are recognised by token type rather than by spelling. That matters
 * for two reasons: the dialects spell them differently (the Spectrum's GO SUB
 * against the ZX81's GOSUB), and a program is free to name a variable after a
 * keyword — ZX81 programs really do contain `LET POKE=6000`, and Spectrum ones
 * `LET peek=PEEK 23689`, both of which a list of reserved words would swallow.
 *
 * Blanking uses NUL rather than a space so that a dropped keyword cannot be
 * mistaken for the gap in `name (`, which would read `n AND (x)` as an array.
 */
const BLANK = '\0';

interface LineScan {
  /** The blanked line. Same length as the raw text, so offsets stay valid. */
  text: string;
  /** Where each token begins in `text`; one entry longer than the token list. */
  offsets: number[];
  /** Whether each token sits inside a string literal. */
  inString: boolean[];
}

function scanLine(tokens: BasicToken[]): LineScan {
  const offsets: number[] = [];
  let raw = '';
  for (const tok of tokens) {
    offsets.push(raw.length);
    raw += tok.type === 'text' ? tok.text : BLANK;
  }
  offsets.push(raw.length);

  // Blank the string literals. Inside a string a doubled quote is an escaped
  // quote and not the end of it, so pairing quotes off with a plain /"[^"]*"/
  // goes out of step and leaves the tail of the string to be read as code.
  const stringAt: boolean[] = new Array(raw.length).fill(false);
  let out = '';
  let inside = false;
  for (let i = 0; i < raw.length; i++) {
    stringAt[i] = inside;
    if (raw[i] === '"') {
      if (inside && raw[i + 1] === '"') { stringAt[i + 1] = true; out += BLANK + BLANK; i++; continue; }
      inside = !inside;
      out += BLANK;
      continue;
    }
    out += inside ? BLANK : raw[i];
  }

  const inString = offsets.map((o) => stringAt[o] ?? false);

  // Stop at the first REM, wherever it falls. Past that point the detokenizer
  // renders every keyword as plain text — it switches to literal mode on the
  // REM byte even when the byte sits inside a string, as it does in programs
  // that pick BASIC apart with `CODE "REM "` — so token types no longer say
  // what is a keyword and what the user typed, and nothing after is analysable.
  const rem = tokens.findIndex(isRem);
  return { text: rem >= 0 ? out.slice(0, offsets[rem]) : out, offsets, inString };
}

function isRem(tok: BasicToken): boolean {
  return tok.type !== 'text' && tok.text.trim().toUpperCase() === 'REM';
}

/** The keyword a token spells, or '' if it is literal text or sits in a string. */
function keywordAt(tokens: BasicToken[], scan: LineScan, i: number): string {
  const tok = tokens[i];
  if (tok.type === 'text' || scan.inString[i]) return '';
  return tok.text.trim().toUpperCase();
}

/** The code following token `i`, blanked as above. */
function after(scan: LineScan, i: number): string {
  return scan.text.slice(Math.min(scan.offsets[i + 1], scan.text.length));
}

/**
 * Extract variable names from a line of BASIC.
 * Variables are: single letter, multi-letter (letter followed by letters/digits),
 * with optional $ suffix (string) or () (array).
 */
function extractVariables(tokens: BasicToken[], scan: LineScan): VarRef[] {
  const vars: VarRef[] = [];
  const seen = new Set<string>();
  const add = (name: string, kind: VarRef['kind']) => {
    if (seen.has(name)) return;
    seen.add(name);
    vars.push({ name, kind });
  };

  // FN references: the name is the first letter after the FN keyword, which is
  // only visible on the token stream — the keyword itself has been blanked.
  for (let i = 0; i < tokens.length; i++) {
    const kw = keywordAt(tokens, scan, i);
    if (kw !== 'FN' && kw !== 'DEF FN') continue;
    const letter = after(scan, i).match(/^[\s\0]*([a-zA-Z])/);
    if (letter) add('FN ' + letter[1], 'fn');
  }

  // Single or multi-letter name followed by optional $ and/or ()
  const varPattern = /\b([a-zA-Z][a-zA-Z0-9]*)(\$?)(\s*\()?/g;
  let match;
  while ((match = varPattern.exec(scan.text)) !== null) {
    const [, name, dollar, paren] = match;
    let kind: VarRef['kind'] = 'numeric';
    if (dollar) kind = paren ? 'array-str' : 'string';
    else if (paren) kind = 'array-num';
    add(name + dollar + (paren ? '()' : ''), kind);
  }

  return vars;
}

/**
 * Find which variables are being assigned on this line.
 * Looks for patterns like LET x=, FOR n=, DIM a$(), READ x, INPUT x
 */
function findAssignedVars(tokens: BasicToken[], scan: LineScan): Set<string> {
  const assigned = new Set<string>();

  for (let i = 0; i < tokens.length; i++) {
    const kw = keywordAt(tokens, scan, i);
    if (!ASSIGN_KEYWORDS.has(kw)) continue;
    const rest = after(scan, i);

    if (kw === 'LET' || kw === 'FOR') {
      // Next non-space text before '=' is the variable
      const m = rest.match(/^[\s\0]*([a-zA-Z][a-zA-Z0-9]*\$?(?:\s*\(\))?)/);
      if (m) assigned.add(m[1].replace(/\s/g, ''));
    }

    if (kw === 'DIM') {
      const m = rest.match(/^[\s\0]*([a-zA-Z][a-zA-Z0-9]*\$?)\s*\(/);
      if (m) assigned.add(m[1] + '()');
    }

    if (kw === 'READ' || kw === 'INPUT') {
      // Can have multiple vars separated by commas/semicolons
      for (const vm of rest.matchAll(/([a-zA-Z][a-zA-Z0-9]*\$?)(?:\s*\(\))?/g)) {
        assigned.add(vm[1]);
      }
    }

    if (kw === 'DEF FN') {
      const m = rest.match(/^[\s\0]*([a-zA-Z])/);
      if (m) assigned.add('FN ' + m[1]);
    }
  }

  return assigned;
}
