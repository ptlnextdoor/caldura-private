import { createServer } from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import customersHandler from '../customers.js';
import evalHandler from '../eval.js';
import intakeHandler from '../intake.js';
import searchHandler from '../search.js';
import { intakeRequest, searchCatalog } from './catalog.js';

const ISSUER = 'https://issuer.example';
const AUDIENCE = 'catalog-api';
let privateKey;
let server;
let jwksUrl;

before(async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = keys.privateKey;
  const publicJwk = keys.publicKey.export({ format: 'jwk' });
  publicJwk.kid = 'test-key';
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';

  server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  jwksUrl = `http://127.0.0.1:${server.address().port}/jwks`;

  process.env.AUTH_ISSUER = ISSUER;
  process.env.AUTH_AUDIENCE = AUDIENCE;
  process.env.AUTH_JWKS_URL = jwksUrl;
  process.env.AUTH_CUSTOMER_CLAIM = 'customer_id';
  process.env.APP_ENV = 'development';
  process.env.DEMO_MODE = 'false';
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('search rejects missing token', async () => {
  const response = await invoke(searchHandler, { body: { query: 'M8 flat washer' } });
  assert.equal(response.statusCode, 401);
});

test('search rejects malformed token', async () => {
  const response = await invoke(searchHandler, {
    token: 'not-a-jwt',
    body: { query: 'M8 flat washer' },
  });
  assert.equal(response.statusCode, 401);
});

test('search rejects wrong audience', async () => {
  const response = await invoke(searchHandler, {
    token: token({ customer_id: 'CUST-001', aud: 'other-api' }),
    body: { query: 'M8 flat washer' },
  });
  assert.equal(response.statusCode, 401);
});

test('search rejects missing customer claim', async () => {
  const response = await invoke(searchHandler, {
    token: token({}),
    body: { query: 'M8 flat washer' },
  });
  assert.equal(response.statusCode, 403);
});

test('search rejects unknown customer claim', async () => {
  const response = await invoke(searchHandler, {
    token: token({ customer_id: 'CUST-999' }),
    body: { query: 'M8 flat washer' },
  });
  assert.equal(response.statusCode, 403);
});

test('search ignores malicious customer_id body and uses authenticated customer', async () => {
  const response = await invoke(searchHandler, {
    token: token({ customer_id: 'CUST-001' }),
    body: {
      query: 'same washers as last time',
      customer_id: 'CUST-002',
      use_personalization: true,
    },
  });

  const expected = searchCatalog('same washers as last time', 'CUST-001').results[0].sku;
  const forbidden = searchCatalog('same washers as last time', 'CUST-002').results[0].sku;
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.results[0].sku, expected);
  assert.notEqual(response.body.results[0].sku, forbidden);
  assert.equal(response.body.results[0].personalized, true);
});

test('intake ignores malicious customer_id body and uses authenticated customer', async () => {
  const rawRequest = '10 pcs same washers as last time';
  const response = await invoke(intakeHandler, {
    token: token({ customer_id: 'CUST-001' }),
    body: {
      raw_request: rawRequest,
      customer_id: 'CUST-002',
      use_personalization: true,
    },
  });

  const expected = intakeRequest(rawRequest, 'CUST-001').lines[0].results[0].sku;
  const forbidden = intakeRequest(rawRequest, 'CUST-002').lines[0].results[0].sku;
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.lines[0].results[0].sku, expected);
  assert.notEqual(response.body.lines[0].results[0].sku, forbidden);
  assert.equal(response.body.lines[0].results[0].personalized, true);
});

