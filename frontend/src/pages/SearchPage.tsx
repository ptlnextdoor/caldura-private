import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Database, Search, Sparkles, UserRound } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AuthRequired, useAuth } from '../auth';
import { CustomerPicker } from '../components/CustomerPicker';
import { CustomerPreferencePanel } from '../components/CustomerPreferencePanel';
import { ParsedPanel } from '../components/ParsedPanel';
import { RepairContextPanel } from '../components/RepairContextPanel';
import { ResultCard } from '../components/ResultCard';
import { ValidationPanel } from '../components/ValidationPanel';
import { Button, MetricBadge, PageSection, Panel, InputShell } from '../components/ui/primitives';
import { fetchCustomers, searchCatalog, type Customer, type SearchResponse } from '../api';
import { isDemoMode } from '../env';

const examples = [
  'M8 flat washer',
  'qty 12 SHCS 7/16 x 2-1/2',
  '1/4-20 x 3/4 hex cap screw zinc',
  'M8 x 50mm BHCS black oxide',
  'same washers as last time',
  'screws for bottom of MacBook Pro',
];

const decisionCopy = {
  'ready-to-order': 'Ready to order',
  'sales-review': 'Sales review',
  'guidance-only': 'Guidance only',
};

const validationCopy = {
  AUTO_RESPOND: 'Auto-respond',
  SALES_REVIEW: 'Sales review',
  DO_NOT_RESPOND: 'Do not respond',
};

const demoMode = isDemoMode();

