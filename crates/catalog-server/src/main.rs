mod parser;
mod profile;
mod repair;
mod routes;
mod search;
mod types;

use anyhow::Context;
use axum::Router;
use routes::{customers, health, search, AppState};
use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Instant};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
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

    let state = Arc::new(AppState {
        catalog_size: catalog.len(),
        boot_time_ms: boot_started.elapsed().as_secs_f64() * 1000.0,
        matcher,
    });

    let app = Router::new()
        .route("/health", axum::routing::get(health))
        .route("/api/health", axum::routing::get(health))
        .route("/customers", axum::routing::get(customers))
        .route("/api/customers", axum::routing::get(customers))
        .route("/search", axum::routing::post(search))
        .route("/api/search", axum::routing::post(search))
        .layer(CorsLayer::permissive())
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
