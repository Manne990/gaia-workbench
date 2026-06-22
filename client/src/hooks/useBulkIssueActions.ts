import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import { bulkArchiveIssues, bulkUpdateIssueStatus } from '../api';
import { statusLabels } from '../constants';
import type {
  ArchivedIssueRecovery,
  BulkIssueArchiveResult,
  BulkIssueStatusResult,
  Issue,
  IssueStatus
} from '../types';
import { restoreFocus } from '../utils/focus';

type UseBulkIssueActionsOptions = {
  filteredIssues: Issue[];
  bulkStatusError: string | null;
  setBulkStatusMessage: Dispatch<SetStateAction<string | null>>;
  setBulkStatusError: Dispatch<SetStateAction<string | null>>;
  setRecentlyArchivedIssue: Dispatch<SetStateAction<ArchivedIssueRecovery | null>>;
  getSelectedIssueId: () => string | null;
  refreshIssues: () => void;
  refreshSelectedIssueDetail: (issueId: string) => Promise<void>;
  clearSelectedIssueAfterBulkArchive: () => void;
  bulkArchiveButtonRef: RefObject<HTMLButtonElement | null>;
  issueListHeadingRef: RefObject<HTMLHeadingElement | null>;
};

export function toggleBulkSelectionIds(current: string[], issueId: string, selected: boolean): string[] {
  if (selected) {
    return current.includes(issueId) ? current : [...current, issueId];
  }

  return current.filter((id) => id !== issueId);
}

