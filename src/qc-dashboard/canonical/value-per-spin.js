// Blocker: QPRO/QP2 Free Spin value-per-spin accuracy.
//
// Root cause: BO stores per-spin bet in `amount_per_line` (bet-per-line),
// but the operator's source declares `value_per_spin` (bet-per-spin) —
// different units. Comparing them directly produced false MISMATCH (e.g.
// exp 0.40 vs act 0.02 for a Pragmatic Play game where lines_per_spin=20).
//
// Player-facing convention:
//     value_per_spin = amount_per_line × lines_per_spin
//
// This module owns the derivation for the canonical adapters. It reuses
// the existing lines resolver (src/fs-lines-resolver.js) so we don't fork
// game-catalog logic — same source of truth the ingest + canary paths use.
//
// Inputs:
//   pc          — the promotion_currency row from live BO
//   detail      — the promotion detail row (carries free_spin_game_code)
//   platform    — 'qpro' or 'qp2' (small difference in fallback order)
//
// Output shape:
//   {
//     valuePerSpin,        // number in player-facing units, or null
//     linesPerSpin,        // number used for derivation, or null
//     source,              // 'row-lines' | 'game-code' | 'playtech-1' | null
//     inconclusive,        // true when derivation could not complete
//     amountPerLine,       // raw wire value from the row (for audit)
//     gameCode,            // game code used for lookup (or null)
//     note,                // human-readable explanation (never null)
//   }

import { resolveLinesPerSpin } from '../../fs-lines-resolver.js';

function _round4(n) {
  return +Number(n).toFixed(4);
}

export function deriveValuePerSpin({ pc = {}, detail = {}, platform = null } = {}) {
  const amountPerLine = pc.amount_per_line != null ? Number(pc.amount_per_line) : null;
  const gameCode = detail.free_spin_game_code || detail.free_spin_game || null;
  const rowLines = pc.lines != null ? Number(pc.lines) : 0;

  // QPRO stores lines on the row explicitly (operator standard = 10, per
  // src/api-client.js:462-466). Trust it when > 0.
  if (Number.isFinite(rowLines) && rowLines > 0) {
    if (amountPerLine == null) {
      return {
        valuePerSpin: null, linesPerSpin: rowLines, source: 'row-lines',
        inconclusive: true, amountPerLine: null, gameCode,
        note: `amount_per_line missing on live BO; cannot derive value-per-spin (lines_per_spin=${rowLines} from currency row)`,
      };
    }
    return {
      valuePerSpin: _round4(amountPerLine * rowLines),
      linesPerSpin: rowLines, source: 'row-lines', inconclusive: false,
      amountPerLine, gameCode,
      note: `value-per-spin = ${amountPerLine} × ${rowLines} (lines from currency row) = ${_round4(amountPerLine * rowLines)}`,
    };
  }

  // QP2 stores lines=0 on the row — fall back to the game-code resolver
  // (Pragmatic Play `vs<N>` convention → N; Playtech `gpas_*_pop` → 1).
  const resolvedLines = gameCode ? resolveLinesPerSpin(gameCode) : null;
  if (resolvedLines == null) {
    // Two subcases we want to distinguish in the note text so operators know
    // whether to fix the catalog or the source data.
    if (!gameCode) {
      return {
        valuePerSpin: null, linesPerSpin: null, source: null,
        inconclusive: true, amountPerLine, gameCode: null,
        note: 'value-per-spin unavailable: live BO detail has no free_spin_game_code — cannot resolve lines-per-spin',
      };
    }
    return {
      valuePerSpin: null, linesPerSpin: null, source: null,
      inconclusive: true, amountPerLine, gameCode,
      note: `value-per-spin unavailable: game code "${gameCode}" is not in the FS lines catalog (data/fs-games-lines.json) and does not match a known naming convention`,
    };
  }
  const src = /^gpas_.*_pop$/.test(gameCode) ? 'playtech-1' : 'game-code';
  if (amountPerLine == null) {
    return {
      valuePerSpin: null, linesPerSpin: resolvedLines, source: src,
      inconclusive: true, amountPerLine: null, gameCode,
      note: `amount_per_line missing on live BO; cannot derive value-per-spin (lines_per_spin=${resolvedLines} from game code "${gameCode}")`,
    };
  }
  return {
    valuePerSpin: _round4(amountPerLine * resolvedLines),
    linesPerSpin: resolvedLines, source: src, inconclusive: false,
    amountPerLine, gameCode,
    note: `value-per-spin = ${amountPerLine} × ${resolvedLines} (lines from ${src === 'playtech-1' ? 'Playtech convention (gpas_*_pop → 1)' : `game code "${gameCode}"`}) = ${_round4(amountPerLine * resolvedLines)}`,
  };
}
