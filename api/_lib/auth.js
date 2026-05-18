import { webcrypto } from 'node:crypto';

const CACHE_TTL_MS = 5 * 60 * 1000;
let jwksCache = null;

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

export async function authenticateRequest(request) {
  const token = bearerToken(request);
  const payload = await verifyJwt(token);
  const claimName = process.env.AUTH_CUSTOMER_CLAIM || 'customer_id';
  const customerId = payload[claimName];

  if (typeof customerId !== 'string' || !customerId.trim()) {
    throw new AuthError(403, 'missing_customer', 'token is not mapped to a customer');
  }

  return {
    customerId: customerId.trim(),
    claims: payload,
  };
}

export function sendAuthError(response, error) {
  const status = error instanceof AuthError ? error.status : 500;
  const code = error instanceof AuthError ? error.code : 'auth_error';
  const message = status === 500 ? 'authentication is not configured' : error.message;
  response.status(status).json({ error: message, code });
}

function bearerToken(request) {
  const header = headerValue(request, 'authorization');
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match) {
    throw new AuthError(401, 'missing_token', 'authorization bearer token is required');
  }
  return match[1].trim();
}

function headerValue(request, name) {
  if (typeof request.headers?.get === 'function') {
    return request.headers.get(name);
  }
  return request.headers?.[name] ?? request.headers?.[name.toLowerCase()] ?? null;
}

async function verifyJwt(token) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new AuthError(401, 'invalid_token', 'token is malformed');
  }

  const header = parseJsonPart(encodedHeader, 'header');
  const payload = parseJsonPart(encodedPayload, 'payload');
  const allowedAlgs = (process.env.AUTH_ALLOWED_ALGS || 'RS256').split(',').map((item) => item.trim());
  if (!allowedAlgs.includes(header.alg) || header.alg !== 'RS256') {
    throw new AuthError(401, 'invalid_algorithm', 'token algorithm is not allowed');
  }

  validateClaims(payload);

  const key = await jwkForHeader(header);
  const cryptoKey = await webcrypto.subtle.importKey(
    'jwk',
    key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await webcrypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    base64UrlBytes(encodedSignature),
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
  );

  if (!valid) {
    throw new AuthError(401, 'invalid_signature', 'token signature is invalid');
  }

  return payload;
}

function validateClaims(payload) {
  const issuer = requiredEnv('AUTH_ISSUER');
  const audience = requiredEnv('AUTH_AUDIENCE');
  const now = Math.floor(Date.now() / 1000);

  if (payload.iss !== issuer) {
    throw new AuthError(401, 'invalid_issuer', 'token issuer is invalid');
  }
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) {
    throw new AuthError(401, 'invalid_audience', 'token audience is invalid');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new AuthError(401, 'expired_token', 'token is expired');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now) {
    throw new AuthError(401, 'inactive_token', 'token is not active yet');
  }
}

async function jwkForHeader(header) {
  const jwks = await getJwks(false);
  let key = findJwk(jwks, header);
  if (!key) {
    key = findJwk(await getJwks(true), header);
  }
  if (!key) {
    throw new AuthError(401, 'unknown_key', 'token signing key is not recognized');
  }
  return key;
}

function findJwk(jwks, header) {
  return jwks.keys.find((key) => (
    key.kty === 'RSA'
    && (!key.use || key.use === 'sig')
    && (!key.alg || key.alg === header.alg)
    && (!header.kid || key.kid === header.kid)
  ));
}

async function getJwks(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && jwksCache && jwksCache.expiresAt > now) {
    return jwksCache.value;
  }

  const url = requiredEnv('AUTH_JWKS_URL');
  const response = await fetch(url);
  if (!response.ok) {
    throw new AuthError(500, 'jwks_unavailable', 'authentication keys are unavailable');
  }
  const value = await response.json();
  if (!Array.isArray(value.keys)) {
    throw new AuthError(500, 'jwks_invalid', 'authentication keys are invalid');
  }
  jwksCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

function parseJsonPart(part, label) {
  try {
    return JSON.parse(Buffer.from(base64UrlBytes(part)).toString('utf8'));
  } catch {
    throw new AuthError(401, 'invalid_token', `token ${label} is invalid`);
  }
}

function base64UrlBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new AuthError(500, 'auth_not_configured', `${name} is required`);
  }
  return value;
}
