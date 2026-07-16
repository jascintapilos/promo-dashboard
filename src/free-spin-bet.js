// Single source of truth for QPRO/QP2 free-spin currency mechanics.
// PP2 stores requested value-per-spin divided by 20 (floored to 2dp).
// Playtech/PTI stores requested value-per-spin as the direct bet amount.
export function resolveFreeSpinProviderKind(label) {
  const raw = String(label || '').trim();
  if (/playtech|^pti(?:\s|$|-)/i.test(raw)) return 'PTI';
  if (/pragmatic|^pp2?(?:\s|$|-)/i.test(raw)) return 'PP2';
  return null;
}

export function resolveFreeSpinBet({ provider, valuePerSpin, amountPerLine } = {}) {
  const providerKind = resolveFreeSpinProviderKind(provider);
  if (!providerKind) throw new Error(`Unsupported or missing free-spin provider: "${provider || ''}"`);

  const explicitApl = amountPerLine == null || amountPerLine === '' ? null : Number(amountPerLine);
  const spinValue = valuePerSpin == null || valuePerSpin === '' ? null : Number(valuePerSpin);
  if (explicitApl != null && (!Number.isFinite(explicitApl) || explicitApl <= 0)) {
    throw new Error(`Invalid amount_per_line: ${amountPerLine}`);
  }
  if (explicitApl == null && (!Number.isFinite(spinValue) || spinValue <= 0)) {
    throw new Error(`Invalid value_per_spin: ${valuePerSpin}`);
  }

  const resolvedApl = explicitApl != null
    ? +explicitApl.toFixed(4)
    : providerKind === 'PTI'
      ? +spinValue.toFixed(2)
      : Math.floor(spinValue / 20 * 100) / 100;
  if (!Number.isFinite(resolvedApl) || resolvedApl <= 0) {
    throw new Error(`Free-spin bet resolves to invalid amount_per_line=${resolvedApl}`);
  }
  return { providerKind, amountPerLine: resolvedApl, lines: 0, coins: 0 };
}
