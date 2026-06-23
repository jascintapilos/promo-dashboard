#!/usr/bin/env node
/**
 * Two fixes:
 * 1. serverGetSOPs rewritten to use Sheets REST API via UrlFetchApp.
 *    Apps Script's getRichTextValues().getLinkUrl() only sees old-style
 *    hyperlinks, not modern "rich link" chips that Drive uses. The REST API
 *    can read both via the chipRuns + textFormatRuns + hyperlink fields.
 * 2. Owner display: fuzzy-match email aliases (alysa@, wen@) and
 *    compound owners ("elyssa+wen") to Directory short Slack names.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';
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
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let code = proj.files[codeIdx].source;
let dash = proj.files[dashIdx].source;

// ─── Replace serverGetSOPs in Code.gs ───────────────────────────────────────
const newServerGetSOPs = `function serverGetSOPs() {
  // Use Sheets REST API to access rich-link chip URLs (Drive auto-inserted links).
  // Apps Script's getRichTextValues() misses these — only the REST 'chipRuns'
  // field selector exposes them.
  function fetchSheet_(tabName) {
    var token = ScriptApp.getOAuthToken();
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + DIR_SS_ID +
      '?ranges=' + encodeURIComponent(tabName + '!A1:E200') +
      '&fields=' + encodeURIComponent('sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns(format.link.uri,startIndex),userEnteredFormat.textFormat.link.uri,chipRuns(chip.richLinkProperties.uri))');
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    var data = JSON.parse(res.getContentText());
    return data && data.sheets && data.sheets[0] && data.sheets[0].data && data.sheets[0].data[0]
      ? (data.sheets[0].data[0].rowData || [])
      : [];
  }

  function getLink_(cell) {
    if (!cell) return '';
    if (cell.hyperlink) return cell.hyperlink;
    if (cell.userEnteredFormat && cell.userEnteredFormat.textFormat && cell.userEnteredFormat.textFormat.link && cell.userEnteredFormat.textFormat.link.uri)
      return cell.userEnteredFormat.textFormat.link.uri;
    if (cell.textFormatRuns && cell.textFormatRuns.length) {
      for (var i = 0; i < cell.textFormatRuns.length; i++) {
        var r = cell.textFormatRuns[i];
        if (r.format && r.format.link && r.format.link.uri) return r.format.link.uri;
      }
    }
    if (cell.chipRuns && cell.chipRuns.length) {
      for (var j = 0; j < cell.chipRuns.length; j++) {
        var cr = cell.chipRuns[j];
        if (cr.chip && cr.chip.richLinkProperties && cr.chip.richLinkProperties.uri) return cr.chip.richLinkProperties.uri;
      }
    }
    return '';
  }

  try {
    var out = { sops: [], library: [] };

    // ── SOP tab ──
    var sopRows = fetchSheet_('SOP');
    if (sopRows.length > 1) {
      var sopHeaders = (sopRows[0].values || []).map(function(c){ return String(c && c.formattedValue || '').trim(); });
      var iCat = sopHeaders.indexOf('Category');
      var iTitle = sopHeaders.findIndex(function(h){ return /title/i.test(h); });
      var iWF    = sopHeaders.findIndex(function(h){ return /working/i.test(h); });
      var iTpl   = sopHeaders.findIndex(function(h){ return /template/i.test(h); });
      var lastCat = '';
      for (var r = 1; r < sopRows.length; r++) {
        var cells = sopRows[r].values || [];
        var cat = String((iCat>=0 && cells[iCat]) ? cells[iCat].formattedValue || '' : '').trim() || lastCat;
        if (cat) lastCat = cat;
        if (iTitle >= 0 && cells[iTitle] && cells[iTitle].formattedValue) {
          out.sops.push({ category: cat || 'General', kind: 'SOP', title: cells[iTitle].formattedValue.trim(), link: getLink_(cells[iTitle]) });
        }
        if (iWF >= 0 && cells[iWF] && cells[iWF].formattedValue) {
          out.sops.push({ category: cat || 'General', kind: 'Working File', title: cells[iWF].formattedValue.trim(), link: getLink_(cells[iWF]) });
        }
        if (iTpl >= 0 && cells[iTpl] && cells[iTpl].formattedValue) {
          out.sops.push({ category: cat || 'General', kind: 'Template', title: cells[iTpl].formattedValue.trim(), link: getLink_(cells[iTpl]) });
        }
      }
    }

    // ── Knowledge Library tab ──
    var klRows = fetchSheet_('Knowledge Library');
    if (klRows.length > 1) {
      var klHeaders = (klRows[0].values || []).map(function(c){ return String(c && c.formattedValue || '').trim(); });
      var iDoc  = klHeaders.findIndex(function(h){ return /document/i.test(h); });
      var iCat2 = klHeaders.indexOf('Category');
      var iItem = klHeaders.findIndex(function(h){ return /^item/i.test(h); });
      for (var r2 = 1; r2 < klRows.length; r2++) {
        var cells2 = klRows[r2].values || [];
        var item = iItem >= 0 && cells2[iItem] ? String(cells2[iItem].formattedValue || '').trim() : '';
        if (!item) continue;
        out.library.push({
          docNo:    iDoc  >= 0 && cells2[iDoc]  ? String(cells2[iDoc].formattedValue || '').trim() : '',
          category: iCat2 >= 0 && cells2[iCat2] ? String(cells2[iCat2].formattedValue || '').trim() : 'General',
          title: item,
          link: getLink_(cells2[iItem]),
        });
      }
    }

    return out;
  } catch (e) {
    Logger.log('serverGetSOPs error: ' + e.message);
    return { sops: [], library: [] };
  }
}`;

// Replace the existing serverGetSOPs function — anchor: from 'function serverGetSOPs()' to its closing brace
const oldStart = code.indexOf('function serverGetSOPs()');
if (oldStart >= 0) {
  // find the matching closing brace by depth
  var depth = 0, end = -1, inFn = false;
  for (var i = oldStart; i < code.length; i++) {
    if (code[i] === '{') { depth++; inFn = true; }
    else if (code[i] === '}') { depth--; if (inFn && depth === 0) { end = i + 1; break; } }
  }
  if (end > 0) {
    code = code.slice(0, oldStart) + newServerGetSOPs + code.slice(end);
    console.log('✓ Code.gs: serverGetSOPs rewritten to use Sheets REST API for rich-link chips');
  }
}

// ─── Update dashboard Owner display to handle aliases + compound owners ─────
const oldOwnerLogic = `    var ownerRaw = String(t.Owner || '');
    // Map email to short Slack name if roster loaded
    var ownerDisplay = ownerRaw;
    if (ownerRaw.indexOf('@') > 0 && S.roster && S.roster.length) {
      var match = S.roster.find(function(r){ return String(r.email || '').toLowerCase() === ownerRaw.toLowerCase(); });
      if (match) ownerDisplay = match.name;
    }`;

const newOwnerLogic = `    var ownerRaw = String(t.Owner || '');
    var ownerDisplay = resolveOwnerNames_(ownerRaw);`;

if (dash.includes(oldOwnerLogic)) {
  dash = dash.replace(oldOwnerLogic, newOwnerLogic);
  console.log('✓ Dashboard: simplified Owner cell to call resolver');
}

// Add the resolver function before renderTasksData
const resolverFn = `function resolveOwnerNames_(raw) {
  if (!raw) return '';
  raw = String(raw).trim();
  if (!S.roster || !S.roster.length) return raw;
  // Compound owners: split on +, /, comma, &, "and"
  var parts = raw.split(/\\s*(?:\\+|\\/|,|&| and )\\s*/i).filter(Boolean);
  var resolved = parts.map(function(p){
    p = p.trim();
    if (!p) return '';
    // Try exact email match first
    var byEmail = S.roster.find(function(r){ return String(r.email || '').toLowerCase() === p.toLowerCase(); });
    if (byEmail) return byEmail.name;
    // Try local-part match (e.g. "alysa@xxx" or "wen@xxx" or just "alysa")
    var localPart = p.indexOf('@') > 0 ? p.split('@')[0] : p;
    localPart = localPart.toLowerCase();
    // Strip dots / underscores for fuzzy compare (e.g. "menhua.foong" → "menhua foong")
    var byName = S.roster.find(function(r){
      var name = String(r.name || '').toLowerCase();
      if (name === localPart) return true;
      // Also match if Slack short name appears as a token in the local part (e.g. "elyssa.mae" contains "elyssa")
      if (localPart.indexOf(name) === 0) return true;
      return false;
    });
    if (byName) return byName.name;
    // Last resort: if email, show local part; else show as-is
    return p.indexOf('@') > 0 ? p.split('@')[0] : p;
  }).filter(Boolean);
  return resolved.join(' + ');
}

var __taskSort = { col: 'Submitted_At', dir: 'desc' };
function renderTasksData`;

const oldSortLine = `var __taskSort = { col: 'Submitted_At', dir: 'desc' };
function renderTasksData`;

if (dash.includes(oldSortLine) && !dash.includes('function resolveOwnerNames_')) {
  dash = dash.replace(oldSortLine, resolverFn);
  console.log('✓ Dashboard: added resolveOwnerNames_ with alias + compound support');
}

proj.files[codeIdx].source = code;
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V36 + SOP links via REST + Owner alias resolver ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'SOP links + Owner alias' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
