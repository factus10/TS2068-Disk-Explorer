/**
 * The parser table and program hashing, re-exported for the scripts.
 *
 * The implementation lives in electron/ because the app needs it too, and two
 * copies would drift — a program's identity has to mean the same thing
 * wherever it is computed.
 */

export {
  getParser, flattenEntries, hashPrograms,
  type Parser, type HashedProgram,
} from '../../electron/catalog-parsers';
