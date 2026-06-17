import type { ChangeEvent, RefObject } from 'react';
import { useState } from 'react';
import { applyImport, previewImport } from '../api';
import type { ImportConflictPolicy, ImportPlan } from '../types';
import { restoreFocus } from '../utils/focus';

const DEFAULT_IMPORT_POLICY: ImportConflictPolicy = 'skip-conflicts';

function importReadyMessage(plan: ImportPlan): string {
  return `Ready to create ${plan.summary.toCreate.issues} issues, replace ${plan.summary.toReplace.issues} changed issues, and skip ${plan.summary.skip.issues}.`;
}

function importAppliedMessage(plan: ImportPlan): string {
  return `Import applied: ${plan.summary.toCreate.issues} issues created, ${plan.summary.toReplace.issues} changed issues replaced, ${plan.summary.skip.issues} skipped.`;
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
  const [importPayload, setImportPayload] = useState<unknown | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [importPolicy, setImportPolicy] = useState<ImportConflictPolicy>(DEFAULT_IMPORT_POLICY);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isImportPreviewing, setIsImportPreviewing] = useState(false);
  const [isImportApplying, setIsImportApplying] = useState(false);

  const isImportPanelVisible = Boolean(
    importFileName || importPlan || importError || isImportPreviewing || importMessage
  );
  const canApplyImport = Boolean(importPayload && importPlan?.valid && !isImportApplying);

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

    const report = {
      ...importPlan,
      sourceFileName: importFileName,
      generatedAt: new Date().toISOString()
    };

    downloadTextFile(`${sanitizeFilePart(importFileName)}-import-preview-report.json`, JSON.stringify(report, null, 2));
  }

  function clearImportState() {
    setImportPayload(null);
    setImportFileName(null);
    setImportPlan(null);
    setImportPolicy(DEFAULT_IMPORT_POLICY);
    setImportError(null);
    setImportMessage(null);
    setIsImportPreviewing(false);
    setIsImportApplying(false);
    resetImportInput();
    restoreFocus(importButtonRef.current, () => newIssueButtonRef.current ?? issueListHeadingRef.current);
  }

  async function handleChooseImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    setImportPayload(null);
    setImportFileName(file.name);
    setImportPlan(null);
    setImportPolicy(DEFAULT_IMPORT_POLICY);
    setImportError(null);
    setImportMessage(null);
    setIsImportPreviewing(true);

    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const plan = await previewImport(payload, DEFAULT_IMPORT_POLICY);

      setImportPayload(payload);
      setImportPlan(plan);
      setImportError(plan.valid ? null : 'Import preview found validation errors.');
      setImportMessage(plan.valid ? importReadyMessage(plan) : null);
    } catch (error) {
      setImportPayload(null);
      setImportPlan(null);
      setImportError(
        error instanceof SyntaxError
          ? 'File is not valid JSON.'
          : importRequestErrorMessage(error, 'Import preview failed.')
      );
    } finally {
      setIsImportPreviewing(false);
      resetImportInput();
    }
  }

  async function submitImport() {
    if (!importPayload) {
      return;
    }

    setIsImportApplying(true);
    setImportError(null);

    try {
      const plan = await applyImport(importPayload, importPolicy);
      const selectedIssueIdAtApply = getSelectedIssueId();

      setImportPlan(plan);

      if (!plan.valid) {
        if (importPlanReferencesIssue(plan, selectedIssueIdAtApply)) {
          await refreshSelectedIssueDetail(selectedIssueIdAtApply);
        }
        setImportError('Import apply found validation errors.');
        return;
      }

      setImportPayload(null);
      setImportMessage(importAppliedMessage(plan));
      returnToFirstPage();
      await loadSavedViews();

      if (importPlanReferencesIssue(plan, selectedIssueIdAtApply)) {
        await refreshSelectedIssueDetail(selectedIssueIdAtApply);
      }
    } catch (error) {
      setImportError(importRequestErrorMessage(error, 'Import apply failed.'));
    } finally {
      setIsImportApplying(false);
      resetImportInput();
    }
  }

  async function changeImportPolicy(nextPolicy: ImportConflictPolicy) {
    setImportPolicy(nextPolicy);

    if (!importPayload) {
      return;
    }

    setIsImportPreviewing(true);
    setImportError(null);
    setImportMessage(null);

    try {
      const plan = await previewImport(importPayload, nextPolicy);

      setImportPlan(plan);
      setImportError(plan.valid ? null : 'Import preview found validation errors.');
      setImportMessage(plan.valid ? importReadyMessage(plan) : null);
    } catch (error) {
      setImportError(importRequestErrorMessage(error, 'Import preview failed.'));
    } finally {
      setIsImportPreviewing(false);
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
