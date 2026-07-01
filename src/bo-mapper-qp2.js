// Translates a resolved promo request into UI actions for the QP2 BO
// "Create Promotion Code" form. QP2 platform covers QP2A–D (IBC22,
// KING333, ACE66, SPADE66 — all four merchants share one BO at
// ibc22.qtp777.com).
//
// **Rewritten 2026-05-13 from the actual QP2A form-state dump** (canary
// run 1 on QP2A). Field set verified against the live form's
// formcontrolnames. Field VALUES (defaults, which-checkbox-is-on-for-FS,
// etc.) are best-effort and will need iteration.
//
// QP2 vs QPRO summary:
//   QPRO has              QP2 has
//   -------------------   -----------------------
//   limit_transfer_in     <none — seamless wallet>
//   limit_transfer_out    <none>
//   bonus_rate            <NOT in main form — assumed in Currency popup>
//   restrict_claim_rou…   freespin_check
//   kyc_type / KYC Status <none — replaced by requires_email/mobile/dob/fullname>
//   last_deposit          <none — replaced by allow_deposit>
//   target.0 + target.1   single target row (new_target_type radio)
//   <none>                allow_deposit, allow_continuous_claim,
//                         auto_reward_activation, withdrawal_unlock,
//                         fingerprint_check, freespin_check,
//                         requires_*, deposit_status, deposit_count
//
// UNKNOWNS the next live run will surface:
//   • Where does bonus_rate live? Assumed Currency popup. If not, mapper
//     needs to find the right field.
//   • Names popup field names — assumed same as QPRO; not yet probed.
//   • Currency popup inner-form field names — assumed same as QPRO; first
//     live attempt failed (locator.waitFor timeout). Inner-form may have
//     different formcontrolnames.

const PROMO_TYPE_LABEL = {
  'Deposit':     'Deposit',
  'Cashback':    'Cashback',
  'Free Credit': 'Free Credit',
  'Free Spin':   'Free Spin',
};

// Frequency options on QP2: Daily / Weekly / Monthly / Annually (canary v1
// 2026-05-13 probe). Different from QPRO ("Daily Max" etc.).
const FREQUENCY_LABEL = 'Daily';

// Brand → Merchant display name in the QP2 Merchant kt-dropdown
// (probed 2026-05-13). Options: IBC22, KING333, ACE66, SPADE66.
const BRAND_TO_MERCHANT = {
  'QP2A': 'IBC22',
  'QP2B': 'KING333',
  'QP2C': 'ACE66',
  'QP2D': 'SPADE66',
};

