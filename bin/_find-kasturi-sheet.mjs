/**
 * Search Google Drive for Kasturi's work hours tracker sheet.
 */
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const { client: auth } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const drive = google.drive({ version: 'v3', auth });

const opts = { supportsAllDrives: true, includeItemsFromAllDrives: true };

async function search(q) {
  const res = await drive.files.list({
    ...opts, q,
    fields: 'files(id,name,createdTime)',
    pageSize: 20,
  });
  return res.data.files || [];
}

// Drive v3: use 'name' not 'title'; spaces around operators; single quotes around values
const kasturiFiles = await search("name contains 'Kasturi' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
console.log(`Kasturi sheets: ${kasturiFiles.length}`);
kasturiFiles.forEach(f => console.log(`  ${f.id}  ${f.name}  (${f.createdTime?.slice(0,10)})`));

const recentSheets = await search("mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and createdTime > '2026-06-28T00:00:00Z'");
console.log(`\nRecently created sheets (after 28 Jun): ${recentSheets.length}`);
recentSheets.forEach(f => console.log(`  ${f.id}  ${f.name}  (${f.createdTime?.slice(0,10)})`));

// List siblings of Jascinta's tracker to find the tracker folder
console.log('\n--- Checking parent folder of Jascinta tracker ---');
try {
  const jFile = await drive.files.get({
    ...opts,
    fileId: '1z5IUbq4XwvihtyHH2jXU9lngh9FLvmvy-fAYbAcig00',
    fields: 'id,name,parents',
  });
  const parents = jFile.data.parents || [];
  console.log(`Jascinta tracker parents: ${JSON.stringify(parents)}`);
  if (parents[0]) {
    const sibs = await search(`'${parents[0]}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`);
    console.log(`Siblings in same folder (${sibs.length}):`);
    sibs.forEach(f => console.log(`  ${f.id}  ${f.name}  (${f.createdTime?.slice(0,10)})`));
  }
} catch(e) {
  console.log('Error:', e.message);
}
