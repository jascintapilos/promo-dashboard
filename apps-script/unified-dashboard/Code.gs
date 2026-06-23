/**
 * PROMO OPS CONTROL LAYER - Complete Apps Script (clean rebuild)
 */

// CONFIG
const SS = SpreadsheetApp.openById("16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk");
const TASK_MASTER = SS.getSheetByName('Task_Master');
const FIELD_DICT  = SS.getSheetByName('Field_Dictionary');
const RULES       = SS.getSheetByName('Rules_Mapping');
const BRANDS      = SS.getSheetByName('Brand_Registry');
const SOP_INDEX   = SS.getSheetByName('SOP_Index');
const USERS       = SS.getSheetByName('Users');
const ROSTER      = SS.getSheetByName('Team_Roster');
const CATALOG     = SS.getSheetByName('Request_Catalog');
const GUESTS      = SS.getSheetByName('Guest_Requests');
const BOTS        = SS.getSheetByName('Team_Bots');
const CONVOS      = SS.getSheetByName('Conversations');
const MESSAGES    = SS.getSheetByName('Messages');
const AUDIT       = SS.getSheetByName('Audit_Log');

const ROLE = {ADMIN:'Admin', APPROVER:'Approver', SUBMITTER:'Submitter', VERIFIER:'Verifier', VIEWER:'Viewer'};
const ACTION_ROLES = {
  'validate':[ROLE.ADMIN,ROLE.APPROVER],
  'build_payload':[ROLE.ADMIN,ROLE.APPROVER],
  'approve':[ROLE.ADMIN,ROLE.APPROVER],
  'execute':[ROLE.ADMIN,ROLE.APPROVER],
  'mark_complete':[ROLE.ADMIN,ROLE.APPROVER,ROLE.VERIFIER],
  'onboard':[ROLE.ADMIN],
  'offboard':[ROLE.ADMIN],
  'view_audit':[ROLE.ADMIN,ROLE.APPROVER]
};

const CLAUDE_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CLAUDE_MODEL = 'anthropic/claude-sonnet-4';
const PROPS = PropertiesService.getScriptProperties();

const STATUS = {
  NEW:'New', VALIDATING:'Validating', NEED_CLARIFICATION:'Need_Clarification',
  WAITING_APPROVAL:'Waiting_Approval', READY:'Ready_To_Execute',
  EXECUTING:'Executing', QC:'QC_Required', COMPLETED:'Completed', FAILED:'Failed_Escalated'
};

const COL = {
  Task_ID:1, Module:2, Request_Ref:3, Brand:4, Submitter:5, Submitted_At:6,
  Title:7, Source_Link:8, SOP_Ref:9, Priority:10, Deadline:11, Owner:12,
  Status:13, Status_Updated_At:14, Claude_Last_Action:15, Clarification_Q:16,
  Clarification_A:17, Output_Drive_Link:18, BO_Payload_Link:19, Approver:20,
  Approved_At:21, Executed_At:22, Verifier:23, Notes:24, Error_Code:25, Audit_URL:26
};

// MENU
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Promo Ops')
    .addItem('Validate active row','menuValidate')
    .addItem('Build BO payload','menuBuildPayload')
    .addItem('Approve active row','menuApprove')
    .addItem('Execute active row','menuExecute')
    .addItem('Mark complete','menuMarkComplete')
    .addSeparator()
    .addItem('Run daily digest now','dailyDigest')
    .addItem('Sweep stale tasks','staleTaskSweep')
    .addToUi();
  ui.createMenu('Team')
    .addItem('Onboard team from roster','menuBulkOnboard')
    .addItem('Onboard active Roster row','menuOnboardActiveRow')
    .addItem('Offboard inactive users','menuOffboardInactive')
    .addItem('Show my role','menuShowMyRole')
    .addItem('List active team','menuListTeam')
    .addToUi();
  ui.createMenu('Guest Requests')
    .addItem('Promote active row to Task_Master','promoteGuestToTask')
    .addItem('Reject active row','rejectGuestRequest')
    .addItem('Reply via my bot','menuReplyToConversation')
    .addItem('Show portal URL','menuShowPortalUrl')
    .addToUi();
  ui.createMenu('Bots')
    .addItem('Reply to active row','menuReplyToConversation')
    .addItem('Test my Slack bot','menuTestSlackBot')
    .addItem('Test my Telegram bot','menuTestTelegramBot')
    .addItem('Show webhook URLs to register','menuShowBotWebhooks')
    .addToUi();
}

// ROLE GATE
function getCurrentUserRole() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email || !USERS) return ROLE.VIEWER;
  const data = USERS.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === email && String(data[i][5]).toUpperCase() === 'TRUE') {
      USERS.getRange(i+1, 10).setValue(new Date());
      return data[i][2];
    }
  }
  return ROLE.VIEWER;
}

function requireRole(action) {
  const role = getCurrentUserRole();
  const allowed = ACTION_ROLES[action] || [];
  if (!allowed.includes(role)) {
    const msg = 'Permission denied. Action "' + action + '" requires: ' + allowed.join(', ') + '. Your role: ' + role;
    SpreadsheetApp.openById("16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk").toast(msg, 'Promo Ops Access', 6);
    logAction('-', 'permission_denied', '', '', action + ' blocked for ' + role);
    return false;
  }
  return true;
}

function getUserRow(email) {
  const data = USERS.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(email).toLowerCase()) {
      const o = {_rowIndex: i+1};
      headers.forEach((h, j) => o[h] = data[i][j]);
      return o;
    }
  }
  return null;
}

// ONBOARDING
function onboardTeamMember(email, displayName, role, modules, brands, options) {
  if (!requireRole('onboard')) return {ok:false, error:'permission_denied'};
  if (!email || !role) return {ok:false, error:'missing email or role'};
  const sheetAccess = (role === ROLE.VIEWER) ? 'viewer' : 'editor';
  const driveAccess = (role === ROLE.SUBMITTER || role === ROLE.VIEWER || role === ROLE.VERIFIER) ? 'viewer' : 'editor';
  const existing = getUserRow(email);
  const now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm');
  const row = [email, displayName||'', role, modules||'All', brands||'All', 'TRUE', sheetAccess, driveAccess, now, '', (options && options.notes) || ''];
  if (existing) {
    USERS.getRange(existing._rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    USERS.appendRow(row);
  }
  try {
    if (sheetAccess === 'editor') SS.addEditor(email);
    else if (sheetAccess === 'viewer') SS.addViewer(email);
  } catch (e) { logAction('-','share_sheet_error','','',email+': '+e); }
  try {
    const folderId = PROPS.getProperty('DRIVE_PAYLOAD_FOLDER_ID');
    if (folderId && driveAccess !== 'none') {
      const folder = DriveApp.getFolderById(folderId);
      if (driveAccess === 'editor') folder.addEditor(email);
      else if (driveAccess === 'viewer') folder.addViewer(email);
    }
  } catch (e) { logAction('-','share_folder_error','','',email+': '+e); }
  if (!options || !options.skipEmail) {
    try {
      const link = SS.getUrl();
      const formUrl = PROPS.getProperty('INTAKE_FORM_URL') || '(form URL not configured)';
      MailApp.sendEmail({
        to: email,
        subject: "You have been added to Promo Ops Control Layer (role: " + role + ")",
        htmlBody: '<p>Hi ' + (displayName||'') + ',</p>' +
          '<p>You have been added to the <b>Promo Ops Control Layer</b> as <b>' + role + '</b>.</p>' +
          '<ul><li><a href="' + link + '">Open the Sheet</a></li>' +
          '<li><a href="' + formUrl + '">Submit a request via the form</a></li></ul>' +
          '<p><b>What you can do:</b><br>' + describeRole(role) + '</p>' +
          '<p>Sign in with your Google account.</p><p>- Promo Ops Team</p>'
      });
    } catch (e) { logAction('-','welcome_email_error','','',email+': '+e); }
  }
  logAction('-','onboard_user','','',email+' as '+role);
  return {ok:true, email:email, role:role};
}

function describeRole(role) {
  const map = {
    'Admin':'Full access. Edit any tab, onboard team, approve and execute everything.',
    'Approver':'Approve high-risk rows, run Build BO Plan / Execute / Mark Complete.',
    'Submitter':'Submit new tasks via the intake form. Answer clarifications on your own rows.',
    'Verifier':'Spot-check QC_Required rows and mark them Completed.',
    'Viewer':'Read-only access to Task_Master and dashboards.'
  };
  return map[role] || '';
}

function bulkOnboardTeam() {
  if (!requireRole('onboard')) return;
  const data = ROSTER.getDataRange().getValues();
  const headers = data[0];
  const idx = (h) => headers.indexOf(h);
  let success = 0, errors = 0;
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[idx('Email')]) continue;
    if (String(r[idx('Onboard_Status')]).toUpperCase() === 'DONE') continue;
    const result = onboardTeamMember(r[idx('Email')], r[idx('Display_Name')], r[idx('Role')], r[idx('Modules_Allowed')], r[idx('Brands_Allowed')]);
    ROSTER.getRange(i+1, idx('Onboard_Status')+1).setValue(result.ok ? 'DONE' : 'ERROR');
    result.ok ? success++ : errors++;
  }
  SpreadsheetApp.openById("16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk").toast('Onboarded '+success+', errors '+errors, 'Team', 6);
}

