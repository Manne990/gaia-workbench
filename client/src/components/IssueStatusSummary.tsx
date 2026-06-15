import { statusLabels } from '../constants';
import type { IssueStatus } from '../types';

type IssueStatusSummaryProps = {
  statusCounts: Array<{ status: IssueStatus; count: number }>;
};

export function IssueStatusSummary({ statusCounts }: IssueStatusSummaryProps) {
  return (
    <div className="status-grid" aria-label="Issue status summary">
      {statusCounts.map(({ status, count }) => (
        <article key={status}>
          <span>{statusLabels[status]}</span>
          <strong>{count}</strong>
        </article>
      ))}
    </div>
  );
}
