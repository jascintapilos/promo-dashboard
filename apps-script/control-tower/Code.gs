/**
 * PROMO CONTROL TOWER 2026
 * Standalone Apps Script — Jascinta / The Branding People
 * Script ID: 1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_
 * Data: PromoOps_Control_Layer (16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk)
 */

const SS_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const BUSINESS_TIME_ZONE = 'Asia/Kuala_Lumpur';

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Promo Control Tower 2026')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

function serverGetCurrentUser() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  const role  = resolveRole_(email);
  const display = email
    ? toTitleCase_(email.split('@')[0].replace(/[._]/g, ' '))
    : 'Guest';
  return { email, role, display };
}

function resolveRole_(email) {
  if (!email) return 'guest';
  try {
    const sheet = openSS_().getSheetByName('Users');
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).toLowerCase().trim() === email) {
          const r = String(data[i][1]).toLowerCase().trim();
          return r || 'member';
        }
      }
    }
  } catch (e) {}
  if (email.endsWith('@thebrandingpeople.co')) return 'member';
  return 'guest';
}

// ─────────────────────────────────────────────────────────────────────────────
// KPIs + OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

function serverGetKPIs() {
  try {
    const snapshot = getTaskSnapshot_();
    const tasks = snapshot.tasks;
    const counts = {};
    const byMonth = {};
    const byBrand = {};
    tasks.forEach(t => {
      const s = t.Status;
      counts[s] = (counts[s] || 0) + 1;
      const b = t.Brand || t.Platform || '-';
      byBrand[b] = (byBrand[b] || 0) + 1;
      // Month bucket for trend from a verified canonical timestamp/date.
      const raw = t.Submitted_At || t.Assigned_At || t.Status_Updated_At || t.Due_Date || '';
      if (raw) {
        const d = new Date(raw);
        if (!isNaN(d)) {
          const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
          if (!byMonth[key]) byMonth[key] = { completed: 0, inProgress: 0, atRisk: 0 };
          if (s === 'Completed')   byMonth[key].completed++;
          else if (s === 'In Progress') byMonth[key].inProgress++;
          else if (s === 'At Risk')     byMonth[key].atRisk++;
        }
      }
    });
    const recentTasks = tasks.slice().sort((a, b) =>
      String(b._Activity_At || '').localeCompare(String(a._Activity_At || ''))
    ).slice(0, 8);
    const today = Utilities.formatDate(new Date(), BUSINESS_TIME_ZONE, 'yyyy-MM-dd');
    const upcomingTasks = tasks.filter(t =>
      t.Due_Date && t.Due_Date >= today && !['Completed','Cancelled'].includes(t.Status)
    ).sort((a, b) => String(a.Due_Date).localeCompare(String(b.Due_Date))).slice(0, 5);
    return {
      ok:             true,
      total:          tasks.length,
      completed:      counts['Completed']  || 0,
      inProgress:     counts['In Progress'] || 0,
      pendingApproval:counts['Pending Approval'] || 0,
      atRisk:         counts['At Risk'] || 0,
      counts,
      byBrand,
      byMonth,
      recentTasks,
      upcomingTasks,
      dataHealth: snapshot.health
    };
  } catch (e) {
    return { ok:false, error:'Task data unavailable: ' + String(e && e.message || e) };
  }
}

function normaliseStatus_(raw) {
  const s = String(raw || '').trim();
  const key = s.toLowerCase().replace(/[\s-]+/g, '_');
  if (!key || key === 'new') return 'New';
  if (['completed','complete','done'].includes(key)) return 'Completed';
  if (['in_progress','progress','building','wip','validating','ready_to_execute','executing','qc_required'].includes(key)) return 'In Progress';
  if (['pending_approval','waiting_approval','approval_required'].includes(key)) return 'Pending Approval';
  if (['at_risk','failed','failed_escalated','delayed'].includes(key)) return 'At Risk';
  if (['need_clarification','needs_clarification'].includes(key)) return 'Needs Clarification';
  if (key === 'on_hold') return 'On Hold';
  if (key === 'cancelled' || key === 'canceled') return 'Cancelled';
  return 'Unmapped';
}

function normalisePriority_(raw) {
  const key = String(raw || '').trim().toLowerCase();
  if (key === 'p1' || key === 'urgent' || key === 'critical') return 'Urgent';
  if (key === 'p2' || key === 'high') return 'High';
  if (key === 'p3' || key === 'medium' || key === 'normal' || key === 'standard') return 'Normal';
  if (key === 'p4' || key === 'low') return 'Low';
  return key ? 'Unmapped' : 'Unspecified';
}

