import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { fetchEvalDiagnostics, type EvalDiagnostics, type EvalMetric } from '../api';
import { DataRow, MetricBadge, PageSection, Panel } from '../components/ui/primitives';
import { isDemoMode } from '../env';

const demoMode = isDemoMode();

const fallbackChecks = [
  ['False auto-response risk', 'The highest-severity failure: sending a wrong customer confirmation.'],
  ['Review routing', 'Whether ambiguous or customer-specific cases are handed to sales.'],
  ['Blocked requests', 'Whether out-of-scope repair or meta-only requests avoid SKU hallucination.'],
  ['Slice diagnostics', 'Customer, product-family, and attribute views expose hidden failures.'],
];

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
          <span>{pct(metric.auto_response_rate)} auto</span>
          <span>{pct(metric.review_routing_rate)} review routed</span>
          <span>{pct(metric.do_not_respond_rate)} do not respond</span>
        </div>
      ))}
    </Panel>
  );
}

function CustomerHealth({ metrics }: { metrics: EvalMetric[] }) {
  return (
    <Panel className="eval-table customer-health-panel" title="Customer Health" kicker="Eval slice">
      {metrics.map((metric) => (
        <div className="health-row" key={metric.key}>
          <div>
            <strong>{metric.key}</strong>
            <span>{metric.cases} cases</span>
          </div>
          <span>{pct(metric.auto_response_rate)} auto</span>
          <span>{pct(metric.review_routing_rate)} review</span>
          <span>{pct(metric.do_not_respond_rate)} blocked</span>
          <small>
            {metric.top_review_reasons.length
              ? metric.top_review_reasons.map((reason) => `${reason.reason} (${reason.count})`).join(' · ')
              : 'No review/failure reasons in this slice'}
          </small>
        </div>
      ))}
    </Panel>
  );
}

function DiagnosticsUnavailable({ error }: { error: string | null }) {
  return (
    <Panel className="eval-unavailable-panel" kicker={error ? 'Fallback state' : 'Loading'} title={error ? 'Diagnostics unavailable' : 'Loading seeded diagnostics'}>
      <p className="empty-copy">
        {error
          ? 'The dashboard can still explain what the eval is meant to measure, but the seeded metrics did not load in this session.'
          : 'Seeded diagnostics are loading. The page remains usable because the evaluation purpose is independent of the fetch state.'}
      </p>
      {error && <DataRow label="API status" value={error} />}
    </Panel>
  );
}

function EvaluationPurposePanel() {
  return (
    <Panel className="validation-panel" kicker="Safety target" title="What this dashboard checks">
      <div className="inline-title">
        <BarChart3 size={18} />
        <span>Automation safety, not just search quality</span>
      </div>
      <p className="empty-copy">
        Eval is the QA view for the validation gate. It asks whether Caldura knows when to answer,
        when to route to sales, and when to block a request that is outside reliable catalog scope.
      </p>
      <div className="eval-check-list">
        {fallbackChecks.map(([label, value]) => (
          <DataRow key={label} label={label} value={value} />
        ))}
      </div>
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
        copy="Safety diagnostics are demo-only until internal/admin authorization exists."
        kicker="Safety evaluation"
        title="Safety Evaluation Dashboard"
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
      copy="Measure whether Caldura knows when to answer, when to route to sales, and when to block unsafe requests. The seeded eval separates decision-gate safety from raw SKU ranking."
      kicker="Safety evaluation"
      title="Safety Evaluation Dashboard"
    >
      <div className="hero-meta">
        <MetricBadge label="Decision gate" value={diagnostics ? pct(diagnostics.global_accuracy) : 'Loading'} tone="green" />
        <MetricBadge label="Review routing" value={diagnostics ? pct(diagnostics.review_routing_rate) : 'Loading'} tone="orange" />
        <MetricBadge label="Cases" value={diagnostics ? String(diagnostics.total_cases) : 'Loading'} tone="muted" />
        <MetricBadge label="Primary risk" value="False auto-response" tone="muted" />
      </div>

      <section className="two-column-page">
        <EvaluationPurposePanel />

        {diagnostics ? <MetricTable title="By customer" metrics={diagnostics.by_customer} /> : <DiagnosticsUnavailable error={error} />}
      </section>

      {diagnostics && <CustomerHealth metrics={diagnostics.customer_health} />}

      {diagnostics && (
        <section className="two-column-page two-column-page--balanced">
          <MetricTable title="By product family" metrics={diagnostics.by_product_family} />
          <MetricTable title="By attribute type" metrics={diagnostics.by_attribute_type} />
        </section>
      )}

      {!diagnostics && (
        <section className="two-column-page two-column-page--balanced">
          <Panel className="eval-table" kicker="Seed cases" title="Representative scenarios">
            <DataRow label="Fully specified" value="Strong candidate can enter AUTO_RESPOND." />
            <DataRow label="Missing finish/material" value="Close alternatives should route to SALES_REVIEW." />
            <DataRow label="Repair request" value="Out-of-scope fitment should route to DO_NOT_RESPOND." />
          </Panel>
          <Panel className="eval-table" kicker="Release lens" title="What success means">
            <DataRow label="Safe automation" value="Known hard negatives do not produce customer drafts." />
            <DataRow label="Useful review" value="Escalations include reasons, candidates, and customer evidence." />
            <DataRow label="Slice visibility" value="Customer-specific failures are not hidden by global averages." />
          </Panel>
        </section>
      )}
    </PageSection>
  );
}
