const FALSE_CELL = /^\s*(|no|false|n\/a|na|-)\s*$/i;

const unique = (values) => [...new Set(values.filter(Boolean))];

export function parseClaimCadence(...values) {
  const raw = values.map((v) => String(v || '').trim()).filter(Boolean).join('\n');
  if (!raw) return null;
  const oncePerDay = /\b(?:once|1\s*time|one\s*time)\s+per\s+day\b/i.test(raw)
    || /\b(?:daily|each\s+day)\b/i.test(raw);
  const totalMatch = raw.match(/\btotal\s+(?:of\s+)?(\d+)\s+times?\b/i)
    || raw.match(/\bup\s+to\s+(\d+)\s+times?\b/i);
  const daysMatch = raw.match(/\b(\d+)\s*days?\s+(?:journey|campaign|period)\b/i);
  if (!oncePerDay && !totalMatch && !daysMatch) return null;
  return {
    daily_limit: oncePerDay ? 1 : null,
    campaign_total_limit: totalMatch ? Number(totalMatch[1]) : null,
    campaign_days: daysMatch ? Number(daysMatch[1]) : null,
    raw,
  };
}

export function parseBrandScope(raw, requestedBrands = []) {
  const text = String(raw || '').trim();
  if (!text || FALSE_CELL.test(text)) {
    return { enabled: false, required_on: [], prohibited_on: unique(requestedBrands), raw: text || null };
  }
  const scoped = /\bonly\s+(?:need(?:ed)?\s+)?on\s+([^\n]+)/i.exec(text);
  if (!scoped) {
    return { enabled: true, required_on: unique(requestedBrands), prohibited_on: [], raw: text };
  }
  const mentioned = unique(
    [...scoped[1].toUpperCase().matchAll(/\b(?:QP2[A-D]|QPRO\d{1,2}|WS[12](?:-[A-Z]{2})?)\b/g)]
      .map((m) => m[0]),
  );
  return {
    enabled: true,
    required_on: mentioned,
    prohibited_on: unique(requestedBrands).filter((brand) => !mentioned.includes(String(brand).toUpperCase())),
    raw: text,
  };
}

export function buildRequestRequirements(record, { cells = [], colMap = {}, header = [] } = {}) {
  const sourceCells = {};
  for (const [field, index] of Object.entries(colMap)) {
    const raw = String(cells[index] ?? '').trim();
    sourceCells[field] = {
      header: String(header[index] ?? field).trim() || field,
      column_index: index,
      raw,
      populated: raw !== '',
      disposition: raw === '' ? 'blank' : 'mapped',
    };
  }

  const claimCadence = parseClaimCadence(
    record.inbox_message_raw,
    record.popup_dialog_raw,
    record.remark,
    sourceCells.max_per_player?.raw,
    sourceCells.recurring?.raw,
  );
  const dialogScope = parseBrandScope(record.popup_dialog_raw, record.brands);
  const instructionText = [record.inbox_message_raw, record.popup_dialog_raw, record.remark]
    .filter(Boolean).join('\n');
  const unresolved = [];
  if (dialogScope.enabled && /\bonly\s+(?:need(?:ed)?\s+)?on\b/i.test(dialogScope.raw || '') && dialogScope.required_on.length === 0) {
    unresolved.push('popup_dialog scope is explicit but no supported brand code could be parsed');
  }
  const requested = new Set((record.brands || []).map((brand) => String(brand).toUpperCase()));
  const outOfRequest = dialogScope.required_on.filter((brand) => !requested.has(brand));
  if (outOfRequest.length) {
    unresolved.push(`popup_dialog requires brand(s) absent from Brand column: ${outOfRequest.join(', ')}`);
  }

  return {
    schema_version: '2026-07-31.zero-omission-v1',
    source_cells: sourceCells,
    requirements: {
      claim_cadence: claimCadence,
      dialog_scope: dialogScope,
      content_directives: {
        highlight_spin_value: /\bhighlight\s+(?:the\s+)?spin\s+value\b/i.test(instructionText),
      },
      tracker_metadata: {
        testing_purpose_only: /\btesting\s+purpose\s+only\b/i.test(String(record.remark || '')),
      },
    },
    unresolved,
    complete: unresolved.length === 0,
  };
}

export function isBrandAuthorized(scope, brand) {
  if (!scope?.enabled) return false;
  if (!Array.isArray(scope.required_on) || scope.required_on.length === 0) return true;
  return scope.required_on.includes(String(brand || '').toUpperCase());
}
