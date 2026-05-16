import { customers } from './_lib/catalog.js';

export default function handler(_request, response) {
  response.status(200).json(customers());
}
