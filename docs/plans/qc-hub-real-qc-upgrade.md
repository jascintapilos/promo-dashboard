# QC Hub — Real-QC Upgrade

**Status**: implemented (increments 1 → 9), pending live smoke + user commit approval.
**Scope**: turn the QC Hub from an auto-check dashboard into a deterministic
expected-vs-live comparator so PASS carries live BO evidence.

**Constraint** the whole plan is anchored to: **never convert
`MANUAL_REQUIRED` into an automated `PASS`.** Every design choice below traces
back to that invariant.

---

## Locked decisions (from the brief)

| # | Decision |
|---|---|
| **D1** | Return `MANUAL_REQUIRED` whenever live BO data cannot be reached or verified. No automated PASS without live BO evidence. |
| **D2** | Optional Request Handle in the run-QC form. Handle-first resolution; otherwise exact `(brand, promo_code)` match. No loose grep. Multiple matches → `MANUAL_REQUIRED`. |
| **D4** | IGMP session support delivered as part of MVP because WS1_MY is in scope. Reuse the existing session/keepalive; cookies never surface in UI/API/logs. |
| **D5** | Distinct `MANUAL_PASS` override button, available only when the automated verdict is `MANUAL_REQUIRED`. Requires reason (≥ 10 chars), evidence, and checker identity from the session. Stored as a separate audit row from automated PASS. |

Commit cadence: implement in small testable increments, run tests, report after
each. User approves commits explicitly.

---

## Architecture

```
                   ┌───────────────────────────┐
   POST /api/run-qc → │  bin/qc-dashboard.mjs       │
                   │                             │
                   │  preflightBrand()  ─┐       │
                   │                     │       │
                   │  fetchPromoSnapshot ┼── raw BO │
                   │                     │       │
                   │  runAutoChecks()    │       │
                   │  computeVerdict()   ┼── baseline
                   │                     │       │
                   │  if (isMvpBrand) {  │       │
                   │    runComparison() ─┴─ compare block
                   │  }                          │
                   └───────────────────────────┘
                            │
                            ▼
   ┌──────────────────────────────────────────────────┐
   │ src/qc-dashboard/compare-flow.js                    │
   │   snapshotToLiveState(snapshot, platform)         │
   │   resolveExpectedSource(brand, code, handle?)     │
   │     └─ handle-first, else (brand, promo_code)     │
   │     └─ ambiguous / not-found → MANUAL_REQUIRED    │
   │   expectedFromSource(source, {brand})             │
   │   liveFromPlatform(platform, liveState, opts)     │
   │   compare({expected, actual, brand, platform})    │
   └──────────────────────────────────────────────────┘
                            │
                            ▼
   ┌──────────────────────────────────────────────────┐
   │ compare-engine.js                                  │
   │   deterministic Sentinel rules → fields[]         │
   │   verdict aggregation:                            │
   │     any CRITICAL MISMATCH   → NOT_SAFE            │
   │     any CRITICAL UNAVAILABLE → MANUAL_REQUIRED    │
   │     any WARNING MISMATCH    → REVIEW              │
   │     else                    → SAFE                │
   └──────────────────────────────────────────────────┘
```

The MANUAL_PASS override lives on a separate route:

```
POST /api/qc-manual-pass-override
  → validateManualPassOverride({ body, user })
     ├─ session must exist
     ├─ priorVerdict must be MANUAL_REQUIRED
     ├─ reason ≥ 10 chars, evidence non-empty
     └─ compare block hashed → override.compare_hash
  → saveQcRecord(record)              // qc_result: 'MANUAL_PASS'
```

---

## Increment log

| # | Deliverable | Files | Tests |
|---|---|---|---|
| **1** | Verdict enum + `MANUAL_PASS` seal | `src/qc-dashboard/verdict-engine.js`, `public/qc-hub/app.js` | `qc-dashboard-i1-pass-gate.test.mjs` (5) |
| **2** | Per-brand preflight (READY / AUTH_EXPIRED / CONFIG_MISSING / BO_UNREACHABLE / PARTIAL_DATA) | `src/qc-dashboard/preflight.js` | `qc-dashboard-preflight.test.mjs` (12) |
| **3** | Expected-source resolution — bundle > request, exact match only | `src/qc-dashboard/expected-source.js` | `qc-dashboard-expected-source.test.mjs` (9) |
| **4** | Canonical model + per-platform live adapters (QPRO / QP2 / IGMP) | `src/qc-dashboard/canonical/` | `qc-dashboard-canonical.test.mjs` (14) |
| **5** | Deterministic compare engine (Sentinel-rule port) | `src/qc-dashboard/compare-engine.js` | `qc-dashboard-compare-engine.test.mjs` (17) |
| **6** | Wire compare into `/api/run-qc` + UI Expected-vs-Live table + Handle input | `bin/qc-dashboard.mjs`, `src/qc-dashboard/compare-flow.js`, `src/qc-dashboard/run-qc-request.js`, `public/qc-hub/index.html`, `public/qc-hub/app.js`, `public/qc-hub/styles.css` | `qc-dashboard-compare-flow.test.mjs` (12), `qc-dashboard-run-qc-request.test.mjs` extended (+3) |
| **7** | Audit record extension + `MANUAL_PASS` override endpoint + modal (D5) | `src/qc-dashboard/manual-pass.js`, `src/qc-dashboard/qc-log.js`, `bin/qc-dashboard.mjs`, `public/qc-hub/index.html`, `public/qc-hub/styles.css`, `public/qc-hub/app.js` | `qc-dashboard-manual-pass.test.mjs` (11) |
| **8** | MVP-only rollout gate; pinning test | `test/qc-dashboard-mvp-gate.test.mjs` | 4 |
| **9** | This doc + full-suite run | `docs/plans/qc-hub-real-qc-upgrade.md` | (all 260 passing) |

