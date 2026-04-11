/**
 * BASIC variable cross-reference builder.
 * Scans detokenized BASIC listings for variable references
 * and builds a map of variable name → line numbers.
 */

import type { BasicListing } from './basic-detokenizer';

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
    const text = line.tokens.map((t) => t.text).join('');
    const vars = extractVariables(text);

    // Determine which variables are being assigned on this line
    const assignedVars = findAssignedVars(text, line.tokens);

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
 * Extract variable names from a line of BASIC text.
 * Variables are: single letter, multi-letter (letter followed by letters/digits),
 * with optional $ suffix (string) or () (array).
 */
function extractVariables(text: string): VarRef[] {
  const vars: VarRef[] = [];
  const seen = new Set<string>();

  // Match variable patterns:
  // - Single or multi-letter followed by optional $ and/or ()
  // - FN followed by a letter (function definition/call)
  const varPattern = /\b([a-zA-Z][a-zA-Z0-9]*)(\$?)(\s*\()?/g;
  const fnPattern = /\bFN\s+([a-zA-Z])/g;

  // Skip keywords — these are not variables
  const KEYWORDS = new Set([
    'RND', 'INKEY$', 'PI', 'FN', 'POINT', 'SCREEN$', 'ATTR', 'AT', 'TAB',
    'VAL$', 'CODE', 'VAL', 'LEN', 'SIN', 'COS', 'TAN', 'ASN', 'ACS', 'ATN',
    'LN', 'EXP', 'INT', 'SQR', 'SGN', 'ABS', 'PEEK', 'IN', 'USR', 'STR$',
    'CHR$', 'NOT', 'BIN', 'OR', 'AND', 'LINE', 'THEN', 'TO', 'STEP',
    'DEF', 'CAT', 'FORMAT', 'MOVE', 'ERASE', 'OPEN', 'CLOSE', 'MERGE',
    'VERIFY', 'BEEP', 'CIRCLE', 'INK', 'PAPER', 'FLASH', 'BRIGHT',
    'INVERSE', 'OVER', 'OUT', 'LPRINT', 'LLIST', 'STOP', 'READ', 'DATA',
    'RESTORE', 'NEW', 'BORDER', 'CONTINUE', 'DIM', 'REM', 'FOR', 'GO',
    'SUB', 'INPUT', 'LOAD', 'LIST', 'LET', 'PAUSE', 'NEXT', 'POKE',
    'PRINT', 'PLOT', 'RUN', 'SAVE', 'RANDOMIZE', 'IF', 'CLS', 'DRAW',
    'CLEAR', 'RETURN', 'COPY', 'ON', 'ERR', 'STICK', 'SOUND', 'FREE', 'RESET',
  ]);

  // Strip quoted strings before scanning
  const stripped = text.replace(/"[^"]*"/g, (m) => ' '.repeat(m.length));
  // Strip REM content
  const remIdx = findRemPosition(stripped);
  const scanText = remIdx >= 0 ? stripped.substring(0, remIdx) : stripped;

  let match;
  while ((match = varPattern.exec(scanText)) !== null) {
    const name = match[1];
    const dollar = match[2];
    const paren = match[3];

    if (KEYWORDS.has(name.toUpperCase())) continue;
    if (KEYWORDS.has((name + dollar).toUpperCase())) continue;

    const fullName = name + dollar + (paren ? '()' : '');
    let kind: VarRef['kind'] = 'numeric';
    if (dollar) kind = paren ? 'array-str' : 'string';
    else if (paren) kind = 'array-num';

    if (!seen.has(fullName)) {
      vars.push({ name: fullName, kind });
      seen.add(fullName);
    }
  }

  // FN references
  while ((match = fnPattern.exec(scanText)) !== null) {
    const fnName = 'FN ' + match[1];
    if (!seen.has(fnName)) {
      vars.push({ name: fnName, kind: 'fn' });
      seen.add(fnName);
    }
  }

  return vars;
}

function findRemPosition(text: string): number {
  // Find REM keyword (not inside quotes — already stripped)
  const idx = text.search(/\bREM\b/i);
  return idx;
}

/**
 * Find which variables are being assigned on this line.
 * Looks for patterns like LET x=, FOR n=, DIM a$(), READ x, INPUT x
 */
function findAssignedVars(text: string, tokens: { type: string; text: string }[]): Set<string> {
  const assigned = new Set<string>();

  // Find assignment contexts from tokens
  for (let i = 0; i < tokens.length; i++) {
    const kw = tokens[i].text.trim().toUpperCase();

    if (kw === 'LET' || kw === 'FOR') {
      // Next non-space text before '=' is the variable
      const rest = tokens.slice(i + 1).map((t) => t.text).join('');
      const m = rest.match(/^\s*([a-zA-Z][a-zA-Z0-9]*\$?(?:\s*\(\))?)/);
      if (m) assigned.add(m[1].replace(/\s/g, ''));
    }

    if (kw === 'DIM') {
      const rest = tokens.slice(i + 1).map((t) => t.text).join('');
      const m = rest.match(/^\s*([a-zA-Z][a-zA-Z0-9]*\$?)\s*\(/);
      if (m) assigned.add(m[1] + '()');
    }

    if (kw === 'READ' || kw === 'INPUT') {
      const rest = tokens.slice(i + 1).map((t) => t.text).join('');
      // Can have multiple vars separated by commas/semicolons
      const varMatches = rest.matchAll(/([a-zA-Z][a-zA-Z0-9]*\$?)(?:\s*\(\))?/g);
      for (const vm of varMatches) {
        const name = vm[1];
        if (!isKeyword(name)) assigned.add(name);
      }
    }

    if (kw === 'DEF FN') {
      const rest = tokens.slice(i + 1).map((t) => t.text).join('');
      const m = rest.match(/^\s*([a-zA-Z])/);
      if (m) assigned.add('FN ' + m[1]);
    }
  }

  return assigned;
}

function isKeyword(name: string): boolean {
  const KW = new Set([
    'RND', 'PI', 'CODE', 'VAL', 'LEN', 'SIN', 'COS', 'TAN', 'ASN', 'ACS',
    'ATN', 'LN', 'EXP', 'INT', 'SQR', 'SGN', 'ABS', 'PEEK', 'IN', 'USR',
    'NOT', 'BIN', 'OR', 'AND', 'LINE', 'THEN', 'TO', 'STEP', 'AT', 'TAB',
  ]);
  return KW.has(name.toUpperCase());
}
