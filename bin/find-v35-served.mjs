import { getGoogleAuth } from '../src/google-auth.js';
const URL = 'https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(URL, { headers: { Authorization: 'Bearer ' + tok } });
const html = await res.text();

const idx = html.indexOf('V35 LIVE');
console.log('First V35 LIVE at index:', idx);
console.log('\nContext:');
console.log(html.substring(Math.max(0, idx - 600), idx + 100));
