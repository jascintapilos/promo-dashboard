import { getGoogleAuth } from '../src/google-auth.js';
const URL = 'https://script.google.com/a/macros/thebrandingpeople.co/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;
const res = await fetch(URL, { headers: { Authorization: 'Bearer ' + tok } });
const html = await res.text();
console.log('Has "V34 LIVE":', html.includes('V34 LIVE'));
console.log('Has "V32":', html.includes('>V32<'));
console.log('Has Assigned column:', html.includes('<th>Assigned</th>'));
console.log('Has navWithFilter:', html.includes('navWithFilter'));
console.log('Has openTaskDrawer:', html.includes('openTaskDrawer'));
console.log('Has openDatePop:', html.includes('openDatePop'));
console.log('Has sortTasksForDisplay:', html.includes('sortTasksForDisplay'));

// Find the IIFE
const iifeStart = html.indexOf('(function() {');
if (iifeStart >= 0) {
  console.log('\n=== IIFE first 600 chars (around start) ===');
  console.log(html.substring(iifeStart, iifeStart + 600));
}

// Look for any syntax-error-triggering patterns in scripts
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
console.log('\nTotal scripts:', scripts.length);
let errs = 0;
scripts.forEach((m, i) => {
  try { new Function(m[1]); }
  catch (e) {
    errs++;
    console.log(`Script ${i}: ${e.message}`);
    // Print preview
    console.log('Preview:', m[1].slice(0, 200).replace(/\n/g, ' '));
  }
});
if (!errs) console.log('All scripts parse OK ✓');
