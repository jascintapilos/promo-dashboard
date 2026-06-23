#!/usr/bin/env node
/**
 * V48 — Reports tabs: inline-style every tab to bypass CSS rule loading
 *
 * For some reason the .rpt-tab / .rpt-tabs CSS rules aren't being applied
 * to the live page even though they're present in the source. Switching the
 * tab elements to <div role="button"> (V47) didn't help either — the divs
 * render as plain text. CSS file syntax checks out, braces balanced.
 *
 * Bypass: render each tab + container with style="..." inline. Inline
 * styles ALWAYS win over (or coexist with) anything in the cascade and
 * there's no rule-matching to fail.
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

// ── Replace the tab-rendering block with INLINE-styled markup ───────────────
patch('Tabs — render with inline styles (bypass CSS class loading)',
  `  var tabsHtml = REPORT_MODULES.map(function(m){
    var active = m.id === mod;
    return '<div class="rpt-tab' + (active?' active':'') + '" role="button" tabindex="0" onclick="selectReportModule_(\\''+m.id+'\\')">' +
      '<div class="rpt-tab-icon">' + m.icon + '</div>' +
      '<div class="rpt-tab-text"><div class="rpt-tab-label">' + m.label + '</div><div class="rpt-tab-sub">' + m.sub + '</div></div>' +
      '</div>';
  }).join('');

  content(
    '<div class="rpt-tabs">' + tabsHtml + '</div>' +
    '<div id="rpt-module-body"><div class="loading"><div class="spinner"></div></div></div>'
  );`,
  `  var TAB_STYLE_BASE  = 'background:#1c2128;border:1px solid #30363d;border-radius:10px;padding:10px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;color:#e6edf3;font-size:11px;line-height:1.3;min-height:78px;justify-content:flex-start;transition:all .18s;box-sizing:border-box';
  var TAB_STYLE_ACTIVE= 'background:linear-gradient(135deg,rgba(124,58,237,.22),rgba(14,165,233,.08));border:1px solid #7c3aed;border-radius:10px;padding:10px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;color:#e6edf3;font-size:11px;line-height:1.3;min-height:78px;justify-content:flex-start;box-shadow:0 0 0 1px #7c3aed,0 6px 18px rgba(124,58,237,.25);transform:translateY(-1px);box-sizing:border-box';
  var tabsHtml = REPORT_MODULES.map(function(m){
    var active = m.id === mod;
    var s = active ? TAB_STYLE_ACTIVE : TAB_STYLE_BASE;
    var iconColor = active ? '#7c3aed' : '#e6edf3';
    var labelColor = active ? '#7c3aed' : '#e6edf3';
    return '<div role="button" tabindex="0" onclick="selectReportModule_(\\''+m.id+'\\')" style="' + s + '">' +
      '<div style="font-size:20px;line-height:1;margin-bottom:2px">' + m.icon + '</div>' +
      '<div style="flex:1;min-width:0;width:100%">' +
        '<div style="font-size:11px;font-weight:600;color:' + labelColor + ';margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + m.label + '</div>' +
        '<div style="font-size:9px;color:#8b949e;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + m.sub + '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  content(
    '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:18px">' + tabsHtml + '</div>' +
    '<div id="rpt-module-body"><div class="loading"><div class="spinner"></div></div></div>'
  );`);

// Bump badge
patch('Badge V47 → V48', `>V47 ✓</span>`, `>V48 ✓</span>`);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V48 — tabs use inline styles — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
