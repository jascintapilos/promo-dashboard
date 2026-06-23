import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLIENT = JSON.parse(readFileSync(path.join(__dirname, 'google-oauth-client.local.json'), 'utf8')).installed;
const TOKEN  = JSON.parse(readFileSync(path.join(__dirname, 'google-oauth-token.local.json'), 'utf8'));
const SID = '175Qj_q9I-nG2E3zbfDW5_zcML9N6DwdebE0iIreZp2c';

async function getToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT.client_id,
      client_secret: CLIENT.client_secret,
      refresh_token: TOKEN.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  return d.access_token;
}

// Build rows for a quarter: title, headers, then KRs (each KR = 5 rows)
function buildRows(title, krs) {
  const rows = [
    ['', title],
    ['', 'Category', 'Objective', 'Key Result', 'KPI Metric', 'Target', 'Level', 'Score', 'Measurement Tool'],
  ];
  for (const kr of krs) {
    rows.push(['', kr.cat, kr.obj, kr.kr, kr.kpi, kr.target, '1', '', kr.tool]);
    rows.push(['', '', '', '', '', '', '2', '', '']);
    rows.push(['', '', '', '', '', '', '3', '', '']);
    rows.push(['', '', '', '', '', '', '4', '', '']);
    rows.push(['', '', '', '', '', '', '5', '', '']);
  }
  return rows;
}

// ─── Q1 DATA ───────────────────────────────────────────────────────────────
const q1 = buildRows('Q1 2026 – BUILD FOUNDATION', [
  { cat: 'Operations Leadership (30%)', obj: 'Establish team ownership and accountability',
    kr: '[10%] Assign owners for all recurring Promo workflows',
    kpi: '% workflows with assigned owner', target: '100%', tool: 'SOP Ownership Matrix' },
  { cat: '', obj: '',
    kr: '[10%] Conduct weekly planning meetings with action tracking',
    kpi: '% action items completed on time', target: '≥90%', tool: 'Action Tracker + Fireflies' },
  { cat: '', obj: '',
    kr: '[10%] Monitor SLA compliance for operational requests',
    kpi: '% requests completed within SLA', target: '≥95%', tool: 'Promo Tracker' },
  { cat: 'Team Systems (25%)', obj: 'Build scalable operational processes',
    kr: '[10%] Document core recurring workflows',
    kpi: '% workflows documented', target: '≥80%', tool: 'SOP Repository' },
  { cat: '', obj: '',
    kr: '[10%] Implement QC checklist usage',
    kpi: '% promo cycles using checklist', target: '100%', tool: 'QC Tracker' },
  { cat: '', obj: '',
    kr: '[5%] Implement correction log review process',
    kpi: '% errors reviewed monthly', target: '100%', tool: 'Correction Log' },
  { cat: 'Automation & Innovation (25%)', obj: 'Stabilize automation initiatives',
    kr: '[15%] Maintain Promo Code Automation',
    kpi: 'Automation success rate', target: '≥95%', tool: 'Automation Dashboard' },
  { cat: '', obj: '',
    kr: '[10%] Complete Banner Automation MVP',
    kpi: 'Project completion', target: 'MVP launched', tool: 'Project Tracker' },
  { cat: 'Business Enablement (20%)', obj: 'Build Promo knowledge across teams',
    kr: '[10%] Deliver BO & Promo Fundamentals Training',
    kpi: '% Sales members trained', target: '100%', tool: 'Training Tracker' },
  { cat: '', obj: '',
    kr: '[10%] Launch Promo Knowledge Base',
    kpi: 'Completion rate', target: '≥50%', tool: 'Knowledge Repository' },
]);

// ─── Q2 DATA ───────────────────────────────────────────────────────────────
const q2 = buildRows('Q2 2026 – IMPLEMENT & SCALE', [
  { cat: 'Operations Leadership (30%)', obj: 'Strengthen operational ownership',
    kr: '[15%] Team members independently manage assigned workflows',
    kpi: '% workflows handled without escalation', target: '≥70%', tool: 'Escalation Log' },
  { cat: '', obj: '',
    kr: '[15%] Improve action item completion discipline',
    kpi: '% action items completed on time', target: '≥95%', tool: 'Action Tracker' },
  { cat: 'Team Systems (25%)', obj: 'Expand operational documentation',
    kr: '[15%] Achieve full SOP coverage',
    kpi: '% recurring workflows documented', target: '100%', tool: 'SOP Repository' },
  { cat: '', obj: '',
    kr: '[10%] Complete quarterly SOP review cycle',
    kpi: '% SOPs reviewed', target: '100%', tool: 'SOP Review Tracker' },
  { cat: 'Automation & Innovation (25%)', obj: 'Expand workflow automation',
    kr: '[15%] Deploy Banner Automation',
    kpi: '% automation coverage', target: '≥70%', tool: 'Automation Dashboard' },
  { cat: '', obj: '',
    kr: '[10%] Deploy CRM Automation',
    kpi: '% automation coverage', target: '≥50%', tool: 'Automation Dashboard' },
  { cat: 'Business Enablement (20%)', obj: 'Improve Sales-Promo collaboration',
    kr: '[10%] Complete Sales onboarding materials',
    kpi: 'Completion status', target: '100%', tool: 'Knowledge Repository' },
  { cat: '', obj: '',
    kr: '[10%] Maintain monthly Sales alignment sessions',
    kpi: 'Sessions completed', target: 'Monthly', tool: 'Meeting Minutes' },
]);

