import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentMailStatus,
  processAgentMailWebhook,
  verifyAgentMailWebhook,
} from './agentmail.js';

const agentMailConfig = {
  api_key: 'test-key',
  inbox_id: 'sales@ptlnextdoor.com',
  webhook_secret: 'whsec_dGVzdC1zZWNyZXQ=',
  base_url: 'https://api.agentmail.to/v0',
};

test('email status returns safe AgentMail configuration summary', () => {
  const status = agentMailStatus(agentMailConfig, {
    email_mode: 'live',
    send_enabled: true,
    sales_rep_email: 'sales@ptlnextdoor.com',
    recipient_allowlist: ['buyer@example.com'],
  });

  assert.equal(status.provider, 'agentmail');
  assert.equal(status.inbox_id, 'sales@ptlnextdoor.com');
  assert.equal(status.api_key_configured, true);
  assert.equal(status.webhook_configured, true);
  assert.equal(status.sales_rep_configured, true);
  assert.equal(status.recipient_allowlist_count, 1);
  assert.equal(Object.hasOwn(status, 'api_key'), false);
});

test('Svix webhook verification rejects missing and invalid signatures', () => {
  const rawBody = JSON.stringify({ event_type: 'message.received' });
  assert.equal(verifyAgentMailWebhook(rawBody, {}, agentMailConfig.webhook_secret).valid, false);

  const headers = signedHeaders(rawBody, agentMailConfig.webhook_secret);
  assert.equal(verifyAgentMailWebhook(rawBody, headers, agentMailConfig.webhook_secret, { requireFreshTimestamp: false }).valid, true);
  assert.equal(verifyAgentMailWebhook(`${rawBody} `, headers, agentMailConfig.webhook_secret, { requireFreshTimestamp: false }).valid, false);
});

test('webhook ignores messages for another inbox and skips already processed messages', async () => {
  const wrongInbox = await processAgentMailWebhook({
    event_type: 'message.received',
    message: { inbox_id: 'other@example.com', message_id: 'msg_1' },
  }, {
    agentMailConfig,
    emailConfig: previewEmailConfig(),
    client: mockClient(),
  });
  assert.equal(wrongInbox.status, 'ignored');
  assert.equal(wrongInbox.reason, 'wrong_inbox');

  const processed = await processAgentMailWebhook({
    event_type: 'message.received',
    message: {
      inbox_id: 'sales@ptlnextdoor.com',
      message_id: 'msg_1',
      labels: ['caldura-processed'],
    },
  }, {
    agentMailConfig,
    emailConfig: previewEmailConfig(),
    client: mockClient(),
  });
  assert.equal(processed.status, 'skipped');
  assert.equal(processed.reason, 'already_processed');
});

test('AUTO_RESPOND webhook sends a customer reply only when guard allows it', async () => {
  const client = mockClient();
  const result = await processAgentMailWebhook(autoPayload(), {
    agentMailConfig,
    emailConfig: {
      email_mode: 'live',
      send_enabled: true,
      sales_rep_email: 'sales@ptlnextdoor.com',
      recipient_allowlist: ['buyer@example.com'],
    },
    client,
  });

  assert.equal(result.status, 'processed');
  assert.equal(result.recommended_action, 'DRAFT_CUSTOMER_CONFIRMATION');
  assert.equal(result.agentmail_action, 'replied_to_customer');
  assert.equal(client.calls.reply.length, 1);
  assert.equal(client.calls.draft.length, 0);
  assert.equal(client.calls.update[0].payload.add_labels.includes('caldura-processed'), true);
});

test('AUTO_RESPOND webhook creates customer draft when live send is blocked', async () => {
  const client = mockClient();
  const result = await processAgentMailWebhook(autoPayload(), {
    agentMailConfig,
    emailConfig: previewEmailConfig(),
    client,
  });

  assert.equal(result.status, 'processed');
  assert.equal(result.agentmail_action, 'created_customer_draft');
  assert.equal(client.calls.reply.length, 0);
  assert.equal(client.calls.draft.length, 1);
  assert.equal(client.calls.draft[0].payload.to[0], 'buyer@example.com');
  assert.match(client.calls.draft[0].payload.subject, /^Re:/);
});

