import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { isDemoMode } from '../env';
import { LiquidGlass, LiquidGlassFilter } from './ui/liquid-glass';
import { Button } from './ui/primitives';

const demoMode = isDemoMode();

function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" role="img">
        <path d="M17.6 4h-3.2v9.2H4v3.2h10.4V28h3.2V16.4H28v-3.2H17.6V4Z" />
        <path d="M8.2 6.8 6 9l17.8 17.8 2.2-2.2L8.2 6.8Z" />
      </svg>
    </span>
  );
}

export function FlowingLines() {
  return (
    <div className="flowing-lines" aria-hidden="true">
      <div className="flowing-lines-inner">
        <span style={{ animationDelay: '0s' }} />
        <span style={{ animationDelay: '.8s' }} />
        <span style={{ animationDelay: '1.6s' }} />
      </div>
    </div>
  );
}

export function AppShell() {
  const auth = useAuth();
  const label = auth.user?.profile.name ?? auth.user?.profile.email ?? 'Signed in';

  return (
    <>
      <LiquidGlassFilter />
      <FlowingLines />
      <nav className="top-nav" aria-label="Primary navigation">
        <LiquidGlass className="nav-inner nav-glass" contentClassName="nav-inner-content" interactive>
          <NavLink className="brand" to="/">
            <LogoMark />
            <span>Catalog Match</span>
          </NavLink>
          <div className="nav-links">
            <NavLink to="/" end>
              Intake
            </NavLink>
            <NavLink to="/email">Email</NavLink>
            <NavLink to="/search">Search</NavLink>
            <NavLink to="/eval">Eval</NavLink>
            <NavLink to="/method">Method</NavLink>
          </div>
          <div className="auth-actions">
            {demoMode && <span className="demo-mode-badge">Paragon Data Workspace</span>}
            {auth.accessToken ? (
              <>
                <span>{label}</span>
                <Button onClick={() => void auth.signOut()} variant="ghost">
                  Sign out
                </Button>
              </>
            ) : !demoMode ? (
              auth.configured ? (
                <Button disabled={auth.loading} onClick={() => void auth.signIn()} variant="ghost">
                  Sign in
                </Button>
              ) : (
                <span className="auth-unconfigured">Auth not configured</span>
              )
            ) : null}
          </div>
        </LiquidGlass>
      </nav>
      <main className="app-shell">
        <Outlet />
      </main>
    </>
  );
}
