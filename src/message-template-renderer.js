// Renders the per-locale body for a 6.6 Message Template by loading the
// authored HTML body, substituting placeholders, and resolving the brand /
// merchant / URL bindings against `data/brand-directory.json`.
//
// Designed for the canary's `message_template_create` action handler. Returns
// a final HTML string ready to paste into the BO's CKEditor (via setData on
// the editor instance, or innerHTML on the contenteditable as a fallback).
//
// Lookup:
//   src/message-template-bodies/<slug>/<docKey>.html
//     slug: 'deposit' | 'free-credit' | 'free-spin'
//     docKey: 'EN' | 'ZH' | 'TH' | 'ID'
//
// Locale tab → docKey:
//   *_EN  → EN
//   *_ZH  → ZH
//   TH_*  → TH
//   ID_*  → ID
//
// Cashback is intentionally NOT supported — the mapper should skip
// `message_template_create` for cashback requests until T&Cs land.

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND_TO_SITE } from './ingest.js';
import { fileURLToPath } from 'node:url';
import { generateCopy } from './copy-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');

// Locale region → canonical currency code. Used to render the correct
// currency amounts per locale (SG_EN → SGD, MY_EN → MYR, ID_* → IDR).
const LOCALE_TO_CURRENCY = {
  MY: 'MYR', SG: 'SGD', ID: 'IDR', TH: 'THB', KH: 'KHR', AU: 'AUD',
};

// Brand directory loaded once (small JSON). Resolves at module load time.
const BRAND_DIRECTORY_PATH = path.join(REPO_ROOT, 'data', 'brand-directory.json');
const BRAND_DIRECTORY = existsSync(BRAND_DIRECTORY_PATH)
  ? JSON.parse(readFileSync(BRAND_DIRECTORY_PATH, 'utf8'))
  : { qpro: {}, qp2: {} };

// ── Public API ────────────────────────────────────────────────────────

export function bonusTypeSlug(bonusType) {
  const bt = String(bonusType || '').toLowerCase();
  if (bt.includes('cashback')) return null;     // deliberately unsupported
  if (bt.includes('free spin')) return 'free-spin';
  if (bt.includes('free credit')) return 'free-credit';
  if (bt.includes('deposit')) return 'deposit';
  return null;
}

export function localeDocKey(locale) {
  const s = String(locale || '').toUpperCase();
  if (s.endsWith('_EN')) return 'EN';
  if (s.endsWith('_ZH')) return 'ZH';
  if (s.startsWith('TH')) return 'TH';
  if (s.startsWith('ID')) return 'ID';
  if (s === 'EN' || s === 'ZH' || s === 'TH' || s === 'ID') return s;
  return null;
}

export function resolveBrand({ platform, brand }) {
  const table = BRAND_DIRECTORY[String(platform || '').toLowerCase()] || {};
  return table[brand] || null;
}

// T&C term per locale (localized words wrapped by the hyperlink).
const TNC_TERM_BY_DOCKEY = {
  EN: 'Terms and Conditions',
  ZH: '条款与条件',
  ID: 'Syarat dan Ketentuan',
  TH: 'ข้อกำหนดและเงื่อนไข',
};

// Strip the routing suffix off a brand URL ("/landing", "/en-my/home",
// "/en", "/id", "/landing/") so we can append a clean T&C path.
function stripBrandUrlSuffix(url) {
  if (!url) return null;
  return String(url)
    .replace(/\/+$/, '')
    .replace(/\/(?:landing|home|login)\/?$/i, '')
    .replace(/\/(?:en|zh|id|th|km|bm)(?:-[a-z]{2})?\/?(?:home|landing)?$/i, '');
}

