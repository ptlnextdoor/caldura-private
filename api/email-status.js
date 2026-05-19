import { agentMailStatus } from './_lib/agentmail.js';
import { agentMailSettings, emailSettings } from './_lib/env.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'method not allowed' });
    return;
  }

  response.status(200).json(agentMailStatus(agentMailSettings(), emailSettings()));
}
