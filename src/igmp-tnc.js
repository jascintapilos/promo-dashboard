// iGMP T&C HTML generator — builds PromotionRewardContents entries for
// Deposit Bonus (3.1), Free Credit (3.4), and Free Spin (3.15).
//
// Structure (matches live WS1/WS2 promos):
//   <h4> Title + HR + stats table </h4>
//   <h4> T&C clauses table </h4>
//
// Clauses themselves mirror QPRO/QP2 inbox-message templates (8/7/8 for
// Deposit/FC/FS) so the customer-facing T&C reads identically across all
// platforms. Brand name stays literal (MB8 / RWS77) because iGMP BOs have
// no runtime substitution; T&C URL is hyperlinked on the localized term.
//
// Locale codes: 'en' (always required) and 'zh' (MY + SG).
// Auto-generates for the regions present in rec.regions / rec.locales.
// Explicit rec.locale_contents entries always win over auto-generated ones.

import { BRAND_TO_SITE } from './ingest.js';

// ── Shared constants ─────────────────────────────────────────────────────────

const CURRENCY_PREFIX = { MYR: 'MYR', SGD: 'SGD', IDR: 'IDR', THB: 'THB', KHR: 'KHR' };

// ZH is only added for MY and SG regions.
const ZH_REGIONS = new Set(['MY', 'SG']);

// T&C link lookup: site → { en, zh }
const TNC_URL = {
  'ws2':       { en: 'https://rws77.com/en/info-center/tnc',  zh: 'https://rws77.com/zh/info-center/tnc' },
  'ws1-v3-my': { en: 'https://mb8mys.com/en/info-center/tnc', zh: 'https://mb8mys.com/zh/info-center/tnc' },
  'ws1-v3-sg': { en: 'https://mb8sg.com/en/info-center/tnc',  zh: 'https://mb8sg.com/zh/info-center/tnc' },
  'ws1-v3-id': { en: 'https://mb8id.com/en/info-center/tnc',  zh: 'https://mb8id.com/zh/info-center/tnc' },
  'ws1-v3-th': { en: 'https://mb8th.com/en/info-center/tnc',  zh: 'https://mb8th.com/zh/info-center/tnc' },
  'ws1-v3-kh': { en: 'https://mb8kh.com/en/info-center/tnc',  zh: 'https://mb8kh.com/zh/info-center/tnc' },
};

const BRAND_DISPLAY = {
  'ws2':       'RWS77',
  'ws1-v3-my': 'MB8',
  'ws1-v3-sg': 'MB8',
  'ws1-v3-id': 'MB8',
  'ws1-v3-th': 'MB8',
  'ws1-v3-kh': 'MB8',
};

// ── Number-to-words (matches message-template-renderer.js) ──────────────────

const ENGLISH_WORDS = [
  'zero','one','two','three','four','five','six','seven','eight','nine',
  'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty',
];

function digitToWords(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return String(n);
  if (v <= 20) return ENGLISH_WORDS[v];
  if (v < 100) {
    const tens = Math.floor(v / 10);
    const ones = v % 10;
    const tensWord = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'][tens];
    return ones === 0 ? tensWord : `${tensWord}-${ENGLISH_WORDS[ones]}`;
  }
  return String(v);
}

// ── Category translations + join (mirrors message-template-renderer.js) ────

const CATEGORY_TRANSLATIONS = {
  EN: { 'Slot': 'Slots' }, // operator rule: "Slots" plural, never "Slot"
  ZH: {
    'Slot':'老虎机','Slots':'老虎机','Live Casino':'真人娱乐场',
    'Sports':'体育','E-Sports':'电子竞技','eSports':'电子竞技',
    'Fishing':'捕鱼','Crash':'Crash','Arcade':'街机','Lottery':'彩票',
    'Table':'桌面游戏','Cock Fight':'斗鸡','Scratchcard':'刮刮乐',
    'Video Poker':'视频扑克','Bingo':'宾果',
  },
};

function joinCategories(cats, isZh) {
  const table = isZh ? CATEGORY_TRANSLATIONS.ZH : CATEGORY_TRANSLATIONS.EN;
  const translated = (cats || []).map((c) => table[c] || c);
  if (translated.length === 0) return isZh ? '所有' : 'All';
  if (translated.length === 1) return translated[0];
  if (!isZh) {
    // 2 items: no Oxford comma. 3+: Oxford comma.
    if (translated.length === 2) return `${translated[0]} and ${translated[1]}`;
    return `${translated.slice(0, -1).join(', ')}, and ${translated[translated.length - 1]}`;
  }
  return translated.join('、');
}

