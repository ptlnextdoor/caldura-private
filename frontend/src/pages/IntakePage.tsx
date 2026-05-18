import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, Database, FileText, UserRound } from 'lucide-react';
import { AuthRequired, useAuth } from '../auth';
import { CustomerPicker } from '../components/CustomerPicker';
import { IntakeResultsSection } from '../components/IntakeResults';
import { ValidationPanel } from '../components/ValidationPanel';
import { Button, DataRow, MetricBadge, PageSection, Panel } from '../components/ui/primitives';
import {
  fetchCustomers,
  intakeRequest,
  type Customer,
  type IntakeResponse,
} from '../api';
import { isDemoMode } from '../env';

const demoMode = isDemoMode();

const defaultRequest = `Customer email:
Hey, can you get me:
10 pcs 1/4-20 x 3/4 hex cap screw zinc
25 M8 steel flat washers
same washers as last time
screws for bottom of MacBook Pro`;

const presets = [
  {
    label: 'Mixed RFQ',
    value: defaultRequest,
  },
  {
    label: 'Exact request',
    value: '5 pcs 1/4-20 x 3/4 hex cap screw zinc',
  },
  {
    label: 'Abbreviation',
    value: 'qty 12 SHCS 7/16 x 2-1/2',
  },
  {
    label: 'Customer preference',
    value: '10x 1/4-20 hex cap screw',
  },
  {
    label: 'Explicit wins',
    value: '10 pcs 1/4-20 black oxide hex cap screw',
  },
  {
    label: 'Hard negative',
    value: '25 M8 steel flat washer',
  },
  {
    label: 'Repair guidance',
    value: 'screws for bottom of MacBook Pro',
  },
];

