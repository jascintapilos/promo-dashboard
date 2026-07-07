// Seasonal campaign-copy leak detection — Wave 4 of the brand-watch.
// Design per advisor review 2026-07-07: detect DATES, not words. Marker
// terms live in data/campaign-calendar.json as configuration owned by
// whoever plans campaigns; this module only evaluates terms whose campaign
// window is CLOSED, and never a term that also belongs to a currently-open
// campaign. Always WARNING — copy judgment stays with a human.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAL = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'campaign-calendar.json'), 'utf8'));

const HAS_CJK = /[　-鿿豈-﫿]/;

function termRegex(term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // CJK has no word boundaries; latin terms must not match inside words.
  return HAS_CJK.test(term) ? new RegExp(esc, 'i') : new RegExp(`\\b${esc}\\b`, 'i');
}

// Build the list of "leaky" terms as of `today`: terms of closed campaigns,
// minus any term that also appears in an open (or imminent, window_start-14d)
// campaign — e.g. "CNY" stays legal each year once the next CNY entry opens.
export function buildLeakyTerms(today = new Date()) {
  const grace = (CAL.graceDays ?? 14) * 24 * 60 * 60 * 1000;
  const t = today.getTime();
  const openTerms = new Set();
  const closed = [];
  for (const c of CAL.campaigns || []) {
    const start = Date.parse(c.window_start) - 14 * 24 * 60 * 60 * 1000;
    const end = Date.parse(c.window_end) + grace;
    if (t >= start && t <= end) for (const term of c.marker_terms) openTerms.add(term.toLowerCase());
    else if (t > end) closed.push(c);
  }
  const leaky = [];
  for (const c of closed) {
    for (const term of c.marker_terms) {
      if (openTerms.has(term.toLowerCase())) continue;
      leaky.push({ term, re: termRegex(term), campaign: c.name, windowEnd: c.window_end });
    }
  }
  return leaky;
}

// Seasonal-themed GAME titles are legal year-round (an FS promo on
// "Starlight Christmas" isn't stale copy) — strip them before scanning so
// only campaign phrasing around them can flag.
const TITLE_STRIP = (CAL.game_title_exclusions || []).map((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));

function scan(text, leakyTerms) {
  let t = text;
  for (const re of TITLE_STRIP) t = t.replace(re, ' ');
  const hits = new Map(); // campaign → first term hit
  for (const lt of leakyTerms) {
    if (!hits.has(lt.campaign) && lt.re.test(t)) hits.set(lt.campaign, lt);
  }
  return [...hits.values()];
}

// MT bodies + subjects (QPRO/QP2 — rides the list response, zero fetches).
export function checkCampaignLeakMt(cand, leakyTerms) {
  const mts = cand.messageTemplates || [];
  if (!mts.length || !leakyTerms.length) return [];
  const text = mts.map((m) => `${m.subject || ''}\n${m.message || ''}`).join('\n');
  return scan(text, leakyTerms).map((h) => ({
    severity: 'WARNING', check: 'campaign-leak',
    message: `MT copy mentions "${h.term}" but ${h.campaign} ended ${h.windowEnd} — stale seasonal copy on a live promo`,
  }));
}

// Promo display name (all platforms).
export function checkCampaignLeakName(cand, leakyTerms) {
  if (!cand.name || !leakyTerms.length) return [];
  return scan(String(cand.name), leakyTerms).map((h) => ({
    severity: 'WARNING', check: 'campaign-stale-name',
    message: `Promo name mentions "${h.term}" but ${h.campaign} ended ${h.windowEnd} — stale seasonal promo still active`,
  }));
}
