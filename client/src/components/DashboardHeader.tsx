import type { ChangeEvent, RefObject } from 'react';

type DashboardHeaderProps = {
  totalIssues: number;
  newIssueButtonRef: RefObject<HTMLButtonElement | null>;
  importInputRef: RefObject<HTMLInputElement | null>;
  onCreateIssue: (trigger: HTMLElement) => void;
  onChooseImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function DashboardHeader({
  totalIssues,
  newIssueButtonRef,
  importInputRef,
  onCreateIssue,
  onChooseImportFile
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
        <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={onChooseImportFile} />
        <button type="button" className="secondary-button" onClick={() => importInputRef.current?.click()}>
          Import JSON
        </button>
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
