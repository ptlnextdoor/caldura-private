# Decisions

## Matching

The matcher combines custom in-memory BM25 with deterministic attribute boosts. BM25 handles loose text overlap and abbreviations after token expansion. The parser extracts thread, length, product type, material, finish, and standard, then boosts matches instead of hard-filtering. This preserves recall when a query is vague or the parser misses a token.

## Model closeness and confidence

Model closeness ranks candidates. It is derived from BM25 text overlap, deterministic parser boosts, active-SKU state, and bounded customer-history bias. The raw `score` can exceed `1.0` because those signals are additive, so the API also exposes `model_closeness` normalized to `0..1` for display.

Confidence decides whether to automate or route to a sales person. It blends normalized rank strength, attribute agreement, parser extraction confidence, prior-SKU evidence, and top-two separation. The top-level decision is `ready-to-order` only at `90%+` confidence with no ambiguity or safety blocker; lower confidence routes to `sales-review`. A confidently wrong result is worse than a low-confidence escalation.

## Risk control

The matcher now emits explicit evidence and contradiction reasons per result. Hard contradictions like thread mismatch, product-type mismatch, metric/imperial conflicts, or missing fitment evidence block auto-order and cap confidence. Soft contradictions like material, finish, or length uncertainty route the result to review. Rank 2 and rank 3 are alternatives only; only rank 1 can ever set `can_auto_order`.

## Personalization

Customer history applies a bounded additive bias, capped at `0.22`. The bias prefers previously ordered SKUs, common product families, usual material/finish, and familiar thread sizes. Reference-style queries like "same washers as last time" weight prior SKUs and usual product family more heavily.

Customer history is scoped by authentication. `/search` and `/customers` require a bearer JWT,
validate issuer/audience/signature against JWKS, and derive the customer from the configured token
claim. The client may opt out of personalization with `use_personalization: false`, but it cannot
select another customer by ID.

## Repair context

Repair-context search is a seeded deterministic layer in front of the matcher. It maps human job language like "boat hatch screws rusted from saltwater" to a canonical catalog query when the request is appropriate for stocked generic hardware, then exposes the assumptions, missing facts, warnings, kit idea, and provenance in the response. It does not call an LLM and does not claim verified fitment unless the seed data explicitly says so.

Proprietary/model-specific contexts use a separate guidance-only behavior. For example, "screws for bottom of MacBook Pro" returns Apple lower-case pentalobe screw-set guidance, a P5 Pentalobe driver recommendation, and no catalog result because the demo catalog does not contain verified MacBook lower-case screws. The hard rule is to prefer "not stocked / verify exact model" over a plausible-looking generic screw when the catalog lacks matching proprietary terms.

## Scope

The app intentionally avoids vector databases, embeddings, WebSockets, Docker, and external LLM calls. The catalog has only 1000 rows, so a boot-loaded `Vec` plus `HashMap` indices gives predictable latency and a simpler interview explanation.

## Known Tradeoffs

The parser and repair resolver are deterministic and inspectable, but they will not understand every synonym or prove OEM compatibility. The UI exposes parsed signals, repair-context assumptions, and unclassified tokens so a reviewer can see where the system is confident versus guessing. A larger version should add a labeled eval set and verified repair-context data before adding embeddings, LLM fallback, or photo lookup.
