#!/usr/bin/env node
/**
 * V45 — Report module tabs: match dark dashboard theme
 *
 * The .rpt-tab buttons were falling through to the user-agent default
 * (light/buttonface background) because base `button{}` rule didn't set
 * background and our CSS rule's specificity tied with the default. Result:
 * tabs rendered as light cards on a dark background.
 *
 * Fix:
 *   - Force background-color via !important (browser UA stylesheet still wins on `button`)
 *   - Single-row layout (10 cols on wide, 5×2 on narrow) so tabs don't wrap
 *   - Tighten padding so labels fit
 *   - Stronger active state with gradient + glow
 *   - Bump badge V44 → V45
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

// Replace the old tab CSS block with theme-matched version
patch('Report tabs — force dark theme + responsive single-row layout',
  `.rpt-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px}
.rpt-tab{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;cursor:pointer;display:flex;align-items:flex-start;gap:10px;transition:all .15s;text-align:left;color:inherit}
.rpt-tab:hover{border-color:var(--accent);transform:translateY(-1px);background:var(--card2)}
.rpt-tab.active{border-color:var(--accent);background:linear-gradient(135deg,rgba(124,58,237,.15),rgba(124,58,237,.05));box-shadow:0 0 0 1px var(--accent)}
.rpt-tab-icon{font-size:22px;flex-shrink:0;line-height:1}
.rpt-tab-text{flex:1;min-width:0}
.rpt-tab-label{font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px}
.rpt-tab-sub{font-size:10px;color:var(--muted);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rpt-tab.active .rpt-tab-label{color:var(--accent)}`,
  `.rpt-tabs{display:grid;grid-template-columns:repeat(10,1fr);gap:6px;margin-bottom:18px}
.rpt-tab{background-color:var(--card)!important;border:1px solid var(--border)!important;border-radius:10px!important;padding:10px 8px!important;cursor:pointer;display:flex!important;flex-direction:column!important;align-items:center!important;gap:4px!important;transition:all .18s!important;text-align:center!important;color:var(--text)!important;font-family:inherit!important;font-size:11px!important;line-height:1.3!important;min-height:78px;justify-content:flex-start!important;outline:none!important}
.rpt-tab:hover{border-color:var(--accent)!important;transform:translateY(-1px);background-color:var(--card2)!important;box-shadow:0 4px 12px rgba(124,58,237,.15)}
.rpt-tab.active{border-color:var(--accent)!important;background:linear-gradient(135deg,rgba(124,58,237,.22),rgba(14,165,233,.08))!important;box-shadow:0 0 0 1px var(--accent),0 6px 18px rgba(124,58,237,.25)!important;transform:translateY(-1px)}
.rpt-tab-icon{font-size:20px;line-height:1;flex-shrink:0;margin-bottom:2px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))}
.rpt-tab-text{flex:1;min-width:0;width:100%}
.rpt-tab-label{font-size:11px;font-weight:600;color:var(--text);margin-bottom:1px;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rpt-tab-sub{font-size:9px;color:var(--muted);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%}
.rpt-tab.active .rpt-tab-label{color:var(--accent)}
.rpt-tab.active .rpt-tab-icon{filter:drop-shadow(0 0 6px rgba(124,58,237,.6))}
@media (max-width:1400px){.rpt-tabs{grid-template-columns:repeat(5,1fr)}}
@media (max-width:900px){.rpt-tabs{grid-template-columns:repeat(3,1fr)}}`);

// Bump badge V44 → V45
patch('Badge V44 → V45', `>V44 ✓</span>`, `>V45 ✓</span>`);

// Push
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V45 — report tabs dark theme match — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('Deploy V' + v.versionNumber + ' → Manage deployments → pick Version ' + v.versionNumber);
