# Decisions

## Matching

The matcher combines custom in-memory BM25 with deterministic attribute boosts. BM25 handles loose text overlap and abbreviations after token expansion. The parser extracts thread, length, product type, material, finish, and standard, then boosts matches instead of hard-filtering. This preserves recall when a query is vague or the parser misses a token.

## Model closeness, confidence, and validation

Model closeness ranks candidates. It is derived from BM25 text overlap, deterministic parser boosts, active-SKU state, and bounded customer-history bias. The raw `score` can exceed `1.0` because those signals are additive, so the API also exposes `model_closeness` normalized to `0..1` for display.

Confidence supports the validation gate. It blends normalized rank strength, attribute agreement, parser extraction confidence, prior-SKU evidence, and top-two separation. The canonical response decision is `validation.decision`: `AUTO_RESPOND`, `SALES_REVIEW`, or `DO_NOT_RESPOND`. The legacy top-level `decision` remains for compatibility. A confidently wrong customer response is worse than a low-confidence internal escalation.

## Risk control

The matcher now emits explicit evidence and contradiction reasons per result. Hard contradictions like thread mismatch, product-type mismatch, metric/imperial conflicts, or missing fitment evidence block auto-order and cap confidence. Soft contradictions like material, finish, or length uncertainty route the result to review. Rank 2 and rank 3 are alternatives only; only rank 1 can ever set `can_auto_order`.

Broad steel hardware queries with unspecified finish also route to review when the top stocked result is a coated steel variant. For example, `M8 steel flat washer` should not silently pick yellow zinc just because material, thread, and product family match.

## Personalization

Customer history applies a bounded additive bias, capped at `0.22`. The bias prefers previously ordered SKUs, common product families, familiar thread sizes, and inferred material/finish preferences. Preferences are inferred globally and within product-family scope, then exposed in `customer_preferences` with evidence counts and confidence.

Inferred preferences apply only when the request omits that attribute. If the customer explicitly asks for black oxide and history prefers zinc, the explicit request wins.

Demo mode exposes the seeded customer directory so the take-home stretch dropdown can be exercised without OIDC. Auth-bound mode requires a bearer JWT, validates issuer/audience/signature against JWKS, and derives the customer from the configured token claim. The client may opt out of personalization with `use_personalization: false`; caller-chosen `customer_id` is accepted only in demo mode.

## Repair context

Repair-context search is a seeded deterministic layer in front of the matcher. It maps human job language like "boat hatch screws rusted from saltwater" to a canonical catalog query when the request is appropriate for stocked generic hardware, then exposes the assumptions, missing facts, warnings, kit idea, and provenance in the response. It does not call an LLM and does not claim verified fitment unless the seed data explicitly says so.

Proprietary/model-specific contexts use a separate guidance-only behavior. For example, "screws for bottom of MacBook Pro" returns Apple lower-case pentalobe screw-set guidance, a P5 Pentalobe driver recommendation, and no catalog result because the demo catalog does not contain verified MacBook lower-case screws. The hard rule is to prefer "not stocked / verify exact model" over a plausible-looking generic screw when the catalog lacks matching proprietary terms.

## Diagnostics

`/eval` is a deterministic demo diagnostic endpoint. It reports validation accuracy and review-routing rate globally, by customer, by product family, and by attribute type. This is intentionally small, but it demonstrates the operational requirement from the interview: global accuracy is insufficient if one customer or attribute class degrades.

## Scope

The app intentionally avoids vector databases, embeddings, WebSockets, Docker, and external LLM calls. The catalog has only 1000 rows, so a boot-loaded `Vec` plus `HashMap` indices gives predictable latency and a simpler interview explanation.

## Known Tradeoffs

The parser and repair resolver are deterministic and inspectable, but they will not understand every synonym or prove OEM compatibility. The UI exposes parsed signals, repair-context assumptions, and unclassified tokens so a reviewer can see where the system is confident versus guessing. A larger version should add a labeled eval set and verified repair-context data before adding embeddings, LLM fallback, or photo lookup.
