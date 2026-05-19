import { createHmac, timingSafeEqual } from 'node:crypto';
import { emailPreview } from './email.js';

const PROCESSED_LABEL = 'caldura-processed';
const LABEL_BY_ACTION = {
  DRAFT_CUSTOMER_CONFIRMATION: 'caldura-customer-draft',
  ESCALATE_SALES_REVIEW: 'caldura-sales-review',
  ESCALATE_BLOCKED_REQUEST: 'caldura-blocked-request',
};

export function agentMailStatus(agentMailConfig, emailConfig) {
  return {
    provider: 'agentmail',
    inbox_id: agentMailConfig.inbox_id,
    api_key_configured: Boolean(agentMailConfig.api_key),
    webhook_configured: Boolean(agentMailConfig.webhook_secret),
    email_mode: emailConfig.email_mode,
    send_enabled: emailConfig.send_enabled,
    sales_rep_configured: Boolean(emailConfig.sales_rep_email),
    recipient_allowlist_count: emailConfig.recipient_allowlist.length,
  };
}

export async function processAgentMailWebhook(payload, {
  agentMailConfig,
  emailConfig,
  client = createAgentMailClient(agentMailConfig),
} = {}) {
  if (!agentMailConfig?.api_key) {
    return { status: 'skipped', reason: 'agentmail_api_key_missing' };
  }

  const eventType = payload?.event_type;
  if (!['message.received', 'message.received.unauthenticated'].includes(eventType)) {
    return { status: 'ignored', reason: 'unsupported_event_type', event_type: eventType ?? null };
  }
  const unauthenticated = eventType === 'message.received.unauthenticated';

  const message = payload?.message ?? {};
  const inboxId = message.inbox_id;
  const configuredInbox = agentMailConfig.inbox_id;
  if (inboxId !== configuredInbox) {
    return { status: 'ignored', reason: 'wrong_inbox', inbox_id: inboxId ?? null };
  }

  const messageId = message.message_id;
  if (!messageId) {
    return { status: 'ignored', reason: 'missing_message_id' };
  }

  const labels = Array.isArray(message.labels) ? message.labels : [];
  if (labels.includes(PROCESSED_LABEL)) {
    return { status: 'skipped', reason: 'already_processed', message_id: messageId };
  }

  const hydrated = await hydrateMessageIfNeeded(client, inboxId, message);
  const fromEmail = emailAddress(hydrated.from);
  const subject = String(hydrated.subject ?? '').trim() || '(no subject)';
  const body = messageBody(hydrated);
  if (!fromEmail || !body) {
    await safeUpdateLabels(client, inboxId, messageId, [
      PROCESSED_LABEL,
      'caldura-no-usable-body',
    ]);
    return { status: 'skipped', reason: 'missing_email_or_body', message_id: messageId };
  }

  const preview = emailPreview({
    from_email: fromEmail,
    subject,
    body,
    customer_id: null,
  }, emailConfig);

  const action = preview.recommended_action;
  let agentmail_action = 'none';
  let agentmail_result = null;

  if (action === 'DRAFT_CUSTOMER_CONFIRMATION') {
    if (preview.delivery_guard.can_send_customer_email && !unauthenticated) {
      agentmail_result = await client.replyToMessage(inboxId, messageId, {
        text: preview.customer_confirmation_draft.body,
        html: htmlFromText(preview.customer_confirmation_draft.body),
        labels: ['caldura-auto-response'],
      });
      agentmail_action = 'replied_to_customer';
    } else {
      agentmail_result = await client.createDraft(inboxId, {
        to: [preview.customer_confirmation_draft.to],
        subject: preview.customer_confirmation_draft.subject,
        text: preview.customer_confirmation_draft.body,
        html: htmlFromText(preview.customer_confirmation_draft.body),
        in_reply_to: messageId,
        labels: ['caldura-review-customer-draft'],
        client_id: `caldura-customer-${messageId}`,
      });
      agentmail_action = unauthenticated ? 'created_customer_draft_unauthenticated' : 'created_customer_draft';
    }
  } else if (preview.internal_sales_draft?.to) {
    agentmail_result = await client.createDraft(inboxId, {
      to: [preview.internal_sales_draft.to],
      subject: preview.internal_sales_draft.subject,
      text: preview.internal_sales_draft.body,
      html: htmlFromText(preview.internal_sales_draft.body),
      in_reply_to: messageId,
      labels: ['caldura-internal-review'],
      client_id: `caldura-internal-${messageId}`,
    });
    agentmail_action = 'created_internal_draft';
  }

  await safeUpdateLabels(client, inboxId, messageId, [
    PROCESSED_LABEL,
    `caldura-decision-${preview.intake.overall_validation.decision.toLowerCase().replaceAll('_', '-')}`,
    LABEL_BY_ACTION[action],
    `caldura-agentmail-${agentmail_action}`,
    unauthenticated ? 'caldura-unauthenticated-review' : null,
  ]);

  return {
    status: 'processed',
    message_id: messageId,
    recommended_action: action,
    validation_decision: preview.intake.overall_validation.decision,
    agentmail_action,
    agentmail_result: summarizeAgentMailResult(agentmail_result),
  };
}

