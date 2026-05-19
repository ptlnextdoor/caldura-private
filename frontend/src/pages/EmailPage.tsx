import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, Database, FileText, Mail, Send, ShieldAlert, UserRound } from 'lucide-react';
import { AuthRequired, useAuth } from '../auth';
import { CustomerPicker } from '../components/CustomerPicker';
import { IntakeResultsSection } from '../components/IntakeResults';
import { ValidationPanel } from '../components/ValidationPanel';
import { Button, DataRow, InputShell, MetricBadge, PageSection, Panel } from '../components/ui/primitives';
import {
  emailPreviewRequest,
  fetchCustomers,
  fetchEmailStatus,
  type Customer,
  type DeliveryGuard,
  type EmailDraft,
  type EmailPreviewResponse,
  type EmailStatus,
} from '../api';
import { isDemoMode } from '../env';

const demoMode = isDemoMode();

const defaultEmail = {
  fromEmail: 'contractor@example.com',
  subject: 'Need fasteners',
  body: `Hey, can you get me:
10 pcs 3/4-10 hex head cap screws
25 M8 flat washers
same washers as last time
Need zinc if possible`,
};

const presets = [
  {
    label: 'Mixed inquiry',
    ...defaultEmail,
  },
  {
    label: 'Review gate',
    fromEmail: 'buyer@example.com',
    subject: 'Need washers',
    body: '25 M8 steel flat washer',
  },
  {
    label: 'Blocked repair',
    fromEmail: 'tech@example.com',
    subject: 'Need repair screws',
    body: 'screws for bottom of MacBook Pro',
  },
];

const recommendedActionCopy: Record<EmailPreviewResponse['recommended_action'], string> = {
  DRAFT_CUSTOMER_CONFIRMATION: 'Customer draft',
  ESCALATE_SALES_REVIEW: 'Sales review',
  ESCALATE_BLOCKED_REQUEST: 'Blocked escalation',
};

function EmailDraftPanel({
  draft,
  emptyCopy,
  kicker,
  title,
}: {
  draft: EmailDraft | null;
  emptyCopy: string;
  kicker: string;
  title: string;
}) {
  return (
    <Panel className="draft-panel" kicker={kicker} title={title}>
      {draft ? (
        <div className="draft-panel-content">
          <div className="draft-meta-grid">
            <DataRow label="To" value={draft.to ?? 'Sales rep email not configured'} />
            <DataRow label="Subject" value={draft.subject} />
          </div>
          <pre className="draft-body">{draft.body}</pre>
        </div>
      ) : (
        <p className="empty-copy">{emptyCopy}</p>
      )}
    </Panel>
  );
}