export function buildBulkStatusChangeMessage(result: BulkIssueStatusResult): string {
  const changedCount = result.updated.length;
  const unchangedCount = result.unchangedIds.length;
  const duplicateCount = result.duplicateIds.length;
  const notFoundCount = result.notFoundIds.length;

  return [
    `Changed ${changedCount} issue${changedCount === 1 ? '' : 's'} to ${statusLabels[result.status]}.`,
    unchangedCount > 0
      ? `${unchangedCount} already ${unchangedCount === 1 ? 'was' : 'were'} ${statusLabels[result.status]}.`
      : null,
    notFoundCount > 0 ? `${notFoundCount} missing ${notFoundCount === 1 ? 'id was' : 'ids were'} skipped.` : null,
    duplicateCount > 0 ? `${duplicateCount} duplicate ${duplicateCount === 1 ? 'id was' : 'ids were'} ignored.` : null
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildBulkArchiveChangeMessage(result: BulkIssueArchiveResult): string {
  const archivedCount = result.archived.length;
  const unchangedCount = result.unchangedIds.length;
  const duplicateCount = result.duplicateIds.length;
  const notFoundCount = result.notFoundIds.length;

  return [
    `Archived ${archivedCount} issue${archivedCount === 1 ? '' : 's'}.`,
    unchangedCount > 0 ? `${unchangedCount} already ${unchangedCount === 1 ? 'was' : 'were'} archived.` : null,
    notFoundCount > 0 ? `${notFoundCount} missing ${notFoundCount === 1 ? 'id was' : 'ids were'} skipped.` : null,
    duplicateCount > 0 ? `${duplicateCount} duplicate ${duplicateCount === 1 ? 'id was' : 'ids were'} ignored.` : null
  ]
    .filter(Boolean)
    .join(' ');
}

export function useBulkIssueActions({
  filteredIssues,
  bulkStatusError,
  setBulkStatusMessage,
  setBulkStatusError,
  setRecentlyArchivedIssue,
  getSelectedIssueId,
  refreshIssues,
  refreshSelectedIssueDetail,
  clearSelectedIssueAfterBulkArchive,
  bulkArchiveButtonRef,
  issueListHeadingRef
}: UseBulkIssueActionsOptions) {
  const [selectedBulkIssueIds, setSelectedBulkIssueIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatusValue] = useState<IssueStatus>('in_progress');
  const [isBulkStatusSubmitting, setIsBulkStatusSubmitting] = useState(false);
  const pendingBulkArchiveFocusRestoreRef = useRef(false);

  useEffect(() => {
    if (!pendingBulkArchiveFocusRestoreRef.current || isBulkStatusSubmitting || !bulkStatusError) {
      return;
    }

    pendingBulkArchiveFocusRestoreRef.current = false;
    restoreFocus(bulkArchiveButtonRef.current, () => issueListHeadingRef.current);
  }, [bulkArchiveButtonRef, bulkStatusError, isBulkStatusSubmitting, issueListHeadingRef]);

  useEffect(() => {
    const visibleIds = new Set(filteredIssues.map((issue) => issue.id));

    setSelectedBulkIssueIds((current) => {
      const next = current.filter((issueId) => visibleIds.has(issueId));

      return next.length === current.length ? current : next;
    });
  }, [filteredIssues]);

  function setBulkStatus(status: IssueStatus) {
    setBulkStatusValue(status);
    setBulkStatusError(null);
  }

  function clearBulkSelection() {
    setSelectedBulkIssueIds([]);
    setBulkStatusError(null);
  }

  function selectAllVisibleBulkIssues() {
    setSelectedBulkIssueIds(filteredIssues.map((issue) => issue.id));
    setBulkStatusError(null);
  }

  function toggleBulkIssueSelection(issueId: string, selected: boolean) {
    setBulkStatusError(null);
    setBulkStatusMessage(null);
    setSelectedBulkIssueIds((current) => toggleBulkSelectionIds(current, issueId, selected));
  }

  async function submitBulkStatusChange() {
    if (selectedBulkIssueIds.length === 0) {
      setBulkStatusError('Select at least one visible issue.');
      return;
    }

    const issueCount = selectedBulkIssueIds.length;
    const confirmed = window.confirm(
      `Change ${issueCount} selected issue${issueCount === 1 ? '' : 's'} to ${statusLabels[bulkStatus]}?`
    );

    if (!confirmed) {
      return;
    }

    setIsBulkStatusSubmitting(true);
    pendingBulkArchiveFocusRestoreRef.current = false;
    setBulkStatusError(null);
    setBulkStatusMessage(null);

    try {
      const result = await bulkUpdateIssueStatus(selectedBulkIssueIds, bulkStatus);
      const selectedIssueIdAfterMutation = getSelectedIssueId();

      setSelectedBulkIssueIds([]);
      refreshIssues();

      if (selectedIssueIdAfterMutation) {
        await refreshSelectedIssueDetail(selectedIssueIdAfterMutation);
      }

      setBulkStatusMessage(buildBulkStatusChangeMessage(result));
    } catch (error) {
      setBulkStatusError(error instanceof Error ? error.message : 'Bulk status update failed.');
    } finally {
      setIsBulkStatusSubmitting(false);
    }
  }

  async function submitBulkArchiveChange() {
    if (selectedBulkIssueIds.length === 0) {
      setBulkStatusError('Select at least one visible issue.');
      return;
    }

    const issueCount = selectedBulkIssueIds.length;
    const confirmed = window.confirm(`Archive ${issueCount} selected issue${issueCount === 1 ? '' : 's'}?`);

    if (!confirmed) {
      return;
    }

    setIsBulkStatusSubmitting(true);
    setBulkStatusError(null);
    setBulkStatusMessage(null);

    try {
      const result = await bulkArchiveIssues(selectedBulkIssueIds);
      const archivedCount = result.archived.length;
      const archivedIds = new Set(result.archived.map((issue) => issue.id));
      const selectedIssueIdAfterMutation = getSelectedIssueId();

      setSelectedBulkIssueIds([]);
      refreshIssues();

      if (archivedCount > 0) {
        setRecentlyArchivedIssue({
          issues: result.archived.map((issue) => ({ id: issue.id, title: issue.title }))
        });
      }

      if (selectedIssueIdAfterMutation && archivedIds.has(selectedIssueIdAfterMutation)) {
        clearSelectedIssueAfterBulkArchive();
      } else if (selectedIssueIdAfterMutation) {
        await refreshSelectedIssueDetail(selectedIssueIdAfterMutation);
      }

      setBulkStatusMessage(buildBulkArchiveChangeMessage(result));
    } catch (error) {
      pendingBulkArchiveFocusRestoreRef.current = true;
      setBulkStatusError(error instanceof Error ? error.message : 'Bulk archive failed.');
    } finally {
      setIsBulkStatusSubmitting(false);
    }
  }

  return {
    selectedBulkIssueIds,
    bulkStatus,
    setBulkStatus,
    isBulkStatusSubmitting,
    clearBulkSelection,
    selectAllVisibleBulkIssues,
    toggleBulkIssueSelection,
    submitBulkStatusChange,
    submitBulkArchiveChange
  };
}
