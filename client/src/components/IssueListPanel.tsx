import type { RefObject } from 'react';
import { priorityLabels, priorityOrder, statusLabels, statusOrder } from '../constants';
import type {
  ActiveFilterSummary,
  DashboardDensity,
  Issue,
  IssueListPagination,
  IssueStatus,
  LoadState,
  PriorityFilter,
  SavedFilterView,
  StatusFilter
} from '../types';
import { formatDate, formatDueDate } from '../utils/formatters';
import { renderMarkdownLiteInline } from '../utils/markdown';
import { isIssueStale } from '../utils/stale';

type IssueListPanelProps = {
  loadState: LoadState;
  loadError: string | null;
  issues: Issue[];
  filteredIssues: Issue[];
  pagination: IssueListPagination;
  totalIssueCount: number;
  issueListSummary: string;
  hasActiveFilters: boolean;
  activeFilterSummaries: ActiveFilterSummary[];
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  priorityFilter: PriorityFilter;
  onPriorityFilterChange: (value: PriorityFilter) => void;
  labelFilter: string;
  onLabelFilterChange: (value: string) => void;
  includeArchived: boolean;
  onIncludeArchivedChange: (value: boolean) => void;
  blockedOnly: boolean;
  onBlockedOnlyChange: (value: boolean) => void;
  staleOnly: boolean;
  onStaleOnlyChange: (value: boolean) => void;
  pageSize: number;
  onPageSizeChange: (value: number) => void;
  dashboardDensity: DashboardDensity;
  onDashboardDensityChange: (value: DashboardDensity) => void;
  savedViews: SavedFilterView[];
  selectedSavedViewId: string;
  savedViewName: string;
  savedViewError: string | null;
  isSavedViewBusy: boolean;
  onSavedViewSelect: (viewId: string) => void;
  onSavedViewNameChange: (name: string) => void;
  onSaveCurrentView: () => void;
  onApplySavedView: () => void;
  onRenameSavedView: () => void;
  onDeleteSavedView: () => void;
  issueSearchInputRef: RefObject<HTMLInputElement | null>;
  issueListHeadingRef: RefObject<HTMLHeadingElement | null>;
  onClearFilters: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onOpenIssue: (issue: Issue, trigger: HTMLElement) => void;
  onEditIssue: (issue: Issue, trigger: HTMLElement) => void;
  onArchiveIssue: (issue: Issue, trigger: HTMLElement) => void;
  onUnarchiveIssue: (issue: Issue, trigger: HTMLElement) => void;
  recentlyArchivedIssue: { id: string; title: string } | null;
  onUndoArchiveIssue: (trigger: HTMLElement) => void;
  onDismissArchiveRecovery: () => void;
  selectedBulkIssueIds: string[];
  bulkStatus: IssueStatus;
  bulkStatusMessage: string | null;
  bulkStatusError: string | null;
  isBulkStatusSubmitting: boolean;
  onBulkStatusChange: (value: IssueStatus) => void;
  onToggleIssueSelection: (issueId: string, selected: boolean) => void;
  onSelectAllVisibleIssues: () => void;
  onClearBulkSelection: () => void;
  onApplyBulkStatus: () => void;
};

