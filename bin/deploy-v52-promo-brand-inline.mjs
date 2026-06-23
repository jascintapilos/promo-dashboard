#!/usr/bin/env node
/**
 * V52 — Brand chip picker: switch to inline styles (CSS classes weren't applying)
 *
 * V51's .pr-chip / .pr-brand-grid CSS rules weren't being applied by the
 * sandboxed iframe — chips rendered as plain stacked text. Same trick as
 * V48 for the report tabs: use inline `style="…"` attributes which always
 * win regardless of CSS-loading edge cases.
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

// ─── Replace the chip markup with inline-styled version ─────────────────────
patch('Brand chip picker — inline styles (always wins)',
  `        <!-- Brand chip picker (multi-select) -->
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
        </div>`,
  `        <!-- Brand chip picker (multi-select) — inline styles -->
        <div style="margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.05em">Brand(s) / Merchant * <span id="pr-brand-count" style="color:#8b949e;font-weight:400;font-size:11px;margin-left:6px;text-transform:none">(0 selected)</span></div>
            <div style="display:flex;gap:4px">
              <button type="button" onclick="brandPick_(null,'all')" style="background:transparent;border:1px solid #30363d;color:#8b949e;font-size:11px;padding:3px 10px;border-radius:5px;cursor:pointer;font-family:inherit">Select all</button>
              <button type="button" onclick="brandPick_(null,'none')" style="background:transparent;border:1px solid #30363d;color:#8b949e;font-size:11px;padding:3px 10px;border-radius:5px;cursor:pointer;font-family:inherit">Clear</button>
            </div>
          </div>
          <input type="hidden" id="pr-brand">
          <div id="pr-brand-chips" style="display:grid;grid-template-columns:120px 1fr;gap:12px 16px;padding:14px;background:#21262d;border:1px solid #30363d;border-radius:8px;align-items:start">

            <div style="font-size:11px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;padding-top:5px">QP2</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${['QP2A','QP2B','QP2C','QP2D'].map(b=>`<div onclick="brandPick_('${b}',this)" data-brand="${b}" style="padding:5px 11px;font-size:11px;font-weight:600;background:#1c2128;border:1px solid #30363d;border-radius:6px;color:#e6edf3;cursor:pointer;transition:all .12s;user-select:none;font-family:'SF Mono',Consolas,monospace">${b}</div>`).join('')}</div>

            <div style="font-size:11px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;padding-top:5px;display:flex;align-items:center;gap:8px">QPRO <span onclick="brandPick_(null,'qpro')" style="font-size:10px;color:#7c3aed;cursor:pointer;font-weight:600;text-transform:none;letter-spacing:0;padding:2px 7px;border-radius:4px;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3)">all</span></div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${[...Array(17)].map((_,i)=>{const b='QPRO'+(i+1);return `<div onclick="brandPick_('${b}',this)" data-brand="${b}" style="padding:5px 11px;font-size:11px;font-weight:600;background:#1c2128;border:1px solid #30363d;border-radius:6px;color:#e6edf3;cursor:pointer;transition:all .12s;user-select:none;font-family:'SF Mono',Consolas,monospace">${b}</div>`;}).join('')}</div>

            <div style="font-size:11px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;padding-top:5px">WS1 / WS2</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${['MB8-MY','MB8-SG','MB8-ID','MB8-TH','MB8-KH','RWS77'].map(b=>`<div onclick="brandPick_('${b}',this)" data-brand="${b}" style="padding:5px 11px;font-size:11px;font-weight:600;background:#1c2128;border:1px solid #30363d;border-radius:6px;color:#e6edf3;cursor:pointer;transition:all .12s;user-select:none;font-family:'SF Mono',Consolas,monospace">${b}</div>`).join('')}</div>

          </div>
        </div>`);

// ─── Update brandPick_ to use inline style swaps + data-brand attr ──────────
patch('brandPick_ — toggle inline styles instead of CSS class',
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
}`,
  `// Multi-brand chip picker (inline-styled) — keeps the hidden #pr-brand input comma-separated.
function brandPick_(code, target) {
  var chips = document.querySelectorAll('#pr-brand-chips [data-brand]');
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
  if (target === 'all') {
    chips.forEach(function(c){ setSelected(c, true); });
  } else if (target === 'none') {
    chips.forEach(function(c){ setSelected(c, false); });
  } else if (target === 'qpro') {
    chips.forEach(function(c){
      if (/^QPRO\\d+$/.test(c.dataset.brand || '')) setSelected(c, true);
    });
  } else if (target && target.dataset) {
    setSelected(target, target.dataset.selected !== '1');
  }
  // Sync hidden input + count
  var selected = [];
  chips.forEach(function(c){ if (c.dataset.selected === '1') selected.push(c.dataset.brand); });
  var hid = document.getElementById('pr-brand');
  if (hid) hid.value = selected.join(', ');
  var cnt = document.getElementById('pr-brand-count');
  if (cnt) cnt.textContent = '(' + selected.length + ' selected)';
}`);

// Badge bump
patch('Badge V51 → V52', `>V51 ✓</span>`, `>V52 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V52 — brand chips inline-styled — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
