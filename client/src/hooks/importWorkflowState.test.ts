import { describe, expect, it } from 'vitest';
import type { ImportCounts, ImportPlan } from '../types';
import {
  DEFAULT_IMPORT_POLICY,
  importWorkflowReducer,
  initialImportWorkflowState,
  selectImportWorkflowView
} from './importWorkflowState';

const emptyCounts: ImportCounts = {
  issues: 0,
  comments: 0,
  editHistory: 0,
  activityEvents: 0,
  savedFilterViews: 0
};

function createImportPlan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return {
    valid: true,
    exportVersion: 1,
    policy: 'skip-conflicts',
    summary: {
      input: { ...emptyCounts, issues: 1 },
      toCreate: { ...emptyCounts, issues: 1 },
      toReplace: emptyCounts,
      skip: emptyCounts,
      exactMatches: emptyCounts,
      changed: emptyCounts,
      reject: 0
    },
    decisions: [],
    errors: [],
    warnings: [],
    ...overrides
  };
}

describe('importWorkflowReducer', () => {
  it('starts hidden with no applicable import action', () => {
    expect(selectImportWorkflowView(initialImportWorkflowState)).toEqual({
      isPanelVisible: false,
      canApply: false
    });
  });

  it('starts a new file preview by clearing stale preview data and restoring the default policy', () => {
    const stalePlan = createImportPlan();
    const stalePayload = { exportVersion: 1 };
    const state = importWorkflowReducer(
      {
        ...initialImportWorkflowState,
        payload: stalePayload,
        fileName: 'old.json',
        plan: stalePlan,
        policy: 'replace-conflicts',
        error: 'Old error',
        message: 'Old message'
      },
      { type: 'file-preview-started', fileName: 'fresh.json' }
    );

    expect(state).toMatchObject({
      payload: null,
      fileName: 'fresh.json',
      plan: null,
      policy: DEFAULT_IMPORT_POLICY,
      error: null,
      message: null,
      isPreviewing: true
    });
    expect(selectImportWorkflowView(state)).toEqual({
      isPanelVisible: true,
      canApply: false
    });
  });

  it('allows applying only after a valid preview has both a payload and a plan', () => {
    const payload = { exportVersion: 1 };
    const validPlan = createImportPlan();
    const invalidPlan = createImportPlan({ valid: false, errors: [{ code: 'bad', path: '$', message: 'Bad.' }] });
    const started = importWorkflowReducer(initialImportWorkflowState, {
      type: 'file-preview-started',
      fileName: 'tracker.json'
    });
    const validState = importWorkflowReducer(started, {
      type: 'file-preview-succeeded',
      payload,
      plan: validPlan,
      error: null,
      message: 'Ready to create 1 issues, replace 0 changed issues, and skip 0.'
    });
    const invalidState = importWorkflowReducer(started, {
      type: 'file-preview-succeeded',
      payload,
      plan: invalidPlan,
      error: 'Import preview found validation errors.',
      message: null
    });

    expect(validState.payload).toBe(payload);
    expect(validState.plan).toBe(validPlan);
    expect(validState.isPreviewing).toBe(false);
    expect(selectImportWorkflowView(validState).canApply).toBe(true);
    expect(selectImportWorkflowView(invalidState).canApply).toBe(false);
  });

  it('keeps the previous plan and payload while a policy re-preview fails', () => {
    const payload = { exportVersion: 1 };
    const plan = createImportPlan();
    const previewedState = {
      ...initialImportWorkflowState,
      payload,
      fileName: 'tracker.json',
      plan,
      message: 'Ready to create 1 issues, replace 0 changed issues, and skip 0.'
    };
    const loadingState = importWorkflowReducer(previewedState, {
      type: 'policy-preview-started',
      policy: 'replace-conflicts'
    });
    const failedState = importWorkflowReducer(loadingState, {
      type: 'policy-preview-failed',
      error: 'Import preview failed.'
    });

    expect(loadingState).toMatchObject({
      payload,
      plan,
      policy: 'replace-conflicts',
      error: null,
      message: null,
      isPreviewing: true
    });
    expect(failedState).toMatchObject({
      payload,
      plan,
      policy: 'replace-conflicts',
      error: 'Import preview failed.',
      message: null,
      isPreviewing: false
    });
  });

  it('preserves an applied import preview when changing policy without a retry payload', () => {
    const plan = createImportPlan();
    const state = importWorkflowReducer(
      {
        ...initialImportWorkflowState,
        fileName: 'tracker.json',
        plan,
        message: 'Import applied: 1 issues created, 0 changed issues replaced, 0 skipped.'
      },
      { type: 'policy-selected', policy: 'replace-conflicts' }
    );

    expect(state).toMatchObject({
      payload: null,
      fileName: 'tracker.json',
      plan,
      policy: 'replace-conflicts',
      message: 'Import applied: 1 issues created, 0 changed issues replaced, 0 skipped.'
    });
    expect(selectImportWorkflowView(state)).toEqual({
      isPanelVisible: true,
      canApply: false
    });
  });

  it('clears only the retry payload after a successful apply', () => {
    const payload = { exportVersion: 1 };
    const previewPlan = createImportPlan();
    const appliedPlan = createImportPlan({ policy: 'replace-conflicts' });
    const state = importWorkflowReducer(
      {
        ...initialImportWorkflowState,
        payload,
        fileName: 'tracker.json',
        plan: previewPlan,
        policy: 'replace-conflicts',
        isApplying: true
      },
      {
        type: 'apply-succeeded',
        plan: appliedPlan,
        message: 'Import applied: 1 issues created, 0 changed issues replaced, 0 skipped.'
      }
    );

    expect(state).toMatchObject({
      payload: null,
      fileName: 'tracker.json',
      plan: appliedPlan,
      policy: 'replace-conflicts',
      message: 'Import applied: 1 issues created, 0 changed issues replaced, 0 skipped.',
      isApplying: false
    });
    expect(selectImportWorkflowView(state).canApply).toBe(false);
  });

  it('resets the workflow to the empty default state', () => {
    const plan = createImportPlan();
    const state = importWorkflowReducer(
      {
        ...initialImportWorkflowState,
        payload: { exportVersion: 1 },
        fileName: 'tracker.json',
        plan,
        policy: 'replace-conflicts',
        error: 'Import failed.',
        message: 'Ready.',
        isPreviewing: true,
        isApplying: true
      },
      { type: 'reset' }
    );

    expect(state).toEqual(initialImportWorkflowState);
  });
});