// Sub-exclusions within a single named category (Deposit Bonus clause 4).
// LC-only promos: clause says "...Live Casino, except for Blackjack."
// Slots-only promos: clause says "...Slots, except for Table and Arcade games."
// Returns null when no sub-exclusion applies (multi-category or unknown).
// Per-category sub-exclusions — what specific games/types within an eligible
// category are NOT counted toward turnover. Mirrors footer 11.5.1–11.5.4.
const CAT_SUB_EXCLUSIONS = {
  EN: {
    'Slots': ['Table games', 'Arcade games'],
    'Live Casino': ['Blackjack'],
    'Sports': ['Virtual Sports', 'Number Games'],
  },
  ZH: {
    'Slots': ['桌面游戏', '街机'],
    'Live Casino': ['二十一点'],
    'Sports': ['虚拟体育', '数字游戏'],
  },
};

// Collects sub-exclusions across ALL eligible categories (not just single-cat).
function catSubExclusion(cats, isZh) {
  if (!cats || cats.length === 0) return null;
  const table = isZh ? CAT_SUB_EXCLUSIONS.ZH : CAT_SUB_EXCLUSIONS.EN;
  const merged = [];
  for (const c of cats) {
    // Normalize Slot→Slots for lookup (joinCategories does this for display,
    // but catSubExclusion needs it for the key match).
    const key = (CATEGORY_TRANSLATIONS.EN[c] || c);
    const items = table[key] ?? table[c];
    if (items) merged.push(...items);
  }
  if (merged.length === 0) return null;
  // Dedupe (e.g. if two categories share an exclusion)
  const unique = [...new Set(merged)];
  if (isZh) return unique.join('、');
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
}

// FC inverse-category clause: which categories are EXCLUDED based on what's
// eligible. Slots in eligible → "Arcade and Table games"; Sports only → "Virtual
// Sports and Number games"; default → "Blackjack and Virtual Sports".
function excludedCategoriesFor(cats, isZh) {
  const lower = new Set((cats || []).map((c) => String(c).toLowerCase()));
  const hasSlots = lower.has('slot') || lower.has('slots');
  const sportsOnly = lower.has('sports') && lower.size === 1;
  if (hasSlots) return isZh ? '街机和桌面游戏' : 'Arcade and Table games';
  if (sportsOnly) return isZh ? '虚拟体育和数字游戏' : 'Virtual Sports and Number games';
  return isZh ? '二十一点和虚拟体育' : 'Blackjack and Virtual Sports';
}

// FC / Dep shared: build the category eligibility clause, supporting both
// "all except" (no restriction) and "eligible is/are X, except Y" (restricted).
function fcCatClause(cats, isZh) {
  if (!cats || cats.length === 0) {
    const excluded = excludedCategoriesFor(cats, isZh);
    return isZh
      ? `本优惠适用于所有游戏类别（${excluded}除外）。`
      : `This promotion is valid across all game categories (excluding ${excluded}).`;
  }
  const subExcl = catSubExclusion(cats, isZh);
  const isSingular = cats.length === 1;
  if (isZh) {
    return subExcl
      ? `本优惠仅适用于${joinCategories(cats, true)}（${subExcl}除外）。`
      : `本优惠仅适用于${joinCategories(cats, true)}。`;
  }
  const catNoun = isSingular ? 'category' : 'categories';
  const catVerb = isSingular ? 'is' : 'are';
  return subExcl
    ? `This promotion is valid across ${joinCategories(cats, false)} ${catNoun} only (excluding ${subExcl}).`
    : `This promotion is valid across ${joinCategories(cats, false)} ${catNoun} only.`;
}

// FS game provider — strip the BO short-code prefix ("PP2 - PRAGMATIC PLAY"
// → "PRAGMATIC PLAY"). Operator rule 2026-05-14: inbox copy never shows the
// back-office shortcode.
function gameProviderName(rec) {
  const raw = rec.parsed?.game_provider || rec.fs_provider || 'PRAGMATIC PLAY';
  return String(raw).replace(/^\s*[A-Za-z0-9]+\s*-\s*/, '').toUpperCase();
}

// ── HTML helpers (unchanged from the prior visual frame) ─────────────────────

const TD_HEADER = 'vertical-align: middle; text-align: center; background-color: rgb(42, 50, 142);';
const TD_BODY   = 'vertical-align: middle; text-align: center; background-color: transparent; color: rgb(85, 85, 85);';
const TABLE_STYLE = 'width: 709px; background-color: white; color: rgb(121, 121, 121); font-size: 14px; margin-top: 0px;';
const H4_STYLE  = 'margin-top: 12pt; margin-bottom: 2pt; font-family: Roboto, sans-serif; line-height: 1.656;';

