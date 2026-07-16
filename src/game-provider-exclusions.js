// Provider exclusions shared by QPRO and QP2 promotion creation.
// Exact alias matching keeps similarly prefixed providers such as PP2 enabled.
export const HARD_EXCLUDED_GAME_PROVIDERS = [
  '918KAYA',
  'ALLBET',
  'DREAM GAMING',
  'HABANERO',
  'KINGMIDAS',
  'PNG',
  'PP',
  'SBO',
  'SSG',
  'YL GAMING',
];

const ALIASES = new Set([
  '918KAYA', 'KAYA',
  'ALLBET', 'AB',
  'DREAM GAMING', 'DG',
  'HABANERO', 'HABA',
  'KINGMIDAS', 'KING MIDAS', 'KM',
  'PNG', "PLAY'N GO", 'PLAY N GO',
  'PP',
  'SBO', 'SBO2',
  'SSG', 'SUPER SPADE GAMING',
  'YL GAMING', 'YL',
]);

function normalizeProvider(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function isHardExcludedGameProvider(provider) {
  const code = normalizeProvider(provider?.code);
  const name = normalizeProvider(provider?.name);
  return (code && ALIASES.has(code)) || (name && ALIASES.has(name));
}

// Browser selector labels may use either the BO code or the long name.
export const HARD_EXCLUDED_GAME_PROVIDER_SELECTOR_LABELS = [...ALIASES];
