---
name: Promo code automation — end-to-end flow
description: How the BO promo-code creation pipeline is wired today. Use this to pick up the project mid-stream without re-reading the whole conversation.
type: project
originSessionId: c236a820-16a6-4fdc-819b-36f0ab19fa3d
---
The system at `C:\Users\vdiuser\Downloads\promo-automation\promo-automation\` automates promo code setup across two platforms (QP2 and QPRO) by reading the Promo Code Request Details Template spreadsheet, generating a step-by-step BO Config Plan, and driving Playwright to fill the Create Promotion Code form.

**Why:** Replace the manual workflow (operator types every field in every BO for every request). Today's run-rate is dozens of promo requests per week across 23 merchants.

**How to apply:** When the user asks about "the bot", "the canary", "the dry-run", "the plan", "the ingest", or refers to `P###` request numbers, they mean this system. Read the current state below before suggesting changes.

---

## What works end-to-end as of 2026-05-14 (afternoon session)

| Brand | Merchant | Deposit | Free Credit | Free Spin | Notes |
|---|---|---|---|---|---|
| **QPRO11** | MSB66 | ✅ V_id=140 | ✅ V_id=141 + TEST_QPRO11_FIX_<ts> | ✅ TEST_FS_V23 | promo_testbot. Reference QPRO brand. |
| QPRO7 | MBS66 | ✅ smoke | 🟢 | 🟢 | Cross-QPRO smoke (Deposit only). |
| QPRO1, 2–6, 8–10, 12–19 | various | 🟢 framework | 🟢 framework | 🟢 framework | Untested per brand. Same mapper as QPRO11/7 — expected to work. |
| **QP2A** | IBC22 | ✅ TEST_QP2A_REL_50PCT_3X_V31 | ✅ TEST_QP2A_VIP_30FC_5X_V1 | ✅ TEST_QP2A_FS_50SPIN_20X_V1 | Reference QP2 merchant. promo_testbot. |
| **QP2B** | KING333 | ✅ TEST_QP2B_REL_50PCT_3X_V1 | ✅ TEST_QP2B_VIP_30FC_5X_V1 (Edit modal soft fails — see Open Issues) | ✅ TEST_QP2B_FS_50SPIN_20X_V1 | Cross-merchant smoke. |
| **QP2C** | ACE66 | ✅ TEST_QP2C_REL_50PCT_3X_V1 | ✅ TEST_QP2C_VIP_30FC_5X_V1 | ✅ TEST_QP2C_FS_50SPIN_20X_V1 | All three verified 2026-05-15. GP open had a race condition (retry on transient timing failures). |
| **QP2D** | SPADE66 | ✅ TEST_QP2D_REL_50PCT_3X_V1 | ✅ TEST_QP2D_VIP_30FC_5X_V1 | ✅ TEST_QP2D_FS_50SPIN_20X_V1 | All three verified 2026-05-15. **Operator rule:** allow_deposit must stay OFF; use Deposit Status = Last Deposit when deposit required ([feedback_qp2d_allow_deposit_off.md](feedback_qp2d_allow_deposit_off.md)) — NOT YET IN MAPPER. |
| WS1 (MB8) | — | — | — | — | BIA platform — not in scope. |
| WS2 (RWS77) | — | — | — | — | BIA platform — not in scope. |

**Cashback:** still blocked — no authored T&Cs. Mapper emits `OPERATOR TURN — Cashback Message Template (manual)` handoff for all platforms.

**Cross-cutting pipeline coverage** (verified on ≥1 QPRO + ≥2 QP2 merchants):

| Stage | Status |
|---|---|
| Login + Create form open | ✅ |
| ~30-field main form fill | ✅ |
| Merchant kt-dropdown pick (QP2 only) | ✅ all 4 merchants |
| Member Group grp-title click + Shadowban exclusion | ✅ |
| Categories Layer-1 inverted exclusions | ✅ |
| Game Providers Layer-1 inverted exclusions | ✅ (all bonus types incl. FS) |
| Free Spin Games auto-click (Provider + Game) | ✅ |
| Reset Frequency radio (`recurring=true`) | ✅ |
| Currency popup inner fill + force-click Submit | ✅ |
| Auto-Submit main form | ✅ HTTP 200 |
| Idempotency check | ✅ |
| 6.6 Message Template — QPRO Create flow | ✅ |
| 6.6 Message Template — QP2 Duplicate flow + pressSequentially | ✅ |
| Locale-tab walk (3 tabs QPRO / 6 tabs QP2) | ✅ |
| Subject + CKEditor body fill | ✅ |
| Post-save Promotion Names rows | ✅ |
| Edit modal Message link + Submit | ✅ (intermittent on QP2B FC) |

