# QP2 promotion PUT — auto-preserve dialog popups + SMS/MT links at the choke point

**Approved by:** Wai Yip, 2026-07-18
**Incident:** WHALE_VM_PROBE_NODEP_FC118_20X (promo 1380) + FC138 (promo 1381) on QP2 lost all
`dialog_popup_list` links sometime after the 2026-07-10 save. Restored 2026-07-18 via
`bin/relink-qp2-dialogs.mjs` from the popup registry. FC138's wipe was flagged by brand-watch on
2026-07-14 (`popup-missing`, all 4 brand views, logged) but sat unactioned; FC118 was never flagged
(wiped after the last 5pm run, and the existing check only fires at count zero anyway).

## Root cause

The QP2 BO replaces the whole promotion record on `PUT /api/bo/promotion/{id}`. The mapper's
`buildUpdate()` (src/api-mapper-qp2.js, ~line 1025) emits `dialog_popup_list: []` whenever no
`dialogPopup` arg is passed, and hardcodes `message_template_sms_id: 0` unless the caller passes the
current value. So **any** fix script doing `plan.buildUpdate(...)` + `updatePromotion(...)` without
first re-fetching the dialog list (which only the LISTING endpoint exposes — the detail endpoint
omits it) silently wipes every linked popup and the SMS link.

Existing mitigations, and why they failed:
- `src/qp2-safe-update.js` (`safePromoUpdate`) solves this correctly but is opt-in — **zero importers**.
- `readDialogForPreservation()` (src/api-client.js:548) preserves only `dialog_popup_list[0]` — a
  single link. QP2 promos carry one link per merchant (up to 4), so it is inadequate for QP2.
- brand-watch's `checkDialogPopupPresence` (src/structural-checks.js:87) fires only when
  `dialogPopupCount === 0` — blind to partial coverage (e.g. 1 of 4 merchant links surviving),
  and daily cadence means up to a 24h detection gap.

~90 scripts call `updatePromotion` directly (bin/ + bin/_archive). Opt-in safety loses; the
guarantee must live inside `updatePromotion` itself.

## Phase 1 — harden `updatePromotion` (src/api-client.js)

New signature (default-on preservation; **the default changing IS the fix**):

```js
export async function updatePromotion(site, promotionId, body, { preserve = true } = {})
```

