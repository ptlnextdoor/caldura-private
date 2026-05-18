import { SlidersHorizontal } from 'lucide-react';
import type { CustomerPreference } from '../api';
import { Panel } from './ui/primitives';

type CustomerPreferencePanelProps = {
  preferences: CustomerPreference[];
};

function confidenceLabel(value: number) {
  if (value >= 0.75) return 'high';
  if (value >= 0.45) return 'medium';
  return 'low';
}

export function CustomerPreferencePanel({ preferences }: CustomerPreferencePanelProps) {
  return (
    <Panel className="preference-panel">
      <div className="inline-title">
        <SlidersHorizontal size={18} />
        <span>Customer preferences</span>
      </div>
      {preferences.length === 0 ? (
        <p className="empty-copy">No customer preference was available for this request.</p>
      ) : (
        <div className="preference-list">
          {preferences.map((preference) => (
            <div
              className={`preference-row ${preference.applied_to_query ? 'applied' : ''}`}
              key={`${preference.scope}-${preference.attribute}-${preference.value}`}
            >
              <strong>{preference.attribute}: {preference.value}</strong>
              <span>{preference.scope}</span>
              <small>
                {preference.evidence_count}/{preference.total_count} orders · {confidenceLabel(preference.confidence)}
                {preference.applied_to_query ? ' · applied' : ''}
              </small>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
