/**
 * SG (non-MY) market pass for the promo report.
 *
 * The report template is authored MY-first: "RM" is hardwired as THE currency unit
 * throughout the prose/labels, and a number of MY analytical FINDINGS are hand-written
 * as literals into the narrative (cap savings, self-claim rates, flagship-code counts…).
 * On a Singapore report those findings are factually wrong, and the unit label is the
 * wrong currency. Per the "clean data report, narrative suppressed" scope, this pass:
 *   (A) drops the per-card "How this is calculated" methodology notes (dense MY figures),
 *   (B) suppresses / neutralises the hand-written MY-finding prose blocks that still render,
 *   (C) hides interpretive cards whose enrichers aren't built for the thin SG base,
 *   (D) relabels the currency UNIT (RM -> market symbol) everywhere it is a display unit,
 *       using a scoped regex that leaves quoted logic-keys ('RM'/'RM400+'), acronyms
 *       (CRM) and English words (confirm, platform…) untouched.
 *
 * The template file itself is never edited, so the already-published MY report is unaffected
 * (MY builds skip this pass entirely).
 */

// remove everything from `startSub` through `endSub` (inclusive); warn if either anchor is missing
function cut(html, startSub, endSub, label) {
  const i = html.indexOf(startSub);
  if (i < 0) { console.warn(`  [sg-pass] MISS start: ${label}`); return html; }
  const j = html.indexOf(endSub, i);
  if (j < 0) { console.warn(`  [sg-pass] MISS end:   ${label}`); return html; }
  return html.slice(0, i) + html.slice(j + endSub.length);
}

// exact substring replace; warn if not found
function sub(html, find, repl, label) {
  if (!html.includes(find)) { console.warn(`  [sg-pass] MISS sub:  ${label}`); return html; }
  return html.split(find).join(repl);
}

