import { PackageCheck } from 'lucide-react';
import type { CustomerPreference, IntakeLine, IntakeResponse, ValidationDecision } from '../api';
import { ResultCard } from './ResultCard';
import { DataRow, Panel } from './ui/primitives';

const validationCopy: Record<ValidationDecision, string> = {
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

type IntakeResultsSectionProps = {
  response: IntakeResponse | null;
  kicker?: string;
  title?: string;
  emptyCopy?: string;
};

export function IntakeResultsSection({
  response,
  kicker = 'Extracted request',
  title = 'Line validation',
  emptyCopy = 'Run a request to see parsed lines and validation decisions.',
}: IntakeResultsSectionProps) {
  return (
    <section className="results-section" aria-live="polite">
      <div className="section-heading">
        <div>
          <span className="section-kicker">{kicker}</span>
          <h2>{title}</h2>
        </div>
        {response && (
          <p>
            {response.summary.line_count} lines · {validationCopy[response.overall_validation.decision]}
          </p>
        )}
      </div>
      {response ? (
        <div className="intake-line-list">
          {response.lines.map((line) => (
            <IntakeLineCard key={`${line.line_number}-${line.raw_line}`} line={line} />
          ))}
        </div>
      ) : (
        <Panel className="empty-results-panel">
          <h3>No request preview yet</h3>
          <p>{emptyCopy}</p>
        </Panel>
      )}
    </section>
  );
}
