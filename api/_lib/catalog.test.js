import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchCatalog } from './catalog.js';

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
  assert.ok(diagnostics.by_attribute_type.some((metric) => (
    metric.key === 'hard-negative' && metric.review_routing_rate === 1
  )));
});
