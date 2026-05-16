use crate::parser::normalize;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

static CONTEXTS: Lazy<Vec<RepairContextSeed>> = Lazy::new(|| {
    serde_json::from_str(include_str!("../../../data/repair_contexts.json"))
        .expect("repair_contexts.json must be valid")
});

#[derive(Debug, Clone, Deserialize)]
struct RepairContextSeed {
    id: String,
    category: String,
    title: String,
    triggers: Vec<String>,
    match_behavior: MatchBehavior,
    stock_status: StockStatus,
    canonical_query: Option<String>,
    recommended_part: Option<String>,
    recommended_tool: Option<String>,
    fitment_note: Option<String>,
    confidence: f32,
    status: RepairStatus,
    safety_class: SafetyClass,
    missing_facts: Vec<String>,
    clarifying_question: Option<ClarifyingQuestion>,
    kit: Vec<KitItem>,
    warnings: Vec<String>,
    provenance: Provenance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RepairStatus {
    Ready,
    NeedsClarification,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MatchBehavior {
    CatalogMatch,
    GuidanceOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StockStatus {
    StockedCandidates,
    NotStocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SafetyClass {
    Low,
    Caution,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Provenance {
    SeededDemo,
    Inferred,
    CustomerHistory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClarifyingQuestion {
    pub label: String,
    pub choices: Vec<ClarifyingChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClarifyingChoice {
    pub label: String,
    pub query_rewrite: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KitItem {
    pub label: String,
    pub quantity: u32,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResolvedRepairContext {
    pub detected: bool,
    pub id: String,
    pub category: String,
    pub title: String,
    pub status: RepairStatus,
    pub safety_class: SafetyClass,
    pub match_behavior: MatchBehavior,
    pub stock_status: StockStatus,
    pub canonical_query: Option<String>,
    pub recommended_part: Option<String>,
    pub recommended_tool: Option<String>,
    pub fitment_note: Option<String>,
    pub confidence: f32,
    pub missing_facts: Vec<String>,
    pub clarifying_question: Option<ClarifyingQuestion>,
    pub kit: Vec<KitItem>,
    pub warnings: Vec<String>,
    pub provenance: Provenance,
}

pub fn resolve_repair_context(query: &str) -> Option<ResolvedRepairContext> {
    let normalized = normalize(query);
    CONTEXTS
        .iter()
        .filter_map(|context| match_score(context, &normalized).map(|score| (context, score)))
        .max_by_key(|(_, score)| *score)
        .map(|(context, score)| {
            let choice_was_selected = context
                .clarifying_question
                .as_ref()
                .map(|question| {
                    question
                        .choices
                        .iter()
                        .any(|choice| normalize(&choice.query_rewrite) == normalized)
                })
                .unwrap_or(false);

            let mut status = context.status.clone();
            let mut missing_facts = context.missing_facts.clone();
            let mut clarifying_question = context.clarifying_question.clone();
            let mut confidence = context.confidence + (score as f32 * 0.015);

            if choice_was_selected {
                status = RepairStatus::Ready;
                missing_facts.clear();
                clarifying_question = None;
                confidence += 0.08;
            }

            ResolvedRepairContext {
                detected: true,
                id: context.id.clone(),
                category: context.category.clone(),
                title: context.title.clone(),
                status,
                safety_class: context.safety_class.clone(),
                match_behavior: context.match_behavior.clone(),
                stock_status: context.stock_status.clone(),
                canonical_query: context.canonical_query.clone(),
                recommended_part: context.recommended_part.clone(),
                recommended_tool: context.recommended_tool.clone(),
                fitment_note: context.fitment_note.clone(),
                confidence: round2(confidence.clamp(0.05, 0.95)),
                missing_facts,
                clarifying_question,
                kit: context.kit.clone(),
                warnings: context.warnings.clone(),
                provenance: context.provenance.clone(),
            }
        })
}

fn match_score(context: &RepairContextSeed, normalized: &str) -> Option<u32> {
    let mut score = 0;
    for trigger in &context.triggers {
        let trigger = normalize(trigger);
        if normalized.contains(&trigger) {
            score += trigger.split_whitespace().count().max(1) as u32;
        }
    }

    if score >= 1 {
        Some(score)
    } else {
        None
    }
}

fn round2(value: f32) -> f32 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_macbook_bottom_case() {
        let context = resolve_repair_context("screws for bottom of MacBook Pro").unwrap();
        assert_eq!(context.id, "macbook-bottom-case");
        assert!(matches!(context.status, RepairStatus::NeedsClarification));
        assert!(matches!(context.match_behavior, MatchBehavior::GuidanceOnly));
        assert_eq!(context.canonical_query, None);
        assert_eq!(
            context.recommended_tool.as_deref(),
            Some("P5 Pentalobe driver")
        );
    }

    #[test]
    fn selected_clarification_marks_context_ready() {
        let context =
            resolve_repair_context("MacBook Pro 14 2021 bottom case screws").unwrap();
        assert_eq!(context.id, "macbook-bottom-case");
        assert!(matches!(context.status, RepairStatus::Ready));
        assert!(matches!(context.match_behavior, MatchBehavior::GuidanceOnly));
        assert!(context.clarifying_question.is_none());
    }

    #[test]
    fn ordinary_fastener_query_has_no_context() {
        assert!(resolve_repair_context("M8 flat washer").is_none());
    }
}
