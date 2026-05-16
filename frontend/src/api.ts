export type AttrSpec = {
  thread_spec: string | null;
  thread_size_normalized: number | null;
  length_mm: number | null;
  length_raw: string | null;
  product_type: string | null;
  material: string | null;
  finish: string | null;
  standard: string | null;
  extraction_confidence: number;
  raw_tokens_unconsumed: string[];
};

export type Customer = {
  id: string;
  name: string;
  order_count: number;
  profile_summary: string;
};

export type SearchResult = {
  rank: number;
  sku: string;
  catalog_id: string;
  description: string;
  active: boolean;
  score: number;
  model_closeness: number;
  confidence: number;
  confidence_label: 'high' | 'medium' | 'low';
  attribute_matches: {
    thread: boolean;
    type: boolean;
    length: boolean;
    material: boolean;
    finish: boolean;
  };
  personalized: boolean;
  personalization_note: string | null;
};

export type SearchDecision = 'ready-to-order' | 'sales-review' | 'guidance-only';

export type RepairContext = {
  detected: boolean;
  id: string;
  category: string;
  title: string;
  status: 'ready' | 'needs-clarification' | 'blocked';
  safety_class: 'low' | 'caution' | 'blocked';
  match_behavior: 'catalog-match' | 'guidance-only';
  stock_status: 'stocked-candidates' | 'not-stocked';
  canonical_query: string | null;
  recommended_part: string | null;
  recommended_tool: string | null;
  fitment_note: string | null;
  confidence: number;
  missing_facts: string[];
  clarifying_question: {
    label: string;
    choices: Array<{ label: string; query_rewrite: string }>;
  } | null;
  kit: Array<{ label: string; quantity: number; note: string }>;
  warnings: string[];
  provenance: 'seeded-demo' | 'inferred' | 'customer-history';
};

export type SearchResponse = {
  query: {
    original: string;
    parsed: AttrSpec;
  };
  results: SearchResult[];
  meta: {
    latency_ms: number;
    candidate_count: number;
    low_confidence_overall: boolean;
    ambiguous_query: boolean;
    ambiguous_suggestions: Array<{ label: string; query_rewrite: string }> | null;
    no_verified_stocked_match: boolean;
    result_message: string | null;
  };
  decision: SearchDecision;
  repair_context: RepairContext | null;
};

export async function fetchCustomers(): Promise<Customer[]> {
  const response = await fetch('/api/customers');
  if (!response.ok) {
    throw new Error('Failed to load customers');
  }
  return response.json();
}

export async function searchCatalog(query: string, customerId?: string): Promise<SearchResponse> {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, customer_id: customerId || null }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'Search failed');
  }
  return response.json();
}
