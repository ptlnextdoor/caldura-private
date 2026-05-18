import { isDemoMode } from './env';

const DEMO_SPA_401_HINT =
  'API returned 401 while the SPA is in demo mode. Start catalog-server from the repository root with DEMO_MODE=true and APP_ENV=demo (same root `.env` as Vite reads), then restart.';

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

export type ValidationDecision = 'AUTO_RESPOND' | 'SALES_REVIEW' | 'DO_NOT_RESPOND';

export type Validation = {
  decision: ValidationDecision;
  reason: string;
  missing_risky_attributes: string[];
  customer_history_influenced: boolean;
  internal_note: string;
};

export type CustomerPreference = {
  scope: string;
  attribute: string;
  value: string;
  evidence_count: number;
  total_count: number;
  confidence: number;
  applied_to_query: boolean;
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
  match_evidence: string[];
  review_reasons: string[];
  contradictions: Array<{
    field: string;
    query_value: string;
    result_value: string;
    severity: 'hard' | 'soft';
  }>;
  can_auto_order: boolean;
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
  validation: Validation;
  customer_preferences: CustomerPreference[];
  repair_context: RepairContext | null;
};

export type EvalMetric = {
  key: string;
  accuracy: number;
  auto_response_rate: number;
  review_routing_rate: number;
  do_not_respond_rate: number;
  cases: number;
  top_review_reasons: Array<{
    reason: string;
    count: number;
  }>;
};

export type EvalDiagnostics = {
  global_accuracy: number;
  review_routing_rate: number;
  total_cases: number;
  by_customer: EvalMetric[];
  by_product_family: EvalMetric[];
  by_attribute_type: EvalMetric[];
  customer_health: EvalMetric[];
};

export type IntakeLine = {
  line_number: number;
  raw_line: string;
  normalized_query: string;
  quantity: number | null;
  unit: string | null;
  parsed_query: AttrSpec;
  results: SearchResult[];
  decision: SearchDecision;
  validation: Validation;
  customer_preferences: CustomerPreference[];
  repair_context: RepairContext | null;
};

export type IntakeResponse = {
  customer_id: string | null;
  raw_request: string;
  lines: IntakeLine[];
  overall_validation: Validation;
  summary: {
    line_count: number;
    auto_respond_count: number;
    sales_review_count: number;
    do_not_respond_count: number;
    latency_ms: number;
  };
};

function authHeaders(accessToken?: string | null): Record<string, string> {
  return accessToken
    ? {
        Authorization: `Bearer ${accessToken}`,
      }
    : {};
}

export async function fetchCustomers(accessToken?: string | null): Promise<Customer[]> {
  const response = await fetch('/api/customers', {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) {
    if (response.status === 401 && isDemoMode()) {
      throw new Error(DEMO_SPA_401_HINT);
    }
    throw new Error('Failed to load customers');
  }
  return response.json();
}

export async function searchCatalog(
  query: string,
  options: { accessToken?: string | null; usePersonalization?: boolean; customerId?: string | null },
): Promise<SearchResponse> {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(options.accessToken) },
    body: JSON.stringify({
      query,
      use_personalization: options.usePersonalization ?? true,
      customer_id: options.customerId ?? undefined,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && isDemoMode()) {
      throw new Error(DEMO_SPA_401_HINT);
    }
    throw new Error(body.error ?? 'Search failed');
  }
  return response.json();
}

export async function intakeRequest(
  rawRequest: string,
  options: { accessToken?: string | null; usePersonalization?: boolean; customerId?: string | null },
): Promise<IntakeResponse> {
  const response = await fetch('/api/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(options.accessToken) },
    body: JSON.stringify({
      raw_request: rawRequest,
      use_personalization: options.usePersonalization ?? true,
      customer_id: options.customerId ?? undefined,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && isDemoMode()) {
      throw new Error(DEMO_SPA_401_HINT);
    }
    throw new Error(body.error ?? 'Request intake failed');
  }
  return response.json();
}

export async function fetchEvalDiagnostics(): Promise<EvalDiagnostics> {
  const response = await fetch('/api/eval');
  if (!response.ok) {
    if (response.status === 401 && isDemoMode()) {
      throw new Error(DEMO_SPA_401_HINT);
    }
    throw new Error('Failed to load evaluation diagnostics');
  }
  return response.json();
}