// Build the T&C hyperlink HTML snippet for one locale. Returns null when the
// brand directory has no tncDomain or website — caller should fall back to
// plain text. Prefers `tncDomain` (probed from live BO content 2026-05-20)
// over `website` because the T&C is often hosted on a different domain than
// the marketing site (e.g. QP2C marketing = ace66.com, T&C = ace66my.co).
export function buildTncLinkHtml({ platform, locale, brandInfo }) {
  const base = stripBrandUrlSuffix(brandInfo?.tncDomain || brandInfo?.website);
  if (!base) return null;
  const dk = localeDocKey(locale);
  const term = TNC_TERM_BY_DOCKEY[dk] || TNC_TERM_BY_DOCKEY.EN;
  if (String(platform || '').toLowerCase() === 'qp2') {
    // QP2 uses a shared BO: the BO substitutes :url with the merchant's site URL at
    // display time — do NOT bake in a real domain here, keep the BO placeholder literal.
    // Fix: QC 2026-05-26 (P106-P115 batch) — previously used base+domain which caused
    // all QP2 message templates to link to a hardcoded brand URL instead of letting the
    // BO substitute per-merchant.
    return `<a target="_blank" href=":url/terms-conditions">${term}</a>`;
  }
  // Default = QPRO. Live operator-edited template QPRO4#325 used /en-my/
  // for both EN + ZH; we keep the same convention here.
  return `<a href="${base}/en-my/info-center/terms-and-conditions">${term}</a>`;
}

// Sentence-11 T&C post-process: in the <li> that has `:url/terms-conditions`
// as plain text, wrap the localized T&C term with a hyperlink using the :url
// placeholder. Applies to Deposit/FC templates (which use <li>). FS templates
// use <p> and the `:url/terms-conditions` parameter is left as-is — the BO
// resolves it at display time without needing an explicit <a> tag.
function hyperlinkTnc(html, docKey, platform) {
  const term = TNC_TERM_BY_DOCKEY[docKey] || TNC_TERM_BY_DOCKEY.EN;
  const targetAttr = String(platform || '').toLowerCase() === 'qp2' ? ' target="_blank"' : '';
  const link = `<a${targetAttr} href=":url/terms-conditions">${term}</a>`;
  return html.replace(/<li>([^<]*)\s*:url\/terms-conditions\s*([^<]*)<\/li>/, (m, before, after) => {
    const linked = before.includes(term)
      ? before.replace(term, link)
      : before.trimEnd() + ' ' + link;
    return `<li>${(linked + after).trimEnd()}</li>`;
  });
}

// Sub-exclusion items per eligible category (Sports+Slots combination).
const CAT_SUB_EXCLUSIONS = {
  EN: { Sports: ['Virtual Sports', 'Number Games'], Slots: ['Table games', 'Arcade games'], 'Live Casino': ['Blackjack'] },
  ZH: { Sports: ['虚拟体育', '数字游戏'],           Slots: ['桌面游戏', '街机'],             'Live Casino': ['二十一点'] },
};

// Build the complete category clause sentence for deposit promos.
// When the eligible cats have known sub-exclusions (Sports / Slots), generates
// the full "X categories are eligible except Y." text. Otherwise generates the
// simple "eligible game categories are X." fallback. Returns '' for all-categories
// (the template handles that branch with {{excluded_categories}} instead).
function buildDepositCatClause(cats, docKey) {
  if (cats.length === 0) return ''; // all_categories branch handles this
  const table = CAT_SUB_EXCLUSIONS[docKey] || CAT_SUB_EXCLUSIONS.EN;
  const normalized = cats.map((c) => (c === 'Slot' ? 'Slots' : c));
  const subItems = normalized.flatMap((c) => table[c] || []);

  if (subItems.length > 0) {
    if (docKey === 'ZH') {
      const catZh = normalized.map((c) => CATEGORY_TRANSLATIONS.ZH[c] || c);
      const catText = catZh.length === 1 ? catZh[0]
        : catZh.slice(0, -1).join('、') + '及' + catZh[catZh.length - 1];
      const exclText = subItems.length === 1 ? subItems[0]
        : subItems.slice(0, -1).join('、') + '及' + subItems[subItems.length - 1];
      return `本优惠适用于${catText}游戏类别，惟${exclText}除外。`;
    }
    const catText = joinCategories(cats, 'EN');
    const exclText = subItems.length === 1 ? subItems[0]
      : subItems.length === 2 ? `${subItems[0]} and ${subItems[1]}`
      : `${subItems.slice(0, -1).join(', ')}, and ${subItems[subItems.length - 1]}`;
    const verb = cats.length === 1 ? 'category is' : 'categories are';
    return `${catText} ${verb} eligible for this promotion except ${exclText}.`;
  }

  // No sub-exclusions — simple eligible list
  const eligibles = joinCategories(cats, docKey);
  return docKey === 'ZH'
    ? `本优惠适用于以下游戏类别：${eligibles}。`
    : `The eligible game categories for this promotion are ${eligibles}.`;
}