export function SearchPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? 'M8 flat washer';
  const [query, setQuery] = useState(initialQuery);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerFilter, setCustomerFilter] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [usePersonalization, setUsePersonalization] = useState(true);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? customers[0],
    [customers, selectedCustomerId],
  );
  const selectedCustomerName = useMemo(
    () => {
      if (demoMode) {
        return selectedCustomerId ? selectedCustomer?.name : null;
      }
      return usePersonalization ? selectedCustomer?.name : null;
    },
    [selectedCustomer, selectedCustomerId, usePersonalization],
  );

  useEffect(() => {
    if (!demoMode && !auth.accessToken) return;
    fetchCustomers(demoMode ? null : auth.accessToken)
      .then(setCustomers)
      .catch((err: Error) => setError(err.message));
  }, [auth.accessToken]);

  useEffect(() => {
    if (!demoMode && !auth.accessToken) return;
    void runSearch(initialQuery, demoMode ? Boolean(selectedCustomerId) : usePersonalization);
    // The route params are read once for initial demo state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken]);

  async function runSearch(
    nextQuery = query,
    nextUsePersonalization = usePersonalization,
    nextCustomerId = selectedCustomerId,
  ) {
    if (!demoMode && !auth.accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await searchCatalog(nextQuery, {
        accessToken: auth.accessToken,
        usePersonalization: demoMode ? Boolean(nextCustomerId) : nextUsePersonalization,
        customerId: demoMode ? nextCustomerId : null,
      });
      setResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runSearch();
  }

  function chooseExample(value: string) {
    setQuery(value);
    void runSearch(value, demoMode ? Boolean(selectedCustomerId) : usePersonalization);
  }

  function togglePersonalization(enabled: boolean) {
    setUsePersonalization(enabled);
    void runSearch(query, enabled);
  }

  function selectDemoCustomer(id: string) {
    setSelectedCustomerId(id);
    void runSearch(query, Boolean(id), id);
  }

  if (!demoMode && auth.loading) {
    return (
      <PageSection className="search-page" kicker="Authentication" title="Checking session.">
        <Panel>
          <p className="empty-copy">Loading your identity provider session.</p>
        </Panel>
      </PageSection>
    );
  }

  if (!demoMode && !auth.accessToken) {
    return (
      <PageSection
        className="search-page"
        copy="Test one fastener phrase at a time. This page shows parsing, top-3 ranking, confidence, repair context, and customer-history influence before the query appears inside an RFQ or email workflow."
        kicker="SKU lookup sandbox"
        title="Investigate one catalog query."
      >
        <AuthRequired />
      </PageSection>
    );
  }

  return (
    <PageSection
      className="search-page"
      copy="Test one fastener phrase at a time. This page shows parsing, top-3 ranking, confidence, repair context, and customer-history influence before the query appears inside an RFQ or email workflow."
      kicker="SKU lookup sandbox"
      title="Investigate one catalog query."
    >
      <div className="hero-meta">
        <MetricBadge className="metric-badge--hero" label="Catalog" value="1,000 SKUs" />
        <MetricBadge className="metric-badge--hero" label="Output" value="Top 3 candidates" tone="green" />
        <MetricBadge className="metric-badge--hero" label="Purpose" value="Parser + rank test" tone="muted" />
        <MetricBadge
          className="metric-badge--hero"
          label="Mode"
          value={selectedCustomerName ? selectedCustomerName : 'Base ranking'}
          tone={selectedCustomerName ? 'blue' : 'muted'}
        />
      </div>

      <section className="workspace">
        <div className="search-column">
          <Panel className="search-panel">
            <form onSubmit={handleSubmit}>
              <label className="field-label" htmlFor="query">
                Single catalog query
              </label>
              <InputShell icon={<Search size={20} />}>
                <input
                  id="query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Example: 1/4-20 x 3/4 hex cap screw zinc"
                />
                <Button disabled={loading} type="submit">
                  {loading ? 'Ranking' : 'Rank candidates'}
                </Button>
              </InputShell>
              <div className="example-row" aria-label="Example queries">
                {examples.map((example) => (
                  <Button key={example} onClick={() => chooseExample(example)} variant="secondary">
                    {example}
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

          <section className="results-section" aria-live="polite">
            <div className="section-heading">
              <div>
                <span className="section-kicker">Candidate ranking</span>
                <h2>Top-3 catalog candidates</h2>
              </div>
              {response && (
                <p>
                  {response.meta.candidate_count} candidates · {response.meta.latency_ms} ms
                  {` · ${response.validation ? validationCopy[response.validation.decision] : decisionCopy[response.decision]}`}
                  {response.meta.ambiguous_query ? ' · close scores' : ''}
                </p>
              )}
            </div>
            <div className="results-list">
              {response?.meta.no_verified_stocked_match && (
                <Panel className="empty-results-panel">
                  <h3>No verified stocked match</h3>
                  <p>
                    {response.meta.result_message ??
                      'This repair appears to need a model-specific part, not a standard catalog screw.'}
                  </p>
                </Panel>
              )}
              {response?.results.map((result) => (
                <ResultCard
                  decision={response.decision}
                  result={result}
                  key={result.sku}
                  validationDecision={response.validation.decision}
                />
              ))}
            </div>
          </section>
        </div>

        <aside className="inspector-column">
          <Panel className="context-banner">
            <Sparkles size={18} />
            <span>
              {selectedCustomerName
                ? `Single-query sandbox personalized for ${selectedCustomerName}`
                : 'Single-query sandbox using base catalog ranking'}
            </span>
          </Panel>
          <RepairContextPanel
            context={response?.repair_context ?? null}
            onChooseRewrite={chooseExample}
          />
          <ValidationPanel validation={response?.validation ?? null} />
          <CustomerPreferencePanel preferences={response?.customer_preferences ?? []} />
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
          <ParsedPanel parsed={response?.query.parsed ?? null} />
          {response?.meta.ambiguous_suggestions && (
            <Panel className="suggestions-panel" title="Internal review hints" kicker="Sales note">
              {response.meta.ambiguous_suggestions.map((suggestion) => (
                <button type="button" key={suggestion.label} onClick={() => chooseExample(suggestion.query_rewrite)}>
                  <strong>{suggestion.label}</strong>
                  <small>{suggestion.query_rewrite}</small>
                </button>
              ))}
            </Panel>
          )}
          <Panel className="small-system-card">
            <Database size={18} />
            <div>
              <strong>Matcher microscope</strong>
              <span>Use this page to inspect one query before the same matcher is reused by intake and email.</span>
            </div>
          </Panel>
        </aside>
      </section>
    </PageSection>
  );
}