test('use_personalization false disables customer history', async () => {
  const response = await invoke(searchHandler, {
    token: token({ customer_id: 'CUST-001' }),
    body: {
      query: 'same washers as last time',
      use_personalization: false,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.results.some((result) => result.personalized), false);
});

test('intake use_personalization false disables customer history', async () => {
  const response = await invoke(intakeHandler, {
    token: token({ customer_id: 'CUST-001' }),
    body: {
      raw_request: 'same washers as last time',
      use_personalization: false,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.lines[0].results.some((result) => result.personalized), false);
});

test('customers returns only authenticated customer', async () => {
  const response = await invoke(customersHandler, {
    method: 'GET',
    token: token({ customer_id: 'CUST-001' }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].id, 'CUST-001');
});

test('demo mode defaults off when DEMO_MODE is unset', async () => {
  await withEnv({ APP_ENV: 'demo', DEMO_MODE: undefined }, async () => {
    const customersResponse = await invoke(customersHandler, { method: 'GET' });
    assert.equal(customersResponse.statusCode, 401);

    const searchResponse = await invoke(searchHandler, {
      body: { query: 'M8 flat washer' },
    });
    assert.equal(searchResponse.statusCode, 401);
  });
});

test('production app env blocks demo mode even when requested', async () => {
  await withEnv({ APP_ENV: 'production', DEMO_MODE: 'true' }, async () => {
    const customersResponse = await invoke(customersHandler, { method: 'GET' });
    assert.equal(customersResponse.statusCode, 401);

    const searchResponse = await invoke(searchHandler, {
      body: { query: 'M8 flat washer', customer_id: 'CUST-001' },
    });
    assert.equal(searchResponse.statusCode, 401);

    const intakeResponse = await invoke(intakeHandler, {
      body: { raw_request: 'M8 flat washer', customer_id: 'CUST-001' },
    });
    assert.equal(intakeResponse.statusCode, 401);

    const evalResponse = await invoke(evalHandler, { method: 'GET' });
    assert.equal(evalResponse.statusCode, 403);
    assert.equal(evalResponse.body.code, 'diagnostics_disabled');
  });
});

test('demo mode returns all customers and uses selected customer without auth', async () => {
  await withEnv({ APP_ENV: 'demo', DEMO_MODE: 'true' }, async () => {
    const customersResponse = await invoke(customersHandler, { method: 'GET' });
    assert.equal(customersResponse.statusCode, 200);
    assert.equal(customersResponse.body.length, 5);

    const searchResponse = await invoke(searchHandler, {
      body: {
        query: 'same washers as last time',
        customer_id: 'CUST-001',
        use_personalization: true,
      },
    });
    assert.equal(searchResponse.statusCode, 200);
    assert.equal(searchResponse.body.results[0].personalized, true);
  });
});

test('demo mode intake uses selected customer and rejects unknown customer', async () => {
  await withEnv({ APP_ENV: 'demo', DEMO_MODE: 'true' }, async () => {
    const response = await invoke(intakeHandler, {
      body: {
        raw_request: 'same washers as last time',
        customer_id: 'CUST-001',
        use_personalization: true,
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.lines[0].results[0].personalized, true);

    const rejected = await invoke(intakeHandler, {
      body: {
        raw_request: 'M8 flat washer',
        customer_id: 'CUST-999',
        use_personalization: true,
      },
    });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.body.code, 'unknown_customer');
  });
});

test('eval endpoint is disabled outside demo mode', async () => {
  const response = await invoke(evalHandler, { method: 'GET' });
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'diagnostics_disabled');
});

test('eval endpoint returns deterministic diagnostics in explicit demo mode', async () => {
  await withEnv({ APP_ENV: 'demo', DEMO_MODE: 'true' }, async () => {
    const response = await invoke(evalHandler, { method: 'GET' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.total_cases, 7);
    assert.equal(response.body.global_accuracy, 1);
  });
});

async function invoke(handler, { method = 'POST', token: bearer, body = {} } = {}) {
  const response = mockResponse();
  await handler({
    method,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    body,
  }, response);
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

function token(overrides) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }));
  const payload = base64Url(JSON.stringify({
    iss: ISSUER,
    aud: AUDIENCE,
    exp: now + 3600,
    ...overrides,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey);
  return `${header}.${payload}.${base64Url(signature)}`;
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64url');
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