export function getCurrencySymbol(currency) {
  // House style varies (RM vs MYR in source docs) — use the currency code
  // verbatim. The doc's "RM" appears in informal T&C prose; templates anchor
  // on the code form (MYR / SGD / IDR / THB / AUD / KHR).
  return String(currency || '').toUpperCase() || 'MYR';
}

const ENGLISH_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty',
];

export function digitToWords(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return String(n);
  if (v <= 20) return ENGLISH_WORDS[v];
  if (v < 100) {
    const tens = Math.floor(v / 10);
    const ones = v % 10;
    const tensWord = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'][tens];
    return ones === 0 ? tensWord : `${tensWord}-${ENGLISH_WORDS[ones]}`;
  }
  return String(v); // 100+ — leave as digit form
}

// ── Subject lines (per locale + bonus type) ───────────────────────────
// Falls back to the promo's display name if no template-of-record subject
// is available. Subjects are short; we don't bother loading them from files.

const SUBJECT_TEMPLATES = {
  // Per operator 2026-05-20: Deposit Bonus subject is just "Exclusive Offer"
  // across locales — no percentage, no sub-type. Previously had
  // "{{bonus_pct}}% Reload Bonus - Exclusive Offer" which read awkwardly.
  deposit: {
    EN: 'Exclusive Offer',
    ZH: '独家优惠',
    TH: 'Exclusive Offer',
    ID: 'Penawaran Eksklusif',
  },
  // 2026-05-14 (operator confirmed): VIP-targeted FC has different subjects
  // per locale. EN/ZH put "VIP" first; ID puts "VIP" AFTER "Penawaran
  // Eksklusif" (operator's authentic ID subject: "Penawaran Eksklusif VIP -
  // 30 Kredit Gratis"). Two distinct slugs avoid prefix-position hacks.
  // Non-VIP convention TBC — defaults to "Exclusive Offer" until operator
  // confirms. No currency code in the subject (matches operator style).
  'free-credit': {
    EN: 'Exclusive Offer - {{free_credit_amount}} Free Credit',
    ZH: '专属优惠 - {{free_credit_amount}} 免费彩金',
    TH: 'Exclusive Offer - {{free_credit_amount}} Free Credit',
    ID: 'Penawaran Eksklusif - {{free_credit_amount}} Kredit Gratis',
  },
  'free-credit-vip': {
    EN: 'VIP Exclusive Offer - {{free_credit_amount}} Free Credit',
    ZH: 'VIP 专属优惠 - {{free_credit_amount}} 免费彩金',
    TH: 'VIP Exclusive Offer - {{free_credit_amount}} Free Credit',
    ID: 'Penawaran Eksklusif VIP - {{free_credit_amount}} Kredit Gratis',
  },
  'free-spin': {
    EN: 'Claim Your {{spin_count}} Free Spins on {{game_name}}',
    ZH: '领取{{spin_count}}次免费旋转 – {{game_name}}',
    TH: '{{spin_count}} ฟรีสปิน บน {{game_name}}',
    ID: '{{spin_count}} Putaran Gratis di {{game_name}}',
  },
};

const BONUS_SUBTYPE_ZH = {
  Welcome: '欢迎',
  Reload:  '续存红利',
  Cashback: '返水',
};

// Maps instruction-format category codes (from instructions.categories_only)
// to the display names that CATEGORY_TRANSLATIONS understands.
const INSTRUCTION_CAT_MAP = {
  'SPORT': 'Sports', 'SPORTS': 'Sports',
  'SLOTS': 'Slot',   'SLOT': 'Slot',
  'LC': 'Live Casino', 'LIVE_CASINO': 'Live Casino', 'LIVE CASINO': 'Live Casino',
  'ESPORT': 'E-Sports', 'ESPORTS': 'E-Sports',
  'FISHING': 'Fishing', 'CRASH': 'Crash', 'ARCADE': 'Arcade',
  'LOTTERY': 'Lottery', 'TABLE': 'Table',
};