**Known limitations / open follow-ups:**

1. **FS Categories Slots-only on QP2** — `multiselect` handler's `:text-is("SLOTS")` doesn't match QP2's panel options even though the panel CONTAINS "SLOTS" (trigger after Select-All shows "...SLOTS..."). Probable cause: nested label markup or hidden whitespace. **Current behavior:** FS uses same Layer-1 inverted exclusions as Deposit (all categories minus 4). Operator manually trims to Slots-only post-save. Needs a focused panel-DOM probe + tighter handler.

2. **FS Game Providers single-provider rule on QP2** — QP2A auto-populates `game_provider_codes` via Angular watcher when FS Games Provider commits; QP2B/C/D don't. **Current behavior:** FS uses Layer-1 inverted exclusions like Deposit on all QP2 merchants. Operator manually trims to single provider post-save.

3. **QP2B FC Edit-modal post-Names** — intermittent soft fails on Close Names popup / Link Message Template / final Submit. Promo + 6.6 + Names rows DO save; just needs Message Template link manually picked in BO. QP2A FC's Edit modal completes cleanly. Race-condition / timing-sensitive.

4. **Non-VIP FC subject convention** — defaulted to `Exclusive Offer - {amount} Free Credit` in the renderer. Operator hasn't confirmed convention.

5. **TH locale body files** — not yet authored. Renderer skips TH tabs silently.

6. **Cross-currency** — fixtures used MYR-only. Multi-currency (MYR + SGD + IDR) untested per-merchant.

**End-to-end pipeline working steps**:
1. Login → Create form → all ~30 field-fill actions (text, number, checkbox, multi-select, radio with native DOM click)
2. **Auto-Submit** with 5s preview pause + idempotency check (no operator click required)
3. **6.6 Message Template** — navigates to `/superuser/message-template`, fills Section/Type/Name, walks every locale tab on the dialog (MY_EN, MY_ZH, US_EN), fills Subject + injects body HTML into CKEditor, clicks Submit
4. **Post-save Promotion Names** — walks each request locale, adds row per-locale (currency + locale + name + rewards_name), **dismisses the "Successfully created" System Message dialog between rows**, skips locale rows for currencies the brand doesn't offer
5. **Outer Edit Promotion Code modal Submit** — commits the edit

## Pipeline, stage by stage

```
Promo Code Request Details Template (Google Sheet)
        │   gid=890804133 = May 2026 tab (current month — user rule: always use current month tab)
        │   ⚠ Drive `read_file_content` truncates at ~192 KB; full sheet is ~978 KB.
        │     XLSX export is the reliable source. Parser still reads truncated markdown today.
        ▼
bin/ingest-requests.js  →  captures/requests/P###-r<line>.json   (one per row, unique handle)
        │   ⚠ Currently hard-codes column 3 = "Request Number". Mar/Apr/May tabs added a
        │     "Banner Needed" column at pos 3 so the row's Request Number moved to col 4.
        │     Parser silently drops those rows. Fix on todo list.
        ▼
bin/sync-promo-codes.js  →  captures/bo-codes/<site>-<merchant>.json   (live BO state)
        │   Updated to capture promo_type code (2=Deposit, 3=FC, 4=FS)
        ▼
bin/dry-run.js <handle>  OR  bin/dry-run-all.js
        │   Resolves "duplicate this code" references against both request log + BO snapshot
        │   Produces step-by-step BO Config Plan markdown
        ▼
bin/canary-write.js <handle> --commit
        │   Live mode — opens a headed Playwright browser
        │   SAFE_BRANDS: all QPRO1–19 unrestricted, QP2A–D gated by TEST_ prefix
        │   Platform-aware dispatch: QPRO → bo-mapper-qpro.js, QP2 → bo-mapper-qp2.js
        │   Auto-Submits with 5s countdown + idempotency check
        ▼
src/dashboard.js  →  POST status=QC_Required to Apps Script web app
            ⚠ Requires patch from docs/APPS-SCRIPT-PATCH.md pasted into the Apps Script editor
              + redeploy. As of last check the patch had NOT been deployed.
```

