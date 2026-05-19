import { BrainCircuit, Gauge, History, ListFilter, SearchCheck } from 'lucide-react';
import { DataRow, MetricBadge, PageSection, Panel } from '../components/ui/primitives';

type TableRow = [string, string];

const steps = [
  {
    icon: <ListFilter size={20} />,
    title: 'Extract and normalize',
    copy: 'Split pasted RFQs or email bodies into candidate line items, strip conversational openers, and preserve quantity for handoff.',
  },
  {
    icon: <SearchCheck size={20} />,
    title: 'Retrieve and rank',
    copy: 'Use BM25-style lexical retrieval plus parser-aware boosts to return inspectable top SKU candidates.',
  },
  {
    icon: <History size={20} />,
    title: 'Apply customer context',
    copy: 'Use seeded order history as a capped disambiguation signal when the request omits material, finish, or family detail.',
  },
  {
    icon: <Gauge size={20} />,
    title: 'Gate automation',
    copy: 'Map every line and request to AUTO_RESPOND, SALES_REVIEW, or DO_NOT_RESPOND before a draft can be customer-facing.',
  },
];

const problemExamples: TableRow[] = [
  ['M8 flat washer', 'May be underspecified by material, finish, or washer type.'],
  ['SHCS 7/16 x 2-1/2', 'Requires shorthand expansion before ranking.'],
  ['same washers as last time', 'Requires customer-history context, not pure lexical search.'],
  ['M8 steel flat washer', 'Should not auto-respond if finish evidence is risky or incomplete.'],
  ['screws for bottom of MacBook Pro', 'Repair intent, not a safe stocked-catalog SKU request.'],
];

const rankingSignals: TableRow[] = [
  ['Lexical score', 'Surface-form relevance for exact part tokens such as M8, zinc, SHCS, and 1/4-20.'],
  ['Attribute matches', 'Product-specific evidence for thread, length, finish, material, and family.'],
  ['Attribute conflicts', 'Safety penalties when the query and candidate disagree on risky details.'],
  ['Customer history', 'Capped boost when prior orders clarify an omitted attribute.'],
  ['Stable tie-breakers', 'Deterministic output across repeated runs.'],
];

const validationRows: TableRow[] = [
  ['AUTO_RESPOND', 'Enough evidence exists to draft a customer confirmation.'],
  ['SALES_REVIEW', 'Candidate matches exist, but ambiguity, missing risk, or customer context needs a human.'],
  ['DO_NOT_RESPOND', 'The request is blocked, out of reliable catalog scope, or lacks usable line items.'],
];

const evaluationRows: TableRow[] = [
  ['Hit@3 family accuracy', 'Did the expected family appear in the top three candidates?'],
  ['Attribute correctness', 'Do type, diameter, thread, length, material, and finish match?'],
  ['Decision-gate accuracy', 'Was AUTO_RESPOND, SALES_REVIEW, or DO_NOT_RESPOND appropriate?'],
  ['False auto-response rate', 'How often would the system send a wrong customer confirmation?'],
  ['Customer-slice performance', 'Do customer-specific preference failures hide behind global averages?'],
];

const futureRows: TableRow[] = [
  ['Rep correction memory', 'Store sales edits as future customer/product-family evidence.'],
  ['Learned calibration', 'Replace rule confidence with measured reliability after labeled outcomes exist.'],
  ['LLM-assisted parsing', 'Handle messier language through schema-constrained hints under validation.'],
  ['Dense retrieval', 'Improve recall for larger catalogs and vocabulary mismatch.'],
  ['Email providers', 'Wire inbound/outbound email only after preview workflow and guards are proven.'],
];

const limitations = [
  'No LLM parser',
  'No dense retrieval',
  'No vector database',
  'No learned calibration',
  'No persistent rep-correction memory',
  'No live email sending',
  'No inbound webhook',
  'No ERP, price, or lead-time integration',
];