function onboardActiveRosterRow() {
  if (!requireRole('onboard')) return;
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Team_Roster') {
    SpreadsheetApp.openById("16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk").toast('Open Team_Roster tab first','Team',4); return;
  }
  const r = sheet.getActiveCell().getRow();
  if (r === 1) return;
  const data = sheet.getRange(r,1,1,sheet.getLastColumn()).getValues()[0];
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const idx = (h) => headers.indexOf(h);
  const result = onboardTeamMember(data[idx('Email')], data[idx('Display_Name')], data[idx('Role')], data[idx('Modules_Allowed')], data[idx('Brands_Allowed')]);
  sheet.getRange(r, idx('Onboard_Status')+1).setValue(result.ok ? 'DONE' : 'ERROR');
}

function offboardInactiveUsers() {
  if (!requireRole('offboard')) return;
  const data = USERS.getDataRange().getValues();
  let removed = 0;
  for (let i = 1; i < data.length; i++) {
    const email = data[i][0];
    if (String(data[i][5]).toUpperCase() === 'FALSE') {
      try { SS.removeEditor(email); } catch(_){}
      try { SS.removeViewer(email); } catch(_){}
      try {
        const folderId = PROPS.getProperty('DRIVE_PAYLOAD_FOLDER_ID');
        if (folderId) {
          const folder = DriveApp.getFolderById(folderId);
          try { folder.removeEditor(email); } catch(_){}
          try { folder.removeViewer(email); } catch(_){}
        }
      } catch(_){}
      logAction('-','offboard_user','','',email);
      removed++;
    }
  }
  SpreadsheetApp.openById("16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk").toast('Revoked access for '+removed+' users','Team',5);
}

function listActiveTeam() {
  const data = USERS.getDataRange().getValues();
  const lines = data.slice(1).filter(r => r[0] && String(r[5]).toUpperCase()==='TRUE')
    .map(r => '* ' + (r[1]||r[0]) + ' ('+r[2]+') - modules: '+r[3]+', brands: '+r[4]);
  SpreadsheetApp.getUi().alert('Active team', lines.join('\n')||'(none)', SpreadsheetApp.getUi().ButtonSet.OK);
}

// INTAKE
function handleNewTask(e) {
  const v = e.values;
  const taskId = generateTaskId();
  const module = v[1];
  const submittedAt = new Date();
  const newRow = new Array(26).fill('');
  newRow[COL.Task_ID-1] = taskId;
  newRow[COL.Module-1] = module;
  newRow[COL.Request_Ref-1] = v[2];
  newRow[COL.Brand-1] = v[3];
  newRow[COL.Submitter-1] = v[4];
  newRow[COL.Submitted_At-1] = submittedAt;
  newRow[COL.Title-1] = v[5];
  newRow[COL.Source_Link-1] = v[6];
  newRow[COL.SOP_Ref-1] = lookupSOP(module);
  newRow[COL.Priority-1] = v[7] || 'P2';
  newRow[COL.Deadline-1] = v[8] || '';
  newRow[COL.Owner-1] = 'Lexa';
  newRow[COL.Status-1] = STATUS.NEW;
  newRow[COL.Status_Updated_At-1] = submittedAt;
  const moduleFields = parseModuleFields(module, v.slice(9));
  newRow[COL.Notes-1] = JSON.stringify(moduleFields);
  TASK_MASTER.appendRow(newRow);
  logAction(taskId,'form_submit','',STATUS.NEW, JSON.stringify({module:module, brand:v[3]}));
  validateTask(taskId);
}

function parseModuleFields(module, extras) {
  const out = {};
  if (module === 'Promo') {
    out.bonus_type = extras[0]; out.to_multiplier = parseInt(extras[1]);
    out.min_deposit = parseFloat(extras[2]); out.max_bonus = parseFloat(extras[3]);
    out.currency = extras[4]; out.start_date = extras[5];
    out.end_date = extras[6]; out.target_segment = extras[7];
  } else if (module === 'Translation') {
    out.source_doc_url = extras[0];
    out.target_languages = (extras[1]||'').split(';').map(s=>s.trim()).filter(Boolean);
    out.publish_target = extras[2];
  } else if (module === 'CRM_Inbox') {
    out.campaign_id = extras[0]; out.segment_csv_link = extras[1];
    out.blast_datetime = extras[2]; out.locale = extras[3];
  }
  return out;
}

function generateTaskId() {
  const year = Utilities.formatDate(new Date(),'GMT+8','yyyy');
  const ids = TASK_MASTER.getRange('A:A').getValues().filter(r => r[0]);
  return 'T-' + year + '-' + String(ids.length).padStart(4,'0');
}

function handleEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== 'Task_Master') return;
  const row = e.range.getRow();
  if (row === 1) return;
  const col = e.range.getColumn();
  const taskId = sheet.getRange(row, COL.Task_ID).getValue();
  if (!taskId) return;
  if (col === COL.Status) onStatusChanged(taskId, e.value);
  if (col === COL.Clarification_A && e.value) {
    setStatus(taskId, STATUS.VALIDATING);
    validateTask(taskId);
  }
}

function onStatusChanged(taskId, newStatus) {
  const map = {};
  map[STATUS.READY] = 'ready';
  map[STATUS.WAITING_APPROVAL] = 'approval_needed';
  map[STATUS.COMPLETED] = 'completed';
  map[STATUS.FAILED] = 'failed';
  map[STATUS.NEED_CLARIFICATION] = 'clarification';
  if (map[newStatus]) notifySlack(taskId, map[newStatus]);
}

// VALIDATE
function validateTask(taskId) {
  const row = readRow(taskId);
  if (!row) return;
  setStatus(taskId, STATUS.VALIDATING);
  const brand = lookupBrand(row.Brand);
  if (!brand) {
    setStatus(taskId, STATUS.FAILED);
    writeCell(taskId, 'Error_Code', 'ERR_UNKNOWN_BRAND');
    return;
  }
  let modFields = {};
  try { modFields = JSON.parse(row.Notes || '{}'); } catch(_){}
  const required = getRequiredFields(row.Module);
  const missing = required.filter(f => {
    const val = modFields[f];
    return val === undefined || val === '' || val === null || (Array.isArray(val) && val.length === 0);
  });
  if (missing.length) {
    writeCell(taskId, 'Clarification_Q', 'Missing required fields: ' + missing.join(', ') + '. Please fill column Q.');
    setStatus(taskId, STATUS.NEED_CLARIFICATION);
    return;
  }
  if (row.Module === 'Promo') {
    if (modFields.currency && brand.Allowed_Currencies && !String(brand.Allowed_Currencies).split(';').includes(modFields.currency)) {
      writeCell(taskId, 'Clarification_Q', 'Brand ' + row.Brand + ' allows currencies [' + brand.Allowed_Currencies + '] but request says ' + modFields.currency);
      setStatus(taskId, STATUS.NEED_CLARIFICATION);
      return;
    }
    if (modFields.start_date && modFields.end_date && new Date(modFields.end_date) < new Date(modFields.start_date)) {
      writeCell(taskId, 'Clarification_Q', 'end_date is before start_date.');
      setStatus(taskId, STATUS.NEED_CLARIFICATION);
      return;
    }
  }
  const intent = row.Module === 'Promo' ? 'promo_qc' : row.Module === 'Translation' ? 'translate' : row.Module === 'CRM_Inbox' ? 'crm_setup' : 'generic';
  const response = sendToClaude(taskId, intent, modFields, brand);
  if (response) processClaudeResponse(taskId, response);
}

// CLAUDE
function sendToClaude(taskId, intent, modFields, brand) {
  const row = readRow(taskId);
  const sop = loadSOP(row.SOP_Ref);
  const rules = loadRulesForModule(row.Module);
  const systemPrompt = buildSystemPrompt(intent);
  const userPrompt = buildUserPrompt(row, modFields, brand, sop, rules, intent);
  const apiKey = PROPS.getProperty('OPENROUTER_API_KEY');
  if (!apiKey) {
    setStatus(taskId, STATUS.FAILED);
    writeCell(taskId, 'Error_Code', 'ERR_NO_API_KEY');
    return null;
  }
  const payload = {model:CLAUDE_MODEL, max_tokens:2500, messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}]};
  try {
    const resp = UrlFetchApp.fetch(CLAUDE_API_URL, {
      method:'post', contentType:'application/json',
      headers:{'Authorization':'Bearer '+apiKey},
      payload: JSON.stringify(payload), muteHttpExceptions:true
    });
    if (resp.getResponseCode() !== 200) {
      setStatus(taskId, STATUS.FAILED);
      writeCell(taskId, 'Error_Code', 'ERR_OPENROUTER_'+resp.getResponseCode());
      return null;
    }
    const json = JSON.parse(resp.getContentText());
    const text = json.choices[0].message.content;
    const parsed = JSON.parse(extractJson(text));
    logAction(taskId,'claude_call','','','intent='+intent+' tokens_in='+(json.usage && json.usage.prompt_tokens)+' tokens_out='+(json.usage && json.usage.completion_tokens));
    return parsed;
  } catch (err) {
    setStatus(taskId, STATUS.FAILED);
    writeCell(taskId, 'Error_Code', 'ERR_CLAUDE_PARSE');
    return null;
  }
}