// Category name translations for the per-locale Eligible Categories list.
// Source: matches the prose in the ZH/TH/ID inbox T&C docs where possible.
// Fallback: when a category isn't mapped, the English name is used as-is.
const CATEGORY_TRANSLATIONS = {
  // EN: normalize singular casino-genre names to plural / standard form
  // (operator rule 2026-05-14: house copy is "Slots", never "Slot").
  EN: {
    'Slot': 'Slots',
  },
  ZH: {
    'Slot':         '老虎机',
    'Slots':        '老虎机',
    'Live Casino':  '真人娱乐场',
    'Sports':       '体育',
    'E-Sports':     '电子竞技',
    'eSports':      '电子竞技',
    'Fishing':      '捕鱼',
    'Crash':        'Crash',
    'Arcade':       '街机',
    'Lottery':      '彩票',
    'Table':        '桌面游戏',
    'Cock Fight':   '斗鸡',
    'Scratchcard':  '刮刮乐',
    'Video Poker':  '视频扑克',
    'Bingo':        '宾果',
  },
  TH: {
    'Slot':         'สล็อต',
    'Slots':        'สล็อต',
    'Live Casino':  'คาสิโนสด',
    'Sports':       'กีฬา',
    'E-Sports':     'อีสปอร์ต',
    'Fishing':      'เกมยิงปลา',
    'Crash':        'แครช',
    'Arcade':       'อาร์เคด',
    'Lottery':      'ลอตเตอรี่',
    'Table':        'เกมโต๊ะ',
  },
  ID: {
    'Slot':         'Slot',
    'Slots':        'Slot',
    'Live Casino':  'Live Casino',
    'Sports':       'Olahraga',
    'E-Sports':     'E-Sports',
    'Fishing':      'Memancing',
    'Crash':        'Crash',
    'Arcade':       'Arkade',
    'Lottery':      'Lotere',
    'Table':        'Permainan Meja',
  },
};

function joinCategories(categories, docKey) {
  const table = CATEGORY_TRANSLATIONS[docKey] || {};
  const translated = categories.map((c) => table[c] || c);
  if (translated.length === 0) {
    // Locale-specific "All" text
    return docKey === 'ZH' ? '所有' : docKey === 'TH' ? 'ทั้งหมด' : docKey === 'ID' ? 'Semua' : 'All';
  }
  if (translated.length === 1) return translated[0];
  if (docKey === 'EN') {
    // 2 items: "X and Y" (no Oxford comma). 3+ items: "X, Y, and Z" (Oxford).
    if (translated.length === 2) return `${translated[0]} and ${translated[1]}`;
    return `${translated.slice(0, -1).join(', ')}, and ${translated[translated.length - 1]}`;
  }
  // ZH/TH/ID — use the Chinese list comma "、" for ZH, regular comma+space
  // for TH/ID. None of these languages typically need an "and" connector.
  const sep = docKey === 'ZH' ? '、' : ', ';
  return translated.join(sep);
}

// ── Body file loading + caching ───────────────────────────────────────

const bodyCache = new Map();

async function loadBody(slug, docKey) {
  const key = `${slug}/${docKey}`;
  if (bodyCache.has(key)) return bodyCache.get(key);
  const filePath = path.join(REPO_ROOT, 'src', 'message-template-bodies', slug, `${docKey}.html`);
  const html = await readFile(filePath, 'utf8');
  // Strip the leading authoring comment (<!-- ... -->) — CKEditor doesn't
  // need it and it shows in source view if pasted.
  const stripped = html.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
  bodyCache.set(key, stripped);
  return stripped;
}

// ── Placeholder substitution ──────────────────────────────────────────

function applyConditionals(template, flags) {
  // Block form: {{#if_xxx}}A{{else}}B{{/if}}  OR  {{#if_xxx}}A{{/if}}
  // Resolved before scalar substitution so the conditional bodies can
  // contain their own placeholders.
  return template.replace(
    /\{\{#if_([a-zA-Z0-9_]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
    (_match, flag, ifBody, elseBody = '') => (flags[flag] ? ifBody : elseBody)
  );
}

function applyScalars(template, vars) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m;
  });
}

// NOTE: We deliberately do NOT substitute :brandname / :merchantname / :url
// in the rendered output. The BO does that at message-display time per
// brand. Substituting client-side bakes "MSB66" into the body and would
// break the moment the template is ever re-used or audited from a
// different brand context. Keep the placeholders literal.

// ── Render entry point ────────────────────────────────────────────────

