#!/usr/bin/env node
/**
 * V61 — Column M auto-name includes full promo mechanics
 *
 *  V55 generated a thin auto-name (just bonus + amount + brand) for Column M.
 *  Operators need the full mechanics there so they can identify the promo at
 *  a glance without scrolling 25 columns.
 *
 *  New format:
 *    "<Bonus Type> <Amount> · Min Dep <X> · TO <Y>× · Max Cap <Z> · <Cat> ·
 *     Validity <N>d · Max/Player <L>/<D> · <Recurring>"
 *
 *  Empty fields are dropped — only the parts the user filled in show up.
 *  Example outputs:
 *    "Deposit-Welcome 25% · Min Dep 30 · TO 5× · Max Cap 500 · Slots ·
 *     Validity 7d · Max/Player 1/1 · One-off"
 *    "Free Credit 50 · TO 1× · Slots"
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

// ─── Server-side: replace thin auto-name with full mechanics composer ───────
patch('Column M — combine full promo mechanics',
  'code',
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
        }`,
  `        // ── Compose Column M: full promo mechanics in one readable line ──
        // Joins only the parts the user actually filled in. Empty pieces are
        // omitted so the line scales gracefully from minimal to full.
        function fmtMechanics_(f) {
          var bits = [];
          // Headline: "<Bonus Type> <Amount>"
          var head = (f.bonusType || '').trim();
          var amt = String(f.amount || '').trim();
          if (head && amt) head += ' ' + amt;
          else if (amt) head = amt;
          if (head) bits.push(head);
          // Mechanics
          if (f.minDeposit) bits.push('Min Dep ' + f.minDeposit);
          if (f.turnover)   bits.push('TO ' + f.turnover + '×');
          if (f.maxCap)     bits.push('Max Cap ' + f.maxCap);
          if (f.categories) bits.push(f.categories);
          if (f.validity)   bits.push('Validity ' + f.validity + 'd');
          if (f.rewardValidity) bits.push('Reward Validity ' + f.rewardValidity + 'd');
          var lifetime = f.maxPlayerLifetime, daily = f.maxPlayerDaily;
          if (lifetime || daily) {
            bits.push('Max/Player ' + (lifetime || '∞') + '/' + (daily || '∞'));
          }
          if (f.recurring) bits.push(f.recurring);
          else            bits.push('One-off');
          return bits.join(' · ');
        }
        var autoNameDetails = form.nameDetails || fmtMechanics_(form);`);

// Badge bump
patch('Badge V60 → V61', 'dash', `>V60 ✓</span>`, `>V61 ✓</span>`);

proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V61 — Column M full mechanics — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