export function sgMarketPass(out, SYMBOL) {
  const S = SYMBOL; // e.g. 'S$'

  // (00) Distinct page title so the SG artifact is separable from the MY "Promo Report" in the gallery.
  out = sub(out, '<title>Promo Report</title>', '<title>Singapore Promo Report</title>', 'SG page title');

  // (0a) LTV card: on SG's thin book the long-horizon (6-year) anchor rests on a small cohort
  //      (2020, n=89). Add an honest caveat to the card's subtitle so the mature figure isn't read
  //      as firm. (MY's mature cohort is large, so this note is SG-only.)
  out = sub(out,
    '<h3>What a player is worth over time — lifetime value</h3><span class="hint">real multi-year cohorts · whole-book</span>',
    '<h3>What a player is worth over time — lifetime value</h3><span class="hint">real multi-year cohorts · whole-book · long-horizon values rest on small early cohorts — read as indicative</span>',
    'LTV thin-base caveat');

  // (0) Country switcher: the template is a MY report with Malaysia active and a "Singapore soon"
  //     placeholder. This build injects SG data into the active country, so relabel the active
  //     tab to Singapore, drop the "soon" tab, and neutralise the placeholder's MY reference.
  out = sub(out,
    '<button class="ctab active" data-country="my">Malaysia</button>',
    '<button class="ctab active" data-country="my">Singapore</button>',
    'active country tab -> Singapore');
  out = sub(out,
    '<button class="ctab" data-country="sg">Singapore <span class="badge">soon</span></button>',
    '',
    'remove SG "soon" tab');
  out = sub(out,
    'Singapore promos will appear here once its data is pulled — the same pillar tabs and layout as Malaysia.',
    'This is the Singapore book.',
    'country-sg placeholder text');

  // (A) suppress ALL per-card "How this is calculated" notes (they cite MY figures / MY
  //     methodology examples). Consumer is `Object.keys(CALC_DATA).forEach(...)` -> feed it {}.
  out = sub(out,
    'Object.keys(CALC_DATA).forEach(function(id){',
    'Object.keys({}).forEach(function(id){',
    'CALC_DATA notes off');

  // (B1) VIP scope card — replace the 3 MY-only scope notes with one honest SG scope note.
  out = cut(out,
    '<div class="scopenote"><b>Scope — Malaysia only (settled).</b>',
    'Capping the tool without fixing the incentive just moves the leak elsewhere.</div>',
    'vip scopenotes (MY)');
  out = sub(out,
    '<div class="card-h"><h3>Scope &amp; things to watch</h3><span class="hint">flags, not scored analysis</span></div>',
    '<div class="card-h"><h3>Scope &amp; things to watch</h3><span class="hint">flags, not scored analysis</span></div>'
      + `<div class="scopenote"><b>Scope — Singapore VIP book.</b> Figures here are <b>directional on a thin base</b> (407 VIP members). `
      + `Causal attribution and big-player (whale) detection are <b>gated off for SG</b> — the base is too small to measure them `
      + `reliably or without identifying individuals. Read the tables as the size and shape of the book, not as proven promo effect.</div>`,
    'sg scope note');

  // (B2) VIP Lane-A "root cause" varbox — entirely MY findings (81% VM-assigned, ~2 flagship
  //      RM400+ codes, -2.04/-0.75, ~RM228k/RM375k cap). Remove the whole varbox term.
  out = cut(out,
    '<div class="varbox" style="margin-bottom:14px"><span class="ico">◆</span><div><b>Why it isn\'t paying off',
    'the upside is a best-case read, not proof.</div></div>',
    'laneA root-cause varbox (MY)');

  // (B3) Lane-A 90-day caution — drop the MY-specific "RM400+ free-credit codes / repeat-claim" clause.
  out = sub(out,
    'it does <b>not</b> rescue the specific <b>RM400+ free-credit codes</b> or the <b>repeat-claim losses</b> the cap targets.',
    'it does <b>not</b> on its own prove the big-ticket free-credit is paying off.',
    'laneA caution RM400+ clause');

  // (B4) Performance-decisions blurb cites a MY fair-comparison ("13 codes"); SG has no fair regrade.
  out = cut(out,
    '<b>Back per RM1</b> shows the <b>fair-comparison</b> number on the <b>13 codes we could genuinely check</b>',
    'it does not rescue Lane-A.',
    'fair-check 13-codes blurb (MY)');
  out = sub(out,
    '<div id="v_tblA"></div></div>',
    '<div id="v_tblA"></div></div>',
    'v_tblA anchor (noop guard)'); // presence check only

  // (B4b) Lane-A "90-day payback" card uses forward-90 fields SG's pull doesn't produce
  //       (renders S$undefined / −S$NaN / "NaN players"). Remove the whole card span.
  out = cut(out,
    '<div class="card col12" style="margin-bottom:14px"><div class="card-h"><h3>Past the first week — the 90-day payback',
    'they\'d have done anyway.</div></div></div>',
    'laneA 90-day payback card (fwd90 missing)');

  // (B4c) "What am I looking at" fair-comparison line cites a MY fair-check ("13 codes", ≈−RM0.95).
  out = sub(out,
    ' On the 13 codes actually checked the fair read is <b>about the same as own-baseline</b> (still a loss, ≈−RM0.95/RM) — so the fair check does <b>not</b> rescue Lane-A; the case',
    ' The case',
    'fair "13 codes actually checked" sentence');

  // (B5) Exec-banner retention claim is now data-driven (RSYM/SYM per market) in the template — no override needed.

  // (C) v_moves (Decision register) is a hard-coded MY prescription list keyed on VIP.decision,
  //     which SG metrics don't carry -> would render MY labels with NaN. Gate it, and hide the card.
  out = sub(out,
    "var box=document.getElementById('v_moves'); if(!box) return;",
    "var box=document.getElementById('v_moves'); if(!box||!VIP.decision) return;",
    'v_moves gate on VIP.decision');

  // Hide interpretive cards whose enrichers aren't built for SG (empty / MY-baked):
  //   v_moves card (id-less wrapper, via :has), sweet-spot, VIP trend-decomposition,
  //   monthly-operating baseline, whale summary.
  out = sub(out, '</style>',
    '\n  /* SG: hide interpretive cards whose enrichers/decisions are not built for the thin SG base */\n'
    + '  .card:has(#v_moves){display:none}\n'
    + '  #v_sweetCard,#vipTrendDecompCard,#vipOperatingCard,#vipWhaleSummaryCard,#vipCoverageNote,#vipRetainTest{display:none}\n'
    + '  /* SG: no whale (big-player) analysis on the thin base — hide the tab + its panel */\n'
    + '  [data-tab="whale"],#panel-whale{display:none}\n'
    + '</style>',
    'sg hide-cards style');

  // (D) Currency-UNIT relabel: RM -> market symbol, ONLY where RM is a standalone display unit.
  //     Scoped regex: not preceded/followed by a letter (protects CRM, confirm, platform, …)
  //     and not wrapped in quotes (protects 'RM'/'RM400+'/'RM1000+' logic keys & fallbacks).
  out = out.replace(/(?<!['"])(?<![A-Za-z])RM(?![A-Za-z])(?!['"])/g, S);
  // the two quoted DISPLAY ref-labels the regex deliberately skipped:
  out = sub(out, "refLabel:'RM1/RM'", `refLabel:'${S}1/${S}'`, "refLabel RM1/RM");
  // MY currency name in prose — "ringgit" only ever means the MYR unit; swap wherever it renders.
  out = out.split('ringgit').join(S === 'S$' ? 'dollar' : 'unit');

  return out;
}