// ─────────────────────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────────────────────

function serverGetTasks() {
  try {
    const snapshot = getTaskSnapshot_();
    return { ok:true, tasks:snapshot.tasks, dataHealth:snapshot.health };
  } catch (e) {
    return { ok:false, error:'Task data unavailable: ' + String(e && e.message || e), tasks:[] };
  }
}

function serverCreateTask(task) {
  try {
    const ss = openSS_();
    let sheet = ss.getSheetByName('Task_Master');
    if (!sheet) {
      sheet = ss.insertSheet('Task_Master');
      sheet.appendRow(['Task_ID','Title','Module','Brand','Owner','Due_Date','Priority','Status','Progress','Description','Created_At','Updated_At']);
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const now = malaysiaNowIso_();
    const id  = 'T-' + Date.now();
    const row = headers.map(h => {
      if (h === 'Task_ID')    return id;
      if (h === 'Created_At') return now;
      if (h === 'Updated_At') return now;
      if (h === 'Submitted_At') return now;
      if (h === 'Status_Updated_At') return now;
      if (h === 'Assigned_At' && task.Owner) return now;
      if (h === 'Notes' && task.Description && !task.Notes) return task.Description;
      if (h === 'Status' && !task[h]) return 'New';
      if (h === 'Progress' && !task[h]) return 0;
      return task[h] !== undefined ? task[h] : '';
    });
    sheet.appendRow(row);
    return { success: true, id };
  } catch (e) { return { success: false, error: e.message }; }
}

function serverUpdateTask(taskId, updates) {
  try {
    const ss = openSS_();
    const sheet = ss.getSheetByName('Task_Master');
    if (!sheet) return { success: false, error: 'No Task_Master sheet' };
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(String);
    const idIdx = headers.indexOf('Task_ID');
    if (idIdx < 0) return { success: false, error: 'No Task_ID column' };
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]) === String(taskId)) {
        const now = malaysiaNowIso_();
        updates.Updated_At = now;
        updates.Status_Updated_At = now;
        if (updates.Description !== undefined && headers.indexOf('Description') < 0 && headers.indexOf('Notes') >= 0) {
          updates.Notes = updates.Description;
        }
        Object.entries(updates).forEach(([k, v]) => {
          const col = headers.indexOf(k);
          if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(v);
        });
        return { success: true };
      }
    }
    return { success: false, error: 'Task not found' };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// GUEST REQUESTS + BOT
// ─────────────────────────────────────────────────────────────────────────────

function serverSubmitGuestRequest(form) {
  try {
    const ss = openSS_();
    let sheet = ss.getSheetByName('Guest_Requests');
    if (!sheet) {
      sheet = ss.insertSheet('Guest_Requests');
      sheet.appendRow(['Ticket_ID','Timestamp','Name','Team','Email','Type','Brand','Priority','Description','Status']);
    }
    const ticketId = 'GR-' + Date.now();
    sheet.appendRow([
      ticketId,
      new Date().toISOString(),
      form.name || '',
      form.team || '',
      form.email || '',
      form.type || '',
      form.brand || '',
      form.priority || 'Normal',
      form.description || '',
      'New'
    ]);
    return { success: true, ticketId };
  } catch (e) { return { success: false, error: e.message }; }
}

function serverTrackTicket(ticketId) {
  try {
    const sheet = openSS_().getSheetByName('Guest_Requests');
    if (!sheet || sheet.getLastRow() < 2) return null;
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(String);
    const tidIdx = headers.indexOf('Ticket_ID');
    if (tidIdx < 0) return null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][tidIdx]).trim() === String(ticketId).trim()) {
        const obj = {};
        headers.forEach((h, j) => { obj[h] = data[i][j]; });
        return obj;
      }
    }
    return null;
  } catch (e) { return null; }
}

function serverGetBotAnswer(topic) {
  const kb = getBotKB_();
  return kb[topic] || null;
}