function processClaudeResponse(taskId, r) {
  const row = readRow(taskId);
  if (r.action === 'needs_clarification' || (r.missing_fields && r.missing_fields.length)) {
    writeCell(taskId, 'Clarification_Q', r.clarification_question || ('Missing: ' + (r.missing_fields||[]).join(', ')));
    setStatus(taskId, STATUS.NEED_CLARIFICATION);
    return;
  }
  if (r.promo_name) writeCell(taskId, 'Title', r.promo_name);
  if (r.column_m) writeCell(taskId, 'Notes', r.column_m);
  if (r.bo_payload) writeCell(taskId, 'BO_Payload_Link', savePayloadToDrive(taskId, r.bo_payload));
  if (r.drafts) writeCell(taskId, 'Output_Drive_Link', saveDraftsToDrive(taskId, r.drafts));
  writeCell(taskId, 'Claude_Last_Action', (r.action||'qc_pass') + ' - ' + Utilities.formatDate(new Date(),'GMT+8','yyyy-MM-dd HH:mm'));
  const moduleRules = loadRulesForModule(row.Module);
  let modFields = {};
  try { modFields = JSON.parse(row.Notes || '{}'); } catch(_){}
  const needsApproval = r.action === 'needs_approval' || (r.confidence !== undefined && r.confidence < 0.8) ||
    (moduleRules.some(rule => String(rule.requires_approval).toUpperCase() === 'YES' && rule.bonus_type === modFields.bonus_type));
  setStatus(taskId, needsApproval ? STATUS.WAITING_APPROVAL : (r.drafts ? STATUS.QC : STATUS.READY));
}

function buildSystemPrompt(intent) {
  const base = 'You are the Promotions Ops execution agent for an iGaming operation. Output ONLY a single valid JSON object, no prose.';
  if (intent === 'promo_qc') return base + '\nSchema: {"action":"qc_pass|needs_clarification|needs_approval","missing_fields":[],"clarification_question":"","promo_name":"","column_m":"","bo_payload":{"type_fields":{},"dropdown_fields":{},"checkbox_fields":{}},"confidence":0.0}';
  if (intent === 'translate') return base + '\nSchema: {"action":"translation_pass|needs_clarification","missing_fields":[],"clarification_question":"","drafts":[{"language":"","title_translated":"","body_translated":"","qc_flags":[]}],"confidence":0.0}';
  if (intent === 'crm_setup') return base + '\nSchema: {"action":"crm_pass|needs_clarification","missing_fields":[],"clarification_question":"","fasttrack_payload":{"segment_name":"","attribute":"Username","csv_link":"","currency_filter":""},"activity_skeleton":{"name":"","send_datetime":"","callback_body_blank":true},"confidence":0.0}';
  return base;
}

function buildUserPrompt(row, modFields, brand, sop, rules, intent) {
  return 'TASK: ' + intent + '\nTASK_ID: ' + row.Task_ID + '\nMODULE: ' + row.Module +
    '\nBRAND: ' + row.Brand + ' (platform=' + brand.Platform + ', currency=' + brand.Default_Currency + ')\n\n' +
    'REQUEST DATA:\n' + JSON.stringify(modFields, null, 2) + '\n\n' +
    'SOP excerpt:\n' + sop.substring(0, 6000) + '\n\n' +
    'RULES:\n' + JSON.stringify(rules, null, 2) + '\n\nReturn JSON only.';
}

// SHEET I/O
function readRow(taskId) {
  const data = TASK_MASTER.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === taskId) {
      const obj = {_rowIndex: i+1};
      headers.forEach((h, j) => obj[h] = data[i][j]);
      return obj;
    }
  }
  return null;
}

function writeCell(taskId, fieldName, value) {
  const row = readRow(taskId);
  if (!row) return;
  const headers = TASK_MASTER.getRange(1,1,1,TASK_MASTER.getLastColumn()).getValues()[0];
  const colIdx = headers.indexOf(fieldName) + 1;
  if (!colIdx) return;
  TASK_MASTER.getRange(row._rowIndex, colIdx).setValue(value);
}

function setStatus(taskId, status) {
  const row = readRow(taskId);
  if (!row) return;
  const prev = row.Status;
  if (prev === status) return;
  writeCell(taskId, 'Status', status);
  writeCell(taskId, 'Status_Updated_At', new Date());
  logAction(taskId, 'status_change', prev, status, '');
}

// LOOKUPS
function lookupBrand(code) {
  const data = BRANDS.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === code) {
      const o = {};
      headers.forEach((h, j) => o[h] = data[i][j]);
      return o;
    }
  }
  return null;
}

function getRequiredFields(module) {
  const data = FIELD_DICT.getDataRange().getValues();
  return data.slice(1).filter(r => {
    const req = String(r[2]);
    return req === 'All' || req === module || req.startsWith(module + ' ');
  }).map(r => r[0]);
}

function loadSOP(sopRef) {
  if (!sopRef) return '';
  const data = SOP_INDEX.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sopRef) {
      const fileId = data[i][2];
      if (!fileId || fileId.startsWith('REPLACE_')) return '(SOP_Index has placeholder ID)';
      try { return DocumentApp.openById(fileId).getBody().getText(); }
      catch (e) { return '(SOP not loadable: ' + e + ')'; }
    }
  }
  return '';
}

function loadRulesForModule(module) {
  const data = RULES.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).filter(r => r[1]).map(r => {
    const o = {}; headers.forEach((h, j) => o[h] = r[j]); return o;
  });
}

function lookupSOP(module) {
  return module === 'Promo' ? 'SOP-PROMO-v3.2' :
         module === 'Translation' ? 'SOP-TRAN-v1.4' :
         module === 'CRM_Inbox' ? 'SOP-CRM-v2.1' : '';
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : '{}';
}

// DRIVE
function savePayloadToDrive(taskId, payload) {
  const folderId = PROPS.getProperty('DRIVE_PAYLOAD_FOLDER_ID');
  if (!folderId) return '';
  const folder = DriveApp.getFolderById(folderId);
  const md = renderPayloadAsMarkdown(taskId, payload);
  const file = folder.createFile(taskId + '_BO_payload.md', md, 'text/markdown');
  return file.getUrl();
}

function renderPayloadAsMarkdown(taskId, payload) {
  let s = '# BO Payload - ' + taskId + '\n\n## TYPE FIELDS (agent will type)\n';
  for (const k in (payload.type_fields||{})) s += '- **' + k + '**: ' + payload.type_fields[k] + '\n';
  s += '\n## DROPDOWN FIELDS (you click)\n';
  for (const k in (payload.dropdown_fields||{})) s += '- [ ] ' + k + ' -> **' + payload.dropdown_fields[k] + '**\n';
  s += '\n## CHECKBOXES\n';
  for (const k in (payload.checkbox_fields||{})) s += '- [' + (payload.checkbox_fields[k]?'x':' ') + '] ' + k + '\n';
  return s;
}

function saveDraftsToDrive(taskId, drafts) {
  const folderId = PROPS.getProperty('DRIVE_PAYLOAD_FOLDER_ID');
  if (!folderId) return '';
  const folder = DriveApp.getFolderById(folderId);
  const sub = folder.createFolder(taskId + '_translations');
  drafts.forEach(d => {
    const text = '# ' + d.title_translated + '\n\n' + d.body_translated + '\n\n---\nQC flags: ' + ((d.qc_flags||[]).join(', ') || 'none');
    sub.createFile(taskId + '_' + d.language + '.md', text, 'text/markdown');
  });
  return sub.getUrl();
}

// SLACK
function notifySlack(message, opts) {
  opts = opts || {};
  // Always capture to Notifications tab for the dashboard activity feed
  try {
    var sh = SS.getSheetByName('Notifications');
    if (!sh) {
      sh = SS.insertSheet('Notifications');
      sh.appendRow(['Timestamp','Type','Title','Message','Related_Task','Source','Sent_To_Slack']);
      sh.getRange(1,1,1,7).setFontWeight('bold').setBackground('#0b1437').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), opts.type || 'info', opts.title || '', String(message||''), opts.taskId || '', opts.source || 'system', false]);
  } catch (logErr) {}
  // Slack disabled by default. Flip ENABLE_SLACK script property to 'true' to re-enable broadcasts.
  var enabled = PropertiesService.getScriptProperties().getProperty('ENABLE_SLACK');
  if (String(enabled).toLowerCase() !== 'true') return;
  try {
    var props = PropertiesService.getScriptProperties();
    var urls = [props.getProperty('SLACK_WEBHOOK_URL'), props.getProperty('SLACK_WEBHOOK_URL_2')].filter(function(u){return u;});
    urls.forEach(function(url){
      UrlFetchApp.fetch(url, {method:'post', contentType:'application/json', payload:JSON.stringify({text:String(message||'')}), muteHttpExceptions:true});
    });
    try { var sh2 = SS.getSheetByName('Notifications'); if (sh2) sh2.getRange(sh2.getLastRow(), 7).setValue(true); } catch(e2){}
  } catch (slackErr) {}
}

// AUDIT
function logAction(taskId, action, fromStatus, toStatus, payloadSummary) {
  AUDIT.appendRow([new Date(), taskId, Session.getActiveUser().getEmail() || 'system', action, fromStatus, toStatus, payloadSummary, CLAUDE_MODEL, '', '', '']);
}

