# Paragon Sales Validation Match

Single-page risk-controlled sales order matching engine for a 1000-row fastener/MRO catalog. A salesperson or automation layer enters a messy customer request, the app returns the top three SKU candidates, and a validation gate decides whether the system can auto-respond, should route internally to sales review, or should not respond with a stocked SKU.

The core flow is:

```text
customer request -> SKU candidates -> validation gate -> auto-response or sales review
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

`POST /search`

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

`GET /eval` returns deterministic seeded diagnostics only in explicit demo mode: global validation accuracy, review-routing rate, and breakdowns by customer, product family, and attribute type. Outside demo mode it returns `403` with code `diagnostics_disabled` until an internal/admin authorization model exists.

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

## Deployed Demo Smoke Test

Run this checklist against the deployed Vercel demo URL before sharing it:

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
