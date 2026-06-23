#!/usr/bin/env node
/**
 * V62 — Bonus-type-specific mechanics fields + matching Column M templates
 *
 *  Operator's Guideline tab defines a different Column M format per bonus
 *  type. V62 makes the dashboard form dynamic to collect the right inputs
 *  per type, then composes Column M to match the operator's convention:
 *
 *    Free Spin - Welcome / Reload:
 *      "Welcome Bonus 299 Free Spins - Fortune of Olympus,
 *       min dep 30, TO 1, 0.20 per spin"
 *
 *    Free Credit:
 *      "Free Credit 50 - 8X TO, max transfer 500"
 *
 *    Deposit - Welcome / Reload:
 *      "Assurance Package Bonus (50%, Reload Bonus,
 *       min dep 100, max bns 400, TO5x)"
 *
 *  Form changes:
 *    - New "Mechanics Details" sub-section below Brand & Bonus.
 *    - Three field groups (FS, FC, DEP) toggle visibility based on selected
 *      bonus type.
 *    - New fields: # spins · FS game name · value/spin · max transfer (FC) ·
 *      bonus campaign name (DEP).
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

// ─── 1. Add Mechanics Details section to the form ──────────────────────────
patch('Form — add dynamic Mechanics Details section + onchange wiring',
  `        <div class="pr-grid-3">
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
            </select></div>`,
  `        <div class="pr-grid-3">
          <div class="form-row" style="margin:0"><label class="form-label">Bonus Type *</label>
            <select id="pr-bonus" style="width:100%" onchange="updateMechanicsFields_()">
              <option value="">— Select —</option>
              <option>Deposit-Welcome</option>
              <option>Deposit-Reload</option>
              <option>Free Credit</option>
              <option>Free Spin-Welcome</option>
              <option>Free Spin-Reload</option>
              <option>Cashback</option>
              <option>Rebate</option>
            </select></div>`);

// Insert the dynamic Mechanics Details section right after the Brand & Bonus grid,
// before the Max per Player section. Anchor on "<!-- Max per Player".
patch('Form — insert Mechanics Details block before Max per Player',
  `        <!-- Max per Player — split into two number boxes -->`,
  `        <!-- Mechanics Details — fields appear based on bonus type -->
        <div id="pr-mechanics-section" style="display:none;margin-bottom:14px">
          <div style="font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">⚙️ Mechanics Details <span id="pr-mech-hint" style="color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;margin-left:6px"></span></div>

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

// ─── 2. Add updateMechanicsFields_ helper ──────────────────────────────────
patch('JS — add updateMechanicsFields_ toggler',
  `// Multi-region chip picker (inline-styled) — keeps the hidden #pr-region input comma-separated.
function regionPick_(code, target) {`,
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

// Multi-region chip picker (inline-styled) — keeps the hidden #pr-region input comma-separated.
function regionPick_(code, target) {`);

// ─── 3. submitPromoRequest — pull the new fields ────────────────────────────
patch('submitPromoRequest — capture FS/FC/DEP fields',
  `    deadline:    v('pr-deadline'),
    validity:    v('pr-validity'),
    rewardValidity: v('pr-rewardvalidity'),`,
  `    deadline:    v('pr-deadline'),
    // Bonus-type-specific mechanics
    fsSpins:     v('pr-fsspins'),
    fsGame:      v('pr-fsgame'),
    fsValue:     v('pr-fsvalue'),
    fcMaxTransfer: v('pr-fcmaxtransfer'),
    fcNote:      v('pr-fcnote'),
    depName:     v('pr-depname'),
    depMaxBns:   v('pr-depmaxbns'),
    validity:    v('pr-validity'),
    rewardValidity: v('pr-rewardvalidity'),`);

// ─── 4. clearPromoRequest_ — reset the new fields ───────────────────────────
patch('clearPromoRequest_ — include FS/FC/DEP fields',
  `  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer-lifetime','pr-maxplayer-daily','pr-cats','pr-deadline','pr-validity','pr-rewardvalidity','pr-desc']`,
  `  ['pr-requestor','pr-campaign','pr-brand','pr-region','pr-amount','pr-mindep','pr-maxcap','pr-turnover','pr-maxplayer-lifetime','pr-maxplayer-daily','pr-cats','pr-deadline','pr-validity','pr-rewardvalidity','pr-desc','pr-fsspins','pr-fsgame','pr-fsvalue','pr-fcmaxtransfer','pr-fcnote','pr-depname','pr-depmaxbns']`);

// ─── 5. Server-side: per-bonus-type Column M templates ──────────────────────
patch('Column M — per-bonus-type template composer',
  'code',
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
        var autoNameDetails = form.nameDetails || fmtMechanics_(form);`,
  `        // ── Compose Column M per bonus type, matching operator's Guideline ──
        function fmtMechanics_(f) {
          var bt = String(f.bonusType || '').toLowerCase();

          // FREE SPIN (Welcome / Reload):
          // "Welcome Bonus 299 Free Spins - Fortune of Olympus, min dep 30, TO 1, 0.20 per spin"
          if (bt.indexOf('free spin') === 0) {
            var prefix = bt.indexOf('welcome') >= 0 ? 'Welcome Bonus'
                       : bt.indexOf('reload') >= 0  ? 'Reload Bonus'
                       : 'Free Spin Bonus';
            var head = prefix;
            if (f.fsSpins) head += ' ' + f.fsSpins + ' Free Spins';
            if (f.fsGame)  head += ' - ' + f.fsGame;
            var parts = [head];
            if (f.minDeposit) parts.push('min dep ' + f.minDeposit);
            if (f.turnover)   parts.push('TO ' + f.turnover);
            if (f.fsValue)    parts.push(f.fsValue + ' per spin');
            return parts.join(', ');
          }

          // FREE CREDIT:
          // "Free Credit 50 - 8X TO, max transfer 500"
          if (bt.indexOf('free credit') === 0) {
            var head = 'Free Credit' + (f.amount ? ' ' + f.amount : '');
            var tail = [];
            if (f.turnover)      tail.push(f.turnover + 'X TO');
            if (f.fcMaxTransfer) tail.push('max transfer ' + f.fcMaxTransfer);
            if (f.fcNote)        tail.push(f.fcNote);
            return tail.length ? head + ' - ' + tail.join(', ') : head;
          }

          // DEPOSIT (Welcome / Reload):
          // "Assurance Package Bonus (50%, Reload Bonus, min dep 100, max bns 400, TO5×)"
          if (bt.indexOf('deposit') === 0) {
            var brandName = String(f.depName || '').trim();
            var subType   = bt.indexOf('welcome') >= 0 ? 'Welcome Bonus' : 'Reload Bonus';
            var head      = (brandName ? brandName + ' Bonus' : subType);
            var inner = [];
            if (f.amount)     inner.push(f.amount);
            if (brandName)    inner.push(subType);  // only repeat when we have a brand name as headline
            if (f.minDeposit) inner.push('min dep ' + f.minDeposit);
            var maxBns = f.depMaxBns || f.maxCap;
            if (maxBns)       inner.push('max bns ' + maxBns);
            if (f.turnover)   inner.push('TO' + f.turnover + '×');
            return inner.length ? head + ' (' + inner.join(', ') + ')' : head;
          }

          // CASHBACK / REBATE / fallback
          var bits = [];
          var head = (f.bonusType || '').trim();
          var amt = String(f.amount || '').trim();
          if (head && amt) head += ' ' + amt;
          else if (amt)    head = amt;
          if (head)         bits.push(head);
          if (f.minDeposit) bits.push('Min Dep ' + f.minDeposit);
          if (f.turnover)   bits.push('TO ' + f.turnover + '×');
          if (f.maxCap)     bits.push('Max Cap ' + f.maxCap);
          if (f.categories) bits.push(f.categories);
          if (f.recurring)  bits.push(f.recurring);
          return bits.join(' · ');
        }
        var autoNameDetails = form.nameDetails || fmtMechanics_(form);`);

// Badge bump
patch('Badge V61 → V62', 'dash', `>V61 ✓</span>`, `>V62 ✓</span>`);

proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V62 — dynamic mechanics fields per bonus type — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
