import {
  processAgentMailWebhook,
  readRawBody,
  verifyAgentMailWebhook,
} from './_lib/agentmail.js';
import { agentMailSettings, emailSettings } from './_lib/env.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'method not allowed' });
    return;
  }

  const agentMailConfig = agentMailSettings();
  if (!agentMailConfig.webhook_secret) {
    response.status(503).json({ error: 'AgentMail webhook secret is not configured', code: 'webhook_secret_missing' });
    return;
  }

  const rawBody = await readRawBody(request);
  const signature = verifyAgentMailWebhook(rawBody, request.headers, agentMailConfig.webhook_secret);
  if (!signature.valid) {
    response.status(401).json({ error: 'invalid AgentMail webhook signature', code: signature.reason });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    response.status(400).json({ error: 'invalid webhook JSON', code: 'invalid_json' });
    return;
  }

  try {
    const result = await processAgentMailWebhook(payload, {
      agentMailConfig,
      emailConfig: emailSettings(),
    });
    response.status(200).json(result);
  } catch (error) {
    response.status(502).json({
      error: 'AgentMail webhook processing failed',
      code: 'agentmail_processing_failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