function MethodTable({ rows }: { rows: TableRow[] }) {
  return (
    <div className="method-table">
      {rows.map(([label, value]) => (
        <div className="method-table-row" key={label}>
          <strong>{label}</strong>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

export function MethodPage() {
  return (
    <PageSection
      className="method-page"
      copy="How Caldura turns messy industrial sales requests into ranked SKU candidates, customer-aware validation decisions, and safe response drafts."
      kicker="Sales validation method"
      title="Method"
    >
      <div className="hero-meta">
        <MetricBadge label="Catalog" value="1,000 rows" />
        <MetricBadge label="Retrieval" value="BM25-style" tone="green" />
        <MetricBadge label="Confidence" value="Rule-based" tone="muted" />
        <MetricBadge label="Email" value="Preview-only" tone="muted" />
      </div>

      <Panel className="method-intro-panel" kicker="Core principle" title="The matcher proposes candidates; the validator decides whether automation is safe.">
        <p className="method-copy">
          Caldura is designed less like a generic search bar and more like a risk-controlled sales-assist
          system. The written challenge asks for top-3 catalog matches with confidence scores. In a real
          distributor workflow, that is only half the problem: a customer-facing system must also decide
          whether it is safe to respond automatically, whether sales should review, or whether the system
          should stop because the request is outside reliable catalog scope.
        </p>
        <p className="method-copy">
          This version intentionally uses deterministic parsing, BM25-style lexical retrieval, soft
          attribute boosts, capped customer-history personalization, and rule-based validation. It does not
          use an LLM parser, dense retrieval, learned calibration, live email sending, or persistent
          rep-correction memory.
        </p>
      </Panel>

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
        <Panel kicker="Problem framing" title="Industrial catalog matching is not normal search">
          <p className="method-copy">
            Fastener matching has a low tolerance for close enough. M8 vs M6, zinc vs black oxide, and
            SHCS vs BHCS are small text differences with large product consequences. Raw top-1 accuracy is
            not enough; the costliest failure is a wrong high-confidence customer response.
          </p>
          <MethodTable rows={problemExamples} />
        </Panel>

        <Panel kicker="Pipeline" title="Inspectable evidence, not one opaque score">
          <div className="method-flow">
            <span>Customer request or email</span>
            <span>Line extraction</span>
            <span>Query normalization</span>
            <span>Attribute parsing</span>
            <span>Candidate retrieval</span>
            <span>Attribute-aware ranking</span>
            <span>Customer-history boost</span>
            <span>Validation gate</span>
            <span>Draft or sales escalation</span>
          </div>
        </Panel>
      </section>

      <section className="two-column-page two-column-page--balanced method-detail">
        <Panel kicker="Retrieval and ranking" title="Which catalog rows are plausible?">
          <p className="method-copy">
            BM25-style retrieval is a practical v1 fit because industrial dimensions, abbreviations, and
            finishes are high-value literal tokens. Ranking combines lexical closeness with parser evidence,
            but ranking alone never authorizes a customer response.
          </p>
          <MethodTable rows={rankingSignals} />
        </Panel>

        <Panel kicker="Customer context" title="History is a disambiguation signal">
          <p className="method-copy">
            Customer order history can influence ranking when a request leaves attributes unspecified. The
            boost is capped and scoped, and explicit query text wins over inferred preference. Customer
            history helps interpret omissions; it does not override the customer.
          </p>
          <DataRow label="Preference scope" value="Global and product-family scoped" />
          <DataRow label="Conflict behavior" value="Explicit request attributes win" />
          <DataRow label="Reference requests" value="Prior SKU/family purchases can help phrases like same washers as last time" />
        </Panel>
      </section>

      <section className="two-column-page two-column-page--balanced method-detail">
        <Panel kicker="Validation gate" title="Selective automation is the safety layer">
          <p className="method-copy">
            Confidence is a rule-based automation signal, not a learned probability. It reflects candidate
            strength, parsed-attribute completeness, top-candidate margin, contradictions, customer-history
            agreement, and whether the request is inside reliable catalog scope.
          </p>
          <MethodTable rows={validationRows} />
        </Panel>

        <Panel kicker="Email handoff" title="Draft preview wraps intake without changing matching">
          <p className="method-copy">
            The email layer is preview-only in v1. Safe requests generate a customer confirmation draft that
            asks for confirmation before invoicing. Review or blocked requests generate an internal sales
            escalation with the original email, parsed lines, top candidates, validation reasons, and
            customer evidence.
          </p>
          <div className="method-callout">
            <BrainCircuit size={20} />
            <p>No real email is sent. Delivery guard fields only show whether a future live path would be eligible.</p>
          </div>
        </Panel>
      </section>

      <section className="two-column-page method-detail">
        <Panel kicker="Evaluation plan" title="Test retrieval and automation separately">
          <p className="method-copy">
            A good result is not only that the right SKU appeared somewhere. A production-like eval must
            distinguish candidate retrieval, attribute correctness, validation-gate safety,
            customer-specific slices, and false auto-response risk.
          </p>
          <MethodTable rows={evaluationRows} />
        </Panel>

        <Panel kicker="Limitations" title="What stayed deliberately out of v1">
          <div className="exclusion-list">
            {limitations.map((limitation) => (
              <span key={limitation}>{limitation}</span>
            ))}
          </div>
          <div className="method-callout">
            <History size={20} />
            <p>
              The goal of v1 is a reliable control loop: parse, retrieve, validate, and hand off safely.
              More model complexity only helps after this loop is measurable.
            </p>
          </div>
        </Panel>
      </section>

      <Panel className="method-detail" kicker="Future work" title="Production upgrade path">
        <MethodTable rows={futureRows} />
        <p className="method-copy">
          The natural production loop is sales-rep review, correction, and reuse of that correction as new
          customer or product-family evidence. Over time, the system should reduce repeated review cases
          while preserving the validation gate.
        </p>
      </Panel>
    </PageSection>
  );
}
