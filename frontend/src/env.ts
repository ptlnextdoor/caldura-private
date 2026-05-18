export function isDemoMode() {
  return ['1', 'true', 'yes'].includes(
    (import.meta.env.VITE_DEMO_MODE ?? 'false').trim().toLowerCase(),
  );
}
