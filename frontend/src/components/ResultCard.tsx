import { BadgeCheck, History, PackageCheck, SearchCheck } from 'lucide-react';
import type { SearchDecision, SearchResult, ValidationDecision } from '../api';
import { LiquidGlass } from './ui/liquid-glass';
import { MetricBadge } from './ui/primitives';

type ResultCardProps = {
  result: SearchResult;
  decision: SearchDecision;
  validationDecision?: ValidationDecision;
};

const chipLabels: Array<[keyof SearchResult['attribute_matches'], string]> = [
  ['thread', 'thread'],
  ['type', 'type'],
  ['length', 'length'],
  ['material', 'material'],
  ['finish', 'finish'],
];

function decisionLabel(result: SearchResult, decision: SearchDecision, validationDecision?: ValidationDecision) {
  if (result.rank !== 1) {
    return 'Alternative';
  }
  if (validationDecision === 'AUTO_RESPOND') {
    return 'Auto-respond';
  }
  if (validationDecision === 'DO_NOT_RESPOND') {
    return 'Do not respond';
  }
  if (validationDecision === 'SALES_REVIEW') {
    return 'Sales review';
  }
  if (decision === 'ready-to-order') {
    return 'Ready to order';
  }
  if (decision === 'guidance-only') {
    return 'Guidance only';
  }
  return 'Sales review';
}

function decisionClass(result: SearchResult, decision: SearchDecision, validationDecision?: ValidationDecision) {
  if (result.rank !== 1) {
    return 'confidence-candidate';
  }
  if (validationDecision === 'AUTO_RESPOND') {
    return 'confidence-high';
  }
  if (validationDecision === 'DO_NOT_RESPOND') {
    return 'confidence-low';
  }
  if (validationDecision === 'SALES_REVIEW') {
    return 'confidence-medium';
  }
  if (decision === 'ready-to-order') {
    return 'confidence-high';
  }
  if (decision === 'guidance-only') {
    return 'confidence-low';
  }
  return 'confidence-medium';
}

export function ResultCard({ result, decision, validationDecision }: ResultCardProps) {
  const confidencePercent = Math.round(result.confidence * 100);
  const closenessPercent = Math.round(result.model_closeness * 100);
  const DecisionIcon = result.rank === 1 && decision === 'ready-to-order' ? BadgeCheck : SearchCheck;

  return (
    <LiquidGlass as="article" className="result-card result-card-glass" contentClassName="result-card-content">
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
          <div className={`confidence ${decisionClass(result, decision, validationDecision)}`}>
            <DecisionIcon size={16} />
            <span>{decisionLabel(result, decision, validationDecision)} · {confidencePercent}%</span>
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

        {result.match_evidence.length > 0 && (
          <div className="evidence-block" aria-label="Why this result">
            <span className="evidence-title">Why this result</span>
            <div className="evidence-row">
              {result.match_evidence.slice(0, 4).map((item) => (
                <span className="evidence-chip evidence-positive" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        {result.rank === 1 && decision === 'sales-review' && result.review_reasons.length > 0 && (
          <div className="evidence-block" aria-label="Needs review">
            <span className="evidence-title">Needs review</span>
            <div className="evidence-row">
              {result.review_reasons.slice(0, 4).map((item) => (
                <span className="evidence-chip evidence-warning" key={item}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        {result.contradictions.length > 0 && (
          <div className="evidence-block" aria-label="Contradictions">
            <span className="evidence-title">Contradictions</span>
            <div className="evidence-row">
              {result.contradictions.slice(0, 3).map((item) => (
                <span
                  className={`evidence-chip ${item.severity === 'hard' ? 'evidence-danger' : 'evidence-warning'}`}
                  key={`${item.field}-${item.query_value}-${item.result_value}`}
                >
                  {item.field}: {item.query_value} vs {item.result_value}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="result-side">
        <PackageCheck className="result-mark" size={22} />
        <MetricBadge label="Model closeness" value={`${closenessPercent}%`} tone="blue" />
        <MetricBadge label="Auto order" value={result.can_auto_order ? 'Yes' : 'No'} tone={result.can_auto_order ? 'green' : 'muted'} />
        <MetricBadge
          label="Rank score"
          value={result.score.toFixed(3)}
          tone="muted"
          title="Internal ranking strength; can exceed 1.0 because customer history and catalog evidence add boosts."
        />
      </div>
    </LiquidGlass>
  );
}
