#!/usr/bin/env node
// Downloads banner images attached to a ClickUp task and stages them into Banner/
// ready for upload-promo.js / upload-ws1-banners-api.mjs to pick up.
//
// Usage:
//   node bin/pull-banner-from-clickup.mjs --task=86d3ay50u
//   node bin/pull-banner-from-clickup.mjs --bid=B50           ← auto-resolves task from Banner Schedule
//   node bin/pull-banner-from-clickup.mjs --bid=B50 --dry-run
//   node bin/pull-banner-from-clickup.mjs --task=86d3ay50u --banner-dir=D:/Banners
//
// Filename conventions supported:
//   QPRO/QP2:  qpro4-ye55-mup-pp-daily-wins-960x400-my-en.jpg   (up/mup split)
//   WS1/WS2:   mb8-dream-vacation-raffle-1280x320-my-en.jpg      (single image, staged as-is)
//
// Single-image brands (QPRO/QP2): when a brand only has one file (up or mup),
// the same image is staged as BOTH desktop and mobile.
// WS1/WS2 files are always single-image — staged into {brand}-min/ as-is.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSheetsClient } from '../src/sheets-client.js';
import { readBannerLinks, resolveScheduleTab } from '../src/banner-schedule.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Args ──────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...rest] = a.slice(2).split('='); return [k, rest.length ? rest.join('=') : true]; })
);

let taskId = args['task'];
const bid   = args['bid'] ? String(args['bid']).toUpperCase() : null;

// Auto-resolve --bid → task ID from Banner Schedule
if (!taskId && bid) {
  console.log(`[pull-banner] Looking up ClickUp task for ${bid} in Banner Schedule...`);
  const sheetsClient = await getSheetsClient();
  const tab = await resolveScheduleTab(sheetsClient);
  const links = await readBannerLinks(sheetsClient, [bid], tab);
  const entry = links.get(bid);
  if (!entry?.clickup_task_id) {
    console.error(`No ClickUp task found for ${bid} in Banner Schedule tab "${tab}".`);
    console.error('Check that the B-ID row has a blue ClickUp hyperlink in column C.');
    process.exit(1);
  }
  taskId = entry.clickup_task_id;
  console.log(`[pull-banner] ${bid} → ClickUp task ${taskId}  (${entry.clickup_url})`);
  if (entry.drive_folder_url) {
    console.log(`[pull-banner] Drive folder: ${entry.drive_folder_url}`);
  }
}

if (!taskId) {
  console.error('Usage: node bin/pull-banner-from-clickup.mjs --task=<id>  OR  --bid=B##');
  process.exit(1);
}
const dryRun    = args['dry-run'] === true || args['dry-run'] === 'true';
const tag       = args['tag'] ? String(args['tag']).toUpperCase() : null;
const bannerDir = args['banner-dir'] || join(ROOT, 'Banner');

// ── Token ─────────────────────────────────────────────────────────────────────
const tokenFile = join(ROOT, 'clickup-token.local.json');
if (!existsSync(tokenFile)) {
  console.error('Missing clickup-token.local.json — run setup first.');
  process.exit(1);
}
const { token } = JSON.parse(readFileSync(tokenFile, 'utf8'));

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function getJson(url) {
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — GET ${url}`);
  return res.json();
}

async function downloadBuffer(url) {
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) throw new Error(`Download failed ${res.status} — ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Filename parsers ──────────────────────────────────────────────────────────
//
// QPRO/QP2 pattern:  {platform}-{brandCode}-{up|mup}-{rest}.{ext}
//   qpro4-ye55-mup-pp-daily-wins-960x400-my-en.jpg
//   qp2a-ibc22-up-microgaming-1920x400-my-en.jpg
//
// WS1/WS2 pattern:   {brand}-{desc}-{size}-{region}-{locale}.{ext}
//   mb8-dream-vacation-raffle-1280x320-my-en.jpg
//   rws77-paradise-jackpot-1000x503-my-en.jpg
// WS1/WS2 files have no up/mup marker — treated as single images (type='ws').

const QPRO_QP2_RE = /^(qpro\d+|qp2[a-d])-([^-]+)-(up|mup)-(.+)\.(jpe?g|png)$/i;
const WS1_WS2_RE  = /^(mb8|rws77|ws1|ws2)-(.+)-(\d+x\d+)-([a-z]{2}-[a-z]{2,3})\.(jpe?g|png)$/i;

function parseFilename(title) {
  const qm = QPRO_QP2_RE.exec(title);
  if (qm) {
    return {
      platform: qm[1].toLowerCase(), brandCode: qm[2].toLowerCase(),
      type: qm[3].toLowerCase(), rest: qm[4], ext: qm[5].toLowerCase(),
      family: 'qpro_qp2',
    };
  }
  const wm = WS1_WS2_RE.exec(title);
  if (wm) {
    return {
      platform: wm[1].toLowerCase(), brandCode: wm[1].toLowerCase(),
      type: 'ws', rest: `${wm[2]}-${wm[3]}-${wm[4]}`, ext: wm[5].toLowerCase(),
      locale: wm[4].toLowerCase(), family: 'ws1_ws2',
    };
  }
  return null;
}

function extractLocale(title) {
  const m = title.match(/-([a-z]{2}-[a-z]{2,3})\.(jpe?g|png)$/i);
  return m ? m[1].toLowerCase() : null;
}

function campaignNameFromTask(taskName) {
  return taskName.replace(/^\s*\[[^\]]+\]\s*/, '').trim();
}

