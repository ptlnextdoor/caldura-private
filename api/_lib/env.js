export function isDemoMode() {
  const enabled = ['1', 'true', 'yes'].includes(
    String(process.env.DEMO_MODE ?? 'false').trim().toLowerCase(),
  );
  const appEnv = String(process.env.APP_ENV ?? '').trim().toLowerCase();
  const production = appEnv === 'prod' || appEnv === 'production';

  return enabled && !production;
}

export function emailSettings() {
  return {
    email_mode: normalizeEmailMode(process.env.EMAIL_MODE),
    send_enabled: truthy(process.env.EMAIL_SEND_ENABLED),
    sales_rep_email: normalizedString(process.env.SALES_REP_EMAIL),
    recipient_allowlist: String(process.env.EMAIL_RECIPIENT_ALLOWLIST ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function agentMailSettings() {
  return {
    api_key: normalizedString(process.env.AGENTMAIL_API_KEY),
    inbox_id: normalizedString(process.env.AGENTMAIL_INBOX_ID) ?? 'sales@ptlnextdoor.com',
    webhook_secret: normalizedString(process.env.AGENTMAIL_WEBHOOK_SECRET),
    base_url: normalizedString(process.env.AGENTMAIL_BASE_URL) ?? 'https://api.agentmail.to/v0',
  };
}

function truthy(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? 'false').trim().toLowerCase());
}

function normalizedString(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function normalizeEmailMode(value) {
  return String(value ?? 'preview').trim().toLowerCase() === 'live' ? 'live' : 'preview';
}
