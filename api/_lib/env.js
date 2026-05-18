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
