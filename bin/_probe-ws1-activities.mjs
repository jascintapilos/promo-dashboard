#!/usr/bin/env node
/**
 * Probe WS1 FT CRM to diagnose why activities/segments return 0 rows.
 * Tries multiple activity types, segment categories, and API variants.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SESSION_FILE = path.resolve('ft-session-ws1.local.json');
if (!existsSync(SESSION_FILE)) {
  console.error('No ws1 session file. Run: node bin/capture-ft-session.mjs --instance=ws1');
  process.exit(1);
}

const session = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
const BASE = new URL(session.loginUrl).origin;
const portalCookie = session.cookies.find(c => c.name === 'portaltoken');
const portaltoken = portalCookie?.value || '';
const cookieExp = portalCookie?.expires || 0;
const nowSec = Math.floor(Date.now() / 1000);

console.log(`Base: ${BASE}`);
console.log(`Portaltoken: ${portaltoken ? portaltoken.slice(0,20) + '…' : 'MISSING'}`);
console.log(`Expires: ${cookieExp > 0 ? new Date(cookieExp * 1000).toISOString() : 'no expiry'}`);
if (cookieExp > 0 && cookieExp < nowSec + 300) {
  console.error('Session expired or expiring soon!');
  process.exit(1);
}

const HEADERS = {
  authtoken: portaltoken,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function GET(path) {
  const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: HEADERS });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function POST(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

// 1. Admin users
console.log('\n──── 1. Admin Users ────');
const users = await GET('/crm-api/Authentication/AdminUsers');
console.log(`  HTTP ${users.status}, count=${users.data?.Data?.length || 0}`);
if (users.data?.Data?.length > 0) {
  console.log('  Users:');
  users.data.Data.forEach(u => console.log(`    uid=${u.UserId} name=${u.Name || u.Username}`));
}

// 2. Segments by category — try 1, 2, 3
console.log('\n──── 2. Segments by Category ────');
for (const cat of [1, 2, 3, 4]) {
  const seg = await GET(`/crm-api/ActivityManager/Segments/ByCategory/${cat}`);
  console.log(`  Category ${cat}: HTTP ${seg.status}, count=${seg.data?.Data?.length || 0}`);
  if (seg.data?.Data?.length > 0) {
    seg.data.Data.slice(0, 3).forEach(s =>
      console.log(`    seg=${s.SegmentId} name="${s.SegmentName}"`)
    );
    if (seg.data.Data.length > 3) console.log(`    … and ${seg.data.Data.length - 3} more`);
  }
}

// 3. GetActivities — try activity types 1–5
console.log('\n──── 3. GetActivities by Type ────');
for (const typeId of [1, 2, 3, 4, 5]) {
  const acts = await POST('/crm-api/ActivityManager/Activities/GetActivities', {
    archived: false,
    activityTypeId: typeId,
  });
  console.log(`  TypeId ${typeId}: HTTP ${acts.status}, count=${acts.data?.Data?.length || 0}`);
  if (acts.data?.Data?.length > 0) {
    acts.data.Data.slice(0, 3).forEach(a =>
      console.log(`    act=${a.ActivityId} trigType=${a.TriggerTypeId} name="${(a.ActivityName||'').slice(0,50)}" seg=${a.SegmentId}`)
    );
  }
}

// 4. GetActivities without activityTypeId restriction
console.log('\n──── 4. GetActivities (no type filter) ────');
const allActs = await POST('/crm-api/ActivityManager/Activities/GetActivities', { archived: false });
console.log(`  HTTP ${allActs.status}, count=${allActs.data?.Data?.length || 0}`);
if (allActs.data?.Data?.length > 0) {
  // Show distribution by TriggerTypeId
  const dist = {};
  allActs.data.Data.forEach(a => { dist[a.TriggerTypeId] = (dist[a.TriggerTypeId] || 0) + 1; });
  console.log('  TriggerType distribution:', JSON.stringify(dist));
  // Show first few
  allActs.data.Data.slice(0, 5).forEach(a =>
    console.log(`  act=${a.ActivityId} trigType=${a.TriggerTypeId} actType=${a.ActivityTypeId} name="${(a.ActivityName||'').slice(0,60)}"`)
  );
}

// 5. Try including archived
console.log('\n──── 5. GetActivities (including archived, typeId=1) ────');
const archActs = await POST('/crm-api/ActivityManager/Activities/GetActivities', {
  archived: true,
  activityTypeId: 1,
});
console.log(`  HTTP ${archActs.status}, count=${archActs.data?.Data?.length || 0}`);

// 6. Try GetActivities with no body
console.log('\n──── 6. GetActivities (empty body) ────');
const emptyActs = await POST('/crm-api/ActivityManager/Activities/GetActivities', {});
console.log(`  HTTP ${emptyActs.status}, count=${emptyActs.data?.Data?.length || 0}`);

// 7. Check if there's a campaigns endpoint instead
console.log('\n──── 7. Campaign endpoints ────');
for (const path of [
  '/crm-api/CampaignManager/Campaigns',
  '/crm-api/CampaignManager/Campaigns/GetCampaigns',
  '/crm-api/CampaignManager/GetCampaigns',
]) {
  try {
    const res = await GET(path);
    console.log(`  GET ${path}: HTTP ${res.status}, count=${res.data?.Data?.length ?? JSON.stringify(res.data).slice(0,50)}`);
  } catch (e) {
    console.log(`  GET ${path}: ERROR ${e.message.slice(0,60)}`);
  }
}

// 8. Raw API exploration — what top-level endpoints exist?
console.log('\n──── 8. WS1 API info ────');
for (const path of [
  '/crm-api/ActivityManager/Activities',
  '/crm-api/ActivityManager/GetActivityTypes',
  '/crm-api/ActivityManager/Segments',
  '/crm-api/ActivityManager/Segments/GetAll',
]) {
  try {
    const res = await GET(path);
    console.log(`  GET ${path}: HTTP ${res.status}, count=${res.data?.Data?.length ?? JSON.stringify(res.data).slice(0,60)}`);
  } catch (e) {
    console.log(`  GET ${path}: ERROR ${e.message.slice(0,60)}`);
  }
}

console.log('\nProbe complete.');
