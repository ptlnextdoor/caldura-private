import { getData } from './_lib/catalog.js';

export default function handler(_request, response) {
  const started = performance.now();
  const { catalog } = getData();
  response.status(200).json({
    status: 'ok',
    catalog_size: catalog.length,
    boot_time_ms: Math.round((performance.now() - started) * 10) / 10,
  });
}
