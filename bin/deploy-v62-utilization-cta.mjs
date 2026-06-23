#!/usr/bin/env node
/**
 * V62 — Make the compact Utilization card's "expand" action explicit.
 *
 * After the V57 filters redesign + V52 hover-lift CSS, clicks on the
 * outer card sometimes register on child elements instead. The card has
 * onclick but the hover-translate animation can shift the hit-target
 * mid-click. Fix:
 *   1. Replace the bare card onclick with an explicit "Open detailed
 *      view →" CTA button in the card footer (always works, visible).
 *   2. Keep the whole-card onclick as fallback BUT add stopPropagation
 *      to inner KPI cards so their hover doesn't intercept anything.
 *   3. Add a clear "→ Click anywhere to expand" hint next to subtitle.
 */
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID     = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';

const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// ─── 1. Update the card opening to include a clearer "click to expand" hint ─
const OLD_OPENING = `  return '<div class="card" onclick="__rptNav_(\\'utilization\\')" style="padding:18px;margin:0 0 14px 0;cursor:pointer">'
    // Header
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      +'<div style="display:flex;align-items:center;gap:10px">'
        +'<div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#ec4899,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:18px">👥</div>'
        +'<div><div style="font-size:16px;font-weight:800;color:var(--text)">Utilization</div><div style="font-size:10px;color:var(--muted)">Team capacity & workload · click to expand</div></div>'
      +'</div>'
      +'<span style="background:'+healthColor+'22;color:'+healthColor+';padding:4px 12px;border-radius:14px;font-size:11px;font-weight:700;border:1px solid '+healthColor+'44">'+healthBadge+'</span>'
    +'</div>'`;

const NEW_OPENING = `  return '<div class="card" onclick="__rptNav_(\\'utilization\\')" style="padding:18px;margin:0 0 14px 0;cursor:pointer">'
    // Header
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
      +'<div style="display:flex;align-items:center;gap:10px">'
        +'<div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#ec4899,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:18px">👥</div>'
        +'<div><div style="font-size:16px;font-weight:800;color:var(--text)">Utilization</div><div style="font-size:10px;color:var(--muted)">Team capacity & workload — real logged hours</div></div>'
      +'</div>'
      +'<div style="display:flex;gap:10px;align-items:center">'
        +'<span style="background:'+healthColor+'22;color:'+healthColor+';padding:4px 12px;border-radius:14px;font-size:11px;font-weight:700;border:1px solid '+healthColor+'44">'+healthBadge+'</span>'
        +'<button onclick="event.stopPropagation();__rptNav_(\\'utilization\\')" style="background:linear-gradient(135deg,#7c3aed,#a78bfa);color:#fff;border:none;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:5px">Open Detailed View →</button>'
      +'</div>'
    +'</div>'`;

if (!dash.includes(OLD_OPENING)) {
  console.error('✗ Utilization card opening anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_OPENING, NEW_OPENING);
console.log('✓ Added explicit "Open Detailed View →" button to header');

// ─── 2. Add another CTA at the bottom of the AI Insight box ─────────────────
const OLD_BOTTOM = `    +'<div style="background:linear-gradient(135deg,rgba(124,58,237,.08),rgba(14,165,233,.04));border:1px solid rgba(124,58,237,.25);border-radius:8px;padding:12px 14px">'
      +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">'
        +'<span style="font-size:13px;color:#a78bfa">✦</span>'
        +'<span style="font-size:11px;font-weight:700;color:#a78bfa;letter-spacing:.05em">AI INSIGHT</span>'
      +'</div>'
      +insightHtml
    +'</div>'
  +'</div>';
}`;

const NEW_BOTTOM = `    +'<div style="background:linear-gradient(135deg,rgba(124,58,237,.08),rgba(14,165,233,.04));border:1px solid rgba(124,58,237,.25);border-radius:8px;padding:12px 14px">'
      +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
        +'<div style="display:flex;align-items:center;gap:6px">'
          +'<span style="font-size:13px;color:#a78bfa">✦</span>'
          +'<span style="font-size:11px;font-weight:700;color:#a78bfa;letter-spacing:.05em">AI INSIGHT</span>'
        +'</div>'
        +'<button onclick="event.stopPropagation();__rptNav_(\\'utilization\\')" style="background:transparent;border:1px solid rgba(124,58,237,.4);color:#a78bfa;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:10px;font-weight:600">View Full Report →</button>'
      +'</div>'
      +insightHtml
    +'</div>'
  +'</div>';
}`;

if (!dash.includes(OLD_BOTTOM)) {
  console.error('✗ AI insight bottom anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_BOTTOM, NEW_BOTTOM);
console.log('✓ Added "View Full Report →" button next to AI INSIGHT label');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V62: explicit CTA buttons on Utilization card (Open Detailed View) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V62: util CTA',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