// CRON
function dailyDigest() {
  const data = TASK_MASTER.getDataRange().getValues();
  const headers = data[0];
  const sIdx = headers.indexOf('Status');
  const open = data.slice(1).filter(r => [STATUS.NEW,STATUS.VALIDATING,STATUS.NEED_CLARIFICATION,STATUS.WAITING_APPROVAL,STATUS.READY,STATUS.QC].includes(r[sIdx]));
  if (!open.length) return;
  const lines = open.map(r => '* ' + r[0] + ' (' + r[headers.indexOf('Module')] + '/' + r[headers.indexOf('Brand')] + ') - ' + r[sIdx] + ' - ' + r[headers.indexOf('Title')]);
  const text = '*Promo Ops daily digest - ' + open.length + ' open tasks*\n' + lines.join('\n');
  const urls = [PROPS.getProperty('SLACK_WEBHOOK_URL'), PROPS.getProperty('SLACK_WEBHOOK_URL_2')].filter(function(u){return u;});
  if (url) urls.forEach(function(u){UrlFetchApp.fetch(u, {method:'post', contentType:'application/json', payload: JSON.stringify({text:text})});});
}

function staleTaskSweep() {
  const data = TASK_MASTER.getDataRange().getValues();
  const headers = data[0];
  const now = new Date();
  data.slice(1).forEach(r => {
    if (!r[0]) return;
    const status = r[headers.indexOf('Status')];
    const updated = new Date(r[headers.indexOf('Status_Updated_At')]);
    const ageHr = (now - updated) / 36e5;
    if (status === STATUS.EXECUTING && ageHr > 0.5) {
      setStatus(r[0], STATUS.FAILED);
      writeCell(r[0], 'Error_Code', 'ERR_TIMEOUT');
    }
    if ([STATUS.NEED_CLARIFICATION,STATUS.WAITING_APPROVAL,STATUS.READY].includes(status) && ageHr > 24) {
      notifySlack(r[0], 'stale_24h');
    }
  });
}

// MENU HANDLERS
function activeTaskId() {
  return TASK_MASTER.getRange(TASK_MASTER.getActiveCell().getRow(), COL.Task_ID).getValue();
}

function menuValidate() { if (!requireRole('validate')) return; const id = activeTaskId(); if (id) validateTask(id); }
function menuBuildPayload() {
  if (!requireRole('build_payload')) return;
  const id = activeTaskId();
  if (!id) return;
  const row = readRow(id);
  let modFields = {};
  try { modFields = JSON.parse(row.Notes || '{}'); } catch(_){}
  const brand = lookupBrand(row.Brand);
  const intent = row.Module === 'Promo' ? 'promo_qc' : row.Module === 'Translation' ? 'translate' : 'crm_setup';
  const r = sendToClaude(id, intent, modFields, brand);
  if (r) processClaudeResponse(id, r);
}
function menuApprove() {
  if (!requireRole('approve')) return;
  const id = activeTaskId();
  if (!id) return;
  writeCell(id, 'Approver', Session.getActiveUser().getEmail());
  writeCell(id, 'Approved_At', new Date());
  setStatus(id, STATUS.READY);
}
function menuExecute() {
  if (!requireRole('execute')) return;
  const id = activeTaskId();
  if (!id) return;
  setStatus(id, STATUS.EXECUTING);
  setStatus(id, STATUS.QC);
  writeCell(id, 'Executed_At', new Date());
}
function menuMarkComplete() {
  if (!requireRole('mark_complete')) return;
  const id = activeTaskId();
  if (!id) return;
  writeCell(id, 'Verifier', Session.getActiveUser().getEmail());
  if (!readRow(id).Executed_At) writeCell(id, 'Executed_At', new Date());
  setStatus(id, STATUS.COMPLETED);
}

function menuBulkOnboard() { bulkOnboardTeam(); }
function menuOnboardActiveRow() { onboardActiveRosterRow(); }
function menuOffboardInactive() { offboardInactiveUsers(); }
function menuListTeam() { listActiveTeam(); }
function menuShowMyRole() {
  const role = getCurrentUserRole();
  const email = Session.getActiveUser().getEmail();
  SpreadsheetApp.getUi().alert('Your access', 'Email: ' + email + '\nRole: ' + role + '\n\n' + describeRole(role), SpreadsheetApp.getUi().ButtonSet.OK);
}
function menuShowPortalUrl() {
  const url = ScriptApp.getService().getUrl();
  if (!url) { SpreadsheetApp.getUi().alert('Deploy as Web App first'); return; }
  SpreadsheetApp.getUi().alert('Guest portal URL', url, SpreadsheetApp.getUi().ButtonSet.OK);
}
function menuTestSlackBot() {
  const r = sendSlackAsBot(Session.getActiveUser().getEmail(), 'Test from your Promo Ops bot at ' + new Date().toISOString());
  SpreadsheetApp.getUi().alert('Slack bot test', r.ok ? 'OK ts=' + r.ts : 'FAIL ' + (r.error || JSON.stringify(r.raw)), SpreadsheetApp.getUi().ButtonSet.OK);
}
function menuTestTelegramBot() {
  const me = Session.getActiveUser().getEmail();
  const bot = getBotForMember(me);
  if (!bot) return SpreadsheetApp.getUi().alert('No bot for ' + me);
  const r = sendTelegramAsBot(me, bot.Telegram_Chat_ID, 'Test from your Promo Ops bot at ' + new Date().toISOString());
  SpreadsheetApp.getUi().alert('Telegram bot test', r.ok ? 'OK msg=' + r.message_id : 'FAIL ' + (r.raw && r.raw.description || r.error), SpreadsheetApp.getUi().ButtonSet.OK);
}
function menuShowBotWebhooks() {
  const url = ScriptApp.getService().getUrl();
  if (!url) { SpreadsheetApp.getUi().alert('Deploy as Web App first'); return; }
  const msg = 'WEBHOOK URLS:\n\nSlack: ' + url + '?source=slack\nTelegram setWebhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=' + encodeURIComponent(url + '?source=telegram');
  SpreadsheetApp.getUi().alert('Bot webhooks', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

// BOTS
function getBotForMember(memberEmail) {
  const data = BOTS.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(memberEmail).toLowerCase() && String(data[i][headers.indexOf('Active')]).toUpperCase() === 'TRUE') {
      const o = {}; headers.forEach((h, j) => o[h] = data[i][j]); return o;
    }
  }
  return null;
}

function findBotBySlackUserId(uid) {
  const data = BOTS.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i][headers.indexOf('Slack_User_ID')] === uid) {
      const o = {}; headers.forEach((h, j) => o[h] = data[i][j]); return o;
    }
  }
  return null;
}

function findBotByTelegramChatId(chatId) {
  const data = BOTS.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][headers.indexOf('Telegram_Chat_ID')]) === String(chatId)) {
      const o = {}; headers.forEach((h, j) => o[h] = data[i][j]); return o;
    }
  }
  return null;
}

function sendSlackAsBot(memberEmail, text, threadTs) {
  const bot = getBotForMember(memberEmail);
  if (!bot || !bot.Slack_Bot_Token) return {ok:false, error:'no_bot_configured'};
  const payload = {channel: bot.Slack_DM_Channel, text: text};
  if (threadTs) payload.thread_ts = threadTs;
  const resp = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method:'post',
    headers:{'Authorization':'Bearer '+bot.Slack_Bot_Token, 'Content-Type':'application/json; charset=utf-8'},
    payload: JSON.stringify(payload), muteHttpExceptions:true
  });
  const j = JSON.parse(resp.getContentText());
  return {ok:j.ok, ts:j.ts, channel:j.channel, raw:j};
}

function sendTelegramAsBot(memberEmail, recipientChatId, text, replyToMsgId) {
  const bot = getBotForMember(memberEmail);
  if (!bot || !bot.Telegram_Bot_Token) return {ok:false, error:'no_bot_configured'};
  const payload = {chat_id:recipientChatId, text:text, parse_mode:'HTML'};
  if (replyToMsgId) payload.reply_to_message_id = replyToMsgId;
  const resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + bot.Telegram_Bot_Token + '/sendMessage', {
    method:'post', contentType:'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions:true
  });
  const j = JSON.parse(resp.getContentText());
  return {ok:j.ok, message_id:j.result && j.result.message_id, raw:j};
}

function replyToConversation(threadId, body, asMemberEmail) {
  const conv = readConvo(threadId);
  if (!conv) return {ok:false, error:'thread_not_found'};
  const memberEmail = asMemberEmail || conv.Assigned_Member || Session.getActiveUser().getEmail();
  const messageId = 'M-' + String(MESSAGES.getLastRow()).padStart(4,'0');
  let slackResult, tgResult, emailResult;
  if (conv.Slack_Channel && conv.Slack_Thread_TS) slackResult = sendSlackAsBot(memberEmail, body, conv.Slack_Thread_TS);
  if (conv.Telegram_Chat_ID) tgResult = sendTelegramAsBot(memberEmail, conv.Telegram_Chat_ID, body);
  if (conv.Requestor_Email) {
    try {
      MailApp.sendEmail({to:conv.Requestor_Email, subject:'Re: ' + conv.Subject_ID + ' - ' + conv.Subject_Type, htmlBody:'<p>'+body.replace(/\n/g,'<br>')+'</p><p>- '+memberEmail+'</p>'});
      emailResult = {ok:true};
    } catch (e) { emailResult = {ok:false, error:String(e)}; }
  }
  MESSAGES.appendRow([messageId, threadId, new Date(), 'outbound', slackResult&&slackResult.ok?'slack':tgResult&&tgResult.ok?'telegram':'email', memberEmail, '', conv.Requestor_Email, body, '', memberEmail, 'sent']);
  bumpConvo(threadId);
  logAction(conv.Subject_ID, 'reply_sent', '', '', 'via '+memberEmail);
  return {ok:true, message_id:messageId, slack:slackResult, telegram:tgResult, email:emailResult};
}