function thCell(text) {
  return `<td style="${TD_HEADER}"><font color="#ffffff"><span style="font-weight: 600;">${text}</span></font><br></td>`;
}
function tdCell(text) {
  return `<td style="${TD_BODY}">${text}</td>`;
}
function statsTable(headers, values) {
  const ths = headers.map(thCell).join('');
  const tds = values.map(tdCell).join('');
  return `<table class="table table-promo-top-row-header" style="${TABLE_STYLE}"><tbody><tr>${ths}</tr><tr>${tds}</tr></tbody></table>`;
}
function clauseTable(innerHtml) {
  return `<table class="table table-promo-top-row-header" style="${TABLE_STYLE}"><tbody><tr><td style="vertical-align: middle; text-align: center; background-color: transparent;">${innerHtml}</td></tr></tbody></table>`;
}
function h4(content) {
  return `<h4 dir="ltr" style="${H4_STYLE}">${content}</h4>`;
}
function p(text, attrs = 'text-align: left;') {
  return `<p style="${attrs}"><font color="#555555">${text}</font></p>`;
}
function bold(text) { return `<span style="font-weight: 600;">${text}</span>`; }

// ── Per-record helpers ───────────────────────────────────────────────────────

function siteId(rec) {
  // Override wins: api-mapper-igmp passes the actual save siteId via
  // __site_override so T&C content matches the BO it's being saved into.
  if (rec.__site_override) return rec.__site_override;
  // Multi-brand records (e.g. QPRO1 + WS2) — find first iGMP brand.
  for (const brand of (rec.brands || [])) {
    const entry = BRAND_TO_SITE[String(brand).toUpperCase()];
    if (entry?.platform === 'igmp') return entry.siteId;
  }
  return 'ws1-v3-my';
}

// Per-site default currency. Derived from the SG/MY/etc. BO instance
// so T&C content uses the right symbol regardless of rec.currencies order.
const SITE_TO_CURRENCY = {
  'ws1-v3-my': 'MYR', 'ws1-v3-sg': 'SGD', 'ws1-v3-id': 'IDR',
  'ws1-v3-th': 'THB', 'ws1-v3-kh': 'KHR', 'ws2': 'MYR',
};

function currPrefix(rec) {
  const c = SITE_TO_CURRENCY[siteId(rec)]
    || (rec.currencies || ['MYR'])[0];
  return CURRENCY_PREFIX[c] || c;
}

function tncUrl(rec, locale) {
  const site = siteId(rec);
  return TNC_URL[site]?.[locale] || TNC_URL['ws1-v3-my'][locale];
}

function brandName(rec) {
  return BRAND_DISPLAY[siteId(rec)] || 'MB8';
}

// Hyperlinked T&C phrase used in the closing clause. Wraps just the
// localized term ("terms and conditions" / "条款与条件").
function tncLinkPhrase(url, isZh) {
  const term = isZh ? '条款与条件' : 'terms and conditions';
  return `<a href="${url}" target="_blank">${term}</a>`;
}

// Maps instruction-level category codes (SPORT/SLOTS/LC) → display names used
// by the rest of the T&C renderer.
const INSTRUCTION_CAT_MAP = {
  'SPORT': 'Sports', 'SPORTS': 'Sports',
  'SLOTS': 'Slot',   'SLOT': 'Slot',
  'LC': 'Live Casino', 'LIVE_CASINO': 'Live Casino', 'LIVE CASINO': 'Live Casino',
  'ESPORT': 'E-Sports', 'ESPORTS': 'E-Sports',
  'FISHING': 'Fishing', 'CRASH': 'Crash', 'ARCADE': 'Arcade',
  'LOTTERY': 'Lottery', 'TABLE': 'Table',
};

// Categories from the resolved record.
// instructions.categories_only wins (explicit operator statement);
// falls back to parsed.categories → rec.categories.
// Empty array means all-games (no restriction).
function categoriesFor(rec) {
  const instrCats = rec.instructions?.categories_only || [];
  if (instrCats.length > 0) {
    return instrCats
      .map((c) => INSTRUCTION_CAT_MAP[String(c).toUpperCase()] || c)
      .filter(Boolean);
  }
  const cats = rec.parsed?.categories || rec.categories || [];
  return Array.isArray(cats) ? cats.filter(Boolean) : [];
}

function validityFor(rec) {
  const r = Number(rec.rewards_validity_days || 0);
  const v = Number(rec.validity_days || r || 30);
  return { validityDays: v, rewardsValidityDays: r };
}

// ── Campaign intro line generator ───────────────────────────────────────────
// Produces a short, punchy intro sentence based on bonus type + campaign context.
// Goes above the stats table. Variables are filled from the record.

