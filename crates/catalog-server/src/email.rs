use crate::search::{IntakeLine, IntakeResponse};
use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Debug, Clone)]
pub struct EmailConfig {
    pub email_mode: String,
    pub send_enabled: bool,
    pub sales_rep_email: Option<String>,
    recipient_allowlist: BTreeSet<String>,
}

impl EmailConfig {
    pub fn from_env() -> Self {
        Self {
            email_mode: normalize_email_mode(std::env::var("EMAIL_MODE").ok().as_deref()),
            send_enabled: truthy(std::env::var("EMAIL_SEND_ENABLED").ok().as_deref()),
            sales_rep_email: normalized_string(std::env::var("SALES_REP_EMAIL").ok().as_deref()),
            recipient_allowlist: std::env::var("EMAIL_RECIPIENT_ALLOWLIST")
                .unwrap_or_default()
                .split(',')
                .map(|value| value.trim().to_ascii_lowercase())
                .filter(|value| !value.is_empty())
                .collect(),
        }
    }

    #[cfg(test)]
    pub fn new(
        email_mode: &str,
        send_enabled: bool,
        sales_rep_email: Option<&str>,
        recipient_allowlist: &[&str],
    ) -> Self {
        Self {
            email_mode: normalize_email_mode(Some(email_mode)),
            send_enabled,
            sales_rep_email: normalized_string(sales_rep_email),
            recipient_allowlist: recipient_allowlist
                .iter()
                .map(|value| value.trim().to_ascii_lowercase())
                .filter(|value| !value.is_empty())
                .collect(),
        }
    }

    fn recipient_allowlisted(&self, email: &str) -> bool {
        self.recipient_allowlist.contains(&email.trim().to_ascii_lowercase())
    }
}

#[derive(Debug, Serialize)]
pub struct EmailPreviewResponse {
    pub intake: IntakeResponse,
    pub recommended_action: &'static str,
    pub customer_confirmation_draft: Option<EmailDraft>,
    pub internal_sales_draft: Option<EmailDraft>,
    pub delivery_guard: DeliveryGuard,
}

#[derive(Debug, Serialize)]
pub struct EmailDraft {
    pub to: Option<String>,
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Serialize)]
pub struct DeliveryGuard {
    pub email_mode: String,
    pub send_enabled: bool,
    pub recipient_allowlisted: bool,
    pub can_send_customer_email: bool,
    pub blocked_reasons: Vec<String>,
}

pub fn build_email_preview_response(
    intake: IntakeResponse,
    from_email: &str,
    subject: &str,
    original_body: &str,
    config: &EmailConfig,
) -> EmailPreviewResponse {
    let recommended_action = recommended_action_for(intake.overall_validation.decision);
    let delivery_guard =
        delivery_guard_for(config, from_email, intake.overall_validation.decision);

    let customer_confirmation_draft = if recommended_action == "DRAFT_CUSTOMER_CONFIRMATION" {
        Some(build_customer_confirmation_draft(
            &intake, from_email, subject,
        ))
    } else {
        None
    };

    let internal_sales_draft = if recommended_action == "DRAFT_CUSTOMER_CONFIRMATION" {
        None
    } else {
        Some(build_internal_sales_draft(
            &intake,
            from_email,
            subject,
            original_body,
            recommended_action,
            config.sales_rep_email.as_deref(),
        ))
    };

    EmailPreviewResponse {
        intake,
        recommended_action,
        customer_confirmation_draft,
        internal_sales_draft,
        delivery_guard,
    }
}

fn recommended_action_for(decision: &str) -> &'static str {
    match decision {
        "AUTO_RESPOND" => "DRAFT_CUSTOMER_CONFIRMATION",
        "SALES_REVIEW" => "ESCALATE_SALES_REVIEW",
        _ => "ESCALATE_BLOCKED_REQUEST",
    }
}

fn build_customer_confirmation_draft(
    intake: &IntakeResponse,
    from_email: &str,
    subject: &str,
) -> EmailDraft {
    let mut body = String::from("Hi,\n\nThanks for reaching out. I matched the following items from your request:\n");
    for (index, line) in intake.lines.iter().enumerate() {
        let top = line.results.first();
        body.push_str("\n");
        body.push_str(&format!("{}. {}\n", index + 1, line_label(line)));
        if let Some(top) = top {
            body.push_str(&format!("   Matched SKU: {}\n", top.sku));
            body.push_str(&format!("   Catalog item: {}\n", top.description));
        } else {
            body.push_str("   Matched SKU: pending review\n");
            body.push_str("   Catalog item: no verified stocked match\n");
        }
        if line.validation.customer_history_influenced {
            body.push_str("   Note: customer order history influenced this match.\n");
        }
    }
    body.push_str(
        "\nPlease confirm these items look correct and I can prepare the next sales step.\n\nBest,\nCaldura Demo Sales",
    );

    EmailDraft {
        to: Some(from_email.to_string()),
        subject: reply_subject(subject),
        body,
    }
}