function DeliveryGuardPanel({ guard }: { guard: DeliveryGuard | null }) {
  if (!guard) {
    return (
      <Panel className="delivery-guard-panel">
        <div className="inline-title">
          <ShieldAlert size={18} />
          <span>Delivery guard</span>
        </div>
        <p className="empty-copy">Run an email preview to see whether a live send would be blocked.</p>
      </Panel>
    );
  }

  return (
    <Panel className="delivery-guard-panel">
      <div className="inline-title">
        <ShieldAlert size={18} />
        <span>Delivery guard</span>
      </div>
      <DataRow label="Email mode" value={guard.email_mode} />
      <DataRow label="Send enabled" value={guard.send_enabled ? 'true' : 'false'} />
      <DataRow label="Recipient allowlisted" value={guard.recipient_allowlisted ? 'yes' : 'no'} />
      <DataRow label="Live send eligible" value={guard.can_send_customer_email ? 'yes' : 'no'} />
      <p className="internal-note">
        Manual previews never send. AgentMail inbound processing only replies to customers when every guard condition passes.
      </p>
      {guard.blocked_reasons.length > 0 && (
        <div className="blocked-reasons">
          <span className="evidence-title">Blocked reasons</span>
          <ul className="reason-list">
            {guard.blocked_reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function AgentMailStatusPanel({ status }: { status: EmailStatus | null }) {
  return (
    <Panel className="delivery-guard-panel" kicker="AgentMail" title="Live inbox connection">
      {status ? (
        <>
          <DataRow label="Inbox" value={status.inbox_id ?? 'not configured'} />
          <DataRow label="API key" value={status.api_key_configured ? 'configured' : 'missing'} />
          <DataRow label="Webhook" value={status.webhook_configured ? 'verified endpoint configured' : 'secret missing'} />
          <DataRow label="Live replies" value={status.email_mode === 'live' && status.send_enabled ? 'eligible when allowlisted' : 'guarded'} />
          <DataRow label="Allowlist" value={`${status.recipient_allowlist_count} recipient${status.recipient_allowlist_count === 1 ? '' : 's'}`} />
        </>
      ) : (
        <p className="empty-copy">Loading the safe AgentMail configuration summary.</p>
      )}
      <p className="internal-note">
        Incoming mail is handled by AgentMail. Customer replies still require AUTO_RESPOND, live mode,
        send enabled, and an allowlisted sender.
      </p>
    </Panel>
  );
}

export function EmailPage() {
  const auth = useAuth();
  const [fromEmail, setFromEmail] = useState(defaultEmail.fromEmail);
  const [subject, setSubject] = useState(defaultEmail.subject);
  const [body, setBody] = useState(defaultEmail.body);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerFilter, setCustomerFilter] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(demoMode ? 'CUST-001' : '');
  const [usePersonalization, setUsePersonalization] = useState(true);
  const [response, setResponse] = useState<EmailPreviewResponse | null>(null);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? customers[0],
    [customers, selectedCustomerId],
  );
  const selectedCustomerName = useMemo(() => {
    if (demoMode) {
      return selectedCustomerId ? selectedCustomer?.name ?? selectedCustomerId : null;
    }
    return usePersonalization ? selectedCustomer?.name : null;
  }, [selectedCustomer, selectedCustomerId, usePersonalization]);

  useEffect(() => {
    if (!demoMode && !auth.accessToken) return;
    fetchCustomers(demoMode ? null : auth.accessToken)
      .then(setCustomers)
      .catch((err: Error) => setError(err.message));
  }, [auth.accessToken]);

  useEffect(() => {
    fetchEmailStatus()
      .then(setEmailStatus)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!demoMode && !auth.accessToken) return;
    void runPreview({
      fromEmail: defaultEmail.fromEmail,
      subject: defaultEmail.subject,
      body: defaultEmail.body,
      usePersonalization: demoMode ? Boolean(selectedCustomerId) : usePersonalization,
      customerId: selectedCustomerId,
    });
    // Initial demo state is intentionally initialized once on page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken]);

  async function runPreview(overrides: Partial<{
    fromEmail: string;
    subject: string;
    body: string;
    usePersonalization: boolean;
    customerId: string;
  }> = {}) {
    if (!demoMode && !auth.accessToken) return;
    const request = {
      fromEmail,
      subject,
      body,
      usePersonalization,
      customerId: selectedCustomerId,
      ...overrides,
    };

    setLoading(true);
    setError(null);
    try {
      const result = await emailPreviewRequest({
        fromEmail: request.fromEmail,
        subject: request.subject,
        body: request.body,
      }, {
        accessToken: auth.accessToken,
        usePersonalization: demoMode ? Boolean(request.customerId) : request.usePersonalization,
        customerId: demoMode ? request.customerId : null,
      });
      setResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email preview failed');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runPreview();
  }

  function choosePreset(preset: typeof presets[number]) {
    setFromEmail(preset.fromEmail);
    setSubject(preset.subject);
    setBody(preset.body);
    void runPreview({
      fromEmail: preset.fromEmail,
      subject: preset.subject,
      body: preset.body,
    });
  }

  function togglePersonalization(enabled: boolean) {
    setUsePersonalization(enabled);
    void runPreview({ usePersonalization: enabled });
  }

  function selectDemoCustomer(id: string) {
    setSelectedCustomerId(id);
    void runPreview({ customerId: id, usePersonalization: Boolean(id) });
  }

  if (!demoMode && auth.loading) {
    return (
      <PageSection className="email-page" kicker="Authentication" title="Checking session.">
        <Panel>
          <p className="empty-copy">Loading your identity provider session.</p>
        </Panel>
      </PageSection>
    );
  }

  if (!demoMode && !auth.accessToken) {
    return (
      <PageSection
        className="email-page"
        copy="Preview the draft workflow for an inbound customer email. Caldura reuses intake validation, then produces either a customer confirmation draft or an internal sales escalation without sending anything."
        kicker="Preview-only email automation"
        title="Inbound Email Draft Preview"
      >
        <AuthRequired />
      </PageSection>
    );
  }

  return (
    <PageSection
      className="email-page"
      copy="Preview the draft workflow for an inbound customer email. Caldura reuses intake validation, then produces either a customer confirmation draft or an internal sales escalation without sending anything."
      kicker="Preview-only email automation"
      title="Inbound Email Draft Preview"
    >
      <div className="hero-meta">
        <MetricBadge
          label="Recommended action"
          value={response ? recommendedActionCopy[response.recommended_action] : 'Loading'}
          tone={response?.recommended_action === 'DRAFT_CUSTOMER_CONFIRMATION' ? 'green' : 'orange'}
        />
        <MetricBadge label="Parsed lines" value={response ? String(response.intake.summary.line_count) : 'Loading'} />
        <MetricBadge label="Workflow" value="Preview + webhook" tone="muted" />
        <MetricBadge
          label="Inbox"
          value={emailStatus?.inbox_id ?? 'sales@ptlnextdoor.com'}
          tone={emailStatus?.api_key_configured ? 'blue' : 'muted'}
        />
        <MetricBadge label="Customer" value={selectedCustomerName ?? 'Base ranking'} tone={selectedCustomerName ? 'blue' : 'muted'} />
      </div>

      <section className="workspace">
        <div className="search-column">
          <Panel className="search-panel intake-request-panel">
            <form onSubmit={handleSubmit}>
              <div className="input-grid">
                <div>
                  <label className="field-label" htmlFor="from-email">
                    From
                  </label>
                  <InputShell icon={<Mail size={16} />}>
                    <input
                      id="from-email"
                      value={fromEmail}
                      onChange={(event) => setFromEmail(event.target.value)}
                      placeholder="customer@example.com"
                    />
                  </InputShell>
                </div>
                <div>
                  <label className="field-label" htmlFor="email-subject">
                    Subject
                  </label>
                  <InputShell icon={<Send size={16} />}>
                    <input
                      id="email-subject"
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      placeholder="Need fasteners"
                    />
                  </InputShell>
                </div>
              </div>

              <label className="field-label" htmlFor="email-body">
                Email body
              </label>
              <div className="textarea-shell">
                <FileText size={20} />
                <textarea
                  id="email-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Paste the customer email body here"
                  rows={8}
                />
              </div>
              <div className="intake-actions">
                <Button disabled={loading} type="submit">
                  {loading ? 'Processing' : 'Generate draft preview'}
                </Button>
                <span>{response ? `${response.intake.summary.latency_ms} ms` : 'Preview-only, no send'}</span>
              </div>
              <div className="example-row" aria-label="Demo email presets">
                {presets.map((preset) => (
                  <Button key={preset.label} onClick={() => choosePreset(preset)} variant="secondary">
                    {preset.label}
                  </Button>
                ))}
              </div>
            </form>
          </Panel>

          {error && (
            <div className="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
            </div>
          )}

          <section className="email-artifacts" aria-live="polite">
            <div className="section-heading">
              <div>
                <span className="section-kicker">Draft artifacts</span>
                <h2>What the email workflow would hand off</h2>
              </div>
              <p>Exactly one draft path appears after validation: customer confirmation or internal escalation.</p>
            </div>
            <div className="draft-grid">
              <EmailDraftPanel
                draft={response?.customer_confirmation_draft ?? null}
                emptyCopy="No customer-facing draft is produced unless every extracted line passes AUTO_RESPOND."
                kicker="Customer path"
                title="Confirmation draft"
              />
              <EmailDraftPanel
                draft={response?.internal_sales_draft ?? null}
                emptyCopy="No internal escalation is produced when the request is safe enough for a customer confirmation draft."
                kicker="Sales path"
                title="Escalation draft"
              />
            </div>
          </section>

          <IntakeResultsSection
            response={response?.intake ?? null}
            kicker="Parsed intake"
            title="Why that draft path was chosen"
            emptyCopy="Run an email preview to inspect parsed lines, matches, and validation decisions."
          />
        </div>

        <aside className="inspector-column">
          <Panel className="context-banner">
            <ClipboardList size={18} />
            <span>
              {selectedCustomerName
                ? `Email preview personalized for ${selectedCustomerName}`
                : 'Email preview using base catalog ranking'}
            </span>
          </Panel>
          <ValidationPanel validation={response?.intake.overall_validation ?? null} />
          <AgentMailStatusPanel status={emailStatus} />
          <DeliveryGuardPanel guard={response?.delivery_guard ?? null} />
          {response && (
            <Panel className="intake-summary-panel">
              <div className="inline-title">
                <Database size={18} />
                <span>Email preview summary</span>
              </div>
              <DataRow label="Action" value={recommendedActionCopy[response.recommended_action]} />
              <DataRow label="Auto-respond lines" value={response.intake.summary.auto_respond_count} />
              <DataRow label="Sales-review lines" value={response.intake.summary.sales_review_count} />
              <DataRow label="Do-not-respond lines" value={response.intake.summary.do_not_respond_count} />
            </Panel>
          )}
          {demoMode ? (
            <CustomerPicker
              customers={customers}
              filter={customerFilter}
              onFilterChange={setCustomerFilter}
              onSelect={selectDemoCustomer}
              selectedId={selectedCustomerId}
            />
          ) : (
            <Panel className="customer-panel">
              <div className="inline-title">
                <UserRound size={18} />
                <span>Customer context</span>
              </div>
              <label className="history-toggle">
                <input
                  checked={usePersonalization}
                  onChange={(event) => togglePersonalization(event.target.checked)}
                  type="checkbox"
                />
                <span>Use my order history</span>
              </label>
              <p className="empty-copy">
                {customers[0]
                  ? `${customers[0].id} · ${customers[0].profile_summary}`
                  : 'Your customer profile is loading.'}
              </p>
            </Panel>
          )}
        </aside>
      </section>
    </PageSection>
  );
}
