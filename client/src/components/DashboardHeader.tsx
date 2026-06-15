import type { RefObject } from 'react';

type DashboardHeaderProps = {
  totalIssues: number;
  newIssueButtonRef: RefObject<HTMLButtonElement | null>;
  onCreateIssue: (trigger: HTMLElement) => void;
};

export function DashboardHeader({
  totalIssues,
  newIssueButtonRef,
  onCreateIssue
}: DashboardHeaderProps) {
  return (
    <header className="dashboard-header">
      <div>
        <p className="eyebrow">TinyTracker</p>
        <h1>Dashboard</h1>
      </div>
      <div className="header-actions">
        <a className="button-link secondary-button" href="/api/export" download="tinytracker-export.json">
          Download JSON
        </a>
        <button
          type="button"
          className="primary-button"
          ref={newIssueButtonRef}
          onClick={(event) => onCreateIssue(event.currentTarget)}
        >
          New Issue
        </button>
        <div className="total-summary" aria-label="Issue totals">
          <span>Total Issues</span>
          <strong>{totalIssues}</strong>
        </div>
      </div>
    </header>
  );
}
