use crate::search::{Matcher, SearchResponse};
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub catalog_size: usize,
    pub boot_time_ms: f64,
    pub matcher: Matcher,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub catalog_size: usize,
    pub boot_time_ms: f64,
}

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub customer_id: Option<String>,
}

pub async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        catalog_size: state.catalog_size,
        boot_time_ms: (state.boot_time_ms * 10.0).round() / 10.0,
    })
}

pub async fn customers(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<crate::profile::CustomerSummary>> {
    Json(state.matcher.customers())
}

pub async fn search(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, (StatusCode, Json<serde_json::Value>)> {
    let query = request.query.trim();
    if query.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "query is required" })),
        ));
    }

    Ok(Json(
        state.matcher.search(query, request.customer_id.as_deref()),
    ))
}