function campaignIntroEn(rec, bonusType) {
  const bt = bonusType.toLowerCase();
  const subType = String(rec.bonus_sub_type || rec.parsed?.bonus_sub_type || '').toLowerCase();
  const campaign = String(rec.campaign || '').toLowerCase();
  const tier = String(rec.tier || rec.parsed?.tier || '').toLowerCase();
  const pref = currPrefix(rec);

  if (bt.includes('deposit')) {
    if (subType.includes('welcome') || campaign.includes('welcome'))
      return 'Start strong! Enjoy a Welcome Bonus on your first deposit.';
    if (tier.includes('vip') || tier.includes('diamond') || tier.includes('platinum'))
      return 'An exclusive reward for our valued members — claim your VIP Reload Bonus today!';
    if (campaign.includes('comeback') || campaign.includes('churned'))
      return 'We want you back! Claim your Comeback Reload Bonus and get back in the game.';
    if (campaign.includes('june') || campaign.includes('check-in') || campaign.includes('checkin')) {
      const pct = Number(rec.bonus_pct ?? rec.parsed?.bonus_rate_pct ?? 0);
      const pctPart = pct > 0 ? `${pct}%` : '';
      return `You earned it! As a reward for your June Check-In activity, claim your ${pctPart} Reload Bonus — make a deposit and we'll top it up!`.replace('  ', ' ');
    }
    return 'Boost your balance! Make a deposit and receive bonus credits to play more of what you love.';
  }

  if (bt.includes('free credit') || bt === 'fc') {
    const amount = Number(rec.free_credit_amount ?? rec.parsed?.free_credit_amount ?? 0);
    const amountStr = amount > 0 ? `${pref} ${amount}` : '';
    if (tier.includes('vip') || tier.includes('diamond') || tier.includes('platinum'))
      return `A special gift just for you — claim your ${amountStr} Free Credit and play your favourites!`.replace('  ', ' ');
    if (campaign.includes('comeback') || campaign.includes('churned'))
      return `We miss you! Here's ${amountStr} Free Credit to welcome you back.`.replace('  ', ' ');
    if (campaign.toLowerCase().includes('june') || campaign.toLowerCase().includes('check-in') || campaign.toLowerCase().includes('checkin'))
      return `You earned it! As a reward for your June Check-In activity, enjoy ${amountStr} free credits on us — no deposit needed.`.replace('  ', ' ');
    const minD = Number(rec.min_deposit ?? rec.parsed?.min_deposit ?? 0);
    const noDep = minD === 0 ? ' — no deposit needed' : '';
    return `Free credits, real wins! Enjoy ${amountStr} bonus credits on us${noDep}.`.replace('  ', ' ');
  }

  if (bt.includes('free spin') || bt === 'fs') {
    const rounds = Number(rec.fs_rounds ?? rec.parsed?.spin_count ?? 0);
    const game = rec.parsed?.game || rec.fs_game || '';
    const minD = Number(rec.min_deposit ?? rec.parsed?.min_deposit ?? 0);
    const minPart = minD > 0 ? ` with just ${pref} ${minD}` : '';
    if (tier.includes('vip') || tier.includes('diamond') || tier.includes('platinum'))
      return `Exclusive spins just for you — enjoy ${rounds} Free Spins on ${game}!`;
    return `Spin to win! Claim your ${rounds} Free Spins on ${game}${minPart} and chase those big wins!`;
  }

  return '';
}

