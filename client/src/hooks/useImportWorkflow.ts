import type { ChangeEvent, RefObject } from 'react';
import { useReducer } from 'react';
import { applyImport, previewImport } from '../api';
import type { ImportConflictPolicy, ImportCounts, ImportPlan } from '../types';
import { restoreFocus } from '../utils/focus';
import {
  DEFAULT_IMPORT_POLICY,
  importWorkflowReducer,
  initialImportWorkflowState,
  selectImportWorkflowView
} from './importWorkflowState';

function totalCounts(counts: ImportCounts): number {
  return counts.issues + counts.comments + counts.editHistory + counts.activityEvents + counts.savedFilterViews;
}

function importReadyMessage(plan: ImportPlan): string {
  return `Ready: ${totalCounts(plan.summary.categories.creates)} creates, ${totalCounts(plan.summary.categories.updates)} updates, ${totalCounts(plan.summary.categories.duplicates)} duplicates, ${totalCounts(plan.summary.categories.conflicts)} conflicts.`;
}

function importAppliedMessage(plan: ImportPlan): string {
  return `Import applied: ${totalCounts(plan.summary.categories.creates)} created, ${totalCounts(plan.summary.categories.updates)} updated, ${totalCounts(plan.summary.categories.duplicates)} duplicates, ${totalCounts(plan.summary.categories.conflicts)} conflicts.`;
}

function importRequestErrorMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof Error && error.message ? error.message : fallbackMessage;
}

function importPlanReferencesIssue(plan: ImportPlan, issueId: string | null): issueId is string {
  return Boolean(
    issueId &&
    plan.decisions.some(
      (decision) =>
        decision.entity === 'issue' &&
        decision.issueId === issueId &&
        (decision.decision === 'import' || decision.decision === 'replace-existing')
    )
  );
}

export function buildImportReport(
  plan: ImportPlan,
  sourceFileName: string | null,
  selectedPolicy: ImportConflictPolicy,
  generatedAt: string = new Date().toISOString()
) {
  return {
    ...plan,
    policy: selectedPolicy,
    sourceFileName,
    generatedAt
  };
}

type UseImportWorkflowOptions = {
  importInputRef: RefObject<HTMLInputElement | null>;
  importButtonRef: RefObject<HTMLButtonElement | null>;
  newIssueButtonRef: RefObject<HTMLButtonElement | null>;
  issueListHeadingRef: RefObject<HTMLHeadingElement | null>;
  getSelectedIssueId: () => string | null;
  refreshSelectedIssueDetail: (issueId: string) => Promise<void>;
  loadSavedViews: () => Promise<void>;
  returnToFirstPage: () => void;
};

export function useImportWorkflow({
  importInputRef,
  importButtonRef,
  newIssueButtonRef,
  issueListHeadingRef,
  getSelectedIssueId,
  refreshSelectedIssueDetail,
  loadSavedViews,
  returnToFirstPage
}: UseImportWorkflowOptions) {
  const [importState, dispatchImportState] = useReducer(importWorkflowReducer, initialImportWorkflowState);
  const {
    payload: importPayload,
    fileName: importFileName,
    plan: importPlan,
    policy: importPolicy,
    error: importError,
    message: importMessage,
    isPreviewing: isImportPreviewing,
    isApplying: isImportApplying
  } = importState;
  const { isPanelVisible: isImportPanelVisible, canApply: canApplyImport } = selectImportWorkflowView(importState);

  function resetImportInput() {
    if (importInputRef.current) {
      importInputRef.current.value = '';
    }
  }

  function downloadTextFile(fileName: string, text: string) {
    const blob = new Blob([text], { type: 'application/json; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }

  function sanitizeFilePart(fileName: string | null): string {
    return (
      (fileName ?? 'import')
        .replace(/\.json$/i, '')
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'import'
    );
  }

  function downloadImportReport() {
    if (!importPlan) {
      return;
    }

    const report = buildImportReport(importPlan, importFileName, importPolicy);

    downloadTextFile(`${sanitizeFilePart(importFileName)}-import-preview-report.json`, JSON.stringify(report, null, 2));
  }

  function clearImportState() {
    dispatchImportState({ type: 'reset' });
    resetImportInput();
    restoreFocus(importButtonRef.current, () => newIssueButtonRef.current ?? issueListHeadingRef.current);
  }

  async function handleChooseImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    dispatchImportState({ type: 'file-preview-started', fileName: file.name });

    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const plan = await previewImport(payload, DEFAULT_IMPORT_POLICY);

      dispatchImportState({
        type: 'file-preview-succeeded',
        payload,
        plan,
        error: plan.valid ? null : 'Import preview found validation errors.',
        message: plan.valid ? importReadyMessage(plan) : null
      });
    } catch (error) {
      dispatchImportState({
        type: 'file-preview-failed',
        error:
          error instanceof SyntaxError
            ? 'File is not valid JSON.'
            : importRequestErrorMessage(error, 'Import preview failed.')
      });
    } finally {
      resetImportInput();
    }
  }

  async function submitImport() {
    if (!importPayload) {
      return;
    }

    dispatchImportState({ type: 'apply-started' });

    try {
      const plan = await applyImport(importPayload, importPolicy);
      const selectedIssueIdAtApply = getSelectedIssueId();

      dispatchImportState({ type: 'apply-plan-received', plan });

      if (!plan.valid) {
        if (importPlanReferencesIssue(plan, selectedIssueIdAtApply)) {
          await refreshSelectedIssueDetail(selectedIssueIdAtApply);
        }
        dispatchImportState({
          type: 'apply-invalid',
          plan,
          error: 'Import apply found validation errors.'
        });
        return;
      }

      dispatchImportState({ type: 'apply-succeeded', plan, message: importAppliedMessage(plan) });
      returnToFirstPage();
      await loadSavedViews();

      if (importPlanReferencesIssue(plan, selectedIssueIdAtApply)) {
        await refreshSelectedIssueDetail(selectedIssueIdAtApply);
      }
    } catch (error) {
      dispatchImportState({
        type: 'apply-failed',
        error: importRequestErrorMessage(error, 'Import apply failed.')
      });
    } finally {
      resetImportInput();
    }
  }

  async function changeImportPolicy(nextPolicy: ImportConflictPolicy) {
    if (!importPayload) {
      dispatchImportState({ type: 'policy-selected', policy: nextPolicy });
      return;
    }

    dispatchImportState({ type: 'policy-preview-started', policy: nextPolicy });

    try {
      const plan = await previewImport(importPayload, nextPolicy);

      dispatchImportState({
        type: 'policy-preview-succeeded',
        plan,
        error: plan.valid ? null : 'Import preview found validation errors.',
        message: plan.valid ? importReadyMessage(plan) : null
      });
    } catch (error) {
      dispatchImportState({
        type: 'policy-preview-failed',
        error: importRequestErrorMessage(error, 'Import preview failed.')
      });
    }
  }

  return {
    importFileName,
    importPlan,
    importPolicy,
    importError,
    importMessage,
    isImportPreviewing,
    isImportApplying,
    isImportPanelVisible,
    canApplyImport,
    handleChooseImportFile,
    changeImportPolicy,
    downloadImportReport,
    submitImport,
    clearImportState
  };
}
