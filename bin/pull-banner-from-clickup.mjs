#!/usr/bin/env node
// Downloads banner images attached to a ClickUp task and stages them into Banner/
// ready for upload-promo.js to pick up.
//
// Single-image brands: when a brand only has one file (either up or mup), the same
// image is staged as BOTH desktop (up) and mobile (mup) — common when the design
// team provides one 960x400 image that works for both.
//
// Usage:
//   node bin/pull-banner-from-clickup.mjs --task=86d3ay50u
//   node bin/pull-banner-from-clickup.mjs --task=86d3ay50u --dry-run
//   node bin/pull-banner-from-clickup.mjs --task=86d3ay50u --banner-dir=D:/Banners

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Args ──────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...rest] = a.slice(2).split('='); return [k, rest.length ? rest.join('=') : true]; })
);

const taskId = args['task'];
if (!taskId) {
  console.error('Usage: node bin/pull-banner-from-clickup.mjs --task=<clickup-task-id>');
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

// ── Filename parser ───────────────────────────────────────────────────────────
// Matches:  qpro4-ye55-mup-pp-daily-wins-june-ongoing-960x400-my-en.jpg
//           qp2a-ibc22-up-pp-daily-wins-june-ongoing-790x400-my-en.jpg
//           qpro16-ed98-up-pp-daily-wins-june-ongoing-1920x400-my-en.jpg
const BANNER_RE = /^(qpro\d+|qp2[a-d])-([^-]+)-(up|mup)-(.+)\.(jpe?g|png)$/i;

function parseFilename(title) {
  const m = BANNER_RE.exec(title);
  if (!m) return null;
  return { platform: m[1], brandCode: m[2].toLowerCase(), type: m[3].toLowerCase(), rest: m[4], ext: m[5].toLowerCase() };
}

function extractLocale(title) {
  const m = title.match(/-([a-z]{2}-[a-z]{2})\.(jpe?g|png)$/i);
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
  console.log('No banner images found. Filenames must start with qproN- or qp2a-d-.');
  process.exit(0);
}

// ── Group by brand+locale to detect single-image brands ─────────────────────
// key: `${brandCode}__${locale}`
const byBrandLocale = {};
for (const att of bannerFiles) {
  const { brandCode, type, rest, ext } = parseFilename(att.title);
  const locale = extractLocale(att.title) || 'unknown';
  const key = `${brandCode}__${locale}`;
  if (!byBrandLocale[key]) byBrandLocale[key] = { brandCode, locale, up: null, mup: null };
  byBrandLocale[key][type] = { att, rest, ext };
}

// Build final staged files list
// For single-image brands (only up or only mup), duplicate as both
const stagedFiles = [];
for (const [, entry] of Object.entries(byBrandLocale)) {
  const { brandCode, locale, up, mup } = entry;
  const destFolder = join(bannerDir, campaign, `${brandCode}-min`);
  const singleImage = (!up && mup) || (up && !mup);

  if (up && mup) {
    // Both provided — use as-is
    stagedFiles.push({ brandCode, locale, destFolder, type: 'up',  source: up,  copyOf: null });
    stagedFiles.push({ brandCode, locale, destFolder, type: 'mup', source: mup, copyOf: null });
  } else if (mup && !up) {
    // Mobile only — stage as both (same image)
    stagedFiles.push({ brandCode, locale, destFolder, type: 'mup', source: mup, copyOf: null });
    stagedFiles.push({ brandCode, locale, destFolder, type: 'up',  source: mup, copyOf: `${brandCode}-mup-${mup.rest}.${mup.ext}` });
  } else if (up && !mup) {
    // Desktop only — stage as both (same image)
    stagedFiles.push({ brandCode, locale, destFolder, type: 'up',  source: up,  copyOf: null });
    stagedFiles.push({ brandCode, locale, destFolder, type: 'mup', source: up,  copyOf: `${brandCode}-up-${up.rest}.${up.ext}` });
  }
}

// Enrich with dest filename
for (const f of stagedFiles) {
  f.destFile = `${f.brandCode}-${f.type}-${f.source.rest}.${f.source.ext}`;
  f.destPath = join(f.destFolder, f.destFile);
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
console.log('Next step:');
console.log('  Check Banner Schedule sheet for B-IDs matching this campaign, then:');
console.log('  node bin/upload-promo.js --range=B13-B25 --allow-creative-mismatch');

} // end if (!dryRun)
