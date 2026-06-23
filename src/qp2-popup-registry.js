// Deterministic record of which dialog popup the QP2 canary created for each
// (promo_code, merchant site_id). Written by canary-api-qp2.js at popup-create
// time; read by bin/relink-qp2-dialogs.mjs to rebuild the correct
// dialog_popup_list without heuristic title/time matching.
//
// WHY a registry: popups on the shared IBC22 BO carry no promo_code, and
// sibling promos reuse the same promotion_name_en (e.g. all 6 deposits are
// "World Cup Reload Bonus"), so title+recency matching is ambiguous. Recording
// the exact popup id at create time is deterministic and survives re-runs.
//
// Format: JSONL (append-only, race-safe across the per-merchant child
// processes). One line per popup creation:
//   {"code":"WCF_VIP100GET20","site":3,"popup":1503,"ts":"..."}
// getPopups() returns the LAST popup id seen per site (re-runs win).

import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.join(__dirname, '..', 'captures', 'qp2-dialog-links.jsonl');

export function recordPopup(code, site, popup, ts) {
  if (!code || site == null || popup == null) return;
  try {
    mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    appendFileSync(REGISTRY_PATH, JSON.stringify({ code, site: Number(site), popup: Number(popup), ts: ts || null }) + '\n');
  } catch (_) { /* best-effort — relink falls back to heuristic if registry missing */ }
}

// Returns { [siteId]: popupId } for a code, taking the most recent line per site.
export function getPopups(code) {
  if (!existsSync(REGISTRY_PATH)) return {};
  const out = {};
  for (const line of readFileSync(REGISTRY_PATH, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (rec.code === code) out[rec.site] = rec.popup; // later lines overwrite
  }
  return out;
}
