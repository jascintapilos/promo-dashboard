#!/usr/bin/env node
/**
 * V63 — Add dynamic Mechanics Details form fields (Column M templates are
 *       already in place from V62).
 *
 *  V62 fixed Column M on the server side but failed to apply the form-side
 *  patches because the anchor strings didn't match the live source after
 *  V54's reformatting. V63 retargets with the verified anchors.
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

// ─── 1. Wire onchange on the bonus dropdown ─────────────────────────────────
patch('Bonus Type select — wire onchange to updateMechanicsFields_',
  `            <select id="pr-bonus" style="width:100%">
              <option value="">— Select —</option>
              <option>Deposit-Welcome</option>`,
  `            <select id="pr-bonus" style="width:100%" onchange="updateMechanicsFields_()">
              <option value="">— Select —</option>
              <option>Deposit-Welcome</option>`);

// ─── 2. Insert the dynamic Mechanics Details block before Max per Player ────
patch('Insert Mechanics Details block before Max per Player',
  `        <!-- Max per Player — split into two number boxes -->`,
  `        <!-- Mechanics Details — fields appear based on bonus type -->
        <div id="pr-mechanics-section" style="display:none;margin-bottom:14px">
          <div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">⚙️  Mechanics Details <span id="pr-mech-hint" style="color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;margin-left:6px;font-size:10px;font-style:italic"></span></div>

          <!-- Free Spin fields -->
          <div id="pr-mech-fs" style="display:none;padding:14px;background:#21262d;border:1px solid #30363d;border-radius:8px">
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
              <div class="form-row" style="margin:0"><label class="form-label">Number of Free Spins *</label>
                <input id="pr-fsspins" type="number" placeholder="e.g. 299" style="width:100%"></div>
              <div class="form-row" style="margin:0"><label class="form-label">Game Name *</label>
                <input id="pr-fsgame" placeholder="e.g. Fortune of Olympus" style="width:100%"></div>
              <div class="form-row" style="margin:0"><label class="form-label">Value per Spin</label>
                <input id="pr-fsvalue" placeholder="e.g. 0.20" style="width:100%"></div>
            </div>
          </div>

          <!-- Free Credit fields -->
          <div id="pr-mech-fc" style="display:none;padding:14px;background:#21262d;border:1px solid #30363d;border-radius:8px">
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
              <div class="form-row" style="margin:0"><label class="form-label">Max Transfer *</label>
                <input id="pr-fcmaxtransfer" placeholder="e.g. 500 or XX" style="width:100%"></div>
              <div class="form-row" style="margin:0"><label class="form-label">FC Note (optional)</label>
                <input id="pr-fcnote" placeholder="extra notes if any" style="width:100%"></div>
            </div>
          </div>

          <!-- Deposit fields -->
          <div id="pr-mech-dep" style="display:none;padding:14px;background:#21262d;border:1px solid #30363d;border-radius:8px">
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
              <div class="form-row" style="margin:0"><label class="form-label">Bonus Campaign Name</label>
                <input id="pr-depname" placeholder="e.g. Assurance Package" style="width:100%"></div>
              <div class="form-row" style="margin:0"><label class="form-label">Max Bonus</label>
                <input id="pr-depmaxbns" type="number" placeholder="e.g. 400" style="width:100%"></div>
            </div>
          </div>
        </div>

        <!-- Max per Player — split into two number boxes -->`);

// ─── 3. updateMechanicsFields_ helper ───────────────────────────────────────
patch('JS — updateMechanicsFields_ toggler',
  `// Multi-brand chip picker (inline-styled) — keeps the hidden #pr-brand input comma-separated.
function brandPick_(code, target) {`,
  `// Show the right Mechanics Details block based on bonus type
function updateMechanicsFields_() {
  var bt = (document.getElementById('pr-bonus') || {}).value || '';
  var lower = bt.toLowerCase();
  var sec = document.getElementById('pr-mechanics-section');
  var fs  = document.getElementById('pr-mech-fs');
  var fc  = document.getElementById('pr-mech-fc');
  var dep = document.getElementById('pr-mech-dep');
  var hint = document.getElementById('pr-mech-hint');
  if (!sec || !fs || !fc || !dep) return;
  function set(el, on) { if (el) el.style.display = on ? '' : 'none'; }
  if (lower.indexOf('free spin') === 0) {
    set(sec, true); set(fs, true); set(fc, false); set(dep, false);
    if (hint) hint.textContent = 'Welcome Bonus 299 Free Spins – Fortune of Olympus, min dep 30, TO 1, 0.20 per spin';
  } else if (lower.indexOf('free credit') === 0) {
    set(sec, true); set(fs, false); set(fc, true); set(dep, false);
    if (hint) hint.textContent = 'Free Credit 50 – 8× TO, max transfer 500';
  } else if (lower.indexOf('deposit') === 0) {
    set(sec, true); set(fs, false); set(fc, false); set(dep, true);
    if (hint) hint.textContent = 'Assurance Package Bonus (50%, Reload Bonus, min dep 100, max bns 400, TO5×)';
  } else {
    set(sec, false); set(fs, false); set(fc, false); set(dep, false);
    if (hint) hint.textContent = '';
  }
}

// Multi-brand chip picker (inline-styled) — keeps the hidden #pr-brand input comma-separated.
function brandPick_(code, target) {`);

// ─── 4. submitPromoRequest — capture new FS/FC/DEP fields ───────────────────
patch('submitPromoRequest — capture FS/FC/DEP fields',
  `    deadline:    v('pr-deadline'),
    validity:    v('pr-validity'),
    rewardValidity: v('pr-rewardvalidity'),`,
  `    deadline:    v('pr-deadline'),
    fsSpins:     v('pr-fsspins'),
    fsGame:      v('pr-fsgame'),
    fsValue:     v('pr-fsvalue'),
    fcMaxTransfer: v('pr-fcmaxtransfer'),
    fcNote:      v('pr-fcnote'),
    depName:     v('pr-depname'),
    depMaxBns:   v('pr-depmaxbns'),
    validity:    v('pr-validity'),
    rewardValidity: v('pr-rewardvalidity'),`);

// ─── 5. clearPromoRequest_ — include new FS/FC/DEP fields ───────────────────
patch('clearPromoRequest_ — include FS/FC/DEP fields',
  `  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer-lifetime','pr-maxplayer-daily','pr-cats','pr-deadline','pr-validity','pr-rewardvalidity','pr-desc']`,
  `  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer-lifetime','pr-maxplayer-daily','pr-cats','pr-deadline','pr-validity','pr-rewardvalidity','pr-desc','pr-fsspins','pr-fsgame','pr-fsvalue','pr-fcmaxtransfer','pr-fcnote','pr-depname','pr-depmaxbns']`);

// Badge bump
patch('Badge V62 → V63', `>V62 ✓</span>`, `>V63 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V63 — dynamic Mechanics Details form (Column M templates from V62) — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
