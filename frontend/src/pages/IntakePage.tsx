import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, Database, FileText, PackageCheck, UserRound } from 'lucide-react';
import { AuthRequired, useAuth } from '../auth';
import { CustomerPicker } from '../components/CustomerPicker';
import { ResultCard } from '../components/ResultCard';
import { LiquidGlass } from '../components/ui/liquid-glass';
import { ValidationPanel } from '../components/ValidationPanel';
import { Button, DataRow, MetricBadge, PageSection, Panel } from '../components/ui/primitives';
import {
  fetchCustomers,
  intakeRequest,
  type Customer,
  type CustomerPreference,
  type IntakeLine,
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

const validationCopy = {
  AUTO_RESPOND: 'Auto-respond',
  SALES_REVIEW: 'Sales review',
  DO_NOT_RESPOND: 'Do not respond',
};

function quantityLabel(line: IntakeLine) {
  if (line.quantity == null) return 'Unknown';
  return line.unit ? `${line.quantity} ${line.unit}` : String(line.quantity);
}

function preferenceLabel(preference: CustomerPreference) {
  return `${preference.attribute}: ${preference.value}${preference.applied_to_query ? ' applied' : ''}`;
}

function IntakeLineCard({ line }: { line: IntakeLine }) {
  return (
    <Panel className="intake-line-card">
      <div className="intake-line-heading">
        <div>
          <span className="section-kicker">Line {line.line_number}</span>
          <h2>{line.normalized_query}</h2>
          <p>{line.raw_line}</p>
        </div>
        <div className={`confidence line-decision line-${line.validation.decision.toLowerCase()}`}>
          <PackageCheck size={16} />
          <span>{validationCopy[line.validation.decision]}</span>
        </div>
      </div>

      <div className="line-metadata">
        <DataRow label="Quantity" value={quantityLabel(line)} />
        <DataRow label="Validation" value={line.validation.reason} />
        <DataRow
          label="Risk"
          value={line.validation.missing_risky_attributes.length ? line.validation.missing_risky_attributes.join(', ') : 'none'}
        />
      </div>

      {line.customer_preferences.length > 0 && (
        <div className="line-preferences">
          <span className="evidence-title">Customer preference evidence</span>
          <div className="evidence-row">
            {line.customer_preferences.map((preference) => (
              <span
                className={`evidence-chip ${preference.applied_to_query ? 'evidence-positive' : 'evidence-warning'}`}
                key={`${line.line_number}-${preference.scope}-${preference.attribute}-${preference.value}`}
              >
                {preferenceLabel(preference)}
              </span>
            ))}
          </div>
        </div>
      )}

      {line.repair_context && (
        <div className="line-repair-note">
          <strong>{line.repair_context.title}</strong>
          <span>{line.repair_context.fitment_note ?? line.repair_context.recommended_part ?? 'Repair context detected.'}</span>
        </div>
      )}

      <div className="line-results">
        {line.results.length === 0 ? (
          <Panel className="empty-results-panel">
            <h3>No verified stocked match</h3>
            <p>{line.validation.internal_note}</p>
          </Panel>
        ) : (
          line.results.map((result) => (
            <ResultCard
              decision={line.decision}
              key={`${line.line_number}-${result.sku}`}
              result={result}
              validationDecision={line.validation.decision}
            />
          ))
        )}
      </div>
    </Panel>
  );
}

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
          <LiquidGlass className="hero-panel-glass" interactive>
            <Panel className="search-panel intake-request-panel panel--glass">
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
          </LiquidGlass>

          {error && (
            <div className="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
            </div>
          )}

          <section className="results-section" aria-live="polite">
            <div className="section-heading">
              <div>
                <span className="section-kicker">Extracted request</span>
                <h2>Line validation</h2>
              </div>
              {response && (
                <p>
                  {response.summary.line_count} lines · {validationCopy[response.overall_validation.decision]}
                </p>
              )}
            </div>
            <div className="intake-line-list">
              {response?.lines.map((line) => (
                <IntakeLineCard key={`${line.line_number}-${line.raw_line}`} line={line} />
              ))}
            </div>
          </section>
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
