// The promo team, per the Directory "Team Contact Details" tab (resolved
// 2026-06-16) plus the automation account. Used to decide which BO promos
// count as "team output" for the YTD dashboard.
//
// BO `created_by` is a lowercase username. We allowlist by username and map
// each to a clean display name for the sheet / dashboard. Michelle (michelle /
// michelle91) is included by explicit decision though she is not (yet) in the
// roster — she is a top-volume promo creator.

// username (lowercase) → display name
export const TEAM_USERNAMES = {
  bangun:        'Bangun',
  gaby:          'Gaby',
  wenwen:        'Wen',
  wen:           'Wen',   // WS1/WS2 variant "wen_promo" normalises to "wen"
  alysa:         'Alysa',
  elyssa:        'Elyssa',
  jascinta:      'Jascinta',
  waiyip:        'Wai Yip',
  michelle:      'Michelle',
  michelle91:    'Michelle',
  promo_testbot: 'promo_testbot',
};

// WS1/WS2 (IGMP) logins use affixed variants of the same person — e.g.
// "wen_promo", "admin_waiyip". Normalise by stripping a leading "admin_" and a
// trailing "_promo"/"_bot"-style suffix before matching, so one person maps to
// one display name across all platforms.
function normUser(createdBy) {
  let k = String(createdBy || '').trim().toLowerCase();
  k = k.replace(/^admin[_-]/, '').replace(/[_-]promo$/, '');
  return k;
}

export function isTeam(createdBy) {
  const raw = String(createdBy || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TEAM_USERNAMES, raw)
    || Object.prototype.hasOwnProperty.call(TEAM_USERNAMES, normUser(createdBy));
}

export function displayName(createdBy) {
  const raw = String(createdBy || '').trim().toLowerCase();
  return TEAM_USERNAMES[raw] || TEAM_USERNAMES[normUser(createdBy)] || createdBy || '';
}

// List-row `currencies` is a comma string ("MYR, SGD") or an array of codes.
// Map to the sheet's region label ("MY + SG"), ordered consistently.
const CUR_TO_REGION = { MYR: 'MY', SGD: 'SG', IDR: 'ID', THB: 'TH', KHR: 'KH', AUD: 'AU' };
const REGION_ORDER  = ['MY', 'SG', 'ID', 'TH', 'KH', 'AU'];

export function currenciesToRegion(currencies) {
  let codes = [];
  if (Array.isArray(currencies)) codes = currencies;
  else if (typeof currencies === 'string') codes = currencies.split(/[,\s]+/);
  const regions = [...new Set(codes.map((c) => CUR_TO_REGION[String(c).trim().toUpperCase()]).filter(Boolean))];
  regions.sort((a, b) => REGION_ORDER.indexOf(a) - REGION_ORDER.indexOf(b));
  return regions.join(' + ');
}

export const PROMO_TYPE_LABEL = { 1: 'Deposit', 2: 'Deposit', 3: 'Free Credit', 4: 'Free Spin', 5: 'Rebate' };
