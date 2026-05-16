import { Gauge } from 'lucide-react';
import type { AttrSpec } from '../api';
import { DataRow, Panel } from './ui/primitives';

type ParsedPanelProps = {
  parsed: AttrSpec | null;
};

export function ParsedPanel({ parsed }: ParsedPanelProps) {
  if (!parsed) {
    return (
      <Panel className="parsed-panel">
        <div className="inline-title">
          <Gauge size={18} />
          <span>Parsed signals</span>
        </div>
        <p className="empty-copy">Run a search to see extracted thread, type, material, finish, and leftover tokens.</p>
      </Panel>
    );
  }

  const fields: Array<[string, string | null]> = [
    ['Thread', parsed.thread_spec],
    ['Length', parsed.length_raw],
    ['Type', parsed.product_type],
    ['Material', parsed.material],
    ['Finish', parsed.finish],
    ['Standard', parsed.standard],
  ];

  return (
    <Panel className="parsed-panel">
      <div className="inline-title">
        <Gauge size={18} />
        <span>Parsed signals</span>
      </div>
      <div className="parsed-grid">
        {fields.map(([label, value]) => (
          <DataRow key={label} label={label} value={value || 'not specified'} />
        ))}
      </div>
      <DataRow label="Extraction confidence" value={`${Math.round(parsed.extraction_confidence * 100)}%`} />
      {parsed.raw_tokens_unconsumed.length > 0 && (
        <p className="unconsumed">Unclassified: {parsed.raw_tokens_unconsumed.slice(0, 8).join(', ')}</p>
      )}
    </Panel>
  );
}
