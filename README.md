# Caldura Sales Request Intake

Risk-controlled sales request intake engine for a 1000-row fastener/MRO catalog. A salesperson or automation layer pastes a customer request or RFQ, the app extracts line items, maps each line to top SKU candidates, and a validation gate decides whether the system can auto-respond, should route internally to sales review, or should not respond with a stocked SKU.

The core flow is:

```text
customer request/email -> line items -> SKU candidates -> validation gate -> auto-response or sales review
```

The demo also includes a preview-only email workflow:

```text
inbound customer email -> intake matcher -> validation gate -> customer confirmation draft or internal sales escalation draft
```

Raw match accuracy is not enough. The system optimizes effective shipped accuracy by routing uncertain cases to humans before a wrong response reaches the buyer.

The demo also includes a seeded repair-context layer for queries where users know the job, not the fastener name. Example repair queries:

- `screws for bottom of MacBook Pro`
- `bike bottle cage bolts stainless`
- `boat hatch screws rusted from saltwater`
- `IKEA missing bed frame bolts`
- `same screws we used for pump guard`

Most repair contexts translate to canonical catalog queries, expose missing facts and warnings, and still use the same top-three matcher underneath. Proprietary/model-specific contexts can be marked guidance-only; for example, MacBook bottom-case requests show Apple pentalobe screw-set guidance and no stocked generic catalog result.

## Run Locally

### First run (seeded demo)

1. Copy [.env.example](.env.example) to **`.env` in the repository root** (same directory as `Cargo.toml`). `catalog-server` loads that file via `dotenvy` when you `cargo run` from the root. Vite reads the repo-root env and also merges `frontend/.env*` for SPA-only local overrides.
2. For a local demo without OIDC, set at least:

```env
APP_ENV=demo
DEMO_MODE=true
VITE_DEMO_MODE=true
EMAIL_MODE=preview
EMAIL_SEND_ENABLED=false
```

3. Start the API, then the SPA (see below).

`DEMO_MODE=true` alone only enables backend demo behavior. The SPA needs `VITE_DEMO_MODE=true` at Vite startup; restart `npm run dev` after changing any `.env` file.

### Backend and frontend dev servers

Backend:

