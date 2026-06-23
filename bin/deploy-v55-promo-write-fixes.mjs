#!/usr/bin/env node
/**
 * V55 — Promo Code write-back fixes: Banner, Deadline, Column M
 *
 *  1. Deadline — V53 removed the End Date field, so form.endDate became
 *     undefined and the operator's "Deadline" column stayed blank.
 *     Fix: add a Deadline date input back to the Validity section.
 *
 *  2. Column M (Name/Details — internal ref) — V53 removed the manual
 *     nameDetails input. Server-side now auto-derives it from bonusType +
 *     amount + brand list (e.g. "Free Credit 50 - QPRO11" or
 *     "Deposit-Welcome 25% - QP2A, QP2B").
 *
 *  3. Banner — value is already captured, but the operator's column header
 *     might be "Banner Required?" or similar. Broaden the regex to match
 *     any "banner" variant including "banner needed", "banner required",
 *     "banner ask", etc. Also default to "No" when user doesn't pick.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
let dash = proj.files[dashIdx].source;
let code = proj.files[codeIdx].source;

let pass = 0, fail = 0;
function patch(label, target, oldStr, newStr) {
  const src = target === 'dash' ? dash : code;
  if (src.includes(oldStr)) {
    if (target === 'dash') dash = src.replace(oldStr, newStr);
    else                   code = src.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// ─── 1. Add Deadline date input to the Validity section ─────────────────────
patch('Validity section — add Deadline date input',
  'dash',
  `        <div class="pr-section-title">⏱  Validity</div>
        <div class="pr-grid-3">
          <div class="form-row" style="margin:0"><label class="form-label">Validity (after claim)</label>
            <input id="pr-validity" type="number" placeholder="days, e.g. 7" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Reward validity (before claim)</label>
            <input id="pr-rewardvalidity" type="number" placeholder="days, e.g. 14" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Recurring</label>
            <select id="pr-recurring" style="width:100%">
              <option value="">One-off</option>
              <option>Daily</option><option>Weekly</option><option>Monthly</option>
            </select></div>
        </div>`,
  `        <div class="pr-section-title">⏱  Validity &amp; Deadline</div>
        <div class="pr-grid-4">
          <div class="form-row" style="margin:0"><label class="form-label">Deadline *</label>
            <input id="pr-deadline" type="date" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Validity (after claim)</label>
            <input id="pr-validity" type="number" placeholder="days, e.g. 7" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Reward validity (before claim)</label>
            <input id="pr-rewardvalidity" type="number" placeholder="days, e.g. 14" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Recurring</label>
            <select id="pr-recurring" style="width:100%">
              <option value="">One-off</option>
              <option>Daily</option><option>Weekly</option><option>Monthly</option>
            </select></div>
        </div>`);

// ─── 2. submitPromoRequest — capture deadline ──────────────────────────────
patch('submitPromoRequest — capture pr-deadline',
  'dash',
  `    validity:    v('pr-validity'),
    rewardValidity: v('pr-rewardvalidity'),
    recurring:   v('pr-recurring'),`,
  `    deadline:    v('pr-deadline'),
    validity:    v('pr-validity'),
    rewardValidity: v('pr-rewardvalidity'),
    recurring:   v('pr-recurring'),`);

// ─── 3. clearPromoRequest_ — reset deadline ────────────────────────────────
patch('clearPromoRequest_ — include pr-deadline',
  'dash',
  `  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer-lifetime','pr-maxplayer-daily','pr-cats','pr-validity','pr-rewardvalidity','pr-desc']`,
  `  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer-lifetime','pr-maxplayer-daily','pr-cats','pr-deadline','pr-validity','pr-rewardvalidity','pr-desc']`);

// ─── 4. Server-side fix: Deadline from form, auto-generate name_details ───
patch('serverSubmitPromoCodeRequest — fix Deadline + auto Name/Details + broader Banner regex',
  'code',
  `        set(/^date\\b/i,              Utilities.formatDate(now, 'GMT+8', 'd MMM yyyy'));
        set(/^request[oe]r\\b/i,      form.requestor || form.email || '');
        set(/^brand/i,               form.brand || '');
        set(/^region/i,              form.region || '');
        set(/^campaign/i,            form.campaign || '');
        set(/^bonus\\s*type/i,        form.bonusType || '');
        set(/^priority\\b/i,          form.priority || 'Normal');
        set(/^deadline\\b/i,          form.endDate ? Utilities.formatDate(new Date(form.endDate), 'GMT+8', 'd MMM yyyy') : '');
        set(/^promo\\s*code/i,        form.promoCode || '');
        set(/^name.*details|^details/i, form.nameDetails || '');
        set(/^promotion\\s*names?\\s*\\(en\\)|^name\\s*\\(en\\)/i, form.nameEn || '');
        set(/^promotion\\s*names?\\s*\\(zh|^name\\s*\\(zh/i, form.nameZh || '');
        set(/^remark|^notes?/i,      form.description || '');
        set(/^validity\\b/i,          form.validity || '');
        set(/^recurring|^claim/i,    form.recurring || '');
        set(/^max\\s*per\\s*player/i,  form.maxPlayer || '');
        set(/^banner/i,              form.banner || '');
        set(/^inbox\\s*message/i,     form.inbox || '');
        set(/^pop.?up\\s*dialog|^popup/i, form.popup || '');`,
  `        // Auto-derive Name/Details (column M) if not explicitly provided.
        // Pattern matches the operator's convention: "Bonus 25% - Brand" or
        // "Free Credit 50 - QPRO11" — the bot's promo-namer can refine later.
        var autoNameDetails = form.nameDetails;
        if (!autoNameDetails && form.bonusType) {
          var amt = String(form.amount || '').trim();
          var brandStr = String(form.brand || '').trim();
          var brandShort = brandStr.split(/[,\\s]+/).slice(0, 3).join(', ');
          if (brandStr.split(/[,\\s]+/).length > 3) brandShort += ', …';
          autoNameDetails = form.bonusType + (amt ? ' ' + amt : '') + (brandShort ? ' - ' + brandShort : '');
        }
        // Deadline — prefer explicit form.deadline (V55), fall back to form.endDate (legacy).
        var deadlineStr = '';
        var deadlineRaw = form.deadline || form.endDate;
        if (deadlineRaw) {
          try { deadlineStr = Utilities.formatDate(new Date(deadlineRaw), 'GMT+8', 'd MMM yyyy'); }
          catch(_) { deadlineStr = String(deadlineRaw); }
        }

        set(/^date\\b/i,              Utilities.formatDate(now, 'GMT+8', 'd MMM yyyy'));
        set(/^request[oe]r\\b/i,      form.requestor || form.email || '');
        set(/^brand/i,               form.brand || '');
        set(/^region/i,              form.region || '');
        set(/^campaign/i,            form.campaign || '');
        set(/^bonus\\s*type/i,        form.bonusType || '');
        set(/^priority\\b/i,          form.priority || 'Normal');
        set(/^deadline\\b/i,          deadlineStr);
        set(/^promo\\s*code/i,        form.promoCode || '');
        set(/^name.*details|^details|^column\\s*m/i, autoNameDetails || '');
        set(/^promotion\\s*names?\\s*\\(en\\)|^name\\s*\\(en\\)/i, form.nameEn || '');
        set(/^promotion\\s*names?\\s*\\(zh|^name\\s*\\(zh/i, form.nameZh || '');
        set(/^remark|^notes?/i,      form.description || '');
        set(/^validity\\b/i,          form.validity || '');
        set(/^reward.*validity/i,    form.rewardValidity || '');
        set(/^recurring|^claim/i,    form.recurring || '');
        set(/^max\\s*per\\s*player/i,  form.maxPlayer || '');
        set(/^banner(?!.*approval)/i, form.banner || 'No');
        set(/^inbox\\s*message/i,     form.inbox || '');
        set(/^pop.?up\\s*dialog|^popup/i, form.popup || '');`);

// Badge bump
patch('Badge V54 → V55', 'dash', `>V54 ✓</span>`, `>V55 ✓</span>`);

proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V55 — Banner + Deadline + Column M write-back fixes — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
