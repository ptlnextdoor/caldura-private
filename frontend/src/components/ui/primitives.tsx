import type { ReactNode } from 'react';
import { LiquidGlass } from './liquid-glass';

type PanelProps = {
  children: ReactNode;
  className?: string;
  glass?: boolean;
  title?: ReactNode;
  kicker?: string;
};

export function Panel({ children, className = '', glass = true, title, kicker }: PanelProps) {
  const content = (
    <>
      {(title || kicker) && (
        <div className="panel-heading">
          {kicker && <span className="section-kicker">{kicker}</span>}
          {title && <h2>{title}</h2>}
        </div>
      )}
      {children}
    </>
  );

  if (!glass) {
    return <section className={`panel ${className}`}>{content}</section>;
  }

  return (
    <LiquidGlass as="section" className={`panel panel-glass ${className}`} contentClassName="panel-glass-content">
      {content}
    </LiquidGlass>
  );
}

type PageSectionProps = {
  children: ReactNode;
  className?: string;
  kicker?: string;
  title?: string;
  copy?: string;
};

export function PageSection({ children, className = '', kicker, title, copy }: PageSectionProps) {
  return (
    <section className={`page-section ${className}`}>
      {(kicker || title || copy) && (
        <div className="section-copy">
          {kicker && <span className="section-kicker">{kicker}</span>}
          {title && <h1>{title}</h1>}
          {copy && <p>{copy}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

type ButtonProps = {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'ghost';
};

export function Button({
  children,
  className = '',
  disabled,
  onClick,
  type = 'button',
  variant = 'primary',
}: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant} ${className}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

type InputShellProps = {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
};

export function InputShell({ children, icon, className = '' }: InputShellProps) {
  return (
    <div className={`input-shell ${className}`}>
      {icon && <span className="input-icon">{icon}</span>}
      {children}
    </div>
  );
}

type MetricBadgeProps = {
  label: string;
  value: string;
  tone?: 'blue' | 'green' | 'orange' | 'muted';
  title?: string;
  className?: string;
};

export function MetricBadge({ label, value, tone = 'blue', title, className = '' }: MetricBadgeProps) {
  return (
    <div className={`metric-badge metric-${tone} ${className}`} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type DataRowProps = {
  label: string;
  value: ReactNode;
};

export function DataRow({ label, value }: DataRowProps) {
  return (
    <div className="data-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
