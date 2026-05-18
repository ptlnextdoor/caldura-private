import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { intakeRequest, parseIntakeLines, searchCatalog } from './catalog.js';

const hardNegativeCases = JSON.parse(readFileSync(new URL('../../data/hard_negative_cases.json', import.meta.url), 'utf8'));
const goldenCases = JSON.parse(readFileSync(new URL('../../data/demo_golden_cases.json', import.meta.url), 'utf8'));

test('hard negative cases are wired into API safety tests', () => {
  for (const item of hardNegativeCases) {
    const response = searchCatalog(item.query, item.customer_id ?? null);
    if (item.expected_decision) {
      assert.equal(response.decision, item.expected_decision, `decision mismatch for ${item.query}`);
    }
    if (item.must_parse_thread_as) {
      assert.equal(response.query.parsed.thread_spec, item.must_parse_thread_as, `thread parse mismatch for ${item.query}`);
    }
    if (item.expected_review_reason) {
      assert.ok(
        response.results.some((result) => result.review_reasons.includes(item.expected_review_reason)),
        `missing review reason ${item.expected_review_reason} for ${item.query}`,
      );
    }
    if (item.expected_evidence) {
      assert.ok(
        response.results.some((result) => result.match_evidence.includes(item.expected_evidence)),
        `missing evidence ${item.expected_evidence} for ${item.query}`,
      );
    }
    if (item.must_not_auto_order_if_top_contains && response.results[0]) {
      const topDescription = response.results[0].description.toLowerCase();
      const matchedRisk = item.must_not_auto_order_if_top_contains.some((pattern) => (
        topDescription.includes(pattern.toLowerCase())
      ));
      if (matchedRisk) {
        assert.equal(response.results[0].can_auto_order, false, `unsafe auto-order for ${item.query}`);
      }
    }
    if (item.query === 'M8 steel flat washer') {
      assert.equal(response.decision, 'sales-review');
      assert.equal(response.validation.decision, 'SALES_REVIEW');
      assert.equal(response.results[0].can_auto_order, false);
      assert.ok(response.results[0].confidence < 0.90);
    }
  }
});

test('golden cases lock JS matcher outputs for Rust parity', () => {
  for (const item of goldenCases) {
    const response = searchCatalog(item.query, item.customer_id ?? null);
    assert.deepEqual(response.results.map((result) => result.sku), item.top3, `top3 mismatch for ${item.query}`);
    assert.equal(response.decision, item.decision, `decision mismatch for ${item.query}`);
    assert.equal(response.validation.decision, item.validation_decision, `validation mismatch for ${item.query}`);
    assert.equal(Boolean(response.results[0]?.can_auto_order), item.top_can_auto_order, `auto-order mismatch for ${item.query}`);
    assert.equal(response.validation.customer_history_influenced, item.customer_history_influenced, `history influence mismatch for ${item.query}`);
    assert.equal(
      response.customer_preferences.some((preference) => preference.applied_to_query),
      item.expected_preference_applied,
      `preference application mismatch for ${item.query}`,
    );
  }
});

test('demo queries keep stable top three across repeated calls', () => {
  const queries = [
    ['washer', null],
    ['bolt', null],
    ['same washers as last time', 'CUST-001'],
    ['M8 flat washer', null],
    ['M8 steel flat washer', null],
  ];

  for (const [query, customerId] of queries) {
    const expected = searchCatalog(query, customerId).results.map((result) => result.sku);
    for (let i = 0; i < 25; i += 1) {
      assert.deepEqual(
        searchCatalog(query, customerId).results.map((result) => result.sku),
        expected,
        `top3 drifted for ${query}`,
      );
    }
  }
});

test('validation and preferences cover Kasyap scenarios', () => {
  const omitted = searchCatalog('1/4-20 hex cap screw', 'CUST-001');
  assert.equal(omitted.validation.decision, 'AUTO_RESPOND');
  assert.equal(omitted.validation.customer_history_influenced, true);
  assert.ok(omitted.customer_preferences.some((preference) => (
    preference.scope === 'product_family:hex-cap-screw'
    && preference.attribute === 'finish'
    && preference.value === 'zinc'
    && preference.applied_to_query
  )));

  const explicit = searchCatalog('1/4-20 black oxide hex cap screw', 'CUST-001');
  assert.equal(explicit.validation.decision, 'AUTO_RESPOND');
  assert.ok(explicit.customer_preferences.some((preference) => (
    preference.scope === 'product_family:hex-cap-screw'
    && preference.attribute === 'finish'
    && preference.value === 'zinc'
    && !preference.applied_to_query
  )));

  const sparse = searchCatalog('M8 flat washer', null);
  assert.equal(sparse.validation.customer_history_influenced, false);
  assert.equal(sparse.customer_preferences.length, 0);
});

test('eval diagnostics group customer and attribute metrics', async () => {
  const { evalDiagnostics } = await import('./catalog.js');
  const diagnostics = evalDiagnostics();
  assert.equal(diagnostics.total_cases, 7);
  assert.equal(diagnostics.global_accuracy, 1);
  assert.ok(diagnostics.review_routing_rate > 0);
  assert.ok(diagnostics.by_customer.some((metric) => metric.key === 'CUST-001'));
  assert.ok(diagnostics.customer_health.some((metric) => (
    metric.key === 'CUST-001' && Array.isArray(metric.top_review_reasons)
  )));
  assert.ok(diagnostics.by_attribute_type.some((metric) => (
    metric.key === 'hard-negative' && metric.review_routing_rate === 1
  )));
});