Final: **260/260 tests pass.**

---

## Invariants pinned in code + tests

1. **`computeVerdict` cannot emit `MANUAL_PASS`.** `verdict-engine.js#_sealed()` throws on any accidental attempt. Test: `qc-dashboard-verdict-engine.test.mjs`.
2. **Pass button gate is auto-SAFE only.** `public/qc-hub/app.js` uses `data.verdict !== 'SAFE'`. Static test forbids any string within 120 chars that would re-enable Pass for `MANUAL_REQUIRED`. Test: `qc-dashboard-i1-pass-gate.test.mjs`.
3. **MANUAL_PASS override requires prior verdict `MANUAL_REQUIRED`.** Server-side rejection of any other prior verdict. Test: `qc-dashboard-manual-pass.test.mjs` "rejects when priorVerdict != MANUAL_REQUIRED".
4. **Checker identity comes from the session, not the request body.** Any spoofed `checked_by`/`overridden_by` field is ignored. Test: same file, "checker identity comes from user.email".
5. **Compare engine runs only for MVP brands.** `runComparison()` invocation is inside `if (isMvpBrand)`; MVP set is derived from `qcRules.mvp === true`, not a hard-coded list. Test: `qc-dashboard-mvp-gate.test.mjs`.
6. **Handle input rejects free-text.** `^[A-Z]{1,3}\d{1,6}$` — a fat-fingered promo code cannot sneak in as a handle. Test: `qc-dashboard-run-qc-request.test.mjs`.
7. **Loose grep on approved requests is prohibited.** `resolveExpectedSource` returns `ambiguous` when multiple approved requests match, and the caller returns `MANUAL_REQUIRED`. Test: `qc-dashboard-compare-flow.test.mjs`.
8. **No filesystem paths leak in adapter error messages.** `_safeMessage()` scrubs `C:\Users\...`, `/var/...`, `/etc/...`, `/opt/...`, `/home/...`. Test: same file.
9. **`expectedSource` payload sent to the client never carries `sourcePath`.** `_publicExpectedSource()` whitelists exposed fields. Test: same file.

---

## Data & storage

* **Approved-request records** — `captures/requests/<handle>.json` (unchanged shape).
* **Canary bundles** — `captures/qc-bundles/<handle>__<brand>.json`. Compare flow prefers a bundle over a bare request record when both are present, because the bundle carries `live_state` and reflects the post-save reality.
* **Audit log** — `captures/qc-dashboard/qc-log.jsonl`. New optional fields: `compare` (full block), `override` (`{prior_verdict, reason, evidence, overridden_by, overridden_at, compare_hash}`).
* **Sheet** — unchanged 24-column layout. `qc_result` column shows `MANUAL_PASS` for overrides; reason lands in `Description`, evidence in `Evidence Link`.

Nothing in `captures/`, `logs/`, `tmp/`, or `*.local.json` was modified.

---

## Security posture

* **Auth** unchanged — Google OAuth + admitted-users allowlist + HMAC session cookie. No new public endpoints; every new route (`GET /api/preflight`, `POST /api/qc-manual-pass-override`) requires a session via `requireSession`.
* **IGMP session cookies** live only in `.local.json` files; the fetch path uses them, the API response never returns them, the UI never asks for them.
* **No AI in the PASS decision path.** The compare engine is pure JS with no network I/O.
* **No new duplicate registries.** Brand config still comes from `data/qc-dashboard-brands.json`. Site config still comes from `data/bo-sites.json` + `data/bo-sites-runtime.json` overlay (R18-lite, unchanged).

---

## Open items / follow-ups (post-approval)

* Sheet header widening — add dedicated columns for `Compare Verdict`, `Override Reason`, `Override Checker`, `Compare Hash`. Deferred so existing installs don't need a migration.
* Compare-engine currently skips fields for FS `spinCount` / `valuePerSpin` on IGMP (the API doesn't return them). Consider layering a per-platform "expected UNAVAILABLE" list so the field renders as `SKIPPED (platform limitation)` instead of `UNAVAILABLE`.
* Live-BO smoke: run through QP2A + QPRO1 + QPRO5 + WS1_MY end-to-end against a known-good promo (e.g. `FT_RET_CRM_REL_100FS_GOO_AUG`) before flipping to production.

---

## Verification

```bash
npm test           # 260 / 260 passing
```

No commits pending — user will authorize when smoke passes.