Behavior:
1. Resolve the site config the same way `authedFetch` does (the module's internal site map).
   If `site.platform !== 'qp2'` (see the `site.platform || 'qp2'` pattern at src/api-client.js:93 —
   note that default; resolve the platform from the actual config entry, and treat only real QP2
   sites as QP2) **or** `preserve === false` → send the PUT exactly as today, zero extra fetches.
   QPRO is explicitly out of scope this pass (different list shape / PUT semantics; follow-up).
2. Otherwise run preservation before the PUT:
   - **Dialog links.** Consider `body.dialog_popup_list` "real" only if it is a non-empty array or
     non-empty object whose entries carry a popup identity (`id` or `popup_id`). A placeholder like
     `{ "0": { promotion_id } }` is NOT real. If not real:
     GET detail `/api/bo/promotion/{promotionId}` → `code` (skip if `body.code` present, but the
     detail fetch is needed for SMS/MT preservation anyway — fetch it once and reuse).
     GET listing `/api/bo/promotion?code=<code>&perPage=10` → row with `id === promotionId` →
     `dialog_popup_list`. If empty → nothing to preserve, proceed unchanged. Else GET
     `/api/bo/popups?perPage=500&page=1&sort_by=id&sort_order=desc` once and build
     `{ "0": { ...fullPopupRow, promotion_id }, "1": ... }` for **every** link (fall back to
     spreading the join-row when a popup id isn't in the page, same as `safePromoUpdate` does).
     Set it on the body. Log one line: `↺ updatePromotion: preserved N dialog link(s) for <code>`.
   - **SMS link.** If `body.message_template_sms_id` is 0/null/undefined and the detail shows a
     non-zero value → carry the live value through (log it).
   - **Inbox MT link.** Same rule for `message_template_id`.
   - A caller-supplied non-zero/real value always wins — preservation only fills accidental holes.
3. Any fetch failure inside the guard → **throw** with a clear message. Never fall through to an
   unprotected PUT.

Also:
- Extract the preservation logic as an exported helper (e.g. `preserveQp2PutFields(site,
  promotionId, body)` returning what it preserved) so it can be exercised read-only in verification.
- Refactor `src/qp2-safe-update.js` to delegate its preservation steps to the shared helper
  (keep its exported API and its `merchant_ids` handling unchanged) so the logic exists once.
- Existing callers keep working unmodified: canary/relink/extend paths pass real dialog lists and
  non-zero MT ids → guard no-ops for them. Do NOT edit the ~90 call sites.

## Phase 2 — coverage-aware detection (src/live-codes.js + src/structural-checks.js)

1. `src/live-codes.js` (~line 106): alongside `dialogPopupCount`, carry
   `dialogPopupLinks: (r.dialog_popup_list || []).map(d => ({ site_id: d.site_id, popup_id: d.popup_id }))`
   and `merchantIds: (r.merchant_ids || []).map(m => (typeof m === 'object' ? m.id : m))`.
2. `checkDialogPopupPresence` (src/structural-checks.js:87): keep the existing zero-count WARNING.
   Add, for candidates that have both `merchantIds` and `dialogPopupLinks` (QP2 rows):
   - **popup-coverage** WARNING when some merchant id has no link with a matching `site_id`
     (QP2 merchant ids equal popup site_ids 1–4, see QP2_BRAND_TO_IDS in src/api-mapper-qp2.js:289).
     Message must name the uncovered site ids.
   - **popup-stale-link** WARNING when the popup registry (`getPopups(code)` from
     `src/qp2-popup-registry.js`) has an entry for a site whose live `popup_id` differs.
     Only when the registry has entries for that code; tolerate a missing registry file.
3. No changes to bin/brand-watch.mjs expected — candidates flow through `fetchAllLiveCodes` →
   `runListingChecks`. Confirm that path and keep it that way if possible.
4. Rollout note (operator step, not code): first `--commit` run after this lands must use the
   existing `--absorb-new-checks` flag (bin/brand-watch.mjs:72-76) so legacy partial-coverage
   findings are grandfathered into held state instead of flooding the log.

## Phase 3 — team memory rule

Write `memory/feedback_qp2_put_auto_preserve.md` (follow the existing frontmatter format used by
files in memory/), content along these lines:

> QP2 promotion PUTs now auto-preserve `dialog_popup_list`, `message_template_sms_id`, and
> `message_template_id` inside `updatePromotion()` (default `preserve: true`). Never hand-build a
> QP2 promotion PUT that deliberately clears these without passing `{ preserve: false }` — and if
> you pass it, say why in the script. For one-field fixes prefer `safePromoUpdate()`
> (src/qp2-safe-update.js). Context: FC118/FC138 popup wipe incident, 2026-07-18. QPRO is NOT
> covered by this guard.

Add the one-line index entry to `memory/MEMORY.md` under "QP2 Rules & Dialogs".

## Acceptance criteria

- `node --check` passes on every touched file.
- `updatePromotion` with `preserve: false` byte-identical behavior to today (zero extra fetches).
- Guard is a no-op (no body mutation) when the body already carries a real dialog list AND non-zero
  MT/SMS ids, and for non-QP2 sites.
- Placeholder/empty dialog shapes (`[]`, `{}`, `{0:{promotion_id}}`) trigger preservation.
- `safePromoUpdate` still exports the same API and passes `node --check`.
- New check functions return findings in the exact shape of existing ones (severity/check/message).
- Memory file + MEMORY.md index line written.

## Verification split

**Codex (static only — NO live BO calls, no network):** `node --check` on all touched files; show a
short self-review of the guard's trigger conditions against the acceptance criteria.

**Reviewer (Claude, post-review — live, read-only then one probe write):**
1. `node bin/relink-qp2-dialogs.mjs P062-r63` dry-run still works (explicit-list path untouched).
2. Read-only run of the exported preserve helper against promo 1380 → expect 4 links resolved.
3. One live no-op PUT through the new guard on WHALE_VM_PROBE_NODEP_FC118_20X (an internal probe
   promo that exists for this purpose) with a `buildUpdate()` body that omits the dialog list →
   verify all 4 links survive. Registry + relink script stand by as instant rollback.
4. `node bin/brand-watch.mjs` dry-run (no --commit) → new checks run clean on the probes; note
   how many legacy popup-coverage findings would surface (informs the --absorb-new-checks run).

## Safety constraints

- Do not commit, push, or perform any live BO write. No network calls at all.
- Do not touch `captures/`, `*.local.json`, or anything in `bin/_archive/`.
- Do not modify the ~90 updatePromotion call sites; the fix is inside the client.
- Keep preservation default-ON. That existing callers get new behavior is the point of the change.
