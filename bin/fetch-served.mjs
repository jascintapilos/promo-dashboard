import { getGoogleAuth } from '../src/google-auth.js';
const URL = 'https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(URL, { headers: { Authorization: 'Bearer ' + tok } });
console.log('Status:', res.status);
const html = await res.text();
console.log('Length:', html.length);
console.log('Has ORCH_V2_INJECT_BEGIN:', html.includes('ORCH_V2_INJECT_BEGIN'));
console.log('Has navWithFilter:', html.includes('navWithFilter'));
console.log('Has v32marked:', html.includes('v32marked'));
console.log('Has openTaskDrawer:', html.includes('openTaskDrawer'));
console.log('Has SORT_TASKS:', html.includes('sortTasksForDisplay'));
// Find the kpi() function
const m = html.match(/function kpi\(icon[\s\S]{0,300}/);
console.log('\nkpi() function:');
console.log(m ? m[0] : '(not found)');
// Bare === check
const bare = (html.match(/^=== [A-Z_]+ ===/gm) || []).length;
console.log('\nBare markers:', bare);
