#!/usr/bin/env node
// Probe WS1 IGMP MY & SG (Directus API) for TLEO promo codes.
// Compare to QPRO canonical source (54 codes) and report missing codes.
//
// Run: node bin/_probe-ws1-igmp-api.mjs

import fs from 'node:fs';

const SOURCE = JSON.parse(fs.readFileSync('tmp/qpro2-tleo-source.json', 'utf8'));
const canonicalCodes = new Set(Object.keys(SOURCE));
console.log(`Canonical TLEO codes from qpro2: ${canonicalCodes.size}\n`);

const SESSIONS = JSON.parse(fs.readFileSync('igmp-sessions.local.json', 'utf8'));

const sites = [
  { name: 'IGMP-MY', baseUrl: 'https://kioskmy.best-in-asia.com', sessionKey: 'ws1-v3-my' },
  { name: 'IGMP-SG', baseUrl: 'https://kiosksg.best-in-asia.com', sessionKey: 'ws1-v3-sg' },
];

const results = {};

async function fetchWithCookies(url, cookies) {
  const cookieHeader = cookies
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  const response = await fetch(url, {
    headers: {
      'Cookie': cookieHeader,
      'Accept': 'application/json',
    }
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

for (const site of sites) {
  try {
    console.log(`\n━━━ ${site.name} ━━━`);

    const session = SESSIONS.sessions[site.sessionKey];
    if (!session) {
      throw new Error(`No saved session found for ${site.sessionKey}`);
    }

    // Try different Directus collection names for promo codes
    const possibleCollections = [
      'promo_codes',
      'promotions',
      'promocodes',
      'promo',
      'promotion_codes',
      'offers',
      'promoscodes'
    ];

    let codes = [];
    let foundCollection = null;

    for (const collection of possibleCollections) {
      try {
        const apiUrl = `${site.baseUrl}/api/items/${collection}?filter[code][_contains]=TLEO&limit=200`;
        console.log(`  Trying collection: ${collection}...`);

        const data = await fetchWithCookies(apiUrl, session.cookies);

        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          codes = data.data
            .map(item => item.code || item.promo_code || item.name)
            .filter(c => c && c.includes('TLEO'));

          if (codes.length > 0) {
            foundCollection = collection;
            console.log(`  ✓ Found collection: ${collection}`);
            break;
          }
        }
      } catch (e) {
        // Try next collection
        continue;
      }
    }

    if (!foundCollection) {
      console.log(`  ⚠ Could not find promo codes collection. Tried: ${possibleCollections.join(', ')}`);
    }

    results[site.name] = codes;

  } catch (e) {
    console.error(`  ERROR: ${e.message.split('\n')[0]}`);
    results[site.name] = null;
  }
}

// Compare results
console.log('\n━━━ COMPARISON ━━━\n');
for (const [siteName, found] of Object.entries(results)) {
  if (!found) {
    console.log(`${siteName}: ERROR - could not fetch codes`);
    continue;
  }

  const foundSet = new Set(found.map(c => String(c).trim()).filter(Boolean));
  const missing = [...canonicalCodes].filter(c => !foundSet.has(c));
  const extra = [...foundSet].filter(c => !canonicalCodes.has(c));

  console.log(`${siteName}: Found ${foundSet.size} codes`);

  if (missing.length) {
    console.log(`  MISSING (${missing.length}):`);
    missing.slice(0, 10).forEach(c => console.log(`    ✗ ${c}`));
    if (missing.length > 10) {
      console.log(`    ... and ${missing.length - 10} more`);
    }
  } else {
    console.log(`  ✓ All canonical codes present`);
  }

  if (extra.length) {
    console.log(`  EXTRA (${extra.length}):`);
    extra.slice(0, 5).forEach(c => console.log(`    + ${c}`));
    if (extra.length > 5) {
      console.log(`    ... and ${extra.length - 5} more`);
    }
  }
  console.log('');
}
