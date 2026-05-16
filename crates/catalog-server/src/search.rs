use crate::{
    parser::{parse_catalog_row, parse_query, thread_matches, tokens},
    profile::{build_profiles, CustomerProfile, CustomerSummary},
    repair::{resolve_repair_context, MatchBehavior, ResolvedRepairContext, SafetyClass},
    types::{AttrSpec, CatalogRow, OrderRow},
};
use serde::Serialize;
use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
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

        candidates.sort_by(|a, b| {
            b.final_score
                .partial_cmp(&a.final_score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| {
                    b.attr_score
                        .partial_cmp(&a.attr_score)
                        .unwrap_or(Ordering::Equal)
                })
        });

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

        let results = candidates
            .iter()
            .take(3)
            .enumerate()
            .map(|(rank, candidate)| {
                let row = &self.catalog[candidate.idx];
                let confidence = confidence(
                    candidate.final_score,
                    top_score,
                    top_gap,
                    parsed.extraction_confidence,
                    candidate.attr_score,
                    reference_query && candidate.personalization_note.as_deref() == Some("matches previously ordered SKU"),
                );
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
                }
            })
            .collect::<Vec<_>>();
        let decision = decision_for(
            results.first().map(|result| result.confidence).unwrap_or(0.0),
            ambiguous_query,
            safety_blocked,
            top_prior_sku_reference,
        );

        let suggestions = if ambiguous_query || low_confidence_overall {
            build_suggestions(&parsed)
        } else {
            None
        };

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
            repair_context,
        }
    }
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
) -> &'static str {
    if confidence >= 0.90 && (!ambiguous_query || top_prior_sku_reference) && !safety_blocked {
        "ready-to-order"
    } else {
        "sales-review"
    }
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
        let unique_query_tokens = query_tokens.into_iter().collect::<HashSet<_>>();

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

        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        ranked.truncate(top_k);
        ranked
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{load_catalog, load_orders};
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../data")
            .join(name)
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
}
