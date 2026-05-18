use crate::{
    auth::{AuthError, AuthVerifier},
    search::{EvalDiagnostics, Matcher, SearchResponse},
};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub catalog_size: usize,
    pub boot_time_ms: f64,
    pub matcher: Matcher,
    pub auth: Option<AuthVerifier>,
    pub demo_mode: bool,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub catalog_size: usize,
    pub boot_time_ms: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub use_personalization: Option<bool>,
    pub customer_id: Option<String>,
}

pub async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        catalog_size: state.catalog_size,
        boot_time_ms: (state.boot_time_ms * 10.0).round() / 10.0,
    })
}

pub async fn eval(State(state): State<Arc<AppState>>) -> Result<Json<EvalDiagnostics>, ApiError> {
    if !state.demo_mode {
        return Err(ApiError::forbidden(
            "diagnostics_disabled",
            "diagnostics are available only in demo mode",
        ));
    }

    Ok(Json(state.matcher.eval_diagnostics()))
}

pub async fn customers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::profile::CustomerSummary>>, ApiError> {
    if state.demo_mode {
        return Ok(Json(state.matcher.customers()));
    }

    let user = authenticate(&state, &headers).await?;
    let customer = state.matcher.customer(&user.customer_id).ok_or_else(|| {
        ApiError::forbidden(
            "unknown_customer",
            "authenticated customer is not authorized",
        )
    })?;
    Ok(Json(vec![customer]))
}

pub async fn search(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(request): Json<SearchRequest>,
) -> Result<Json<SearchResponse>, ApiError> {
    let query = request.query.trim();
    if query.is_empty() {
        return Err(ApiError::bad_request("query_required", "query is required"));
    }

    if state.demo_mode {
        let customer_id = demo_customer_id(&state.matcher, &request)?;
        return Ok(Json(state.matcher.search(query, customer_id.as_deref())));
    }

    let user = authenticate(&state, &headers).await?;
    if state.matcher.customer(&user.customer_id).is_none() {
        return Err(ApiError::forbidden(
            "unknown_customer",
            "authenticated customer is not authorized",
        ));
    }

    let customer_id = if request.use_personalization.unwrap_or(true) {
        Some(user.customer_id.as_str())
    } else {
        None
    };
    Ok(Json(state.matcher.search(query, customer_id)))
}

async fn authenticate(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<crate::auth::AuthenticatedUser, ApiError> {
    let auth = state.auth.as_ref().ok_or_else(|| {
        ApiError::server_error("auth_not_configured", "authentication is not configured")
    })?;
    Ok(auth.authenticate(headers).await?)
}

fn demo_customer_id(
    matcher: &Matcher,
    request: &SearchRequest,
) -> Result<Option<String>, ApiError> {
    if request.use_personalization == Some(false) {
        return Ok(None);
    }
    let Some(customer_id) = request
        .customer_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    if matcher.customer(customer_id).is_none() {
        return Err(ApiError::forbidden(
            "unknown_customer",
            "requested demo customer is not available",
        ));
    }
    Ok(Some(customer_id.to_string()))
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: &'static str,
}

impl ApiError {
    fn bad_request(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
            message,
        }
    }

    fn forbidden(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code,
            message,
        }
    }

    fn server_error(code: &'static str, message: &'static str) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code,
            message,
        }
    }
}

impl From<AuthError> for ApiError {
    fn from(error: AuthError) -> Self {
        Self {
            status: error.status,
            code: error.code,
            message: error.message,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({
                "error": self.message,
                "code": self.code,
            })),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        auth::{AuthConfig, AuthVerifier},
        types::{load_catalog, load_orders},
    };
    use axum::{extract::State, http::header};
    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
    use serde_json::json;
    use std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };
    use tokio::task::JoinHandle;

    const ISSUER: &str = "https://issuer.example";
    const AUDIENCE: &str = "catalog-api";
    const PRIVATE_KEY: &str = r#"-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAtioq48Cl8PNRvpVGPaZlBTzxz09UkZwrKW8lYyG0rPsbeXmR
