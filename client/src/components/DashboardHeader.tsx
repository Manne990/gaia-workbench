import type { ChangeEvent, RefObject } from 'react';
import type { ServiceHealthState } from '../types';

type DashboardHeaderProps = {
  totalIssues: number;
  serviceHealthState: ServiceHealthState;
  csvExportHref: string;
  newIssueButtonRef: RefObject<HTMLButtonElement | null>;
  importInputRef: RefObject<HTMLInputElement | null>;
  onCreateIssue: (trigger: HTMLElement) => void;
  onChooseImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenCommandPalette: (trigger: HTMLElement) => void;
};

function serviceHealthText(state: ServiceHealthState): string {
  if (state === 'online') {
    return 'Service: online';
  }

  if (state === 'unavailable') {
    return 'Service: unavailable';
  }

  return 'Service: checking';
}

export function DashboardHeader({
  totalIssues,
  serviceHealthState,
  csvExportHref,
  newIssueButtonRef,
  importInputRef,
  onCreateIssue,
  onChooseImportFile,
  onOpenCommandPalette
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
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          aria-label="Import JSON file"
          hidden
          onChange={onChooseImportFile}
        />
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
        <button
          type="button"
          className="secondary-button"
          onClick={(event) => onOpenCommandPalette(event.currentTarget)}
        >
          Quick Actions
          <span className="button-shortcut">⌘/Ctrl+K</span>
        </button>
        <a className="button-link secondary-button" href={csvExportHref} download="tinytracker-issues.csv">
          Download CSV
        </a>
        <div
          className={`service-status service-status-${serviceHealthState}`}
          role="status"
          aria-label="Service status"
          aria-live="polite"
          aria-atomic="true"
        >
          {serviceHealthText(serviceHealthState)}
        </div>
        <div className="total-summary" aria-label="Issue totals">
          <span>Total Issues</span>
          <strong>{totalIssues}</strong>
        </div>
      </div>
    </header>
  );
}
