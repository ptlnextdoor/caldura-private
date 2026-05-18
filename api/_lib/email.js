import { intakeRequest } from './catalog.js';

const ACTION_BY_DECISION = {
  AUTO_RESPOND: 'DRAFT_CUSTOMER_CONFIRMATION',
  SALES_REVIEW: 'ESCALATE_SALES_REVIEW',
  DO_NOT_RESPOND: 'ESCALATE_BLOCKED_REQUEST',
};

export function emailPreview({ from_email, subject, body, customer_id = null }, config = {}) {
  const normalized = normalizeEmailConfig(config);
  const intake = intakeRequest(body, customer_id);
  const overallDecision = intake.overall_validation.decision;
  const recommended_action = ACTION_BY_DECISION[overallDecision];
  const delivery_guard = deliveryGuardFor(normalized, from_email, overallDecision);

  return {
    intake,
    recommended_action,
    customer_confirmation_draft: recommended_action === 'DRAFT_CUSTOMER_CONFIRMATION'
      ? buildCustomerConfirmationDraft(intake, from_email, subject)
      : null,
    internal_sales_draft: recommended_action === 'DRAFT_CUSTOMER_CONFIRMATION'
      ? null
      : buildInternalSalesDraft(intake, {
        from_email,
        subject,
        body,
        recommended_action,
        sales_rep_email: normalized.sales_rep_email,
      }),
    delivery_guard,
  };
}

export function normalizeEmailConfig(config = {}) {
  return {
    email_mode: config.email_mode === 'live' ? 'live' : 'preview',
    send_enabled: config.send_enabled === true,
    sales_rep_email: normalizedString(config.sales_rep_email),
    recipient_allowlist: [...new Set((config.recipient_allowlist ?? [])
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean))],
  };
}

function buildCustomerConfirmationDraft(intake, to, subject) {
  const lines = intake.lines.map((line, index) => {
    const top = line.results[0];
    const matchedSku = top ? `Matched SKU: ${top.sku}` : 'Matched SKU: pending review';
    const description = top ? `Catalog item: ${top.description}` : 'Catalog item: no verified stocked match';
    const note = line.validation.customer_history_influenced
      ? 'Note: customer order history influenced this match.'
      : null;
    return [
      `${index + 1}. ${lineLabel(line)}`,
      `   ${matchedSku}`,
      `   ${description}`,
      ...(note ? [`   ${note}`] : []),
    ].join('\n');
  });

  return {
    to,
    subject: replySubject(subject),
    body: [
      'Hi,',
      '',
      'Thanks for reaching out. I matched the following items from your request:',
      '',
      ...joinParagraphs(lines),
      '',
      'Please confirm these items look correct and I can prepare the next sales step.',
      '',
      'Best,',
      'Caldura Demo Sales',
    ].join('\n'),
  };
}

function buildInternalSalesDraft(intake, { from_email, subject, body, recommended_action, sales_rep_email }) {
  const blockedRequest = recommended_action === 'ESCALATE_BLOCKED_REQUEST';
  const lines = intake.lines.map((line, index) => {
    const top = line.results[0];
    const reviewReasons = top?.review_reasons?.length
      ? top.review_reasons.join('; ')
      : line.validation.reason;
    const missing = line.validation.missing_risky_attributes.length
      ? line.validation.missing_risky_attributes.join(', ')
      : 'none';
    const candidate = top
      ? [
        `   Top SKU: ${top.sku}`,
        `   Candidate: ${top.description}`,
        `   Review reasons: ${reviewReasons}`,
      ]
      : [
        '   Top SKU: none',
        '   Candidate: no verified stocked match',
        `   Review reasons: ${reviewReasons}`,
      ];
    const repairGuidance = line.repair_context
      ? compactRepairGuidance(line.repair_context)
      : null;

    return [
      `${index + 1}. ${lineLabel(line)}`,
      `   Validation: ${line.validation.decision} — ${line.validation.reason}`,
      `   Risky attributes: ${missing}`,
      ...candidate,
      ...(repairGuidance ? [`   Repair guidance: ${repairGuidance}`] : []),
      `   Internal note: ${line.validation.internal_note}`,
    ].join('\n');
  });

  return {
    to: sales_rep_email,
    subject: blockedRequest ? `Blocked request: ${subject}` : `Sales review needed: ${subject}`,
    body: [
      blockedRequest
        ? 'Customer request is blocked from automatic response and needs internal review.'
        : 'Customer request needs sales review before responding.',
      '',
      `Recommended action: ${recommended_action}`,
      `Overall validation: ${intake.overall_validation.decision}`,
      `Reason: ${intake.overall_validation.reason}`,
      '',
      'Original email:',
      `From: ${from_email}`,
      `Subject: ${subject}`,
      'Body:',
      body,
      '',
      'Parsed lines:',
      ...joinParagraphs(lines),
      '',
      blockedRequest
        ? 'Recommended next step: verify blocked lines and reply only after fitment or stocked-part review.'
        : 'Recommended next step: review the flagged lines before responding to the customer.',
      sales_rep_email
        ? `Escalation target: ${sales_rep_email}`
        : 'Escalation target: SALES_REP_EMAIL not configured; keep this draft in preview mode.',
    ].join('\n'),
  };
}

function deliveryGuardFor(config, fromEmail, validationDecision) {
  const recipient = String(fromEmail ?? '').trim().toLowerCase();
  const recipient_allowlisted = config.recipient_allowlist.includes(recipient);
  const blocked_reasons = [];

  if (config.email_mode !== 'live') {
    blocked_reasons.push('EMAIL_MODE is not live.');
  }
  if (!config.send_enabled) {
    blocked_reasons.push('EMAIL_SEND_ENABLED is false.');
  }
  if (validationDecision !== 'AUTO_RESPOND') {
    blocked_reasons.push(`Overall validation is ${validationDecision}.`);
  }
  if (!recipient_allowlisted) {
    blocked_reasons.push('Recipient is not in EMAIL_RECIPIENT_ALLOWLIST.');
  }

  return {
    email_mode: config.email_mode,
    send_enabled: config.send_enabled,
    recipient_allowlisted,
    can_send_customer_email: blocked_reasons.length === 0,
    blocked_reasons,
  };
}

function lineLabel(line) {
  const quantity = line.quantity == null
    ? null
    : line.unit
      ? `${line.quantity} ${line.unit}`
      : String(line.quantity);
  return quantity ? `${quantity} — ${line.normalized_query}` : line.normalized_query;
}

function replySubject(subject) {
  const trimmed = String(subject ?? '').trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

function compactRepairGuidance(repairContext) {
  return [
    repairContext.fitment_note,
    repairContext.recommended_part,
    repairContext.warnings?.[0],
  ]
    .filter(Boolean)
    .join(' | ');
}

function joinParagraphs(values) {
  return values.flatMap((value, index) => (index === 0 ? [value] : ['', value]));
}

function normalizedString(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}