function campaignIntroZh(rec, bonusType) {
  const bt = bonusType.toLowerCase();
  const subType = String(rec.bonus_sub_type || rec.parsed?.bonus_sub_type || '').toLowerCase();
  const campaign = String(rec.campaign || '').toLowerCase();
  const tier = String(rec.tier || rec.parsed?.tier || '').toLowerCase();
  const pref = currPrefix(rec);

  if (bt.includes('deposit')) {
    if (subType.includes('welcome') || campaign.includes('welcome'))
      return '强势开局！首次存款即可享受欢迎红利。';
    if (tier.includes('vip') || tier.includes('diamond') || tier.includes('platinum'))
      return '尊贵会员专属奖励 — 立即领取您的VIP充值红利！';
    if (campaign.includes('comeback') || campaign.includes('churned'))
      return '欢迎回来！领取您的回归充值红利，重新加入游戏！';
    if (campaign.includes('june') || campaign.includes('check-in') || campaign.includes('checkin')) {
      const pct = Number(rec.bonus_pct ?? rec.parsed?.bonus_rate_pct ?? 0);
      const pctPart = pct > 0 ? `${pct}%` : '';
      return `您坚持每日签到，我们为您送上奖励！作为六月签到活动的感谢，存款即享 ${pctPart} 充值红利！`;
    }
    return '提升您的余额！立即存款，获取更多红利畅玩您喜爱的游戏。';
  }

  if (bt.includes('free credit') || bt === 'fc') {
    const amount = Number(rec.free_credit_amount ?? rec.parsed?.free_credit_amount ?? 0);
    const amountStr = amount > 0 ? `${pref} ${amount}` : '';
    if (tier.includes('vip') || tier.includes('diamond') || tier.includes('platinum'))
      return `专属礼物 — 领取 ${amountStr} 免费分数，畅玩您喜爱的游戏！`;
    if (campaign.includes('comeback') || campaign.includes('churned'))
      return `我们想念您！送您 ${amountStr} 免费分数，欢迎回来。`;
    if (campaign.toLowerCase().includes('june') || campaign.toLowerCase().includes('check-in') || campaign.toLowerCase().includes('checkin'))
      return `您坚持每日签到，我们为您送上奖励！作为六月签到活动的感谢，${amountStr} 免费分数送给您，无需存款。`;
    const minD = Number(rec.min_deposit ?? rec.parsed?.min_deposit ?? 0);
    const noDep = minD === 0 ? '，无需存款' : '';
    return `免费分数，真实奖金！享受 ${amountStr} 红利${noDep}。`;
  }

  if (bt.includes('free spin') || bt === 'fs') {
    const rounds = Number(rec.fs_rounds ?? rec.parsed?.spin_count ?? 0);
    const game = rec.parsed?.game || rec.fs_game || '';
    const minD = Number(rec.min_deposit ?? rec.parsed?.min_deposit ?? 0);
    const minPart = minD > 0 ? `仅需存款 ${pref} ${minD}，` : '';
    if (tier.includes('vip') || tier.includes('diamond') || tier.includes('platinum'))
      return `尊贵会员专属 — 在 ${game} 畅享 ${rounds} 次免费旋转！`;
    return `${minPart}领取 ${rounds} 次免费旋转，在 ${game} 赢取丰厚奖金！`;
  }

  return '';
}

// ── Deposit Bonus T&C (5 clauses — matches finalized Google Doc) ─────────────
// Stats table already shows Min Deposit / Max Bonus / Turnover — don't repeat.

function buildDepEn(rec) {
  const pref  = currPrefix(rec);
  const minD  = Number(rec.min_deposit ?? rec.parsed?.min_deposit ?? 0);
  const maxB  = Number(rec.cap_bonus_amount ?? rec.parsed?.max_bonus ?? 0);
  const to    = Number(rec.turnover_multiplier ?? rec.parsed?.to_multiplier ?? 0);
  const { validityDays } = validityFor(rec);
  const name  = rec.promotion_name_en || rec.promotion_name || '';
  const brand = brandName(rec);
  const url   = tncUrl(rec, 'en');
  const cats  = categoriesFor(rec);
  const link  = tncLinkPhrase(url, false);

  const stats = statsTable(
    ['Min Deposit', 'Max Bonus', 'Turnover'],
    [`${pref} ${minD}`, maxB ? `${pref} ${maxB}` : '–', `${to}x`],
  );

  const vWords = digitToWords(validityDays);

  const clauses = clauseTable(
    `<p style="color: rgb(85, 85, 85);"><br></p>` +
    p(bold('Terms and Conditions:')) +
    p(`1. Bonuses are valid for ${vWords} (${validityDays}) ${validityDays === 1 ? 'day' : 'days'} upon issuance unless stated otherwise.`) +
    p('2. Each member can claim this promotion only once.') +
    p(`3. ${fcCatClause(cats, false)}`) +
    p('4. Promotion codes are time-limited and cannot be extended once expired.') +
    p(`5. General ${brand} ${link} apply.`),
  );
  const intro = campaignIntroEn(rec, 'deposit');
  const introHtml = intro ? `<p style="color: rgb(85, 85, 85); font-style: italic;">${intro}</p>` : '';
  return h4(`<font color="#797979">${bold(name)}</font><br><hr style="color: rgb(121, 121, 121); font-size: 14px;">${introHtml}${stats}`) + h4(clauses);
}

