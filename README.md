# Paragon Catalog Match

Single-page catalog matcher for a 1000-row fastener/MRO catalog. A user enters a free-form product description and the app returns the top three catalog matches with separate model-closeness and confidence signals. Selecting a customer applies a small order-history bias for the stretch challenge.

The demo also includes a seeded repair-context layer for queries where users know the job, not the fastener name. Example repair queries:

- `screws for bottom of MacBook Pro`
- `bike bottle cage bolts stainless`
- `boat hatch screws rusted from saltwater`
- `IKEA missing bed frame bolts`
- `same screws we used for pump guard`

Most repair contexts translate to canonical catalog queries, expose missing facts and warnings, and still use the same top-three matcher underneath. Proprietary/model-specific contexts can be marked guidance-only; for example, MacBook bottom-case requests show Apple pentalobe screw-set guidance and no stocked generic catalog result.

## Run Locally

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

## API

`POST /search`

```json
{
  "query": "M8 flat washer",
  "customer_id": "CUST-001"
}
```

`GET /customers` returns searchable customer options with profile summaries.

`GET /health` returns server status and catalog size.

Repair-context searches include an optional `repair_context` object with the detected repair intent, match behavior, canonical query when catalog matching is allowed, clarifying question, kit idea, warnings, safety class, and provenance. Guidance-only contexts return `results: []` with a `no_verified_stocked_match` meta flag rather than substituting plausible but wrong generic SKUs. Direct fastener-spec searches return `repair_context: null`.

Each result preserves the raw internal `score` for debugging, adds normalized `model_closeness` in the `0..1` range, and exposes calibrated `confidence` in the `0..1` range. The top-level `decision` is `ready-to-order` only when the top confidence is at least `0.90` and no ambiguity/safety blocker applies; otherwise it returns `sales-review` or `guidance-only`.

The response also includes risk-control evidence on each result: `match_evidence`, `review_reasons`, `contradictions`, and `can_auto_order`. These fields separate retrieval similarity from order safety so close alternatives, missing length, material/finish mismatch, thread mismatch, and proprietary repair requests can route to review instead of becoming confidently wrong orders.

## Verification

```bash
cargo test
cd frontend && npm run build
```

Current tests cover CSV loading, parser extraction on shorthand examples, parser coverage over all 1000 catalog rows, base search ranking, and personalization on a reference query.

`data/hard_negative_cases.json` tracks adversarial near-miss cases for the next calibration pass.
