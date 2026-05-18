import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailPreview } from './email.js';

test('AUTO_RESPOND returns only customer confirmation draft', () => {
  const response = emailPreview({
    from_email: 'buyer@example.com',
    subject: 'Need cap screws',
    body: '10 pcs 1/4-20 x 3/4 hex cap screw zinc',
    customer_id: 'CUST-001',
  });

  assert.equal(response.recommended_action, 'DRAFT_CUSTOMER_CONFIRMATION');
  assert.ok(response.customer_confirmation_draft);
  assert.equal(response.customer_confirmation_draft?.to, 'buyer@example.com');
  assert.equal(response.internal_sales_draft, null);
});

test('SALES_REVIEW returns only internal sales draft', () => {
  const response = emailPreview({
    from_email: 'buyer@example.com',
    subject: 'Need washers',
    body: '25 M8 steel flat washer',
    customer_id: 'CUST-001',
  }, {
    sales_rep_email: 'sales@example.com',
  });

  assert.equal(response.recommended_action, 'ESCALATE_SALES_REVIEW');
  assert.equal(response.customer_confirmation_draft, null);
  assert.ok(response.internal_sales_draft);
  assert.equal(response.internal_sales_draft?.to, 'sales@example.com');
  assert.match(response.internal_sales_draft?.body ?? '', /sales review/i);
});

test('DO_NOT_RESPOND returns only internal blocker draft', () => {
  const response = emailPreview({
    from_email: 'buyer@example.com',
    subject: 'Need repair screws',
    body: 'screws for bottom of MacBook Pro',
    customer_id: 'CUST-001',
  });

  assert.equal(response.recommended_action, 'ESCALATE_BLOCKED_REQUEST');
  assert.equal(response.customer_confirmation_draft, null);
  assert.ok(response.internal_sales_draft);
  assert.match(response.internal_sales_draft?.subject ?? '', /Blocked request/i);
});

test('preview defaults block live send', () => {
  const response = emailPreview({
    from_email: 'buyer@example.com',
    subject: 'Need cap screws',
    body: '10 pcs 1/4-20 x 3/4 hex cap screw zinc',
  });

  assert.equal(response.delivery_guard.email_mode, 'preview');
  assert.equal(response.delivery_guard.send_enabled, false);
  assert.equal(response.delivery_guard.can_send_customer_email, false);
  assert.ok(response.delivery_guard.blocked_reasons.includes('EMAIL_MODE is not live.'));
  assert.ok(response.delivery_guard.blocked_reasons.includes('EMAIL_SEND_ENABLED is false.'));
});

test('allowlist blocks unknown recipients even when live mode is enabled', () => {
  const blocked = emailPreview({
    from_email: 'buyer@example.com',
    subject: 'Need cap screws',
    body: '10 pcs 1/4-20 x 3/4 hex cap screw zinc',
  }, {
    email_mode: 'live',
    send_enabled: true,
    recipient_allowlist: ['allowed@example.com'],
  });

  assert.equal(blocked.delivery_guard.recipient_allowlisted, false);
  assert.equal(blocked.delivery_guard.can_send_customer_email, false);
  assert.ok(blocked.delivery_guard.blocked_reasons.includes('Recipient is not in EMAIL_RECIPIENT_ALLOWLIST.'));

  const allowed = emailPreview({
    from_email: 'allowed@example.com',
    subject: 'Need cap screws',
    body: '10 pcs 1/4-20 x 3/4 hex cap screw zinc',
  }, {
    email_mode: 'live',
    send_enabled: true,
    recipient_allowlist: ['allowed@example.com'],
  });

  assert.equal(allowed.delivery_guard.recipient_allowlisted, true);
  assert.equal(allowed.delivery_guard.can_send_customer_email, true);
  assert.deepEqual(allowed.delivery_guard.blocked_reasons, []);
});
