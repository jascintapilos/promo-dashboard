// Directus CMS client for the WS1 (MB8) + WS2 (RWS77) banner CMSs on
// best-in-asia.com. Email/password auth → short-lived access_token.
//
// Credentials: cms-creds.local.json (gitignored)
//   { "email": "...", "password": "...",
//     "hosts": { "MB8": "https://cms.best-in-asia.com",
//                "RWS77": "https://ws2-cms.best-in-asia.com" } }

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const CREDS_FILE = path.resolve('cms-creds.local.json');

export function loadCmsCreds() {
  if (!existsSync(CREDS_FILE)) {
    throw new Error(`Missing ${CREDS_FILE}. Create it with { email, password, hosts:{MB8,RWS77} }.`);
  }
  return JSON.parse(readFileSync(CREDS_FILE, 'utf8'));
}

// Log in to one Directus host, return a bound { get } helper.
export async function cmsClient(host, { email, password } = loadCmsCreds()) {
  const login = await fetch(host + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  const token = login?.data?.access_token;
  if (!token) {
    throw new Error(`CMS login failed for ${host}: ${JSON.stringify(login?.errors || login).slice(0, 120)}`);
  }
  const H = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  return {
    host,
    token,
    async get(p) {
      const res = await fetch(host + p, { headers: H });
      const j = await res.json();
      if (!res.ok) throw new Error(`CMS GET ${p} → HTTP ${res.status}: ${JSON.stringify(j?.errors || j).slice(0, 120)}`);
      return j;
    },
  };
}