## BO inventory

- **Platform `qp2`** — single BO at `ibc22.qtp777.com`, four merchants: IBC22 (QP2A), KING333 (QP2B), ACE66 (QP2C), SPADE66 (QP2D). Service account `promo_testbot`. Shared `reqSignKey`.
- **Platform `qpro`** — 19 separate BOs at `qpro<N>bo.mei707.com` (QPRO1 is at the bare `bo.mei707.com`). One brand per BO. **QPRO11 now uses `promo_testbot`** (was jascinta); QPRO1 uses promo_testbot too; QPRO2–10, 12–19 use jascinta. Same login mechanism as QP2 — same endpoint, same AES-CBC password scheme, same reqSignKey.

Passwords live in `bo-sites.local.json` (gitignored), keyed by username — sites reference by `username` and the password is merged in at load time.

## What the canary actually does

Confirmed end-to-end on QPRO11 + QPRO7 for Deposit, and QPRO11 for Free Credit:

1. Login → navigate to `/general/promotion-codes` → click Create.
2. Fill all text/number fields: code, name, validity, reward_validity, bonus_rate (Deposit only), multiplier, max_per_player, daily_max.
3. Pick all native single-select dropdowns: promo_type, promo_sub_type, kyc_type, frequency_type, eligible_types, recurring, status.
4. Tick all checkboxes: limit_transfer_in, limit_transfer_out, auto_unlock, last_deposit (for deposit-required), auto_approve, restrict_claim_round_active (FS only).
5. Set Transfer Amount radios via **native DOM click + input/change event dispatch** (Playwright's `check()` and `click({ force: true })` don't trigger Angular's form binding for these custom radios).
6. Multi-pick: KYC tiers (Basic/Advanced/Pro for Deposit/FS; Pro only for Free Credit).
7. Multi-pick: Categories (uppercase). Layer-1 exclusions: ARCADE, COCK FIGHT, LOTTERY, TABLE.
8. Multi-pick: Member Group = `Normal` (QP2 only; QPRO skips).
9. Multi-pick-inverted: Game Providers = Select All then un-tick 9 Layer-1 exclusions (`918KISS, 918KAYA, ALLBET, EKOR, HABANERO, KINGMIDAS, MEGA888, DG, SSG`). Skipped for Free Spin (uses dedicated FS Games picker instead).
10. **For Free Spin: 2 cascading dropdowns "Free Spin Games" (Provider + Game)** — these are `kt-dropdown-wo-lazyload` custom Angular components, NOT native selects. **Currently operator handoff** — auto-pick attempts registered visually but didn't commit to Angular form. Implementation kept in `kt_dropdown_pick` action kind for future debug.
11. Reset Frequency radio → Daily Max (only for recurring promos; hidden for one-time).
12. Open Currency popup → click "+ Add" → fill INNER Create Promotion Currency form (per-bonus-type fields, see table below) → Submit → dismiss System Message → close popup.
13. Auto-Submit on main form with 5s countdown + idempotency check + form-save flag.
14. Post-save: navigate to list, search by Promotion text filter, click row → Edit modal opens → click "+ Promotion Names" → for each locale: click +Add → pick currency_id / settings_locale_id → type promotion_name / rewards_name → Submit → dismiss System Message → next locale.
15. Click Submit on the outer Edit Promotion Code modal.
16. POST status=QC to dashboard.

## Per-bonus-type Currency popup map (CONFIRMED via raw API probe)

The popup_fill_currency handler is **field-agnostic** — iterates row keys and fills whatever `formcontrolname` matches, silently skips unknown.

| Bonus | QPRO row fields | QP2 row fields |
|---|---|---|
| Deposit | `min_transfer`, `max_bonus`, `max_transfer_out`, `max_total_applications=0`, `max_total_bonus=0`, `max_total_amount=0`, `max_balance_claim=0` | `bonus_type='Percentage'`, `max_withdraw_type='Fixed Amount'`, `min_deposit`, `min_transfer`, `max_bonus`, **`bonus_rate`** (per-currency on QP2!), `max_withdraw` |
| Free Credit | `free_credit_amount`, `bonus_amount` (alias), `max_transfer_out`, `min_transfer`, `max_balance_claim=0`, `max_total_*=0` | **`max_withdraw_type='Fixed Amount'`** (required select, added 2026-05-14), `bonus_amount` (NOT free_credit_amount), `bonus_rate=0`, `max_withdraw`, `min_deposit`. `bonus_type` defaults to "Fixed Amount" in dialog (no mapper override needed). |
| Free Spin | `min_transfer`, `rounds`, `total_rounds` (alias), `amount_per_line = value_per_spin/20`, `lines=10`, `coins=1`, `bonus_amount=0`, `bonus_rate=0` | **`max_withdraw_type='Fixed Amount'`** (required select, added 2026-05-14), `min_deposit`, `rounds`, `amount_per_line`, **`lines=0`, `coins=0`** (operator saved-record values; dialog defaults are 10/1 but operator overrides to 0/0), `bonus_rate=0`. **No `bonus_type` field on FS** (confirmed via saved-record `bonus_type: null`). |

**House conventions** (operator rule 2026-05-13):
- FS: `lines=10`, `coins=1` FIXED. `amount_per_line = value_per_spin / 20` (divisor 20 is constant, independent of `lines`). value_per_spin=0.20 → amount_per_line=0.01.
- Cashback Message Template: skipped (no authored T&Cs yet); falls back to operator handoff.

## Critical constants

- **Layer 1 game-provider exclusions** (all platforms): `918KISS, 918KAYA, ALLBET, EKOR, HABANERO, KINGMIDAS, MEGA888, DG, SSG`.
- **Layer 1 category exclusions** (all platforms): `ARCADE, COCK FIGHT, LOTTERY, TABLE`.
- **Frequency default**: `Daily Max`.
- **`reqSignKey` (shared)**: not stable enough to hardcode in memory — grep the live QPRO frontend bundle (`main.<hash>.js`) for `reqSignKey` to get the current value. (A stale copy of this was previously committed here in plaintext; removed 2026-08-10 as part of a credential-leak cleanup — treat any old value as compromised.)
- **Locale → currency mapping**: MY→MYR, SG→SGD, ID→IDR, TH→THB, KH→KHR, AU→AUD.
- **Promo Sub-Type options** (QPRO): Deposit→Welcome/Reload; Free Credit→Free Credit; Free Spin→Welcome/Reload (NOT "Free Spin").

## 6.6 Message Template authoring

- **Source-of-truth Drive folder** `1HfsKwXAq7ryLVT2XayEJ9Q4UfQmXMWa-` — EN/ZH/TH/ID Inbox T&C docs for QPRO/QPLY. Pulled to `captures/inbox-tc-master/`.
- **6 authored body files** at `src/message-template-bodies/{deposit,free-credit,free-spin}/{EN,ZH}.html` (3 bonus types × 2 locales). TH + ID not yet authored.
- **Per-locale T&Cs** as authored — no footer 11.1–11.18 (operator rule "ignore footer").
- **Placeholders**: `{{currency_symbol}}`, `{{min_deposit}}`, `{{bonus_pct}}`, `{{max_bonus}}`, `{{turnover}}`, `{{turnover_words}}`, `{{bonus_amount_example}}`, `{{total_received_example}}`, `{{turnover_requirement_example}}`, `{{validity_days}}`, `{{validity_days_words}}`, `{{rewards_validity_days}}`, `{{rewards_validity_days_words}}`, `{{eligible_categories}}`, `{{spin_count}}`, `{{game_provider}}`, `{{game_name}}`, `{{transfer_amount}}`, `{{max_transfer_out}}`, `{{promotion_name_en}}`, `{{bonus_sub_type}}`, `{{bonus_sub_type_zh}}`.
- **Conditionals**: `{{#if_min_deposit}}…{{else}}…{{/if}}` (FC/FS no-deposit cases); `{{#if_turnover_plural}}s{{/if}}` (time/times); `{{#if_validity_days_plural}}s{{/if}}`; `{{#if_rewards_validity_days_plural}}s{{/if}}` (day/days).
- **Locale-aware Categories** — EN: "Slot, Live Casino, and Fishing"; ZH: "老虎机、真人娱乐场、捕鱼" (Chinese list comma "、"); TH/ID: comma-joined translated names; empty list → "All" / "所有" / "ทั้งหมด" / "Semua".
- **`:brandname`/`:merchantname`/`:url`** stay LITERAL in the rendered output. The BO substitutes them at display time per brand. Renderer auto-swaps `:brandname` → `:merchantname` for `platform=qp2`.
- **Brand directory map** at `data/brand-directory.json` (19 QPRO + 4 QP2 → displayName + website). Per operator note: QPRO11 + QPRO13 + QPRO14 are "Not Live yet" with placeholder URLs.

## Operator interaction model (current — afternoon 2026-05-13)

Only ONE manual handoff remains for QPRO:
- **Free Spin Games — operator picks the 2 cascading dropdowns** (Provider + Game). Bot prints prompt with the expected values from the request (game_provider + game), operator picks in browser, types `next`. After this, bot continues to Currency popup, auto-Submit, 6.6 template, Names rows, outer Edit Submit — all automated.

For Deposit + Free Credit: ZERO manual handoffs once you've kicked off the canary.

For Cashback: bot emits an `OPERATOR TURN — Cashback Message Template (manual)` handoff (no authored T&Cs yet).

For QP2 brands: mapper rewritten but NOT live-verified. Expect 3–5 debug iterations.

## Current open work (highest leverage first)

1. **Unblock Free Spin Currency popup** — last ~12 runs all failed at the inner Create Promotion Currency form's Submit click (5s timeout). Hypothesis: an FS-specific required `formcontrolname` on the inner form doesn't match what the mapper emits. **MUST PROBE BEFORE NEXT ATTEMPT.** Build a probe that opens the inner Add form (after clicking "+ Promotion Currency" then "+ Add") and dumps every field's formcontrolname. Then update QPRO FS currency row config.
2. **Live-test QP2A** with TEST_-prefix code — exercise the rewritten qp2 mapper. Expect divergences from QPRO (39 vs 22 currency-row fields, single-target-row, new_target_type radios, etc.).
3. **FS Games auto-pick** — currently operator handoff. `kt_dropdown_pick` action kind exists but the clicks don't commit to Angular's form. Probably needs custom event dispatch (input/change). Lower priority once probe identifies the FS Currency popup root cause.
4. **Author TH + ID message-template bodies** when a brand needs those locale tabs.
5. **Cashback message templates** — need T&C source from operator.
6. **Fix ingest to read XLSX directly + handle the Banner-Needed column-shift layout** — still misses Mar/Apr/May 2026 rows.
7. **Deploy the Apps Script patch** (`docs/APPS-SCRIPT-PATCH.md`).
8. **Idempotency check** before Submit already works for QPRO (BO snapshot); verify behaves correctly on QP2.

## Files at the heart of it (skim these first)

- `bin/canary-write.js` — auto-Submit, idempotency, form-save flag, Names+Currency popups with System Message dismiss, Edit modal Submit, field-agnostic popup_fill_currency, kt_dropdown_pick handler (defined, currently unused)
- `src/bo-mapper-qpro.js` — per-bonus-type currency row builders, FS handoff for FS Games
- `src/bo-mapper-qp2.js` — rewritten from raw API probe, NOT live-verified
- `src/message-template-renderer.js` — body loader + scalar/conditional substitution + locale-aware category translation + platform-aware brand placeholder
- `src/message-template-bodies/{deposit,free-credit,free-spin}/{EN,ZH}.html` — 6 authored bodies
- `data/brand-directory.json` — 19 QPRO + 4 QP2 → displayName + website
- `captures/probe-fc-fs/` — raw API responses for FC + FS across QPRO11/QPRO7/IBC22 (reference data)
- `captures/inbox-tc-master/README.md` — pointers to EN/ZH/TH/ID Drive docs
- `captures/qpro11-fs-games-probe.json` — Free Spin Games DOM structure (main form, NOT the popup)
- `bo-sites.json` — 20 site entries; QPRO11 username = promo_testbot (updated 2026-05-13)
