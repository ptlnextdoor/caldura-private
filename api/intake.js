import { customerSummary, intakeRequest, parseIntakeLines } from './_lib/catalog.js';
import { authenticateRequest, sendAuthError } from './_lib/auth.js';
import { isDemoMode } from './_lib/env.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (isDemoMode()) {
    const rawRequest = String(request.body?.raw_request ?? '').trim();
    if (!rawRequest) {
      response.status(400).json({ error: 'raw_request is required', code: 'raw_request_required' });
      return;
    }
    if (!parseIntakeLines(rawRequest).length) {
      response.status(400).json({ error: 'no line items were detected', code: 'no_line_items' });
      return;
    }

    const usePersonalization = request.body?.use_personalization !== false;
    const customerId = usePersonalization ? normalizedCustomerId(request.body?.customer_id) : null;
    if (customerId && !customerSummary(customerId)) {
      response.status(403).json({ error: 'requested demo customer is not available', code: 'unknown_customer' });
      return;
    }

    response.status(200).json(intakeRequest(rawRequest, customerId));
    return;
  }

  let user;
  try {
    user = await authenticateRequest(request);
  } catch (error) {
    sendAuthError(response, error);
    return;
  }
  if (!customerSummary(user.customerId)) {
    response.status(403).json({ error: 'authenticated customer is not authorized', code: 'unknown_customer' });
    return;
  }

  const rawRequest = String(request.body?.raw_request ?? '').trim();
  if (!rawRequest) {
    response.status(400).json({ error: 'raw_request is required', code: 'raw_request_required' });
    return;
  }
  if (!parseIntakeLines(rawRequest).length) {
    response.status(400).json({ error: 'no line items were detected', code: 'no_line_items' });
    return;
  }

  const usePersonalization = request.body?.use_personalization !== false;
  response.status(200).json(intakeRequest(rawRequest, usePersonalization ? user.customerId : null));
}

function normalizedCustomerId(value) {
  const customerId = String(value ?? '').trim();
  return customerId || null;
}