function fmtSize(w, h) { return w && h ? `${w}x${h}` : '?x?'; }

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\nFetching task ${taskId} from ClickUp...`);
const task = await getJson(`https://api.clickup.com/api/v2/task/${taskId}`);
const campaignBase = campaignNameFromTask(task.name);
const campaign = tag ? `${tag}_${campaignBase}` : campaignBase;

console.log(`Task     : ${task.name}`);
console.log(`Campaign : ${campaign}${tag ? `  [tagged: ${tag}]` : ''}`);
console.log(`Status   : ${task.status?.status}`);
console.log(`Total attachments: ${task.attachments.length}\n`);

// Split banner images vs other files
const bannerFiles = task.attachments.filter(a => parseFilename(a.title));
const skippedFiles = task.attachments.filter(a => !parseFilename(a.title));

if (skippedFiles.length) {
  console.log(`Skipping ${skippedFiles.length} non-banner file(s) (socmed, winner list, etc.):`);
  skippedFiles.forEach(a => console.log(`  skip  ${a.title}`));
  console.log('');
}

if (!bannerFiles.length) {
  console.log('No banner images found matching known naming conventions:');
  console.log('  QPRO/QP2: qpro4-ye55-mup-pp-campaign-960x400-my-en.jpg');
  console.log('  WS1/WS2:  mb8-campaign-name-1280x320-my-en.jpg  |  rws77-campaign-1000x503-my-en.jpg');
  process.exit(0);
}

// ── Group and build staged files list ────────────────────────────────────────
const stagedFiles = [];

// Separate WS1/WS2 files (staged as-is) from QPRO/QP2 (need up/mup handling)
const ws1Files    = bannerFiles.filter(a => parseFilename(a.title)?.family === 'ws1_ws2');
const qproQp2Files = bannerFiles.filter(a => parseFilename(a.title)?.family === 'qpro_qp2');

// WS1/WS2: stage each file as-is into {brand}-min/
for (const att of ws1Files) {
  const { brandCode, rest, ext } = parseFilename(att.title);
  const destFolder = join(bannerDir, campaign, `${brandCode}-min`);
  const destFile   = att.title; // preserve original filename
  stagedFiles.push({ brandCode, locale: extractLocale(att.title) || 'unknown',
    destFolder, type: 'ws', source: { att, rest, ext }, copyOf: null,
    destFile, destPath: join(destFolder, destFile) });
}

// QPRO/QP2: group by brand+locale, handle single-image brands
const byBrandLocale = {};
for (const att of qproQp2Files) {
  const { brandCode, type, rest, ext } = parseFilename(att.title);
  const locale = extractLocale(att.title) || 'unknown';
  const key = `${brandCode}__${locale}`;
  if (!byBrandLocale[key]) byBrandLocale[key] = { brandCode, locale, up: null, mup: null };
  byBrandLocale[key][type] = { att, rest, ext };
}

for (const [, entry] of Object.entries(byBrandLocale)) {
  const { brandCode, locale, up, mup } = entry;
  const destFolder = join(bannerDir, campaign, `${brandCode}-min`);

  if (up && mup) {
    stagedFiles.push({ brandCode, locale, destFolder, type: 'up',  source: up,  copyOf: null });
    stagedFiles.push({ brandCode, locale, destFolder, type: 'mup', source: mup, copyOf: null });
  } else if (mup && !up) {
    stagedFiles.push({ brandCode, locale, destFolder, type: 'mup', source: mup, copyOf: null });
    stagedFiles.push({ brandCode, locale, destFolder, type: 'up',  source: mup, copyOf: `${brandCode}-mup-${mup.rest}.${mup.ext}` });
  } else if (up && !mup) {
    stagedFiles.push({ brandCode, locale, destFolder, type: 'up',  source: up,  copyOf: null });
    stagedFiles.push({ brandCode, locale, destFolder, type: 'mup', source: up,  copyOf: `${brandCode}-up-${up.rest}.${up.ext}` });
  }
}

// Enrich QPRO/QP2 entries with dest filename
for (const f of stagedFiles) {
  if (f.type !== 'ws' && !f.destFile) {
    f.destFile = `${f.brandCode}-${f.type}-${f.source.rest}.${f.source.ext}`;
    f.destPath = join(f.destFolder, f.destFile);
  }
}

// ── Plan table ────────────────────────────────────────────────────────────────
console.log('── Plan ─────────────────────────────────────────────────────────────');
console.log(`Destination: Banner/${campaign}/\n`);

