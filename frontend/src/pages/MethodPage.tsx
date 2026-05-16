import { BrainCircuit, Gauge, History, ListFilter, SearchCheck } from 'lucide-react';
import { DataRow, MetricBadge, PageSection, Panel } from '../components/ui/primitives';

const steps = [
  {
    icon: <ListFilter size={20} />,
    title: 'Parse signals',
    copy: 'The query parser extracts thread, length, product type, material, finish, and standards. These fields are boosts, not hard filters.',
  },
  {
    icon: <SearchCheck size={20} />,
    title: 'Rank candidates',
    copy: 'A custom in-memory BM25 index plus parser boosts creates model closeness: the ranking strength used to order candidates.',
  },
  {
    icon: <History size={20} />,
    title: 'Apply context',
    copy: 'Customer history adds a bounded bias for previously ordered SKUs, usual product families, materials, finishes, and familiar thread sizes.',
  },
  {
    icon: <Gauge size={20} />,
    title: 'Explain confidence',
    copy: 'Confidence is the trust gate. At 90% or higher the app can mark the top result ready to order; below that it routes to sales review.',
  },
];

export function MethodPage() {
  return (
    <PageSection
      className="method-page"
      copy="The implementation favors deterministic, inspectable ranking over heavyweight retrieval infrastructure for a 1,000-row catalog."
      kicker="Ranking method"
      title="Simple enough to defend. Specific enough to work."
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
          <DataRow label="Parser behavior" value="Soft boosts, never hard filters" />
          <DataRow label="Personalization" value="Capped additive ranking bias" />
          <DataRow label="Model closeness" value="Normalized rank strength, not a guarantee" />
          <DataRow label="Confidence" value="Order automation gate" />
          <DataRow label="Storage" value="CSV loaded into memory at boot" />
        </Panel>
        <Panel kicker="Out of scope" title="What stayed out">
          <div className="exclusion-list">
            <span>Vector database</span>
            <span>External LLM fallback</span>
            <span>Authentication</span>
            <span>Microservices</span>
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
