#!/usr/bin/env node
/**
 * V54 — Promo Request form: region chip picker, bonus type sub-categories,
 *       max-per-player split into two number boxes
 *
 *  1. Region(s) — text input → chip selector matching the brand UX:
 *     MY · SG · ID · TH · KH · AU · PH.
 *  2. Bonus Type — sheet now uses sub-categories:
 *     Deposit-Welcome · Deposit-Reload · Free Credit · Free Spin-Welcome ·
 *     Free Spin-Reload (and keeps Cashback + Rebate).
 *  3. Max per Player — single "Lifetime / Daily" text input → two clean
 *     number inputs labeled "Lifetime" and "Daily".
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
let dash = proj.files[dashIdx].source;

let pass = 0, fail = 0;
function patch(label, oldStr, newStr) {
  if (dash.includes(oldStr)) {
    dash = dash.replace(oldStr, newStr);
    console.log('✓ ' + label);
    pass++;
    return true;
  }
  console.error('✗ WARN: ' + label + ' — anchor not found');
  fail++;
  return false;
}

// ─── 1. Replace the Region/Bonus Type row + Max per Player ───────────────────
patch('Region chip picker + new bonus types + max-player split',
  `        <div class="pr-grid-3">
          <div class="form-row" style="margin:0"><label class="form-label">Region(s)</label>
            <input id="pr-region" placeholder="MY, SG, ID, TH, KH, AU, PH" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Bonus Type *</label>
            <select id="pr-bonus" style="width:100%">
              <option value="">— Select —</option>
              <option>Deposit</option>
              <option>Free Credit</option>
              <option>Free Spin</option>
              <option>Cashback</option>
              <option>Rebate</option>
            </select></div>
          <div class="form-row" style="margin:0"><label class="form-label">Bonus Amount</label>
            <input id="pr-amount" placeholder="50 or 25%" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Min Deposit</label>
            <input id="pr-mindep" type="number" placeholder="30" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Max Cap (per claim)</label>
            <input id="pr-maxcap" type="number" placeholder="500" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Turnover (×)</label>
            <input id="pr-turnover" type="number" step="0.5" placeholder="5" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Max per Player</label>
            <input id="pr-maxplayer" placeholder="Lifetime / Daily" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Categories</label>
            <input id="pr-cats" placeholder="All / Slots / LC (default: All)" style="width:100%"></div>
        </div>`,
  `        <!-- Region chip picker (multi-select) — same style as brand picker -->
        <div style="margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.05em">Region(s) <span id="pr-region-count" style="color:#8b949e;font-weight:400;font-size:11px;margin-left:6px;text-transform:none">(0 selected)</span></div>
            <div style="display:flex;gap:4px">
              <button type="button" onclick="regionPick_(null,'all')" style="background:transparent;border:1px solid #30363d;color:#8b949e;font-size:11px;padding:3px 10px;border-radius:5px;cursor:pointer;font-family:inherit">Select all</button>
              <button type="button" onclick="regionPick_(null,'none')" style="background:transparent;border:1px solid #30363d;color:#8b949e;font-size:11px;padding:3px 10px;border-radius:5px;cursor:pointer;font-family:inherit">Clear</button>
            </div>
          </div>
          <input type="hidden" id="pr-region">
          <div id="pr-region-chips" style="display:flex;flex-wrap:wrap;gap:6px;padding:14px;background:#21262d;border:1px solid #30363d;border-radius:8px">
            \${['MY','SG','ID','TH','KH','AU','PH'].map(function(r){return '<div onclick="regionPick_(\\''+r+'\\',this)" data-region="'+r+'" style="padding:5px 13px;font-size:12px;font-weight:600;background:#1c2128;border:1px solid #30363d;border-radius:6px;color:#e6edf3;cursor:pointer;transition:all .12s;user-select:none;font-family:\\'SF Mono\\',Consolas,monospace;letter-spacing:.05em">'+r+'</div>';}).join('')}
          </div>
        </div>

        <div class="pr-grid-3">
          <div class="form-row" style="margin:0"><label class="form-label">Bonus Type *</label>
            <select id="pr-bonus" style="width:100%">
              <option value="">— Select —</option>
              <option>Deposit-Welcome</option>
              <option>Deposit-Reload</option>
              <option>Free Credit</option>
              <option>Free Spin-Welcome</option>
              <option>Free Spin-Reload</option>
              <option>Cashback</option>
              <option>Rebate</option>
            </select></div>
          <div class="form-row" style="margin:0"><label class="form-label">Bonus Amount</label>
            <input id="pr-amount" placeholder="50 or 25%" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Min Deposit</label>
            <input id="pr-mindep" type="number" placeholder="30" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Max Cap (per claim)</label>
            <input id="pr-maxcap" type="number" placeholder="500" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Turnover (×)</label>
            <input id="pr-turnover" type="number" step="0.5" placeholder="5" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Categories</label>
            <input id="pr-cats" placeholder="All / Slots / LC (default: All)" style="width:100%"></div>
        </div>

        <!-- Max per Player — split into two number boxes -->
        <div style="margin-bottom:14px">
          <div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Max per Player</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#21262d;border:1px solid #30363d;border-radius:8px">
              <span style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.04em;min-width:60px">Lifetime</span>
              <input id="pr-maxplayer-lifetime" type="number" placeholder="e.g. 1" min="0" style="flex:1;background:#1c2128;border:1px solid #30363d;border-radius:6px;padding:7px 10px;color:#e6edf3;font-size:13px;outline:none">
            </div>
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#21262d;border:1px solid #30363d;border-radius:8px">
              <span style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.04em;min-width:60px">Daily</span>
              <input id="pr-maxplayer-daily" type="number" placeholder="e.g. 1" min="0" style="flex:1;background:#1c2128;border:1px solid #30363d;border-radius:6px;padding:7px 10px;color:#e6edf3;font-size:13px;outline:none">
            </div>
          </div>
        </div>`);

// ─── 2. Add regionPick_ helper alongside brandPick_ ─────────────────────────
patch('Add regionPick_ helper',
  `// Multi-brand chip picker (inline-styled) — keeps the hidden #pr-brand input comma-separated.
function brandPick_(code, target) {`,
  `// Multi-region chip picker (inline-styled) — keeps the hidden #pr-region input comma-separated.
function regionPick_(code, target) {
  var chips = document.querySelectorAll('#pr-region-chips [data-region]');
  function setSelected(el, sel) {
    if (sel) {
      el.dataset.selected = '1';
      el.style.background = '#7c3aed';
      el.style.borderColor = '#7c3aed';
      el.style.color = '#fff';
      el.style.boxShadow = '0 2px 6px rgba(124,58,237,.35)';
    } else {
      el.dataset.selected = '';
      el.style.background = '#1c2128';
      el.style.borderColor = '#30363d';
      el.style.color = '#e6edf3';
      el.style.boxShadow = 'none';
    }
  }
  if (target === 'all') chips.forEach(function(c){ setSelected(c, true); });
  else if (target === 'none') chips.forEach(function(c){ setSelected(c, false); });
  else if (target && target.dataset) setSelected(target, target.dataset.selected !== '1');
  // Sync hidden input + count
  var selected = [];
  chips.forEach(function(c){ if (c.dataset.selected === '1') selected.push(c.dataset.region); });
  var hid = document.getElementById('pr-region');
  if (hid) hid.value = selected.join(', ');
  var cnt = document.getElementById('pr-region-count');
  if (cnt) cnt.textContent = '(' + selected.length + ' selected)';
}

// Multi-brand chip picker (inline-styled) — keeps the hidden #pr-brand input comma-separated.
function brandPick_(code, target) {`);

// ─── 3. Update clearPromoRequest_ — handle new max-player fields + region ───
patch('clearPromoRequest_ — include new max-player fields, drop pr-maxplayer',
  `function clearPromoRequest_() {
  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer','pr-cats','pr-validity','pr-rewardvalidity','pr-desc']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  ['pr-bonus','pr-priority','pr-recurring','pr-inbox','pr-popup','pr-banner']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.selectedIndex=0;});
  brandPick_(null,'none');
  var r=document.getElementById('pr-result');if(r)r.style.display='none';
}`,
  `function clearPromoRequest_() {
  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer-lifetime','pr-maxplayer-daily','pr-cats','pr-validity','pr-rewardvalidity','pr-desc']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  ['pr-bonus','pr-priority','pr-recurring','pr-inbox','pr-popup','pr-banner']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.selectedIndex=0;});
  brandPick_(null,'none');
  regionPick_(null,'none');
  var r=document.getElementById('pr-result');if(r)r.style.display='none';
}`);

// ─── 4. Update submitPromoRequest payload — split maxPlayer into two ────────
patch('submitPromoRequest — maxPlayer split into lifetime+daily',
  `    maxPlayer:   v('pr-maxplayer'),
    categories:  v('pr-cats'),`,
  `    maxPlayerLifetime: v('pr-maxplayer-lifetime'),
    maxPlayerDaily:    v('pr-maxplayer-daily'),
    maxPlayer:   [v('pr-maxplayer-lifetime'), v('pr-maxplayer-daily')].filter(Boolean).join(' / '),
    categories:  v('pr-cats'),`);

// Badge bump (V52 → V54, skip V53 which never went live)
patch('Badge V53 → V54', `>V53 ✓</span>`, `>V54 ✓</span>`);
// Fallback if the source actually shows V52 still (V53 never updated badge live)
// — already covered by the V53 patch above

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V54 — region chips + bonus subcat + max-player split — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