export function createAgentMailClient(config) {
  const baseUrl = String(config.base_url ?? 'https://api.agentmail.to/v0').replace(/\/+$/, '');
  const apiKey = config.api_key;

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = data?.error?.message ?? data?.error ?? `AgentMail request failed with ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.response = data;
      throw error;
    }
    return data;
  }

  return {
    getInbox(inboxId) {
      return request(`/inboxes/${encodePath(inboxId)}`);
    },
    getMessage(inboxId, messageId) {
      return request(`/inboxes/${encodePath(inboxId)}/messages/${encodePath(messageId)}`);
    },
    replyToMessage(inboxId, messageId, payload) {
      return request(`/inboxes/${encodePath(inboxId)}/messages/${encodePath(messageId)}/reply`, {
        method: 'POST',
        body: compactObject(payload),
      });
    },
    createDraft(inboxId, payload) {
      return request(`/inboxes/${encodePath(inboxId)}/drafts`, {
        method: 'POST',
        body: compactObject(payload),
      });
    },
    updateMessageLabels(inboxId, messageId, payload) {
      return request(`/inboxes/${encodePath(inboxId)}/messages/${encodePath(messageId)}`, {
        method: 'PATCH',
        body: compactObject(payload),
      });
    },
  };
}

export async function readRawBody(request) {
  if (typeof request.rawBody === 'string') {
    return request.rawBody;
  }
  if (Buffer.isBuffer(request.rawBody)) {
    return request.rawBody.toString('utf8');
  }
  if (request.body && typeof request.body === 'object') {
    return JSON.stringify(request.body);
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function verifyAgentMailWebhook(rawBody, headers, secret, { requireFreshTimestamp = true } = {}) {
  if (!secret) {
    return { valid: false, reason: 'webhook_secret_missing' };
  }

  const id = headerValue(headers, 'svix-id');
  const timestamp = headerValue(headers, 'svix-timestamp');
  const signatureHeader = headerValue(headers, 'svix-signature');
  if (!id || !timestamp || !signatureHeader) {
    return { valid: false, reason: 'signature_headers_missing' };
  }

  if (requireFreshTimestamp) {
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 5 * 60) {
      return { valid: false, reason: 'signature_timestamp_invalid' };
    }
  }

  const key = svixSecretBytes(secret);
  const signedPayload = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', key).update(signedPayload).digest();
  const signatures = signatureHeader.split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.includes(',') ? part.split(',')[1] : part)
    .filter(Boolean);

  const valid = signatures.some((signature) => timingSafeEqualBase64(expected, signature));
  return valid ? { valid: true } : { valid: false, reason: 'signature_invalid' };
}

async function hydrateMessageIfNeeded(client, inboxId, message) {
  if (messageBody(message)) {
    return message;
  }
  return client.getMessage(inboxId, message.message_id);
}

function messageBody(message) {
  return [
    message.extracted_text,
    message.text,
    stripHtml(message.extracted_html ?? message.html),
    message.preview,
  ]
    .map((value) => String(value ?? '').trim())
    .find(Boolean) ?? '';
}

function emailAddress(value) {
  const raw = String(value ?? '').trim();
  const angleMatch = /<([^>]+)>/.exec(raw);
  return (angleMatch?.[1] ?? raw).trim();
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function htmlFromText(text) {
  const escaped = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<div style="font-family: Arial, sans-serif; white-space: pre-wrap; line-height: 1.5;">${escaped}</div>`;
}

async function safeUpdateLabels(client, inboxId, messageId, addLabels) {
  await client.updateMessageLabels(inboxId, messageId, {
    add_labels: addLabels.filter(Boolean),
    remove_labels: ['unread'],
  });
}

function summarizeAgentMailResult(result) {
  if (!result) return null;
  return {
    message_id: result.message_id ?? null,
    thread_id: result.thread_id ?? null,
    draft_id: result.draft_id ?? null,
  };
}

function encodePath(value) {
  return encodeURIComponent(value);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => (
      entry !== undefined
      && entry !== null
      && (!Array.isArray(entry) || entry.length > 0)
      && entry !== ''
    )),
  );
}

function svixSecretBytes(secret) {
  const normalized = String(secret);
  const value = normalized.startsWith('whsec_') ? normalized.slice('whsec_'.length) : normalized;
  try {
    return Buffer.from(value, 'base64');
  } catch {
    return Buffer.from(normalized);
  }
}

function timingSafeEqualBase64(expected, actualBase64) {
  let actual;
  try {
    actual = Buffer.from(actualBase64, 'base64');
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function headerValue(headers, name) {
  if (typeof headers?.get === 'function') {
    return headers.get(name);
  }
  return headers?.[name] ?? headers?.[name.toLowerCase()] ?? null;
}
