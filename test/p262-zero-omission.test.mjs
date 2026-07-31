import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRequestRequirements,
  isBrandAuthorized,
  parseBrandScope,
  parseClaimCadence,
} from '../src/request-requirements.js';

test('P262 claim cadence preserves daily and campaign-total limits', () => {
  const cadence = parseClaimCadence(
    "T&C need to ensure players know they can claim 1 time per day, so total 3 times per campaign since it's 3 days journey",
  );
  assert.deepEqual(
    {
      daily_limit: cadence.daily_limit,
      campaign_total_limit: cadence.campaign_total_limit,
      campaign_days: cadence.campaign_days,
    },
    { daily_limit: 1, campaign_total_limit: 3, campaign_days: 3 },
  );
});

test('P262 dialog scope authorizes only named brands', () => {
  const scope = parseBrandScope('Only need on QP2A, QP2D', ['WS1', 'QP2A', 'QPRO6']);
  assert.deepEqual(scope.required_on, ['QP2A', 'QP2D']);
  assert.deepEqual(scope.prohibited_on, ['WS1', 'QPRO6']);
  assert.equal(isBrandAuthorized(scope, 'QP2A'), true);
  assert.equal(isBrandAuthorized(scope, 'QPRO6'), false);
});

test('coverage blocks popup brands absent from the Brand column', () => {
  const record = {
    brands: ['WS1', 'QP2A', 'QPRO6'],
    popup_dialog_raw: 'Only need on QP2A, QP2D',
    inbox_message_raw: 'Claim 1 time per day, total 3 times per campaign. Highlight the spin value.',
    remark: 'Testing Purpose only',
  };
  const manifest = buildRequestRequirements(record);
  assert.equal(manifest.complete, false);
  assert.match(manifest.unresolved.join('\n'), /QP2D/);
  assert.equal(manifest.requirements.content_directives.highlight_spin_value, true);
  assert.equal(manifest.requirements.tracker_metadata.testing_purpose_only, true);
});
