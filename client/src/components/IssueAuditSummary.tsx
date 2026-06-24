import type { ActiveFilterSummary, IssueAuditSummary as IssueAuditSummaryData } from '../types';

type IssueAuditSummaryProps = {
  auditSummary: IssueAuditSummaryData;
  activeFilterSummaries?: ActiveFilterSummary[];
};

type AuditMetric = {
  key: string;
  label: string;
  count: number;
};

export function IssueAuditSummary({ auditSummary, activeFilterSummaries = [] }: IssueAuditSummaryProps) {
  const openIssues = auditSummary.totalIssues - auditSummary.byStatus.done;
  const archivedBlockerLabel =
    auditSummary.dependencyEdges.archivedBlocked === 1 ? 'archived blocker' : 'archived blockers';
  const boardHealthParts = [`${auditSummary.totalBlockedIssues} blocked`, `${auditSummary.totalWaitingIssues} waiting`];
  if (auditSummary.dependencyEdges.archivedBlocked > 0) {
    boardHealthParts.push(`${auditSummary.dependencyEdges.archivedBlocked} ${archivedBlockerLabel}`);
  }
  const boardHealthLabel = `Board health: ${boardHealthParts.join(', ')}`;
  const metrics: AuditMetric[] = [
    { key: 'open', label: 'Open', count: openIssues },
    { key: 'done', label: 'Done', count: auditSummary.byStatus.done },
    { key: 'blocked', label: 'Blocked', count: auditSummary.totalBlockedIssues },
    { key: 'archived-blockers', label: 'Archived blockers', count: auditSummary.dependencyEdges.archivedBlocked },
    { key: 'overdue', label: 'Overdue', count: auditSummary.totalOverdueIssues },
    { key: 'stale', label: 'Stale', count: auditSummary.totalStaleIssues },
    { key: 'archived', label: 'Archived', count: auditSummary.totalArchivedIssues }
  ];
  const emptyResultFilterSummary = activeFilterSummaries.map((filter) => `${filter.label}: ${filter.value}`).join(', ');
  const showFilteredEmptyState = auditSummary.totalIssues === 0 && activeFilterSummaries.length > 0;

  return (
    <section className="audit-summary-strip" aria-label="Tracker audit summary">
      {showFilteredEmptyState ? (
        <p className="audit-summary-empty-state" aria-label="Audit summary empty reason">
          Active filters are hiding all audit results: {emptyResultFilterSummary}.
        </p>
      ) : null}
      <article className="audit-summary-metric board-health-metric" aria-label={boardHealthLabel}>
        <span>Board health</span>
        <strong className="board-health-counts">
          <span>{auditSummary.totalBlockedIssues} blocked</span>
          <span>{auditSummary.totalWaitingIssues} waiting</span>
          {auditSummary.dependencyEdges.archivedBlocked > 0 ? (
            <span>
              {auditSummary.dependencyEdges.archivedBlocked} {archivedBlockerLabel}
            </span>
          ) : null}
        </strong>
      </article>
      {metrics.map((metric) => (
        <article key={metric.key} className="audit-summary-metric">
          <span>{metric.label}</span>
          <strong>{metric.count}</strong>
        </article>
      ))}
    </section>
  );
}
