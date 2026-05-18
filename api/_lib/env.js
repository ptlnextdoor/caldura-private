export function isDemoMode() {
  const enabled = ['1', 'true', 'yes'].includes(
    String(process.env.DEMO_MODE ?? 'false').trim().toLowerCase(),
  );
  const appEnv = String(process.env.APP_ENV ?? '').trim().toLowerCase();
  const production = appEnv === 'prod' || appEnv === 'production';

  return enabled && !production;
}
