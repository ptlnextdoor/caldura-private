import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { Button, Panel } from './components/ui/primitives';

type AuthContextValue = {
  accessToken: string | null;
  configured: boolean;
  loading: boolean;
  user: User | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  completeSignIn: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function createUserManager() {
  const authority = import.meta.env.VITE_OIDC_AUTHORITY;
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID;
  const redirectUri = import.meta.env.VITE_OIDC_REDIRECT_URI ?? `${window.location.origin}/auth/callback`;
  if (!authority || !clientId) {
    return null;
  }

  return new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: window.location.origin,
    response_type: 'code',
    scope: import.meta.env.VITE_OIDC_SCOPE ?? 'openid profile',
    extraQueryParams: import.meta.env.VITE_OIDC_AUDIENCE
      ? { audience: import.meta.env.VITE_OIDC_AUDIENCE }
      : undefined,
    userStore: new WebStorageStateStore({ store: window.localStorage }),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const manager = useMemo(() => createUserManager(), []);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(manager));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!manager) return;
    let active = true;
    manager
      .getUser()
      .then((loadedUser) => {
        if (active) setUser(loadedUser && !loadedUser.expired ? loadedUser : null);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const onLoaded = (loadedUser: User) => setUser(loadedUser);
    const onUnloaded = () => setUser(null);
    manager.events.addUserLoaded(onLoaded);
    manager.events.addUserUnloaded(onUnloaded);
    return () => {
      active = false;
      manager.events.removeUserLoaded(onLoaded);
      manager.events.removeUserUnloaded(onUnloaded);
    };
  }, [manager]);

  const signIn = useCallback(async () => {
    if (!manager) {
      setError('OIDC is not configured');
      return;
    }
    await manager.signinRedirect();
  }, [manager]);
  const signOut = useCallback(async () => {
    if (!manager) return;
    await manager.signoutRedirect();
  }, [manager]);
  const completeSignIn = useCallback(async () => {
    if (!manager) {
      setError('OIDC is not configured');
      return;
    }
    const loadedUser = await manager.signinRedirectCallback();
    setUser(loadedUser);
  }, [manager]);

  const value: AuthContextValue = useMemo(
    () => ({
      accessToken: user && !user.expired ? user.access_token : null,
      configured: Boolean(manager),
      loading,
      user,
      error,
      signIn,
      signOut,
      completeSignIn,
    }),
    [completeSignIn, error, loading, manager, signIn, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}

export function AuthRequired({ title = 'Sign in required' }: { title?: string }) {
  const auth = useAuth();

  return (
    <Panel className="auth-panel" kicker="Authentication" title={title}>
      {!auth.configured ? (
        <p className="empty-copy">
          OIDC is not configured. Set VITE_OIDC_AUTHORITY and VITE_OIDC_CLIENT_ID for this
          environment.
        </p>
      ) : (
        <>
          <p className="empty-copy">
            Customer history is now scoped to the authenticated user. Sign in to search with your
            authorized customer context.
          </p>
          <Button onClick={() => void auth.signIn()}>Sign in</Button>
        </>
      )}
      {auth.error && <p className="error-copy">{auth.error}</p>}
    </Panel>
  );
}
