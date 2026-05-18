import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { AuthRequired, useAuth } from '../auth';
import { fetchCustomers, type Customer } from '../api';
import { DataRow, MetricBadge, PageSection, Panel } from '../components/ui/primitives';
import { isDemoMode } from '../env';

const demoMode = isDemoMode();

export function CustomersPage() {
  const auth = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!demoMode && !auth.accessToken) return;
    fetchCustomers(demoMode ? null : auth.accessToken)
      .then(setCustomers)
      .catch((err: Error) => setError(err.message));
  }, [auth.accessToken]);

  const selected = customers[0];

  if (!demoMode && auth.loading) {
    return (
      <PageSection className="customers-page" kicker="Authentication" title="Checking session.">
        <Panel>
          <p className="empty-copy">Loading your identity provider session.</p>
        </Panel>
      </PageSection>
    );
  }

  if (!demoMode && !auth.accessToken) {
    return (
      <PageSection
        className="customers-page"
        copy="Customer history is now visible only to the authenticated customer."
        kicker="Personalization"
        title="Your customer history as a ranking signal."
      >
        <AuthRequired />
      </PageSection>
    );
  }

  return (
    <PageSection
      className="customers-page"
      copy="Inspect the lightweight customer profile that can bias your ambiguous searches without overwhelming catalog relevance."
      kicker="Personalization"
      title="Your customer history as a ranking signal."
    >
      <div className="hero-meta">
        <MetricBadge label={demoMode ? 'Demo profiles' : 'Authorized profile'} value={demoMode ? String(customers.length || 'Loading') : selected?.id ?? 'Loading'} />
        <MetricBadge label="Signal" value="Orders + SKU history" tone="green" />
        <MetricBadge label="Bias" value="Bounded additive" tone="muted" />
      </div>

      <section className="two-column-page">
        <Panel className="customer-directory" kicker="Access scope" title={demoMode ? 'Demo directory' : 'Only your profile is returned'}>
          {error && <p className="error-copy">{error}</p>}
          <p className="empty-copy">
            {demoMode
              ? 'Demo mode exposes the seeded customer directory so the stretch dropdown can be exercised without OIDC.'
              : 'The API no longer exposes a cross-customer directory. Search requests derive the customer context from your validated access token.'}
          </p>
        </Panel>

        <Panel className="customer-preview" kicker="Selected profile" title={selected?.id ?? 'No customer'}>
          {selected ? (
            <>
              <div className="preview-icon">
                <UserRound size={26} />
              </div>
              <DataRow label="Name" value={selected.name} />
              <DataRow label="Orders" value={selected.order_count} />
              <DataRow label="Profile" value={selected.profile_summary} />
              <Link
                className="btn btn-primary full-width-link"
                to={`/?q=${encodeURIComponent('the same washers as last time')}`}
              >
                Try reference query
              </Link>
            </>
          ) : (
            <p className="empty-copy">Customer data is loading.</p>
          )}
        </Panel>
      </section>
    </PageSection>
  );
}
