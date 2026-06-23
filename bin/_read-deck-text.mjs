#!/usr/bin/env node
// Reads all text elements from a Slides deck and prints them for inspection.
// Usage: node bin/_read-deck-text.mjs [presentationId]
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const DECK_ID = process.argv[2] || '1AGIwKFBc3vs8KL0Zo9ISPXU5DUb3Zu2ap3jAyjdayyc';

const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const slides = google.slides({ version: 'v1', auth: client });

const res = await slides.presentations.get({ presentationId: DECK_ID });
const deck = res.data;
console.log(`Deck: "${deck.title}" — ${deck.slides.length} slides\n`);

function extractText(el) {
  const results = [];
  if (el.shape?.text) {
    const text = el.shape.text.textElements
      .map(te => te.textRun?.content || '')
      .join('')
      .trim();
    if (text) results.push(text);
  }
  // Group elements contain children
  if (el.elementGroup?.children) {
    for (const child of el.elementGroup.children) {
      results.push(...extractText(child));
    }
  }
  // Tables
  if (el.table) {
    for (const row of el.table.tableRows || []) {
      for (const cell of row.tableCells || []) {
        const text = (cell.text?.textElements || [])
          .map(te => te.textRun?.content || '')
          .join('')
          .trim();
        if (text) results.push(`[TABLE] ${text}`);
      }
    }
  }
  return results;
}

for (let si = 0; si < deck.slides.length; si++) {
  const slide = deck.slides[si];
  const texts = [];
  for (const el of (slide.pageElements || [])) {
    texts.push(...extractText(el));
  }
  console.log(`── Slide ${si + 1} (${slide.objectId}) ──`);
  if (texts.length) {
    texts.forEach(t => console.log('  ' + JSON.stringify(t)));
  } else {
    console.log('  (no text found)');
  }
  console.log();
}
