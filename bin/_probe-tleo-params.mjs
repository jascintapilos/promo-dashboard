#!/usr/bin/env node
// Get full promo detail for ibc22 FT_REL_TLEO_20PCT_228MX (pid=1009)
// and compare with reference FT_REL_TLEO_20PCT_200MX (pid=1015)
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';

const site = getSite('ibc22');

// Full promo detail for 228MX
const r1 = await authedFetch(site, '/api/bo/promotion/1009');
console.log('=== ibc22 pid=1009 FT_REL_TLEO_20PCT_228MX ===');
const p1 = r1.data?.rows;
const keys1 = Object.keys(p1 || {}).filter(k => !['message_details','promotion_category','blacklist_template'].includes(k));
for (const k of keys1) {
  if (p1[k] !== null && p1[k] !== undefined && p1[k] !== '') {
    console.log(`  ${k}: ${JSON.stringify(p1[k])}`);
  }
}

// Full promo detail for 200MX reference
const r2 = await authedFetch(site, '/api/bo/promotion/1015');
console.log('\n=== ibc22 pid=1015 FT_REL_TLEO_20PCT_200MX (reference) ===');
const p2 = r2.data?.rows;
const keys2 = Object.keys(p2 || {}).filter(k => !['message_details','promotion_category','blacklist_template'].includes(k));
for (const k of keys2) {
  if (p2[k] !== null && p2[k] !== undefined && p2[k] !== '') {
    console.log(`  ${k}: ${JSON.stringify(p2[k])}`);
  }
}

// Also fetch the reference MT body to understand HTML structure
const mt = await authedFetch(site, '/api/bo/messagetemplate/925');
const d = mt.data?.message_details?.['1'];
if (d) {
  // Find all MYR/SGD amounts and multipliers
  const amounts = [...d.message.matchAll(/(?:MYR|SGD)\s*(\d+(?:,\d+)?)/g)].map(m => m[0]);
  const toClaims = [...d.message.matchAll(/(\d+)\s*(?:times|x\s*TO|\()/g)].map(m => m[0]);
  console.log('\nReference MT (mtId=925) locale 1 amounts:', amounts);
  console.log('TO mentions:', toClaims.slice(0, 5));
  // Show the TnC list
  const liItems = [...d.message.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m =>
    m[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim()
  );
  console.log('TnC items:', liItems);
}
