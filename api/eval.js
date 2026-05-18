import { evalDiagnostics } from './_lib/catalog.js';
import { isDemoMode } from './_lib/env.js';

export default function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'method not allowed' });
    return;
  }

  if (!isDemoMode()) {
    response.status(403).json({
      error: 'diagnostics are available only in demo mode',
      code: 'diagnostics_disabled',
    });
    return;
  }

  response.status(200).json(evalDiagnostics());
}
