use crate::{
    parser::{parse_catalog_row, parse_query, thread_matches, tokens},
    profile::{build_profiles, CustomerPreference, CustomerProfile, CustomerSummary},
    repair::{resolve_repair_context, MatchBehavior, ResolvedRepairContext, SafetyClass},
    types::{AttrSpec, CatalogRow, OrderRow},
};
use serde::Serialize;
use std::{
    cmp::Ordering,
    collections::{BTreeSet, HashMap},
    time::Instant,
};

#[derive(Debug, Clone)]
pub struct Matcher {
    catalog: Vec<CatalogRow>,
    parsed_catalog: Vec<AttrSpec>,
    bm25: Bm25Index,
    profiles: HashMap<String, CustomerProfile>,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub query: QueryEcho,
    pub results: Vec<SearchResult>,
    pub meta: SearchMeta,
    pub decision: &'static str,
    pub validation: Validation,
    pub customer_preferences: Vec<CustomerPreference>,
    pub repair_context: Option<ResolvedRepairContext>,
}

#[derive(Debug, Serialize)]
pub struct QueryEcho {
    pub original: String,
    pub parsed: AttrSpec,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub rank: usize,
    pub sku: String,
    pub catalog_id: String,
    pub description: String,
    pub active: bool,
    pub score: f32,
    pub model_closeness: f32,
    pub confidence: f32,
    pub confidence_label: &'static str,
    pub attribute_matches: AttributeMatches,
    pub personalized: bool,
    pub personalization_note: Option<String>,
    pub match_evidence: Vec<String>,
    pub review_reasons: Vec<String>,
    pub contradictions: Vec<Contradiction>,
    pub can_auto_order: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AttributeMatches {
    pub thread: bool,
    #[serde(rename = "type")]
    pub product_type: bool,
    pub length: bool,
    pub material: bool,
    pub finish: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Contradiction {
    pub field: &'static str,
    pub query_value: String,
    pub result_value: String,
    pub severity: &'static str,
}

#[derive(Debug, Clone)]
struct EvidenceAnalysis {
    match_evidence: Vec<String>,
    review_reasons: Vec<String>,
    contradictions: Vec<Contradiction>,
    has_hard_contradiction: bool,
    has_soft_contradiction: bool,
}

#[derive(Debug, Serialize)]
pub struct SearchMeta {
    pub latency_ms: f64,
    pub candidate_count: usize,
    pub low_confidence_overall: bool,
    pub ambiguous_query: bool,
    pub ambiguous_suggestions: Option<Vec<Suggestion>>,
    pub no_verified_stocked_match: bool,
    pub result_message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Suggestion {
    pub label: String,
    pub query_rewrite: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Validation {
    pub decision: &'static str,
    pub reason: String,
    pub missing_risky_attributes: Vec<String>,
    pub customer_history_influenced: bool,
    pub internal_note: String,
}

#[derive(Debug, Serialize)]
pub struct EvalDiagnostics {
    pub global_accuracy: f32,
    pub review_routing_rate: f32,
    pub total_cases: usize,
    pub by_customer: Vec<EvalMetric>,
    pub by_product_family: Vec<EvalMetric>,
    pub by_attribute_type: Vec<EvalMetric>,
}

#[derive(Debug, Serialize)]
pub struct EvalMetric {
    pub key: String,
    pub accuracy: f32,
    pub review_routing_rate: f32,
    pub cases: usize,
}

#[derive(Debug, Clone)]
struct ScoredCandidate {
    idx: usize,
    final_score: f32,
    attr_score: f32,
    personalized: bool,
    personalization_note: Option<String>,
    matches: AttributeMatches,
}

impl Matcher {
    pub fn new(catalog: Vec<CatalogRow>, orders: Vec<OrderRow>) -> Self {
        let parsed_catalog = catalog
            .iter()
            .map(|row| parse_catalog_row(&row.description))
            .collect::<Vec<_>>();
        let docs = catalog
            .iter()
            .zip(parsed_catalog.iter())
            .map(|(row, attrs)| expanded_doc(row, attrs))
            .collect::<Vec<_>>();
        let bm25 = Bm25Index::build(&docs);
        let profiles = build_profiles(&orders);

        Self {
            catalog,
            parsed_catalog,
            bm25,
            profiles,
        }
    }

    pub fn customer(&self, customer_id: &str) -> Option<CustomerSummary> {
        self.profiles.get(customer_id).map(CustomerProfile::summary)
    }

    pub fn customers(&self) -> Vec<CustomerSummary> {
        let mut customers = self
            .profiles
            .values()
            .map(CustomerProfile::summary)
            .collect::<Vec<_>>();
        customers.sort_by(|a, b| a.id.cmp(&b.id));
        customers
    }

    pub fn search(&self, query: &str, customer_id: Option<&str>) -> SearchResponse {
        let started = Instant::now();
        let repair_context = resolve_repair_context(query);
        if repair_context
            .as_ref()
            .is_some_and(|context| matches!(context.match_behavior, MatchBehavior::GuidanceOnly))
        {
            return SearchResponse {
                query: QueryEcho {
                    original: query.to_string(),
                    parsed: parse_query(query),
                },
                results: Vec::new(),
                meta: SearchMeta {
                    latency_ms: round_ms(started.elapsed().as_secs_f64() * 1000.0),
                    candidate_count: self.catalog.len(),
                    low_confidence_overall: true,
                    ambiguous_query: false,
                    ambiguous_suggestions: None,
                    no_verified_stocked_match: true,
                    result_message: Some(
                        "This repair appears to need a model-specific Apple pentalobe lower-case screw set, not a standard catalog screw.".to_string(),
                    ),
                },
                decision: "guidance-only",
                validation: Validation {
                    decision: "DO_NOT_RESPOND",
                    reason: "No verified stocked match for this customer request.".to_string(),
                    missing_risky_attributes: vec!["verified fitment".to_string()],
                    customer_history_influenced: false,
                    internal_note: "Do not auto-respond with a stocked SKU; route internally for model-specific fitment review.".to_string(),
                },
                customer_preferences: Vec::new(),
                repair_context,
            };
        }
        let effective_query = repair_context
            .as_ref()
            .and_then(|context| context.canonical_query.as_deref())
            .unwrap_or(query);
        let parsed = parse_query(effective_query);
        let reference_query = is_reference_query(query);
        let profile = customer_id.and_then(|id| self.profiles.get(id));
        let bm25_hits = self.bm25.search(effective_query, self.catalog.len());
        let max_bm25 = bm25_hits
            .first()
            .map(|(_, score)| *score)
            .unwrap_or(1.0)
            .max(1.0);

        let mut candidates = Vec::new();
        for (idx, bm25_score) in bm25_hits {
            let row = &self.catalog[idx];
            let attrs = &self.parsed_catalog[idx];
            let (attr_score, matches) = attribute_score(&parsed, attrs);
            let bm25_norm = (bm25_score / max_bm25).clamp(0.0, 1.0);
            let active_bonus = if row.active { 0.015 } else { -0.08 };
            let mut final_score = (0.62 * bm25_norm) + (0.38 * attr_score) + active_bonus;

            let mut personalized = false;
            let mut personalization_note = None;
            if let Some(profile) = profile {
                let (bias, note) = profile.bias(&parsed, &row.sku, attrs, reference_query);
                if bias > 0.0 {
                    personalized = true;
                    personalization_note = note;
                    final_score += bias;
                }
            }

            if parsed.product_type.is_some() && !matches.product_type {
                final_score -= 0.12;
            }
            if parsed.thread_spec.is_some() && !matches.thread {
                final_score -= 0.10;
            }
            if parsed.length_mm.is_some() && !matches.length {
                final_score -= 0.08;
            }
            if parsed.material.is_some() && !matches.material {
                final_score -= 0.07;
            }
            if parsed.finish.is_some() && !matches.finish {
                final_score -= 0.06;
            }

            candidates.push(ScoredCandidate {
                idx,
                final_score: final_score.clamp(0.0, 1.25),
                attr_score,
                personalized,
                personalization_note,
                matches,
            });
        }

        candidates.sort_by(|a, b| compare_candidates(a, b, &self.catalog));

        let top_score = candidates.first().map(|c| c.final_score).unwrap_or(0.0);
        let second_score = candidates.get(1).map(|c| c.final_score).unwrap_or(0.0);
        let top_gap = top_score - second_score;
        let ambiguous_query = top_score > 0.0 && (top_score - second_score) < 0.06;
        let low_confidence_overall = top_score < 0.52 || parsed.extraction_confidence < 0.18;
        let top_prior_sku_reference = candidates.first().is_some_and(|candidate| {
            reference_query
                && candidate.personalization_note.as_deref() == Some("matches previously ordered SKU")
        });
        let safety_blocked = repair_context
            .as_ref()
            .is_some_and(|context| !matches!(context.safety_class, SafetyClass::Low));
        let top_has_hard_contradiction = candidates.first().is_some_and(|candidate| {
            analyze_evidence(
                &parsed,
                &self.parsed_catalog[candidate.idx],
                &candidate.matches,
                candidate.personalization_note.as_deref(),
                repair_context.as_ref(),
                top_gap,
                top_prior_sku_reference,
            )
            .has_hard_contradiction
        });

        let results = candidates
            .iter()
            .take(3)
            .enumerate()
            .map(|(rank, candidate)| {
                let row = &self.catalog[candidate.idx];
                let analysis = analyze_evidence(
                    &parsed,
                    &self.parsed_catalog[candidate.idx],
                    &candidate.matches,
                    candidate.personalization_note.as_deref(),
                    repair_context.as_ref(),
                    top_gap,
                    top_prior_sku_reference,
                );
                let variant_ambiguous = variant_ambiguity_review_required(
                    &parsed,
                    &self.parsed_catalog[candidate.idx],
                    &candidate.matches,
                    rank,
                );
                let mut confidence = confidence(
                    candidate.final_score,
                    top_score,
                    top_gap,
                    parsed.extraction_confidence,
                    candidate.attr_score,
                    reference_query && candidate.personalization_note.as_deref() == Some("matches previously ordered SKU"),
                );
                if analysis.has_hard_contradiction {
                    confidence = confidence.min(0.40);
                } else if variant_ambiguous {
                    confidence = confidence.min(0.89);
                } else if analysis.has_soft_contradiction {
                    confidence = confidence.min(0.82);
                }
                let can_auto_order = rank == 0
                    && confidence >= 0.90
                    && !analysis.has_hard_contradiction
                    && !variant_ambiguous
                    && !safety_blocked
                    && (!ambiguous_query || top_prior_sku_reference);
                let mut review_reasons = analysis.review_reasons;
                if variant_ambiguous {
                    review_reasons.push("Finish unspecified for coated steel variant".to_string());
                    review_reasons.sort();
                    review_reasons.dedup();
                }
                SearchResult {
                    rank: rank + 1,
                    sku: row.sku.clone(),
                    catalog_id: row.catalog_id.clone(),
                    description: row.description.clone(),
                    active: row.active,
                    score: round3(candidate.final_score),
                    model_closeness: round3(model_closeness(candidate.final_score)),
                    confidence: round3(confidence),
                    confidence_label: label(confidence),
                    attribute_matches: candidate.matches.clone(),
                    personalized: candidate.personalized,
                    personalization_note: candidate.personalization_note.clone(),
                    match_evidence: analysis.match_evidence,
                    review_reasons,
                    contradictions: analysis.contradictions,
                    can_auto_order,
                }
            })
            .collect::<Vec<_>>();
        let customer_preferences = profile
            .map(|profile| {
                profile.preferences(
                    &parsed,
                    candidates
                        .first()
                        .map(|candidate| &self.parsed_catalog[candidate.idx]),
                )
            })
            .unwrap_or_default();
        let decision = decision_for(
            results.first().map(|result| result.confidence).unwrap_or(0.0),
            ambiguous_query,
            safety_blocked,
            top_prior_sku_reference,
            top_has_hard_contradiction,
            results
                .first()
                .map(|result| result.can_auto_order)
                .unwrap_or(false),
        );

        let suggestions = if ambiguous_query || low_confidence_overall {
            build_suggestions(&parsed)
        } else {
            None
        };
        let validation = validation_for(
            decision,
            results.first(),
            &parsed,
            low_confidence_overall,
            ambiguous_query,
            &customer_preferences,
        );

        SearchResponse {
            query: QueryEcho {
                original: query.to_string(),
                parsed,
            },
            results,
            meta: SearchMeta {
                latency_ms: round_ms(started.elapsed().as_secs_f64() * 1000.0),
                candidate_count: self.catalog.len(),
                low_confidence_overall,
                ambiguous_query,
                ambiguous_suggestions: suggestions,
                no_verified_stocked_match: false,
                result_message: None,
            },
            decision,
            validation,
            customer_preferences,
            repair_context,
        }
    }

    pub fn eval_diagnostics(&self) -> EvalDiagnostics {
        let cases = eval_cases();
        let rows = cases
            .iter()
            .map(|case| {
                let response = self.search(case.query, case.customer_id);
                EvalRow {
                    customer: case.customer_id.unwrap_or("no-customer").to_string(),
                    product_family: case.product_family.to_string(),
                    attribute_type: case.attribute_type.to_string(),
                    expected_decision: case.expected_decision,
                    actual_decision: response.validation.decision,
                }
            })
            .collect::<Vec<_>>();

        EvalDiagnostics {
            global_accuracy: eval_accuracy(&rows),
            review_routing_rate: review_rate(&rows),
            total_cases: rows.len(),
            by_customer: group_metrics(&rows, |row| row.customer.clone()),
            by_product_family: group_metrics(&rows, |row| row.product_family.clone()),
            by_attribute_type: group_metrics(&rows, |row| row.attribute_type.clone()),
        }
    }
}

fn validation_for(
    decision: &'static str,
    top: Option<&SearchResult>,
    parsed: &AttrSpec,
    low_confidence_overall: bool,
    ambiguous_query: bool,
    preferences: &[CustomerPreference],
) -> Validation {
    let customer_history_influenced = top.is_some_and(|result| result.personalized)
        || preferences.iter().any(|preference| preference.applied_to_query);
    let missing_risky_attributes = missing_risky_attributes(top, parsed, low_confidence_overall, ambiguous_query);
    match decision {
        "ready-to-order" => Validation {
            decision: "AUTO_RESPOND",
            reason: "Top SKU passed the validation gate.".to_string(),
            missing_risky_attributes,
            customer_history_influenced,
            internal_note: "Safe to draft an automatic sales response for the top candidate.".to_string(),
        },
        "guidance-only" => Validation {
            decision: "DO_NOT_RESPOND",
            reason: "No verified stocked match for this request.".to_string(),
            missing_risky_attributes,
            customer_history_influenced,
            internal_note: "Do not auto-respond; route internally for fitment or stocked-part review.".to_string(),
        },
        _ => {
            let reason = top
                .and_then(|result| result.review_reasons.first())
                .cloned()
                .unwrap_or_else(|| "Validation gate requires internal sales review.".to_string());
            let mut internal_note = "Route internally to sales review; do not ask the customer for clarification by default.".to_string();
            if !missing_risky_attributes.is_empty() {
                internal_note.push_str(" Internal reviewer should verify: ");
                internal_note.push_str(&missing_risky_attributes.join(", "));
            }
            Validation {
                decision: "SALES_REVIEW",
                reason,
                missing_risky_attributes,
                customer_history_influenced,
                internal_note,
            }
        }
    }
}

fn missing_risky_attributes(
    top: Option<&SearchResult>,
    parsed: &AttrSpec,
    low_confidence_overall: bool,
    ambiguous_query: bool,
) -> Vec<String> {
    let mut missing = Vec::new();
    if parsed.finish.is_none()
        && top.is_some_and(|result| {
            result
                .review_reasons
                .iter()
                .any(|reason| reason.to_ascii_lowercase().contains("finish"))
        })
    {
        missing.push("finish".to_string());
    }
    if parsed.length_mm.is_none()
        && top.is_some_and(|result| {
            result
                .review_reasons
                .iter()
                .any(|reason| reason.to_ascii_lowercase().contains("length"))
        })
    {
        missing.push("length".to_string());
    }
    if ambiguous_query {
        missing.push("variant selection".to_string());
    }
    if low_confidence_overall {
        missing.push("specific product details".to_string());
    }
    if let Some(top) = top {
        for contradiction in &top.contradictions {
            missing.push(contradiction.field.to_string());
        }
    }
    missing.sort();
    missing.dedup();
    missing
}

struct EvalCase {
    query: &'static str,
    customer_id: Option<&'static str>,
    expected_decision: &'static str,
    product_family: &'static str,
    attribute_type: &'static str,
}

struct EvalRow {
    customer: String,
    product_family: String,
    attribute_type: String,
    expected_decision: &'static str,
    actual_decision: &'static str,
}

fn eval_cases() -> Vec<EvalCase> {
    vec![
        EvalCase {
            query: "1/4-20 x 3/4 hex cap screw zinc",
            customer_id: Some("CUST-001"),
            expected_decision: "AUTO_RESPOND",
            product_family: "hex-cap-screw",
            attribute_type: "exact",
        },
        EvalCase {
            query: "SHCS 7/16 x 2-1/2",
            customer_id: Some("CUST-001"),
            expected_decision: "AUTO_RESPOND",
            product_family: "socket-head-cap-screw",
            attribute_type: "abbreviation",
        },
        EvalCase {
            query: "1/4-20 hex cap screw",
            customer_id: Some("CUST-001"),
            expected_decision: "AUTO_RESPOND",
            product_family: "hex-cap-screw",
            attribute_type: "preference-omitted",
        },
        EvalCase {
            query: "1/4-20 black oxide hex cap screw",
            customer_id: Some("CUST-001"),
            expected_decision: "AUTO_RESPOND",
            product_family: "hex-cap-screw",
            attribute_type: "explicit-wins",
        },
        EvalCase {
            query: "M8 flat washer",
            customer_id: Some("CUST-005"),
            expected_decision: "SALES_REVIEW",
            product_family: "flat-washer",
            attribute_type: "sparse-customer",
        },
        EvalCase {
            query: "M8 steel flat washer",
            customer_id: None,
            expected_decision: "SALES_REVIEW",
            product_family: "flat-washer",
            attribute_type: "hard-negative",
        },
        EvalCase {
            query: "screws for bottom of MacBook Pro",
            customer_id: None,
            expected_decision: "DO_NOT_RESPOND",
            product_family: "proprietary-repair",
            attribute_type: "fitment",
        },
    ]
}

fn eval_accuracy(rows: &[EvalRow]) -> f32 {
    if rows.is_empty() {
        return 0.0;
    }
    round3(
        rows.iter()
            .filter(|row| row.actual_decision == row.expected_decision)
            .count() as f32
            / rows.len() as f32,
    )
}

fn review_rate(rows: &[EvalRow]) -> f32 {
    if rows.is_empty() {
        return 0.0;
    }
    round3(
        rows.iter()
            .filter(|row| row.actual_decision == "SALES_REVIEW")
            .count() as f32
            / rows.len() as f32,
    )
}

fn group_metrics<F>(rows: &[EvalRow], key_fn: F) -> Vec<EvalMetric>
where
    F: Fn(&EvalRow) -> String,
{
    let mut groups: HashMap<String, Vec<EvalRowRef<'_>>> = HashMap::new();
    for row in rows {
        groups
            .entry(key_fn(row))
            .or_default()
            .push(EvalRowRef { row });
    }
    let mut metrics = groups
        .into_iter()
        .map(|(key, refs)| {
            let grouped_rows = refs.into_iter().map(|value| value.row).collect::<Vec<_>>();
            EvalMetric {
                key,
                accuracy: eval_accuracy_refs(&grouped_rows),
                review_routing_rate: review_rate_refs(&grouped_rows),
                cases: grouped_rows.len(),
            }
        })
        .collect::<Vec<_>>();
    metrics.sort_by(|a, b| a.key.cmp(&b.key));
    metrics
}

struct EvalRowRef<'a> {
    row: &'a EvalRow,
}

fn eval_accuracy_refs(rows: &[&EvalRow]) -> f32 {
    if rows.is_empty() {
        return 0.0;
    }
    round3(
        rows.iter()
            .filter(|row| row.actual_decision == row.expected_decision)
            .count() as f32
            / rows.len() as f32,
    )
}

fn review_rate_refs(rows: &[&EvalRow]) -> f32 {
    if rows.is_empty() {
        return 0.0;
    }
    round3(
        rows.iter()
            .filter(|row| row.actual_decision == "SALES_REVIEW")
            .count() as f32
            / rows.len() as f32,
    )
}

fn compare_candidates(a: &ScoredCandidate, b: &ScoredCandidate, catalog: &[CatalogRow]) -> Ordering {
    let a_row = &catalog[a.idx];
    let b_row = &catalog[b.idx];
    b.final_score
        .partial_cmp(&a.final_score)
        .unwrap_or(Ordering::Equal)
        .then_with(|| b.attr_score.partial_cmp(&a.attr_score).unwrap_or(Ordering::Equal))
        .then_with(|| b_row.active.cmp(&a_row.active))
        .then_with(|| b.matches.product_type.cmp(&a.matches.product_type))
        .then_with(|| b.matches.thread.cmp(&a.matches.thread))
        .then_with(|| b.matches.length.cmp(&a.matches.length))
        .then_with(|| b.matches.material.cmp(&a.matches.material))
        .then_with(|| b.matches.finish.cmp(&a.matches.finish))
        .then_with(|| a_row.catalog_id.cmp(&b_row.catalog_id))
        .then_with(|| a_row.sku.cmp(&b_row.sku))
        .then_with(|| a.idx.cmp(&b.idx))
}

fn variant_ambiguity_review_required(
    query: &AttrSpec,
    candidate: &AttrSpec,
    matches: &AttributeMatches,
    rank: usize,
) -> bool {
    rank == 0
        && query.material == Some(crate::types::Material::Steel)
        && query.finish.is_none()
        && matches.thread
        && matches.product_type
        && matches.material
        && candidate.finish.is_some()
}

fn expanded_doc(row: &CatalogRow, attrs: &AttrSpec) -> String {
    let mut doc = format!("{} {} {}", row.sku, row.catalog_id, row.description);
    if let Some(value) = attrs.product_type {
        doc.push(' ');
        doc.push_str(value.as_str());
        doc.push(' ');
        doc.push_str(&value.as_str().replace('-', " "));
    }
    if let Some(value) = attrs.material {
        doc.push(' ');
        doc.push_str(value.as_str());
        doc.push(' ');
        doc.push_str(&value.as_str().replace('-', " "));
    }
    if let Some(value) = attrs.finish {
        doc.push(' ');
        doc.push_str(value.as_str());
        doc.push(' ');
        doc.push_str(&value.as_str().replace('-', " "));
    }
    doc
}

fn attribute_score(query: &AttrSpec, candidate: &AttrSpec) -> (f32, AttributeMatches) {
    let thread = thread_matches(query, candidate);
    let product_type = query.product_type.is_some() && query.product_type == candidate.product_type;
    let length = match (query.length_mm, candidate.length_mm) {
        (Some(q), Some(c)) => (q - c).abs() <= 1.0 || (q - c).abs() / q.max(1.0) <= 0.03,
        _ => false,
    };
    let material = query.material.is_some() && query.material == candidate.material;
    let finish = query.finish.is_some() && query.finish == candidate.finish;

    let mut possible = 0.0;
    let mut score = 0.0;
    add_field(
        query.thread_spec.is_some(),
        thread,
        0.34,
        &mut possible,
        &mut score,
    );
    add_field(
        query.product_type.is_some(),
        product_type,
        0.28,
        &mut possible,
        &mut score,
    );
    add_field(
        query.length_mm.is_some(),
        length,
        0.18,
        &mut possible,
        &mut score,
    );
    add_field(
        query.material.is_some(),
        material,
        0.11,
        &mut possible,
        &mut score,
    );
    add_field(
        query.finish.is_some(),
        finish,
        0.09,
        &mut possible,
        &mut score,
    );

    let normalized = if possible > 0.0 {
        score / possible
    } else {
        0.15
    };
    (
        normalized,
        AttributeMatches {
            thread,
            product_type,
            length,
            material,
            finish,
        },
    )
}

fn add_field(present: bool, matched: bool, weight: f32, possible: &mut f32, score: &mut f32) {
    if present {
        *possible += weight;
        if matched {
            *score += weight;
        }
    }
}

fn model_closeness(score: f32) -> f32 {
    (score / 1.25).clamp(0.0, 1.0)
}

fn confidence(
    score: f32,
    top_score: f32,
    top_gap: f32,
    parsed_confidence: f32,
    attr_score: f32,
    prior_sku_reference: bool,
) -> f32 {
    if top_score <= 0.0 {
        return 0.0;
    }
    let absolute = model_closeness(score);
    let relative = (score / top_score).clamp(0.0, 1.0);
    let gap_bonus = (top_gap * 1.3).clamp(0.0, 0.08);
    let exact_signal_bonus = if attr_score >= 0.99 && parsed_confidence >= 0.45 {
        0.14
    } else {
        0.0
    };
    let prior_bonus = if prior_sku_reference { 0.24 } else { 0.0 };
    let ambiguity_penalty = if top_gap < 0.04 { 0.07 } else { 0.0 };
    let mut value = 0.34 * absolute
        + 0.30 * attr_score
        + 0.18 * relative
        + 0.16 * parsed_confidence
        + gap_bonus
        + exact_signal_bonus
        + prior_bonus
        - ambiguity_penalty;

    if parsed_confidence < 0.18 {
        value = value.min(0.72);
    } else if parsed_confidence < 0.35 && !prior_sku_reference {
        value = value.min(0.84);
    }
    if top_gap < 0.04 && attr_score < 0.99 && !prior_sku_reference {
        value = value.min(0.89);
    }
    value.clamp(0.05, 0.97)
}

fn label(confidence: f32) -> &'static str {
    if confidence >= 0.90 {
        "high"
    } else if confidence >= 0.65 {
        "medium"
    } else {
        "low"
    }
}

fn decision_for(
    confidence: f32,
    ambiguous_query: bool,
    safety_blocked: bool,
    top_prior_sku_reference: bool,
    top_has_hard_contradiction: bool,
    top_can_auto_order: bool,
) -> &'static str {
    if top_can_auto_order
        && confidence >= 0.90
        && (!ambiguous_query || top_prior_sku_reference)
        && !safety_blocked
        && !top_has_hard_contradiction
    {
        "ready-to-order"
    } else {
        "sales-review"
    }
}

fn analyze_evidence(
    query: &AttrSpec,
    candidate: &AttrSpec,
    matches: &AttributeMatches,
    personalization_note: Option<&str>,
    repair_context: Option<&ResolvedRepairContext>,
    top_gap: f32,
    top_prior_sku_reference: bool,
) -> EvidenceAnalysis {
    let mut match_evidence = Vec::new();
    let mut review_reasons = Vec::new();
    let mut contradictions = Vec::new();

    if let Some(value) = query.thread_spec.as_deref() {
        if matches.thread {
            match_evidence.push(format!("Thread {value} matched"));
        } else {
            contradictions.push(contradiction(
                "thread",
                value,
                candidate.thread_spec.as_deref().unwrap_or("missing"),
                "hard",
            ));
            review_reasons.push("Thread mismatch blocks auto-order".to_string());
        }
    }
    if query.thread_spec.is_some()
        && candidate.thread_spec.is_some()
        && thread_system(query.thread_spec.as_deref()) != thread_system(candidate.thread_spec.as_deref())
    {
        contradictions.push(contradiction(
            "thread_system",
            thread_system(query.thread_spec.as_deref()).unwrap_or("unknown"),
            thread_system(candidate.thread_spec.as_deref()).unwrap_or("unknown"),
            "hard",
        ));
        review_reasons.push("Metric/imperial thread system conflict".to_string());
    }
    if let Some(value) = query.product_type {
        if matches.product_type {
            match_evidence.push(format!("Type {} matched", display_enum(value.as_str())));
        } else {
            contradictions.push(contradiction(
                "type",
                value.as_str(),
                candidate
                    .product_type
                    .map(|candidate| candidate.as_str())
                    .unwrap_or("missing"),
                "hard",
            ));
            review_reasons.push("Product type mismatch blocks auto-order".to_string());
        }
    }
    if query.length_mm.is_some() {
        if matches.length {
            match_evidence.push("Length matched".to_string());
        } else {
            contradictions.push(contradiction(
                "length",
                query.length_raw.as_deref().unwrap_or("specified"),
                candidate.length_raw.as_deref().unwrap_or("missing"),
                "soft",
            ));
            review_reasons.push("Length needs verification".to_string());
        }
    }
    if let Some(value) = query.material {
        if matches.material {
            match_evidence.push(format!("Material {} matched", display_enum(value.as_str())));
        } else {
            contradictions.push(contradiction(
                "material",
                value.as_str(),
                candidate
                    .material
                    .map(|candidate| candidate.as_str())
                    .unwrap_or("missing"),
                "soft",
            ));
            review_reasons.push("Material mismatch needs review".to_string());
        }
    }
    if let Some(value) = query.finish {
        if matches.finish {
            match_evidence.push(format!("Finish {} matched", display_enum(value.as_str())));
        } else {
            contradictions.push(contradiction(
                "finish",
                value.as_str(),
                candidate
                    .finish
                    .map(|candidate| candidate.as_str())
                    .unwrap_or("missing"),
                "soft",
            ));
            review_reasons.push("Finish mismatch needs review".to_string());
        }
    }
    if let Some(note) = personalization_note {
        match_evidence.push(match note {
            "matches previously ordered SKU" => "Previous customer SKU matched".to_string(),
            "matches usual product family" => "Customer history supports product family".to_string(),
            _ => note.to_string(),
        });
    }
    if top_gap < 0.06 && !top_prior_sku_reference {
        review_reasons.push("Close alternatives need review".to_string());
    }
    if let Some(context) = repair_context {
        if matches!(context.safety_class, SafetyClass::Blocked | SafetyClass::Caution) {
            review_reasons.push("Repair context needs human verification".to_string());
        }
        if matches!(context.match_behavior, MatchBehavior::GuidanceOnly) {
            contradictions.push(contradiction(
                "fitment",
                "model-specific repair",
                "no verified stocked fitment",
                "hard",
            ));
            review_reasons.push("Model-specific repair needs fitment evidence".to_string());
        }
    }

    match_evidence.sort();
    match_evidence.dedup();
    review_reasons.sort();
    review_reasons.dedup();
    contradictions.dedup_by(|left, right| {
        left.field == right.field
            && left.query_value == right.query_value
            && left.result_value == right.result_value
            && left.severity == right.severity
    });

    let has_hard_contradiction = contradictions
        .iter()
        .any(|contradiction| contradiction.severity == "hard");
    let has_soft_contradiction = contradictions
        .iter()
        .any(|contradiction| contradiction.severity == "soft");

    EvidenceAnalysis {
        match_evidence,
        review_reasons,
        contradictions,
        has_hard_contradiction,
        has_soft_contradiction,
    }
}

fn contradiction(
    field: &'static str,
    query_value: impl Into<String>,
    result_value: impl Into<String>,
    severity: &'static str,
) -> Contradiction {
    Contradiction {
        field,
        query_value: query_value.into(),
        result_value: result_value.into(),
        severity,
    }
}

fn thread_system(thread: Option<&str>) -> Option<&'static str> {
    let thread = thread?;
    if thread.to_ascii_lowercase().starts_with('m') {
        Some("metric")
    } else {
        Some("imperial")
    }
}

