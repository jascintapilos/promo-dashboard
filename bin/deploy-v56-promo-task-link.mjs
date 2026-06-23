#!/usr/bin/env node
/**
 * V56 — Promo submit creates a linked task; title hyperlinks to the row
 *
 *  When a request is submitted from the dashboard, the bot already writes to
 *  (A) the local Promo_Requests tab and (B) the operator's Promo Code Request
 *  spreadsheet. V56 adds (C): a Task_Master row pointing at the same
 *  operator-sheet row via a deep-link URL.
 *
 *  Effects:
 *    - The "Promo Tasks" widget on the Promo Codes page picks up the new task
 *      automatically (filter is Module='Promo Codes').
 *    - The task Title is hyperlinked (V41's `t.Source_Link` rendering) — one
 *      click opens that exact row in the operator's sheet.
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

// ─── Server-side: write a Task_Master row pointing at the source-sheet row ─
patch('serverSubmitPromoCodeRequest — also create linked Task_Master row',
  'code',
  `        tab.appendRow(out);
        sourceRow = tab.getName() + '!row' + (lr + 1);
        // Write source-row back to local record
        const headersLocal = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
        const srcColIdx = headersLocal.indexOf('Source_Sheet_Row');
        if (srcColIdx >= 0) sheet.getRange(localRow, srcColIdx + 1).setValue(sourceRow);
      }
    } catch (sourceErr) {
      Logger.log('serverSubmitPromoCodeRequest source-sheet error: ' + sourceErr.message);
    }

    return { success: true, requestId: id, sourceRow: sourceRow };`,
  `        const newRowNum = lr + 1;
        tab.appendRow(out);
        sourceRow = tab.getName() + '!row' + newRowNum;
        // Build deep-link URL straight to the row
        const tabGid = tab.getSheetId();
        const sourceLink = 'https://docs.google.com/spreadsheets/d/' + PROMO_REQ_SS_ID +
                           '/edit#gid=' + tabGid + '&range=A' + newRowNum + ':AZ' + newRowNum;
        // Write source-row + link back to local record
        const headersLocal = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
        const srcColIdx = headersLocal.indexOf('Source_Sheet_Row');
        if (srcColIdx >= 0) sheet.getRange(localRow, srcColIdx + 1).setValue(sourceRow);

        // ── (C) Create a Task_Master row so the Promo Tasks widget picks it up ──
        try {
          let taskSheet = ss.getSheetByName('Task_Master');
          if (!taskSheet) {
            taskSheet = ss.insertSheet('Task_Master');
            taskSheet.appendRow(['Task_ID','Title','Module','Brand','Owner','Due_Date','Priority','Status','Progress','Description','Created_At','Updated_At','Submitted_At','Source_Link']);
          }
          const taskHeaders = taskSheet.getRange(1, 1, 1, taskSheet.getLastColumn()).getValues()[0].map(String);
          // Ensure Source_Link + Submitted_At columns exist (older sheets may lack them)
          function ensureCol(name) {
            if (taskHeaders.indexOf(name) < 0) {
              const newCol = taskHeaders.length + 1;
              taskSheet.getRange(1, newCol).setValue(name);
              taskHeaders.push(name);
            }
          }
          ensureCol('Source_Link');
          ensureCol('Submitted_At');

          const taskRow = taskHeaders.map(h => {
            if (h === 'Task_ID')      return id;
            if (h === 'Title')        return autoNameDetails || ('Promo Request ' + id);
            if (h === 'Module')       return 'Promo Codes';
            if (h === 'Brand')        return form.brand || '';
            if (h === 'Owner')        return form.requestor || form.email || '';
            if (h === 'Due_Date')     return form.deadline || '';
            if (h === 'Priority')     return form.priority || 'Normal';
            if (h === 'Status')       return 'New';
            if (h === 'Progress')     return 0;
            if (h === 'Description')  return form.description || '';
            if (h === 'Created_At')   return nowISO;
            if (h === 'Updated_At')   return nowISO;
            if (h === 'Submitted_At') return nowISO;
            if (h === 'Source_Link')  return sourceLink;
            return '';
          });
          taskSheet.appendRow(taskRow);
        } catch (taskErr) {
          Logger.log('serverSubmitPromoCodeRequest task-row error: ' + taskErr.message);
        }
      }
    } catch (sourceErr) {
      Logger.log('serverSubmitPromoCodeRequest source-sheet error: ' + sourceErr.message);
    }

    return { success: true, requestId: id, sourceRow: sourceRow };`);

// Badge bump
patch('Badge V55 → V56', 'dash', `>V55 ✓</span>`, `>V56 ✓</span>`);
// Fallback if V55 didn't make the live badge yet
if (dash.includes(`>V54 ✓</span>`)) {
  dash = dash.replace(`>V54 ✓</span>`, `>V56 ✓</span>`);
  console.log('  (also bumped V54 → V56 fallback)');
}

proj.files[dashIdx].source = dash;
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Pushed — ' + pass + ' patches applied, ' + fail + ' warnings');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V56 — submit creates linked task w/ hyperlinked title — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
