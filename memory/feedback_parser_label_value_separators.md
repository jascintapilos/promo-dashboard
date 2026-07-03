---
name: Parser must accept `:`, `=`, or bare space between label and value
description: Sheet column M / remark uses inconsistent separators between field labels and values. The parser regexes must accept all three forms — fix existing patterns with `:?` to `[:=]?`.
type: feedback
originSessionId: 6baee7b0-ead2-43e6-a52c-73cd53df7d6e
---
When the operator writes a name_details_raw or remark line like "Min dep = 100", "Min dep: 100", or "Min dep 100", all three forms must parse the same way. The parser must accept `:`, `=`, or no separator at all between a field label and its value.

**Rule:** In `src/ingest.js`'s `parseNameDetails()` regexes, the separator between label and number must be `\s*[:=]?\s*` — not the narrower `\s*:?\s*`.

**Why:** P074 had `"Min dep = 100"` in column M. The old regex `(?:min...)\s*:?\s*(?:RM|...)?\s*(\d+)` did NOT match because `=` isn't covered by `:?`. Result: `parsed.min_deposit` stayed undefined, the QP2 mapper defaulted `deposit_status='1'` (None) and emitted `min_deposit=0` on the promotion_currency rows. The QPRO FS mapper also wrote `min_transfer=0`. Fix: change `:?` to `[:=]?` in every label-value regex in the parser.

**How to apply:**
- When adding new parser regexes, default to `\s*[:=]?\s*` between label and value, NOT `\s*:?\s*`.
- Fields fixed 2026-05-18: `max_bonus`, `min_deposit` (generic + per-currency variants), `max_transfer_out`. The `to_multiplier` regex already had `[:=]?`.
- If you spot a new field where the operator might use `=`, broaden it preemptively.

**Recovery path for live saves affected by this:**
- QP2 deposit_status — re-PUT main `/api/bo/promotion/<id>` with re-ingested fixture; mapper recomputes `deposit_status` from new `min_deposit`.
- QP2 per-currency min_deposit — main PUT does NOT update promotion_currency rows. Must PUT `/api/bo/promotioncurrency/<id>` individually with the row's `id` + `currency_id` (aliased from GET's `settings_currency_id`). The PUT validator requires positive ints for `max_total_applications`, `max_total_bonus`, `max_withdraw` even when the original row stored `null` — use sentinel `999999999` ≈ "unlimited". Also requires `bonus_type` to be set (POST inline allowed null; PUT does not). See `bin/fix-p074-min-deposit.mjs`.
- QPRO FS min_transfer — same PUT pattern likely applies. Per-brand check needed before mass-running.