function buildDepZh(rec) {
  const pref  = currPrefix(rec);
  const minD  = Number(rec.min_deposit ?? rec.parsed?.min_deposit ?? 0);
  const maxB  = Number(rec.cap_bonus_amount ?? rec.parsed?.max_bonus ?? 0);
  const to    = Number(rec.turnover_multiplier ?? rec.parsed?.to_multiplier ?? 0);
  const { validityDays } = validityFor(rec);
  const name  = rec.promotion_name_zh_id || rec.promotion_name_en || rec.promotion_name || '';
  const brand = brandName(rec);
  const url   = tncUrl(rec, 'zh');
  const cats  = categoriesFor(rec);
  const link  = tncLinkPhrase(url, true);

  const stats = statsTable(
    ['最低存款金额', '最高红利金额', '流水量（倍数)'],
    [`${pref} ${minD}`, maxB ? `${pref} ${maxB}` : '–', `${to}x`],
  );

  const clauses = clauseTable(
    `<p><br></p>` +
    p(bold('条款与条件：')) +
    p(`1. 红利自发放之日起 ${validityDays} 天内有效，除非另有说明。`) +
    p('2. 每位会员仅限领取一次此优惠。') +
    p(`3. ${fcCatClause(cats, true)}`) +
    p('4. 优惠码有时间限制，一旦过期将无法延长。') +
    p(`5. 适用 ${brand} 一般${link}。`),
  );
  const intro = campaignIntroZh(rec, 'deposit');
  const introHtml = intro ? `<p style="font-style: italic;">${intro}</p>` : '';
  return h4(`<p>${bold(name)}</p><hr>${introHtml}${stats}`) + h4(clauses);
}

// ── Free Credit T&C (6 clauses — matches finalized Google Doc) ──────────────
// Stats table already shows Free Credit Amount / Turnover — don't repeat.

function buildFcEn(rec) {
  const pref     = currPrefix(rec);
  const amount   = Number(rec.free_credit_amount ?? rec.parsed?.free_credit_amount ?? 0);
  const minD     = Number(rec.min_deposit ?? rec.parsed?.min_deposit ?? 0);
  const maxXfer  = Number(rec.max_transfer_out ?? rec.parsed?.max_transfer_out ?? 0);
  const to       = Number(rec.turnover_multiplier ?? rec.parsed?.to_multiplier ?? 0);
  const { validityDays } = validityFor(rec);
  const name     = rec.promotion_name_en || rec.promotion_name || '';
  const brand    = brandName(rec);
  const url      = tncUrl(rec, 'en');
  const cats     = categoriesFor(rec);
  const link     = tncLinkPhrase(url, false);

  const headers = minD > 0
    ? ['Min Deposit', 'Free Credit Amount', 'Turnover']
    : ['Free Credit Amount', 'Turnover'];
  const values  = minD > 0
    ? [`${pref} ${minD}`, `${pref} ${amount}`, `${to}x`]
    : [`${pref} ${amount}`, `${to}x`];

  const stats = statsTable(headers, values);

  // Clause 1: only present when an explicit cap is set (maxXfer > 0).
  // When absent, renumber 2→5 so total clause count drops to 5.
  const wcAmount = maxXfer > 0 ? maxXfer : 0;
  const vWords = digitToWords(validityDays);

  const fcClausesEn = [];
  if (wcAmount > 0) fcClausesEn.push(`Maximum withdrawal is ${pref} ${wcAmount} only.`);
  fcClausesEn.push(`Bonuses are valid for ${vWords} (${validityDays}) ${validityDays === 1 ? 'day' : 'days'} upon issuance unless stated otherwise.`);
  fcClausesEn.push(`Each member can claim this promotion only once.`);
  fcClausesEn.push(fcCatClause(cats, false));
  fcClausesEn.push(`Promotion codes are time-limited and cannot be extended once expired.`);
  fcClausesEn.push(`General ${brand} ${link} apply.`);

  const clauses = clauseTable(
    `<p style="color: rgb(85, 85, 85);"><br></p>` +
    p(bold('Terms and Conditions:')) +
    fcClausesEn.map((c, i) => p(`${i + 1}. ${c}`)).join(''),
  );
  const intro = campaignIntroEn(rec, 'free credit');
  const introHtml = intro ? `<p style="color: rgb(85, 85, 85); font-style: italic;">${intro}</p>` : '';
  return h4(`<font color="#797979">${bold(name)}</font><br><hr style="color: rgb(121, 121, 121); font-size: 14px;">${introHtml}${stats}`) + h4(clauses);
}

