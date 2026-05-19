import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './agentmail-webhook.js';

test('AgentMail webhook route rejects missing secret before processing', async () => {
  await withEnv({ AGENTMAIL_WEBHOOK_SECRET: undefined }, async () => {
    const response = await invoke({
      rawBody: JSON.stringify({ event_type: 'message.received' }),
      headers: {},
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'webhook_secret_missing');
  });
});

test('AgentMail webhook route rejects invalid signature', async () => {
  await withEnv({ AGENTMAIL_WEBHOOK_SECRET: 'whsec_dGVzdC1zZWNyZXQ=' }, async () => {
    const response = await invoke({
      rawBody: JSON.stringify({ event_type: 'message.received' }),
      headers: {
        'svix-id': 'msg_test',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': 'v1,invalid',
      },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.code, 'signature_invalid');
  });
});

async function invoke({ method = 'POST', rawBody, headers }) {
  const response = mockResponse();
  await handler({ method, rawBody, headers }, response);
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
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
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