// Group for display
const displayBrands = {};
for (const att of bannerFiles) {
  const { brandCode, type } = parseFilename(att.title);
  const locale = extractLocale(att.title) || 'unknown';
  const key = brandCode;
  if (!displayBrands[key]) displayBrands[key] = { desktop: [], mobile: [], locales: new Set(), sizes: new Set() };
  const typeLabel = type === 'up' ? 'desktop' : 'mobile';
  displayBrands[key][typeLabel].push(fmtSize(att.width, att.height));
  displayBrands[key].locales.add(locale);
  displayBrands[key].sizes.add(fmtSize(att.width, att.height));
}

const singleImageBrands = [];
console.log(`${'Brand'.padEnd(14)} ${'Uploaded'.padEnd(16)} ${'Dimensions'.padEnd(12)} ${'Locales'.padEnd(12)} Staged as`);
console.log(`${'─'.repeat(14)} ${'─'.repeat(16)} ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(20)}`);
for (const [brand, info] of Object.entries(displayBrands)) {
  const hasDesktop = info.desktop.length > 0;
  const hasMobile  = info.mobile.length > 0;
  const uploaded   = hasDesktop && hasMobile ? 'desktop + mobile' : hasDesktop ? 'desktop only' : 'mobile only';
  const sizes      = [...info.sizes].join(', ');
  const locales    = [...info.locales].join(', ');
  const stagedAs   = hasDesktop && hasMobile ? 'as-is' : '→ desktop + mobile (copy)';
  if (!hasDesktop || !hasMobile) singleImageBrands.push(brand);
  console.log(`${brand.padEnd(14)} ${uploaded.padEnd(16)} ${sizes.padEnd(12)} ${locales.padEnd(12)} ${stagedAs}`);
}
console.log(`${'─'.repeat(76)}`);
console.log(`${String(Object.keys(displayBrands).length) + ' brands'} | ${bannerFiles.length} source files → ${stagedFiles.length} staged files\n`);

if (singleImageBrands.length) {
  console.log(`Note: ${singleImageBrands.length} brand(s) have one image used for both desktop + mobile:`);
  console.log(`  ${singleImageBrands.join(', ')}\n`);
}

if (dryRun) {
  console.log('[dry-run] No files downloaded. Remove --dry-run to stage images.\n');
  console.log('Files that would be created:');
  for (const f of stagedFiles) {
    const tag  = f.copyOf ? ` (copy of ${f.copyOf})` : ` (${Math.round(f.source.att.size / 1024)}KB)`;
    const type = f.type === 'up' ? '[desktop]' : '[mobile] ';
    console.log(`  ${type} ${f.brandCode}-min/${f.destFile}${tag}`);
  }
} else {

// ── Download ──────────────────────────────────────────────────────────────────
// Download each unique source file once, then copy for single-image brands
const downloadedBuffers = new Map(); // att.id → Buffer
let ok = 0, failed = 0;

console.log(`Downloading ${bannerFiles.length} source file(s)...\n`);
for (const att of bannerFiles) {
  process.stdout.write(`  ${att.title} (${Math.round(att.size / 1024)}KB) ... `);
  try {
    const buf = await downloadBuffer(att.url);
    downloadedBuffers.set(att.id, buf);
    console.log('OK');
  } catch (err) {
    console.log(`FAILED — ${err.message}`);
    downloadedBuffers.set(att.id, null);
  }
}

console.log(`\nStaging ${stagedFiles.length} file(s)...\n`);
for (const f of stagedFiles) {
  const type = f.type === 'up' ? '[desktop]' : '[mobile] ';
  const tag  = f.copyOf ? ' (copy)' : '';
  process.stdout.write(`  ${type} ${f.brandCode}-min/${f.destFile}${tag} ... `);

  const buf = downloadedBuffers.get(f.source.att.id);
  if (!buf) { console.log('SKIPPED (source download failed)'); failed++; continue; }

  try {
    if (!existsSync(f.destFolder)) mkdirSync(f.destFolder, { recursive: true });
    writeFileSync(f.destPath, buf);
    console.log('OK');
    ok++;
  } catch (err) {
    console.log(`FAILED — ${err.message}`);
    failed++;
  }
}

console.log(`\n── Result ───────────────────────────────────────────────────────────`);
console.log(`Source files downloaded : ${downloadedBuffers.size}`);
console.log(`Files staged            : ${ok}`);
if (failed) console.log(`Failed                  : ${failed}`);
console.log(`Staged to               : Banner/${campaign}/`);
console.log('');
const hasWs1 = stagedFiles.some(f => f.type === 'ws');
const hasQpro = stagedFiles.some(f => f.type !== 'ws');
console.log('Next step:');
if (bid) {
  if (hasWs1)  console.log(`  node bin/upload-ws1-banners-api.mjs --range=${bid} --commit`);
  if (hasQpro) console.log(`  node bin/upload-promo.js --range=${bid} --allow-creative-mismatch`);
} else {
  console.log('  Check Banner Schedule for B-IDs matching this campaign, then:');
  if (hasWs1)  console.log('  node bin/upload-ws1-banners-api.mjs --range=<B-IDs> --commit');
  if (hasQpro) console.log('  node bin/upload-promo.js --range=<B-IDs> --allow-creative-mismatch');
}

} // end if (!dryRun)