Orh03gfbQyvrVxWQaAxcEcvk6WbirzVIlwNBHJ5braBsSGgyerRXQiyVQYRWdyjS
nKAvnx2pauumAJNu+pnan5Nqca6PFZ+RJnevIv6VcBnvqNcVUAn4k1AzjDcPn6/4
l8VFj5ZTK3W0r8NxViE8Jpq9oN/CfIQX/uSawgwyHMW1tKOWXZbt7W2o2iYXLP+m
R/JejgpnftSgRdILImr1P5qK+VlrqnYn/YxnOORguBw4nboiM0WcWONzGqPIyBhd
o8nAqeMFlZ308p/ZHT+qI3NmMu6R0/0VEXgRsQIDAQABAoIBAA1fuCljbetsOb6n
v/HrwvPo/wnM1bUhBYwztEd8ZILkpqY69h4dB7t7US4zzcHle+YfrizCTuqR2qep
Xkxz+TZMLAfpxLlmKPqYPeXGVyjpud1iul+0ZPqmF1eZuGTHbjjozcO0c3aoLaoV
PndYBxwnG7qQtOcs70wih0TtePNcwcfJegPyg6WLFvEbSh1ZqiWX/UorldeaZFdc
jy/njCHRdGGjGkvp1rAkLykoA3+NjS21V1xw4fSoe0nUWelnOzPxuqPQ/BPA2tVG
e5ANcfy5JJuS44FKMTLQwBQ+Qfd4hvR4jsXh8A0QLN39kw8yhN0TldPkeJytyQCq
PwRFUR8CgYEA3uuy/p/sC7HJoGQBDEb/le3TMam/vvADwX9zpQWk+O01EeOuRNnq
ixCnSHYGELpkMbyfvlV9RLTgrJUVcAUAk6k7GPFhewrF53CiAjloBjuJHf2P/2s0
H5HlWHfnOYJrD/rtXD8vu5EQugB7FneBTlFKAuWjhWXZlPUr5faYjQcCgYEA0TI7
Zb2c9ySoQM0+Kcxnn/Z2skpepvHCEaezY7SZu/0+3d7UI5Jve0zIhiL7+ib9olUh
1nQ2q105KaT/V4g9Ty/tFS4iFT1ngrqtLs8ukNASRW5AMCSSs1OeTw1ru7lXsQ9h
y2RnelYF1C4Gv0LgZP0msAWH6r4cKTGJ/CIC9YcCgYEAwMtIez8Efvi8UKMs5Nli
ouCVDxaoZxJdrTP1aHuBOmisxVQMnC970doNU3X/uOf7T6i633pAZPOqfJhTehZZ
cVujaOcaT7f5gTjAZPwRI5LJ+84Yg+bLpaIgoGrS58ILpj52mplrRuUnejaAPeYN
Rxa209qXmf+ENnf0B2dGeHECgYEAlhEnxNtZj3zvadUR4+Aq8fhWu51X+wBwjEO2
Dy9OHSoVAApKOd5hNJ0nN/o+sftodRwG8xVY5mMwj2w6c+tat8SUmV4Hux7ac1BA
zdR3/hAVG1N0nlSOHDA+30ysXPUfL/ft2n8DMCInekcuNePenvNu3lSJZN7Nyssr
xgAMCV8CgYAxeep7iWKnPw6+xf2e+bzl5EEeqeKyU9f7aZirg5xP8u72RLABzgdI
H28U8zLPKfx2VjK83PtuDSV1O8D81oZ/riRMBOTro5V9qsOifujbMVqbSfBSl8eV
D+W8cE32hSqV7/7CO8n84HROR30MkUR3T873uyPbqWtU6svKUFCSQw==
-----END RSA PRIVATE KEY-----"#;
    const PUBLIC_N: &str = "tioq48Cl8PNRvpVGPaZlBTzxz09UkZwrKW8lYyG0rPsbeXmROrh03gfbQyvrVxWQaAxcEcvk6WbirzVIlwNBHJ5braBsSGgyerRXQiyVQYRWdyjSnKAvnx2pauumAJNu-pnan5Nqca6PFZ-RJnevIv6VcBnvqNcVUAn4k1AzjDcPn6_4l8VFj5ZTK3W0r8NxViE8Jpq9oN_CfIQX_uSawgwyHMW1tKOWXZbt7W2o2iYXLP-mR_JejgpnftSgRdILImr1P5qK-VlrqnYn_YxnOORguBw4nboiM0WcWONzGqPIyBhdo8nAqeMFlZ308p_ZHT-qI3NmMu6R0_0VEXgRsQ";
    const PUBLIC_E: &str = "AQAB";

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../data")
            .join(name)
    }

    async fn test_state() -> (Arc<AppState>, JoinHandle<()>) {
        let (jwks_url, handle) = spawn_jwks().await;
        let matcher = Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        );
        let auth = AuthVerifier::new(AuthConfig::new(ISSUER, AUDIENCE, jwks_url, "customer_id"));
        (
            Arc::new(AppState {
                catalog_size: 1000,
                boot_time_ms: 1.0,
                matcher,
                auth: Some(auth),
                demo_mode: false,
            }),
            handle,
        )
    }

    fn demo_state() -> Arc<AppState> {
        let matcher = Matcher::new(
            load_catalog(&fixture("catalog.csv")).unwrap(),
            load_orders(&fixture("order_history.csv")).unwrap(),
        );
        Arc::new(AppState {
            catalog_size: 1000,
            boot_time_ms: 1.0,
            matcher,
            auth: None,
            demo_mode: true,
        })
    }

    async fn spawn_jwks() -> (String, JoinHandle<()>) {
        let app = axum::Router::new().route(
            "/jwks",
            axum::routing::get(|| async {
                Json(json!({
                    "keys": [{
                        "kty": "RSA",
                        "kid": "test-key",
                        "use": "sig",
                        "alg": "RS256",
                        "n": PUBLIC_N,
                        "e": PUBLIC_E
                    }]
                }))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{addr}/jwks"), handle)
    }

    fn headers(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {token}").parse().unwrap(),
        );
        headers
    }

    fn token(customer_id: Option<&str>, audience: &str) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("test-key".to_string());
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let mut claims = json!({
            "iss": ISSUER,
            "aud": audience,
            "exp": now + 3600
        });
        if let Some(customer_id) = customer_id {
            claims["customer_id"] = json!(customer_id);
        }
        encode(
            &header,
            &claims,
            &EncodingKey::from_rsa_pem(PRIVATE_KEY.as_bytes()).unwrap(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn search_rejects_invalid_auth_cases() {
        let (state, handle) = test_state().await;
        let request = SearchRequest {
            query: "M8 flat washer".to_string(),
            use_personalization: Some(true),
            customer_id: None,
        };

        let missing = search(
            State(state.clone()),
            HeaderMap::new(),
            Json(request.clone()),
        )
        .await
        .unwrap_err();
        assert_eq!(missing.status, StatusCode::UNAUTHORIZED);

        let invalid = search(
            State(state.clone()),
            headers("not-a-jwt"),
            Json(request.clone()),
        )
        .await
        .unwrap_err();
        assert_eq!(invalid.status, StatusCode::UNAUTHORIZED);

        let wrong_audience = search(
            State(state.clone()),
            headers(&token(Some("CUST-001"), "other-api")),
            Json(request.clone()),
        )
        .await
        .unwrap_err();
        assert_eq!(wrong_audience.status, StatusCode::UNAUTHORIZED);

        let missing_customer = search(
            State(state.clone()),
            headers(&token(None, AUDIENCE)),
            Json(request.clone()),
        )
        .await
        .unwrap_err();
        assert_eq!(missing_customer.status, StatusCode::FORBIDDEN);

        let unknown_customer = search(
            State(state),
            headers(&token(Some("CUST-999"), AUDIENCE)),
            Json(request),
        )
        .await
        .unwrap_err();
        assert_eq!(unknown_customer.status, StatusCode::FORBIDDEN);
        handle.abort();
    }

    #[tokio::test]
    async fn search_uses_authenticated_customer_and_ignores_body_customer_id() {
        let (state, handle) = test_state().await;
        let parsed_request: SearchRequest = serde_json::from_value(json!({
            "query": "same washers as last time",
            "customer_id": "CUST-002",
            "use_personalization": true
        }))
        .unwrap();

        let Json(response) = search(
            State(state.clone()),
            headers(&token(Some("CUST-001"), AUDIENCE)),
            Json(parsed_request),
        )
        .await
        .unwrap();

        let forbidden = state
            .matcher
            .search("same washers as last time", Some("CUST-002"))
            .results[0]
            .sku
            .clone();
        assert_ne!(response.results[0].sku, forbidden);
        assert!(response.results[0].personalized);
        handle.abort();
    }

    #[tokio::test]
    async fn use_personalization_false_returns_base_ranking() {
        let (state, handle) = test_state().await;
        let Json(response) = search(
            State(state),
            headers(&token(Some("CUST-001"), AUDIENCE)),
            Json(SearchRequest {
                query: "same washers as last time".to_string(),
                use_personalization: Some(false),
                customer_id: None,
            }),
        )
        .await
        .unwrap();

        assert!(response.results.iter().all(|result| !result.personalized));
        assert!(response
            .results
            .iter()
            .all(|result| result.personalization_note.is_none()));
        handle.abort();
    }

    #[tokio::test]
    async fn customers_returns_only_authenticated_customer() {
        let (state, handle) = test_state().await;
        let Json(response) = customers(State(state), headers(&token(Some("CUST-001"), AUDIENCE)))
            .await
            .unwrap();

        assert_eq!(response.len(), 1);
        assert_eq!(response[0].id, "CUST-001");
        handle.abort();
    }

    #[tokio::test]
    async fn demo_mode_returns_all_customers_without_auth() {
        let state = demo_state();
        let Json(response) = customers(State(state), HeaderMap::new()).await.unwrap();

        assert_eq!(response.len(), 5);
        assert_eq!(response[0].id, "CUST-001");
    }

    #[tokio::test]
    async fn eval_returns_demo_diagnostics() {
        let state = demo_state();
        let Json(response) = eval(State(state)).await.unwrap();

        assert_eq!(response.total_cases, 7);
        assert_eq!(response.global_accuracy, 1.0);
        assert!(response
            .by_customer
            .iter()
            .any(|metric| metric.key == "CUST-001"));
    }

    #[tokio::test]
    async fn eval_is_disabled_outside_demo_mode() {
        let (state, handle) = test_state().await;
        let error = eval(State(state)).await.unwrap_err();

        assert_eq!(error.status, StatusCode::FORBIDDEN);
        assert_eq!(error.code, "diagnostics_disabled");
        handle.abort();
    }

    #[tokio::test]
    async fn demo_mode_uses_requested_customer_id() {
        let state = demo_state();
        let Json(response) = search(
            State(state.clone()),
            HeaderMap::new(),
            Json(SearchRequest {
                query: "same washers as last time".to_string(),
                use_personalization: Some(true),
                customer_id: Some("CUST-001".to_string()),
            }),
        )
        .await
        .unwrap();

        let expected = state
            .matcher
            .search("same washers as last time", Some("CUST-001"))
            .results[0]
            .sku
            .clone();
        assert_eq!(response.results[0].sku, expected);
        assert!(response.results[0].personalized);
    }
}
