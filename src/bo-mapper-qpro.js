// Translates a resolved promo request into an ordered list of UI actions
// for the QPRO BO Create Promotion Code form. The canary executor walks
// these in order. Each action is a plain object so it's both serializable
// (to the audit log) and easy to test.
//
// Step 1 scope (current): all TEXT/NUMBER fields, native single-select
// dropdowns, checkboxes, and the Target Type / Transfer Amount radios.
// Multi-selects (Currency, Categories, Game Providers, KYC tiers,
// Linked Promotions) and the three popups (Currency, Names, Blacklist)
// are deferred to Step 2 — for now the bot pauses and the operator
// handles them in the open browser window.

// Map BO promo_type integer codes to the option labels shown in the
// Create form's dropdown. Verified from the form spy + the
// /api/bo/promotion/<id> detail endpoint.
import { splitDualPromoName } from './promo-namer.js';

const PROMO_TYPE_LABEL = {
  'Deposit':     'Deposit',
  'Cashback':    'Deposit',      // Cashback is configured as a Deposit variant on QPRO
  'Free Credit': 'Free Credit',
  'Free Spin':   'Free Spin',
};

// Sub-types vary by parent. We pick the option whose label matches our
// resolved bonus_sub_type case-insensitively. The label list isn't known
// until the parent select is picked, so the executor reads it live.

// Frequency: 'Daily Max' is the QPRO default (the request's "recurring"
// flag covers one-time vs recurring; frequency_type is independent).
const FREQUENCY_LABEL = 'Daily Max';

// Member group / KYC default — these get refined when we wire multi-selects.
const KYC_TYPE_LABEL = 'KYC Status';

function asString(v) { return v == null ? '' : String(v); }