function buildFcZh(rec) {
  const pref     = currPrefix(rec);
  const amount   = Number(rec.free_credit_amount ?? rec.parsed?.free_credit_amount ?? 0);
  const minD     = Number(rec.min_deposit ?? rec.parsed?.min_deposit ?? 0);
  const maxXfer  = Number(rec.max_transfer_out ?? rec.parsed?.max_transfer_out ?? 0);
  const to       = Number(rec.turnover_multiplier ?? rec.parsed?.to_multiplier ?? 0);
  const { validityDays } = validityFor(rec);
  const name     = rec.promotion_name_zh_id || rec.promotion_name_en || rec.promotion_name || '';
  const brand    = brandName(rec);
  const url      = tncUrl(rec, 'zh');
  const cats     = categoriesFor(rec);
  const link     = tncLinkPhrase(url, true);

  const headers = minD > 0
    ? ['最低存款金额', '免费分数', '流水量']
    : ['免费分数', '流水量'];
  const values  = minD > 0
    ? [`${pref} ${minD}`, `${pref} ${amount}`, `${to}x`]
    : [`${pref} ${amount}`, `${to}x`];

  const stats = statsTable(headers, values);

  const wcAmountZh = maxXfer > 0 ? maxXfer : 0;

  const fcClausesZh = [];
  if (wcAmountZh > 0) fcClausesZh.push(`最高提款金额仅为 ${pref} ${wcAmountZh}。`);
  fcClausesZh.push(`红利自发放之日起 ${validityDays} 天内有效，除非另有说明。`);
  fcClausesZh.push(`每位会员仅限领取一次此优惠。`);
  fcClausesZh.push(fcCatClause(cats, true));
  fcClausesZh.push(`优惠码有时间限制，一旦过期将无法延长。`);
  fcClausesZh.push(`适用 ${brand} 一般${link}。`);

  const clauses = clauseTable(
    `<p><br></p>` +
    p(bold('条款与条件：')) +
    fcClausesZh.map((c, i) => p(`${i + 1}. ${c}`)).join(''),
  );
  const intro = campaignIntroZh(rec, 'free credit');
  const introHtml = intro ? `<p style="font-style: italic;">${intro}</p>` : '';
  return h4(`<p>${bold(name)}</p><hr>${introHtml}${stats}`) + h4(clauses);
}

// ── Free Spin T&C (6 clauses + How to Apply — matches finalized Google Doc) ──
// Doc structure: intro → How to Apply (3 steps) → T&C (6 clauses).
// TO formula uses doc format: (Deposit × N) + (Free Spin Winning Amount × N).

function fsHowToApplyEn(rec) {
  const provider = gameProviderName(rec);
  const game = rec.parsed?.game || rec.fs_game || '';
  const rounds = Number(rec.fs_rounds ?? rec.parsed?.spin_count ?? 0);
  return (
    p(bold('How to Apply:')) +
    p(`1. To apply for this promotion, simply head over to the Deposit page and complete a deposit transaction with the bonus option [${rounds} Free Spins - ${game}] selected.`) +
    p(`2. After the deposit is successfully approved, go to ${bold('Home')} > ${bold('Slots')} > ${bold(`[${provider}]`)} and launch the game ${game}.`) +
    p('3. Spin and enjoy!')
  );
}

function fsHowToApplyZh(rec) {
  const provider = gameProviderName(rec);
  const game = rec.parsed?.game || rec.fs_game || '';
  const rounds = Number(rec.fs_rounds ?? rec.parsed?.spin_count ?? 0);
  return (
    p(bold('如何申请：')) +
    p(`1. 前往存款页面，选择红利选项 [${rounds} 免费旋转 - ${game}]，完成一笔存款交易即可申请此优惠。`) +
    p(`2. 存款成功批准后，前往 ${bold('首页')} > ${bold('老虎机')} > ${bold(`[${provider}]`)} 并启动游戏 ${game}。`) +
    p('3. 开始旋转，尽情享受！')
  );
}

function buildFsEn(rec) {
  const rounds   = Number(rec.fs_rounds ?? rec.parsed?.spin_count ?? 0);
  const bet      = rec.fs_amount_per_bet ?? rec.parsed?.value_per_spin;
  const pref     = currPrefix(rec);
  const minD     = Number(rec.min_deposit ?? rec.parsed?.min_deposit ?? 0);
  const to       = Number(rec.turnover_multiplier ?? rec.parsed?.to_multiplier ?? 0);
  const { validityDays } = validityFor(rec);
  const name     = rec.promotion_name_en || rec.promotion_name || '';
  const brand    = brandName(rec);
  const url      = tncUrl(rec, 'en');
  const link     = tncLinkPhrase(url, false);

  const betLabel = bet != null ? `${pref} ${bet}` : '–';
  const stats = statsTable(
    ['Free Spins', 'Bet Value', 'Turnover'],
    [`${rounds}`, betLabel, `${to}x`],
  );

  const c1 = minD > 0
    ? `Minimum deposit amount to claim this promotion is ${pref} ${minD}.`
    : `No minimum deposit is required to claim this promotion.`;

  const vWords = digitToWords(validityDays);

  // How to Apply section (between intro and T&C, inside the first h4 block)
  const howTo = fsHowToApplyEn(rec);

  const clauses = clauseTable(
    `<p style="color: rgb(85, 85, 85);"><br></p>` +
    p(bold('Terms & Conditions:')) +
    p(`1. ${c1}`) +
    p(`2. Bonuses are valid for ${vWords} (${validityDays}) ${validityDays === 1 ? 'day' : 'days'} upon issuance unless stated otherwise.`) +
    p('3. Each member can claim this promotion only once.') +
    p(`4. Turnover Requirement for this promotion is ${to}x. Example as follows (Deposit × ${to}) + (Free Spin Winning Amount × ${to}).`) +
    p('5. Promotion codes are time-limited and cannot be extended once expired.') +
    p(`6. General ${brand} ${link} apply.`),
  );
  const intro = campaignIntroEn(rec, 'free spin');
  const introHtml = intro ? `<p style="color: rgb(85, 85, 85); font-style: italic;">${intro}</p>` : '';
  return h4(`<font color="#797979">${bold(name)}</font><br><hr style="color: rgb(121, 121, 121); font-size: 14px;">${introHtml}${howTo}${stats}`) + h4(clauses);
}