// ─── Q3 DATA ───────────────────────────────────────────────────────────────
const q3 = buildRows('Q3 2026 – OPTIMIZE', [
  { cat: 'Operations Leadership (30%)', obj: 'Improve team performance and ownership',
    kr: '[15%] Reduce workflow dependency on manager intervention',
    kpi: '% workflows completed independently', target: '≥80%', tool: 'Escalation Log' },
  { cat: '', obj: '',
    kr: '[15%] Improve team productivity',
    kpi: 'Average utilization rate', target: '80-90%', tool: 'Utilization Dashboard' },
  { cat: 'Team Systems (25%)', obj: 'Enhance operational quality',
    kr: '[15%] Reduce recurring QC issues',
    kpi: 'QC issue reduction', target: '30%', tool: 'QC Tracker' },
  { cat: '', obj: '',
    kr: '[10%] Implement process improvements',
    kpi: 'Improvements completed', target: '≥3', tool: 'Improvement Log' },
  { cat: 'Automation & Innovation (25%)', obj: 'Drive AI-assisted operations',
    kr: '[15%] Expand AI-supported workflows',
    kpi: 'Number of workflows supported', target: '≥5', tool: 'AI Workflow Register' },
  { cat: '', obj: '',
    kr: '[10%] Achieve measurable efficiency gains',
    kpi: 'Hours saved monthly', target: '≥30', tool: 'Utilization Report' },
  { cat: 'Business Enablement (20%)', obj: 'Increase operational knowledge maturity',
    kr: '[20%] Deliver advanced Promo and BO training',
    kpi: 'Training sessions completed', target: 'Quarterly', tool: 'Training Tracker' },
]);

// ─── Q4 DATA ───────────────────────────────────────────────────────────────
const q4 = buildRows('Q4 2026 – STRATEGIC IMPACT', [
  { cat: 'Operations Leadership (30%)', obj: 'Develop sustainable team leadership',
    kr: '[15%] Prepare backup operational lead',
    kpi: 'Readiness assessment completed', target: '100%', tool: 'Succession Plan' },
  { cat: '', obj: '',
    kr: '[15%] Achieve mature team ownership model',
    kpi: '% workflows independently managed', target: '≥90%', tool: 'Ownership Matrix' },
  { cat: 'Team Systems (25%)', obj: 'Maintain operational excellence',
    kr: '[15%] Complete annual SOP audit',
    kpi: 'Audit completion', target: '100%', tool: 'SOP Audit Report' },
  { cat: '', obj: '',
    kr: '[10%] Maintain QC standards',
    kpi: 'SLA & QC compliance', target: '≥95%', tool: 'QC Dashboard' },
  { cat: 'Automation & Innovation (25%)', obj: 'Build scalable operations',
    kr: '[15%] Automate major recurring workflows',
    kpi: 'Automation coverage', target: '≥90%', tool: 'Automation Dashboard' },
  { cat: '', obj: '',
    kr: '[10%] Increase team productivity through automation',
    kpi: 'Productivity improvement', target: '≥30%', tool: 'Utilization Dashboard' },
  { cat: 'Business Enablement (20%)', obj: 'Establish long-term business support model',
    kr: '[10%] Maintain Sales-Promo operating framework',
    kpi: 'Framework compliance', target: '≥95%', tool: 'Process Review Report' },
  { cat: '', obj: '',
    kr: '[10%] Deliver business improvement recommendations',
    kpi: 'Recommendations implemented', target: '≥4 annually', tool: 'Improvement Tracker' },
]);

async function updateSheet(at, tab, rows) {
  // Clear the range first
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SID}/values/${encodeURIComponent(tab)}!A1:I200:clear`,
    { method: 'POST', headers: { 'Authorization': `Bearer ${at}`, 'Content-Type': 'application/json' } }
  );

  const body = { range: `${tab}!A1:I${rows.length}`, majorDimension: 'ROWS', values: rows };
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SID}/values/${encodeURIComponent(tab)}!A1:I${rows.length}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  const d = await r.json();
  if (d.error) throw new Error(`${tab}: ${d.error.message}`);
  console.log(`✅ ${tab}: ${d.updatedCells} cells updated (${rows.length} rows)`);
}

const at = await getToken();
await updateSheet(at, 'Q1_2026', q1);
await updateSheet(at, 'Q2_2026', q2);
await updateSheet(at, 'Q3_2026', q3);
await updateSheet(at, 'Q4_2026', q4);
console.log('\nAll quarters updated.');
