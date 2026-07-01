// Auto-naming for empty promo_code + promotion_name_* fields, following
// the `promo-qc-engine` skill convention. Called by bin/ingest-requests.js
// during live-sheet ingest — when the operator leaves the naming columns
// blank, the namer fills them from `bonus_type` + `parsed.*` + remark
// instructions. The values then flow through the canary and are written
// back to the sheet as the final step.
//
// Patterns (per memory/project_promo_code_automation_flow.md + the
// promo-qc-engine skill):
//
//   REL_<pct>PCT_<TO>X           non-VIP Reload Deposit
//   VIP_REL_<pct>PCT_<TO>X       VIP Reload Deposit
//   WELC_<pct>PCT_<TO>X          Welcome Deposit
//   <amt>FC_<TO>X                non-VIP Free Credit (e.g. 30FC_5X)
//   VIP_<amt>FC_<TO>X            VIP Free Credit
//   <spins>FS_<provider>_<TO>X   Free Spin (e.g. 150FS_PP2_5X)
//
// Modifiers (appended in order):
//   Category-only suffix from instructions.category_only:
//     Slots → _SLT,  Live Casino → _LC,  Sports → _SPT,
//     Table → _TBL, Fishing → _FSH,     Arcade → _ARC
//   Tier suffix from instructions / remark hints:
//     Bronze → _BR, Silver → _SIL, Gold → _GLD
//
// Operator override (instructions.code_name_override) wins outright — the
// derived name/code is replaced by whatever the operator wrote.
//
// Returns { promo_code, promotion_name_en, promotion_name_zh_id, source,
// missing } where:
//   source = 'override' | 'derived' | 'incomplete' | 'unsupported'
//   missing = []      (set only when source = 'incomplete')

import { findCampaignRule } from './campaign-prefix-rules.js';

const CATEGORY_SUFFIX = {
  'Slots':       '_SLT',
  'Live Casino': '_LC',
  'Sports':      '_SPT',
  'Table':       '_TBL',
  'Fishing':     '_FSH',
  'Arcade':      '_ARC',
};

// Campaign suffix appended when the campaign name contains a known keyword.
// Lets the inbox/code both carry the campaign brand identifier without the
// operator having to manually override the code name.
const CAMPAIGN_CODE_SUFFIX = {
  'world cup': '_WCF',
};

function inferCampaignSuffix(record) {
  const campaign = String(record.campaign || '').toLowerCase();
  for (const [keyword, suffix] of Object.entries(CAMPAIGN_CODE_SUFFIX)) {
    if (campaign.includes(keyword)) return suffix;
  }
  return null;
}

// Per operator 2026-05-16: tier identifier goes at the FRONT of the code
// (e.g. `GLD_REL_30PCT_3X`), not the back. Names are not tier-modified.
// "Normal" is included for membership-tier-explicit promos targeting the
// default group.
const TIER_PREFIX = {
  bronze:   'BR',
  silver:   'SIL',
  gold:     'GLD',
  platinum: 'PLT',
  diamond:  'DMD',
  normal:   'NRM',
};

