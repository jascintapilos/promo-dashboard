import { getGoogleAuth } from '../src/google-auth.js';
import { writeFileSync } from 'node:fs';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const r = await fetch('https://script.googleapis.com/v1/projects/1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_/content?versionNumber=69', {
  headers: { Authorization: 'Bearer ' + tok }
});
const proj = await r.json();
const dash = proj.files.find(f => f.name === 'Dashboard').source;
const m = [...dash.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
const block0 = m[0][1];
const overview = block0.slice(18201, 26854);
writeFileSync('tmp/overview_section.js', overview);
console.log('Section', overview.length, 'chars,', overview.split('\n').length, 'lines');
console.log('Backticks:', (overview.match(/`/g)||[]).length);
console.log('Smart quotes:', (overview.match(/[‘’“”]/g)||[]).length);
console.log('NBSP:', (overview.match(/ /g)||[]).length);
console.log('Em-dash:', (overview.match(/—/g)||[]).length);
console.log('En-dash:', (overview.match(/–/g)||[]).length);
console.log('\n--- First 2000 chars ---');
console.log(overview.slice(0, 2000));
