import { BadgeCheck, History, PackageCheck, SearchCheck } from 'lucide-react';
import type { SearchDecision, SearchResult } from '../api';
import { MetricBadge } from './ui/primitives';

type ResultCardProps = {
  result: SearchResult;
  decision: SearchDecision;
};

const chipLabels: Array<[keyof SearchResult['attribute_matches'], string]> = [
  ['thread', 'thread'],
  ['type', 'type'],
  ['length', 'length'],
  ['material', 'material'],
  ['finish', 'finish'],
];

function decisionLabel(result: SearchResult, decision: SearchDecision) {
  if (result.rank !== 1) {
    return 'Alternative';
  }
  if (decision === 'ready-to-order') {
    return 'Ready to order';
  }
  if (decision === 'guidance-only') {
    return 'Guidance only';
  }
  return 'Sales review';
}

function decisionClass(result: SearchResult, decision: SearchDecision) {
  if (result.rank !== 1) {
    return 'confidence-candidate';
  }
  if (decision === 'ready-to-order') {
    return 'confidence-high';
  }
  if (decision === 'guidance-only') {
    return 'confidence-low';
  }
  return 'confidence-medium';
}

export function ResultCard({ result, decision }: ResultCardProps) {
  const confidencePercent = Math.round(result.confidence * 100);
  const closenessPercent = Math.round(result.model_closeness * 100);
  const DecisionIcon = result.rank === 1 && decision === 'ready-to-order' ? BadgeCheck : SearchCheck;

  return (
    <article className="result-card">
      <div className="result-rank">{result.rank}</div>
      <div className="result-main">
        <div className="result-heading">
          <div>
            <h3>{result.description}</h3>
            <p>
              {result.sku} · {result.catalog_id}
              {!result.active && <span className="inactive"> · inactive</span>}
            </p>
          </div>
          <div className={`confidence ${decisionClass(result, decision)}`}>
            <DecisionIcon size={16} />
            <span>{decisionLabel(result, decision)} · {confidencePercent}%</span>
          </div>
        </div>

        <div className="score-bar" aria-label={`Confidence ${confidencePercent} percent`}>
          <span style={{ width: `${confidencePercent}%` }} />
        </div>

        <div className="chip-row">
          {chipLabels.map(([key, label]) => (
            <span className={`match-chip ${result.attribute_matches[key] ? 'hit' : 'miss'}`} key={key}>
              {label}
            </span>
          ))}
        </div>

        {result.personalized && (
          <div className="personalization">
            <History size={15} />
            <span>{result.personalization_note ?? 'ranked with order history'}</span>
          </div>
        )}
      </div>
      <div className="result-side">
        <PackageCheck className="result-mark" size={22} />
        <MetricBadge label="Model closeness" value={`${closenessPercent}%`} tone="blue" />
        <MetricBadge
          label="Rank score"
          value={result.score.toFixed(3)}
          tone="muted"
          title="Internal ranking strength; can exceed 1.0 because customer history and catalog evidence add boosts."
        />
      </div>
    </article>
  );
}
