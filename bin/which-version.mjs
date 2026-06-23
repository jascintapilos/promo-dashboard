import { getGoogleAuth } from '../src/google-auth.js';
const URL = 'https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(URL, { headers: { Authorization: 'Bearer ' + tok } });
const html = await res.text();

console.log('Has V35 LIVE marker:', html.includes('V35 LIVE'));
console.log('Has V34 LIVE marker:', html.includes('V34 LIVE'));
console.log('Has V32 marker (no V35):', html.includes('>V32<'));
console.log('Has Assigned column:', html.includes('Assigned'));
console.log('Has console.log V35:', html.includes('[Dashboard V35 LIVE]'));