test('SALES_REVIEW webhook creates internal sales draft', async () => {
  const client = mockClient();
  const result = await processAgentMailWebhook({
    event_type: 'message.received',
    message: {
      inbox_id: 'sales@ptlnextdoor.com',
      message_id: 'msg_review',
      from: 'Buyer <buyer@example.com>',
      subject: 'Need washers',
      text: '25 M8 steel flat washer',
      labels: [],
    },
  }, {
    agentMailConfig,
    emailConfig: previewEmailConfig(),
    client,
  });

  assert.equal(result.status, 'processed');
  assert.equal(result.recommended_action, 'ESCALATE_SALES_REVIEW');
  assert.equal(result.agentmail_action, 'created_internal_draft');
  assert.equal(client.calls.draft.length, 1);
  assert.equal(client.calls.draft[0].payload.to[0], 'sales@ptlnextdoor.com');
  assert.match(client.calls.draft[0].payload.subject, /Sales review needed/);
});

test('DO_NOT_RESPOND webhook creates internal blocker draft', async () => {
  const client = mockClient();
  const result = await processAgentMailWebhook({
    event_type: 'message.received',
    message: {
      inbox_id: 'sales@ptlnextdoor.com',
      message_id: 'msg_blocked',
      from: 'buyer@example.com',
      subject: 'Need repair screws',
      text: 'screws for bottom of MacBook Pro',
      labels: [],
    },
  }, {
    agentMailConfig,
    emailConfig: previewEmailConfig(),
    client,
  });

  assert.equal(result.status, 'processed');
  assert.equal(result.recommended_action, 'ESCALATE_BLOCKED_REQUEST');
  assert.equal(result.agentmail_action, 'created_internal_draft');
  assert.match(client.calls.draft[0].payload.subject, /Blocked request/);
});

test('unauthenticated message never sends live customer reply', async () => {
  const client = mockClient();
  const result = await processAgentMailWebhook({
    ...autoPayload(),
    event_type: 'message.received.unauthenticated',
  }, {
    agentMailConfig,
    emailConfig: {
      email_mode: 'live',
      send_enabled: true,
      sales_rep_email: 'sales@ptlnextdoor.com',
      recipient_allowlist: ['buyer@example.com'],
    },
    client,
  });

  assert.equal(result.status, 'processed');
  assert.equal(result.agentmail_action, 'created_customer_draft_unauthenticated');
  assert.equal(client.calls.reply.length, 0);
  assert.equal(client.calls.draft.length, 1);
  assert.equal(client.calls.update[0].payload.add_labels.includes('caldura-unauthenticated-review'), true);
});

function autoPayload() {
  return {
    event_type: 'message.received',
    message: {
      inbox_id: 'sales@ptlnextdoor.com',
      message_id: 'msg_auto',
      from: 'Buyer <buyer@example.com>',
      subject: 'Need cap screws',
      text: '10 pcs 1/4-20 x 3/4 hex cap screw zinc',
      labels: [],
    },
  };
}

function previewEmailConfig() {
  return {
    email_mode: 'preview',
    send_enabled: false,
    sales_rep_email: 'sales@ptlnextdoor.com',
    recipient_allowlist: [],
  };
}

function mockClient() {
  const calls = {
    get: [],
    reply: [],
    draft: [],
    update: [],
  };
  return {
    calls,
    async getMessage(inboxId, messageId) {
      calls.get.push({ inboxId, messageId });
      return {
        inbox_id: inboxId,
        message_id: messageId,
        from: 'buyer@example.com',
        subject: 'Hydrated',
        text: '10 pcs 1/4-20 x 3/4 hex cap screw zinc',
        labels: [],
      };
    },
    async replyToMessage(inboxId, messageId, payload) {
      calls.reply.push({ inboxId, messageId, payload });
      return { message_id: 'sent_msg', thread_id: 'thread_1' };
    },
    async createDraft(inboxId, payload) {
      calls.draft.push({ inboxId, payload });
      return { draft_id: `draft_${calls.draft.length}`, inbox_id: inboxId };
    },
    async updateMessageLabels(inboxId, messageId, payload) {
      calls.update.push({ inboxId, messageId, payload });
      return { message_id: messageId, labels: payload.add_labels };
    },
  };
}

function signedHeaders(rawBody, secret) {
  const id = 'msg_test';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  };
}