function readConvo(threadId) {
  const data = CONVOS.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === threadId) {
      const o = {_rowIndex:i+1};
      headers.forEach((h, j) => o[h] = data[i][j]);
      return o;
    }
  }
  return null;
}

function getOrCreateConvoForSubject(subjectType, subjectId, requestorEmail, assignedMember) {
  const data = CONVOS.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === subjectType && data[i][2] === subjectId) {
      const o = {_rowIndex:i+1};
      data[0].forEach((h, j) => o[h] = data[i][j]);
      return o;
    }
  }
  const threadId = 'TH-' + subjectId;
  const now = new Date();
  CONVOS.appendRow([threadId, subjectType, subjectId, requestorEmail||'', assignedMember||'', '', '', '', requestorEmail||'', 'OPEN', now, 0, now]);
  return readConvo(threadId);
}

function bumpConvo(threadId) {
  const c = readConvo(threadId);
  if (!c) return;
  CONVOS.getRange(c._rowIndex, 11).setValue(new Date());
  CONVOS.getRange(c._rowIndex, 12).setValue((c.Message_Count || 0) + 1);
}

function handleSlackEvent(body) {
  if (body.type === 'url_verification') return ContentService.createTextOutput(body.challenge);
  const ev = body.event || {};
  if (ev.type !== 'message' || ev.bot_id) return ContentService.createTextOutput('ok');
  const bot = findBotBySlackUserId(ev.user) || {};
  const member = bot.Member_Email || '';
  const threadTs = ev.thread_ts || ev.ts;
  const data = CONVOS.getDataRange().getValues();
  let threadId = '';
  for (let i = 1; i < data.length; i++) {
    if (data[i][5] === threadTs) { threadId = data[i][0]; break; }
  }
  if (!threadId) threadId = 'TH-ORPHAN-' + ev.ts;
  const messageId = 'M-' + String(MESSAGES.getLastRow()).padStart(4,'0');
  MESSAGES.appendRow([messageId, threadId, new Date(), 'inbound', 'slack', ev.user, '', member, ev.text||'', '', member, 'received']);
  if (threadId && !threadId.startsWith('TH-ORPHAN')) bumpConvo(threadId);
  logAction(threadId, 'slack_inbound', '', '', 'from ' + ev.user);
  return ContentService.createTextOutput('ok');
}

function handleTelegramUpdate(body) {
  const msg = body.message;
  if (!msg) return ContentService.createTextOutput('ok');
  const chatId = msg.chat.id;
  const bot = findBotByTelegramChatId(chatId) || {};
  const member = bot.Member_Email || '';
  const data = CONVOS.getDataRange().getValues();
  let threadId = '';
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][4] === member && data[i][9] === 'OPEN') { threadId = data[i][0]; break; }
  }
  if (!threadId) threadId = 'TH-ORPHAN-TG-' + msg.message_id;
  const messageId = 'M-' + String(MESSAGES.getLastRow()).padStart(4,'0');
  MESSAGES.appendRow([messageId, threadId, new Date(), 'inbound', 'telegram', 'tg:'+msg.from.id, msg.from.first_name||'', member, msg.text||'', '', member, 'received']);
  if (!threadId.startsWith('TH-ORPHAN')) bumpConvo(threadId);
  logAction(threadId, 'telegram_inbound', '', '', 'from ' + (msg.from.username || msg.from.id));
  return ContentService.createTextOutput('ok');
}

// GUEST PORTAL
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || '';
  if (page === 'dashboard') {
    return HtmlService.createHtmlOutputFromFile('Dashboard').setTitle('Promo Ops Dashboard').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return HtmlService.createHtmlOutputFromFile('GuestPortal').setTitle('Promo Ops - Submit a Request').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const source = (e.parameter && e.parameter.source) || '';
    const body = JSON.parse(e.postData.contents);
    if (source === 'slack') return handleSlackEvent(body);
    if (source === 'telegram') return handleTelegramUpdate(body);
    const result = handleGuestSubmission(body);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error:String(err)})).setMimeType(ContentService.MimeType.JSON);
  }
}

function getRequestCatalog() {
  const data = CATALOG.getDataRange().getValues();
  const headers = data[0];
  return data.slice(1).filter(r => String(r[headers.indexOf('Active')]).toUpperCase() === 'TRUE')
    .map(r => { const o = {}; headers.forEach((h, i) => o[h] = r[i]); return o; });
}

function getBrandsForGuestForm() {
  const data = BRANDS.getDataRange().getValues();
  return data.slice(1).filter(r => r[0]).map(r => ({code:r[0], name:r[1]}));
}

function handleGuestSubmission(data) {
  const required = ['requestor_name','requestor_email','request_type','brand','title','description'];
  const missing = required.filter(f => !data[f] || String(data[f]).trim() === '');
  if (missing.length) return {ok:false, error:'Missing fields: ' + missing.join(', ')};
  const year = Utilities.formatDate(new Date(),'GMT+8','yyyy');
  const ids = GUESTS.getRange('A:A').getValues().filter(r => r[0]);
  const guestId = 'G-' + year + '-' + String(ids.length).padStart(4,'0');
  let folderUrl = '';
  if (data.attachments && data.attachments.length) folderUrl = saveGuestAttachments(guestId, data.attachments);
  GUESTS.appendRow([guestId, new Date(), 'NEW', data.requestor_name, data.requestor_email, data.requestor_org||'', data.request_type, data.brand, data.title, data.description, data.priority_hint||'Medium', data.deadline_hint||'', folderUrl, '', '', '', '']);
  const assignedMember = pickDefaultAssignee();
  const convo = getOrCreateConvoForSubject('guest_request', guestId, data.requestor_email, assignedMember);
  MESSAGES.appendRow(['M-' + String(MESSAGES.getLastRow()).padStart(4,'0'), convo.Thread_ID, new Date(), 'inbound', 'portal', data.requestor_email, data.requestor_name, 'promo-ops', '['+data.request_type+'] '+data.title+'\n\n'+data.description, folderUrl, '-', 'received']);
  bumpConvo(convo.Thread_ID);
  logAction(guestId, 'guest_submission', '', 'NEW', data.request_type + ' from ' + data.requestor_email);
  notifySlackGuest(guestId, data);
  if (assignedMember) sendSlackAsBot(assignedMember, 'New guest request *' + guestId + '* from ' + data.requestor_name + '\nType: ' + data.request_type + '\nTitle: ' + data.title);
  try {
    MailApp.sendEmail({to:data.requestor_email, subject:'Promo Ops received your request (' + guestId + ')', htmlBody:'<p>Hi ' + data.requestor_name + ',</p><p>Thanks - we received your request and assigned it ID <b>' + guestId + '</b>.</p><p>- Promo Ops Team</p>'});
  } catch(_){}
  return {ok:true, id:guestId, message:'Request received.'};
}

function saveGuestAttachments(guestId, attachments) {
  const parentId = PROPS.getProperty('GUEST_ATTACHMENTS_FOLDER_ID') || PROPS.getProperty('DRIVE_PAYLOAD_FOLDER_ID');
  if (!parentId) return '';
  try {
    const parent = DriveApp.getFolderById(parentId);
    const sub = parent.createFolder(guestId);
    attachments.forEach(att => {
      try {
        const blob = Utilities.newBlob(Utilities.base64Decode(att.base64), att.mimeType||'application/octet-stream', att.name||'attachment');
        sub.createFile(blob);
      } catch (e) { logAction(guestId, 'attachment_error', '', '', att.name + ': ' + e); }
    });
    return sub.getUrl();
  } catch (e) { return ''; }
}

function notifySlackGuest(guestId, data) {
  const urls = [PROPS.getProperty('SLACK_WEBHOOK_URL'), PROPS.getProperty('SLACK_WEBHOOK_URL_2')].filter(function(u){return u;});
  if (!urls.length) return;
  const text = ':incoming_envelope: *Guest request ' + guestId + '* from ' + data.requestor_name + '\nType: ' + data.request_type + ' - Brand: ' + data.brand + '\nTitle: ' + data.title;
  urls.forEach(function(u){UrlFetchApp.fetch(u, {method:'post', contentType:'application/json', payload: JSON.stringify({text:text})});});
}

function pickDefaultAssignee() {
  const data = USERS.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === ROLE.ADMIN && String(data[i][5]).toUpperCase() === 'TRUE') return data[i][0];
  }
  return '';
}

