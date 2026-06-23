import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, {
  headers: { Authorization: 'Bearer ' + tok },
});
const proj = await res.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;
const code = proj.files.find(f => f.name === 'Code').source;

// Find KPI card rendering
console.log('=== KPI card area ===');
const kpiIdx = dash.indexOf('Total Tasks');
if (kpiIdx >= 0) {
  console.log(dash.substring(Math.max(0, kpiIdx - 400), kpiIdx + 1500));
}

// Find date pill
console.log('\n\n=== hdr-date area ===');
const hdrIdx = dash.indexOf("hdr-date");
if (hdrIdx >= 0) {
  console.log(dash.substring(Math.max(0, hdrIdx - 300), hdrIdx + 400));
}

// Find renderTasks / filterTasks
console.log('\n\n=== filterTasks ===');
const filIdx = dash.indexOf('function filterTasks');
if (filIdx >= 0) {
  let depth = 0, end = filIdx;
  for (let i = filIdx; i < dash.length; i++) {
    if (dash[i] === '{') depth++;
    else if (dash[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  console.log(dash.substring(filIdx, end));
}

console.log('\n\n=== renderTasks ===');
const rtIdx = dash.indexOf('function renderTasks');
if (rtIdx >= 0) {
  let depth = 0, end = rtIdx;
  for (let i = rtIdx; i < dash.length; i++) {
    if (dash[i] === '{') depth++;
    else if (dash[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  console.log(dash.substring(rtIdx, end));
}

// Find Reports page
console.log('\n\n=== Reports page ===');
const repIdx = dash.indexOf("'reports'");
if (repIdx >= 0) {
  console.log(dash.substring(Math.max(0, repIdx - 100), repIdx + 800));
}

// Find serverGetBOStatus
console.log('\n\n=== serverGetBOStatus in Code.gs ===');
const boIdx = code.indexOf('serverGetBOStatus');
if (boIdx >= 0) {
  console.log(code.substring(boIdx, boIdx + 800));
} else {
  console.log('Not found in Code.gs');
}
