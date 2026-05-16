import { searchCatalog } from './_lib/catalog.js';

export default function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'method not allowed' });
    return;
  }

  const query = String(request.body?.query ?? '').trim();
  if (!query) {
    response.status(400).json({ error: 'query is required' });
    return;
  }

  response.status(200).json(searchCatalog(query, request.body?.customer_id || null));
}
