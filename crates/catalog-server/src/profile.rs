use crate::{
    parser::{parse_catalog_row, thread_matches},
    types::{AttrSpec, Finish, Material, OrderRow, ProductType},
};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct CustomerPreference {
    pub scope: String,
    pub attribute: &'static str,
    pub value: String,
    pub evidence_count: u32,
    pub total_count: u32,
    pub confidence: f32,
    pub applied_to_query: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CustomerSummary {
    pub id: String,
    pub name: String,
    pub order_count: usize,
    pub profile_summary: String,
}

#[derive(Debug, Clone)]
pub struct CustomerProfile {
    pub id: String,
    pub name: String,
    pub order_count: usize,
    pub sku_counts: HashMap<String, u32>,
    product_counts: HashMap<ProductType, u32>,
    material_counts: HashMap<Material, u32>,
    finish_counts: HashMap<Finish, u32>,
    product_material_counts: HashMap<ProductType, HashMap<Material, u32>>,
    product_finish_counts: HashMap<ProductType, HashMap<Finish, u32>>,
    parsed_orders: Vec<AttrSpec>,
}

impl CustomerProfile {
    pub fn from_orders(id: String, name: String, orders: &[OrderRow]) -> Self {
        let mut sku_counts = HashMap::new();
        let mut product_counts = HashMap::new();
        let mut material_counts = HashMap::new();
        let mut finish_counts = HashMap::new();
        let mut product_material_counts: HashMap<ProductType, HashMap<Material, u32>> = HashMap::new();
        let mut product_finish_counts: HashMap<ProductType, HashMap<Finish, u32>> = HashMap::new();
        let mut parsed_orders = Vec::new();

        for order in orders {
            let quantity = order.quantity.max(1);
            *sku_counts.entry(order.sku.clone()).or_insert(0) += order.quantity.max(1);
            let parsed = parse_catalog_row(&order.catalog_description);
            if let Some(value) = parsed.product_type {
                *product_counts.entry(value).or_insert(0) += quantity;
                if let Some(material) = parsed.material {
                    *product_material_counts
                        .entry(value)
                        .or_default()
                        .entry(material)
                        .or_insert(0) += quantity;
                }
                if let Some(finish) = parsed.finish {
                    *product_finish_counts
                        .entry(value)
                        .or_default()
                        .entry(finish)
                        .or_insert(0) += quantity;
                }
            }
            if let Some(value) = parsed.material {
                *material_counts.entry(value).or_insert(0) += quantity;
            }
            if let Some(value) = parsed.finish {
                *finish_counts.entry(value).or_insert(0) += quantity;
            }
            parsed_orders.push(parsed);
        }

        Self {
            id,
            name,
            order_count: orders.len(),
            sku_counts,
            product_counts,
            material_counts,
            finish_counts,
            product_material_counts,
            product_finish_counts,
            parsed_orders,
        }
    }

    pub fn summary(&self) -> CustomerSummary {
        let material = top_key(&self.material_counts).map(|value| value.to_string());
        let finish = top_key(&self.finish_counts).map(|value| value.to_string());
        let product = top_key(&self.product_counts).map(|value| value.to_string());
        let profile_summary = match (material, finish, product) {
            (Some(material), Some(finish), Some(product)) => {
                format!("mostly {material}, {finish}, frequent {product}")
            }
            _ => "mixed purchasing history".to_string(),
        };

        CustomerSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            order_count: self.order_count,
            profile_summary,
        }
    }

    pub fn preferences(
        &self,
        query: &AttrSpec,
        top_candidate: Option<&AttrSpec>,
    ) -> Vec<CustomerPreference> {
        let mut preferences = Vec::new();
        push_top_preference(
            &mut preferences,
            "global",
            "product_family",
            &self.product_counts,
            self.product_counts.values().sum(),
            query.product_type.is_none(),
            top_candidate.and_then(|candidate| candidate.product_type),
        );
        push_top_preference(
            &mut preferences,
            "global",
            "material",
            &self.material_counts,
            self.material_counts.values().sum(),
            query.material.is_none(),
            top_candidate.and_then(|candidate| candidate.material),
        );
        push_top_preference(
            &mut preferences,
            "global",
            "finish",
            &self.finish_counts,
            self.finish_counts.values().sum(),
            query.finish.is_none(),
            top_candidate.and_then(|candidate| candidate.finish),
        );

        if let Some(product) = query.product_type {
            if let Some(counts) = self.product_material_counts.get(&product) {
                push_top_preference(
                    &mut preferences,
                    &format!("product_family:{product}"),
                    "material",
                    counts,
                    counts.values().sum(),
                    query.material.is_none(),
                    top_candidate.and_then(|candidate| candidate.material),
                );
            }
            if let Some(counts) = self.product_finish_counts.get(&product) {
                push_top_preference(
                    &mut preferences,
                    &format!("product_family:{product}"),
                    "finish",
                    counts,
                    counts.values().sum(),
                    query.finish.is_none(),
                    top_candidate.and_then(|candidate| candidate.finish),
                );
            }
        }

        preferences
            .into_iter()
            .filter(|preference| preference.evidence_count >= 2 || preference.confidence >= 0.60)
            .take(6)
            .collect()
    }

    pub fn bias(
        &self,
        query: &AttrSpec,
        candidate_sku: &str,
        candidate: &AttrSpec,
        reference_query: bool,
    ) -> (f32, Option<String>) {
        let mut bias: f32 = 0.0;
        let mut reasons = Vec::new();

        if self.sku_counts.contains_key(candidate_sku) {
            bias += if reference_query { 0.16 } else { 0.07 };
            reasons.push("previously ordered SKU");
        }

        if let Some(product) = candidate.product_type {
            if self.product_counts.contains_key(&product) {
                bias += if query.product_type == Some(product) || reference_query {
                    0.08
                } else {
                    0.035
                };
                reasons.push("usual product family");
            }
        }
        if let Some(material) = candidate.material {
            if query.material.is_none() {
                if self.material_counts.contains_key(&material) {
                    bias += 0.035;
                    reasons.push("usual material");
                }
                if let Some(product) = candidate.product_type {
                    if self
                        .product_material_counts
                        .get(&product)
                        .and_then(top_key)
                        == Some(material)
                    {
                        bias += 0.04;
                        reasons.push("preferred product-family material");
                    }
                }
            }
        }
        if let Some(finish) = candidate.finish {
            if query.finish.is_none() {
                if self.finish_counts.contains_key(&finish) {
                    bias += 0.03;
                    reasons.push("usual finish");
                }
                if let Some(product) = candidate.product_type {
                    if self
                        .product_finish_counts
                        .get(&product)
                        .and_then(top_key)
                        == Some(finish)
                    {
                        bias += 0.045;
                        reasons.push("preferred product-family finish");
                    }
                }
            }
        }
        if candidate.thread_spec.is_some()
            && self
                .parsed_orders
                .iter()
                .any(|order| thread_matches(order, candidate))
        {
            bias += 0.025;
            reasons.push("familiar thread size");
        }

        (
            bias.min(0.22),
            reasons.first().map(|reason| format!("matches {reason}")),
        )
    }
}

