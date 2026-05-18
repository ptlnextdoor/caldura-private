mod auth;
mod parser;
mod profile;
mod repair;
mod routes;
mod search;
mod types;

use anyhow::Context;
use auth::{AuthConfig, AuthVerifier};
use axum::{
    http::{header, HeaderValue, Method},
    Router,
};
use routes::{customers, health, search, AppState};
use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Instant};
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .compact()
        .init();

    let data_dir = std::env::var("CATALOG_DATA_DIR").unwrap_or_else(|_| "data".to_string());
    let catalog_path = PathBuf::from(&data_dir).join("catalog.csv");
    let orders_path = PathBuf::from(&data_dir).join("order_history.csv");

    let boot_started = Instant::now();
    let catalog = types::load_catalog(&catalog_path)
        .with_context(|| format!("failed to load {}", catalog_path.display()))?;
    let orders = types::load_orders(&orders_path)
        .with_context(|| format!("failed to load {}", orders_path.display()))?;
    let matcher = search::Matcher::new(catalog.clone(), orders.clone());
    let auth = AuthVerifier::new(AuthConfig::from_env()?);

    let state = Arc::new(AppState {
        catalog_size: catalog.len(),
        boot_time_ms: boot_started.elapsed().as_secs_f64() * 1000.0,
        matcher,
        auth,
    });

    let app = Router::new()
        .route("/health", axum::routing::get(health))
        .route("/api/health", axum::routing::get(health))
        .route("/customers", axum::routing::get(customers))
        .route("/api/customers", axum::routing::get(customers))
        .route("/search", axum::routing::post(search))
        .route("/api/search", axum::routing::post(search))
        .layer(cors_layer()?)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    info!("catalog server listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn cors_layer() -> anyhow::Result<CorsLayer> {
    let origins = std::env::var("APP_ORIGINS")
        .unwrap_or_else(|_| "http://127.0.0.1:5173,http://localhost:5173".to_string());
    cors_layer_from_origins(&origins)
}

fn cors_layer_from_origins(origins: &str) -> anyhow::Result<CorsLayer> {
    let origins = origins
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(|origin| origin.parse::<HeaderValue>())
        .collect::<Result<Vec<_>, _>>()?;
    if origins.is_empty() {
        anyhow::bail!("APP_ORIGINS must include at least one origin");
    }

    Ok(CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{header, Request, StatusCode},
        routing::get,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn cors_allows_configured_origin_and_rejects_other_origins() {
        let app = Router::new()
            .route("/ping", get(|| async { "ok" }))
            .layer(cors_layer_from_origins("https://app.example").unwrap());

        let allowed = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/ping")
                    .header(header::ORIGIN, "https://app.example")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
        assert_eq!(
            allowed
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            "https://app.example"
        );

        let rejected = app
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri("/ping")
                    .header(header::ORIGIN, "https://evil.example")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(rejected
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }
}
