function valuesOf(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

export function validateFreeSpinPromotionPlan(promotion, { platform, allowProviderEncodingDifference = false } = {}) {
  const errors = [];
  if (!promotion || typeof promotion !== 'object') return ['promotion body missing'];

  const providerId = Number(promotion.free_spin_game_provider_id || 0);
  const gameCode = String(promotion.free_spin_game_code || '').trim();
  if (!providerId) errors.push('free_spin_game_provider_id is unresolved');
  if (!gameCode) errors.push('free_spin_game_code is empty');

  const providerField = platform === 'qp2' ? promotion.game_provider_codes : promotion.game_provider_ids;
  const providers = valuesOf(providerField).filter((v) => v !== null && v !== '');
  if (providers.length !== 1) errors.push(`top-level provider restriction must contain exactly 1 provider (found ${providers.length})`);

  const target = Array.isArray(promotion.target)
    ? promotion.target[0]
    : promotion.target?.['0'] || promotion.target;
  const targetField = platform === 'qp2' ? target?.game_provider_codes : target?.game_provider_ids;
  const targetProviders = valuesOf(targetField).filter((v) => v !== null && v !== '');
  if (targetProviders.length !== 1) errors.push(`target provider restriction must contain exactly 1 provider (found ${targetProviders.length})`);
  if (!allowProviderEncodingDifference && providers.length === 1 && targetProviders.length === 1 && String(providers[0]) !== String(targetProviders[0])) {
    // QP2 PUT differs, but this preflight runs on POST where both are codes.
    errors.push(`top-level provider (${providers[0]}) does not match target provider (${targetProviders[0]})`);
  }

  const currencies = valuesOf(promotion.promotion_currency);
  if (!currencies.length) errors.push('promotion_currency has no rows');
  currencies.forEach((row, index) => {
    const label = row?.currency || row?.currency_id || `row ${index}`;
    const rounds = Number(row?.rounds || 0);
    const apl = Number(row?.amount_per_line || 0);
    if (!Number.isInteger(rounds) || rounds <= 0) errors.push(`${label}: rounds must be a positive integer`);
    if (!Number.isFinite(apl) || apl <= 0) errors.push(`${label}: amount_per_line must be positive`);
    if (Number(row?.lines || 0) !== 0) errors.push(`${label}: lines must be 0`);
    if (Number(row?.coins || 0) !== 0) errors.push(`${label}: coins must be 0`);
  });

  return errors;
}
