import { getGoogleAuth } from '../src/google-auth.js';
const URL = 'https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(URL, { headers: { Authorization: 'Bearer ' + tok } });
const html = await res.text();

// The Apps Script HTML wraps the entire user HTML in a single string passed
// to .write(). Find the actual document.write call payload.
// The user content is delivered via setContent which becomes a big string
// argument. Let's find a known landmark and decode the nearby region.
const i = html.indexOf('V34 LIVE');
const before = html.substring(Math.max(0, i - 2500), i + 200);

// Decode \xNN sequences and \\xNN double-escapes
function decode(s) {
  return s.replace(/\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/\\/g, '\').replace(/\n/g, '\n').replace(/\\//g, '/');
}
const decoded = decode(before);
console.log('=== Decoded context around V34 LIVE ===');
console.log(decoded);
