#!/usr/bin/env node
// Dumps raw element types from a specific slide to diagnose structure.
// Usage: node bin/_inspect-slide.mjs [presentationId] [slideIndex 0-based]
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const DECK_ID = process.argv[2] || '1AGIwKFBc3vs8KL0Zo9ISPXU5DUb3Zu2ap3jAyjdayyc';
const SLIDE_IDX = parseInt(process.argv[3] || '2', 10);

const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const slides = google.slides({ version: 'v1', auth: client });

const res = await slides.presentations.get({ presentationId: DECK_ID });
const slide = res.data.slides[SLIDE_IDX];
if (!slide) { console.error('Slide not found'); process.exit(1); }

console.log(`Slide ${SLIDE_IDX + 1} — ${slide.pageElements?.length || 0} elements\n`);

function summarise(el, depth = 0) {
  const indent = '  '.repeat(depth);
  const keys = Object.keys(el).filter(k => !['transform', 'size', 'objectId'].includes(k));
  const type = keys.find(k => ['shape', 'image', 'video', 'table', 'elementGroup', 'line', 'sheetsChart', 'wordArt'].includes(k)) || 'unknown';
  process.stdout.write(`${indent}[${el.objectId || '?'}] type=${type}`);
  if (type === 'shape') {
    process.stdout.write(` shapeType=${el.shape?.shapeType}`);
    const text = el.shape?.text?.textElements?.map(te => te.textRun?.content || '').join('').trim();
    if (text) process.stdout.write(` TEXT="${text.slice(0,80).replace(/\n/g,'↵')}"`);
  }
  if (type === 'image') {
    process.stdout.write(` [IMAGE]`);
  }
  if (type === 'sheetsChart') {
    process.stdout.write(` spreadsheetId=${el.sheetsChart?.spreadsheetId} chartId=${el.sheetsChart?.chartId}`);
  }
  if (type === 'elementGroup') {
    console.log(` (${el.elementGroup.children?.length} children) {`);
    for (const child of el.elementGroup.children || []) {
      summarise(child, depth + 1);
    }
    console.log(`${indent}}`);
    return;
  }
  console.log();
}

for (const el of (slide.pageElements || [])) {
  summarise(el);
}
