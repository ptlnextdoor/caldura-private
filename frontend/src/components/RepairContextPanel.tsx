import { AlertTriangle, Boxes, HelpCircle, ShieldAlert, Wrench } from 'lucide-react';
import type { RepairContext } from '../api';
import { Button, DataRow, Panel } from './ui/primitives';

type RepairContextPanelProps = {
  context: RepairContext | null;
  onChooseRewrite: (query: string) => void;
};

const statusLabel: Record<RepairContext['status'], string> = {
  ready: 'Ready',
  'needs-clarification': 'Needs clarification',
  blocked: 'Blocked',
};

const safetyLabel: Record<RepairContext['safety_class'], string> = {
  low: 'Low risk',
  caution: 'Use caution',
  blocked: 'Blocked',
};

export function RepairContextPanel({ context, onChooseRewrite }: RepairContextPanelProps) {
  if (!context) {
    return (
      <Panel className="repair-panel">
        <div className="inline-title">
          <Wrench size={18} />
          <span>Repair context</span>
        </div>
        <p className="empty-copy">
          Try a repair query like “screws for bottom of MacBook Pro” to translate the job into catalog candidates.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className={`repair-panel repair-${context.safety_class}`}>
      <div className="inline-title">
        <Wrench size={18} />
        <span>Repair context</span>
      </div>

      <div className="repair-summary">
        <span className="repair-category">{context.category}</span>
        <h2>{context.title}</h2>
        {context.match_behavior === 'guidance-only' ? (
          <p>
            Likely repair intent detected. This is <strong>not a stocked generic catalog match</strong>.
          </p>
        ) : (
          <p>
            Likely repair intent detected. Results below use the catalog query{' '}
            <strong>{context.canonical_query}</strong>.
          </p>
        )}
      </div>

      <div className="repair-grid">
        <DataRow label="Status" value={statusLabel[context.status]} />
        <DataRow label="Safety" value={safetyLabel[context.safety_class]} />
        <DataRow label="Confidence" value={`${Math.round(context.confidence * 100)}%`} />
        <DataRow label="Stock" value={context.stock_status.replace('-', ' ')} />
        <DataRow label="Source" value={context.provenance.replace('-', ' ')} />
      </div>

      {(context.recommended_part || context.recommended_tool || context.fitment_note) && (
        <div className="repair-guidance">
          {context.recommended_part && <DataRow label="Recommended part" value={context.recommended_part} />}
          {context.recommended_tool && <DataRow label="Tool" value={context.recommended_tool} />}
          {context.fitment_note && <p>{context.fitment_note}</p>}
          <small>Source: {context.provenance.replace('-', ' ')}</small>
        </div>
      )}

      {context.missing_facts.length > 0 && (
        <div className="repair-note">
          <HelpCircle size={16} />
          <span>Missing: {context.missing_facts.map((fact) => fact.replace(/_/g, ' ')).join(', ')}</span>
        </div>
      )}

      {context.clarifying_question && (
        <div className="repair-question">
          <strong>{context.clarifying_question.label}</strong>
          <div className="repair-choice-row">
            {context.clarifying_question.choices.map((choice) => (
              <Button
                key={choice.query_rewrite}
                onClick={() => onChooseRewrite(choice.query_rewrite)}
                variant="secondary"
              >
                {choice.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {context.kit.length > 0 && (
        <div className="repair-kit">
          <div className="inline-title compact">
            <Boxes size={16} />
            <span>Kit idea</span>
          </div>
          {context.kit.map((item) => (
            <div className="repair-kit-row" key={item.label}>
              <strong>{item.label}</strong>
              <span>{item.quantity} pcs</span>
              <small>{item.note}</small>
            </div>
          ))}
        </div>
      )}

      {context.warnings.length > 0 && (
        <div className="repair-warnings">
          <div className="inline-title compact">
            {context.safety_class === 'blocked' ? <ShieldAlert size={16} /> : <AlertTriangle size={16} />}
            <span>Verify before buying</span>
          </div>
          {context.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
    </Panel>
  );
}