export async function renderBody({ bonusType, locale, brand, platform, resolved }) {
  const slug = bonusTypeSlug(bonusType);
  if (!slug) {
    return { html: null, subject: null, skipped: true, reason: `unsupported bonusType "${bonusType}"` };
  }
  const docKey = localeDocKey(locale);
  if (!docKey) {
    return { html: null, subject: null, skipped: true, reason: `unknown locale "${locale}"` };
  }
  const brandInfo = resolveBrand({ platform, brand }) || { displayName: brand, website: 'https://example.com' };

  const r = resolved || {};
  const r2 = r.parsed || {};
  const localeRegion = String(locale || '').split('_')[0].toUpperCase();
  const currency = LOCALE_TO_CURRENCY[localeRegion] || r.currencies?.[0] || 'MYR';
  const currencySymbol = getCurrencySymbol(currency);

  // Per-currency override must be resolved before minDeposit so SG/ID/TH locales
  // use their own min_deposit (e.g. SGD 150) rather than the base MYR value (500).
  const ccyOverride = r.per_currency_overrides?.[currency] || {};
  const minDeposit = Number(ccyOverride.min_deposit || r2.min_deposit || 0);
  const bonusPct = Number(r2.bonus_rate_pct || 0);
  const maxBonus = Number(r2.max_bonus || 0);
  const turnover = Number(r2.to_multiplier || 1);

  // Computed example block values — show the max-bonus scenario.
  // exampleDeposit = the deposit needed to achieve the max bonus at the given rate.
  // This keeps the example internally consistent: deposit × rate% = max_bonus.
  const bonusAmount = maxBonus;
  const exampleDeposit = bonusPct > 0 ? Math.ceil(maxBonus / (bonusPct / 100)) : minDeposit;
  const totalReceived = exampleDeposit + bonusAmount;
  const turnoverRequirement = totalReceived * turnover;

  // Sheet column headers are authoritative (see feedback_validity_field_meaning):
  //   col P "Validity (After Claim)"          → r.validity_days         = days bonus valid AFTER claim
  //   col Q "Rewards Validity (Before Claim)"  → r.rewards_validity_days = claim window BEFORE claim
  // The MT template placeholders are INVERTED vs these ingest field names:
  //   {{validity_days}}         = CLAIM WINDOW   ("the promotion must be claimed within …")
  //   {{rewards_validity_days}}  = AFTER-CLAIM expiry ("the bonus will expire … after the claim")
  // so bridge sheet → template here. (For P=7/Q=30 the body must read
  // "claimed within 30 days, expire 7 days after the claim".)
  const validityDays = Number(r.rewards_validity_days ?? r.validity_days ?? 30);        // claim window (col Q)
  const rewardsValidityDays = Number(r.validity_days ?? r.rewards_validity_days ?? 30); // after-claim  (col P)

  // FC-specific: max_transfer_out is per-currency. Operator-targeted VIP
  // FC typically has NO cap (max_transfer_out = 0 → body says "no maximum
  // transfer out"). FastTrack public FC has a cap.
  const maxTransferOut = Number(ccyOverride.max_transfer_out || r2.max_transfer_out || 0);
  // FC: actual free-credit amount the customer receives. Distinct from
  // max_transfer_out (the withdrawal cap). Per-currency-overridable.
  const freeCreditAmount = Number(ccyOverride.free_credit_amount || r2.free_credit_amount || r2.bonus_amount || 0);

  // VIP-targeted FC promos prefix the subject with "VIP " / "VIP " / "VIP "
  // (per-locale). Detection: explicit `resolved.is_vip` flag, else fall back
  // to promo code prefix heuristic (VIP_* or *_VIP_*).
  const isVip = r.is_vip === true || /^VIP_|_VIP_/.test(String(r.promo_code || ''));
  const vipPrefixEN = isVip ? 'VIP ' : '';
  const vipPrefixZH = isVip ? 'VIP ' : '';
  const vipPrefixID = isVip ? 'VIP ' : '';

  // Categories — locale-aware translation + joining.
  //   EN: "Slots, Live Casino, and Fishing"
  //   ZH: "老虎机、真人娱乐场、捕鱼"   (Chinese list comma, no "and")
  //   TH/ID: ", "-joined translated names
  //   Empty list → locale-specific "All" text.
  const instrCats = r.instructions?.categories_only || [];
  const cats = instrCats.length > 0
    ? instrCats.map((c) => INSTRUCTION_CAT_MAP[String(c).toUpperCase()] || c).filter(Boolean)
    : (Array.isArray(r2.categories) ? r2.categories.filter(Boolean) : []);
  const eligibleCategories = joinCategories(cats, docKey);

  // FC inverse-category clause: bodies say "All categories eligible EXCEPT X"
  // (operator rule 2026-05-14, see feedback_promo_fc_inbox_rules.md).
  //   - Slots in eligible → exclude "Arcade and Table games"
  //   - Sports only       → exclude "Virtual Sports and Number games"
  //   - Default           → exclude "Blackjack and Virtual Sports"
  const excludedCategories = (() => {
    const lower = new Set(cats.map((c) => String(c).toLowerCase()));
    const hasSlots = lower.has('slot') || lower.has('slots');
    const sportsOnly = lower.has('sports') && lower.size === 1;
    if (hasSlots) {
      return docKey === 'ZH' ? '街机和桌面游戏'
           : docKey === 'ID' ? 'Arkade dan Permainan Meja'
           : 'Arcade and Table games';
    }
    if (sportsOnly) {
      return docKey === 'ZH' ? '虚拟体育和数字游戏'
           : docKey === 'ID' ? 'Olahraga Virtual dan Permainan Angka'
           : 'Virtual Sports and Number games';
    }
    return docKey === 'ZH' ? '二十一点和虚拟体育'
         : docKey === 'ID' ? 'Blackjack dan Olahraga Virtual'
         : 'Blackjack and Virtual Sports';
  })();

  // FS-specific fields. Sensible defaults if the request doesn't carry them.
  const spinCount = Number(r2.spin_count || 0);
  // Strip the provider CODE prefix ("PP2 - PRAGMATIC PLAY" → "PRAGMATIC PLAY").
  // Operator rule 2026-05-14: inbox copy should show only the human-readable
  // provider name + game name, never the back-office shortcode.
  const rawProvider = r2.game_provider || 'PRAGMATIC PLAY';
  const gameProvider = String(rawProvider).replace(/^\s*[A-Za-z0-9]+\s*-\s*/, '').toUpperCase();
  const gameName = r2.game || '(game name to be confirmed)';
  const transferAmount = Number(r2.transfer_amount || minDeposit || 0);
  // value_per_spin: what the player sees as the bet denomination per spin.
  // Source stores this as parsed.value_per_spin (canonical) or amount_per_line (QP2 BO field).
  const valuePerSpin = Number(r2.value_per_spin || r2.amount_per_line || 0);
  const valuePerSpinDisplay = valuePerSpin > 0 ? valuePerSpin.toFixed(2) : '0.00';

  // T&C hyperlink per locale + platform. URL bases come from
  // data/brand-directory.json (brand.website). Convention captured 2026-05-20:
  //   QPRO: <base>/en-my/info-center/terms-and-conditions  (no target; same
  //         URL for EN + ZH per operator-edited live template QPRO4#325)
  //   QP2:  <base>/terms-conditions?lang=<LOCALE>           (target="_blank")
  // The hyperlink wraps just the localized term ("Terms and Conditions" /
  // "条款与条件" / "Syarat dan Ketentuan"). Falls back to plain text when
  // the brand directory has no website for this brand.
  const tncLinkHtml = buildTncLinkHtml({ platform, locale, brandInfo });

  // Per-locale promotion name. The operator configures an EN name and a
  // ZH/ID name (sheet cols X/Y). EN locales use the EN name; ZH + ID locales
  // use the ZH/ID name (matches api-mapper-qpro buildNameBodies: isZh covers
  // both _ZH and _ID). This is the name the player actually sees on the
  // [Reward] page and in dialog body references — NOT the email subject.
  const promotionNameEn = r.promotion_name_en || r.promo_code || '';
  const promotionNameLocalized = (docKey === 'ZH' || docKey === 'ID')
    ? (r.promotion_name_zh_id || r.promotion_name_zh || promotionNameEn)
    : promotionNameEn;

  const vars = {
    currency_symbol: currencySymbol,
    min_deposit: minDeposit,
    bonus_pct: bonusPct,
    max_bonus: maxBonus,
    turnover,
    turnover_words: digitToWords(turnover),
    example_deposit: exampleDeposit.toLocaleString('en-US'),
    bonus_amount_example: bonusAmount.toLocaleString('en-US'),
    total_received_example: totalReceived.toLocaleString('en-US'),
    turnover_requirement_example: turnoverRequirement.toLocaleString('en-US'),
    validity_days: validityDays,
    validity_days_words: digitToWords(validityDays),
    rewards_validity_days: rewardsValidityDays,
    rewards_validity_days_words: digitToWords(rewardsValidityDays),
    eligible_categories: eligibleCategories,
    spin_count: spinCount,
    game_provider: gameProvider,
    game_name: gameName,
    transfer_amount: transferAmount,
    value_per_spin: valuePerSpinDisplay,
    max_transfer_out: maxTransferOut,
    free_credit_amount: freeCreditAmount,
    excluded_categories: excludedCategories,
    vip_prefix_en: vipPrefixEN,
    vip_prefix_zh: vipPrefixZH,
    vip_prefix_id: vipPrefixID,
    promotion_name_en: promotionNameEn,
    // Per-locale promo name — body templates should reference {{promotion_name}}
    // (not {{promotion_name_en}}) so ZH/ID bodies show the localized name.
    promotion_name: promotionNameLocalized,
    bonus_sub_type: r.bonus_sub_type || '',
    bonus_sub_type_zh: BONUS_SUBTYPE_ZH[r.bonus_sub_type] || r.bonus_sub_type || '',
    tnc_link_html: tncLinkHtml,
    deposit_cat_clause: buildDepositCatClause(cats, docKey),
  };

  const flags = {
    min_deposit:                  minDeposit > 0,
    max_transfer_out:             maxTransferOut > 0,
    turnover_plural:              turnover > 1,
    validity_days_plural:         validityDays !== 1,
    rewards_validity_days_plural: rewardsValidityDays !== 1,
    vip:                          isVip,
    all_categories:               cats.length === 0,
  };

  // Campaign-themed copy (World Cup, CNY, Raya, etc.). When a recognised tone
  // is detected from the record, use the bank copy for subject + intro.
  // enrich=true appends amount details (spin count / credit amount) to the
  // subject so each promo in a campaign is distinguishable.
  const copyRecord = { ...r, bonus_type: bonusType || r.bonus_type };
  const campaignCopy = generateCopy(copyRecord, docKey, { enrich: true });

  // Render Subject FIRST so we can thread it through as `reward_name` into
  // the body. The FC body references `[REWARD_NAME]` (the user finds the
  // reward by name on the [Reward] page) — that string IS the subject.
  // VIP-targeted FC uses a locale-aware separate template (per-locale VIP
  // word placement differs — EN/ZH prepend, ID appends).
  let subject;
  // FS MTs always use the standard subject template (with game name) —
  // campaign-copy subjects omit the game and produce confusing "N Claim Your..."
  // strings when enrich prepends the spin count. Bypass for free-spin slug.
  if (campaignCopy?.mt?.subject && slug !== 'free-spin') {
    // Copy-bank subjects are pre-formatted strings (no {{}} placeholders).
    subject = campaignCopy.mt.subject;
  } else {
    const subjectSlug = (slug === 'free-credit' && isVip) ? 'free-credit-vip' : slug;
    subject = SUBJECT_TEMPLATES[subjectSlug]?.[docKey] || r.promotion_name_en || r.promo_code || '';
    subject = applyScalars(subject, vars);
  }
  // The FC body's `[{{reward_name}}]` is the name the player searches for on
  // the [Reward] page — that is the configured promotion name (per locale),
  // NOT the email subject. (Previously set to `subject`, which mismatched the
  // actual reward name once campaign-themed subjects diverged from the name.)
  vars.reward_name = promotionNameLocalized;

  // Body — placeholders are filled but :brandname / :merchantname / :url
  // stay literal (the BO substitutes them per brand at display time).
  let template = await loadBody(slug, docKey);
  template = applyConditionals(template, flags);
  template = applyScalars(template, vars);

  // Inject the campaign-themed intro paragraph when available. The body
  // becomes the single opening line — so if the template already opens with a
  // plain intro paragraph (e.g. free-credit's "Congratulations! You have been
  // rewarded..."), REPLACE it rather than prepending (which would render two
  // intro lines). Bodies that open with a section header (e.g. deposit's
  // "<p><strong>Promo Details:</strong></p>") get the intro prepended.
  // FS templates have a structured table (Bet Value / Turnover) that must not
  // be displaced. Skip campaign-copy intro injection for free-spin slug.
  if (campaignCopy?.mt?.intro && slug !== 'free-spin') {
    const introP = `<p>${campaignCopy.mt.intro}</p>`;
    const firstP = template.match(/^\s*<p>([\s\S]*?)<\/p>\s*/);
    if (firstP && !/^\s*<strong>/.test(firstP[1])) {
      template = introP + '\n' + template.slice(firstP[0].length);
    } else {
      template = `${introP}\n${template}`;
    }
  }

  // Platform-specific placeholder swap. Bodies are authored with QPRO's
  // :brandname literal. Each platform needs a different treatment:
  //   qp2  → :merchantname  (BO substitutes per-merchant at display time)
  //   igmp → literal name   (WS1/WS2 BOs have no runtime substitution;
  //                          bake "MB8" / "RWS77" directly into the body)
  //   qpro → :brandname stays literal (BO substitutes at display time)
  const pf = String(platform || '').toLowerCase();
  if (pf === 'qp2') {
    template = template.split(':brandname').join(':merchantname');
    subject  = subject.split(':brandname').join(':merchantname');
    // QP2: leave :url/terms-conditions as plain text (verified 2026-06-25 from live IBC22
    // MTs — the BO substitutes :url as text, NOT inside href attributes, so wrapping in
    // <a href=":url/..."> creates a broken link. No hyperlinkTnc() call here.
  } else if (pf === 'igmp') {
    const merchantName = BRAND_TO_SITE[brand]?.merchantName || brand || 'MB8';
    template = template.split(':brandname').join(merchantName);
    subject  = subject.split(':brandname').join(merchantName);
  } else {
    // QPRO: hyperlink the T&C term using the :url placeholder.
    // The BO substitutes :url per-brand at display time, same as :brandname.
    template = hyperlinkTnc(template, docKey, pf);
  }

  return {
    html: template,
    subject,
    skipped: false,
    slug,
    docKey,
    brandInfo,
    vars,
    flags,
  };
}