export function deriveNames(record) {
  const instr = record.instructions || {};
  const override = instr.code_name_override;

  const bt  = String(record.bonus_type || '').toLowerCase();
  const sub = String(record.bonus_sub_type || '').toLowerCase();
  const p   = record.parsed || {};
  const isVip = inferVip(record);
  const tier  = inferTier(record);

  let code, nameEn, nameZh, missing = [];

  if (bt === 'deposit') {
    if (p.bonus_rate_pct == null) missing.push('bonus_rate_pct');
    if (p.to_multiplier == null) missing.push('to_multiplier');
    if (missing.length) return { source: 'incomplete', missing };
    const pct = p.bonus_rate_pct;
    const to  = p.to_multiplier;
    if (sub === 'welcome') {
      code   = `WELC_${pct}PCT_${to}X`;
      nameEn = `${pct}% Welcome Bonus`;
      nameZh = `${pct}% 欢迎奖励`;
    } else if (isVip) {
      code   = `VIP_REL_${pct}PCT_${to}X`;
      nameEn = `VIP ${pct}% Reload Bonus`;
      nameZh = `VIP ${pct}% 充值奖励`;
    } else {
      code   = `REL_${pct}PCT_${to}X`;
      nameEn = `${pct}% Reload Bonus`;
      nameZh = `${pct}% 充值奖励`;
    }
  } else if (bt === 'free credit') {
    if (p.free_credit_amount == null) missing.push('free_credit_amount');
    if (p.to_multiplier == null) missing.push('to_multiplier');
    if (missing.length) return { source: 'incomplete', missing };
    const amt = p.free_credit_amount;
    const to  = p.to_multiplier;
    if (isVip) {
      code   = `VIP_${amt}FC_${to}X`;
      nameEn = `Exclusive ${amt} Free Credit`;
      nameZh = `VIP ${amt} 免费体验金`;
    } else {
      code   = `${amt}FC_${to}X`;
      nameEn = `Exclusive Offer - ${amt} Free Credit`;
      nameZh = `独家优惠 - ${amt} 免费体验金`;
    }
  } else if (bt === 'free spin') {
    if (p.spin_count == null) missing.push('spin_count');
    if (p.to_multiplier == null) missing.push('to_multiplier');
    // Default game_provider to PP2 (Pragmatic Play) per operator
    // 2026-05-16. PP2 is the default → omit from the code (`<spins>FS_<acronym>_<TO>X`).
    // Non-default providers stay in the code (`<spins>FS_<provider>_<acronym>_<TO>X`).
    const providerPrefix = extractProviderPrefix(p.game_provider) || 'PP2';
    const isDefaultProvider = providerPrefix === 'PP2';
    if (missing.length) return { source: 'incomplete', missing };
    const spins = p.spin_count;
    const to    = p.to_multiplier;
    const gameLabel = trimGameLabel(p.game);
    const acronym = gameAcronym(gameLabel);
    const providerToken = !isDefaultProvider ? providerPrefix : null;
    code = `${spins}FS${providerToken ? '_' + providerToken : ''}_${to}X`;
    if (p.value_per_spin != null) {
      const vps = Number(p.value_per_spin);
      if (Number.isFinite(vps) && vps > 0) {
        const vpsTok = String(Math.round(vps * 100)).padStart(3, '0');
        code += `_${vpsTok}`;
      }
    }
    if (acronym) code += `_${acronym}`;
    nameEn = gameLabel ? `${spins} Free Spins on ${gameLabel}` : `${spins} Free Spins`;
    nameZh = gameLabel ? `${spins} 次免费旋转 — ${gameLabel}` : `${spins} 次免费旋转`;
  } else {
    return { source: 'unsupported', missing: [`bonus_type=${bt || 'empty'}`] };
  }

  // Category-only suffix (kept as suffix; appears after the base pattern).
  if (instr.category_only && CATEGORY_SUFFIX[instr.category_only]) {
    code += CATEGORY_SUFFIX[instr.category_only];
  }
  // Campaign suffix — appended after category, before tier/FT_ prefixes, so
  // it stays adjacent to the base pattern.
  // Priority order: operator's explicit "Add '<phrase>' to code" instruction
  // (instructions.code_context_tag) wins over the generic keyword-derived
  // campaign suffix. So "Add 'WC FTD' to code" produces _WCFTD instead of
  // the default _WCF for any "World Cup" campaign. Operator-mute rows fall
  // back to the keyword map.
  const contextTag = instr.code_context_tag;
  if (contextTag) {
    code += `_${contextTag}`;
  } else {
    const campaignSuffix = inferCampaignSuffix(record);
    if (campaignSuffix) code += campaignSuffix;
  }
  // Auto-apply campaign objective tokens from campaign-prefix-rules.js.
  // Reads the campaign column (e.g. "CRM - Retention") and prepends any
  // required tokens (CRM_, ADHOC_, CHURN_, RET_, etc.) not already present.
  // VIP_ is skipped here — it's handled by the tier block below so it lands
  // outermost among the identity prefixes.
  const campaignRule = findCampaignRule(record.campaign);
  if (campaignRule) {
    const upperCode = code.toUpperCase();
    const tokensToAdd = campaignRule.required.filter((t) => {
      const tok = (t.endsWith('_') ? t : `${t}_`).toUpperCase();
      return tok !== 'VIP_' && !upperCode.includes(tok);
    });
    for (const t of [...tokensToAdd].reverse()) {
      const tok = t.endsWith('_') ? t : `${t}_`;
      code = `${tok}${code}`;
    }
  }
  // Tier prefix (operator rule 2026-05-16): membership-tier markers go at
  // the FRONT of the code, not the back. Code stays out of the promo names.
  if (tier && TIER_PREFIX[tier]) {
    code = `${TIER_PREFIX[tier]}_${code}`;
  }
  // Platform-implied FT_ prefix for WS1/WS2 (IGMP). Per operator 2026-05-20:
  // every WS1/WS2 promo gets `FT_` at the front regardless of remark. Sits
  // closer to the base than operator code_prefixes so the final order ends
  // up `[TEST_][operator-prefixes_]FT_<TIER_><base>`.
  const onWs1Ws2 = Array.isArray(record.brands)
    && record.brands.some((b) => /^WS[12]\b/i.test(String(b)));
  if (onWs1Ws2 && !code.startsWith('FT_')) {
    code = `FT_${code}`;
  }
  // Operator-named prefixes from remark/details (instruction L). Examples:
  //   "Add VIP to code"        → VIP_
  //   "Include FT prefix"      → FT_
  //   "Please add GOLD to the code" → GLD_ (alias from GOLD)
  // Each prefix is prepended in mention order — first-mentioned ends up
  // closest to the base, last-mentioned ends up outermost (just inside TEST_).
  // De-dup: skip if the current code already starts with `<PREFIX>_`.
  if (Array.isArray(instr.code_prefixes)) {
    for (const prefix of instr.code_prefixes) {
      if (prefix && !code.startsWith(`${prefix}_`)) {
        code = `${prefix}_${code}`;
      }
    }
  }
  // TEST_ prefix. Applied LAST so it sits at the very start:
  // TEST_<TIER>_<base>_<suffix>. Three independent triggers (any wins):
  //   1. campaign column starts with "test" (e.g. campaign="TEST")
  //   2. requestor matches /\btest/i (e.g. "Testbot", "Test Bot", "QA Tester")
  //   3. operator instruction in remark/details: instructions.add_test_prefix
  //      (parsed in src/ingest.js — broadened wording per 2026-05-18)
  if (
    isTestCampaign(record.campaign)
    || isTestRequestor(record.requestor)
    || (instr && instr.add_test_prefix)
  ) {
    code = `TEST_${code}`;
  }

  // Operator override wins for the code. Names still derive from
  // parsed/bonus_type so the consumer-facing display (popup label,
  // /promotionname rows) is populated — empty names previously caused
  // the popup POST to 422 with "label field is required".
  if (override) {
    return { promo_code: override, promotion_name_en: nameEn, promotion_name_zh_id: nameZh, source: 'override', missing: [] };
  }
  return { promo_code: code, promotion_name_en: nameEn, promotion_name_zh_id: nameZh, source: 'derived', missing: [] };
}