fn display_enum(value: &str) -> String {
    value.replace('-', " ")
}

fn build_suggestions(parsed: &AttrSpec) -> Option<Vec<Suggestion>> {
    let mut suggestions = Vec::new();
    if parsed.product_type.is_none() {
        suggestions.push(Suggestion {
            label: "Add product type".to_string(),
            query_rewrite: "M8 flat washer".to_string(),
        });
    }
    if parsed.thread_spec.is_none() {
        suggestions.push(Suggestion {
            label: "Add thread or size".to_string(),
            query_rewrite: "1/4-20 x 3/4 hex cap screw".to_string(),
        });
    }
    if parsed.material.is_none() {
        suggestions.push(Suggestion {
            label: "Add material".to_string(),
            query_rewrite: "brass hex nut 1/2-13".to_string(),
        });
    }
    if suggestions.is_empty() {
        None
    } else {
        Some(suggestions)
    }
}

fn is_reference_query(query: &str) -> bool {
    let q = query.to_ascii_lowercase();
    ["same", "usual", "last time", "again", "reorder"]
        .iter()
        .any(|needle| q.contains(needle))
}

fn round3(value: f32) -> f32 {
    (value * 1000.0).round() / 1000.0
}

fn round_ms(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[derive(Debug, Clone)]
pub struct Bm25Index {
    inverted: HashMap<String, HashMap<usize, u32>>,
    doc_lengths: Vec<u32>,
    avg_doc_length: f32,
    n_docs: usize,
    k1: f32,
    b: f32,
}

impl Bm25Index {
    pub fn build(docs: &[String]) -> Self {
        let mut inverted: HashMap<String, HashMap<usize, u32>> = HashMap::new();
        let mut doc_lengths = Vec::with_capacity(docs.len());

        for (doc_id, doc) in docs.iter().enumerate() {
            let doc_tokens = tokens(doc);
            doc_lengths.push(doc_tokens.len() as u32);
            for token in doc_tokens {
                *inverted
                    .entry(token)
                    .or_default()
                    .entry(doc_id)
                    .or_insert(0) += 1;
            }
        }

        let avg_doc_length = if doc_lengths.is_empty() {
            0.0
        } else {
            doc_lengths.iter().sum::<u32>() as f32 / doc_lengths.len() as f32
        };

        Self {
            inverted,
            doc_lengths,
            avg_doc_length,
            n_docs: docs.len(),
            k1: 1.5,
            b: 0.75,
        }
    }

    pub fn search(&self, query: &str, top_k: usize) -> Vec<(usize, f32)> {
        let mut scores: HashMap<usize, f32> = HashMap::new();
        let query_tokens = tokens(
            &query
                .replace("shcs", "socket head cap screw")
                .replace("bhcs", "button socket cap screw")
                .replace("hhb", "hex head bolt"),
        );
        let unique_query_tokens = query_tokens.into_iter().collect::<BTreeSet<_>>();

        for token in unique_query_tokens {
            let Some(postings) = self.inverted.get(&token) else {
                continue;
            };
            let df = postings.len() as f32;
            let idf = (((self.n_docs as f32 - df + 0.5) / (df + 0.5)) + 1.0).ln();
            for (doc_id, tf) in postings {
                let doc_len = self.doc_lengths[*doc_id] as f32;
                let tf = *tf as f32;
                let denom =
                    tf + self.k1 * (1.0 - self.b + self.b * doc_len / self.avg_doc_length.max(1.0));
                let contribution = idf * (tf * (self.k1 + 1.0)) / denom;
                *scores.entry(*doc_id).or_insert(0.0) += contribution;
            }
        }

        let mut ranked = if scores.is_empty() {
            (0..self.n_docs)
                .map(|doc_id| (doc_id, 0.0))
                .collect::<Vec<_>>()
        } else {
            scores.into_iter().collect::<Vec<_>>()
        };

        ranked.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(Ordering::Equal)
                .then_with(|| a.0.cmp(&b.0))
        });
        ranked.truncate(top_k);
        ranked
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{load_catalog, load_orders};
    use serde::Deserialize;
    use std::{fs, path::PathBuf};

    #[derive(Debug, Deserialize)]
    struct HardNegativeCase {
        query: String,
        customer_id: Option<String>,
        expected_decision: Option<String>,
        must_not_auto_order_if_top_contains: Option<Vec<String>>,
        expected_review_reason: Option<String>,
        expected_evidence: Option<String>,
        must_parse_thread_as: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    struct GoldenCase {
        query: String,
        customer_id: Option<String>,
        top3: Vec<String>,
        decision: String,
        validation_decision: String,
        top_can_auto_order: bool,
        customer_history_influenced: bool,
        expected_preference_applied: bool,
    }

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../data")
            .join(name)
    }

    fn matcher() -> Matcher {
        Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        )
    }

    #[test]
    fn returns_reasonable_top_three_for_examples() {
        let matcher = Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        );
        let response = matcher.search("M8 flat washer", None);
        assert_eq!(response.results.len(), 3);
        assert!(response.results[0]
            .description
            .to_ascii_lowercase()
            .contains("m8"));
        assert!(response.results[0]
            .description
            .to_ascii_lowercase()
            .contains("washer"));
    }

    #[test]
    fn personalization_changes_reference_queries() {
        let matcher = Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        );
        let response = matcher.search("the same washers as last time", Some("CUST-001"));
        assert!(response.results.iter().any(|result| result.personalized));
    }

    #[test]
    fn repair_context_rewrites_before_matching() {
        let matcher = Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        );
        let response = matcher.search("screws for bottom of MacBook Pro", None);
        let context = response.repair_context.unwrap();
        assert_eq!(context.id, "macbook-bottom-case");
        assert_eq!(response.query.original, "screws for bottom of MacBook Pro");
        assert!(matches!(context.match_behavior, MatchBehavior::GuidanceOnly));
        assert!(response.results.is_empty());
        assert!(response.meta.no_verified_stocked_match);
        assert_eq!(response.decision, "guidance-only");
    }

    #[test]
    fn direct_spec_query_has_no_repair_context() {
        let matcher = Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        );
        let response = matcher.search("M8 flat washer", None);
        assert!(response.repair_context.is_none());
    }

    #[test]
    fn exact_direct_query_exposes_separate_closeness_and_confidence() {
        let matcher = Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        );
        let response = matcher.search("M8 flat washer", None);
        let top = response.results.first().unwrap();
        assert!(top.score <= 1.25);
        assert!((0.0..=1.0).contains(&top.model_closeness));
        assert!((0.90..=1.0).contains(&top.confidence));
        assert!(top.match_evidence.iter().any(|item| item == "Thread M8 matched"));
        assert!(top.match_evidence.iter().any(|item| item == "Type flat washer matched"));
        assert!(top.contradictions.is_empty());
    }

    #[test]
    fn customer_reference_can_clear_ready_gate_with_prior_sku() {
        let matcher = Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        );
        let response = matcher.search("the same washers as last time", Some("CUST-001"));
        let top = response.results.first().unwrap();
        assert!(top.personalized);
        assert!(top.confidence >= 0.90);
        assert!(top.can_auto_order);
        assert!(response.results.iter().skip(1).all(|result| !result.can_auto_order));
    }

    #[test]
    fn weak_query_routes_to_sales_review() {
        let matcher = Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        );
        let response = matcher.search("washer", None);
        let top = response.results.first().unwrap();
        assert!(top.confidence < 0.90);
        assert_eq!(response.decision, "sales-review");
    }

    #[test]
    fn hard_thread_contradiction_caps_confidence() {
        let query = parse_query("M8 flat washer");
        let candidate = parse_catalog_row("M6-1.0 FLAT WASHER STEEL PLAIN");
        let (_, matches) = attribute_score(&query, &candidate);
        let analysis = analyze_evidence(&query, &candidate, &matches, None, None, 0.20, false);
        assert!(analysis.has_hard_contradiction);
        assert!(analysis
            .contradictions
            .iter()
            .any(|item| item.field == "thread" && item.severity == "hard"));
        let capped = confidence(1.0, 1.0, 0.2, 0.72, 0.5, false).min(0.40);
        assert!(capped <= 0.40);
    }

    #[test]
    fn material_mismatch_is_soft_review_reason() {
        let query = parse_query("M8 brass flat washer");
        let candidate = parse_catalog_row("M8-1.25 FLAT WASHER STEEL YELLOW ZINC");
        let (_, matches) = attribute_score(&query, &candidate);
        let analysis = analyze_evidence(&query, &candidate, &matches, None, None, 0.20, false);
        assert!(!analysis.has_hard_contradiction);
        assert!(analysis.has_soft_contradiction);
        assert!(analysis
            .review_reasons
            .iter()
            .any(|item| item == "Material mismatch needs review"));
    }

    #[test]
    fn length_missing_is_soft_review_reason() {
        let query = parse_query("M8 x 10mm flat washer");
        let candidate = parse_catalog_row("M8-1.25 FLAT WASHER STEEL YELLOW ZINC");
        let (_, matches) = attribute_score(&query, &candidate);
        let analysis = analyze_evidence(&query, &candidate, &matches, None, None, 0.20, false);
        assert!(analysis.has_soft_contradiction);
        assert!(analysis
            .contradictions
            .iter()
            .any(|item| item.field == "length" && item.severity == "soft"));
    }

    #[test]
    fn bike_repair_context_still_returns_catalog_matches() {
        let matcher = Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        );
        let response = matcher.search("bike bottle cage bolts stainless", None);
        let context = response.repair_context.unwrap();
        assert!(matches!(context.match_behavior, MatchBehavior::CatalogMatch));
        assert_eq!(response.results.len(), 3);
    }

    #[test]
    fn deterministic_queries_keep_same_top_three_across_cold_construction() {
        let queries = [
            ("washer", None),
            ("bolt", None),
            ("same washers as last time", Some("CUST-001")),
            ("M8 flat washer", None),
            ("M8 steel flat washer", None),
        ];

        for (query, customer_id) in queries {
            let expected = matcher()
                .search(query, customer_id)
                .results
                .into_iter()
                .map(|result| result.sku)
                .collect::<Vec<_>>();
            for _ in 0..25 {
                let actual = matcher()
                    .search(query, customer_id)
                    .results
                    .into_iter()
                    .map(|result| result.sku)
                    .collect::<Vec<_>>();
                assert_eq!(actual, expected, "top3 drifted for {query}");
            }
        }
    }

    #[test]
    fn hard_negative_cases_are_wired_into_safety_tests() {
        let cases = fs::read_to_string(fixture("hard_negative_cases.json")).unwrap();
        let cases = serde_json::from_str::<Vec<HardNegativeCase>>(&cases).unwrap();
        let matcher = matcher();

        for case in cases {
            let response = matcher.search(&case.query, case.customer_id.as_deref());
            if let Some(expected) = case.expected_decision.as_deref() {
                assert_eq!(response.decision, expected, "decision mismatch for {}", case.query);
            }
            if let Some(expected) = case.must_parse_thread_as.as_deref() {
                assert_eq!(
                    response.query.parsed.thread_spec.as_deref(),
                    Some(expected),
                    "thread parse mismatch for {}",
                    case.query
                );
            }
            if let Some(reason) = case.expected_review_reason.as_deref() {
                let found = response
                    .results
                    .iter()
                    .any(|result| result.review_reasons.iter().any(|item| item == reason));
                assert!(found, "missing review reason {reason:?} for {}", case.query);
            }
            if let Some(evidence) = case.expected_evidence.as_deref() {
                let found = response
                    .results
                    .iter()
                    .any(|result| result.match_evidence.iter().any(|item| item == evidence));
                assert!(found, "missing evidence {evidence:?} for {}", case.query);
            }
            if let Some(patterns) = case.must_not_auto_order_if_top_contains.as_ref() {
                if let Some(top) = response.results.first() {
                    let top_description = top.description.to_ascii_lowercase();
                    if patterns
                        .iter()
                        .any(|pattern| top_description.contains(&pattern.to_ascii_lowercase()))
                    {
                        assert!(!top.can_auto_order, "unsafe auto-order for {}", case.query);
                    }
                }
            }
            if case.query == "M8 steel flat washer" {
                let top = response.results.first().unwrap();
                assert_eq!(response.decision, "sales-review");
                assert_eq!(response.validation.decision, "SALES_REVIEW");
                assert!(!top.can_auto_order);
                assert!(top.confidence < 0.90);
            }
        }
    }

    #[test]
    fn golden_cases_lock_rust_matcher_outputs_for_js_parity() {
        let cases = fs::read_to_string(fixture("demo_golden_cases.json")).unwrap();
        let cases = serde_json::from_str::<Vec<GoldenCase>>(&cases).unwrap();
        let matcher = matcher();

        for case in cases {
            let response = matcher.search(&case.query, case.customer_id.as_deref());
            let top3 = response
                .results
                .iter()
                .map(|result| result.sku.clone())
                .collect::<Vec<_>>();
            assert_eq!(top3, case.top3, "top3 mismatch for {}", case.query);
            assert_eq!(response.decision, case.decision, "decision mismatch for {}", case.query);
            assert_eq!(
                response.validation.decision, case.validation_decision,
                "validation mismatch for {}",
                case.query
            );
            assert_eq!(
                response
                    .results
                    .first()
                    .map(|result| result.can_auto_order)
                    .unwrap_or(false),
                case.top_can_auto_order,
                "auto-order mismatch for {}",
                case.query
            );
            assert_eq!(
                response.validation.customer_history_influenced,
                case.customer_history_influenced,
                "history influence mismatch for {}",
                case.query
            );
            assert_eq!(
                response
                    .customer_preferences
                    .iter()
                    .any(|preference| preference.applied_to_query),
                case.expected_preference_applied,
                "preference application mismatch for {}",
                case.query
            );
        }
    }

    #[test]
    fn validation_and_preferences_cover_kasyap_scenarios() {
        let matcher = matcher();
        let omitted = matcher.search("1/4-20 hex cap screw", Some("CUST-001"));
        assert_eq!(omitted.validation.decision, "AUTO_RESPOND");
        assert!(omitted.validation.customer_history_influenced);
        assert!(omitted
            .customer_preferences
            .iter()
            .any(|preference| preference.scope == "product_family:hex-cap-screw"
                && preference.attribute == "finish"
                && preference.value == "zinc"
                && preference.applied_to_query));

        let explicit = matcher.search("1/4-20 black oxide hex cap screw", Some("CUST-001"));
        assert_eq!(explicit.validation.decision, "AUTO_RESPOND");
        assert!(explicit
            .customer_preferences
            .iter()
            .any(|preference| preference.scope == "product_family:hex-cap-screw"
                && preference.attribute == "finish"
                && preference.value == "zinc"
                && !preference.applied_to_query));

        let sparse = matcher.search("M8 flat washer", None);
        assert!(!sparse.validation.customer_history_influenced);
        assert!(sparse.customer_preferences.is_empty());
    }

    #[test]
    fn eval_diagnostics_group_customer_and_attribute_metrics() {
        let diagnostics = matcher().eval_diagnostics();
        assert_eq!(diagnostics.total_cases, 7);
        assert_eq!(diagnostics.global_accuracy, 1.0);
        assert!(diagnostics.review_routing_rate > 0.0);
        assert!(diagnostics
            .by_customer
            .iter()
            .any(|metric| metric.key == "CUST-001"));
        assert!(diagnostics
            .by_attribute_type
            .iter()
            .any(|metric| metric.key == "hard-negative" && metric.review_routing_rate == 1.0));
    }
}