function menuReplyToConversation() {
  if (!requireRole('approve')) return;
  const sheet = SpreadsheetApp.getActiveSheet();
  let subjectType, subjectId, requestorEmail;
  if (sheet.getName() === 'Guest_Requests') {
    const r = sheet.getActiveCell().getRow();
    if (r === 1) return;
    const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    const data = sheet.getRange(r,1,1,sheet.getLastColumn()).getValues()[0];
    const idx = (h) => headers.indexOf(h);
    subjectType = 'guest_request';
    subjectId = data[idx('Guest_Req_ID')];
    requestorEmail = data[idx('Requestor_Email')];
  } else if (sheet.getName() === 'Task_Master') {
    const id = activeTaskId();
    const row = readRow(id);
    subjectType = 'task'; subjectId = id;
    const m = (row.Submitter || '').match(/<(.+?)>/);
    requestorEmail = m ? m[1] : '';
  } else {
    SpreadsheetApp.openById("16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk").toast('Open Guest_Requests or Task_Master first', 'Reply', 4);
    return;
  }
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt('Reply to ' + subjectId, 'Type your message:', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const body = resp.getResponseText();
  if (!body) return;
  const convo = getOrCreateConvoForSubject(subjectType, subjectId, requestorEmail, Session.getActiveUser().getEmail());
  const result = replyToConversation(convo.Thread_ID, body, Session.getActiveUser().getEmail());
  ui.alert('Reply sent', 'Slack: ' + (result.slack?(result.slack.ok?'OK':'FAIL'):'-') + '\nTelegram: ' + (result.telegram?(result.telegram.ok?'OK':'FAIL'):'-') + '\nEmail: ' + (result.email?(result.email.ok?'OK':'FAIL'):'-'), ui.ButtonSet.OK);
}

function promoteGuestToTask() {
  if (!requireRole('approve')) return;
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Guest_Requests') {
    SpreadsheetApp.openById("16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk").toast('Open Guest_Requests tab first', 'Guest', 4);
    return;
  }
  const r = sheet.getActiveCell().getRow();
  if (r === 1) return;
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(r,1,1,sheet.getLastColumn()).getValues()[0];
  const idx = (h) => headers.indexOf(h);
  const guestId = data[idx('Guest_Req_ID')];
  if (data[idx('Status')] === 'PROMOTED') return;
  const reqType = data[idx('Request_Type')];
  const catalog = getRequestCatalog().find(c => c.Request_Type === reqType) || {};
  const module = catalog.Default_Module || 'Promo';
  const taskId = generateTaskId();
  const newRow = new Array(26).fill('');
  newRow[COL.Task_ID-1] = taskId;
  newRow[COL.Module-1] = module;
  newRow[COL.Request_Ref-1] = guestId;
  newRow[COL.Brand-1] = data[idx('Brand')];
  newRow[COL.Submitter-1] = data[idx('Requestor_Name')] + ' <' + data[idx('Requestor_Email')] + '>';
  newRow[COL.Submitted_At-1] = data[idx('Submitted_At')];
  newRow[COL.Title-1] = data[idx('Title')];
  newRow[COL.Source_Link-1] = data[idx('Attachments_Folder')] || '';
  newRow[COL.SOP_Ref-1] = lookupSOP(module);
  newRow[COL.Priority-1] = data[idx('Priority_Hint')] === 'High' ? 'P1' : data[idx('Priority_Hint')] === 'Low' ? 'P3' : 'P2';
  newRow[COL.Deadline-1] = data[idx('Deadline_Hint')];
  newRow[COL.Owner-1] = Session.getActiveUser().getEmail();
  newRow[COL.Status-1] = STATUS.NEW;
  newRow[COL.Status_Updated_At-1] = new Date();
  newRow[COL.Notes-1] = JSON.stringify({guest_request_id:guestId, description:data[idx('Description')], attachments:data[idx('Attachments_Folder')]||''});
  TASK_MASTER.appendRow(newRow);
  sheet.getRange(r, idx('Status')+1).setValue('PROMOTED');
  sheet.getRange(r, idx('Promoted_To_Task_ID')+1).setValue(taskId);
  sheet.getRange(r, idx('Triaged_By')+1).setValue(Session.getActiveUser().getEmail());
  sheet.getRange(r, idx('Triaged_At')+1).setValue(new Date());
  logAction(taskId, 'promoted_from_guest', '', STATUS.NEW, 'from ' + guestId);
  validateTask(taskId);
}

function rejectGuestRequest() {
  if (!requireRole('approve')) return;
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Guest_Requests') return;
  const r = sheet.getActiveCell().getRow();
  if (r === 1) return;
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const idx = (h) => headers.indexOf(h);
  sheet.getRange(r, idx('Status')+1).setValue('REJECTED');
  sheet.getRange(r, idx('Triaged_By')+1).setValue(Session.getActiveUser().getEmail());
  sheet.getRange(r, idx('Triaged_At')+1).setValue(new Date());
  logAction(sheet.getRange(r,1).getValue(), 'guest_rejected', '', 'REJECTED', '');
}


// One-shot trigger installer — run once from the editor.
function installAllTriggers() {
  // Clear existing triggers first to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  // Sheet-bound triggers
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(SS).onEdit().create();
  // Form submit trigger will be installed when you wire up the intake form. Skipping now.
  // Time-driven daily digest at 9am
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(9).everyDays(1).create();
  // Stale task sweep every 15 minutes
  ScriptApp.newTrigger('staleTaskSweep').timeBased().everyMinutes(15).create();
  const installed = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction() + ' (' + t.getEventType() + ')').join(', ');
  SpreadsheetApp.openById("16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk").toast('Triggers installed: ' + installed, 'Setup', 10);
  return installed;
}


function setupInitialTeam() {
  const team = [
    ['jascinta.pilos@thebrandingpeople.co','Lexa','Admin','All','All'],
    ['waiyip@thebrandingpeople.co','Wai Yip','Approver','All','All'],
    ['booninn.wang@thebrandingpeople.co','Boon Inn Wang','Submitter','All','All'],
    ['menhua.foong@thebrandingpeople.co','Menhua Foong','Submitter','All','All'],
    ['elyssa.mae@thebrandingpeople.co','Elyssa Mae','Submitter','All','All'],
    ['gabrielle.tiffany@alphaiotabpo.com','Gabrielle Tiffany','Submitter','All','All']
  ];
  const results = team.map(function(t){
    const r = onboardTeamMember(t[0], t[1], t[2], t[3], t[4]);
    return t[0] + ' (' + t[2] + ') -> ' + (r.ok ? 'OK' : 'FAIL: ' + r.error);
  });
  Logger.log(results.join('\n'));
  return results.join(' | ');
}


// DASHBOARD SERVER FUNCTIONS
function getCurrentUserContext() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) return {ok:false, error:'no_email', email:'(anonymous)'};
  const userRow = getUserRow(email);
  if (!userRow || String(userRow.Active).toUpperCase() !== 'TRUE') {
    return {ok:false, error:'not_in_team', email:email};
  }
  return {ok:true, email:email, displayName:userRow.Display_Name, role:userRow.Role, describeRole:describeRole(userRow.Role), sheetUrl:SS.getUrl(), portalUrl:ScriptApp.getService().getUrl()};
}

function getDashboardData() {
  try {
    var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
    var userRow = getUserRow(email);
    if (!userRow || String(userRow.Active).toUpperCase() !== 'TRUE') return {ok:false, error:'not_in_team'};
    var role = userRow.Role;
    var scoped = (role === 'Submitter');
    var tasksSheet = SS.getSheetByName('Task_Master');
    var tasks = [];
    if (tasksSheet) {
      var lr = tasksSheet.getLastRow();
      if (lr >= 2) {
        var data = tasksSheet.getRange(2,1,lr-1,tasksSheet.getLastColumn()).getValues();
        var headers = tasksSheet.getRange(1,1,1,tasksSheet.getLastColumn()).getValues()[0];
        data.forEach(function(r){
          var o = {};
          headers.forEach(function(h,i){
            var val = r[i];
            if (val instanceof Date) val = Utilities.formatDate(val, 'GMT', 'yyyy-MM-dd HH:mm:ss');
            else if (val == null) val = '';
            else val = String(val);
            o[h] = val;
          });
          if (scoped && String(o.Submitter||'').toLowerCase() !== email) return;
          tasks.push(o);
        });
      }
    }
    var counts = {};
    tasks.forEach(function(t){ var s = t.Status || 'New'; counts[s] = (counts[s]||0)+1; });
    var topTasks = tasks.slice(-20).reverse();
    var guestRequests = [];
    if (role !== 'Submitter') {
      var gsh = SS.getSheetByName('Guest_Requests');
      if (gsh) {
        var glr = gsh.getLastRow();
        if (glr >= 2) {
          var gdata = gsh.getRange(2,1,glr-1,gsh.getLastColumn()).getValues();
          var gheaders = gsh.getRange(1,1,1,gsh.getLastColumn()).getValues()[0];
          gdata.forEach(function(r){ var o={}; gheaders.forEach(function(h,i){var val=r[i];if(val instanceof Date)val=Utilities.formatDate(val,'GMT','yyyy-MM-dd HH:mm:ss');else if(val==null)val='';else val=String(val);o[h]=val;}); guestRequests.push(o); });
          guestRequests = guestRequests.slice(-10).reverse();
        }
      }
    }
    var notifications = [];
    var nsh = SS.getSheetByName('Notifications');
    if (nsh) {
      var nlr = nsh.getLastRow();
      if (nlr >= 2) {
        var ndata = nsh.getRange(2,1,nlr-1,7).getValues();
        ndata.forEach(function(r){
          var ts = r[0];
          if (ts instanceof Date) ts = Utilities.formatDate(ts, 'GMT', 'yyyy-MM-dd HH:mm:ss'); else ts = String(ts||'');
          notifications.push({ Timestamp:ts, Type:String(r[1]||''), Title:String(r[2]||''), Message:String(r[3]||''), Related_Task:String(r[4]||''), Source:String(r[5]||''), Sent_To_Slack:String(r[6]||'') });
        });
        notifications = notifications.slice(-15).reverse();
      }
    }
    var slackEnabled = String(PropertiesService.getScriptProperties().getProperty('ENABLE_SLACK')||'').toLowerCase() === 'true';
    var sheetUrl = String(SS.getUrl());
    return {ok:true, role:role, counts:counts, tasks:topTasks, scoped:scoped, guestRequests:guestRequests, notifications:notifications, slackEnabled:slackEnabled, sheetUrl:sheetUrl};
  } catch (e) { return {ok:false, error:String(e&&e.message||e)}; }
}