fn build_internal_sales_draft(
    intake: &IntakeResponse,
    from_email: &str,
    subject: &str,
    original_body: &str,
    recommended_action: &str,
    sales_rep_email: Option<&str>,
) -> EmailDraft {
    let blocked_request = recommended_action == "ESCALATE_BLOCKED_REQUEST";
    let mut body = if blocked_request {
        String::from(
            "Customer request is blocked from automatic response and needs internal review.\n",
        )
    } else {
        String::from("Customer request needs sales review before responding.\n")
    };
    body.push('\n');
    body.push_str(&format!("Recommended action: {recommended_action}\n"));
    body.push_str(&format!(
        "Overall validation: {}\n",
        intake.overall_validation.decision
    ));
    body.push_str(&format!("Reason: {}\n", intake.overall_validation.reason));
    body.push_str("\nOriginal email:\n");
    body.push_str(&format!("From: {from_email}\n"));
    body.push_str(&format!("Subject: {subject}\n"));
    body.push_str("Body:\n");
    body.push_str(original_body);
    body.push_str("\n\nParsed lines:\n");

    for (index, line) in intake.lines.iter().enumerate() {
        let top = line.results.first();
        let review_reasons = top
            .map(|result| {
                if result.review_reasons.is_empty() {
                    line.validation.reason.clone()
                } else {
                    result.review_reasons.join("; ")
                }
            })
            .unwrap_or_else(|| line.validation.reason.clone());
        let missing = if line.validation.missing_risky_attributes.is_empty() {
            "none".to_string()
        } else {
            line.validation.missing_risky_attributes.join(", ")
        };

        body.push('\n');
        body.push_str(&format!("{}. {}\n", index + 1, line_label(line)));
        body.push_str(&format!(
            "   Validation: {} — {}\n",
            line.validation.decision, line.validation.reason
        ));
        body.push_str(&format!("   Risky attributes: {missing}\n"));
        if let Some(top) = top {
            body.push_str(&format!("   Top SKU: {}\n", top.sku));
            body.push_str(&format!("   Candidate: {}\n", top.description));
        } else {
            body.push_str("   Top SKU: none\n");
            body.push_str("   Candidate: no verified stocked match\n");
        }
        body.push_str(&format!("   Review reasons: {review_reasons}\n"));
        if let Some(repair_guidance) = compact_repair_guidance(line) {
            body.push_str(&format!("   Repair guidance: {repair_guidance}\n"));
        }
        body.push_str(&format!(
            "   Internal note: {}\n",
            line.validation.internal_note
        ));
    }

    body.push('\n');
    if blocked_request {
        body.push_str(
            "Recommended next step: verify blocked lines and reply only after fitment or stocked-part review.\n",
        );
    } else {
        body.push_str(
            "Recommended next step: review the flagged lines before responding to the customer.\n",
        );
    }
    if let Some(sales_rep_email) = sales_rep_email {
        body.push_str(&format!("Escalation target: {sales_rep_email}"));
    } else {
        body.push_str(
            "Escalation target: SALES_REP_EMAIL not configured; keep this draft in preview mode.",
        );
    }

    EmailDraft {
        to: sales_rep_email.map(str::to_string),
        subject: if blocked_request {
            format!("Blocked request: {subject}")
        } else {
            format!("Sales review needed: {subject}")
        },
        body,
    }
}

fn delivery_guard_for(
    config: &EmailConfig,
    from_email: &str,
    validation_decision: &str,
) -> DeliveryGuard {
    let recipient_allowlisted = config.recipient_allowlisted(from_email);
    let mut blocked_reasons = Vec::new();

    if config.email_mode != "live" {
        blocked_reasons.push("EMAIL_MODE is not live.".to_string());
    }
    if !config.send_enabled {
        blocked_reasons.push("EMAIL_SEND_ENABLED is false.".to_string());
    }
    if validation_decision != "AUTO_RESPOND" {
        blocked_reasons.push(format!(
            "Overall validation is {validation_decision}."
        ));
    }
    if !recipient_allowlisted {
        blocked_reasons.push("Recipient is not in EMAIL_RECIPIENT_ALLOWLIST.".to_string());
    }

    DeliveryGuard {
        email_mode: config.email_mode.clone(),
        send_enabled: config.send_enabled,
        recipient_allowlisted,
        can_send_customer_email: blocked_reasons.is_empty(),
        blocked_reasons,
    }
}

fn line_label(line: &IntakeLine) -> String {
    let quantity = line.quantity.map(format_quantity);
    match (quantity, line.unit.as_deref()) {
        (Some(quantity), Some(unit)) => format!("{quantity} {unit} — {}", line.normalized_query),
        (Some(quantity), None) => format!("{quantity} — {}", line.normalized_query),
        (None, _) => line.normalized_query.clone(),
    }
}

