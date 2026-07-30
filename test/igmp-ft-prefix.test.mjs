import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInstructions } from '../src/ingest.js';
import { buildIgmpPlan } from '../src/api-mapper-igmp.js';
import { applyIgmpFtPrefix, isIgmpRequest, resolveIgmpFtPrefixDecision } from '../src/igmp-ft-prefix.js';

const ws = (overrides = {}) => ({ brands: ['WS1'], platforms: ['igmp'], instructions: {}, promo_code: 'RET_REL_10PCT', ...overrides });

test('positive FT instruction is parsed explicitly', () => {
  const instructions = parseInstructions('Please add FT to code', '', '');
  assert.equal(instructions.ft_prefix_decision, true);
  assert.ok(instructions.code_prefixes.includes('FT'));
});

test('FT needed wording is parsed explicitly', () => {
  const instructions = parseInstructions('FT prefix is needed', '', '');
  assert.equal(instructions.ft_prefix_decision, true);
  assert.ok(instructions.code_prefixes.includes('FT'));
});

test('negative FT instruction is parsed explicitly and does not leak positive prefix', () => {
  const instructions = parseInstructions('Do not add FT to code', '', '');
  assert.equal(instructions.ft_prefix_decision, false);
  assert.ok(!instructions.code_prefixes.includes('FT'));
});

test('short FT not-needed wording is parsed explicitly', () => {
  const instructions = parseInstructions('FT not needed', '', '');
  assert.equal(instructions.ft_prefix_decision, false);
  assert.ok(!instructions.code_prefixes.includes('FT'));
});

test('missing FT answer remains unanswered', () => {
  assert.deepEqual(resolveIgmpFtPrefixDecision(ws()), { decision: null, source: 'unanswered' });
});

test('existing FT code does not replace the required operator answer', () => {
  assert.deepEqual(resolveIgmpFtPrefixDecision(ws({ promo_code: 'FT_RET_REL_10PCT' })), { decision: null, source: 'unanswered' });
});

test('CLI answer overrides source and conflicting flags fail', () => {
  const record = ws({ instructions: { ft_prefix_decision: false } });
  assert.deepEqual(resolveIgmpFtPrefixDecision(record, { forceFt: true }), { decision: true, source: '--ft-prefix' });
  assert.equal(resolveIgmpFtPrefixDecision(record, { forceFt: true, forceNoFt: true }).source, 'conflict');
});

test('gate applies only to IGMP WS1/WS2', () => {
  assert.equal(isIgmpRequest(ws()), true);
  assert.equal(isIgmpRequest({ brands: ['QPRO1'], platforms: ['qpro'] }), false);
});

test('applying an FT answer is idempotent in both directions', () => {
  assert.equal(applyIgmpFtPrefix('RET_REL_10PCT', true), 'FT_RET_REL_10PCT');
  assert.equal(applyIgmpFtPrefix('FT_RET_REL_10PCT', true), 'FT_RET_REL_10PCT');
  assert.equal(applyIgmpFtPrefix('FT_RET_REL_10PCT', false), 'RET_REL_10PCT');
  assert.equal(applyIgmpFtPrefix('RET_REL_10PCT', false), 'RET_REL_10PCT');
});

test('IGMP plan applies the chosen FT answer to the saved promotion code', () => {
  const record = ws({
    bonus_type: 'Free Credit',
    promotion_name_en: 'FT decision regression',
    start_date: '2026-07-21',
    end_date: '2026-07-31',
  });
  assert.equal(buildIgmpPlan(record, { siteId: 'ws1-v3-my', ftPrefix: true }).body.PromotionCode, 'FT_RET_REL_10PCT');
  assert.equal(
    buildIgmpPlan({ ...record, promo_code: 'FT_RET_REL_10PCT' }, { siteId: 'ws1-v3-my', ftPrefix: false }).body.PromotionCode,
    'RET_REL_10PCT',
  );
});
