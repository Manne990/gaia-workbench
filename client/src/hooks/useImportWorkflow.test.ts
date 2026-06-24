import { describe, expect, it } from 'vitest';
import type { ImportCounts, ImportPlan } from '../types';
import { buildImportReport } from './useImportWorkflow';

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
      input: emptyCounts,
      toCreate: emptyCounts,
      toReplace: emptyCounts,
      skip: emptyCounts,
      exactMatches: emptyCounts,
      changed: emptyCounts,
      categories: {
        creates: emptyCounts,
        updates: emptyCounts,
        duplicates: emptyCounts,
        conflicts: emptyCounts
      },
      editHistorySummary: {
        create: 0,
        replace: 0,
        skipDuplicate: 0,
        skipConflict: 0,
        reject: 0
      },
      reject: 0
    },
    decisions: [],
    errors: [],
    warnings: [],
    ...overrides
  };
}

describe('buildImportReport', () => {
  it('preserves source file context and the current selected policy in the downloaded report', () => {
    const plan = createImportPlan({ policy: 'skip-conflicts' });

    const report = buildImportReport(plan, 'tinytracker-import.json', 'replace-conflicts', '2026-06-24T16:20:00.000Z');

    expect(report).toMatchObject({
      valid: true,
      exportVersion: 1,
      policy: 'replace-conflicts',
      sourceFileName: 'tinytracker-import.json',
      generatedAt: '2026-06-24T16:20:00.000Z'
    });
    expect(report.summary).toBe(plan.summary);
    expect(report.decisions).toBe(plan.decisions);
    expect(report.errors).toBe(plan.errors);
    expect(report.warnings).toBe(plan.warnings);
  });
});