fn compact_repair_guidance(line: &IntakeLine) -> Option<String> {
    line.repair_context.as_ref().map(|repair_context| {
        [
            repair_context.fitment_note.as_deref(),
            repair_context.recommended_part.as_deref(),
            repair_context.warnings.first().map(String::as_str),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" | ")
    }).filter(|value| !value.is_empty())
}

fn format_quantity(value: f64) -> String {
    value.to_string()
}

fn reply_subject(subject: &str) -> String {
    let trimmed = subject.trim();
    if trimmed.to_ascii_lowercase().starts_with("re:") {
        trimmed.to_string()
    } else {
        format!("Re: {trimmed}")
    }
}

fn truthy(value: Option<&str>) -> bool {
    matches!(
        value.map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if value == "1" || value == "true" || value == "yes"
    )
}

fn normalized_string(value: Option<&str>) -> Option<String> {
    let trimmed = value.unwrap_or_default().trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_email_mode(value: Option<&str>) -> String {
    if matches!(
        value.map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if value == "live"
    ) {
        "live".to_string()
    } else {
        "preview".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        search::Matcher,
        types::{load_catalog, load_orders},
    };
    use std::path::PathBuf;

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
    fn auto_respond_returns_customer_confirmation_draft_only() {
        let intake = matcher().intake("10 pcs 1/4-20 x 3/4 hex cap screw zinc", Some("CUST-001"));
        let response = build_email_preview_response(
            intake,
            "buyer@example.com",
            "Need cap screws",
            "10 pcs 1/4-20 x 3/4 hex cap screw zinc",
            &EmailConfig::new("preview", false, None, &[]),
        );

        assert_eq!(response.recommended_action, "DRAFT_CUSTOMER_CONFIRMATION");
        assert!(response.customer_confirmation_draft.is_some());
        assert!(response.internal_sales_draft.is_none());
    }

    #[test]
    fn sales_review_returns_internal_draft_only() {
        let intake = matcher().intake("25 M8 steel flat washer", Some("CUST-001"));
        let response = build_email_preview_response(
            intake,
            "buyer@example.com",
            "Need washers",
            "25 M8 steel flat washer",
            &EmailConfig::new("preview", false, Some("sales@example.com"), &[]),
        );

        assert_eq!(response.recommended_action, "ESCALATE_SALES_REVIEW");
        assert!(response.customer_confirmation_draft.is_none());
        assert_eq!(
            response.internal_sales_draft.as_ref().and_then(|draft| draft.to.as_deref()),
            Some("sales@example.com")
        );
    }

    #[test]
    fn blocked_request_returns_internal_draft_only() {
        let intake = matcher().intake("screws for bottom of MacBook Pro", Some("CUST-001"));
        let response = build_email_preview_response(
            intake,
            "buyer@example.com",
            "Need repair screws",
            "screws for bottom of MacBook Pro",
            &EmailConfig::new("preview", false, None, &[]),
        );

        assert_eq!(response.recommended_action, "ESCALATE_BLOCKED_REQUEST");
        assert!(response.customer_confirmation_draft.is_none());
        assert_eq!(
            response.internal_sales_draft.as_ref().map(|draft| draft.subject.as_str()),
            Some("Blocked request: Need repair screws")
        );
    }

    #[test]
    fn delivery_guard_enforces_live_send_conditions() {
        let intake = matcher().intake("10 pcs 1/4-20 x 3/4 hex cap screw zinc", Some("CUST-001"));

        let blocked = build_email_preview_response(
            intake,
            "buyer@example.com",
            "Need cap screws",
            "10 pcs 1/4-20 x 3/4 hex cap screw zinc",
            &EmailConfig::new("live", true, None, &["allowed@example.com"]),
        );
        assert!(!blocked.delivery_guard.recipient_allowlisted);
        assert!(!blocked.delivery_guard.can_send_customer_email);
        assert!(blocked
            .delivery_guard
            .blocked_reasons
            .iter()
            .any(|reason| reason == "Recipient is not in EMAIL_RECIPIENT_ALLOWLIST."));

        let allowed = build_email_preview_response(
            matcher().intake("10 pcs 1/4-20 x 3/4 hex cap screw zinc", Some("CUST-001")),
            "allowed@example.com",
            "Need cap screws",
            "10 pcs 1/4-20 x 3/4 hex cap screw zinc",
            &EmailConfig::new("live", true, None, &["allowed@example.com"]),
        );
        assert!(allowed.delivery_guard.recipient_allowlisted);
        assert!(allowed.delivery_guard.can_send_customer_email);
        assert!(allowed.delivery_guard.blocked_reasons.is_empty());
    }
}
