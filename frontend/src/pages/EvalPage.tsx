import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { fetchEvalDiagnostics, type EvalDiagnostics, type EvalMetric } from '../api';
import { DataRow, MetricBadge, PageSection, Panel } from '../components/ui/primitives';
import { isDemoMode } from '../env';

const demoMode = isDemoMode();

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function MetricTable({ title, metrics }: { title: string; metrics: EvalMetric[] }) {
  return (
    <Panel className="eval-table" title={title} kicker="Breakdown">
      {metrics.map((metric) => (
        <div className="eval-row" key={metric.key}>
          <strong>{metric.key}</strong>
          <span>{metric.cases} cases</span>
          <span>{pct(metric.accuracy)} accuracy</span>
          <span>{pct(metric.review_routing_rate)} review routed</span>
        </div>
      ))}
    </Panel>
  );
}

export function EvalPage() {
  const [diagnostics, setDiagnostics] = useState<EvalDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!demoMode) return;
    fetchEvalDiagnostics()
      .then(setDiagnostics)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (!demoMode) {
    return (
      <PageSection
        className="eval-page"
        copy="Diagnostics are demo-only until internal/admin authorization exists."
        kicker="Validation diagnostics"
        title="Demo diagnostics are disabled in auth-bound mode."
      >
        <Panel className="validation-panel">
          <p className="empty-copy">
            Set APP_ENV=demo, DEMO_MODE=true, and VITE_DEMO_MODE=true only for an explicit
            demo environment to view seeded eval diagnostics.
          </p>
        </Panel>
      </PageSection>
    );
  }

  return (
    <PageSection
      className="eval-page"
      copy="Global accuracy can hide customer-specific failures. This deterministic demo eval shows validation accuracy and review-routing by customer, product family, and attribute type."
      kicker="Validation diagnostics"
      title="Measure safe automation, not raw matching alone."
    >
      {error && <p className="error-copy">{error}</p>}
      <div className="hero-meta">
        <MetricBadge label="Decision accuracy" value={diagnostics ? pct(diagnostics.global_accuracy) : 'Loading'} tone="green" />
        <MetricBadge label="Review routing" value={diagnostics ? pct(diagnostics.review_routing_rate) : 'Loading'} tone="orange" />
        <MetricBadge label="Cases" value={diagnostics ? String(diagnostics.total_cases) : 'Loading'} tone="muted" />
      </div>

      <section className="two-column-page">
        <Panel className="validation-panel">
          <div className="inline-title">
            <BarChart3 size={18} />
            <span>Kasyap scenario</span>
          </div>
          <p className="empty-copy">
            The point is not to maximize auto-response. The system should catch customer-specific
            preference or ambiguity risk and route those cases before a wrong response reaches the buyer.
          </p>
          {diagnostics && (
            <>
              <DataRow label="Global validation accuracy" value={pct(diagnostics.global_accuracy)} />
              <DataRow label="Human review rate" value={pct(diagnostics.review_routing_rate)} />
            </>
          )}
        </Panel>

        {diagnostics && <MetricTable title="By customer" metrics={diagnostics.by_customer} />}
      </section>

      {diagnostics && (
        <section className="two-column-page">
          <MetricTable title="By product family" metrics={diagnostics.by_product_family} />
          <MetricTable title="By attribute type" metrics={diagnostics.by_attribute_type} />
        </section>
      )}
    </PageSection>
  );
}
