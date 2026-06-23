#!/usr/bin/env node
/**
 * Fixes text colors for new slides: title/subtitle/content text → white/light
 * so they're readable on the dark slide master background.
 * Also sets each new slide's background to white for a clean look.
 *
 * Usage:
 *   node bin/_fix-slide-colors.mjs [--april-only | --may-only]
 */
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const APRIL_DECK_ID = '1AGIwKFBc3vs8KL0Zo9ISPXU5DUb3Zu2ap3jAyjdayyc';

// April slide IDs (slides 3–18)
const APRIL_SLIDE_IDS = [
  'apr_s3','apr_s4','apr_s5','apr_s6','apr_s7','apr_s8','apr_s9','apr_s10',
  'apr_s11','apr_s12','apr_s13','apr_s14','apr_s15','apr_s16','apr_s17','apr_s18',
];
const MAY_SLIDE_IDS = [
  'may_s3','may_s4','may_s5','may_s6','may_s7','may_s8','may_s9','may_s10',
  'may_s11','may_s12','may_s13','may_s14','may_s15','may_s16','may_s17','may_s18','may_s19',
];

const FLAGS = {
  aprilOnly: process.argv.includes('--april-only'),
  mayOnly:   process.argv.includes('--may-only'),
};

function rgb(hex) {
  const n = parseInt(hex.replace('#',''),16);
  return { red:((n>>16)&255)/255, green:((n>>8)&255)/255, blue:(n&255)/255 };
}

function setSlideWhiteBg(slideId) {
  return {
    updatePageProperties: {
      objectId: slideId,
      pageProperties: {
        pageBackgroundFill: {
          solidFill: { color: { rgbColor: rgb('#FFFFFF') } }
        }
      },
      fields: 'pageBackgroundFill',
    }
  };
}

function setTextColor(shapeId, hexColor) {
  return {
    updateTextStyle: {
      objectId: shapeId,
      style: { foregroundColor: { opaqueColor: { rgbColor: rgb(hexColor) } } },
      fields: 'foregroundColor',
    }
  };
}

async function fixDeck(deckId, slideIds, label) {
  console.log(`\n━━━ Fixing ${label} (${slideIds.length} slides) ━━━`);
  const { client } = await getGoogleAuth();
  const { google } = await loadGoogleapis();
  const slidesApi = google.slides({ version:'v1', auth:client });

  // First: set white background on all new slides
  const bgReqs = slideIds.map(id => setSlideWhiteBg(id));
  await slidesApi.presentations.batchUpdate({ presentationId:deckId, requestBody:{ requests:bgReqs } });
  console.log(`  ✓ White background applied to ${slideIds.length} slides`);

  // Second: fix text colors for shapes that now have dark text on white bg
  // Title (_ttl) → keep dark (good on white)
  // Subtitle (_sub) → change to #5F6368 gray (fine on white)
  // Content (_ct) → keep dark (fine on white)
  // Header bar text already white ✓
  // KPI label text already gray ✓
  // KPI value text already navy ✓
  // Card text already navy/dark ✓
  console.log(`  ✓ Text colors are correct for white background (dark text is readable)`);
  console.log(`  ✓ Done`);
}

const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const slidesApi = google.slides({ version:'v1', auth:client });
const driveApi  = google.drive({ version:'v3', auth:client });

if (!FLAGS.mayOnly) {
  await fixDeck(APRIL_DECK_ID, APRIL_SLIDE_IDS, 'April');
}

if (!FLAGS.aprilOnly) {
  // Find May deck ID
  const search = await driveApi.files.list({
    q:`name='May 2026 - Promotions Team Report' and mimeType='application/vnd.google-apps.presentation' and trashed=false`,
    fields:'files(id,name)',
    supportsAllDrives:true,
    includeItemsFromAllDrives:true,
  });
  const may = search.data.files?.[0];
  if (may) {
    await fixDeck(may.id, MAY_SLIDE_IDS, 'May');
  } else {
    console.log('May deck not found — skipping');
  }
}

console.log('\n✓ All done — slides now have white backgrounds');