function isTestCampaign(campaign) {
  return /^test\b/i.test(String(campaign || '').trim());
}

// Match requestor field containing "test" at a word start: "Testbot",
// "Test Bot", "QA Tester", "TestQC" etc. Case-insensitive. "Latest" /
// "Greatest" don't match because /\btest/i requires word-boundary→test,
// not test in the middle of a word.
function isTestRequestor(requestor) {
  return /\btest/i.test(String(requestor || '').trim());
}

// "PP2 - Pragmatic Play" → "PP2"   |   "PP - Pragmatic Play" → "PP"
// Strips the descriptive label so the code-suffix stays short.
function extractProviderPrefix(label) {
  if (!label) return null;
  const m = String(label).match(/^\s*([A-Z][A-Z0-9]*)\s*[-—]\s*/);
  return m ? m[1] : null;
}

// "vs20olympgold - Gates of Olympus Super Scatter" → "Gates of Olympus Super Scatter"
function trimGameLabel(label) {
  if (!label) return null;
  const s = String(label).trim();
  const idx = s.indexOf(' - ');
  return idx > 0 ? s.slice(idx + 3).trim() : s;
}

// "Gate Of Olympus" → "GOO".  "Sweet Bonanza Xmas" → "SBX".
// First alpha char of each whitespace-separated token. Numbers / punctuation
// in tokens are skipped (e.g. "Sugar Rush 1000" → "SR").
function gameAcronym(label) {
  if (!label) return null;
  const tokens = String(label).trim().split(/\s+/).filter(Boolean);
  const letters = tokens.map((w) => {
    const first = [...w].find((c) => /[A-Za-z]/.test(c));
    return first ? first.toUpperCase() : '';
  }).filter(Boolean);
  return letters.length ? letters.join('') : null;
}

// VIP signals — any of:
//   - parsed.is_vip === true                       (explicit)
//   - instructions hint mentions VIP in remark
//   - campaign name contains "VIP"
//   - eligible_types restricts to VIP audience      (downstream check, not here)
function inferVip(record) {
  if (record.parsed && record.parsed.is_vip === true) return true;
  const hay = `${record.campaign || ''} ${record.remark || ''} ${record.name_details_raw || ''}`;
  return /\bvip\b/i.test(hay);
}

// Tier signals — match keywords in remark/details. First match wins. Tier
// of "normal" only fires on the literal word "normal" (membership tier),
// not on "normal account manager" etc. (negative lookbehind).
function inferTier(record) {
  const hay = `${record.remark || ''} ${record.name_details_raw || ''}`.toLowerCase();
  if (/\bbronze\b/.test(hay))   return 'bronze';
  if (/\bsilver\b/.test(hay))   return 'silver';
  if (/\bgold\b/.test(hay))     return 'gold';
  if (/\bplatinum\b/.test(hay)) return 'platinum';
  if (/\bdiamond\b/.test(hay))  return 'diamond';
  if (/(?<!account manager: )\bnormal\b/.test(hay)) return 'normal';
  return null;
}
