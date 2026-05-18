import { customerSummary, parseIntakeLines } from './_lib/catalog.js';
import { emailPreview } from './_lib/email.js';
import { authenticateRequest, sendAuthError } from './_lib/auth.js';
import { emailSettings, isDemoMode } from './_lib/env.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'method not allowed' });
    return;
  }

  const fromEmail = String(request.body?.from_email ?? '').trim();
  if (!fromEmail) {
    response.status(400).json({ error: 'from_email is required', code: 'from_email_required' });
    return;
  }

  const subject = String(request.body?.subject ?? '').trim();
  if (!subject) {
    response.status(400).json({ error: 'subject is required', code: 'subject_required' });
    return;
  }

  const body = String(request.body?.body ?? '').trim();
  if (!body) {
    response.status(400).json({ error: 'body is required', code: 'body_required' });
    return;
  }
  if (!parseIntakeLines(body).length) {
    response.status(400).json({ error: 'no line items were detected', code: 'no_line_items' });
    return;
  }

  if (isDemoMode()) {
    const usePersonalization = request.body?.use_personalization !== false;
    const customerId = usePersonalization ? normalizedCustomerId(request.body?.customer_id) : null;
    if (customerId && !customerSummary(customerId)) {
      response.status(403).json({ error: 'requested demo customer is not available', code: 'unknown_customer' });
      return;
    }

    response.status(200).json(emailPreview({
      from_email: fromEmail,
      subject,
      body,
      customer_id: customerId,
    }, emailSettings()));
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

  const usePersonalization = request.body?.use_personalization !== false;
  response.status(200).json(emailPreview({
    from_email: fromEmail,
    subject,
    body,
    customer_id: usePersonalization ? user.customerId : null,
  }, emailSettings()));
}

function normalizedCustomerId(value) {
  const customerId = String(value ?? '').trim();
  return customerId || null;
}