function getNotifications(limit) {
  try {
    limit = limit || 25;
    var nsh = SS.getSheetByName('Notifications');
    if (!nsh) return {ok:true, notifications:[]};
    var lr = nsh.getLastRow();
    if (lr < 2) return {ok:true, notifications:[]};
    var data = nsh.getRange(2,1,lr-1,7).getValues();
    var arr = data.map(function(r){ return { Timestamp:r[0], Type:r[1], Title:r[2], Message:r[3], Related_Task:r[4], Source:r[5], Sent_To_Slack:r[6] }; }).slice(-limit).reverse();
    return {ok:true, notifications:arr};
  } catch (e) { return {ok:false, error:String(e)}; }
}
// ==========================================================================
// === MODULE: schema helpers (v7) ============================================
// ==========================================================================
function ensureTab_(name, headers) {
  var sh = SS.getSheetByName(name);
  if (!sh) {
    sh = SS.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#0b1437').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
function nextId_(prefix) {
  var props = PropertiesService.getScriptProperties();
  var key = 'SEQ_' + prefix;
  var n = parseInt(props.getProperty(key) || '0', 10) + 1;
  props.setProperty(key, String(n));
  var yr = new Date().getFullYear();
  return prefix + '-' + yr + '-' + ('0000' + n).slice(-4);
}
function withAutomationLog_(name, trigger, fn) {
  var logId = nextId_('L');
  var start = new Date();
  var sh = ensureTab_('Automation_Logs', ['Log_ID','Automation_Name','Trigger_Source','Trigger_Time','Status','Duration_Ms','Task_Created','Actions_Performed','Result_Summary','Error_Message','Retry_Count','AI_Agent_Used','Related_Task_ID','Related_Source_Link','Raw_Log']);
  sh.appendRow([logId, name, trigger||'dashboard', start, 'Running', 0, '', '', '', '', 0, '', '', '', '']);
  var headerRow = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  var logRowIdx = sh.getLastRow();
  function findCol(h){return headerRow.indexOf(h)+1;}
  try {
    var result = fn();
    var dur = new Date().getTime() - start.getTime();
    sh.getRange(logRowIdx, findCol('Status')).setValue('Completed');
    sh.getRange(logRowIdx, findCol('Duration_Ms')).setValue(dur);
    sh.getRange(logRowIdx, findCol('Result_Summary')).setValue(String(result && result.summary || ''));
    if (result && result.taskId) sh.getRange(logRowIdx, findCol('Related_Task_ID')).setValue(result.taskId);
    return result;
  } catch (err) {
    var dur2 = new Date().getTime() - start.getTime();
    sh.getRange(logRowIdx, findCol('Status')).setValue('Failed');
    sh.getRange(logRowIdx, findCol('Duration_Ms')).setValue(dur2);
    sh.getRange(logRowIdx, findCol('Error_Message')).setValue(String(err && err.message || err));
    throw err;
  }
}
function sheetRowsAsObjects_(sh, limit) {
  if (!sh) return [];
  var lr = sh.getLastRow();
  if (lr < 2) return [];
  var data = sh.getRange(2,1,lr-1,sh.getLastColumn()).getValues();
  var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  var out = [];
  data.forEach(function(r){
    var o = {};
    headers.forEach(function(h,i){
      var val = r[i];
      if (val instanceof Date) val = Utilities.formatDate(val,'GMT','yyyy-MM-dd HH:mm:ss');
      else if (val == null) val = '';
      else val = String(val);
      o[h] = val;
    });
    out.push(o);
  });
  if (limit && out.length > limit) out = out.slice(-limit);
  return out;
}

// ==========================================================================
// === MODULE: task detail + lifecycle =======================================
// ==========================================================================
var ALLOWED_STATUSES = ['New','Validating','Need_Clarification','Waiting_Approval','Ready_To_Execute','Executing','QC_Required','Completed','Failed_Escalated','On_Hold','Cancelled'];
var STATUS_TRANSITIONS = {
  'New': ['Validating','Need_Clarification','On_Hold','Cancelled'],
  'Validating': ['Need_Clarification','Waiting_Approval','Ready_To_Execute','On_Hold','Cancelled'],
  'Need_Clarification': ['New','Validating','Waiting_Approval','Ready_To_Execute','On_Hold','Cancelled'],
  'Waiting_Approval': ['Ready_To_Execute','Need_Clarification','Failed_Escalated','On_Hold','Cancelled'],
  'Ready_To_Execute': ['Executing','Need_Clarification','On_Hold','Cancelled'],
  'Executing': ['QC_Required','Failed_Escalated','On_Hold'],
  'QC_Required': ['Completed','Need_Clarification','Failed_Escalated','Executing'],
  'Completed': [],
  'Failed_Escalated': ['Need_Clarification','Ready_To_Execute','Cancelled'],
  'On_Hold': ['New','Validating','Need_Clarification','Ready_To_Execute','Cancelled'],
  'Cancelled': []
};
function getTaskDetail(taskId) {
  try {
    var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
    var userRow = getUserRow(email);
    if (!userRow || String(userRow.Active).toUpperCase() !== 'TRUE') return {ok:false, error:'not_in_team'};
    var sh = SS.getSheetByName('Task_Master');
    if (!sh) return {ok:false, error:'no_task_master'};
    var tasks = sheetRowsAsObjects_(sh);
    var task = null;
    for (var i=0;i<tasks.length;i++){ if(tasks[i].Task_ID === taskId){ task = tasks[i]; task._rowIndex = i+2; break; } }
    if (!task) return {ok:false, error:'task_not_found:'+taskId};
    var history = sheetRowsAsObjects_(SS.getSheetByName('Status_History')).filter(function(h){return h.Task_ID===taskId;});
    var comments = sheetRowsAsObjects_(SS.getSheetByName('Task_Comments')).filter(function(c){return c.Task_ID===taskId;});
    var sources = sheetRowsAsObjects_(SS.getSheetByName('Task_Sources')).filter(function(s){return s.Task_ID===taskId;});
    var logs = sheetRowsAsObjects_(SS.getSheetByName('Automation_Logs')).filter(function(l){return l.Related_Task_ID===taskId;}).slice(-25).reverse();
    var allowedNext = STATUS_TRANSITIONS[task.Status] || [];
    return {ok:true, task:task, history:history.reverse(), comments:comments, sources:sources, logs:logs, allowedNext:allowedNext, currentUser:email};
  } catch (e) { return {ok:false, error:String(e&&e.message||e)}; }
}
function updateTaskStatus(taskId, newStatus, notes) {
  return withAutomationLog_('updateTaskStatus','dashboard', function(){
    var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
    var userRow = getUserRow(email);
    if (!userRow || String(userRow.Active).toUpperCase() !== 'TRUE') throw new Error('not_in_team');
    if (ALLOWED_STATUSES.indexOf(newStatus) < 0) throw new Error('invalid_status:'+newStatus);
    var sh = SS.getSheetByName('Task_Master');
    var lr = sh.getLastRow();
    var data = sh.getRange(2,1,lr-1,sh.getLastColumn()).getValues();
    var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    var taskIdCol = headers.indexOf('Task_ID');
    var statusCol = headers.indexOf('Status');
    var statusUpdatedAtCol = headers.indexOf('Status_Updated_At');
    var rowIdx = -1;
    var prevStatus = '';
    for (var i=0;i<data.length;i++){ if(data[i][taskIdCol]===taskId){ rowIdx=i+2; prevStatus=String(data[i][statusCol]||''); break; } }
    if (rowIdx < 0) throw new Error('task_not_found:'+taskId);
    var allowed = STATUS_TRANSITIONS[prevStatus] || [];
    if (allowed.length > 0 && allowed.indexOf(newStatus) < 0 && prevStatus !== newStatus) {
      throw new Error('illegal_transition:'+prevStatus+'->'+newStatus);
    }
    sh.getRange(rowIdx, statusCol+1).setValue(newStatus);
    if (statusUpdatedAtCol >= 0) sh.getRange(rowIdx, statusUpdatedAtCol+1).setValue(new Date());
    var historyId = nextId_('H');
    var hsh = ensureTab_('Status_History', ['History_ID','Task_ID','Previous_Status','New_Status','Updated_By','Timestamp','Notes']);
    hsh.appendRow([historyId, taskId, prevStatus, newStatus, email, new Date(), String(notes||'')]);
    try { notifySlack('Task '+taskId+' moved '+prevStatus+' -> '+newStatus+' by '+email, {type:'status_change', title:'Status update', taskId:taskId, source:'dashboard'}); } catch(e){}
    return {ok:true, taskId:taskId, status:newStatus, prevStatus:prevStatus, historyId:historyId, summary:'status '+prevStatus+'->'+newStatus};
  });
}
function addTaskComment(taskId, body) {
  return withAutomationLog_('addTaskComment','dashboard', function(){
    var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
    var userRow = getUserRow(email);
    if (!userRow || String(userRow.Active).toUpperCase() !== 'TRUE') throw new Error('not_in_team');
    if (!body || !String(body).trim()) throw new Error('empty_body');
    var commentId = nextId_('C');
    var sh = ensureTab_('Task_Comments', ['Comment_ID','Task_ID','Author_Email','Author_Name','Timestamp','Body','Mentions']);
    sh.appendRow([commentId, taskId, email, String(userRow.Display_Name||email), new Date(), String(body), '']);
    return {ok:true, commentId:commentId, taskId:taskId, summary:'comment added'};
  });
}
function addTaskSource(taskId, sourceType, sourceLink, snippet, requestor) {
  return withAutomationLog_('addTaskSource','dashboard', function(){
    var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
    var sourceId = nextId_('S');
    var sh = ensureTab_('Task_Sources', ['Source_ID','Task_ID','Source_Type','Source_Link','Source_Ref','Requestor_Name','Requestor_Email','Request_Timestamp','Snippet','Added_By','Added_At']);
    sh.appendRow([sourceId, taskId, String(sourceType||'other'), String(sourceLink||''), '', String(requestor||''), '', new Date(), String(snippet||''), email, new Date()]);
    return {ok:true, sourceId:sourceId, taskId:taskId, summary:'source added'};
  });
}
function getAutomationLogs(filters) {
  try {
    filters = filters || {};
    var logs = sheetRowsAsObjects_(SS.getSheetByName('Automation_Logs'));
    logs = logs.filter(function(l){
      if (filters.status && l.Status !== filters.status) return false;
      if (filters.automation && l.Automation_Name !== filters.automation) return false;
      if (filters.trigger && l.Trigger_Source !== filters.trigger) return false;
      if (filters.task && l.Related_Task_ID !== filters.task) return false;
      return true;
    });
    logs = logs.slice(-100).reverse();
    return {ok:true, logs:logs};
  } catch (e) { return {ok:false, error:String(e&&e.message||e)}; }
}
function retryAutomation(logId) {
  return withAutomationLog_('retryAutomation','dashboard', function(){
    var sh = SS.getSheetByName('Automation_Logs');
    if (!sh) throw new Error('no_logs');
    var data = sheetRowsAsObjects_(sh);
    var log = null;
    for (var i=0;i<data.length;i++){ if(data[i].Log_ID===logId){ log = data[i]; break; } }
    if (!log) throw new Error('log_not_found:'+logId);
    var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    var retryCol = headers.indexOf('Retry_Count')+1;
    var lr = sh.getLastRow();
    for (var j=2; j<=lr; j++){ if(sh.getRange(j,1).getValue()===logId){ sh.getRange(j,retryCol).setValue((parseInt(log.Retry_Count||'0',10)+1)); break; } }
    return {ok:true, logId:logId, retryOf:log.Automation_Name, summary:'retry triggered for '+log.Automation_Name};
  });
}

// =============================================================================
// YTD ANALYTICS  —  reads weekly-report sheets from Drive folder
// =============================================================================

const WEEKLY_REPORT_PARENT_FOLDER_ID = '1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P';
const YTD_CACHE_KEY = 'ytd_unified_v1';
const YTD_CACHE_TTL = 600; // 10 minutes

/**
 * Called from client via google.script.run.serverGetYTD()
 * Returns { weeks: [...], generatedAt: ISO }
 */
function serverGetYTD() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(YTD_CACHE_KEY);
  if (hit) {
    try { return JSON.parse(hit); } catch(e) {}
  }
  var result = aggregateYTD_();
  try { cache.put(YTD_CACHE_KEY, JSON.stringify(result), YTD_CACHE_TTL); } catch(e) {}
  return result;
}

function clearYTDCache() {
  CacheService.getScriptCache().remove(YTD_CACHE_KEY);
  return 'cleared';
}

function aggregateYTD_() {
  var reports = discoverYTDReports_();
  var weeks = [];
  reports.forEach(function(file) {
    var w = parseYTDWeek_(file);
    if (w) weeks.push(w);
  });
  // Sort chronologically by weekNum+year
  weeks.sort(function(a, b) {
    if (a.year !== b.year) return a.year - b.year;
    return a.weekNum - b.weekNum;
  });
  return { weeks: weeks, generatedAt: new Date().toISOString() };
}

function discoverYTDReports_() {
  var folder = DriveApp.getFolderById(WEEKLY_REPORT_PARENT_FOLDER_ID);
  var result = [];
  // Check subfolders too (reports may be organised by month)
  function scanFolder(f) {
    var files = f.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      if (file.getMimeType() === MimeType.GOOGLE_SHEETS) result.push(file);
    }
    var subs = f.getFolders();
    while (subs.hasNext()) scanFolder(subs.next());
  }
  scanFolder(folder);
  return result;
}