```bash
cargo run -p catalog-server
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The Vite dev server proxies `/api/*` to the Rust server on `127.0.0.1:8080`.

Auth-bound mode is the secure default (`DEMO_MODE=false`, `VITE_DEMO_MODE=false`). In this mode both API implementations require an OIDC/JWT bearer token for `/search` and `/customers`. Configure `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, and `AUTH_CUSTOMER_CLAIM` on the API side. Configure `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, and `VITE_OIDC_REDIRECT_URI` for the SPA.

For local or public demo mode, set `APP_ENV=demo`, `DEMO_MODE=true`, and `VITE_DEMO_MODE=true`. In this explicit mode, no OIDC setup is required: `/customers` returns the seeded demo customer directory and `/search` accepts an optional `customer_id` from the searchable dropdown. Production environments must use `APP_ENV=production`, `DEMO_MODE=false`, and `VITE_DEMO_MODE=false`; `APP_ENV=production` blocks demo mode even if `DEMO_MODE=true` is accidentally set.

Vercel demo deployments should use:

```env
APP_ENV=demo
DEMO_MODE=true
VITE_DEMO_MODE=true
```

Real customer or production deployments should use:

```env
APP_ENV=production
DEMO_MODE=false
VITE_DEMO_MODE=false
```

`NODE_ENV=production` is expected on Vercel builds and does not control demo access. `APP_ENV` is the app-level deployment guard: use `APP_ENV=demo` for the public seeded demo and `APP_ENV=production` for customer/auth-bound environments.

## API

Primary API routes use the `/api` prefix in the Vercel/frontend path. The Rust server also exposes unprefixed aliases for local direct calls.

`POST /api/intake`

```json
{
  "raw_request": "10 pcs 1/4-20 hex cap screw zinc\n25 M8 steel flat washers",
  "use_personalization": true,
  "customer_id": "CUST-001"
}
```

Returns extracted lines, quantity/unit when detected, top-three SKU candidates per line, per-line validation, and an overall request validation. The parser is deterministic and line-oriented; it does not use an LLM, dense retrieval, Mamba, or a vector database.

`POST /api/email-preview`

```json
{
  "from_email": "contractor@example.com",
  "subject": "Need fasteners",
  "body": "10 pcs 3/4-10 hex head cap screws\n25 M8 flat washers\nsame washers as last time",
  "use_personalization": true,
  "customer_id": "CUST-001"
}
```

Wraps the existing intake matcher without changing it. The response includes the normal `IntakeResponse`, a `recommended_action`, customer or internal draft artifacts, and a `delivery_guard` that reports preview/live mode, send enablement, allowlist status, and blocked reasons. This slice is still preview-only: the app never sends real email.

`POST /api/search`

```json
{
  "query": "M8 flat washer",
  "use_personalization": true,
  "customer_id": "CUST-001"
}
```

In demo mode, `customer_id` selects one of the seeded demo customers. In auth-bound mode, the API ignores caller-supplied `customer_id` and derives customer context from the validated token claim.

`GET /customers` returns all seeded customers in demo mode and only the authenticated customer's profile summary in auth-bound mode.

`GET /health` returns server status and catalog size.

`GET /eval` returns deterministic seeded diagnostics only in explicit demo mode: global validation accuracy, review-routing rate, breakdowns by customer, product family, and attribute type, plus customer health slices with top review/failure reasons. Outside demo mode it returns `403` with code `diagnostics_disabled` until an internal/admin authorization model exists.

Repair-context searches include an optional `repair_context` object with the detected repair intent, match behavior, canonical query when catalog matching is allowed, internal clarification hints, kit idea, warnings, safety class, and provenance. Guidance-only contexts return `results: []` with a `no_verified_stocked_match` meta flag rather than substituting plausible but wrong generic SKUs. Direct fastener-spec searches return `repair_context: null`.

Each result preserves the raw internal `score` for debugging, adds normalized `model_closeness` in the `0..1` range, and exposes calibrated `confidence` in the `0..1` range. The top-level `decision` is `ready-to-order` only when the top confidence is at least `0.90` and no ambiguity/safety blocker applies; otherwise it returns `sales-review` or `guidance-only`.

The canonical automation contract is `validation`:

```json
{
  "decision": "AUTO_RESPOND",
  "reason": "Top SKU passed the validation gate.",
  "missing_risky_attributes": [],
  "customer_history_influenced": true,
  "internal_note": "Safe to draft an automatic sales response for the top candidate."
}
```

The response also includes risk-control evidence on each result: `match_evidence`, `review_reasons`, `contradictions`, and `can_auto_order`. These fields separate retrieval similarity from response safety so close alternatives, missing length, material/finish mismatch, thread mismatch, and proprietary repair requests can route to review instead of becoming confidently wrong customer responses.

When a customer is selected, `customer_preferences` exposes inferred global and product-family-scoped preferences from order history. Each preference includes scope, attribute, value, evidence count, total count, confidence, and whether it applied to the current query. Explicit request attributes always win over inferred preference.

Customer personalization is demo-selectable or authorization-bound depending on mode. Demo mode exists only to satisfy the take-home customer dropdown requirement without requiring OIDC. Auth-bound mode derives the customer from the validated token claim and ignores any stray `customer_id` field in the request body.

## Why this is more than search

The written challenge asks for top-three catalog matches, but the real workflow is sales order/RFQ automation. The matcher is used as a validation layer:

1. extract request line items and quantities,
2. retrieve candidate SKUs,
3. apply customer-specific preferences,
4. validate confidence and risky missing attributes,
5. route uncertain cases to sales review.

This mirrors production order-entry systems where raw match accuracy matters less than effective shipped accuracy. Rust and Vercel JS paths are covered by parity-oriented tests to limit drift between local API and deployment behavior. Explicitly out of scope for this demo: dense retrieval, Mamba, vector DBs, LLM parsing, auth redesign, and startup-style surface area that does not improve the intake workflow.

The email layer is intentionally thin and safe:

- `EMAIL_MODE=preview` and `EMAIL_SEND_ENABLED=false` keep the workflow draft-only by default.
- `EMAIL_RECIPIENT_ALLOWLIST` and `SALES_REP_EMAIL` are guardrails for future live provider wiring.
- A later production slice can wire real providers and store sales-rep draft corrections as preference evidence, but persistent correction memory is intentionally deferred here.

## Deployed Demo Smoke Test

Run this checklist against the deployed Vercel demo URL before sharing it:

- Homepage intake workbench works without login in demo mode.
- `POST /api/intake` works without login in demo mode.
- `/search` works without login in demo mode.
- `/customers` returns seeded demo customers.
- The customer dropdown loads and filters seeded customers.
- Re-running the same query after refresh returns the same top three SKUs.
- `M8 steel flat washer` returns `sales-review` and does not allow auto-order.
- `same washers as last time` uses customer history after selecting a demo customer.
- `/eval` works in demo mode.
- Production config blocks demo behavior when `APP_ENV=production`.

## Verification

```bash
cargo test
npm run test:api
cd frontend && npm run build
cd frontend && npm audit
cd frontend && npm audit --omit=dev
```

Current tests cover CSV loading, parser extraction on shorthand examples, parser coverage over all 1000 catalog rows, base search ranking, personalization on a reference query, deterministic top-three ordering, hard-negative safety cases, validation decisions, scoped customer preferences, eval diagnostics, and Rust/JS golden parity outputs.

`data/hard_negative_cases.json` tracks adversarial near-miss cases. `data/demo_golden_cases.json` locks the demo query outputs that both matcher implementations must preserve.