export function IntakePage() {
  const auth = useAuth();
  const [rawRequest, setRawRequest] = useState(defaultRequest);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerFilter, setCustomerFilter] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(demoMode ? 'CUST-001' : '');
  const [usePersonalization, setUsePersonalization] = useState(true);
  const [response, setResponse] = useState<IntakeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? customers[0],
    [customers, selectedCustomerId],
  );
  const selectedCustomerName = useMemo(() => {
    if (demoMode) {
      return selectedCustomerId ? selectedCustomer?.name ?? selectedCustomerId : null;
    }
    return usePersonalization ? selectedCustomer?.name : null;
  }, [selectedCustomer, selectedCustomerId, usePersonalization]);

  useEffect(() => {
    if (!demoMode && !auth.accessToken) return;
    fetchCustomers(demoMode ? null : auth.accessToken)
      .then(setCustomers)
      .catch((err: Error) => setError(err.message));
  }, [auth.accessToken]);

  useEffect(() => {
    if (!demoMode && !auth.accessToken) return;
    void runIntake(defaultRequest, demoMode ? Boolean(selectedCustomerId) : usePersonalization, selectedCustomerId);
    // Initial demo state is intentionally seeded once on page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken]);

  async function runIntake(
    nextRequest = rawRequest,
    nextUsePersonalization = usePersonalization,
    nextCustomerId = selectedCustomerId,
  ) {
    if (!demoMode && !auth.accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await intakeRequest(nextRequest, {
        accessToken: auth.accessToken,
        usePersonalization: demoMode ? Boolean(nextCustomerId) : nextUsePersonalization,
        customerId: demoMode ? nextCustomerId : null,
      });
      setResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request intake failed');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runIntake();
  }

  function choosePreset(value: string) {
    setRawRequest(value);
    void runIntake(value, demoMode ? Boolean(selectedCustomerId) : usePersonalization);
  }

  function togglePersonalization(enabled: boolean) {
    setUsePersonalization(enabled);
    void runIntake(rawRequest, enabled);
  }

  function selectDemoCustomer(id: string) {
    setSelectedCustomerId(id);
    void runIntake(rawRequest, Boolean(id), id);
  }

  if (!demoMode && auth.loading) {
    return (
      <PageSection className="intake-page" kicker="Authentication" title="Checking session.">
        <Panel>
          <p className="empty-copy">Loading your identity provider session.</p>
        </Panel>
      </PageSection>
    );
  }

  if (!demoMode && !auth.accessToken) {
    return (
      <PageSection
        className="intake-page"
        copy="Paste a customer request. Caldura extracts line items, maps SKU candidates, and validates whether each line is safe to respond to."
        kicker="Sales request intake"
        title="Sales Request Intake"
      >
        <AuthRequired />
      </PageSection>
    );
  }

  return (
    <PageSection
      className="intake-page"
      copy="Paste a customer request. Caldura extracts line items, maps SKU candidates, and validates whether each line is safe to respond to."
      kicker="Sales request intake"
      title="Sales Request Intake"
    >
      <div className="hero-meta">
        <MetricBadge
          className="metric-badge--hero"
          label="Extracted lines"
          value={response ? String(response.summary.line_count) : 'Loading'}
        />
        <MetricBadge
          className="metric-badge--hero"
          label="Auto"
          value={response ? String(response.summary.auto_respond_count) : 'Loading'}
          tone="green"
        />
        <MetricBadge
          className="metric-badge--hero"
          label="Review"
          value={response ? String(response.summary.sales_review_count) : 'Loading'}
          tone="orange"
        />
        <MetricBadge
          className="metric-badge--hero"
          label="Mode"
          value={selectedCustomerName ?? 'Base ranking'}
          tone={selectedCustomerName ? 'blue' : 'muted'}
        />
      </div>

      <section className="workspace">
        <div className="search-column">
          <Panel className="search-panel intake-request-panel">
            <form onSubmit={handleSubmit}>
              <label className="field-label" htmlFor="raw-request">
                Customer request
              </label>
              <div className="textarea-shell">
                <FileText size={20} />
                <textarea
                  id="raw-request"
                  value={rawRequest}
                  onChange={(event) => setRawRequest(event.target.value)}
                  placeholder="Paste a customer email or RFQ with one item per line"
                  rows={8}
                />
              </div>
              <div className="intake-actions">
                <Button disabled={loading} type="submit">
                  {loading ? 'Processing' : 'Process request'}
                </Button>
                <span>{response ? `${response.summary.latency_ms} ms` : 'Line-oriented deterministic parser'}</span>
              </div>
              <div className="example-row" aria-label="Demo request presets">
                {presets.map((preset) => (
                  <Button key={preset.label} onClick={() => choosePreset(preset.value)} variant="secondary">
                    {preset.label}
                  </Button>
                ))}
              </div>
            </form>
          </Panel>

          {error && (
            <div className="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
            </div>
          )}
          <IntakeResultsSection response={response} />
        </div>

        <aside className="inspector-column">
          <Panel className="context-banner">
            <ClipboardList size={18} />
            <span>{selectedCustomerName ? `Personalized for ${selectedCustomerName}` : 'Base catalog ranking'}</span>
          </Panel>
          <ValidationPanel validation={response?.overall_validation ?? null} />
          {response && (
            <Panel className="intake-summary-panel">
              <div className="inline-title">
                <Database size={18} />
                <span>Request summary</span>
              </div>
              <DataRow label="Auto-respond lines" value={response.summary.auto_respond_count} />
              <DataRow label="Sales-review lines" value={response.summary.sales_review_count} />
              <DataRow label="Do-not-respond lines" value={response.summary.do_not_respond_count} />
              <DataRow label="Customer ID" value={response.customer_id ?? 'none'} />
            </Panel>
          )}
          {demoMode ? (
            <CustomerPicker
              customers={customers}
              filter={customerFilter}
              onFilterChange={setCustomerFilter}
              onSelect={selectDemoCustomer}
              selectedId={selectedCustomerId}
            />
          ) : (
            <Panel className="customer-panel">
              <div className="inline-title">
                <UserRound size={18} />
                <span>Customer context</span>
              </div>
              <label className="history-toggle">
                <input
                  checked={usePersonalization}
                  onChange={(event) => togglePersonalization(event.target.checked)}
                  type="checkbox"
                />
                <span>Use my order history</span>
              </label>
              <p className="empty-copy">
                {customers[0]
                  ? `${customers[0].id} · ${customers[0].profile_summary}`
                  : 'Your customer profile is loading.'}
              </p>
            </Panel>
          )}
        </aside>
      </section>
    </PageSection>
  );
}