/**
 * Parse one weekly-report Google Sheet.
 * Expected sheet name pattern: "W18 2026 (28 Apr - 4 May)"
 * Expected column layout (first tab):
 *   type | brand | region | staff | count | util | hours | month | warnings
 * Types: promo / banner / crm / new_game / staff
 */
function parseYTDWeek_(file) {
  try {
    var ss = SpreadsheetApp.openById(file.getId());
    // Prefer a sheet whose name looks like a week label; fall back to first
    var sheets = ss.getSheets();
    var sheet = sheets[0];
    for (var s = 0; s < sheets.length; s++) {
      if (/Wd+s+d{4}/.test(sheets[s].getName())) { sheet = sheets[s]; break; }
    }
    var sheetName = sheet.getName(); // e.g. "W18 2026 (28 Apr - 4 May)"
    var labelMatch = sheetName.match(/W(d+)s+(d{4})s*(([^)]+))/);
    var weekNum   = labelMatch ? parseInt(labelMatch[1]) : 0;
    var year      = labelMatch ? parseInt(labelMatch[2]) : new Date().getFullYear();
    var dateRange = labelMatch ? labelMatch[3] : sheetName;

    var lr = sheet.getLastRow(), lc = sheet.getLastColumn();
    if (lr < 2 || lc < 1) return null;
    var raw = sheet.getRange(1, 1, lr, lc).getValues();
    var headers = raw[0].map(function(h) { return String(h).trim().toLowerCase(); });

    function col(name) { return headers.indexOf(name); }

    var iType    = col('type');   if (iType < 0) iType = col('metric');
    var iBrand   = col('brand');  if (iBrand < 0) iBrand = col('platform');
    var iRegion  = col('region');
    var iStaff   = col('staff');  if (iStaff < 0) iStaff = col('name');
    var iCount   = col('count');  if (iCount < 0) iCount = col('value');
    var iUtil    = col('util');   if (iUtil < 0) iUtil = col('utilization'); if (iUtil < 0) iUtil = col('utilisation');
    var iHours   = col('hours');
    var iMonth   = col('month');
    var iWarn    = col('warnings'); if (iWarn < 0) iWarn = col('warning');

    var promoTotal = 0, promoByBrand = {}, promoByRegion = {};
    var bannersTotal = 0, bannersByRegion = {};
    var crmTotal = 0, crmByBrand = {};
    var newGamesTotal = 0, newGamesByRegion = {};
    var staff = {};
    var warnings = [];
    var month = '';

    for (var i = 1; i < raw.length; i++) {
      var row = raw[i];
      var type   = iType >= 0   ? String(row[iType] || '').toLowerCase().trim()  : '';
      var brand  = iBrand >= 0  ? String(row[iBrand] || '').trim()  : '';
      var region = iRegion >= 0 ? String(row[iRegion] || '').trim() : '';
      var count  = iCount >= 0  ? Number(row[iCount] || 0) : 0;
      var util   = iUtil >= 0   ? Number(row[iUtil] || 0) : 0;
      var hours  = iHours >= 0  ? Number(row[iHours] || 0) : 0;
      var sname  = iStaff >= 0  ? String(row[iStaff] || '').trim() : '';
      var warn   = iWarn >= 0   ? String(row[iWarn] || '').trim() : '';
      var mo     = iMonth >= 0  ? String(row[iMonth] || '').trim() : '';

      if (mo && !month) month = mo;
      if (warn) warnings.push(warn);

      if (type === 'promo' || type === 'promo_code' || type === 'promotion' || type === 'promotions') {
        promoTotal += count;
        if (brand)  promoByBrand[brand]   = (promoByBrand[brand]   || 0) + count;
        if (region) promoByRegion[region] = (promoByRegion[region] || 0) + count;
      } else if (type === 'banner' || type === 'banners') {
        bannersTotal += count;
        if (region) bannersByRegion[region] = (bannersByRegion[region] || 0) + count;
      } else if (type === 'crm' || type === 'crm_assignment' || type === 'crm_assignments') {
        crmTotal += count;
        if (brand) crmByBrand[brand] = (crmByBrand[brand] || 0) + count;
      } else if (type === 'new_game' || type === 'new_games' || type === 'game' || type === 'games') {
        newGamesTotal += count;
        if (region) newGamesByRegion[region] = (newGamesByRegion[region] || 0) + count;
      } else if (type === 'staff' || type === 'utilization' || type === 'utilisation') {
        if (sname) staff[sname] = { util: util, hours: hours };
      }
    }

    return {
      label:            sheetName,
      weekNum:          weekNum,
      year:             year,
      dateRange:        dateRange,
      month:            month,
      promoTotal:       promoTotal,
      promoByBrand:     promoByBrand,
      promoByRegion:    promoByRegion,
      bannersTotal:     bannersTotal,
      bannersByRegion:  bannersByRegion,
      crmTotal:         crmTotal,
      crmByBrand:       crmByBrand,
      newGamesTotal:    newGamesTotal,
      newGamesByRegion: newGamesByRegion,
      staff:            staff,
      warnings:         warnings
    };
  } catch(e) {
    return null;
  }
}
