import type { IssueAuditSummary as IssueAuditSummaryData } from '../types';

type IssueAuditSummaryProps = {
  auditSummary: IssueAuditSummaryData;
};

type AuditMetric = {
  key: string;
  label: string;
  count: number;
};

export function IssueAuditSummary({ auditSummary }: IssueAuditSummaryProps) {
  const openIssues = auditSummary.totalIssues - auditSummary.byStatus.done;
  const metrics: AuditMetric[] = [
    { key: 'open', label: 'Open', count: openIssues },
    { key: 'done', label: 'Done', count: auditSummary.byStatus.done },
    { key: 'blocked', label: 'Blocked', count: auditSummary.totalBlockedIssues },
    { key: 'overdue', label: 'Overdue', count: auditSummary.totalOverdueIssues },
    { key: 'stale', label: 'Stale', count: auditSummary.totalStaleIssues },
    { key: 'archived', label: 'Archived', count: auditSummary.totalArchivedIssues }
  ];

  return (
    <section className="audit-summary-strip" aria-label="Tracker audit summary">
      {metrics.map((metric) => (
        <article key={metric.key} className="audit-summary-metric">
          <span>{metric.label}</span>
          <strong>{metric.count}</strong>
        </article>
      ))}
    </section>
  );
}
