// Spreadsheet ingest — parses the QC-completed rows of the "Promo Code
// Request Details Template" Google Sheet into a structured JSON shape
// usable by the BO Config skills (promo-bo-config-qp2 / promo-bo-config-qpro).
//
// Input source: a markdown table dump of the sheet (one row per line).
// Output: one record per request row, with extracted numeric details and a
// confidence rating. Heuristic — designed to extract what it can, flag what
// it can't, and never throw on ambiguous content.

// ── Column layout discovered from the sheet header ────────────────────────
// The header may evolve; the indices here are the current canonical order.
// Base layout — used for Jan + Feb 2026 tabs (and any earlier tab).
export const COLUMN_INDEX = {
  status: 0,
  remark: 1,
  request_number: 2,
  requestor: 3,
  date: 4,
  priority: 5,
  deadline: 6,
  brand: 7,
  region: 8,
  campaign: 9,
  bonus_type: 10,
  name_details: 11,
  promo_code: 12,
  promotion_name_en: 13,
  promotion_name_zh_id: 14,
  inbox_message: 15,
  popup_dialog: 16,
  validity: 17,
  rewards_validity: 18,
  expiry_minutes_ws1: 19,
  recurring: 20,
  change_type: 21,
  change_details: 22,
};

// Mar 2026+ tabs added a "Banner Needed" column at position 2 AND moved
// promo_code / promotion_names to the end (positions 22–24). Reordered
// fields verified from `captures/request-template.md` rows 1515+.
export const COLUMN_INDEX_MAR2026 = {
  status: 0,
  remark: 1,
  banner_needed: 2,         // NEW
  request_number: 3,
  requestor: 4,
  date: 5,
  priority: 6,
  deadline: 7,
  brand: 8,
  region: 9,
  campaign: 10,
  bonus_type: 11,
  name_details: 12,
  inbox_message: 13,
  popup_dialog: 14,
  validity: 15,
  rewards_validity: 16,
  expiry_minutes_ws1: 17,
  recurring: 18,
  max_per_player: 19,       // NEW
  change_type: 20,
  change_details: 21,
  promo_code: 22,           // moved from 12
  promotion_name_en: 23,    // moved from 13
  promotion_name_zh_id: 24, // moved from 14
};

// ── Reference data — keep in sync with bo-sites.json brand assignments ─────
// Maps brand IDs in the sheet to the platform (drives which BO Config skill
// is downstream) and the bo-sites.json site id (drives which BO to write to).
export const BRAND_TO_SITE = {
  // QP2 — all four brands share one BO
  'QP2A': { platform: 'qp2',  siteId: 'ibc22', merchantName: 'IBC22'    },
  'QP2B': { platform: 'qp2',  siteId: 'ibc22', merchantName: 'KING333'  },
  'QP2C': { platform: 'qp2',  siteId: 'ibc22', merchantName: 'ACE66'    },
  'QP2D': { platform: 'qp2',  siteId: 'ibc22', merchantName: 'SPADE66'  },
  // QPRO — each brand has its own BO
  'QPRO1':  { platform: 'qpro', siteId: 'qpro1',  merchantName: 'BP9'           },
  'QPRO2':  { platform: 'qpro', siteId: 'qpro2',  merchantName: '12HUAT'        },
  'QPRO3':  { platform: 'qpro', siteId: 'qpro3',  merchantName: 'BX99'          },
  'QPRO4':  { platform: 'qpro', siteId: 'qpro4',  merchantName: 'YE55'          },
  'QPRO5':  { platform: 'qpro', siteId: 'qpro5',  merchantName: 'U388'          },
  'QPRO6':  { platform: 'qpro', siteId: 'qpro6',  merchantName: 'WYN8'          },
  'QPRO7':  { platform: 'qpro', siteId: 'qpro7',  merchantName: 'MBS66'         },
  'QPRO8':  { platform: 'qpro', siteId: 'qpro8',  merchantName: 'WILD33'        },
  'QPRO9':  { platform: 'qpro', siteId: 'qpro9',  merchantName: 'MINT33'        },
  'QPRO10': { platform: 'qpro', siteId: 'qpro10', merchantName: 'UO8'           },
  'QPRO11': { platform: 'qpro', siteId: 'qpro11', merchantName: 'MSB66'         },
  'QPRO12': { platform: 'qpro', siteId: 'qpro12', merchantName: 'SBO18'         },
  'QPRO13': { platform: 'qpro', siteId: 'qpro13', merchantName: 'IBC7'          },
  'QPRO14': { platform: 'qpro', siteId: 'qpro14', merchantName: 'SBO28'         },
  'QPRO15': { platform: 'qpro', siteId: 'qpro15', merchantName: 'E688'          },
  'QPRO16': { platform: 'qpro', siteId: 'qpro16', merchantName: 'ED98'          },
  'QPRO17': { platform: 'qpro', siteId: 'qpro17', merchantName: 'XE38'          },
  // QPRO18 (Pokies Palace, AUD) + QPRO19 (OzPokies77, AUD) dropped 2026-05-16
  // per operator: separate AUD ops cluster, promo_testbot not provisioned,
  // not in scope for this automation. Re-add if/when those come online.

  // iGMP / Best-in-Asia kiosk BOs (WS1 V3 per-country + WS2).
  // Single mapper covers all (CreateBonus.js byte-identical across BOs —
  // verified 2026-05-19). siteId maps to igmpBaseUrl() in src/igmp-client.js.
  // Brand-handle convention: <BRAND>-<COUNTRY> for per-country WS1 V3 BOs.
  // The unsuffixed 'MB8' alias defaults to the MY BO.
  'MB8':       { platform: 'igmp', siteId: 'ws1-v3-my', merchantName: 'MB8'    },
  'MB8-MY':    { platform: 'igmp', siteId: 'ws1-v3-my', merchantName: 'MB8'    },
  'MB8-SG':    { platform: 'igmp', siteId: 'ws1-v3-sg', merchantName: 'MB8'    },
  'MB8-ID':    { platform: 'igmp', siteId: 'ws1-v3-id', merchantName: 'MB8'    },
  'MB8-TH':    { platform: 'igmp', siteId: 'ws1-v3-th', merchantName: 'MB8'    },
  'MB8-KH':    { platform: 'igmp', siteId: 'ws1-v3-kh', merchantName: 'MB8'    },
  'RWS77':     { platform: 'igmp', siteId: 'ws2',       merchantName: 'RWS77'  },
  // Sheet uses "WS1"/"WS2" as brand labels; expand to per-country aliases where possible.
  // "WS1" defaults to MY; per-country requests should use WS1-MY/SG/ID/TH/KH.
  'WS1':       { platform: 'igmp', siteId: 'ws1-v3-my', merchantName: 'MB8'    },
  'WS1-MY':    { platform: 'igmp', siteId: 'ws1-v3-my', merchantName: 'MB8'    },
  'WS1-SG':    { platform: 'igmp', siteId: 'ws1-v3-sg', merchantName: 'MB8'    },
  'WS1-ID':    { platform: 'igmp', siteId: 'ws1-v3-id', merchantName: 'MB8'    },
  'WS1-TH':    { platform: 'igmp', siteId: 'ws1-v3-th', merchantName: 'MB8'    },
  'WS1-KH':    { platform: 'igmp', siteId: 'ws1-v3-kh', merchantName: 'MB8'    },
  'WS2':       { platform: 'igmp', siteId: 'ws2',       merchantName: 'RWS77'  },
  // WS1 V4 (cms.best-in-asia.com, unified multi-country) NOT in this scope —
  // separate BO software with its own API surface.
};

