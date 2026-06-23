import { getSite } from '../src/sites.js';

const site = getSite('qpro5');
const BASE = site.baseUrl;
const bundle = await (await fetch(BASE + '/main.343f23b02f629e59b19f.js')).text();

function findWithContext(str, bundle, ctx = 300) {
  const results = [];
  let idx = 0;
  while (true) {
    const pos = bundle.indexOf(str, idx);
    if (pos === -1) break;
    results.push(bundle.slice(Math.max(0, pos - ctx), Math.min(bundle.length, pos + str.length + ctx)));
    idx = pos + 1;
  }
  return results;
}

// Find all HTTP method calls in the blacklist service
console.log('=== All blacklist HTTP calls ===');
const allCalls = findWithContext('.http.', bundle, 100).filter(m => 
  m.includes('blacklist') && (m.includes('.get(') || m.includes('.post(') || m.includes('.put(') || m.includes('.delete(') || m.includes('.patch('))
);
[...new Set(allCalls.map(m => {
  const match = m.match(/\.(get|post|put|delete|patch)\(["']([^"']+)["']/i);
  return match ? `${match[1].toUpperCase()} /api/bo${match[2]}` : null;
}).filter(Boolean))].sort().forEach(u => console.log('  ', u));

// Also find the addSettings/setSettings functions
console.log('\n=== Functions near "blacklist" and "setting" ===');
findWithContext('setting', bundle, 200).filter(m => m.includes('blacklist') && m.includes('http')).slice(0, 5).forEach((m, i) => {
  console.log(`\n--- Match ${i+1} ---\n${m.slice(0, 400)}`);
});
