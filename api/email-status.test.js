import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './email-status.js';

test('email status endpoint exposes safe AgentMail and guard status', async () => {
  await withEnv({
    AGENTMAIL_API_KEY: 'secret-value',
    AGENTMAIL_INBOX_ID: 'sales@ptlnextdoor.com',
    AGENTMAIL_WEBHOOK_SECRET: 'whsec_secret',
    EMAIL_MODE: 'live',
    EMAIL_SEND_ENABLED: 'true',
    SALES_REP_EMAIL: 'sales@ptlnextdoor.com',
    EMAIL_RECIPIENT_ALLOWLIST: 'buyer@example.com, other@example.com',
  }, async () => {
    const response = await invoke({ method: 'GET' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.provider, 'agentmail');
    assert.equal(response.body.inbox_id, 'sales@ptlnextdoor.com');
    assert.equal(response.body.api_key_configured, true);
    assert.equal(response.body.webhook_configured, true);
    assert.equal(response.body.email_mode, 'live');
    assert.equal(response.body.send_enabled, true);
    assert.equal(response.body.sales_rep_configured, true);
    assert.equal(response.body.recipient_allowlist_count, 2);
    assert.equal(Object.hasOwn(response.body, 'api_key'), false);
  });
});

async function invoke({ method = 'GET' } = {}) {
  const response = mockResponse();
  await handler({ method }, response);
  return response;
}

function mockResponse() {
  return {
    body: null,
    headers: {},
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

async function withEnv(values, callback) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
