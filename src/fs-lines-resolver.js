// Resolve lines-per-spin for a Free Spin game code.
//
// Why this exists: BO stores per-spin bet as `amount_per_line` (one line's
// bet). Player-facing "value per spin" = amount_per_line × lines_per_spin.
// Without knowing lines, we cannot compare source `value_per_spin` against
// the persisted BO field — a bug that hid a 20x-overpayment mapper defect
// for ~6 weeks on QP2 FS saves.
//
// Resolution order:
//   1. Explicit override in data/fs-games-lines.json (`overrides[code]`)
//   2. Variable-lines prefix match → returns null (INCONCLUSIVE for Sentinel)
//   3. Pragmatic Play convention: game code `vs<N>...` → N lines
//   4. Return null (unknown — Sentinel returns INCONCLUSIVE, does not guess)
//
// Never hard-code a default like 20. Silent defaults are how the mapper bug
// stayed live for six weeks.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

let _catalog = null;
function loadCatalog() {
  if (_catalog) return _catalog;
  const file = path.resolve('data/fs-games-lines.json');
  if (!existsSync(file)) {
    _catalog = { overrides: {}, variable_lines_prefixes: [] };
    return _catalog;
  }
  _catalog = JSON.parse(readFileSync(file, 'utf8'));
  return _catalog;
}

// Reset for tests
export function _resetCatalogCache() { _catalog = null; }

/**
 * @param {string} gameCode  BO game code (e.g. "vs20olympgate")
 * @returns {number | null}  lines-per-spin, or null if unknown / variable
 */
export function resolveLinesPerSpin(gameCode) {
  if (!gameCode || typeof gameCode !== 'string') return null;
  const cat = loadCatalog();

  // 1. Explicit override
  if (cat.overrides && Object.prototype.hasOwnProperty.call(cat.overrides, gameCode)) {
    return cat.overrides[gameCode];
  }

  // 2. Variable-lines prefixes (Megaways etc.) → null (INCONCLUSIVE)
  for (const prefix of cat.variable_lines_prefixes || []) {
    if (gameCode.startsWith(prefix)) return null;
  }

  // 3. Pragmatic Play convention: vs<N>...
  const m = gameCode.match(/^vs(\d+)[a-z_]/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n < 500) return n;
  }

  // 4. Playtech convention (operator rule 2026-07-10): BO record uses
  // coins=0, lines=0, amount_per_line=the direct bet-per-spin amount — no
  // line multiplier, so lines_per_spin is always 1. Confirmed against all
  // 12 installed Playtech FS games on this BO catalog, all sharing the
  // `gpas_..._pop` code shape (e.g. "gpas_gwizard_pop" = Fire Blaze: Green
  // Wizard). Extend this pattern if a differently-coded Playtech title
  // shows up.
  if (/^gpas_.*_pop$/.test(gameCode)) return 1;

  // 5. Unknown — do not guess
  return null;
}

/**
 * Compute player-facing per-spin bet value.
 * @param {number | null} amountPerLine   Raw wire value from BO
 * @param {string} gameCode
 * @returns {{ value_per_spin: number | null, lines_per_spin: number | null, inconclusive: boolean }}
 */
export function computeValuePerSpin(amountPerLine, gameCode) {
  const lines = resolveLinesPerSpin(gameCode);
  if (amountPerLine == null || lines == null) {
    return { value_per_spin: null, lines_per_spin: lines, inconclusive: true };
  }
  return {
    value_per_spin: +(amountPerLine * lines).toFixed(4),
    lines_per_spin: lines,
    inconclusive: false,
  };
}
