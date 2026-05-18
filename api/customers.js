import { customers } from './_lib/catalog.js';
import { authenticateRequest, sendAuthError } from './_lib/auth.js';
import { isDemoMode } from './_lib/env.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (isDemoMode()) {
    response.status(200).json(customers());
    return;
  }

  let user;
  try {
    user = await authenticateRequest(request);
  } catch (error) {
    sendAuthError(response, error);
    return;
  }

  const customer = customers().find((item) => item.id === user.customerId);
  if (!customer) {
    response.status(403).json({ error: 'authenticated customer is not authorized', code: 'unknown_customer' });
    return;
  }

  response.status(200).json([customer]);
}