pub fn build_profiles(orders: &[OrderRow]) -> HashMap<String, CustomerProfile> {
    let mut grouped: HashMap<String, Vec<OrderRow>> = HashMap::new();
    for order in orders {
        grouped
            .entry(order.customer_id.clone())
            .or_default()
            .push(order.clone());
    }

    grouped
        .into_iter()
        .map(|(id, rows)| {
            let name = rows
                .first()
                .map(|row| row.customer_name.clone())
                .unwrap_or_else(|| id.clone());
            let profile = CustomerProfile::from_orders(id.clone(), name, &rows);
            (id, profile)
        })
        .collect()
}

fn top_key<T: Copy + Eq + std::hash::Hash + std::fmt::Debug>(counts: &HashMap<T, u32>) -> Option<T> {
    counts
        .iter()
        .max_by(|(left_key, left_count), (right_key, right_count)| {
            left_count
                .cmp(right_count)
                .then_with(|| format!("{left_key:?}").cmp(&format!("{right_key:?}")).reverse())
        })
        .map(|(key, _)| *key)
}

fn push_top_preference<T>(
    preferences: &mut Vec<CustomerPreference>,
    scope: &str,
    attribute: &'static str,
    counts: &HashMap<T, u32>,
    total_count: u32,
    can_apply: bool,
    top_candidate_value: Option<T>,
) where
    T: Copy + Eq + std::hash::Hash + std::fmt::Display + std::fmt::Debug,
{
    if total_count == 0 {
        return;
    }
    let Some(value) = top_key(counts) else {
        return;
    };
    let evidence_count = *counts.get(&value).unwrap_or(&0);
    let confidence = evidence_count as f32 / total_count as f32;
    preferences.push(CustomerPreference {
        scope: scope.to_string(),
        attribute,
        value: value.to_string(),
        evidence_count,
        total_count,
        confidence: round3(confidence),
        applied_to_query: can_apply && top_candidate_value == Some(value),
    });
}

fn round3(value: f32) -> f32 {
    (value * 1000.0).round() / 1000.0
}
