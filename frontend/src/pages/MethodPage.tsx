import { BrainCircuit, Gauge, History, ListFilter, SearchCheck } from 'lucide-react';
import { DataRow, MetricBadge, PageSection, Panel } from '../components/ui/primitives';

const steps = [
  {
    icon: <ListFilter size={20} />,
    title: 'Extract lines',
    copy: 'The intake layer splits a pasted RFQ or customer email into candidate line items and removes quantity text before matching.',
  },
  {
    icon: <SearchCheck size={20} />,
    title: 'Rank candidates',
    copy: 'A custom in-memory BM25 index plus parser boosts returns the top SKU candidates for the incoming customer request.',
  },
  {
    icon: <History size={20} />,
    title: 'Apply context',
    copy: 'Customer history infers global and product-family-scoped material and finish preferences, but explicit request attributes always win.',
  },
  {
    icon: <Gauge size={20} />,
    title: 'Validate response',
    copy: 'The validation gate decides AUTO_RESPOND, SALES_REVIEW, or DO_NOT_RESPOND before any customer-facing response is sent.',
  },
];

export function MethodPage() {
  return (
    <PageSection
      className="method-page"
      copy="Raw match accuracy is not enough. The system optimizes effective shipped accuracy by routing uncertain cases to humans."
      kicker="Sales validation method"
      title="Customer request to validated sales action."
    >
      <div className="hero-meta">
        <MetricBadge label="Catalog size" value="1,000 rows" />
        <MetricBadge label="Auto gate" value="90%+" tone="green" />
        <MetricBadge label="Vector DB" value="Not needed" tone="muted" />
      </div>

      <section className="method-grid">
        {steps.map((step, index) => (
          <Panel className="method-card" key={step.title}>
            <span className="method-index">0{index + 1}</span>
            <div className="method-icon">{step.icon}</div>
            <h2>{step.title}</h2>
            <p>{step.copy}</p>
          </Panel>
        ))}
      </section>

      <section className="two-column-page method-detail">
        <Panel kicker="Tradeoffs" title="Why this shape">
          <DataRow label="Intake behavior" value="Line-oriented deterministic parser" />
          <DataRow label="Parser behavior" value="Soft boosts, never hard filters" />
          <DataRow label="Personalization" value="Capped additive ranking bias" />
          <DataRow label="Preferences" value="Global and product-family scoped" />
          <DataRow label="Model closeness" value="Normalized rank strength, not a guarantee" />
          <DataRow label="Contradictions" value="Thread/type blocks, material/finish review" />
          <DataRow label="Validation" value="Auto-respond, sales review, or do not respond" />
          <DataRow label="Demo mode" value="Customer dropdown without OIDC" />
          <DataRow label="Auth mode" value="JWT-scoped customer context" />
          <DataRow label="Storage" value="CSV loaded into memory at boot" />
          <DataRow label="Parity" value="Rust and Vercel JS paths covered by parity-oriented tests" />
        </Panel>
        <Panel kicker="Out of scope" title="What stayed out">
          <div className="exclusion-list">
            <span>Vector database</span>
            <span>Dense retrieval</span>
            <span>Mamba</span>
            <span>LLM parsing</span>
            <span>Learned calibration model</span>
            <span>Auth redesign</span>
            <span>Startup fluff</span>
          </div>
          <div className="method-callout">
            <BrainCircuit size={20} />
            <p>
              A confidently wrong result is worse than a low-confidence escalation, so the matcher separates ranking from the sales handoff.
            </p>
          </div>
        </Panel>
      </section>
    </PageSection>
  );
}
