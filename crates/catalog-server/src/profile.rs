use crate::{
    parser::{parse_catalog_row, thread_matches},
    types::{AttrSpec, Finish, Material, OrderRow, ProductType},
};
use serde::Serialize;
use std::collections::HashMap;

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
    parsed_orders: Vec<AttrSpec>,
}

impl CustomerProfile {
    pub fn from_orders(id: String, name: String, orders: &[OrderRow]) -> Self {
        let mut sku_counts = HashMap::new();
        let mut product_counts = HashMap::new();
        let mut material_counts = HashMap::new();
        let mut finish_counts = HashMap::new();
        let mut parsed_orders = Vec::new();

        for order in orders {
            *sku_counts.entry(order.sku.clone()).or_insert(0) += order.quantity.max(1);
            let parsed = parse_catalog_row(&order.catalog_description);
            if let Some(value) = parsed.product_type {
                *product_counts.entry(value).or_insert(0) += order.quantity.max(1);
            }
            if let Some(value) = parsed.material {
                *material_counts.entry(value).or_insert(0) += order.quantity.max(1);
            }
            if let Some(value) = parsed.finish {
                *finish_counts.entry(value).or_insert(0) += order.quantity.max(1);
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
            if self.material_counts.contains_key(&material) {
                bias += 0.05;
                reasons.push("usual material");
            }
        }
        if let Some(finish) = candidate.finish {
            if self.finish_counts.contains_key(&finish) {
                bias += 0.04;
                reasons.push("usual finish");
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

fn top_key<T: Copy + Eq + std::hash::Hash>(counts: &HashMap<T, u32>) -> Option<T> {
    counts
        .iter()
        .max_by_key(|(_, count)| **count)
        .map(|(key, _)| *key)
}
