import { getGoogleAuth } from '../src/google-auth.js';
const URL = 'https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(URL, { headers: { Authorization: 'Bearer ' + tok } });
const html = await res.text();

// Print first 200 chars after first occurrence of "V34 LIVE" in served HTML
const idx = html.indexOf('V34 LIVE');
console.log('Context around "V34 LIVE":');
console.log(html.substring(Math.max(0, idx - 100), idx + 300));

// Look for taskTable header rendering
const hdrIdx = html.indexOf('<th>Title</th>');
if (hdrIdx >= 0) {
  console.log('\nContext around taskTable header:');
  console.log(html.substring(hdrIdx - 100, hdrIdx + 500));
}
