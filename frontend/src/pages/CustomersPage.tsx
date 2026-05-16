import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, UserRound } from 'lucide-react';
import { fetchCustomers, type Customer } from '../api';
import { Button, DataRow, InputShell, MetricBadge, PageSection, Panel } from '../components/ui/primitives';

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState('CUST-001');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCustomers()
      .then((rows) => {
        setCustomers(rows);
        if (rows.length > 0) {
          setSelectedId(rows[0].id);
        }
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const filtered = useMemo(() => {
    const needle = filter.toLowerCase();
    return customers.filter(
      (customer) =>
        customer.id.toLowerCase().includes(needle) ||
        customer.name.toLowerCase().includes(needle) ||
        customer.profile_summary.toLowerCase().includes(needle),
    );
  }, [customers, filter]);

  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((customer) => customer.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = customers.find((customer) => customer.id === selectedId) ?? customers[0];

  return (
    <PageSection
      className="customers-page"
      copy="Inspect the lightweight customer profiles that bias ambiguous searches without overwhelming catalog relevance."
      kicker="Personalization"
      title="Customer history as a ranking signal."
    >
      <div className="hero-meta">
        <MetricBadge label="Customers" value={String(customers.length || 0)} />
        <MetricBadge label="Signal" value="Orders + SKU history" tone="green" />
        <MetricBadge label="Bias" value="Bounded additive" tone="muted" />
      </div>

      <section className="two-column-page">
        <Panel className="customer-directory">
          <label className="field-label" htmlFor="customer-search">
            Search customers
          </label>
          <InputShell icon={<Search size={18} />}>
            <input
              id="customer-search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by ID, name, or profile"
            />
          </InputShell>
          {error && <p className="error-copy">{error}</p>}
          <div className="customer-grid">
            {filtered.map((customer) => (
              <button
                className={`customer-card ${selectedId === customer.id ? 'selected' : ''}`}
                key={customer.id}
                onClick={() => setSelectedId(customer.id)}
                type="button"
              >
                <span className="customer-card-top">
                  <strong>{customer.id}</strong>
                  <em>{customer.order_count} orders</em>
                </span>
                <span>{customer.name}</span>
                <small>{customer.profile_summary}</small>
              </button>
            ))}
          </div>
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
                to={`/?customer=${encodeURIComponent(selected.id)}&q=${encodeURIComponent('the same washers as last time')}`}
              >
                Try reference query
              </Link>
              <Button
                className="full-width-link"
                onClick={() => setFilter(selected.id)}
                variant="secondary"
              >
                Filter to this customer
              </Button>
            </>
          ) : (
            <p className="empty-copy">Customer data is loading.</p>
          )}
        </Panel>
      </section>
    </PageSection>
  );
}
