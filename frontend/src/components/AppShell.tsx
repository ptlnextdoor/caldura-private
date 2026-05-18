import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { isDemoMode } from '../env';
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
      <FlowingLines />
      <nav className="top-nav" aria-label="Primary navigation">
        <div className="nav-inner">
          <NavLink className="brand" to="/">
            <LogoMark />
            <span>Catalog Match</span>
          </NavLink>
          <div className="nav-links">
            <NavLink to="/" end>
              Validate
            </NavLink>
            <NavLink to="/customers">Customers</NavLink>
            <NavLink to="/eval">Eval</NavLink>
            <NavLink to="/method">Method</NavLink>
          </div>
          <div className="auth-actions">
            {demoMode && <span className="demo-mode-badge">Demo Mode · Seeded Data Only</span>}
            {auth.accessToken ? (
              <>
                <span>{label}</span>
                <Button onClick={() => void auth.signOut()} variant="ghost">
                  Sign out
                </Button>
              </>
            ) : !demoMode ? (
              <Button disabled={!auth.configured || auth.loading} onClick={() => void auth.signIn()} variant="ghost">
                Sign in
              </Button>
            ) : null}
          </div>
        </div>
      </nav>
      <main className="app-shell">
        <Outlet />
      </main>
    </>
  );
}
