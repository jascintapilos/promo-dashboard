import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const URL = 'https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

// HEAD source
const r1 = await fetch(`https://script.googleapis.com/v1/projects/${SCRIPT_ID}/content`, { headers: { Authorization: 'Bearer ' + tok } });
const proj = await r1.json();
const head = proj.files.find(f => f.name === 'Dashboard').source;
console.log('=== HEAD (latest pushed source) ===');
console.log('  Has Assigned col:', head.includes('<th>Assigned</th>'));
console.log('  Has V34 LIVE:', head.includes('V34 LIVE'));
console.log('  Has navWithFilter:', head.includes('window.navWithFilter'));

// Live served
const r2 = await fetch(URL, { headers: { Authorization: 'Bearer ' + tok } });
const live = await r2.text();
console.log('\n=== LIVE (currently deployed) ===');
console.log('  Has Assigned col (encoded):', live.includes('Assigned'));
console.log('  Has V34 LIVE:', live.includes('V34 LIVE'));
console.log('  Has navWithFilter:', live.includes('navWithFilter'));

// Difference: encoded vs raw — Assigned could be inside escape sequences
// Search for "A\x73\x73igned" or similar
console.log('  Has \x41ssigned variant:', live.match(/\x41ssigned/) !== null);
console.log('  Has any A.{2}signed:', live.match(/A\x73signed|Assigned/) !== null);

// Find <th>Title</th> in live HTML and show context
const tIdx = live.indexOf('Title');
const tCtx = live.substring(Math.max(0, tIdx - 50), tIdx + 350);
console.log('\n  Context around Title in live HTML:');
console.log('  ' + tCtx);