export function buildActions(resolved, { brand } = {}) {
  const r = resolved.parsed || {};
  const actions = [];
  const push = (action) => actions.push(action);

  const bt = (resolved.bonus_type || '').toLowerCase();
  const isFs  = bt.includes('free spin');
  const isFc  = bt.includes('free credit');
  const isCb  = bt.includes('cashback');
  const isDep = bt.includes('deposit');

  // ── Per-RN operator instructions (parsed from remark + name_details) ──
  // See memory/project_request_instructions_parser.md.
  const instr = resolved.instructions || {};
  // `code_name_override` — operator-specified Code from the remark column.
  // Most rows have the same value in the dedicated promo_code column too,
  // but the override wins when they disagree (operator intent is explicit
  // in the remark).
  const effectivePromoCode = instr.code_name_override || resolved.promo_code;
  // `multiple_claims_allowed` / `one_time_claim` — override `recurring`
  // when operator specifies cadence in the remark.
  const effectiveRecurring = instr.multiple_claims_allowed === true ? true
                           : instr.one_time_claim === true        ? false
                           : resolved.recurring;

  // ── Basic Info ──────────────────────────────────────────────────────
  push({ kind: 'text', selector: 'input[formcontrolname="code"]', value: effectivePromoCode,         label: 'Code' });
  push({ kind: 'text', selector: 'input[formcontrolname="name"]', value: resolved.promotion_name_en, label: 'Name (display)' });

  // ── Type / Sub-Type ─────────────────────────────────────────────────
  const topLabel = PROMO_TYPE_LABEL[resolved.bonus_type];
  if (topLabel) {
    push({ kind: 'select', selector: 'select[formcontrolname="promo_type"]', optionLabel: topLabel, label: 'Promo Type (top)', scope: 'form' });
    push({ kind: 'wait',   ms: 2500, label: 'wait for sub-type options to load' });
    if (resolved.bonus_sub_type) {
      push({ kind: 'select', selector: 'select[formcontrolname="promo_sub_type"]', optionLabel: resolved.bonus_sub_type, matchMode: 'icontains', label: 'Promo Sub-Type', scope: 'form' });
    }
  } else {
    push({ kind: 'handoff', label: `Pick "Promo Type" dropdown manually — unknown mapping for bonus_type="${resolved.bonus_type}"` });
  }

  // ── Bonus section: QP2-specific checkboxes ──────────────────────────
  // allow_deposit: 2026-05-15 operator rule — NEVER tick on QP2 (any
  // merchant, any bonus type). Use Deposit Status select instead (see
  // below). See feedback_qp2d_allow_deposit_off.md.
  push({ kind: 'check', selector: 'input[formcontrolname="allow_deposit"]',           state: false, label: 'Allow Deposit' });
  push({ kind: 'check', selector: 'input[formcontrolname="allow_continuous_claim"]',  state: false,                  label: 'Allow Continuous Claim' });
  push({ kind: 'check', selector: 'input[formcontrolname="allow_cancel"]',            state: false,                  label: 'Allow Cancel' });
  push({ kind: 'check', selector: 'input[formcontrolname="auto_unlock"]',             state: true,                   label: 'Auto Unlock' });
  push({ kind: 'check', selector: 'input[formcontrolname="auto_reward_activation"]',  state: false,                  label: 'Auto Reward Activation' });
  push({ kind: 'check', selector: 'input[formcontrolname="withdrawal_unlock"]',       state: false,                  label: 'Withdrawal Unlock' });
  push({ kind: 'check', selector: 'input[formcontrolname="fingerprint_check"]',       state: false,                  label: 'Fingerprint Check' });
  // freespin_check: ON for Free Spin only (per dump default behavior).
  push({ kind: 'check', selector: 'input[formcontrolname="freespin_check"]',          state: isFs,                   label: 'Free Spin Check' });

  // ── Member requirements (QP2 KYC equivalent — 4 individual checks) ──
  push({ kind: 'check', selector: 'input[formcontrolname="requires_email"]',    state: false, label: 'Requires Email' });
  push({ kind: 'check', selector: 'input[formcontrolname="requires_mobile"]',   state: false, label: 'Requires Mobile' });
  push({ kind: 'check', selector: 'input[formcontrolname="requires_dob"]',      state: false, label: 'Requires DOB' });
  push({ kind: 'check', selector: 'input[formcontrolname="requires_fullname"]', state: false, label: 'Requires Full Name' });

  // ── Merchant (QP2 required; single-select; brand-specific) ──────────
  // Canary v1 2026-05-13 caught this — Merchant is required (asterisk in
  // label) but the mapper wasn't filling it. The kt-dropdown is single-
  // select with options [IBC22, KING333, ACE66, SPADE66].
  const merchantName = BRAND_TO_MERCHANT[brand] || (resolved.brands?.[0] && BRAND_TO_MERCHANT[resolved.brands[0]]);
  if (merchantName) {
    push({
      kind: 'kt_dropdown_pick',
      rowLabel: 'Merchant',
      triggerNth: 0,
      optionLabel: merchantName,
      matchMode: 'icontains',
      label: 'Merchant',
    });
  } else {
    push({ kind: 'handoff', label: `Pick "Merchant" manually — no mapping for brand="${brand}"` });
  }

  // ── Eligible Types (must fire BEFORE Member Group) ──────────────────
  // Operator rule 2026-05-14: pick Eligible Types = "Members" before
  // opening Member Group. The Member Group panel's options depend on
  // which eligibility scope is active (Members / Affiliate / Telemarketer
  // each show a different roster). Setting Eligible Types first ensures
  // Member Group loads the regular Members hierarchy.
  push({ kind: 'select', selector: 'select[formcontrolname="eligible_types"]', optionLabel: 'Members', label: 'Eligible Types', scope: 'form' });

  // ── Member Group (Select All + un-tick SHADOWBAN) ───────────────────
  // Operator rule 2026-05-13: include every member group EXCEPT shadowban.
  // Earlier mapper tried to pick "Normal" only (silently skipped when label
  // didn't match) — wrong on both fronts (too restrictive, and skipping
  // doesn't satisfy the form's expectation).
  push({
    kind: 'multiselect_inverted',
    label: 'Member Group',
    // QP2 Member Group items are hierarchical: each Merchant has children
    // like "<MERCHANT>-Normal", "<MERCHANT>-Bronze 1", ..., "<MERCHANT>-*Shadowban".
    // We exclude the Shadowban entries. Playwright's :has-text is
    // case-insensitive substring, so one variant matches all (e.g.
    // "Shadowban" matches "IBC22-*Shadowban"). Duplicate variants would
    // toggle the same item multiple times — bad.
    exclusions: ['Shadowban'],
  });

  // ── Free Spin Games (FS only — 2 cascading kt-dropdown components) ──
  // 2026-05-14 (FS canary v1): QP2 FS form has TWO cascading
  // "Free Spin Games *" kt-dropdown rows (Provider + Game). Without
  // picking them, the form is ng-invalid (`game_provider_codes` is
  // ng-invalid) → Auto-Submit click times out (button stays disabled).
  // The kt_dropdown_pick handler in canary-write.js already has a
  // 4-strategy auto-pick (Playwright + native-DOM click + force-event).
  // Mirrors the QPRO mapper's FS Games actions (lines 88-106).
  if (isFs) {
    const gameProvider = r.game_provider || 'PP - Pragmatic Play';
    const gameName     = r.game          || null;
    if (!gameName) {
      push({
        kind: 'handoff',
        label: 'OPERATOR TURN — Free Spin Games (request did not specify game):',
        items: [
          `Pick the FIRST dropdown (Game Provider): ${gameProvider}`,
          'Pick the SECOND dropdown (Game): <not specified — pick manually>',
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
      // Game options populate AFTER the provider commits. Wait for the
      // cascade to load before opening the Game dropdown.
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

  // ── Dates + Frequency ───────────────────────────────────────────────
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const validFromStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  push({ kind: 'text',   selector: 'input[formcontrolname="valid_from"]',     value: validFromStr,                                                        label: 'Valid From (now)' });
  push({ kind: 'number', selector: 'input[formcontrolname="validity"]',       value: resolved.validity_days ?? 30,                                        label: 'Validity (days)' });
  push({ kind: 'number', selector: 'input[formcontrolname="reward_validity"]',value: resolved.rewards_validity_days ?? resolved.validity_days ?? 30,      label: 'Reward Validity' });
  push({ kind: 'select', selector: 'select[formcontrolname="frequency_type"]',optionLabel: FREQUENCY_LABEL, label: 'Frequency', scope: 'form' });

  // ── Categories (multi-select) ───────────────────────────────────────
  // Priority (highest first):
  //   1. instructions.category_only ("[SLOTS ONLY]", "[LC ONLY]", "[Sports ONLY]")
  //      → multiselect with just that one category. Per-RN override.
  //   2. FS → Slots ONLY (operator rule, confirmed permanent 2026-05-15)
  //   3. Other bonus types → Select All minus Layer-1 exclusions
  if (instr.category_only) {
    // Pass a few label variants to handle BO panel casing differences.
    const c = instr.category_only;  // already normalized: 'Slots' / 'Live Casino' / 'Sports' / etc.
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
      exclusions: ['ARCADE', 'COCK FIGHT', 'LOTTERY', 'TABLE'],
    });
  }

  // ── Game Providers (multi-select; same Layer-1 exclusions on all bonus types) ──
  // 2026-05-14 (QP2B FS canary): KING333 (and other QP2 merchants beyond
  // QP2A) does NOT auto-populate Game Providers from FS Games Provider —
  // `game_provider_codes` stays empty → form ng-invalid → Submit blocked.
  // Earlier attempt with `multiselect` action couldn't open the panel
  // ("couldn't open multi-select for 'Game Providers'" — root cause not
  // yet probed). Pragmatic fix: use the proven `multiselect_inverted`
  // handler with Layer-1 exclusions on ALL bonus types (including FS).
  // Result: FS keeps the same set of providers ticked as Deposit (≠
  // operator's "follow free spin games" rule). Operator manually trims to
  // the single FS provider post-save until the proper FS handler lands.
  push({
    kind: 'multiselect_inverted',
    label: 'Game Providers',
    exclusions: ['918KISS', '918KAYA', 'ALLBET', 'EKOR', 'HABANERO', 'KINGMIDAS', 'MEGA888', 'DG', 'SSG'],
  });

  // ── Target (single-row) ─────────────────────────────────────────────
  // QP2 differs from QPRO: ONE target row with two radio sets.
  //   new_target_type:         nth=0 Turnover, nth=1 Winloss
  //   new_target_type_setting: nth=0 Included, nth=1 Excluded
  push({
    kind: 'radio',
    selector: 'input[type="radio"][formcontrolname="new_target_type"]',
    nth: 0,  // Turnover
    label: 'Target Type → Turnover',
  });
  push({
    kind: 'radio',
    selector: 'input[type="radio"][formcontrolname="new_target_type_setting"]',
    nth: 0,  // Included
    label: 'Transfer Amount → Included',
  });
  if (r.to_multiplier != null) {
    push({ kind: 'number', selector: 'input[formcontrolname="multiplier"]', value: r.to_multiplier, label: 'Target Multiplier' });
  }

  // ── Eligibility (continued — Eligible Types already filled above) ──
  // Eligible Types was moved to BEFORE Member Group (operator rule
  // 2026-05-14). Don't refill here.
  push({ kind: 'check',  selector: 'input[formcontrolname="auto_approve"]',    state: true, label: 'Auto Approve' });
  push({ kind: 'select', selector: 'select[formcontrolname="recurring"]',      optionLabel: effectiveRecurring === true ? 'Recurring' : 'One Time', label: 'Recurring', scope: 'form' });

  // ── Deposit Status (2026-05-15 operator rule) ───────────────────────
  // QP2: allow_deposit is always OFF (above). Deposit-required signal
  // lives on this select instead. "Last Deposit" when the customer
  // must deposit something to claim (Dep / Cb / FS with transfer);
  // "None" when no deposit gate (FC, no-deposit FS).
  const depositRequired = Number(r.min_deposit ?? 0) > 0;
  push({
    kind: 'select',
    selector: 'select[formcontrolname="deposit_status"]',
    optionLabel: depositRequired ? 'Last Deposit' : 'None',
    label: 'Deposit Status',
    scope: 'form',
  });

  // 2026-05-14 (FC live test): server-side 422 "The reset frequency field
  // is required. (I22-…)" — corrects the earlier canary-v1 assumption that
  // QP2 has no reset_frequency. The form-state dump confirms 4
  // reset_frequency radios exist (Daily/Weekly/Monthly/Annually probably).
  // Pick nth=0 (Daily) when recurring=true to match the chosen
  // frequency_type. Skip for one-time promos.
  if (effectiveRecurring === true) {
    push({
      kind: 'radio',
      selector: 'input[type="radio"][formcontrolname="reset_frequency"]',
      nth: 0,  // Daily
      label: 'Reset Frequency → Daily',
    });
  }

  // QP2 form does NOT have these QPRO-specific fields (canary v1 2026-05-13):
  //   • max_per_player input — absent (uses max_total_applications in Currency popup)
  //   • daily_max input — absent (uses deposit_count instead)
  // deposit_status / deposit_count: QP2-specific. Leaving at defaults
  // (deposit_status=Active=1, deposit_count=0). Re-tune once we see a
  // request that needs them set.

  // ── Currency popup ──────────────────────────────────────────────────
  // QP2 Currency popup has 39 fields (vs QPRO's 22). Per-bonus-type
  // fills confirmed via raw API probe 2026-05-13 — see
  // captures/probe-fc-fs/ibc22-RAW-*.json. Key differences from QPRO:
  //   • bonus_rate lives in the popup (not on main form like QPRO)
  //   • min_deposit and min_transfer are SEPARATE fields
  //   • FC uses bonus_amount (not free_credit_amount like QPRO)
  //   • FC withdrawal cap is max_withdraw (not max_transfer_out like QPRO)
  // The popup_fill_currency handler is field-agnostic — it fills whatever
  // row keys exist on the inner form and skips absent ones.
  const currencyRows = (resolved.currencies || ['MYR']).map((ccy) => {
    const override = resolved.per_currency_overrides?.[ccy] || {};
    // QP2 inner Currency form: `max_total_applications` and `max_total_bonus`
    // (label: "Max Total Amount") are OPTIONAL inputs, but the BO's form
    // validator marks them ng-invalid when value=0 (probe 2026-05-13). They
    // pass as blank. Don't emit them unless the request actually sets them.
    const row = {
      currency: ccy,
    };
    if (override.max_total_applications != null) row.max_total_applications = override.max_total_applications;
    if (override.max_total_bonus != null) row.max_total_bonus = override.max_total_bonus;
    if (isDep || isCb) {
      // ORDER MATTERS: QP2 Deposit inner Currency form dynamically renders
      // some inputs only AFTER the type selects are set. Specifically,
      // bonus_type=Percentage reveals a bonus-rate input; setting bonus_rate
      // BEFORE the select would silently miss the (yet-to-render) input.
      // The popup_fill_currency handler iterates row keys in insertion
      // order, so put the conditional selects FIRST.
      row.bonus_type        = override.bonus_type        ?? 'Percentage';
      row.max_withdraw_type = override.max_withdraw_type ?? 'Fixed Amount';
      row.min_deposit       = override.min_deposit       ?? r.min_deposit       ?? 0;
      row.min_transfer      = override.min_deposit       ?? r.min_deposit       ?? 0;
      row.max_bonus         = override.max_bonus         ?? r.max_bonus         ?? 0;
      row.bonus_rate        = override.bonus_rate_pct    ?? r.bonus_rate_pct    ?? 0;
      row.max_withdraw      = override.max_withdraw      ?? r.max_bonus ?? 0;
    } else if (isFc) {
      // QP2 FC Currency popup probe 2026-05-14 (qp2-fc-fs-currency-probe.js):
      //   Required selects: currency_id (handled separately by executor),
      //                     max_withdraw_type ← needs explicit pick
      //                     ("Please Select" default is ng-invalid)
      //   Pre-filled defaults: bonus_type=Fixed Amount, status=Active, reset=None
      //   Required input: bonus_amount = free credit value the customer receives
      // SELECTS FIRST, then inputs.
      row.max_withdraw_type = override.max_withdraw_type ?? 'Fixed Amount';
      // QP2 stores the FC amount in `bonus_amount` (not free_credit_amount).
      row.bonus_amount  = override.free_credit_amount ?? r.free_credit_amount ?? 0;
      row.bonus_rate    = 0;
      row.max_withdraw  = override.max_transfer_out ?? r.max_transfer_out ?? 0;
      // (removed 2026-05-14) max_transfer_out alias — field doesn't exist
      // on the FC inner form; field-agnostic handler skipped it silently.
      row.min_deposit   = override.min_deposit ?? r.min_deposit ?? 0;
    } else if (isFs) {
      // QP2 FS Currency popup field map reconstructed from raw API record
      // (captures/probe-fc-fs/ibc22-RAW-FT_DOUDLEDATE_JUNE_250FS_FOO.json,
      // operator-saved FS promo). Live probe today was Games-gate-blocked
      // ("+ Promotion Currency" button stays disabled until both FS Games
      // dropdowns commit — see project_fs_currency_depends_on_games.md).
      //
      // Required: currency_id (handled by executor), max_withdraw_type,
      // rounds, amount_per_line.
      // No `bonus_type` field on FS (confirmed by saved-record bonus_type=null).
      // Dialog defaults lines=10, coins=1 — operator saves them as 0,0,
      // so emit explicit 0/0 to match house practice.
      row.max_withdraw_type = override.max_withdraw_type ?? 'Fixed Amount';
      row.min_deposit     = override.min_deposit    ?? r.min_deposit    ?? 0;
      row.rounds          = override.spin_count     ?? r.spin_count     ?? 0;
      // House convention: amount_per_line = floor(value_per_spin / 20, 2dp).
      // BO rejects sub-cent amounts (0.50→0.025 rejected; floor→0.02 accepted).
      // /20 + floor also preserves the known 0.20→0.01 mapping.
      // QPRO mapper already does this; QP2 was sending raw value_per_spin
      // (caught 2026-05-14 — TEST_QP2A_FS saved with 0.2 instead of 0.01).
      const valPerSpin = Number(override.value_per_spin ?? r.value_per_spin ?? 0);
      const aplRawQp2  = override.amount_per_line ?? r.amount_per_line ?? null;
      row.amount_per_line = aplRawQp2 != null
        ? +Number(aplRawQp2).toFixed(4)
        : Math.floor(valPerSpin / 20 * 100) / 100;
      row.lines           = 0;
      row.coins           = 0;
      row.bonus_rate      = 0;
    }
    return row;
  });
  push({ kind: 'popup_fill_currency', rows: currencyRows });

  // ── Auto-Submit ─────────────────────────────────────────────────────
  push({ kind: 'auto_submit', label: 'Auto-Submit (5s preview + idempotency check)' });

  // ── Section 6.6 Message Template ────────────────────────────────────
  // Same trigger as QPRO. Renderer auto-swaps :brandname → :merchantname
  // for QP2 platform (handled in src/message-template-renderer.js).
  const needsMsgTemplate = resolved.inbox_message === true || resolved.popup_dialog === true;
  const isCashbackReq = /cashback/i.test(resolved.bonus_type || '');
  if (needsMsgTemplate && !isCashbackReq) {
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
  } else if (needsMsgTemplate && isCashbackReq) {
    push({
      kind: 'handoff',
      label: 'OPERATOR TURN — Cashback Message Template (manual):',
      items: [
        '6.6 Message Template is needed but Cashback T&Cs are not yet authored.',
        `Please create the template manually in /superuser/message-template — code "${resolved.promo_code}".`,
      ],
    });
  }

  // ── Section 15.1.2 Dialog Popup (operator rule 2026-05-15) ──────────
  // Auto-create + link a Dialog Popup when `popup_dialog: true`. Reuses
  // the same per-locale Message Template body for the Dialog Content (so
  // inbox + dialog text stay in sync). Cashback skipped until T&Cs land.
  if (resolved.popup_dialog === true && !isCashbackReq) {
    push({
      kind: 'dialog_popup_create',
      label: '15.1.2 Dialog Popup (Create New Content + per-locale fill + link)',
      promotion_name_en: resolved.promotion_name_en,
      promotion_name_zh_id: resolved.promotion_name_zh_id,
      bonus_type: resolved.bonus_type,
      bonus_sub_type: resolved.bonus_sub_type,
      min_deposit: Number(r.min_deposit ?? 0),
    });
  }

  return actions;
}
