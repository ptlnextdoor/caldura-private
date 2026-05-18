import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Database, Search, Sparkles, UserRound } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AuthRequired, useAuth } from '../auth';
import { ParsedPanel } from '../components/ParsedPanel';
import { RepairContextPanel } from '../components/RepairContextPanel';
import { ResultCard } from '../components/ResultCard';
import { Button, MetricBadge, PageSection, Panel, InputShell } from '../components/ui/primitives';
import { fetchCustomers, searchCatalog, type Customer, type SearchResponse } from '../api';

const examples = [
  'screws for bottom of MacBook Pro',
  'bike bottle cage bolts stainless',
  'boat hatch screws rusted from saltwater',
  'IKEA missing bed frame bolts',
  'same screws we used for pump guard',
];

const decisionCopy = {
  'ready-to-order': 'Ready to order',
  'sales-review': 'Sales review',
  'guidance-only': 'Guidance only',
};

export function SearchPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? 'M8 flat washer';
  const [query, setQuery] = useState(initialQuery);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [usePersonalization, setUsePersonalization] = useState(true);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomerName = useMemo(
    () => (usePersonalization ? customers[0]?.name : null),
    [customers, usePersonalization],
  );

  useEffect(() => {
    if (!auth.accessToken) return;
    fetchCustomers(auth.accessToken)
      .then(setCustomers)
      .catch((err: Error) => setError(err.message));
  }, [auth.accessToken]);

  useEffect(() => {
    if (!auth.accessToken) return;
    void runSearch(initialQuery, usePersonalization);
    // The route params are read once for initial demo state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken]);

  async function runSearch(nextQuery = query, nextUsePersonalization = usePersonalization) {
    if (!auth.accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await searchCatalog(nextQuery, {
        accessToken: auth.accessToken,
        usePersonalization: nextUsePersonalization,
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
    void runSearch(value, usePersonalization);
  }

  function togglePersonalization(enabled: boolean) {
    setUsePersonalization(enabled);
    void runSearch(query, enabled);
  }

  if (auth.loading) {
    return (
      <PageSection className="search-page" kicker="Authentication" title="Checking session.">
        <Panel>
          <p className="empty-copy">Loading your identity provider session.</p>
        </Panel>
      </PageSection>
    );
  }

  if (!auth.accessToken) {
    return (
      <PageSection
        className="search-page"
        copy="Search by repair context or formal fastener specs after signing in."
        kicker="Repair-aware retrieval"
        title="Find the right hardware from the job you are doing."
      >
        <AuthRequired />
      </PageSection>
    );
  }

  return (
    <PageSection
      className="search-page"
      copy="Search by repair context or formal fastener specs. The app translates messy job language into catalog candidates with visible assumptions."
      kicker="Repair-aware retrieval"
      title="Find the right hardware from the job you are doing."
    >
      <div className="hero-meta">
        <MetricBadge label="Catalog" value="1,000 SKUs" />
        <MetricBadge label="Return" value="Top 3" tone="green" />
        <MetricBadge
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
                Describe the product
              </label>
              <InputShell icon={<Search size={20} />}>
                <input
                  id="query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Example: 1/4-20 x 3/4 hex cap screw zinc"
                />
                <Button disabled={loading} type="submit">
                  {loading ? 'Searching' : 'Search'}
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
                <span className="section-kicker">Matches</span>
                <h2>Top matches</h2>
              </div>
              {response && (
                <p>
                  {response.meta.candidate_count} candidates · {response.meta.latency_ms} ms
                  {` · ${decisionCopy[response.decision]}`}
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
                <ResultCard decision={response.decision} result={result} key={result.sku} />
              ))}
            </div>
          </section>
        </div>

        <aside className="inspector-column">
          <Panel className="context-banner">
            <Sparkles size={18} />
            <span>{selectedCustomerName ? `Personalized for ${selectedCustomerName}` : 'Base catalog ranking'}</span>
          </Panel>
          <RepairContextPanel
            context={response?.repair_context ?? null}
            onChooseRewrite={chooseExample}
          />
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
          <ParsedPanel parsed={response?.query.parsed ?? null} />
          {response?.meta.ambiguous_suggestions && (
            <Panel className="suggestions-panel" title="Clarify if needed" kicker="Suggestions">
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
              <strong>In-memory index</strong>
              <span>BM25 text rank plus soft parser boosts. No backend changes in this redesign.</span>
            </div>
          </Panel>
        </aside>
      </section>
    </PageSection>
  );
}
