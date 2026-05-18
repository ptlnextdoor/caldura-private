use axum::http::HeaderMap;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use serde_json::Value;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::RwLock;

const JWKS_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub customer_id: String,
}

#[derive(Debug, Clone)]
pub struct AuthConfig {
    issuer: String,
    audience: String,
    jwks_url: String,
    customer_claim: String,
    allowed_algorithms: Vec<Algorithm>,
}

impl AuthConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let issuer = required_env("AUTH_ISSUER")?;
        let audience = required_env("AUTH_AUDIENCE")?;
        let jwks_url = required_env("AUTH_JWKS_URL")?;
        let customer_claim =
            std::env::var("AUTH_CUSTOMER_CLAIM").unwrap_or_else(|_| "customer_id".to_string());
        let allowed_algorithms = std::env::var("AUTH_ALLOWED_ALGS")
            .unwrap_or_else(|_| "RS256".to_string())
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_algorithm)
            .collect::<Result<Vec<_>, _>>()?;

        if allowed_algorithms.is_empty() {
            anyhow::bail!("AUTH_ALLOWED_ALGS must include at least one asymmetric algorithm");
        }

        Ok(Self {
            issuer,
            audience,
            jwks_url,
            customer_claim,
            allowed_algorithms,
        })
    }

    #[cfg(test)]
    pub fn new(
        issuer: impl Into<String>,
        audience: impl Into<String>,
        jwks_url: impl Into<String>,
        customer_claim: impl Into<String>,
    ) -> Self {
        Self {
            issuer: issuer.into(),
            audience: audience.into(),
            jwks_url: jwks_url.into(),
            customer_claim: customer_claim.into(),
            allowed_algorithms: vec![Algorithm::RS256],
        }
    }
}

#[derive(Clone)]
pub struct AuthVerifier {
    inner: Arc<AuthVerifierInner>,
}

struct AuthVerifierInner {
    config: AuthConfig,
    client: reqwest::Client,
    cache: RwLock<Option<CachedJwks>>,
}

#[derive(Clone)]
struct CachedJwks {
    value: Jwks,
    expires_at: Instant,
}

#[derive(Debug, Clone, Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}

#[derive(Debug, Clone, Deserialize)]
struct Jwk {
    kid: Option<String>,
    kty: String,
    alg: Option<String>,
    #[serde(rename = "use")]
    public_use: Option<String>,
    n: String,
    e: String,
}

#[derive(Debug)]
pub struct AuthError {
    pub status: axum::http::StatusCode,
    pub code: &'static str,
    pub message: &'static str,
}

impl AuthVerifier {
    pub fn new(config: AuthConfig) -> Self {
        Self {
            inner: Arc::new(AuthVerifierInner {
                config,
                client: reqwest::Client::new(),
                cache: RwLock::new(None),
            }),
        }
    }

    pub async fn authenticate(&self, headers: &HeaderMap) -> Result<AuthenticatedUser, AuthError> {
        let token = bearer_token(headers)?;
        let header = decode_header(token)
            .map_err(|_| unauthorized("invalid_token", "token is malformed"))?;
        if !self.inner.config.allowed_algorithms.contains(&header.alg)
            || header.alg != Algorithm::RS256
        {
            return Err(unauthorized(
                "invalid_algorithm",
                "token algorithm is not allowed",
            ));
        }

        let key = self
            .key_for_header(header.kid.as_deref(), header.alg)
            .await?;
        let mut validation = Validation::new(header.alg);
        validation.set_issuer(&[self.inner.config.issuer.as_str()]);
        validation.set_audience(&[self.inner.config.audience.as_str()]);

        let token_data = decode::<Value>(token, &key, &validation)
            .map_err(|_| unauthorized("invalid_token", "token validation failed"))?;
        let customer_id = token_data
            .claims
            .get(&self.inner.config.customer_claim)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| forbidden("missing_customer", "token is not mapped to a customer"))?
            .trim()
            .to_string();

        Ok(AuthenticatedUser { customer_id })
    }

    async fn key_for_header(
        &self,
        kid: Option<&str>,
        algorithm: Algorithm,
    ) -> Result<DecodingKey, AuthError> {
        if let Some(key) = find_jwk(&self.jwks(false).await?, kid, algorithm) {
            return decoding_key(key);
        }
        let refreshed = self.jwks(true).await?;
        let key = find_jwk(&refreshed, kid, algorithm)
            .ok_or_else(|| unauthorized("unknown_key", "token signing key is not recognized"))?;
        decoding_key(key)
    }

    async fn jwks(&self, force_refresh: bool) -> Result<Jwks, AuthError> {
        if !force_refresh {
            if let Some(cached) = self.inner.cache.read().await.as_ref() {
                if cached.expires_at > Instant::now() {
                    return Ok(cached.value.clone());
                }
            }
        }

        let response = self
            .inner
            .client
            .get(&self.inner.config.jwks_url)
            .send()
            .await
            .map_err(|_| server_error("jwks_unavailable", "authentication keys are unavailable"))?;
        if !response.status().is_success() {
            return Err(server_error(
                "jwks_unavailable",
                "authentication keys are unavailable",
            ));
        }
        let value = response
            .json::<Jwks>()
            .await
            .map_err(|_| server_error("jwks_invalid", "authentication keys are invalid"))?;
        *self.inner.cache.write().await = Some(CachedJwks {
            value: value.clone(),
            expires_at: Instant::now() + JWKS_CACHE_TTL,
        });
        Ok(value)
    }
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, AuthError> {
    let value = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| unauthorized("missing_token", "authorization bearer token is required"))?;
    value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| unauthorized("missing_token", "authorization bearer token is required"))
}

fn find_jwk<'a>(jwks: &'a Jwks, kid: Option<&str>, algorithm: Algorithm) -> Option<&'a Jwk> {
    jwks.keys.iter().find(|key| {
        key.kty == "RSA"
            && key.public_use.as_deref().is_none_or(|value| value == "sig")
            && key
                .alg
                .as_deref()
                .is_none_or(|value| value == algorithm_name(algorithm))
            && kid.is_none_or(|kid| key.kid.as_deref() == Some(kid))
    })
}

fn decoding_key(key: &Jwk) -> Result<DecodingKey, AuthError> {
    DecodingKey::from_rsa_components(&key.n, &key.e)
        .map_err(|_| server_error("jwks_invalid", "authentication keys are invalid"))
}

fn parse_algorithm(value: &str) -> anyhow::Result<Algorithm> {
    match value {
        "RS256" => Ok(Algorithm::RS256),
        "RS384" => Ok(Algorithm::RS384),
        "RS512" => Ok(Algorithm::RS512),
        other => anyhow::bail!("unsupported AUTH_ALLOWED_ALGS value: {other}"),
    }
}

fn algorithm_name(value: Algorithm) -> &'static str {
    match value {
        Algorithm::RS256 => "RS256",
        Algorithm::RS384 => "RS384",
        Algorithm::RS512 => "RS512",
        _ => "unsupported",
    }
}

fn required_env(name: &str) -> anyhow::Result<String> {
    std::env::var(name).map_err(|_| anyhow::anyhow!("{name} is required"))
}

fn unauthorized(code: &'static str, message: &'static str) -> AuthError {
    AuthError {
        status: axum::http::StatusCode::UNAUTHORIZED,
        code,
        message,
    }
}

fn forbidden(code: &'static str, message: &'static str) -> AuthError {
    AuthError {
        status: axum::http::StatusCode::FORBIDDEN,
        code,
        message,
    }
}

fn server_error(code: &'static str, message: &'static str) -> AuthError {
    AuthError {
        status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        code,
        message,
    }
}