// ── Dialog Popup body renderer ────────────────────────────────────────────
// Loads a short "how to claim" body from src/dialog-popup-bodies/<slug>/<docKey>.html
// and substitutes the same vars used by renderBody (subset). No T&C section,
// no conditionals — dialog bodies are intentionally brief.

const dialogBodyCache = new Map();

async function loadDialogBody(slug, docKey) {
  const key = `${slug}/${docKey}`;
  if (dialogBodyCache.has(key)) return dialogBodyCache.get(key);
  const filePath = path.join(REPO_ROOT, 'src', 'dialog-popup-bodies', slug, `${docKey}.html`);
  const html = await readFile(filePath, 'utf8');
  dialogBodyCache.set(key, html.trim());
  return html.trim();
}

export async function renderDialogBody({ bonusType, locale, resolved }) {
  const slug = bonusTypeSlug(bonusType);
  if (!slug) return { html: null, skipped: true, reason: `unsupported bonusType "${bonusType}"` };

  // Dialog bodies only in EN and ZH (QP2 popup locales).
  const docKey = localeDocKey(locale);
  if (!docKey || !['EN', 'ZH'].includes(docKey)) {
    return { html: null, skipped: true, reason: `dialog body not available for locale "${locale}"` };
  }

  const r = resolved || {};
  const r2 = r.parsed || {};
  const dialogLocaleRegion = String(locale || '').split('_')[0].toUpperCase();
  const currency = LOCALE_TO_CURRENCY[dialogLocaleRegion] || r.currencies?.[0] || 'MYR';

  // Per-locale promo name (ZH dialogs reference the configured ZH name, not EN).
  const promotionNameEn = r.promotion_name_en || r.promo_code || '';
  const promotionNameLocalized = docKey === 'ZH'
    ? (r.promotion_name_zh_id || r.promotion_name_zh || promotionNameEn)
    : promotionNameEn;

  const minDepNum = Number(r2.min_deposit || 0);
  const vars = {
    currency_symbol:       getCurrencySymbol(currency),
    min_deposit:           minDepNum,
    min_deposit_formatted: minDepNum.toLocaleString('en-US'),
    turnover:              Number(r2.to_multiplier || 1),
    promotion_name_en:     promotionNameEn,
    promotion_name:        promotionNameLocalized,
    spin_count:            Number(r2.spin_count || 0),
    game_provider:         String(r2.game_provider || 'PRAGMATIC PLAY').replace(/^\s*[A-Za-z0-9]+\s*-\s*/, '').toUpperCase(),
    game_name:             r2.game || '(game name TBC)',
  };

  let template = await loadDialogBody(slug, docKey);
  template = applyScalars(template, vars);

  return { html: template, skipped: false, slug, docKey };
}