export function IssueListPanel({
  loadState,
  loadError,
  issues,
  filteredIssues,
  pagination,
  totalIssueCount,
  issueListSummary,
  hasActiveFilters,
  activeFilterSummaries,
  searchFilter,
  onSearchFilterChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  labelFilter,
  onLabelFilterChange,
  includeArchived,
  onIncludeArchivedChange,
  blockedOnly,
  onBlockedOnlyChange,
  staleOnly,
  onStaleOnlyChange,
  pageSize,
  onPageSizeChange,
  dashboardDensity,
  onDashboardDensityChange,
  savedViews,
  selectedSavedViewId,
  savedViewName,
  savedViewError,
  isSavedViewBusy,
  onSavedViewSelect,
  onSavedViewNameChange,
  onSaveCurrentView,
  onApplySavedView,
  onRenameSavedView,
  onDeleteSavedView,
  issueSearchInputRef,
  issueListHeadingRef,
  onClearFilters,
  onPreviousPage,
  onNextPage,
  onOpenIssue,
  onEditIssue,
  onArchiveIssue,
  onUnarchiveIssue,
  recentlyArchivedIssue,
  onUndoArchiveIssue,
  onDismissArchiveRecovery,
  selectedBulkIssueIds,
  bulkStatus,
  bulkStatusMessage,
  bulkStatusError,
  isBulkStatusSubmitting,
  onBulkStatusChange,
  onToggleIssueSelection,
  onSelectAllVisibleIssues,
  onClearBulkSelection,
  onApplyBulkStatus
}: IssueListPanelProps) {
  const selectedIssueIdSet = new Set(selectedBulkIssueIds);
  const selectedCount = selectedBulkIssueIds.length;

  return (
    <section className="issue-panel" aria-labelledby="issue-list-heading" aria-busy={loadState === 'loading'}>
      {recentlyArchivedIssue ? (
        <div className="archive-undo-notice" role="status">
          <span>{`Issue "${recentlyArchivedIssue.title}" archived.`}</span>
          <div className="archive-undo-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={(event) => onUndoArchiveIssue(event.currentTarget)}
              aria-label={`Undo archive of ${recentlyArchivedIssue.title}`}
            >
              Undo archive
            </button>
            <button type="button" className="ghost-button" onClick={onDismissArchiveRecovery}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="panel-header">
        <div>
          <h2 id="issue-list-heading" ref={issueListHeadingRef} tabIndex={-1}>
            Issue List
          </h2>
          <p>{issueListSummary}</p>
        </div>
        <div className="panel-header-tools">
          <div className="density-toggle" role="group" aria-label="Dashboard density">
            <span>Density</span>
            <button
              type="button"
              className={dashboardDensity === 'comfortable' ? 'is-active' : undefined}
              aria-pressed={dashboardDensity === 'comfortable'}
              onClick={() => onDashboardDensityChange('comfortable')}
            >
              Comfortable
            </button>
            <button
              type="button"
              className={dashboardDensity === 'compact' ? 'is-active' : undefined}
              aria-pressed={dashboardDensity === 'compact'}
              onClick={() => onDashboardDensityChange('compact')}
            >
              Compact
            </button>
          </div>
          <span className="panel-count" aria-label={`${filteredIssues.length} issues shown`}>
            {filteredIssues.length}
          </span>
        </div>
      </div>

      <div className="filter-panel" role="search" aria-label="Issue filters">
        <label className="filter-field" htmlFor="issue-search-filter">
          <span>Search</span>
          <input
            id="issue-search-filter"
            ref={issueSearchInputRef}
            value={searchFilter}
            onChange={(event) => onSearchFilterChange(event.target.value)}
          />
        </label>

        <label className="filter-field" htmlFor="issue-status-filter">
          <span>Status</span>
          <select
            id="issue-status-filter"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as StatusFilter)}
          >
            <option value="all">All statuses</option>
            {statusOrder.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field" htmlFor="issue-priority-filter">
          <span>Priority</span>
          <select
            id="issue-priority-filter"
            value={priorityFilter}
            onChange={(event) => onPriorityFilterChange(event.target.value as PriorityFilter)}
          >
            <option value="all">All priorities</option>
            {priorityOrder.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabels[priority]}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field" htmlFor="issue-label-filter">
          <span>Label</span>
          <input
            id="issue-label-filter"
            value={labelFilter}
            onChange={(event) => onLabelFilterChange(event.target.value)}
          />
        </label>

        <label className="filter-toggle" htmlFor="issue-include-archived-filter">
          <input
            id="issue-include-archived-filter"
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => onIncludeArchivedChange(event.target.checked)}
          />
          <span>Include archived</span>
        </label>

        <label className="filter-toggle" htmlFor="issue-blocked-only-filter">
          <input
            id="issue-blocked-only-filter"
            type="checkbox"
            checked={blockedOnly}
            onChange={(event) => onBlockedOnlyChange(event.target.checked)}
          />
          <span>Blocked only</span>
        </label>

        <label className="filter-toggle" htmlFor="issue-stale-only-filter">
          <input
            id="issue-stale-only-filter"
            type="checkbox"
            checked={staleOnly}
            onChange={(event) => onStaleOnlyChange(event.target.checked)}
          />
          <span>Stale only</span>
        </label>

        <div className="filter-actions">
          <button type="button" className="secondary-button" onClick={onClearFilters} disabled={!hasActiveFilters}>
            Clear Filters
          </button>
        </div>
      </div>

      <details className="secondary-controls" aria-label="Saved views and page settings">
        <summary>
          <span className="secondary-controls-title">Saved views & page settings</span>
          <span className="secondary-controls-state" aria-hidden="true">
            <span className="secondary-controls-state-closed">Show</span>
            <span className="secondary-controls-state-open">Hide</span>
          </span>
        </summary>

        <div className="secondary-controls-content">
          <label className="filter-field page-size-field" htmlFor="issue-page-size-filter">
            <span>Page size</span>
            <select
              id="issue-page-size-filter"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>

          <div className="saved-view-panel" aria-label="Saved filter views">
            <label className="filter-field" htmlFor="saved-view-select">
              <span>Saved views</span>
              <select
                id="saved-view-select"
                value={selectedSavedViewId}
                onChange={(event) => onSavedViewSelect(event.target.value)}
              >
                <option value="">Choose a view</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="filter-field saved-view-name-field" htmlFor="saved-view-name">
              <span>View name</span>
              <input
                id="saved-view-name"
                value={savedViewName}
                onChange={(event) => onSavedViewNameChange(event.target.value)}
              />
            </label>

            <div className="saved-view-actions">
              <button type="button" className="secondary-button" onClick={onSaveCurrentView} disabled={isSavedViewBusy}>
                Save View
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={onApplySavedView}
                disabled={isSavedViewBusy || !selectedSavedViewId}
              >
                Apply View
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={onRenameSavedView}
                disabled={isSavedViewBusy || !selectedSavedViewId}
              >
                Rename
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={onDeleteSavedView}
                disabled={isSavedViewBusy || !selectedSavedViewId}
              >
                Delete
              </button>
            </div>

            {savedViewError ? (
              <p className="saved-view-error" role="alert">
                {savedViewError}
              </p>
            ) : null}
          </div>
        </div>
      </details>

      {hasActiveFilters ? (
        <div className="active-filter-summary" aria-label="Active filters">
          <span>{filteredIssues.length} shown</span>
          <span className="active-filter-count" aria-label="Active filter count">
            {activeFilterSummaries.length} active {activeFilterSummaries.length === 1 ? 'filter' : 'filters'}
          </span>
          <div className="active-filter-list">
            {activeFilterSummaries.map((filter) => (
              <span key={filter.key} className="active-filter-chip">
                {filter.label}: {filter.value}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {loadState === 'loaded' && filteredIssues.length > 0 ? (
        <div className="bulk-status-bar" aria-label="Bulk status actions">
          <div className="bulk-status-summary">
            <strong>{selectedCount} selected</strong>
            <span>Current page only</span>
          </div>
          <div className="bulk-status-controls">
            <button
              type="button"
              className="ghost-button"
              onClick={onSelectAllVisibleIssues}
              disabled={selectedCount === filteredIssues.length || isBulkStatusSubmitting}
            >
              Select all visible
            </button>
            <label className="bulk-status-field" htmlFor="bulk-status-select">
              <span>Status</span>
              <select
                id="bulk-status-select"
                value={bulkStatus}
                onChange={(event) => onBulkStatusChange(event.target.value as IssueStatus)}
                disabled={isBulkStatusSubmitting}
              >
                {statusOrder.map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={onApplyBulkStatus}
              disabled={selectedCount === 0 || isBulkStatusSubmitting}
            >
              Change Status
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={onClearBulkSelection}
              disabled={selectedCount === 0 || isBulkStatusSubmitting}
            >
              Clear
            </button>
          </div>
          {bulkStatusMessage ? (
            <p className="bulk-status-feedback" role="status">
              {bulkStatusMessage}
            </p>
          ) : null}
          {bulkStatusError ? (
            <p className="bulk-status-feedback error" role="alert">
              {bulkStatusError}
            </p>
          ) : null}
        </div>
      ) : null}

      {loadState === 'loading' ? (
        <div className="state-message" role="status">
          Loading issues...
        </div>
      ) : null}

      {loadState === 'error' ? (
        <div className="state-message error" role="alert">
          {loadError ?? 'Unable to load issues.'}
        </div>
      ) : null}

      {loadState === 'loaded' && issues.length === 0 ? (
        pagination.total === 0 ? (
          hasActiveFilters || totalIssueCount > 0 ? (
            <div className="state-message filtered-empty">
              <strong>No issues match the active filters.</strong>
              <button type="button" className="secondary-button" onClick={onClearFilters}>
                Clear Filters
              </button>
            </div>
          ) : (
            <div className="state-message">No issues yet.</div>
          )
        ) : (
          <div className="state-message filtered-empty">
            <strong>No issues on this page.</strong>
            <button
              type="button"
              className="secondary-button"
              onClick={onPreviousPage}
              disabled={!pagination.hasPrevious}
            >
              Previous
            </button>
          </div>
        )
      ) : null}

      {loadState === 'loaded' && filteredIssues.length > 0 ? (
        <>
          <div className={`table-wrap issue-table-density-${dashboardDensity}`}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Select</th>
                  <th scope="col">Issue</th>
                  <th scope="col">Status</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Due</th>
                  <th scope="col">Updated</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.map((issue) => {
                  const issueIsStale = isIssueStale(issue.updatedAt);
                  const isSelected = selectedIssueIdSet.has(issue.id);

                  return (
                    <tr
                      key={issue.id}
                      className={
                        [
                          isSelected ? 'selected-row' : '',
                          issue.isOverdue ? 'overdue-row' : '',
                          issue.isBlocked ? 'blocked-row' : '',
                          issue.archivedAt ? 'archived-row' : '',
                          issueIsStale ? 'stale-row' : ''
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                    >
                      <td className="selection-cell">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => onToggleIssueSelection(issue.id, event.target.checked)}
                          aria-label={`Select ${issue.title}`}
                        />
                      </td>
                      <td>
                        <strong>{issue.title}</strong>
                        {issue.archivedAt ? <span className="archived-pill">Archived</span> : null}
                        {issue.isBlocked ? <span className="blocked-pill">Blocked</span> : null}
                        {issueIsStale ? <span className="stale-pill">Stale</span> : null}
                        {issue.description
                          ? renderMarkdownLiteInline(issue.description, { className: 'issue-description-snippet' })
                          : null}
                        {issue.labels.length > 0 ? (
                          <div className="label-row" aria-label={`Labels for ${issue.title}`}>
                            {issue.labels.map((label) => (
                              <span key={label} className="label-pill">
                                {label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className={`pill status-${issue.status}`}>{statusLabels[issue.status]}</span>
                      </td>
                      <td>
                        <span className={`pill priority-${issue.priority}`}>{priorityLabels[issue.priority]}</span>
                      </td>
                      <td>
                        <div className="due-date-cell">
                          <span className={issue.isOverdue ? 'due-date-text overdue' : 'due-date-text'}>
                            {issue.dueDate ? formatDueDate(issue.dueDate) : 'No due date'}
                          </span>
                          {issue.isOverdue ? <span className="overdue-pill">Overdue</span> : null}
                        </div>
                      </td>
                      <td>{formatDate(issue.updatedAt)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={(event) => onOpenIssue(issue, event.currentTarget)}
                            aria-label={`Open ${issue.title}`}
                          >
                            Open
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={(event) => onEditIssue(issue, event.currentTarget)}
                            aria-label={`Edit ${issue.title}`}
                          >
                            Edit
                          </button>
                          {issue.archivedAt ? (
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={(event) => onUnarchiveIssue(issue, event.currentTarget)}
                              aria-label={`Unarchive ${issue.title}`}
                            >
                              Unarchive
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="ghost-button"
                              onClick={(event) => onArchiveIssue(issue, event.currentTarget)}
                              aria-label={`Archive ${issue.title}`}
                            >
                              Archive
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <nav className="pagination-bar" aria-label="Issue pagination">
            <button
              type="button"
              className="secondary-button"
              onClick={onPreviousPage}
              disabled={!pagination.hasPrevious}
            >
              Previous
            </button>
            <span>
              Page {pagination.page} of {Math.max(pagination.totalPages, 1)}
            </span>
            <span>
              Showing {(pagination.page - 1) * pagination.limit + 1}-
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </span>
            <button type="button" className="secondary-button" onClick={onNextPage} disabled={!pagination.hasMore}>
              Next
            </button>
          </nav>
        </>
      ) : null}
    </section>
  );
}
