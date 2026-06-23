#!/usr/bin/env node
/**
 * V39: Always-visible scroll control bar with ▲▼ (vertical) + ◀▶ slider (horizontal)
 *
 * V38 scroll-ctrl was hidden because horizontal overflow = 0 at 1280px width.
 * Fix: remove display:none default — bar always shows.
 * Add ▲/▼ buttons for vertical scroll within the 480px table wrapper.
 * Horizontal slider grays out when no horizontal overflow.
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

// ── FIX 1: Replace scroll-ctrl div — always visible, add ▲▼ buttons ───────────
const OLD_SCROLL_DIV = `      <div class="scroll-ctrl" id="h-scroll-ctrl" style="display:none">
        <button class="scroll-btn" onclick="var w=document.getElementById('task-table-wrap');w.scrollLeft-=150;syncScrollSlider_()">◀</button>
        <input type="range" id="h-scroll-slider" min="0" max="100" value="0" style="flex:1;accent-color:var(--accent)" oninput="var w=document.getElementById('task-table-wrap');var mx=Math.max(0,w.scrollWidth-w.clientWidth);w.scrollLeft=(parseInt(this.value)/100)*mx">
        <button class="scroll-btn" onclick="var w=document.getElementById('task-table-wrap');w.scrollLeft+=150;syncScrollSlider_()">▶</button>
      </div>`;

const NEW_SCROLL_DIV = `      <div class="scroll-ctrl" id="h-scroll-ctrl">
        <button class="scroll-btn" title="Scroll up" onclick="document.getElementById('task-table-wrap').scrollTop-=180">▲</button>
        <button class="scroll-btn" title="Scroll down" onclick="document.getElementById('task-table-wrap').scrollTop+=180">▼</button>
        <span style="flex:1;display:flex;align-items:center;gap:6px;margin:0 10px">
          <button class="scroll-btn" onclick="var w=document.getElementById('task-table-wrap');w.scrollLeft-=150;syncScrollSlider_()">◀</button>
          <input type="range" id="h-scroll-slider" min="0" max="100" value="0" style="flex:1;accent-color:var(--accent)" oninput="var w=document.getElementById('task-table-wrap');var mx=Math.max(0,w.scrollWidth-w.clientWidth);w.scrollLeft=(parseInt(this.value)/100)*mx">
          <button class="scroll-btn" onclick="var w=document.getElementById('task-table-wrap');w.scrollLeft+=150;syncScrollSlider_()">▶</button>
        </span>
      </div>`;

if (dash.includes(OLD_SCROLL_DIV)) {
  dash = dash.replace(OLD_SCROLL_DIV, NEW_SCROLL_DIV);
  console.log('✓ scroll-ctrl: always visible + ▲▼ buttons added');
} else {
  console.error('WARN: old scroll-ctrl div pattern not matched');
}

// ── FIX 2: Update syncScrollSlider_ — stop hiding ctrl, gray slider instead ──
const OLD_SYNC = `  var mx = Math.max(0, w.scrollWidth - w.clientWidth);
  ctrl.style.display = mx > 0 ? 'flex' : 'none';
  if (mx > 0) s.value = Math.round(w.scrollLeft / mx * 100);`;

const NEW_SYNC = `  var mx = Math.max(0, w.scrollWidth - w.clientWidth);
  s.disabled = mx <= 0;
  s.style.opacity = mx > 0 ? '1' : '0.35';
  if (mx > 0) s.value = Math.round(w.scrollLeft / mx * 100);`;

if (dash.includes(OLD_SYNC)) {
  dash = dash.replace(OLD_SYNC, NEW_SYNC);
  console.log('✓ syncScrollSlider_ updated — no longer hides ctrl');
} else {
  console.error('WARN: syncScrollSlider_ body not matched');
}

// ── FIX 3: Badge V38 → V39 ────────────────────────────────────────────────────
const OLD_BADGE = `>V38 ✓</span>`;
const NEW_BADGE = `>V39 ✓</span>`;
if (dash.includes(OLD_BADGE)) {
  dash = dash.replace(OLD_BADGE, NEW_BADGE);
  console.log('✓ Badge → V39');
} else {
  console.error('WARN: V38 badge not found');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V39: always-visible scroll bar with ▲▼◀▶ buttons — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('Deploy V' + v.versionNumber + ' → Manage deployments → pick Version ' + v.versionNumber);