test('intake parser splits lines, strips list markers, and ignores meta lines', () => {
  const lines = parseIntakeLines(`
Customer email:
Hey, can you get me:
- 10 pcs 3/4-10 hex cap screws
2. qty 25 M8 flat washers
Need zinc if possible
same washers as last time
`);

  assert.deepEqual(lines.map((line) => line.normalized_query), [
    '3/4-10 hex cap screws',
    'M8 flat washers',
    'zinc if possible',
    'same washers as last time',
  ]);
  assert.deepEqual(lines.map((line) => line.quantity), [10, 25, null, null]);
  assert.deepEqual(lines.map((line) => line.unit), ['pcs', null, null, null]);
});

test('intake parser strips natural customer openers before classification', () => {
  const cases = [
    ['Can you get me M8 flat washers', 'M8 flat washers', null, null],
    ['Please quote M8 flat washers', 'M8 flat washers', null, null],
    ['Hey M8 flat washers', 'M8 flat washers', null, null],
    ['Hi, can you get me 10 pcs 3/4-10 hex head cap screws', '3/4-10 hex head cap screws', 10, 'pcs'],
    ['Need 25 M8 flat washers', 'M8 flat washers', 25, null],
    ['Looking for M8 x 50mm BHCS', 'M8 x 50mm BHCS', null, null],
  ];

  for (const [raw, normalized, quantity, unit] of cases) {
    const lines = parseIntakeLines(raw);
    assert.equal(lines.length, 1, `line count mismatch for ${raw}`);
    assert.equal(lines[0].normalized_query, normalized, `query mismatch for ${raw}`);
    assert.equal(lines[0].quantity, quantity, `quantity mismatch for ${raw}`);
    assert.equal(lines[0].unit, unit, `unit mismatch for ${raw}`);
  }

  assert.equal(parseIntakeLines('Thanks').length, 0);
  assert.equal(parseIntakeLines('Please send quote').length, 0);
  assert.equal(parseIntakeLines('Hi').length, 0);
  assert.equal(parseIntakeLines('Can you help?').length, 0);
  assert.equal(parseIntakeLines('Let me know').length, 0);
});

test('intake parser extracts supported quantity formats', () => {
  const lines = [
    ['qty 10 M8 flat washers', 10, null, 'M8 flat washers'],
    ['10 pieces M8 flat washers', 10, 'pcs', 'M8 flat washers'],
    ['10 ea M8 flat washers', 10, 'ea', 'M8 flat washers'],
    ['x10 M8 flat washers', 10, null, 'M8 flat washers'],
    ['M8 flat washers 10x', 10, null, 'M8 flat washers'],
    ['25 M8 flat washers', 25, null, 'M8 flat washers'],
  ];

  for (const [raw, quantity, unit, normalized] of lines) {
    const [line] = parseIntakeLines(raw);
    assert.equal(line.quantity, quantity, `quantity mismatch for ${raw}`);
    assert.equal(line.unit, unit, `unit mismatch for ${raw}`);
    assert.equal(line.normalized_query, normalized, `query mismatch for ${raw}`);
  }
});

test('intake request runs matcher per line and aggregates validation', () => {
  const response = intakeRequest(`
10 pcs 1/4-20 x 3/4 hex cap screw zinc
25 M8 steel flat washer
screws for bottom of MacBook Pro
`, 'CUST-001');

  assert.equal(response.lines.length, 3);
  assert.equal(response.lines[0].validation.decision, 'AUTO_RESPOND');
  assert.equal(response.lines[1].validation.decision, 'SALES_REVIEW');
  assert.equal(response.lines[2].validation.decision, 'DO_NOT_RESPOND');
  assert.equal(response.overall_validation.decision, 'DO_NOT_RESPOND');
  assert.equal(response.summary.auto_respond_count, 1);
  assert.equal(response.summary.sales_review_count, 1);
  assert.equal(response.summary.do_not_respond_count, 1);
  assert.equal(response.lines[0].results.length, 3);
});

test('intake request helper returns do-not-respond when no lines are parsed', () => {
  const response = intakeRequest('Thanks', 'CUST-001');
  assert.equal(response.lines.length, 0);
  assert.equal(response.overall_validation.decision, 'DO_NOT_RESPOND');
  assert.equal(response.summary.line_count, 0);
  assert.equal(response.summary.auto_respond_count, 0);
  assert.equal(response.summary.sales_review_count, 0);
  assert.equal(response.summary.do_not_respond_count, 0);
});

test('intake demo cases cover exact, abbreviation, preference, explicit wins, hard negative, and repair guidance', () => {
  const response = intakeRequest(`
5 pcs 1/4-20 x 3/4 hex cap screw zinc
SHCS 7/16 x 2-1/2
1/4-20 hex cap screw
1/4-20 black oxide hex cap screw
M8 steel flat washer
screws for bottom of MacBook Pro
`, 'CUST-001');

  assert.equal(response.lines.length, 6);
  assert.equal(response.lines[0].validation.decision, 'AUTO_RESPOND');
  assert.equal(response.lines[1].validation.decision, 'AUTO_RESPOND');
  assert.equal(response.lines[2].validation.customer_history_influenced, true);
  assert.equal(response.lines[3].validation.decision, 'AUTO_RESPOND');
  assert.equal(response.lines[4].validation.decision, 'SALES_REVIEW');
  assert.equal(response.lines[5].validation.decision, 'DO_NOT_RESPOND');
});
