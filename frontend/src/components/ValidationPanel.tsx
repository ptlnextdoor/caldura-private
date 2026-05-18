import { ShieldCheck } from 'lucide-react';
import type { Validation } from '../api';
import { DataRow, Panel } from './ui/primitives';

type ValidationPanelProps = {
  validation: Validation | null;
};

const labels: Record<Validation['decision'], string> = {
  AUTO_RESPOND: 'Auto-respond',
  SALES_REVIEW: 'Sales review',
  DO_NOT_RESPOND: 'Do not respond',
};

export function ValidationPanel({ validation }: ValidationPanelProps) {
  if (!validation) {
    return (
      <Panel className="validation-panel">
        <div className="inline-title">
          <ShieldCheck size={18} />
          <span>Validation gate</span>
        </div>
        <p className="empty-copy">Run a request to see whether the system can respond or should route to sales.</p>
      </Panel>
    );
  }

  return (
    <Panel className="validation-panel">
      <div className="inline-title">
        <ShieldCheck size={18} />
        <span>Validation gate</span>
      </div>
      <DataRow label="Decision" value={labels[validation.decision]} />
      <DataRow label="Reason" value={validation.reason} />
      <DataRow
        label="History influence"
        value={validation.customer_history_influenced ? 'Applied' : 'Not applied'}
      />
      <DataRow
        label="Risky attributes"
        value={validation.missing_risky_attributes.length ? validation.missing_risky_attributes.join(', ') : 'none'}
      />
      <p className="internal-note">{validation.internal_note}</p>
    </Panel>
  );
}
