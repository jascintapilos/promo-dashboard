export function isIgmpRequest(record) {
  if ((record?.platforms || []).some((p) => String(p).toLowerCase() === 'igmp')) return true;
  return (record?.brands || []).some((brand) => /^WS[12](?:$|[_-])/i.test(String(brand)));
}

export function applyIgmpFtPrefix(code, decision) {
  const value = String(code || '');
  if (!value) return value;
  const withoutFt = value.replace(/^FT_/i, '');
  return decision ? `FT_${withoutFt}` : withoutFt;
}

export function resolveIgmpFtPrefixDecision(record, { forceFt = false, forceNoFt = false } = {}) {
  if (forceFt && forceNoFt) {
    return { decision: null, source: 'conflict', error: 'Both --ft-prefix and --no-ft-prefix were supplied' };
  }
  if (forceFt) return { decision: true, source: '--ft-prefix' };
  if (forceNoFt) return { decision: false, source: '--no-ft-prefix' };

  const explicit = record?.instructions?.ft_prefix_decision;
  if (explicit === true || explicit === false) {
    return { decision: explicit, source: 'source instruction' };
  }
  if ((record?.instructions?.code_prefixes || []).includes('FT')) {
    return { decision: true, source: 'source prefix instruction' };
  }

  return { decision: null, source: 'unanswered' };
}
