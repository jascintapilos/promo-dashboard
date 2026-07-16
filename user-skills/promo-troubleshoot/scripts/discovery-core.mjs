const NUMBER = String.raw`([\d,.]+)`;

export function parseDiscoveryQuery(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const rate = normalized.match(/(\d+(?:\.\d+)?)\s*%/);
  const examples = [];
  const examplePattern = /(?:depo(?:sit)?|dep)\s*(?:rm|myr)?\s*([\d,.]+)\s*(?:get|gets|=|→|->)\s*(?:rm|myr)?\s*([\d,.]+)/gi;
  let match;
  while ((match = examplePattern.exec(normalized))) {
    examples.push({ deposit: toNumber(match[1]), total: toNumber(match[2]) });
  }

  const merchant = normalized.match(/\bQP2([A-D])\b/i);
  return {
    text: normalized,
    rate: rate ? Number(rate[1]) : null,
    currency: /\b(?:MYR|RM)\b/i.test(normalized) || /\bMY\b/i.test(normalized) ? 'MYR' : null,
    category: /\bsports?\b/i.test(normalized) ? 'Sports'
      : /\bslots?\b/i.test(normalized) ? 'Slots'
        : /\blive\s*casino\b/i.test(normalized) ? 'Live Casino' : null,
    welcome: /\bwelc(?:ome)?\b/i.test(normalized),
    deposit: /\bdep(?:o|osit)?\b/i.test(normalized),
    merchant_id: merchant ? merchant[1].toUpperCase().charCodeAt(0) - 64 : null,
    merchant: merchant ? `QP2${merchant[1].toUpperCase()}` : null,
    examples,
  };
}

export function expectedTotal(deposit, rate, maxBonus) {
  if (![deposit, rate].every(Number.isFinite)) return null;
  const uncapped = deposit * rate / 100;
  const bonus = Number.isFinite(maxBonus) ? Math.min(uncapped, maxBonus) : uncapped;
  return round(deposit + bonus);
}

export function scoreCandidate(candidate, facts) {
  let score = 0;
  const evidence = [];
  const contradictions = [];
  const currency = candidate.currencies?.find(c => c.currency === facts.currency)
    || candidate.currencies?.[0] || {};

  if (candidate.status !== 1) contradictions.push('inactive promo');
  if (facts.merchant_id && !candidate.merchant_ids?.includes(facts.merchant_id)) {
    contradictions.push(`not assigned to ${facts.merchant}`);
  }

  if (facts.rate != null && currency.bonus_rate != null) {
    if (near(currency.bonus_rate, facts.rate)) { score += 25; evidence.push(`${facts.rate}% rate matches`); }
    else { score -= 80; contradictions.push(`rate is ${currency.bonus_rate}%, not ${facts.rate}%`); }
  }

  const haystack = `${candidate.code || ''} ${candidate.name || ''} ${candidate.bonus_type || ''}`;
  if (facts.welcome) {
    if (/welc|welcome/i.test(haystack)) { score += 15; evidence.push('welcome promo matches'); }
    else { score -= 30; contradictions.push('not identified as welcome'); }
  }
  if (facts.deposit) {
    if (/dep|deposit/i.test(haystack) || candidate.promo_type === 2) { score += 15; evidence.push('deposit promo matches'); }
    else { score -= 50; contradictions.push('not a deposit promo'); }
  }

  if (facts.category) {
    const categories = candidate.categories || [];
    if (categories.some(c => sameText(c, facts.category))) {
      score += 45; evidence.push(`${facts.category} category matches`);
    } else {
      score -= 120; contradictions.push(`category is ${categories.join('/') || 'unrestricted/unknown'}, not ${facts.category}`);
    }
  }

  for (const example of facts.examples) {
    const minDeposit = currency.min_deposit ?? currency.min_transfer;
    if (Number.isFinite(minDeposit) && example.deposit < minDeposit) {
      score -= 100;
      contradictions.push(`${facts.currency || ''}${example.deposit} is below minimum deposit ${minDeposit}`);
      continue;
    }
    const predicted = expectedTotal(example.deposit, currency.bonus_rate, currency.max_bonus);
    if (near(predicted, example.total)) {
      score += 55; evidence.push(`${example.deposit} → ${example.total} matches`);
    } else {
      score -= 130;
      contradictions.push(`${example.deposit} predicts ${predicted ?? 'unknown'}, not ${example.total}`);
    }
  }

  return { ...candidate, score, evidence, contradictions, matched_currency: currency };
}

export function rankCandidates(candidates, facts) {
  const ranked = candidates.map(c => scoreCandidate(c, facts))
    .sort((a, b) => b.score - a.score || String(a.code).localeCompare(String(b.code)));
  const margin = ranked.length > 1 ? ranked[0].score - ranked[1].score : Infinity;
  return {
    candidates: ranked,
    confidence: ranked[0] && ranked[0].score > 0 && margin >= 30 ? 'HIGH' : 'AMBIGUOUS',
    margin,
  };
}

export function extractTemplateTerms(html, currency = 'MYR') {
  const rows = [...String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => stripHtml(cell[1])))
    .filter(row => row.length);
  const terms = {};
  for (let i = 0; i < rows.length - 1; i++) {
    const headers = rows[i].map(v => v.toLowerCase());
    const values = rows[i + 1];
    for (const [key, labels] of Object.entries({
      min_deposit: ['min deposit', 'minimum deposit'],
      bonus_rate: ['bonus percentage', 'bonus rate'],
      max_bonus: ['max bonus', 'maximum bonus'],
      turnover: ['turnover', 'to requirement'],
    })) {
      const index = headers.findIndex(h => labels.some(label => h.includes(label)));
      if (index >= 0 && values[index] != null) terms[key] ??= firstNumber(values[index]);
    }
  }
  const text = stripHtml(html);
  terms.max_bonus ??= labelledMoney(text, /(?:max(?:imum)?\s+bonus)/i, currency);
  terms.min_deposit ??= labelledMoney(text, /(?:min(?:imum)?\s+deposit)/i, currency);
  terms.bonus_rate ??= labelledSuffixedNumber(text, /(?:bonus\s+(?:percentage|rate))/i, '%');
  // Turnover is only trusted when a table header fixes the value's column.
  // Prose often contains unrelated values such as "deposit RM66 x..." nearby.
  return terms;
}

function labelledMoney(text, label, currency) {
  const match = text.match(new RegExp(`${label.source}[^\\d]{0,40}(?:${currency}|RM)\\s*${NUMBER}`, 'i'));
  return match ? toNumber(match[1]) : null;
}

function labelledSuffixedNumber(text, label, suffix) {
  const escaped = suffix === '%' ? '%' : '[xX]';
  const match = text.match(new RegExp(`${label.source}[^\\d]{0,40}${NUMBER}\\s*${escaped}`, 'i'));
  return match ? toNumber(match[1]) : null;
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function firstNumber(value) {
  const match = String(value).match(/[\d,.]+/);
  return match ? toNumber(match[0]) : null;
}

function toNumber(value) { return Number(String(value).replace(/,/g, '')); }
function near(a, b) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.01; }
function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function sameText(a, b) {
  const canonical = value => String(value).toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');
  return canonical(a) === canonical(b);
}