export function buildActions(resolved, { brand } = {}) {
  const r = resolved.parsed || {};
  const actions = [];

  const push = (action) => actions.push(action);
  const bt = (resolved.bonus_type || '').toLowerCase();
  const isFs  = bt.includes('free spin');
  const isFc  = bt.includes('free credit');
  const isDep = bt.includes('deposit') || bt.includes('cashback');

  // Per-RN operator instructions (parsed from remark + name_details).
  // See memory/project_request_instructions_parser.md.
  const instr = resolved.instructions || {};
  const effectivePromoCode = instr.code_name_override || resolved.promo_code;
  const effectiveRecurring = instr.multiple_claims_allowed === true ? true
                           : instr.one_time_claim === true        ? false
                           : resolved.recurring;

  // ── Basic Info: text fields ─────────────────────────────────────────
  push({ kind: 'text',   selector: 'input[formcontrolname="code"]',  value: effectivePromoCode,             label: 'Code' });
  push({ kind: 'text',   selector: 'input[formcontrolname="name"]',  value: splitDualPromoName(resolved.promotion_name_en).generic,     label: 'Name (display)' });

  // ── Basic Info: dropdowns (Type top + Sub) ──────────────────────────
  const topLabel = PROMO_TYPE_LABEL[resolved.bonus_type];
  if (topLabel) {
    push({ kind: 'select', selector: 'select[formcontrolname="promo_type"]', optionLabel: topLabel, label: 'Promo Type (top)', scope: 'form' });
    // The sub-type dropdown populates dynamically after picking the parent.
    // QPRO11 reliably takes ~1.5s to populate; give it 2.5s for safety.
    push({ kind: 'wait',   ms: 2500, label: 'wait for sub-type options to load' });
    if (resolved.bonus_sub_type) {
      push({ kind: 'select', selector: 'select[formcontrolname="promo_sub_type"]', optionLabel: resolved.bonus_sub_type, matchMode: 'icontains', label: 'Promo Sub-Type', scope: 'form' });
    }
  } else {
    push({ kind: 'handoff', label: `Pick "Promo Type" dropdown manually — unknown mapping for bonus_type="${resolved.bonus_type}"` });
  }

  // ── Free Spin Games (FS only — 2 cascading kt-dropdown components) ──
  // QPRO FS form renders 2 cascading kt-dropdown-wo-lazyload dropdowns
  // for Provider + Game. The kt_dropdown_pick handler in canary-write.js
  // now tries multiple click strategies (Playwright on <li>, native DOM
  // click via evaluate) and VERIFIES each by reading the trigger text
  // back. If no strategy commits, it throws — operator can still take
  // over manually after the throw.
  //
  // If the request didn't specify a game, fall back to operator handoff
  // (no point auto-picking a placeholder).
  if (isFs) {
    const gameProvider = r.game_provider || 'PP - Pragmatic Play';
    const gameName     = r.game          || null;
    if (!gameName) {
      push({
        kind: 'handoff',
        label: 'OPERATOR TURN — Free Spin Games (request did not specify game):',
        items: [
          `Pick the FIRST dropdown (Game Provider): ${gameProvider}`,
          `Pick the SECOND dropdown (Game): <not specified in request — pick manually>`,
          'Reply "next" when both are selected.',
        ],
      });
    } else {
      push({
        kind: 'kt_dropdown_pick',
        rowLabel: 'Free Spin Games',
        triggerNth: 0,
        optionLabel: gameProvider,
        matchMode: 'icontains',
        label: 'Free Spin Games → Provider',
      });
      // Game options populate AFTER the provider commits. Give Angular
      // ~1.5s to fetch & render before opening the Game dropdown.
      push({ kind: 'wait', ms: 1500, label: 'wait for FS Game options to populate' });
      push({
        kind: 'kt_dropdown_pick',
        rowLabel: 'Free Spin Games',
        triggerNth: 1,
        optionLabel: gameName,
        matchMode: 'icontains',
        label: 'Free Spin Games → Game',
      });
    }
  }

  // ── Bonus section: checkboxes + bonus_rate ──────────────────────────
  push({ kind: 'check', selector: 'input[formcontrolname="limit_transfer_in"]',  state: true,  label: 'Limit Transfer In' });
  push({ kind: 'check', selector: 'input[formcontrolname="limit_transfer_out"]', state: true,  label: 'Limit Transfer Out' });
  push({ kind: 'check', selector: 'input[formcontrolname="auto_unlock"]',        state: true,  label: 'Auto Unlock' });
  // Bonus Rate %: only meaningful for Deposit/Cashback. The field is
  // absent on FC and FS forms entirely, so we skip the action for those.
  if (isDep && r.bonus_rate_pct != null) {
    push({ kind: 'number', selector: 'input[formcontrolname="bonus_rate"]', value: r.bonus_rate_pct, label: 'Bonus Rate %' });
  }
  // restrict_claim_round_active is ON only for Free Spin per skill convention.
  push({ kind: 'check', selector: 'input[formcontrolname="restrict_claim_round_active"]', state: isFs, label: 'Restrict Claim If Bonus Round Active' });

  // ── KYC section ─────────────────────────────────────────────────────
  push({ kind: 'select', selector: 'select[formcontrolname="kyc_type"]', optionLabel: KYC_TYPE_LABEL, label: 'KYC Type', scope: 'form' });
  // KYC Status tiers — multi-select. Defaults differ by bonus type per the
  // QPRO skill: Deposit shows all three (Basic + Advanced + Pro); Free
  // Credit shows Pro only. Best-effort — operator should verify.
  const kycTiers = isFc ? ['Pro'] : ['Basic', 'Advanced', 'Pro'];
  push({ kind: 'multiselect', label: 'KYC Status', options: kycTiers });

  // ── Basic Setting: Valid From + dates + frequency ───────────────────
  // Valid From always = "now" per operator rule. QPRO accepts `YYYY-MM-DD HH:mm:ss`
  // (filled as text into the kt-datepicker input).
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const validFromStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  push({ kind: 'text',   selector: 'input[formcontrolname="valid_from"]',     value: validFromStr,                                                        label: 'Valid From (now)' });

  push({ kind: 'number', selector: 'input[formcontrolname="validity"]',        value: resolved.validity_days ?? 30,                                        label: 'Validity (days)' });
  push({ kind: 'number', selector: 'input[formcontrolname="reward_validity"]', value: resolved.rewards_validity_days ?? resolved.validity_days ?? 30,      label: 'Reward Validity' });
  push({ kind: 'select', selector: 'select[formcontrolname="frequency_type"]', optionLabel: FREQUENCY_LABEL, label: 'Frequency', scope: 'form' });

  // ── Categories multi-select ─────────────────────────────────────────
  // Operator rule: Categories must be filled BEFORE Game Providers because
  // Game Providers' options are filtered by the chosen Categories on QPRO.
  //
  // For FS: Slot ONLY (operator rule 2026-05-13). FS only applies to slot
  // games, so any other category would be inconsistent.
  // For other bonus types: Select All - Layer-1 exclusions (Arcade, Cock
  // Fight, Lottery, Table) per operator's Layer-1 doc.
  if (instr.category_only) {
    // Per-RN override (P084-89 pattern: "[SLOTS ONLY]" / "[LC ONLY]" /
    // "[Sports ONLY]"). Pass a few variants for panel-label casing.
    const c = instr.category_only;
    push({
      kind: 'multiselect',
      label: 'Categories',
      options: [c.toUpperCase(), c, c.toLowerCase()],
    });
  } else if (isFs) {
    push({
      kind: 'multiselect',
      label: 'Categories',
      options: ['SLOTS', 'Slots', 'Slot'],
    });
  } else {
    push({
      kind: 'multiselect_inverted',
      label: 'Categories',
      // QPRO panel labels are uppercase. Substring match handles minor
      // spelling variations between brands (COCK FIGHT vs COCKFIGHT).
      exclusions: ['ARCADE', 'COCK FIGHT', 'LOTTERY', 'TABLE'],
    });
  }

  // ── Game Providers multi-select ─────────────────────────────────────
  // For FS: ONLY the same provider as the FS Games Provider dropdown
  // (operator rule 2026-05-13 — "follow free spin games"). The FS Games
  // picker limits the promo to one game from one provider, so Game
  // Providers must mirror that single provider for consistency.
  // For other bonus types: Select All - Layer-1 exclusions.
  //
  // Note: canary V19 (2026-05-13) revealed that FS still requires the
  // `game_provider_ids` form control to be populated. The earlier
  // assumption that the FS Games picker covered this was wrong.
  if (isFs) {
    // r.game_provider is the FS Games Provider label like "PP2 - Pragmatic Play".
    // The Game Providers panel might use the full coded label, just the
    // tail name, or a variant ("Pragmatic Play 2"). The multiselect handler
    // does :text-is exact match, so we pass a few likely variants and let
    // it tick whichever one matches (others log warnings and continue).
    const fullLabel = r.game_provider || '';
    const tail = fullLabel.includes('-') ? fullLabel.split('-').slice(1).join('-').trim() : fullLabel;
    const code = fullLabel.includes('-') ? fullLabel.split('-')[0].trim() : '';
    // Build candidate set, de-dup, drop empties
    const candidates = [fullLabel, tail, code ? `${tail} ${code.replace(/\D/g, '')}`.trim() : ''].filter(Boolean);
    const dedup = Array.from(new Set(candidates));
    push({
      kind: 'multiselect',
      label: 'Game Providers',
      options: dedup,
    });
  } else {
    push({
      kind: 'multiselect_inverted',
      label: 'Game Providers',
      exclusions: ['918KISS', '918KAYA', 'ALLBET', 'EKOR', 'HABANERO', 'KINGMIDAS', 'MEGA888', 'DG', 'SSG'],
    });
  }

  // ── Target Amount: Turnover side ────────────────────────────────────
  // The form has TWO target rows: Turnover (top) and Winloss (below).
  // Both share the same `formcontrolname="type"` for their Transfer Amount
  // radio (Included/Excluded) within their respective FormGroup.
  //
  // In document order, the 4 radios appear as:
  //   nth=0  Turnover  Included
  //   nth=1  Turnover  Excluded
  //   nth=2  Winloss   Included
  //   nth=3  Winloss   Excluded
  // (Confirmed by form-state dump in canary run 6, 2026-05-13.)
  //
  // Earlier we tried XPath ancestor-row anchoring with `(.//span[…])[1]`
  // to pick the first/second Transfer Amount row, but Playwright/the
  // browser evaluated that wrong — the "first row's radios" ended up
  // pointing at the Winloss row. Flat document-order indexing is
  // unambiguous and avoids the XPath positional-selector quirk.
  if (r.to_multiplier != null) {
    push({ kind: 'number', selector: 'input[formcontrolname="multiplier"]', value: r.to_multiplier, nth: 0, label: 'Target Multiplier (Turnover)' });
  }
  push({
    kind: 'radio',
    selector: 'input[type="radio"][formcontrolname="type"]',
    nth: 0,  // Turnover Included
    label: 'Transfer Amount (Turnover) → Included',
  });

  // ── Target Amount: Winloss side ─────────────────────────────────────
  // Operator rule (2026-05-13): only ONE of (Turnover, Winloss) can be
  // Included. Since we set Turnover → Included above, Winloss MUST be
  // Excluded with multiplier=0. Categories + Game Providers on the
  // Winloss side are intentionally NOT configured — the form's
  // "required" validation relaxes those when Transfer Amount=Excluded.
  push({ kind: 'number', selector: 'input[formcontrolname="multiplier"]', value: 0, nth: 1, label: 'Target Multiplier (Winloss)' });
  push({
    kind: 'radio',
    selector: 'input[type="radio"][formcontrolname="type"]',
    nth: 3,  // Winloss Excluded
    label: 'Transfer Amount (Winloss) → Excluded',
  });

  // ── Eligibility section ─────────────────────────────────────────────
  push({ kind: 'select', selector: 'select[formcontrolname="eligible_types"]', optionLabel: 'Members', label: 'Eligible Types', scope: 'form' });
  // Member Group: NOT touched on QPRO (operator rule — that field is a QP2
  // concept only; QPRO leaves it at default). Re-introduce here if a QPRO
  // brand ever requires explicit member-group filtering.
  // push({ kind: 'multiselect', label: 'Member Group', options: ['Normal'] });
  push({ kind: 'check',  selector: 'input[formcontrolname="last_deposit"]', state: isDep || isFs, label: 'Last Deposit (ON for deposit-required)' });
  push({ kind: 'check',  selector: 'input[formcontrolname="auto_approve"]', state: true,          label: 'Auto Approve' });
  push({ kind: 'select', selector: 'select[formcontrolname="recurring"]',  optionLabel: effectiveRecurring === true ? 'Recurring' : 'One Time', label: 'Recurring', scope: 'form' });

  // Reset Frequency — radio set (Daily Max / Weekly Max / Monthly Max).
  // Required field for RECURRING promos. The form hides this radio set
  // entirely for one-time promos, so we conditionalize on `recurring`.
  if (effectiveRecurring === true) {
    push({
      kind: 'radio',
      selector: `xpath=.//span[contains(@class,'kt-font-bold') and contains(normalize-space(.), 'Reset Frequency')]/ancestor::div[contains(@class,'row')][1]//input[@type='radio']`,
      nth: 0,
      label: 'Reset Frequency → Daily Max',
    });
  }

  // Max Per Player Lifetime + Daily Max — defaults per skill
  push({ kind: 'number', selector: 'input[formcontrolname="max_per_player"]', value: 99999, label: 'Max Per Player (Lifetime)' });
  push({ kind: 'number', selector: 'input[formcontrolname="daily_max"]',      value: 1,     label: 'Daily Max' });

  // ── Status (within the form, last dropdown) ─────────────────────────
  // QPRO11's Status defaults to "Active" and the select is rendered disabled
  // when at the default value — selectOption('Active') times out trying to
  // change a disabled select. Skip the action since the default already
  // matches what we want. Re-enable if a future request needs Inactive.
  // push({ kind: 'select', selector: 'select[formcontrolname="status"]', optionLabel: 'Active', label: 'Status', scope: 'form' });

  // ── Pre-save Currency popup ─────────────────────────────────────────
  // QPRO Currency popup has 22 fields; the relevant ones differ by bonus
  // type (confirmed via raw API probe 2026-05-13 — see
  // captures/probe-fc-fs/qpro*-RAW-*.json):
  //   • Deposit: min_transfer (= min_deposit), max_bonus
  //   • Free Credit: free_credit_amount, max_transfer_out (withdrawal cap)
  //   • Free Spin: min_transfer (deposit gate), rounds (spin count),
  //                amount_per_line (value per spin per line), lines, coins
  // The popup_fill_currency handler is field-agnostic: it fills whatever
  // row keys it can find on the inner form, skipping silently for absent
  // ones. So we emit a row shape tailored to the bonus type.
  const r2 = resolved.parsed || {};
  const currencyRows = (resolved.currencies || ['MYR']).map((ccy) => {
    const override = resolved.per_currency_overrides?.[ccy] || {};
    const row = {
      currency: ccy,
      max_total_applications: 0,
      max_total_bonus:        0,
    };
    // max_balance_claim: required on QPRO Currency popup (UI label
    // "Max Balance Claim", default 0 = unlimited). Apply to every bonus
    // type — the field exists on the popup regardless.
    row.max_balance_claim = 0;
    // max_total_amount: alias for max_total_bonus on some popup variants
    // (QPRO FC's popup labels it "Max Total Amount"). The field-agnostic
    // handler fills whichever formcontrolname is present.
    row.max_total_amount = 0;
    row.max_total_bonus  = 0;
    if (isDep) {
      row.min_transfer     = override.min_deposit       ?? r2.min_deposit ?? 0;
      row.max_bonus        = override.max_bonus         ?? r2.max_bonus   ?? 0;
      row.max_transfer_out = override.max_transfer_out  ?? 0;
    } else if (isFc) {
      // The FC amount lives in `bonus_amount` per the popup label "Bonus
      // Amount". Some QPRO BO versions also accept `free_credit_amount`
      // (the API storage name). Emit both — handler picks whichever the
      // form exposes.
      const fcAmount = override.free_credit_amount ?? r2.free_credit_amount ?? 0;
      row.bonus_amount       = fcAmount;
      row.free_credit_amount = fcAmount;
      row.max_transfer_out   = override.max_transfer_out ?? r2.max_transfer_out ?? 0;
      row.min_transfer       = override.min_deposit      ?? r2.min_deposit      ?? 0;
    } else if (isFs) {
      // House convention (operator rule 2026-05-13):
      //   • lines = 10, coins = 1 (form constants, NOT changed by request)
      //   • amount_per_line = floor(value_per_spin / 20, 2dp)
      //     BO rejects sub-cent amounts: 0.50/20=0.025 → floor → 0.02.
      // Emit BOTH `rounds` and `total_rounds` as the popup's spin-count
      // formcontrolname differs across variants. Same for bonus_amount.
      //
      // FS inner Currency form (probed 2026-05-13 via
      // qpro-fs-currency-add-probe.js) requires `max_transfer_out` as
      // a *required* field — Submit stays disabled until it's filled.
      // Earlier runs missed this because the FC row had it but FS didn't.
      const apl             = override.amount_per_line ?? r2.amount_per_line ?? null;
      const valuePerSpinRaw = override.value_per_spin  ?? r2.value_per_spin  ?? 0;
      const spinCount       = override.spin_count      ?? r2.spin_count      ?? 0;
      row.min_transfer     = override.min_deposit       ?? r2.min_deposit       ?? 0;
      row.rounds           = spinCount;
      row.total_rounds     = spinCount;
      // If sheet stated amount_per_line directly, use it as-is.
      // If sheet stated value_per_spin: divide by 20 then floor to 2dp
      // so 0.50 → 0.025 → 0.02 (BO rejects 0.025).
      row.amount_per_line  = apl != null
        ? +Number(apl).toFixed(4)
        : Math.floor(valuePerSpinRaw / 20 * 100) / 100;
      row.lines            = 10;
      row.coins            = 1;
      row.bonus_amount     = 0;
      row.bonus_rate       = 0;
      row.max_transfer_out = override.max_transfer_out  ?? r2.max_transfer_out  ?? 0;
    }
    return row;
  });
  push({ kind: 'popup_fill_currency', rows: currencyRows });

  // ── Blacklist Template popup ────────────────────────────────────────
  // DROPPED per operator decision 2026-05-13. The bot used to open the
  // Blacklist popup and hand off to the operator for sub-game-type ticks,
  // but leaving the popup open as a modal was blocking the main-form
  // Submit click. Now the bot never opens the popup at all. The promo
  // saves with an empty blacklist; if a specific promo needs blacklist
  // ticks the operator opens + fills + submits the popup manually before
  // running the canary, or edits the saved code afterwards.

  // ── Auto-Submit ─────────────────────────────────────────────────────
  // Replaces the old operator handoff + notify_save pause. The canary
  // executor's auto_submit handler does:
  //   1. Compact config preview (1-screen, key fields)
  //   2. Idempotency check — refuse if `promo_code` already exists in the
  //      BO snapshot for this site+merchant.
  //   3. 5-second countdown so the operator can Ctrl+C to abort.
  //   4. Click Submit on the form.
  //   5. Wait for save confirmation (URL navigation, success toast, or row
  //      appearing in the list).
  push({ kind: 'auto_submit', label: 'Auto-Submit (5s preview + idempotency check)' });

  // ── Section 6.6 Message Template (conditional) ──────────────────────
  // Fires when the request asks for an in-product message and/or popup.
  // The canary handler renders the body via src/message-template-renderer.js
  // (loads src/message-template-bodies/<slug>/<docKey>.html, substitutes
  // placeholders, resolves :brandname / :url against data/brand-directory.json),
  // then pastes into the BO's CKEditor per locale tab.
  //
  // Cashback is intentionally skipped — no authored T&Cs yet. The mapper
  // omits the action so the canary doesn't try.
  const needsMsgTemplate = resolved.inbox_message === true || resolved.popup_dialog === true;
  const isCashback = /cashback/i.test(resolved.bonus_type || '');
  if (needsMsgTemplate && !isCashback) {
    push({
      kind: 'message_template_create',
      label: '6.6 Message Template (Create + per-locale body fill)',
      section: 'Promotions',
      type: 'Message',
      name: resolved.promo_code,
      status: 'Active',
      bonus_type: resolved.bonus_type,
      bonus_sub_type: resolved.bonus_sub_type,
    });
  } else if (needsMsgTemplate && isCashback) {
    push({
      kind: 'handoff',
      label: 'OPERATOR TURN — Cashback Message Template (manual):',
      items: [
        '6.6 Message Template is needed but Cashback T&Cs are not yet authored.',
        `Please create the template manually in /superuser/message-template — code "${resolved.promo_code}".`,
      ],
    });
  }

  // ── Section 14.1.2 Dialog Popup (operator rule 2026-05-15) ──────────
  // Auto-create + link a Dialog Popup when `popup_dialog: true`. Reuses
  // the same per-locale Message Template body for the Dialog Content (so
  // inbox + dialog text stay in sync). Cashback skipped until T&Cs land.
  if (resolved.popup_dialog === true && !isCashback) {
    push({
      kind: 'dialog_popup_create',
      label: '14.1.2 Dialog Popup (Create New Content + per-locale fill + link)',
      promotion_name_en: splitDualPromoName(resolved.promotion_name_en).generic,
      promotion_name_zh_id: resolved.promotion_name_zh_id,
      bonus_type: resolved.bonus_type,
      bonus_sub_type: resolved.bonus_sub_type,
      min_deposit: Number(r.min_deposit ?? 0),
    });
  }

  return actions;
}
