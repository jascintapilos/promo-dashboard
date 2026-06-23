#!/usr/bin/env node
/**
 * V51 — Promo Request form: multi-brand chip selector, drop Platform, clean Bonus Type
 *
 *  1. Brand(s) / Merchant — click-to-toggle chips, grouped by platform.
 *     Selected chips highlight purple. The hidden input stays comma-separated
 *     so the existing submit + write-back logic still works.
 *  2. Platform field — removed entirely (auto-detected from brand at canary time).
 *  3. Bonus Type — trimmed to the 5 primary values the operator's sheet
 *     dropdown uses: Deposit · Free Credit · Free Spin · Cashback · Rebate.
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

// ─── 1. Replace the Brand/Platform/Bonus-Type row with brand chip picker ────
patch('Brand row — multi-chip selector + drop Platform + trim Bonus Type',
  `        <!-- 2. BRAND & BONUS -->
        <div class="pr-section-title">🏦  Brand &amp; Bonus</div>
        <div class="pr-grid-3">
          <div class="form-row" style="margin:0"><label class="form-label">Brand(s) / Merchant *</label>
            <input id="pr-brand" placeholder="QPRO11, IBC22, MB8 — comma-sep" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Region(s)</label>
            <input id="pr-region" placeholder="MY, SG, ID, TH, KH, AU, PH" style="width:100%"></div>
          <div class="form-row" style="margin:0"><label class="form-label">Platform</label>
            <select id="pr-platform" style="width:100%">
              <option value="">— auto-detect from brand —</option>
              <option>QPRO</option><option>QP2</option><option>WS1</option><option>WS2</option>
            </select></div>
          <div class="form-row" style="margin:0"><label class="form-label">Bonus Type *</label>
            <select id="pr-bonus" style="width:100%">
              <option value="">— Select —</option>
              <option>Deposit</option><option>Free Credit</option><option>Free Spin</option>
              <option>Cashback</option><option>Reload</option><option>Rebate</option>
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
  `        <!-- 2. BRAND & BONUS -->
        <div class="pr-section-title">🏦  Brand &amp; Bonus</div>

        <!-- Brand chip picker (multi-select) -->
        <div class="form-row" style="margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <label class="form-label" style="margin:0">Brand(s) / Merchant * <span id="pr-brand-count" style="color:var(--muted);font-weight:400;font-size:11px;margin-left:6px">(0 selected)</span></label>
            <div style="display:flex;gap:8px;font-size:11px">
              <button type="button" class="pr-chip-link" onclick="brandPick_(null,'all')">Select all</button>
              <button type="button" class="pr-chip-link" onclick="brandPick_(null,'none')">Clear</button>
            </div>
          </div>
          <input type="hidden" id="pr-brand">
          <div id="pr-brand-chips" class="pr-brand-grid">
            <div class="pr-brand-group">
              <div class="pr-brand-group-title">QP2</div>
              <div class="pr-chips">
                <div class="pr-chip" onclick="brandPick_('QP2A',this)">QP2A</div>
                <div class="pr-chip" onclick="brandPick_('QP2B',this)">QP2B</div>
                <div class="pr-chip" onclick="brandPick_('QP2C',this)">QP2C</div>
                <div class="pr-chip" onclick="brandPick_('QP2D',this)">QP2D</div>
              </div>
            </div>
            <div class="pr-brand-group">
              <div class="pr-brand-group-title">QPRO <span class="pr-group-bulk" onclick="brandPick_(null,'qpro')">all</span></div>
              <div class="pr-chips">
                <div class="pr-chip" onclick="brandPick_('QPRO1',this)">QPRO1</div>
                <div class="pr-chip" onclick="brandPick_('QPRO2',this)">QPRO2</div>
                <div class="pr-chip" onclick="brandPick_('QPRO3',this)">QPRO3</div>
                <div class="pr-chip" onclick="brandPick_('QPRO4',this)">QPRO4</div>
                <div class="pr-chip" onclick="brandPick_('QPRO5',this)">QPRO5</div>
                <div class="pr-chip" onclick="brandPick_('QPRO6',this)">QPRO6</div>
                <div class="pr-chip" onclick="brandPick_('QPRO7',this)">QPRO7</div>
                <div class="pr-chip" onclick="brandPick_('QPRO8',this)">QPRO8</div>
                <div class="pr-chip" onclick="brandPick_('QPRO9',this)">QPRO9</div>
                <div class="pr-chip" onclick="brandPick_('QPRO10',this)">QPRO10</div>
                <div class="pr-chip" onclick="brandPick_('QPRO11',this)">QPRO11</div>
                <div class="pr-chip" onclick="brandPick_('QPRO12',this)">QPRO12</div>
                <div class="pr-chip" onclick="brandPick_('QPRO13',this)">QPRO13</div>
                <div class="pr-chip" onclick="brandPick_('QPRO14',this)">QPRO14</div>
                <div class="pr-chip" onclick="brandPick_('QPRO15',this)">QPRO15</div>
                <div class="pr-chip" onclick="brandPick_('QPRO16',this)">QPRO16</div>
                <div class="pr-chip" onclick="brandPick_('QPRO17',this)">QPRO17</div>
              </div>
            </div>
            <div class="pr-brand-group">
              <div class="pr-brand-group-title">WS1 / WS2 (IGMP)</div>
              <div class="pr-chips">
                <div class="pr-chip" onclick="brandPick_('MB8-MY',this)">MB8-MY</div>
                <div class="pr-chip" onclick="brandPick_('MB8-SG',this)">MB8-SG</div>
                <div class="pr-chip" onclick="brandPick_('MB8-ID',this)">MB8-ID</div>
                <div class="pr-chip" onclick="brandPick_('MB8-TH',this)">MB8-TH</div>
                <div class="pr-chip" onclick="brandPick_('MB8-KH',this)">MB8-KH</div>
                <div class="pr-chip" onclick="brandPick_('RWS77',this)">RWS77</div>
              </div>
            </div>
          </div>
        </div>

        <div class="pr-grid-3">
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
        </div>`);

// ─── 2. brandPick_ helper + state sync ───────────────────────────────────────
patch('Add brandPick_ helper above submitPromoRequest',
  `function clearPromoRequest_() {`,
  `// Multi-brand chip picker — keeps the hidden #pr-brand input comma-separated.
function brandPick_(code, target) {
  var chips = document.querySelectorAll('#pr-brand-chips .pr-chip');
  if (target === 'all') {
    chips.forEach(function(c){ c.classList.add('selected'); });
  } else if (target === 'none') {
    chips.forEach(function(c){ c.classList.remove('selected'); });
  } else if (target === 'qpro') {
    chips.forEach(function(c){
      var t = (c.textContent || '').trim();
      if (/^QPRO\\d+$/.test(t)) c.classList.add('selected');
    });
  } else if (target && target.classList) {
    target.classList.toggle('selected');
  }
  // Sync hidden input + count
  var selected = [];
  document.querySelectorAll('#pr-brand-chips .pr-chip.selected').forEach(function(c){
    selected.push((c.textContent || '').trim());
  });
  var hid = document.getElementById('pr-brand');
  if (hid) hid.value = selected.join(', ');
  var cnt = document.getElementById('pr-brand-count');
  if (cnt) cnt.textContent = '(' + selected.length + ' selected)';
}

function clearPromoRequest_() {`);

// ─── 3. Update clearPromoRequest_ to also clear chips ────────────────────────
patch('clearPromoRequest_ — also reset brand chips',
  `function clearPromoRequest_() {
  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer','pr-cats','pr-code','pr-namedetails','pr-nameEn','pr-nameZh','pr-start','pr-end','pr-validity','pr-desc']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  ['pr-bonus','pr-platform','pr-priority','pr-recurring','pr-inbox','pr-popup','pr-banner']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.selectedIndex=0;});
  var r=document.getElementById('pr-result');if(r)r.style.display='none';
}`,
  `function clearPromoRequest_() {
  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer','pr-cats','pr-code','pr-namedetails','pr-nameEn','pr-nameZh','pr-start','pr-end','pr-validity','pr-desc']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  ['pr-bonus','pr-priority','pr-recurring','pr-inbox','pr-popup','pr-banner']
    .forEach(function(id){var el=document.getElementById(id);if(el)el.selectedIndex=0;});
  brandPick_(null,'none');
  var r=document.getElementById('pr-result');if(r)r.style.display='none';
}`);

// ─── 4. Drop platform from form payload ──────────────────────────────────────
patch('submitPromoRequest — drop platform field (auto-detected from brand)',
  `    region:      v('pr-region'),
    platform:    v('pr-platform'),
    bonusType,`,
  `    region:      v('pr-region'),
    bonusType,`);

// ─── 5. Add chip CSS to existing promo-request styles block ─────────────────
patch('CSS — brand chip picker styles',
  `.pr-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:10px}`,
  `.pr-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:10px}
.pr-brand-grid{display:grid;grid-template-columns:140px 1fr;gap:14px 18px;padding:14px;background:var(--card2);border:1px solid var(--border);border-radius:8px}
.pr-brand-group{display:contents}
.pr-brand-group-title{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding-top:6px;display:flex;align-items:center;gap:8px}
.pr-group-bulk{font-size:10px;color:var(--accent);cursor:pointer;font-weight:600;text-transform:none;letter-spacing:0;padding:2px 6px;border-radius:4px;background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.25)}
.pr-group-bulk:hover{background:rgba(124,58,237,.22)}
.pr-chips{display:flex;flex-wrap:wrap;gap:6px}
.pr-chip{padding:5px 10px;font-size:11px;font-weight:600;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);cursor:pointer;transition:all .12s;user-select:none;font-family:'SF Mono','Consolas',monospace;letter-spacing:.02em}
.pr-chip:hover{border-color:var(--accent);transform:translateY(-1px)}
.pr-chip.selected{background:var(--accent);border-color:var(--accent);color:#fff;box-shadow:0 2px 6px rgba(124,58,237,.35)}
.pr-chip.selected:hover{background:#8b4cf0}
.pr-chip-link{background:none;border:none;color:var(--muted);font-size:11px;cursor:pointer;padding:2px 6px;border-radius:4px;font-family:inherit}
.pr-chip-link:hover{color:var(--accent);background:rgba(124,58,237,.08)}`);

// Bump badge
patch('Badge V50 → V51', `>V50 ✓</span>`, `>V51 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V51 — promo brand chip picker — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
