import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { PageSection, Panel } from '../components/ui/primitives';

export function AuthCallbackPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    auth
      .completeSignIn()
      .then(() => navigate('/', { replace: true }))
      .catch((err: Error) => setError(err.message));
  }, [auth, navigate]);

  return (
    <PageSection className="search-page" kicker="Authentication" title="Completing sign in.">
      <Panel>
        <p className={error ? 'error-copy' : 'empty-copy'}>
          {error ?? 'Validating your identity provider response.'}
        </p>
      </Panel>
    </PageSection>
  );
}