function getBotKB_() {
  return {
    sop_promo: {
      title: 'How to Submit a Promo Request',
      steps: [
        'Fill in the request form: Promo name, brand, region, bonus type, amounts, validity dates.',
        'Attach any creative assets (banners 1920×400px for QPRO homepage).',
        'Select priority: Normal (3 days SLA) · High (1 day) · Urgent (same day — team lead approval needed).',
        'Submit — you will receive a Ticket ID (GR-XXXXXX) to track status.',
        'Promo team validates within 24 hours and may reach out for clarification.'
      ]
    },
    sop_banner: {
      title: 'How to Request a Banner',
      steps: [
        'Provide: Brand, placement (homepage / promo page), linked promotion code.',
        'Supply artwork OR request design from creative team (add 2 extra business days).',
        'QPRO homepage: 1920×400 px · QPRO promo page: 790×400 px.',
        'WS1/WS2: 1280×320 px (homepage) · 1000×565 px (promo page).',
        'Banners must be uploaded AFTER the linked promo code is live in BO.'
      ]
    },
    brands: {
      title: 'Brand & Platform Reference',
      content: 'QPRO1–19 → QPRO platform (best-in-asia.com BO) | QP2A/B/C/D → QP2 platform | WS1 brands (MB8, etc.) → WS1 BO | WS2 brands (RWS77) → WS2 BO. Wallet families: WS1/WS2, QPRO1–19, QP2A–D, NX/UG.'
    },
    deadlines: {
      title: 'SLA & Cut-off Times',
      items: [
        'Normal requests: 3 business days from submission',
        'High priority: 1 business day',
        'Urgent (approved): Same-day if submitted before 12pm MYT',
        'Weekly cut-off for BO uploads: Friday 5pm MYT',
        'Banner changes: submit by Thursday 3pm for that week\'s go-live'
      ]
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// USERS (Admin)
// ─────────────────────────────────────────────────────────────────────────────

function serverGetUsers() {
  try {
    const sheet = openSS_().getSheetByName('Users');
    if (!sheet) return [];
    return readSheetObjects_(sheet);
  } catch (e) { return []; }
}

function serverSaveUser(email, role, name) {
  try {
    const ss = openSS_();
    let sheet = ss.getSheetByName('Users');
    if (!sheet) {
      sheet = ss.insertSheet('Users');
      sheet.appendRow(['Email', 'Role', 'Name', 'Added_At']);
    }
    // Check if exists
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(String);
    const eIdx = headers.indexOf('Email');
    const rIdx = headers.indexOf('Role');
    const nIdx = headers.indexOf('Name');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][eIdx]).toLowerCase().trim() === email.toLowerCase().trim()) {
        if (rIdx >= 0) sheet.getRange(i + 1, rIdx + 1).setValue(role);
        if (nIdx >= 0) sheet.getRange(i + 1, nIdx + 1).setValue(name || '');
        return { success: true, action: 'updated' };
      }
    }
    sheet.appendRow([email, role, name || '', new Date().toISOString()]);
    return { success: true, action: 'added' };
  } catch (e) { return { success: false, error: e.message }; }
}