// Region → (currency, locale_codes). Locales follow the same convention the
// BO Config skills already use (MY_EN / MY_ZH / SG_EN / SG_ZH / ID_EN / ID_ID
// / AU_EN). When a single row carries multiple regions, the result is the
// union of currencies and locales.
export const REGION_TO_CURRENCY_LOCALES = {
  'MY':  { currency: 'MYR', locales: ['MY_EN', 'MY_ZH'] },
  'SG':  { currency: 'SGD', locales: ['SG_EN', 'SG_ZH'] },
  'ID':  { currency: 'IDR', locales: ['ID_EN', 'ID_ID'] },
  'IDR': { currency: 'IDR', locales: ['ID_EN', 'ID_ID'] }, // some rows say "IDR"
  'TH':  { currency: 'THB', locales: ['TH_EN', 'TH_TH'] },
  'KH':  { currency: 'KHR', locales: ['KH_EN', 'KH_KM'] },
  'AU':  { currency: 'AUD', locales: ['AU_EN']          },
  'AUD': { currency: 'AUD', locales: ['AU_EN']          },
};

// ── Markdown row → array of cell strings ─────────────────────────────────
export function splitMarkdownRow(line) {
  if (!line.startsWith('|')) return null;
  // Drop leading and trailing pipe, then split on remaining pipes. Trim each
  // cell. Convert "&#10;" (the sheet's encoded newline) to actual newlines.
  const inner = line.replace(/^\|/, '').replace(/\|\s*$/, '');
  return inner.split('|').map((c) => c.trim().replace(/&#10;/g, '\n'));
}

// ── Field-level parsers ────────────────────────────────────────────────────
// Each unmunges one of the original sheet columns. All defensive — return
// null / empty array on absence rather than throwing.

export function parseBonusType(raw) {
  // "Free Spin - Welcome"  → { type: 'Free Spin', subType: 'Welcome' }
  // "Deposit - Reload"     → { type: 'Deposit',   subType: 'Reload' }
  // "Free Credit"          → { type: 'Free Credit', subType: null }
  if (!raw) return { type: null, subType: null };
  const parts = raw.split(/\s*-\s*/);
  return {
    type:    (parts[0] || '').trim() || null,
    subType: (parts[1] || '').trim() || null,
  };
}

export function parseBrands(raw) {
  // "QPRO5, QPRO7, QPRO15" → ['QPRO5','QPRO7','QPRO15']
  // "QP2A"                 → ['QP2A']
  // "QPRO1-QPRO16"         → ['QPRO1', …, 'QPRO16']  (numeric range expansion)
  // "QP2A-D"               → ['QP2A','QP2B','QP2C','QP2D']  (letter range)
  // "QPRO2, 6, 8"          → ['QPRO2','QPRO6','QPRO8']  (bare-number expansion
  //                          — operator shorthand: last alphabetic prefix
  //                          carries forward to bare numeric tokens that
  //                          follow it, until a different prefix appears)
  if (!raw) return [];
  const tokens = raw.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const out = [];
  let carriedPrefix = null;
  for (let t of tokens) {
    // QPLY is an alias for all four QP2 merchants (QP2A-D).
    if (t === 'QPLY') { out.push('QP2A', 'QP2B', 'QP2C', 'QP2D'); continue; }
    // Bare numeric token (e.g. "6", "8") — carry the most recent alphabetic
    // prefix forward. Lets "QPRO2, 6, 8" expand to QPRO2/6/8 without the
    // operator having to type the prefix on every token.
    if (/^\d+$/.test(t) && carriedPrefix) {
      out.push(`${carriedPrefix}${t}`);
      continue;
    }
    // Numeric range: PREFIX<N1>-PREFIX<N2>  e.g. QPRO1-QPRO16
    const nRange = t.match(/^([A-Z]+)(\d+)-(?:\1)?(\d+)$/);
    if (nRange) {
      const prefix = nRange[1];
      const a = Math.min(+nRange[2], +nRange[3]);
      const b = Math.max(+nRange[2], +nRange[3]);
      for (let i = a; i <= b; i++) out.push(`${prefix}${i}`);
      continue;
    }
    // Letter range: PREFIX<L1>-<L2>  e.g. QP2A-D
    const lRange = t.match(/^([A-Z0-9]+?)([A-Z])-([A-Z])$/);
    if (lRange) {
      const prefix = lRange[1];
      const a = lRange[2].charCodeAt(0);
      const b = lRange[3].charCodeAt(0);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      for (let c = lo; c <= hi; c++) out.push(`${prefix}${String.fromCharCode(c)}`);
      continue;
    }
    // Capture alphabetic prefix (e.g. "QPRO" from "QPRO2") so bare numerics
    // later in the list can inherit it.
    const prefMatch = t.match(/^([A-Z]+)\d+$/);
    if (prefMatch) carriedPrefix = prefMatch[1];
    out.push(t);
  }
  return out;
}

export function parseRegions(raw) {
  // "MY, SG" → ['MY','SG']
  // "QPRO4 - MY\nQP2C - MY, SG" → ['MY','SG']
  if (!raw) return [];
  return raw.split(/[,\s\/]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .filter((s) => s !== '-' && !s.match(/^(QPRO\d+|QP2[A-D]|WS[12]|NX|UG)/i));
}

export function regionsToCurrenciesAndLocales(regions) {
  const currencies = [];
  const locales = [];
  const unknownRegions = [];
  for (const r of regions) {
    const m = REGION_TO_CURRENCY_LOCALES[r];
    if (!m) { unknownRegions.push(r); continue; }
    if (!currencies.includes(m.currency)) currencies.push(m.currency);
    for (const l of m.locales) if (!locales.includes(l)) locales.push(l);
  }
  return { currencies, locales, unknownRegions };
}

export function parseRecurring(raw) {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (v.includes('one')) return false;
  if (v.includes('recurring')) return true;
  return null;
}

export function parseValidityDays(raw) {
  if (!raw) return null;
  const n = Number(String(raw).match(/\d+/)?.[0]);
  return Number.isFinite(n) ? n : null;
}

// ── The hard part: free-text Name/Details parsing ─────────────────────────
// Heuristic regex extraction. Each pattern is anchored on its keyword so a
// missing number doesn't borrow from an adjacent one. Confidence flag tells
// downstream consumers whether to trust the value or surface it for review.

// Dual-promo M-cell narrowing. When the operator merges one row for Free Spin
// and another for Free Credit, the Sheets API returns the full merged text to
// both rows. That combined text contains both "N Free Spins, TO 8" AND
// "N Free Credits, TO 10" sections. Without narrowing, the first TO value
// (belonging to the FS section) is picked up for the FC row too.
//
// Fix: if the text contains both a "N Free Spin" and a "N Free Credit" header,
// slice to the section that matches bonusType before running regex extractions.
function narrowToSection(text, bonusType) {
  const bt = (bonusType || '').toLowerCase();
  const hasFS = /\d+\s+Free\s+Spin/i.test(text);
  const hasFC = /\d+\s+Free\s+Credit/i.test(text);
  if (!hasFS || !hasFC) return text;  // not a dual-promo cell
  const fcIdx = text.search(/\d+\s+Free\s+Credit/i);
  if (bt.includes('free spin')) return fcIdx > 0 ? text.slice(0, fcIdx).trim() : text;
  if (bt.includes('free credit')) return fcIdx >= 0 ? text.slice(fcIdx).trim() : text;
  return text;
}

export function parseDetails(raw, { bonusType, promoCode } = {}) {
  if (!raw) return { parsed: {}, gaps: ['name_details empty'], perCurrencyOverrides: {} };

  // Strip markdown escapes ("\_" → "_", "\-" → "-") that the sheet dump
  // adds to underscored promo codes. Then strip leading metadata-style
  // prefixes like "QP2D FS Game Update - " and "Row 13 to 40" — they're
  // internal annotations that don't carry promo parameters and confuse later
  // regex.
  let text = raw
    .replace(/\\([_\-])/g, '$1')
    .replace(/^[A-Z0-9]+\s+(FS|Free Spin|Bonus|Game)\s+Update[^-]*-\s*/i, '')
    .replace(/Row\s+\d+\s+(?:to|-)\s+\d+\s*/gi, '')
    .replace(/\s+/g, ' ');

  // Narrow dual-promo merged cells to the section matching bonusType.
  text = narrowToSection(text, bonusType);

  const parsed = {};
  const gaps = [];

  // "Duplicate this code, only change X" rows reference a prior code rather
  // than re-stating parameters. Surface this distinctly so the operator can
  // wire up cross-row resolution (out of scope for the regex parser).
  const dupSignal = /(?:duplicate|same\s+settings?\s+as)\s+(?:this\s+)?(?:code|prev(?:ious)?(?:\s+code)?)/i.test(text);
  if (dupSignal) {
    // Try to scrape a referenced promo code. Codes are uppercase, contain
    // at least one underscore, and may contain digits or dashes (e.g.
    // QP2C_FT_MD_REL-188FS_B). The pattern stops at whitespace or comma,
    // which is fine — dash and underscore are allowed inside.
    const refMatch = text.match(/\b([A-Z][A-Z0-9_\-]*_[A-Z0-9_\-]+)\b/);
    parsed.duplicate_of = refMatch ? refMatch[1] : null;
    gaps.push(`duplicate_of_prior_code${parsed.duplicate_of ? ': ' + parsed.duplicate_of : ' (referenced code not extractable)'}`);
  }

  // ── Numeric extractions ────────────────────────────
  // Free Spin count — five accepted forms in the wild:
  //   "<N> Free Spins"           "Free Spins: <N>"
  //   "<N>FS" / "<N> FS"         "<N>free spin"
  // Plus a last-resort scrape from the promo code itself (e.g. FT_REL_148FS_…)
  // when the details column is otherwise empty.
  const spinMatch =
       text.match(/(\d+)\s+Free\s+Spin/i)
    || text.match(/Free\s+Spins?\s*[:=]\s*(\d+)/i)
    || text.match(/(\d+)\s*free\s*spin/i)
    || text.match(/(\d+)\s*FS\b/);
  if (spinMatch) parsed.spin_count = Number(spinMatch[1]);
  else if (promoCode) {
    const fromCode = promoCode.match(/_(\d+)FS_/i);
    if (fromCode) {
      parsed.spin_count = Number(fromCode[1]);
      parsed.spin_count_source = 'derived_from_promo_code';
    }
  }

  // Amount per line — operator stated it directly; use as-is (no ÷20).
  const amtPerLine =
       text.match(/[Aa]mount\s+per\s+line\s*[:=]\s*(\d+(?:\.\d+)?)/i)
    || text.match(/[Aa]PL\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (amtPerLine) parsed.amount_per_line = Number(amtPerLine[1]);

  // Value per spin — what the player sees; mapper divides by 20 to get amount_per_line.
  const valPerSpin =
       text.match(/\$?\s*(\d+(?:\.\d+)?)\s+per\s*spin/i)
    || text.match(/(?:RM|S\$|AUD?|Rp|[A-Z]{2,3}\$?)\s*(\d+(?:\.\d+)?)\s*per\s*spin/i)
    || text.match(/Value\s+per\s+spin\s*[:=]\s*(\d+(?:\.\d+)?)/i)
    || text.match(/[Ss]pin\s+value\s*[:=]\s*(\d+(?:\.\d+)?)/i)
    || text.match(/\$(\d+(?:\.\d+)?)\s*perspin/i);
  if (valPerSpin && !parsed.amount_per_line) parsed.value_per_spin = Number(valPerSpin[1]);

  // Free Credit: amount. Accepted forms:
  //   "Free Credit 100" / "Free Credit MYR 100"    (amount after label)
  //   "38 Free Credits, TO 10"                      (amount before label)
  //   "20 FC" / "20FC"                              (shorthand)
  // CCY_PREFIX: a run of zero or more currency tokens, each optionally
  // followed by a separator ("/", ",", "&", or "or"). Tolerates dual/multi-
  // currency phrasing like "RM / SGD 100", "RM/SGD", "MYR & SGD 1,000",
  // "RM or SGD 300" that the older single-token prefix could not parse.
  const CCY_PREFIX = String.raw`(?:(?:RM|S\$|Rp|[A-Z]{2,3}\$?)\s*(?:[\/,&]|or\b)?\s*)*`;
  const fcMatch =
       text.match(new RegExp(String.raw`Free\s+Credit\s+${CCY_PREFIX}(\d+(?:\.\d+)?)`, 'i'))
    || text.match(/(\d+(?:\.\d+)?)\s*FC\b/i)
    || text.match(/(\d+(?:\.\d+)?)\s+Free\s+Credits?\b/i);
  if (fcMatch) parsed.free_credit_amount = Number(fcMatch[1]);

  // Deposit Bonus: percentage rate
  const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) parsed.bonus_rate_pct = Number(pctMatch[1]);

  // Max Bonus: explicit cap. Accepts `:`, `=`, or bare space between label
  // and value, and any of these label spellings: "Max Bonus", "Max. Bonus",
  // "Maximum Bonus", "max bns", "Max Cap", or bare "Cap" (operator alias).
  // Comma thousands separators tolerated: "Max Cap RM1,288" → 1288.
  const maxBonus = text.match(new RegExp(String.raw`\b(?:Max(?:\.|imum)?\s+Bonus|max\s+bns|max\s+bonus|(?:max\s+)?cap)\s*[:=]?\s*${CCY_PREFIX}([\d,]+(?:\.\d+)?)`, 'i'));
  if (maxBonus) parsed.max_bonus = Number(maxBonus[1].replace(/,/g, ''));

  // Min Deposit: "min dep 50" / "min depo 300" / "min dep: RM 50" / "Min Deposit 100"
  // / "Min dep = 100" / "Min Dep RM1,288". Accepts `:`, `=`, or bare space.
  // Comma thousands separators tolerated. Captured separately per-currency
  // below if a per-region prefix is present.
  const minDepGeneric = text.match(new RegExp(String.raw`(?:min(?:imum)?\s+(?:dep(?:osit)?|depo)|min\.?\s+depo?)\s*[:=]?\s*${CCY_PREFIX}([\d,]+(?:\.\d+)?)`, 'i'));
  if (minDepGeneric) parsed.min_deposit = Number(minDepGeneric[1].replace(/,/g, ''));

  // "Dep RMx get RMy" shorthand — column M pattern for deposit promos where
  // "Dep" = min_deposit and "get" = max_bonus. Rate is derived as max/min × 100.
  const depGetMatch = text.match(/\bDep\s+(?:RM|S\$|Rp|[A-Z]{2,3}\$?)?\s*([\d,]+(?:\.\d+)?)\s+get\s+(?:RM|S\$|Rp|[A-Z]{2,3}\$?)?\s*([\d,]+(?:\.\d+)?)/i);
  if (depGetMatch) {
    const minDep = Number(depGetMatch[1].replace(/,/g, ''));
    const maxBns = Number(depGetMatch[2].replace(/,/g, ''));
    if (parsed.min_deposit == null) parsed.min_deposit = minDep;
    if (parsed.max_bonus == null) parsed.max_bonus = maxBns;
    if (parsed.bonus_rate_pct == null && minDep > 0) {
      parsed.bonus_rate_pct = Math.round(maxBns / minDep * 10000) / 100;
    }
  }

  // Turnover multiplier: "TO 20", "TO 15x", "TOx10", "TO: x5", "8X TO",
  // "T.O. 18x", "T.O 18", "T/O 5x" (operator-friendly spellings).
  const toMatch =
       text.match(/T[.\/]?\s*O\.?\s*[:=]?\s*x?\s*(\d+(?:\.\d+)?)/i)
    || text.match(/(\d+(?:\.\d+)?)\s*[xX]\s*T[.\/]?\s*O\.?/i);
  if (toMatch) parsed.to_multiplier = Number(toMatch[1]);

  // Max transfer / max withdraw / max withdrawal. Accepts `:`, `=`, or bare space.
  const maxTransfer = text.match(/(?:max\s+(?:transfer|withdraw(?:al)?)(?:\s+out)?)\s*[:=]?\s*(\d+(?:\.\d+)?|unlimited|XX)/i);
  if (maxTransfer) {
    const v = maxTransfer[1].toLowerCase();
    parsed.max_transfer_out = (v === 'unlimited' || v === 'xx') ? null : Number(v);
  }

  // Per-currency overrides — patterns like "MY min dep: 50 SG min dep = 100"
  const perCurrencyOverrides = {};
  const perCcyPattern = /(MY|SG|ID|TH|KH|AU)\s+min\s+dep(?:osit)?\s*[:=]?\s*(\d+(?:\.\d+)?)/gi;
  for (const m of text.matchAll(perCcyPattern)) {
    const region = m[1].toUpperCase();
    const ccy = REGION_TO_CURRENCY_LOCALES[region]?.currency;
    if (ccy) {
      perCurrencyOverrides[ccy] = perCurrencyOverrides[ccy] || {};
      perCurrencyOverrides[ccy].min_deposit = Number(m[2]);
    }
  }

  // Game name (Free Spin only). Accepted forms:
  //   "<N> Free Spins - Fortune of Olympus, …"             (dash-separated)
  //   "Game: Fortune of Olympus …"                          (explicit label)
  //   "Others: Gates Of Olympus"                            (multi-brand label — default)
  //   "WS1: MB8 Gates Of Olympus" / "QP2A: Gates Of Olympus" (brand-specific)
  // "Others:" wins as the default; specific brand keys go into game_by_brand.
  const GAME_ALIASES = {
    'GOO': 'Gates of Olympus',
    'GOOSS': 'Gates of Olympus Super Scatter',
    'SOD': 'Sweet of Dice',
    'SB': 'Sweet Bonanza',
    'SBX': 'Sweet Bonanza Xmas',
    'SD': 'Starlight Dusk',
    'SP': 'Starlight Princess',
  };
  // Game-name class allows ":" (Playtech titles like "Fire Blaze: Green
  // Wizard"); a "(" terminates the name so provider suffixes like
  // "(Playtech)" stay out of it.
  const gameMatch =
       text.match(/Free\s+Spins?\s*[-—–]\s*([A-Za-z][A-Za-z0-9 ':&-]+?)(?:[,.]|\s*\(|\s+(?:Min|TO|min|to)|\s*$)/i)
    || text.match(/Game\s*[:=]\s*([A-Za-z][A-Za-z0-9 ':&-]+?)(?:[,.]|\s*\(|\s+(?:Same|Just|Min|TO|min|to)|\s*$)/i)
    || text.match(/Others?\s*:\s+([A-Za-z][A-Za-z0-9 '&-]+?)(?:[,.]|\s*$)/i)
    || text.match(/(?:WS\d|QP2[A-D]|QPRO\d+)\s*:\s+(?:[A-Z][A-Z0-9]+\s+)?([A-Za-z][A-Za-z0-9 '&-]+?)(?:[,.]|\s*$)/i);
  if (gameMatch) {
    const raw = gameMatch[1].trim().replace(/\s+$/, '');
    parsed.game = GAME_ALIASES[raw.toUpperCase()] || raw;
  } else {
    const tokens = text.split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    for (const t of tokens) {
      if (GAME_ALIASES[t]) { parsed.game = GAME_ALIASES[t]; break; }
    }
  }

  // Per-brand game overrides: scan for all "BRAND: GAME_NAME" pairs. Lookahead
  // stops each match at the next brand prefix so names don't bleed together.
  // "Others:" contributes to parsed.game (already set above); specific brand
  // labels (WS1, QP2A, QPRO3, …) go into parsed.game_by_brand so mappers can
  // pick the right game for their platform without overwriting the default.
  // Terminator accepts: next brand prefix, end of string, OR a comment/scope
  // boundary marker like " *", " (", " I need", " I'd" — these appear when
  // text-collapse fuses paragraphs like "Olympus *I need 3 codes…" into one
  // line and the game name needs a non-alpha boundary to stop on.
  const brandGameRe = /\b(WS\d|QP2[A-D]|QPRO\d+|Others?)\s*:\s+([A-Za-z][A-Za-z0-9 '&-]+?)(?=\s+(?:WS\d|QP2[A-D]|QPRO\d+|Others?)\s*:|\s*$|\s+[*(\[]|\s+I\s)/gi;
  const brandGames = {};
  let bgMatch;
  while ((bgMatch = brandGameRe.exec(text)) !== null) {
    const brand = bgMatch[1];
    const game = bgMatch[2].trim();
    if (/^Others?$/i.test(brand)) {
      // "Others:" populates parsed.game (the default) when the earlier
      // gameMatch fell through — e.g. when newline-terminated lines fail
      // the gameMatch terminator. Lifts brandGameRe's match into the
      // single-game slot used by mappers (QP2, QPRO).
      if (!parsed.game) parsed.game = game;
    } else {
      brandGames[brand.toUpperCase()] = game;
    }
  }
  if (Object.keys(brandGames).length > 0) parsed.game_by_brand = brandGames;

  // FS game provider — operators annotate the game name with its provider
  // in parens, e.g. "Fire Blaze: Green Wizard (Playtech)" or "Gates of
  // Olympus (Pragmatic Play)". The game-name regexes above deliberately stop
  // BEFORE the "(" so this suffix never bleeds into parsed.game — but until
  // 2026-07-10 nothing captured it either, so every FS mapper silently
  // defaulted to Pragmatic Play regardless of the operator's note (caught on
  // P053: "Fire Blaze: Green Wizard" is a real Playtech-only title, not
  // Pragmatic Play — confirmed against the live BO catalog). Currently
  // recognizes the two providers operators have actually used for FS;
  // extend this map if a third shows up.
  const PROVIDER_ALIASES = {
    playtech: 'Playtech',
    'pragmatic play': 'Pragmatic Play',
    pragmatic: 'Pragmatic Play',
    pp: 'Pragmatic Play',
  };
  const providerMatch = text.match(/\(\s*([A-Za-z][A-Za-z\s]*?)\s*\)/);
  if (providerMatch) {
    const norm = PROVIDER_ALIASES[providerMatch[1].toLowerCase().trim()];
    if (norm) parsed.game_provider = norm;
  }

  // Category hints — "Slots only", "(LC, Sports)", "(Slot, Live Casino)", etc.
  const slotsOnly = /slots?\s+only/i.test(text);
  if (slotsOnly) {
    parsed.categories = ['Slot'];
  } else {
    // Parenthesized category shorthand: "(LC, Sports)" / "(Slots)" / "(LC/Sports)"
    const parenCatMatch = text.match(/\(([A-Za-z][A-Za-z\s,/&]+?)\)/);
    if (parenCatMatch) {
      const CAT_NORM = {
        lc: 'Live Casino', 'live casino': 'Live Casino',
        slot: 'Slots', slots: 'Slots',
        sport: 'Sports', sports: 'Sports',
        fishing: 'Fishing', table: 'Table', arcade: 'Arcade',
      };
      const cats = parenCatMatch[1].split(/[\s,/&]+/)
        .map((s) => CAT_NORM[s.toLowerCase().trim()])
        .filter(Boolean);
      if (cats.length) parsed.categories = cats;
    }
  }

  // ── Required-by-type gap detection ────────────────
  // Skip per-type required-field checks for "duplicate this code" rows —
  // their params live in a prior request, not this row's text.
  const bt = (bonusType || '').toLowerCase();
  if (!parsed.duplicate_of && !gaps.some((g) => g.startsWith('duplicate_of'))) {
    if (bt.includes('free spin')) {
      if (parsed.spin_count == null)     gaps.push('spin_count missing');
      if (parsed.value_per_spin == null && parsed.amount_per_line == null) gaps.push('value_per_spin or amount_per_line missing');
      if (parsed.to_multiplier == null)  gaps.push('to_multiplier missing');
      if (parsed.game == null)           gaps.push('game name missing');
    } else if (bt.includes('free credit')) {
      if (parsed.free_credit_amount == null) gaps.push('free_credit_amount missing');
      if (parsed.to_multiplier == null)      gaps.push('to_multiplier missing');
    } else if (bt.includes('deposit')) {
      if (parsed.bonus_rate_pct == null) gaps.push('bonus_rate_pct missing');
      if (parsed.max_bonus == null)      gaps.push('max_bonus missing');
      if (parsed.to_multiplier == null)  gaps.push('to_multiplier missing');
      if (parsed.min_deposit == null && Object.keys(perCurrencyOverrides).length === 0) {
        gaps.push('min_deposit missing');
      }
    }
  }

  return { parsed, gaps, perCurrencyOverrides };
}

// ── Top-level row parse ───────────────────────────────────────────────────
// Per-row layout detection. The original sheet (Jan/Feb 2026 tabs) had
// request_number at col 2. Mar 2026+ tabs inserted a "Banner Needed"
// column at col 2 AND moved promo_code / promotion_names from cols 12-14
// to the END (cols 22-24). The right COLUMN_INDEX map is selected per
// row based on which column holds the P###/B### identifier.
function detectLayout(cells) {
  if (/^[PB]\d{3,}$/.test(cells[2] || '')) return COLUMN_INDEX;
  if (/^[PB]\d{3,}$/.test(cells[3] || '')) return COLUMN_INDEX_MAR2026;
  return null;
}

export function parseRow(line) {
  const cells = splitMarkdownRow(line);
  if (!cells || cells.length < 15) return null;

  const layout = detectLayout(cells);
  if (layout === null) return null;  // header / separator / empty / unparseable

  const get = (k) => {
    const idx = layout[k];
    return idx == null ? '' : (cells[idx] ?? '');
  };

  const status = get('status');
  const remark = get('remark');
  if (!status) return null; // separator / header / empty row

  const brands = parseBrands(get('brand'));
  const regions = parseRegions(get('region'));
  const { currencies, locales, unknownRegions } = regionsToCurrenciesAndLocales(regions);
  const bonus = parseBonusType(get('bonus_type'));

  // Backslash-escapes in the dumped markdown ("WELC\_ACQ" instead of "WELC_ACQ")
  // — strip them so downstream sees the real promo code.
  const unescape = (s) => s.replace(/\\([_])/g, '$1');

  const promoCode = unescape(get('promo_code'));
  const detailsRaw = get('name_details');
  const detailsParsed = parseDetails(detailsRaw, {
    bonusType: get('bonus_type'),
    promoCode,
  });

  const platforms = [...new Set(brands.map((b) => BRAND_TO_SITE[b]?.platform).filter(Boolean))];
  const unknownBrands = brands.filter((b) => !BRAND_TO_SITE[b]);

  const recurring = parseRecurring(get('recurring'));

  const record = {
    request_id: get('request_number'),
    status,
    remark,
    requestor: get('requestor'),
    date: get('date'),
    priority: get('priority'),
    deadline: get('deadline'),
    brands,
    regions,
    currencies,
    locales,
    campaign: get('campaign'),
    bonus_type: bonus.type,
    bonus_sub_type: bonus.subType,
    name_details_raw: detailsRaw,
    promo_code: promoCode,
    promotion_name_en: get('promotion_name_en'),
    promotion_name_zh_id: get('promotion_name_zh_id'),
    // inbox_message / popup_dialog: operator either writes "true"/"yes" OR
    // free-text content (e.g. "Pls refer QPRO2 inbox code\nPROMOTIONS.MESSAGE.FT_RND_SLOTS_25PCT").
    // ANY non-blank non-explicit-false content → enable. Blank / "no" / "false" → disable.
    inbox_message: !/^\s*(|no|false|n\/a|na|-)\s*$/i.test(String(get('inbox_message') || '')),
    inbox_message_raw: String(get('inbox_message') || '').trim() || null,
    popup_dialog: !/^\s*(|no|false|n\/a|na|-)\s*$/i.test(String(get('popup_dialog') || '')),
    popup_dialog_raw: String(get('popup_dialog') || '').trim() || null,
    validity_days: parseValidityDays(get('validity')),
    rewards_validity_days: parseValidityDays(get('rewards_validity')),
    recurring,
    change_type: get('change_type') || null,
    change_details: get('change_details') || null,
    platforms,
    parsed: detailsParsed.parsed,
    per_currency_overrides: detailsParsed.perCurrencyOverrides,
    instructions: parseInstructions(remark, detailsRaw, get('change_details') || ''),
    gaps: [
      ...(unknownBrands.length ? [`unknown_brand: ${unknownBrands.join(', ')}`] : []),
      ...(unknownRegions.length ? [`unknown_region: ${unknownRegions.join(', ')}`] : []),
      ...detailsParsed.gaps,
    ],
  };

  return record;
}

// ── Per-RN operator instructions parser ───────────────────────────────────
// Operator embeds free-text instructions in `remark` and `name_details_raw`.
// Pattern catalog discovered by surveying P001–P089 on 2026-05-15:
//   A. Code name override:    "Create the code name as below FT_BR_FC38_5X_DY2"
//   B. Duplicate source:      "Duplicate this code ... REL_299FS_GOO_3_270525"
//   B'. Source before marker: "FT_REL_DOUBLEDATE_MAR_250FS_8X - Duplicate and change to FOO"
//   B''. Strip token:         "Can remove the 'DEC20' from code"
//   B'''. Suffix:             "Put at end V2" / "V3"
//   C. Category-only:         "[SLOTS ONLY]" / "[LC ONLY]" / "[Sports ONLY]"
//   D. Suggested copy:        "Inbox/Popup can put smtg like; <COPY>"
//   D'. Template hint:        "Inbox/popup for Welcome"
//   E. Cross-reference:       "Refer REL_199FS_GOO_CROSS_070525"
//   F. External docs:         URLs (Drive links)
//   G/H. Claim cadence:       "Claimable x1" / "multiple claims allowed"
//
// Best-effort — return null/empty for un-matched patterns. Never throws.
// See memory/project_request_instructions_parser.md for the full design.

export function parseInstructions(remark, nameDetails, changeDetails) {
  // The sheet escapes special markdown characters (_, [, ], !, *, etc.)
  // with backslashes. Strip backslashes from before those characters so
  // the regexes below can match the user-visible content directly.
  const unescape = (s) => String(s || '').replace(/\\([_\[\]!*<>(){}|])/g, '$1');
  const r = unescape(remark);
  const n = unescape(nameDetails);
  const c = unescape(changeDetails);
  // Combined haystack — most patterns can appear in either column.
  const all = `${r}\n${n}\n${c}`;
  const signals = [];

  // A. Code name override — look in remark first.
  let codeNameOverride = null;
  const createCodeRe = /(?:Create (?:the )?code name as below|Please create code as per below|Create the code name as below)\s*["']?\s*([A-Z][A-Z0-9_-]{3,})["']?/i;
  let m = createCodeRe.exec(all);
  if (m) { codeNameOverride = m[1]; signals.push('A:code_name_override'); }

  // B/B'. Duplicate source.
  // Promo codes look like REL_299FS_GOO_3_270525 / FT_REL_DOUBLEDATE_MAR_250FS_8X
  // / QP2D_REL-ADHOC-108FS-GOO-DEC20. Require min length 8 AND at least one
  // underscore or dash — keeps the matcher from picking up bare uppercase words
  // like "FOO" or "Put" that appear in the same remark.
  const codeToken = '([A-Z][A-Z0-9]*[_-][A-Z0-9_-]{5,})';
  let duplicateSource = null;
  // B: "Duplicate this code ... <CODE>" — search the tail end of the marker.
  const dup1Re = new RegExp(`Duplicate this code[\\s\\S]*?\\b${codeToken}\\b(?![\\s\\S]*Duplicate)`, 'i');
  m = dup1Re.exec(all);
  if (m) {
    // Prefer the LAST code after the marker (matches "...Put at end V2  REL_xxx" pattern).
    const tail = all.slice(all.search(/Duplicate this code/i));
    const tokens = [...tail.matchAll(new RegExp(`\\b${codeToken}\\b`, 'g'))].map((x) => x[1]);
    if (tokens.length) {
      duplicateSource = tokens[tokens.length - 1];
      signals.push('B:duplicate_after_marker');
    }
  }
  // B': "<CODE> - Duplicate and change to ..."
  if (!duplicateSource) {
    const dup2Re = new RegExp(`\\b${codeToken}\\s*[-—]\\s*Duplicate and change`, 'i');
    m = dup2Re.exec(all);
    if (m) { duplicateSource = m[1]; signals.push("B':duplicate_before_marker"); }
  }
  // B'''': "Replicate <CODE> from <BRAND>" — operator wants destination
  // brand(s) to receive a verbatim clone of <CODE> as it exists on <BRAND>.
  // Differs from "Duplicate this code X" in that the source brand is pinned
  // and the destination code name = source code. Sets both duplicate_source
  // (to seed config-clone) AND code_name_override (so the auto-namer
  // preserves the source code verbatim instead of deriving a fresh one from
  // parsed rate/dep/TO — which can collapse distinct LC vs SLOT source codes
  // onto a single fabricated name).
  let duplicateSourceBrand = null;
  if (!duplicateSource) {
    const dup3Re = new RegExp(`Replicate\\s+${codeToken}(?:\\s+from\\s+([A-Z][A-Z0-9]*))?`, 'i');
    m = dup3Re.exec(all);
    if (m) {
      duplicateSource = m[1];
      if (m[2]) duplicateSourceBrand = m[2].toUpperCase();
      if (!codeNameOverride) codeNameOverride = duplicateSource;
      signals.push("B'''':replicate_from_brand");
    }
  }

  // B''. Strip token.
  let stripToken = null;
  const stripRe = /Can remove (?:the )?["']([A-Z0-9]+)["'] from (?:the )?code/i;
  m = stripRe.exec(all);
  if (m) { stripToken = m[1]; signals.push("B'':strip_token"); }

  // B'''. Suffix.
  let suffix = null;
  const suffixRe = /Put at end\s+(V\d+|v\d+)\b/i;
  m = suffixRe.exec(all);
  if (m) { suffix = `_${m[1].toUpperCase()}`; signals.push("B''':suffix"); }

  // C. Category-only constraint.
  let categoryOnly = null;
  const catRe = /\[\s*(SLOTS?|LC|LIVE\s*CASINO|SPORTS?|TABLE|FISHING|ARCADE)\s*ONLY\s*\]/i;
  m = catRe.exec(all);
  if (m) {
    const raw = m[1].toUpperCase().replace(/\s+/g, ' ');
    const norm = { 'SLOT': 'Slots', 'SLOTS': 'Slots', 'LC': 'Live Casino', 'LIVE CASINO': 'Live Casino',
                   'SPORT': 'Sports', 'SPORTS': 'Sports', 'TABLE': 'Table', 'FISHING': 'Fishing', 'ARCADE': 'Arcade' };
    categoryOnly = norm[raw] || null;
    if (categoryOnly) signals.push('C:category_only');
  }

  // D. Suggested copy — capture up to next clause-break / newline / sentence end.
  let suggestedCopy = null;
  const copyRe = /Inbox\/?Popup\s+can put smtg like[;:\s]+([^\n]+?)(?=\s*(?:\n|For more details|$))/i;
  m = copyRe.exec(all);
  if (m) { suggestedCopy = m[1].trim(); signals.push('D:suggested_copy'); }

  // D'. Template hint.
  let popupTemplateHint = null;
  const tplRe = /Inbox\/?popup for ([A-Za-z]+)/i;
  m = tplRe.exec(all);
  if (m) { popupTemplateHint = m[1]; signals.push("D':popup_template_hint"); }

  // E. Cross-reference (Refer / Pls refer <CODE>). Code may be quoted
  // (`"FT_REL_SLOTS_25PCT"` / `'FT_REL_SLOTS_25PCT'`) or bare.
  let referTo = null;
  const referRe = /(?:Pls\s+)?Refer\s+["']?([A-Z][A-Z0-9_.-]{3,})["']?/i;
  m = referRe.exec(all);
  if (m && m[1] !== duplicateSource) { referTo = m[1]; signals.push('E:refer_to'); }

  // K. "Add TEST to code" — operator instruction to add TEST_ prefix to the
  // resolved promo_code (whether auto-named or referenced). Applied after
  // the rest of the code is resolved. Captures the "add test" intent only;
  // the actual prefixing happens in the namer / refer-resolver.
  //
  // Broadened 2026-05-18 per operator: accept quoted/unquoted TEST, and
  // verbs beyond add/append/prefix (include/use/tag/mark). Also accept
  // bare "TEST prefix" / "TEST code" / "prefix TEST" phrasings.
  let addTestPrefix = false;
  const TEST_PREFIX_PATTERNS = [
    // "add/append/include/use/tag/mark [as] [the] TEST [to/on/in/as the code/prefix]"
    /\b(?:add|append|include|use|tag|mark)\s+(?:as\s+)?(?:the\s+)?['"]?TEST['"]?(?:\s+(?:to|on|in|as)\s+(?:the\s+)?(?:code|prefix))?\b/i,
    // "prefix TEST" / "TEST prefix" / "TEST code"
    /\b(?:prefix\s+['"]?TEST['"]?|['"]?TEST['"]?\s+(?:prefix|code))\b/i,
  ];
  if (TEST_PREFIX_PATTERNS.some((re) => re.test(all))) {
    addTestPrefix = true;
    signals.push('K:add_test_prefix');
  }

  // L. Generic prefix injection — "Add VIP to code" / "Include FT prefix" /
  // "Add GOLD to the code" etc. Operator names a prefix token they want
  // prepended to the resolved promo_code. The actual prepending happens in
  // the namer / refer-resolver. TEST is excluded here (handled by K).
  //
  // Token rules:
  //   2-8 chars, letters or digits, must be in code/prefix context
  //   Stopwords (the, link, eligible, ...) skipped to avoid false positives
  //   PREFIX_ALIAS normalizes tier names: GOLD→GLD, SILVER→SIL, etc.
  //
  // Examples observed in the sheet:
  //   "Add VIP to code prefix"   → ['VIP']
  //   "Include FT prefix"        → ['FT']
  //   "Please add GOLD to code"  → ['GLD']
  const codePrefixes = [];
  const PREFIX_ALIAS = {
    GOLD: 'GLD', SILVER: 'SIL', BRONZE: 'BR',
    PLATINUM: 'PLT', DIAMOND: 'DMD', NORMAL: 'NRM',
  };
  const PREFIX_STOPWORDS = new Set([
    'THE', 'A', 'AN', 'THIS', 'THAT', 'ELIGIBLE', 'LINK', 'ALL', 'ONE',
    'PROMO', 'PROMOTION', 'PLAYER', 'PLAYERS', 'NAME', 'NAMES',
    // Connectors / prepositions that appear right before "code"/"prefix"
    // and would otherwise be captured by PREFIX_BARE_RE as `X code`:
    'TO', 'ON', 'IN', 'AS', 'OF', 'OR', 'AT', 'BY', 'FOR', 'WITH', 'AND',
    // Verbs (in case BARE regex anchors on them):
    'ADD', 'APPEND', 'INCLUDE', 'USE', 'TAG', 'MARK', 'PLEASE',
    // Common adjectives/words in promo remarks
    'NEW', 'OLD', 'SAME', 'NEXT', 'BACK', 'NEAR', 'NO', 'YES',
  ]);
  const PREFIX_VERB_RE =
    /\b(?:add|append|include|use|tag|mark)\s+(?:as\s+)?(?:the\s+)?['"]?([A-Za-z][A-Za-z0-9]{1,7})['"]?\s+(?:to|on|in|as)?\s*(?:the\s+)?(?:code|prefix)\b/gi;
  let prefM;
  while ((prefM = PREFIX_VERB_RE.exec(all)) !== null) {
    const raw = (prefM[1] || '').toUpperCase();
    if (!raw || raw === 'TEST' || PREFIX_STOPWORDS.has(raw)) continue;
    const norm = PREFIX_ALIAS[raw] || raw;
    if (!codePrefixes.includes(norm)) codePrefixes.push(norm);
  }
  // Note: use [ \t]+ (not \s+) so the regex doesn't span paragraph breaks
  // — "prefix\n\nInfo Ready" would otherwise capture "INFO" as the token.
  const PREFIX_BARE_RE =
    /\b(?:prefix[ \t]+['"]?([A-Za-z][A-Za-z0-9]{1,7})['"]?|['"]?([A-Za-z][A-Za-z0-9]{1,7})['"]?[ \t]+(?:prefix|code))\b/gi;
  let bareM;
  while ((bareM = PREFIX_BARE_RE.exec(all)) !== null) {
    const raw = ((bareM[1] || bareM[2]) || '').toUpperCase();
    if (!raw || raw === 'TEST' || PREFIX_STOPWORDS.has(raw)) continue;
    const norm = PREFIX_ALIAS[raw] || raw;
    if (!codePrefixes.includes(norm)) codePrefixes.push(norm);
  }
  if (codePrefixes.length) signals.push('L:code_prefixes');

  // F. External Drive URLs.
  const urlRe = /https?:\/\/[^\s)]+/g;
  const externalRefs = [];
  let urlMatch;
  while ((urlMatch = urlRe.exec(all)) !== null) externalRefs.push(urlMatch[0]);
  if (externalRefs.length) signals.push('F:external_refs');

  // G/H. Claim cadence.
  let oneTimeClaim = false;
  let multipleClaimsAllowed = false;
  if (/Claimable\s*x?1\b/i.test(all)) { oneTimeClaim = true; signals.push('G:one_time_claim'); }
  if (/multiple claims allowed/i.test(all)) { multipleClaimsAllowed = true; signals.push('H:multiple_claims_allowed'); }

  // I. Tier constraint — "<Tier> and below/above". Operator restricts the
  // promo to a contiguous tier range. Order (low→high):
  //   Normal < Bronze < Silver < Gold < Platinum < Diamond.
  // "Silver and below" → ['Normal','Bronze','Silver']
  // "Gold and above"   → ['Gold','Platinum','Diamond']
  // Numbered sub-tiers (Silver 1/2/3) all roll up to the bare tier name.
  // Trial variants and PRO-GOLDVIP / PRO-PLATINUM-VIP are mapped at mapper
  // time based on the eligible-tier set.
  let tierConstraint = null;
  const TIER_ORDER = ['Normal', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
  const tierRe = /\b(Normal|Bronze|Silver|Gold|Platinum|Diamond)\s+and\s+(below|above)\b/i;
  m = tierRe.exec(all);
  if (m) {
    const tier = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    const direction = m[2].toLowerCase();
    const idx = TIER_ORDER.indexOf(tier);
    const eligible = direction === 'below' ? TIER_ORDER.slice(0, idx + 1) : TIER_ORDER.slice(idx);
    tierConstraint = { tier, direction, eligible_tiers: eligible };
    signals.push('I:tier_constraint');
  }

  // J. Categories-only constraint — operator restricts the promo to a subset
  // of wallet categories. Patterns seen in the wild:
  //   "Live Casino and Sports only"
  //   "Slots, LC and Sports only"
  //   "LC only"
  //   "(Slots) only"
  // Shorthand map: LC→LIVE CASINO, Sport(s)→SPORT, Slot(s)→SLOTS,
  // Fishing→FISHING, E-Sports/Esports→E-SPORTS, Crash→CRASH, Cricket→CRICKET.
  let categoriesOnly = null;
  const catTokenRe = /\b(SLOTS?|LC|LIVE\s*CASINO|SPORTS?|FISHING|E-?SPORTS?|CRASH|CRICKET|TABLE|ARCADE)\b/gi;
  // Find an "only" clause and scan tokens before it within the same sentence.
  const onlyClauseRe = /([A-Za-z][A-Za-z ,&-]+?)\s+only\b/i;
  const onlyMatch = onlyClauseRe.exec(all);
  if (onlyMatch) {
    const segment = onlyMatch[1];
    const toks = [];
    let tm;
    catTokenRe.lastIndex = 0;
    while ((tm = catTokenRe.exec(segment)) !== null) {
      const raw = tm[1].toUpperCase().replace(/\s+/g, ' ');
      const norm = ({ 'SLOT': 'SLOTS', 'SLOTS': 'SLOTS', 'LC': 'LIVE CASINO', 'LIVE CASINO': 'LIVE CASINO',
                       'SPORT': 'SPORT', 'SPORTS': 'SPORT', 'FISHING': 'FISHING',
                       'ESPORT': 'E-SPORTS', 'ESPORTS': 'E-SPORTS', 'E-SPORT': 'E-SPORTS', 'E-SPORTS': 'E-SPORTS',
                       'CRASH': 'CRASH', 'CRICKET': 'CRICKET', 'TABLE': 'TABLE', 'ARCADE': 'ARCADE' })[raw];
      if (norm && !toks.includes(norm)) toks.push(norm);
    }
    if (toks.length) {
      categoriesOnly = toks;
      signals.push('J:categories_only');
    }
  }

  // J'. Explicit "Game Categories: <list>" / "Game Category: <list>" /
  // bare "Game: <list>" patterns without the word "only". Seen on P075-P096:
  //   "Game Categories : Slots/Fishing reload"  → ['SLOTS','FISHING']
  //   "Game Category: LC, Sports"               → ['LIVE CASINO','SPORT']
  //   "Game : Slots/Fishing reload"             → ['SLOTS','FISHING']
  // Separator may be `:` or `=`; list may use `/`, `,`, `+`, or `&` between
  // categories. "Game : All games" / "Games: All" do NOT trigger (no
  // restriction — falls through to the mapper's default eligible set).
  if (!categoriesOnly) {
    const gcRe = /\bgames?\s*(?:categor(?:y|ies))?\s*[:=]\s*([^\n]+)/i;
    const gcm = gcRe.exec(all);
    if (gcm) {
      const segment = gcm[1];
      // Bail out if the segment names "All" / "All games" — that's no-restriction.
      if (!/\ball\b/i.test(segment)) {
        const toks = [];
        catTokenRe.lastIndex = 0;
        let tm;
        while ((tm = catTokenRe.exec(segment)) !== null) {
          const raw = tm[1].toUpperCase().replace(/\s+/g, ' ');
          const norm = ({ 'SLOT': 'SLOTS', 'SLOTS': 'SLOTS', 'LC': 'LIVE CASINO', 'LIVE CASINO': 'LIVE CASINO',
                           'SPORT': 'SPORT', 'SPORTS': 'SPORT', 'FISHING': 'FISHING',
                           'ESPORT': 'E-SPORTS', 'ESPORTS': 'E-SPORTS', 'E-SPORT': 'E-SPORTS', 'E-SPORTS': 'E-SPORTS',
                           'CRASH': 'CRASH', 'CRICKET': 'CRICKET', 'TABLE': 'TABLE', 'ARCADE': 'ARCADE' })[raw];
          if (norm && !toks.includes(norm)) toks.push(norm);
        }
        if (toks.length) {
          categoriesOnly = toks;
          signals.push("J':game_categories_field");
        }
      }
    }
  }

  // K. Day-split fan-out: operator wants N codes per row on the IGMP/WS1
  // path while other platforms stay at 1. Triggered by remarks like
  // "3 codes for WS1\n1 code for QP2A" plus a suffix hint "name as D1, D2, D3".
  // Applies only to the IGMP platform — orchestrator skips QPRO/QP2.
  let daySplit = null;
  const wsCountRe = /(\d+)\s+codes?\s+(?:for\s+|on\s+)?(WS\d+|IGMP|MB8|MB\d+)\b/i;
  const dsM = wsCountRe.exec(all);
  if (dsM) {
    const count = parseInt(dsM[1], 10);
    if (count >= 2 && count <= 7) {
      let prefix = 'D';
      const sufRe = /\b([A-Z])\d\s*,\s*[A-Z]\d/;
      const sM = sufRe.exec(all);
      if (sM) prefix = sM[1].toUpperCase();
      daySplit = { count, prefix, platform: 'igmp' };
      signals.push('K:day_split');
    }
  }

  // L. Quoted code-context tag: "Add 'WC Churned' to code" / "Add \"WC FTD\"
  // to code" / "Include 'WC Active + Churned' in code". Multi-token quoted
  // phrase that should override the keyword-derived campaign suffix.
  // Rule (per operator 2026-05-26): keep every alpha-numeric token from the
  // phrase verbatim (uppercased), drop only separators (space, +, comma).
  // Examples:
  //   "WC Churned"           → "WCCHURNED"
  //   "WC FTD"               → "WCFTD"
  //   "WC RND"               → "WCRND"
  //   "WC Active + Churned"  → "WCACTIVECHURNED"
  let codeContextTag = null;
  const ctxRe = /\b(?:add|append|include|use|tag|mark)\s+['"]([^'"]+)['"]\s+(?:to|on|in|as)?\s*(?:the\s+)?(?:code|prefix)\b/i;
  const ctxM = ctxRe.exec(all);
  if (ctxM) {
    const phrase = ctxM[1].trim();
    const compacted = phrase.replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
    if (compacted) {
      codeContextTag = compacted;
      signals.push('L:code_context_tag');
    }
  }

  return {
    code_name_override:   codeNameOverride,
    duplicate_source:     duplicateSource,
    duplicate_source_brand: duplicateSourceBrand,
    duplicate_suffix:     suffix,
    duplicate_strip_token: stripToken,
    category_only:        categoryOnly,
    categories_only:      categoriesOnly,
    tier_constraint:      tierConstraint,
    suggested_copy:       suggestedCopy,
    popup_template_hint:  popupTemplateHint,
    refer_to:             referTo,
    add_test_prefix:      addTestPrefix,
    code_prefixes:        codePrefixes,
    external_refs:        externalRefs,
    one_time_claim:       oneTimeClaim,
    multiple_claims_allowed: multipleClaimsAllowed,
    day_split:            daySplit,
    code_context_tag:     codeContextTag,
    raw_signals:          signals,
  };
}

// Parse a whole markdown table dump. Returns only rows whose `status` looks
// like a real request (skips header, separator, and empty rows).
// Each record carries the source line number so downstream can produce a
// unique file/handle when the same Request ID is reused across tables (the
// sheet's quarterly tables share P### numbering).
export function parseTable(markdown, { onlyQcCompleted = true } = {}) {
  const lines = markdown.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const rec = parseRow(lines[i]);
    if (!rec) continue;
    if (!/^[PB]\d{3,}$/.test(rec.request_id)) continue; // skip header rows
    if (onlyQcCompleted && !/qc.*complete/i.test(rec.status)) continue;
    rec.source_line = i + 1;
    // Composite handle: <RequestID>-r<line>.  Unique across overlapping
    // tables that reuse P### numbers, but still groups runs of the same
    // logical request when you sort by handle.
    rec.handle = `${rec.request_id}-r${i + 1}`;
    out.push(rec);
  }
  return out;
}