function buildFsZh(rec) {
  const rounds   = Number(rec.fs_rounds ?? rec.parsed?.spin_count ?? 0);
  const bet      = rec.fs_amount_per_bet ?? rec.parsed?.value_per_spin;
  const pref     = currPrefix(rec);
  const minD     = Number(rec.min_deposit ?? rec.parsed?.min_deposit ?? 0);
  const to       = Number(rec.turnover_multiplier ?? rec.parsed?.to_multiplier ?? 0);
  const { validityDays } = validityFor(rec);
  const name     = rec.promotion_name_zh_id || rec.promotion_name_en || rec.promotion_name || '';
  const brand    = brandName(rec);
  const url      = tncUrl(rec, 'zh');
  const link     = tncLinkPhrase(url, true);

  const betLabel = bet != null ? `${pref} ${bet}` : '–';
  const stats = statsTable(
    ['免费旋转次数', '每次旋转金额', '流水量（倍数)'],
    [`${rounds}`, betLabel, `${to}x`],
  );

  const c1 = minD > 0
    ? `申请此优惠的最低存款金额为 ${pref} ${minD}。`
    : `领取此优惠无需存款。`;

  const howTo = fsHowToApplyZh(rec);

  const clauses = clauseTable(
    `<p><br></p>` +
    p(bold('条款与条件：')) +
    p(`1. ${c1}`) +
    p(`2. 红利自发放之日起 ${validityDays} 天内有效，除非另有说明。`) +
    p('3. 每位会员仅限领取一次此优惠。') +
    p(`4. 本优惠的流水要求为 ${to} 倍。计算方式如下：（存款金额 × ${to}）+（免费旋转奖金 × ${to}）。`) +
    p('5. 优惠码有时间限制，一旦过期将无法延长。') +
    p(`6. 适用 ${brand} 一般${link}。`),
  );
  const intro = campaignIntroZh(rec, 'free spin');
  const introHtml = intro ? `<p style="font-style: italic;">${intro}</p>` : '';
  return h4(`<p>${bold(name)}</p><hr>${introHtml}${howTo}${stats}`) + h4(clauses);
}

// ── Main export ──────────────────────────────────────────────────────────────

// Returns { Locale, PromotionRewardName, Content } for a given locale.
// bonusTypeLower: 'deposit' | 'free credit' | 'fc' | 'free spin' | 'fs'
export function buildTncRow(rec, locale, bonusTypeLower) {
  const bt = bonusTypeLower.toLowerCase();
  const isZh = locale === 'zh';
  let content;

  if (bt.includes('deposit')) {
    content = isZh ? buildDepZh(rec) : buildDepEn(rec);
  } else if (bt.includes('free credit') || bt === 'fc') {
    content = isZh ? buildFcZh(rec) : buildFcEn(rec);
  } else if (bt.includes('free spin') || bt === 'fs') {
    content = isZh ? buildFsZh(rec) : buildFsEn(rec);
  } else {
    content = '';
  }

  const rewardName = isZh
    ? (rec.promotion_name_zh_id || rec.promotion_name_en || rec.promotion_name || '')
    : (rec.promotion_name_en || rec.promotion_name || '');

  return { Locale: locale, PromotionRewardName: rewardName, Content: content };
}

// Returns true if ZH should be included based on the record's regions/locales.
export function needsZh(rec) {
  const regions = rec.regions || [];
  if (regions.some((r) => ZH_REGIONS.has(String(r).toUpperCase()))) return true;
  const locales = rec.locales || [];
  return locales.some((l) => l.startsWith('MY_') || l.startsWith('SG_'));
}