function serverRemoveUser(email) {
  try {
    const sheet = openSS_().getSheetByName('Users');
    if (!sheet) return { success: false };
    const data = sheet.getDataRange().getValues();
    const eIdx = data[0].map(String).indexOf('Email');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][eIdx]).toLowerCase().trim() === email.toLowerCase().trim()) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'User not found' };
  } catch (e) { return { success: false, error: e.message }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// BANNERS (Banner Schedule sheet)
// ─────────────────────────────────────────────────────────────────────────────

const BANNER_SS_ID = '1vpyjhqiKzcn2XHovcN2tEa4UkzUMqTmFsUZ59m-n8_E';

function serverGetBanners() {
  try {
    const ss = SpreadsheetApp.openById(BANNER_SS_ID);
    const sheets = ss.getSheets();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = monthNames[new Date().getMonth()];
    let sheet = sheets.find(s => s.getName().toLowerCase().includes(mon.toLowerCase()))
                || sheets.find(s => s.getName().includes('2026'))
                || sheets[0];
    if (!sheet || sheet.getLastRow() < 2) return [];
    const lr  = Math.min(sheet.getLastRow(), 300);
    const data = sheet.getRange(1, 1, lr, 16).getValues();
    const COLS = ['no','b_id','campaign','draft_folder','status','regions','requestor',
                  'promo_type','brand','placement','start_date','end_date',
                  'submitted_at','requested_by','ready_by','notes'];
    const rows = [];
    for (let i = 1; i < data.length; i++) {
      const bid = String(data[i][1] || '').trim();
      if (!bid || !/^B\d+$/i.test(bid)) continue;
      const obj = {};
      COLS.forEach((h, j) => {
        obj[h] = data[i][j] instanceof Date ? data[i][j].toISOString() : data[i][j];
      });
      rows.push(obj);
    }
    return rows;
  } catch (e) { return { error: e.message }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMO CODE REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

function serverSubmitPromoCodeRequest(form) {
  try {
    const ss = openSS_();
    let sheet = ss.getSheetByName('Promo_Requests');
    if (!sheet) {
      sheet = ss.insertSheet('Promo_Requests');
      sheet.appendRow(['Request_ID','Timestamp','Requestor_Email','Brand','Platform',
                       'Bonus_Type','Amount','Min_Deposit','Turnover',
                       'Start_Date','End_Date','Priority','Description','Status']);
    }
    const id = 'PR-' + Date.now();
    sheet.appendRow([
      id, new Date().toISOString(),
      form.email||'', form.brand||'', form.platform||'',
      form.bonusType||'', form.amount||'', form.minDeposit||'',
      form.turnover||'', form.startDate||'', form.endDate||'',
      form.priority||'Normal', form.description||'', 'Pending'
    ]);
    return { success: true, requestId: id };
  } catch (e) { return { success: false, error: e.message }; }
}

function serverGetPromoRequests() {
  try {
    const sheet = openSS_().getSheetByName('Promo_Requests');
    if (!sheet) return [];
    return readSheetObjects_(sheet);
  } catch (e) { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────────────────────────────────────

function serverGetReportData() {
  try {
    const tasks = getAllTasks_();
    const getRows_ = name => {
      try { const s = openSS_().getSheetByName(name); return s ? readSheetObjects_(s) : []; }
      catch(_) { return []; }
    };
    const guestReqs = getRows_('Guest_Requests');
    const promoReqs = getRows_('Promo_Requests');

    const byStatus = {}, byModule = {}, byPriority = {};
    tasks.forEach(t => {
      const s = normaliseStatus_(t.Status);
      byStatus[s]   = (byStatus[s]   || 0) + 1;
      byModule[t.Module  || 'Other']   = (byModule[t.Module  || 'Other']   || 0) + 1;
      byPriority[t.Priority || 'Normal'] = (byPriority[t.Priority || 'Normal'] || 0) + 1;
    });

    const guestByType = {}, guestByStatus = {};
    guestReqs.forEach(r => {
      guestByType[r.Type||'Other']   = (guestByType[r.Type||'Other']   || 0) + 1;
      guestByStatus[r.Status||'New'] = (guestByStatus[r.Status||'New'] || 0) + 1;
    });

    const promoByStatus = {}, promoByBrand = {};
    promoReqs.forEach(r => {
      promoByStatus[r.Status||'Pending'] = (promoByStatus[r.Status||'Pending'] || 0) + 1;
      promoByBrand[r.Brand||'Other']     = (promoByBrand[r.Brand||'Other']     || 0) + 1;
    });

    return {
      tasks:         { total: tasks.length,     byStatus, byModule, byPriority },
      guestRequests: { total: guestReqs.length, byType: guestByType, byStatus: guestByStatus },
      promoRequests: { total: promoReqs.length, byStatus: promoByStatus, byBrand: promoByBrand,
                       recent: promoReqs.slice(-10).reverse() }
    };
  } catch (e) { return { error: e.message }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// BO LIVE STATUS  (populated by bin/sync-bo-status.mjs)
// ─────────────────────────────────────────────────────────────────────────────

function serverGetBOStatus() {
  try {
    const sheet = openSS_().getSheetByName('BO_Status');
    if (!sheet || sheet.getLastRow() < 2) {
      return { ok: false, error: 'BO_Status tab not found or empty — run: node bin/sync-bo-status.mjs' };
    }
    const rows = readSheetObjects_(sheet);
    // First data row carries the sync timestamp (all rows share the same run)
    const syncedAt = rows.length > 0 ? String(rows[0].last_sync || '') : '';
    return { ok: true, rows: rows, synced_at: syncedAt };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

const PROMO_REQ_SS_ID = '1dqvCM9SoPLJ2iYNCQRe450wBk3S7HSHtbayuAJguodM';
const NOTIFY_EMAILS   = ['jascintapilos@thebrandingpeople.co', 'waiyip@thebrandingpeople.co'];

function serverGetNotifications() {
  try {
    const email = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
    const sheet = openSS_().getSheetByName('Notifications');
    if (!sheet || sheet.getLastRow() < 2) return { unread: 0, items: [] };
    const rows = readSheetObjects_(sheet);
    const unread = [], all = [];
    rows.slice().reverse().forEach(r => {  // newest first
      const readBy = String(r.Read_By || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      const isRead = readBy.includes(email);
      const item   = { ...r, is_read: isRead };
      all.push(item);
      if (!isRead) unread.push(item);
    });
    return { unread: unread.length, items: all.slice(0, 30) };
  } catch (e) {
    return { unread: 0, items: [], error: e.message };
  }
}

function serverMarkNotificationsRead(ids) {
  try {
    const email = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
    if (!email || !ids || !ids.length) return { success: false };
    const sheet = openSS_().getSheetByName('Notifications');
    if (!sheet || sheet.getLastRow() < 2) return { success: false };
    const data    = sheet.getDataRange().getValues();
    const headers = data[0].map(String);
    const idIdx     = headers.indexOf('Notif_ID');
    const readByIdx = headers.indexOf('Read_By');
    if (idIdx < 0 || readByIdx < 0) return { success: false };
    const idSet = new Set(ids.map(String));
    for (let i = 1; i < data.length; i++) {
      if (!idSet.has(String(data[i][idIdx]))) continue;
      const existing = String(data[i][readByIdx] || '');
      const readBy   = existing ? existing.split(',').map(s => s.trim()) : [];
      if (!readBy.includes(email)) {
        readBy.push(email);
        sheet.getRange(i + 1, readByIdx + 1).setValue(readBy.join(','));
      }
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

function serverQuickUpdateTask(taskId, status) {
  return serverUpdateTask(taskId, { Status: status });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMO REQUEST WATCHER  (installable time trigger — every 15 min)
// Run installPromoWatcher() once from the Apps Script editor to activate.
// ─────────────────────────────────────────────────────────────────────────────

function promoRequestWatcher_() {
  try {
    // 1. Open promo request sheet — find current-month tab
    const reqSS = SpreadsheetApp.openById(PROMO_REQ_SS_ID);
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const now  = new Date();
    const mon  = monthNames[now.getMonth()];
    const year = String(now.getFullYear());
    const yr2  = year.slice(2);  // "26"
    const allTabs = reqSS.getSheets();
    const tab = allTabs.find(s => {
      const n = s.getName();
      return n.includes(mon) && (n.includes(year) || n.includes(yr2));
    }) || allTabs.find(s => s.getName().toLowerCase().includes(mon.toLowerCase()))
      || allTabs[0];
    if (!tab) { Logger.log('Watcher: no tab found'); return; }

    // 2. Current data row count (exclude header)
    const lr = tab.getLastRow();
    const currentCount = lr < 2 ? 0 : lr - 1;

    // 3. Read watermark from Watcher_Meta tab
    const ss = openSS_();
    let metaSheet = ss.getSheetByName('Watcher_Meta');
    if (!metaSheet) {
      metaSheet = ss.insertSheet('Watcher_Meta');
      metaSheet.appendRow(['Key', 'Value', 'Updated_At']);
    }
    const metaData    = metaSheet.getDataRange().getValues();
    const metaHeaders = metaData[0].map(String);
    const kIdx = metaHeaders.indexOf('Key');
    const vIdx = metaHeaders.indexOf('Value');
    const atIdx = metaHeaders.indexOf('Updated_At');
    const WKEY = 'promo_req_' + tab.getName().replace(/\s+/g, '_');
    let wmRow = -1, wmVal = 0;
    for (let i = 1; i < metaData.length; i++) {
      if (String(metaData[i][kIdx]) === WKEY) { wmRow = i + 1; wmVal = parseInt(metaData[i][vIdx]) || 0; break; }
    }

    // 4. No new rows — update timestamp and exit
    if (currentCount <= wmVal) {
      if (wmRow > 0) metaSheet.getRange(wmRow, atIdx + 1).setValue(now.toISOString());
      else metaSheet.appendRow([WKEY, currentCount, now.toISOString()]);
      return;
    }

    // 5. Read new rows (after old watermark)
    const lc = Math.min(tab.getLastColumn(), 30);
    const allData = tab.getRange(1, 1, lr, lc).getValues();
    const colHeaders = allData[0].map(String);

    // Heuristic column detection
    const pIdx   = colHeaders.findIndex(h => /^no\.?$|^#$|^p#|req.*no|request.*no/i.test(h.trim()));
    const nameIdx = colHeaders.findIndex(h => /promo.?name|name|title|column.?m|internal/i.test(h));
    const brandIdx = colHeaders.findIndex(h => /brand|site|merchant/i.test(h));
    const typeIdx  = colHeaders.findIndex(h => /bonus.?type|type/i.test(h));

    const newRows = allData.slice(wmVal + 1); // rows after old watermark (header is row 0)
    const newItems = newRows.filter(r => r.some(v => v !== '' && v !== null));
    if (!newItems.length) {
      if (wmRow > 0) { metaSheet.getRange(wmRow, vIdx + 1).setValue(currentCount); metaSheet.getRange(wmRow, atIdx + 1).setValue(now.toISOString()); }
      else metaSheet.appendRow([WKEY, currentCount, now.toISOString()]);
      return;
    }

    // 6. Ensure Notifications + Task_Master tabs
    let notifSheet = ss.getSheetByName('Notifications');
    if (!notifSheet) {
      notifSheet = ss.insertSheet('Notifications');
      notifSheet.appendRow(['Notif_ID','Type','Source_ID','Title','Detail','Created_At','Read_By','Email_Sent']);
    }
    let taskSheet = ss.getSheetByName('Task_Master');
    if (!taskSheet) {
      taskSheet = ss.insertSheet('Task_Master');
      taskSheet.appendRow(['Task_ID','Title','Module','Brand','Owner','Due_Date','Priority','Status','Progress','Description','Created_At','Updated_At']);
    }
    const taskColHeaders = taskSheet.getRange(1, 1, 1, taskSheet.getLastColumn()).getValues()[0].map(String);

    // 7. Create notification + task per new row
    const nowISO = now.toISOString();
    const created = [];
    newItems.slice(0, 20).forEach((row, i) => {
      const pRaw   = pIdx   >= 0 ? String(row[pIdx]   || '').trim() : '';
      const pName  = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '';
      const pBrand = brandIdx >= 0 ? String(row[brandIdx] || '').trim() : '';
      const pType  = typeIdx  >= 0 ? String(row[typeIdx]  || '').trim() : '';
      if (!pRaw && !pName) return;

      const label  = pRaw ? 'P' + pRaw.replace(/^p/i, '') : pName.slice(0, 20);
      const detail = [pBrand, pType].filter(Boolean).join(' · ') || 'New promo request';
      const nId    = 'N-' + Date.now() + '-' + i;

      notifSheet.appendRow([nId, 'promo_request', label,
        'New promo request: ' + label, detail, nowISO, '', 'false']);

      const tId = 'T-' + Date.now() + '-' + i;
      const tRow = taskColHeaders.map(h => {
        if (h === 'Task_ID')     return tId;
        if (h === 'Title')       return 'Process ' + label + (pName ? ': ' + pName.slice(0, 40) : '');
        if (h === 'Module')      return 'Promo Codes';
        if (h === 'Brand')       return pBrand;
        if (h === 'Priority')    return 'Normal';
        if (h === 'Status')      return 'New';
        if (h === 'Progress')    return 0;
        if (h === 'Description') return detail;
        if (h === 'Created_At')  return nowISO;
        if (h === 'Updated_At')  return nowISO;
        return '';
      });
      taskSheet.appendRow(tRow);
      created.push(label);
    });

    // 8. Send email if new items created
    if (created.length > 0) {
      const subject = '🔔 ' + created.length + ' new promo request(s) — Promo Control Tower';
      const body = [
        'New requests detected in the Promo Code Request sheet:',
        '',
        created.map(r => '  • ' + r).join('\n'),
        '',
        'Open dashboard: https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec',
        '',
        'Automated notification — Promo Control Tower 2026'
      ].join('\n');
      NOTIFY_EMAILS.forEach(addr => { try { MailApp.sendEmail(addr, subject, body); } catch(_) {} });
    }

    // 9. Update watermark
    if (wmRow > 0) {
      metaSheet.getRange(wmRow, vIdx + 1).setValue(currentCount);
      metaSheet.getRange(wmRow, atIdx + 1).setValue(nowISO);
    } else {
      metaSheet.appendRow([WKEY, currentCount, nowISO]);
    }
    Logger.log('Watcher: ' + created.length + ' new → ' + created.join(', '));
  } catch (e) {
    Logger.log('promoRequestWatcher_ error: ' + e.message);
  }
}

/**
 * Run this function ONCE from the Apps Script editor to install the trigger:
 *   Apps Script editor → Run menu → installPromoWatcher
 */
function installPromoWatcher() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'promoRequestWatcher_')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('promoRequestWatcher_')
    .timeBased()
    .everyMinutes(15)
    .create();
  Logger.log('Installed: promoRequestWatcher_ every 15 min');
}

// ─────────────────────────────────────────────────────────────────────────────
// BANNER TASKS  (populated by bin/sync-banner-slack.mjs)
// ─────────────────────────────────────────────────────────────────────────────

function serverGetBannerTasks() {
  try {
    const sheet = openSS_().getSheetByName('Banner_Tasks');
    if (!sheet || sheet.getLastRow() < 2) return [];
    return readSheetObjects_(sheet);
  } catch (e) { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function openSS_() {
  return SpreadsheetApp.openById(SS_ID);
}

function getAllTasks_() {
  return getTaskSnapshot_().tasks;
}

function getTaskSnapshot_() {
  const sheet = openSS_().getSheetByName('Task_Master');
  if (!sheet) throw new Error('Task_Master tab not found');
  if (sheet.getLastRow() < 2) {
    return { tasks:[], health:buildTaskHealth_([], [], sheet) };
  }
  const sourceRows = readSheetObjects_(sheet);
  const tasks = sourceRows.map((row, i) => normaliseTaskForDashboard_(row, i + 2));
  return { tasks, health:buildTaskHealth_(sourceRows, tasks, sheet) };
}

function normaliseTaskForDashboard_(source, sourceRow) {
  const task = Object.assign({}, source);
  const issues = [];
  const rawStatus = String(source.Status || '').trim();
  const rawPriority = String(source.Priority || '').trim();
  const rawDueDate = source.Due_Date !== undefined ? source.Due_Date : source.Deadline;
  const reference = source.Assigned_At || source.Submitted_At || source.Status_Updated_At || '';

  task.Raw_Status = rawStatus;
  task.Raw_Priority = rawPriority;
  task.Raw_Due_Date = rawDueDate == null ? '' : String(rawDueDate);
  task.Description = source.Description || source.Notes || '';
  task.Status = normaliseStatus_(rawStatus);
  task.Priority = normalisePriority_(rawPriority);
  task.Due_Date = normaliseDueDate_(rawDueDate, reference);
  task.Submitted_At = normaliseTimestamp_(source.Submitted_At);
  task.Status_Updated_At = normaliseTimestamp_(source.Status_Updated_At || source.Updated_At);
  task.Assigned_At = normaliseTimestamp_(source.Assigned_At);
  task.Approved_At = normaliseTimestamp_(source.Approved_At);
  task.Executed_At = normaliseTimestamp_(source.Executed_At);
  task._Activity_At = task.Status_Updated_At || task.Assigned_At || task.Submitted_At || '';
  task._Source_Row = sourceRow;

  if (task.Status === 'Unmapped') issues.push('unmapped_status');
  if (task.Priority === 'Unmapped') issues.push('unmapped_priority');
  if (!task.Due_Date && task.Raw_Due_Date && task.Raw_Due_Date !== '-') issues.push('invalid_due_date');
  if (!task.Due_Date) issues.push('missing_due_date');
  if (!String(task.Owner || '').trim() || String(task.Owner).trim() === '-') issues.push('missing_owner');
  if (!task.Submitted_At) issues.push('missing_submitted_at');
  if (!task.Status_Updated_At) issues.push('missing_status_updated_at');

  const rawProgress = source.Progress;
  if ((rawProgress === '' || rawProgress == null) && task.Status === 'Completed') task.Progress = 100;
  else if (rawProgress === '' || rawProgress == null) task.Progress = 0;
  else task.Progress = Math.min(100, Math.max(0, Number(rawProgress) || 0));

  task._Data_Issues = issues;
  return task;
}

function buildTaskHealth_(sourceRows, tasks, sheet) {
  const issueCounts = {};
  tasks.forEach(task => (task._Data_Issues || []).forEach(issue => {
    issueCounts[issue] = (issueCounts[issue] || 0) + 1;
  }));
  const latestActivity = tasks.reduce((latest, task) => {
    const value = String(task._Activity_At || '');
    return value > latest ? value : latest;
  }, '');
  const sheetTimeZone = sheet && sheet.getParent ? sheet.getParent().getSpreadsheetTimeZone() : '';
  const warnings = [];
  if (sourceRows.length !== tasks.length) warnings.push('Not every source task was returned.');
  if (sheetTimeZone && sheetTimeZone !== BUSINESS_TIME_ZONE) {
    warnings.push('Source sheet timezone is ' + sheetTimeZone + '; dashboard output is normalised to ' + BUSINESS_TIME_ZONE + '.');
  }
  if (issueCounts.unmapped_status) warnings.push(issueCounts.unmapped_status + ' task(s) have an unmapped status.');
  if (issueCounts.unmapped_priority) warnings.push(issueCounts.unmapped_priority + ' task(s) have an unmapped priority.');
  if (issueCounts.invalid_due_date) warnings.push(issueCounts.invalid_due_date + ' task(s) have an invalid due date.');
  return {
    status: warnings.length ? 'warning' : 'healthy',
    source: 'PromoOps_Control_Layer / Task_Master',
    sourceRecordCount: sourceRows.length,
    returnedRecordCount: tasks.length,
    generatedAt: malaysiaNowIso_(),
    latestTaskActivityAt: latestActivity,
    businessTimeZone: BUSINESS_TIME_ZONE,
    sheetTimeZone: sheetTimeZone,
    issueCounts: issueCounts,
    warnings: warnings
  };
}

function normaliseDueDate_(raw, reference) {
  if (raw === '' || raw == null || String(raw).trim() === '-') return '';
  if (raw instanceof Date) return Utilities.formatDate(raw, BUSINESS_TIME_ZONE, 'yyyy-MM-dd');
  const text = String(raw).trim();
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return validYmd_(Number(m[1]), Number(m[2]), Number(m[3]));

  const refYear = inferYear_(reference);
  if (/\btoday\b/i.test(text)) {
    const ref = String(reference || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (ref) return validYmd_(Number(ref[1]), Number(ref[2]), Number(ref[3]));
  }

  m = text.match(/(?:^|\D)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    let year = m[3] ? Number(m[3]) : refYear;
    if (year < 100) year += 2000;
    return validYmd_(year, Number(m[2]), Number(m[1]));
  }

  const months = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  m = text.match(/(?:^|\D)(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:\D|$)/);
  if (m && months[m[2].slice(0,3).toLowerCase()]) {
    return validYmd_(Number(m[3]), months[m[2].slice(0,3).toLowerCase()], Number(m[1]));
  }
  m = text.match(/(?:^|\D)([A-Za-z]{3,9})\s+(\d{1,2})(?:,)?\s+(\d{4})(?:\D|$)/);
  if (m && months[m[1].slice(0,3).toLowerCase()]) {
    return validYmd_(Number(m[3]), months[m[1].slice(0,3).toLowerCase()], Number(m[2]));
  }
  return '';
}

function validYmd_(year, month, day) {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function inferYear_(reference) {
  const m = String(reference || '').match(/\b(20\d{2})\b/);
  if (m) return Number(m[1]);
  return Number(Utilities.formatDate(new Date(), BUSINESS_TIME_ZONE, 'yyyy'));
}

function normaliseTimestamp_(raw) {
  if (raw === '' || raw == null) return '';
  if (raw instanceof Date) return formatMalaysiaIso_(raw);
  const text = String(raw).trim();
  if (!text) return '';
  const local = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) return local[1] + 'T' + local[2] + ':' + local[3] + ':' + (local[4] || '00') + '+08:00';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text + 'T00:00:00+08:00';
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? '' : formatMalaysiaIso_(parsed);
}

function formatMalaysiaIso_(date) {
  return Utilities.formatDate(date, BUSINESS_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss") + '+08:00';
}

function malaysiaNowIso_() {
  return formatMalaysiaIso_(new Date());
}

function readSheetObjects_(sheet) {
  const lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 2) return [];
  const vals = sheet.getRange(1, 1, lr, lc).getValues();
  const headers = vals[0].map(String);
  const out = [];
  for (let i = 1; i < vals.length; i++) {
    if (vals[i].every(v => v === '' || v === null || v === undefined)) continue;
    const obj = {};
    headers.forEach((h, j) => {
      obj[h] = vals[i][j] instanceof Date
        ? vals[i][j].toISOString()
        : vals[i][j];
    });
    out.push(obj);
  }
  return out;
}

function toTitleCase_(str) {
  return String(str).replace(/\b\w/g, c => c.toUpperCase());
}
