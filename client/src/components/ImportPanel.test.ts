import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportPanel } from './ImportPanel';
import type { ImportPlan } from '../types';

const emptyCounts = {
  issues: 0,
  comments: 0,
  editHistory: 0,
  activityEvents: 0,
  savedFilterViews: 0
};
const emptyCategories = {
  creates: emptyCounts,
  updates: emptyCounts,
  duplicates: emptyCounts,
  conflicts: emptyCounts
};
const emptyEditHistorySummary = {
  create: 0,
  replace: 0,
  skipDuplicate: 0,
  skipConflict: 0,
  reject: 0
};

describe('ImportPanel', () => {
  it('shows structured validation values alongside import preview errors', () => {
    const plan: ImportPlan = {
      valid: false,
      exportVersion: 1,
      policy: 'skip-conflicts',
      summary: {
        input: emptyCounts,
        toCreate: emptyCounts,
        toReplace: emptyCounts,
        skip: emptyCounts,
        exactMatches: emptyCounts,
        changed: emptyCounts,
        categories: emptyCategories,
        editHistorySummary: emptyEditHistorySummary,
        reject: 1
      },
      decisions: [],
      errors: [
        {
          code: 'invalid_dependency',
          path: '$.issues[0].dependsOnIssueIds[0]',
          message: 'Dependency references must be issue id strings.',
          value: { id: 'missing-issue' }
        }
      ],
      warnings: []
    };

    const markup = renderToStaticMarkup(
      createElement(ImportPanel, {
        fileName: 'tracker.json',
        importPlan: plan,
        importPolicy: 'skip-conflicts',
        importError: 'Import preview found validation errors.',
        importMessage: null,
        isPreviewing: false,
        isApplying: false,
        canApply: false,
        onPolicyChange: () => {},
        onDownloadReport: () => {},
        onApply: () => {},
        onCancel: () => {}
      })
    );

    expect(markup).toContain('Dependency references must be issue id strings.');
    expect(markup).toContain('Received');
    expect(markup).toContain('{&quot;id&quot;:&quot;missing-issue&quot;}');
  });

  it('renders explicit import preview categories', () => {
    const plan: ImportPlan = {
      valid: true,
      exportVersion: 1,
      policy: 'skip-conflicts',
      summary: {
        input: {
          ...emptyCounts,
          issues: 10
        },
        toCreate: {
          ...emptyCounts,
          issues: 3
        },
        toReplace: {
          ...emptyCounts,
          issues: 2
        },
        skip: {
          ...emptyCounts,
          issues: 5
        },
        exactMatches: {
          ...emptyCounts,
          issues: 4
        },
        changed: {
          ...emptyCounts,
          issues: 1
        },
        categories: {
          creates: {
            ...emptyCounts,
            issues: 3
          },
          updates: {
            ...emptyCounts,
            issues: 2
          },
          duplicates: {
            ...emptyCounts,
            issues: 4
          },
          conflicts: {
            ...emptyCounts,
            issues: 1
          }
        },
        editHistorySummary: emptyEditHistorySummary,
        reject: 0
      },
      decisions: [],
      errors: [],
      warnings: []
    };

    const markup = renderToStaticMarkup(
      createElement(ImportPanel, {
        fileName: 'tracker.json',
        importPlan: plan,
        importPolicy: 'skip-conflicts',
        importError: null,
        importMessage: 'Ready.',
        isPreviewing: false,
        isApplying: false,
        canApply: true,
        onPolicyChange: () => {},
        onDownloadReport: () => {},
        onApply: () => {},
        onCancel: () => {}
      })
    );

    expect(markup).toContain('Creates');
    expect(markup).toContain('Updates');
    expect(markup).toContain('Duplicates');
    expect(markup).toContain('Conflicts');
    expect(markup).toContain('<th scope="col">Duplicate</th>');
    expect(markup).toContain('<th scope="col">Conflict</th>');
    expect(markup).not.toContain('Exact matches');
  });

  it('renders structured import preview warnings separately from validation errors', () => {
    const plan: ImportPlan = {
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
        categories: emptyCategories,
        editHistorySummary: emptyEditHistorySummary,
        reject: 0
      },
      decisions: [],
      errors: [],
      warnings: [
        {
          code: 'non_blocking_dependency',
          path: '$.issues[0].dependsOnIssueIds[0]',
          message: 'Dependency target is done or archived and will be imported without blocking this issue.',
          value: 'done-blocker'
        }
      ]
    };

    const markup = renderToStaticMarkup(
      createElement(ImportPanel, {
        fileName: 'tracker.json',
        importPlan: plan,
        importPolicy: 'skip-conflicts',
        importError: null,
        importMessage: 'Ready.',
        isPreviewing: false,
        isApplying: false,
        canApply: true,
        onPolicyChange: () => {},
        onDownloadReport: () => {},
        onApply: () => {},
        onCancel: () => {}
      })
    );

    expect(markup).toContain('Warnings');
    expect(markup).toContain('$.issues[0].dependsOnIssueIds[0]');
    expect(markup).toContain('Dependency target is done or archived and will be imported without blocking this issue.');
    expect(markup).toContain('Received');
    expect(markup).toContain('done-blocker');
    expect(markup).not.toContain('Validation errors');
  });

  it('renders a dedicated comment edit history summary instead of burying it in generic validation output', () => {
    const plan: ImportPlan = {
      valid: false,
      exportVersion: 1,
      policy: 'skip-conflicts',
      summary: {
        input: {
          ...emptyCounts,
          editHistory: 4
        },
        toCreate: {
          ...emptyCounts,
          editHistory: 1
        },
        toReplace: emptyCounts,
        skip: {
          ...emptyCounts,
          editHistory: 2
        },
        exactMatches: {
          ...emptyCounts,
          editHistory: 1
        },
        changed: {
          ...emptyCounts,
          editHistory: 1
        },
        categories: {
          creates: {
            ...emptyCounts,
            editHistory: 1
          },
          updates: emptyCounts,
          duplicates: {
            ...emptyCounts,
            editHistory: 1
          },
          conflicts: {
            ...emptyCounts,
            editHistory: 1
          }
        },
        editHistorySummary: {
          create: 1,
          replace: 0,
          skipDuplicate: 1,
          skipConflict: 1,
          reject: 1
        },
        reject: 1
      },
      decisions: [],
      errors: [
        {
          code: 'invalid_timestamp',
          path: '$.issues[0].comments[0].editHistory[0].editedAt',
          message: 'Invalid editedAt timestamp.',
          value: 'bad-date'
        }
      ],
      warnings: []
    };

    const markup = renderToStaticMarkup(
      createElement(ImportPanel, {
        fileName: 'tracker.json',
        importPlan: plan,
        importPolicy: 'skip-conflicts',
        importError: 'Import preview found validation errors.',
        importMessage: null,
        isPreviewing: false,
        isApplying: false,
        canApply: false,
        onPolicyChange: () => {},
        onDownloadReport: () => {},
        onApply: () => {},
        onCancel: () => {}
      })
    );

    expect(markup).toContain('Comment edit history');
    expect(markup).toContain('Create 1 edit history entry.');
    expect(markup).toContain('Skip 1 duplicate edit history entry that already exists unchanged.');
    expect(markup).toContain('Skip 1 conflicting edit history entry; existing edit history ids are immutable');
    expect(markup).toContain('Reject 1 invalid edit history entry before import writes.');
    expect(markup).toContain('$.issues[0].comments[0].editHistory[0].editedAt');
    expect(markup).toContain('Edit history validation');
    expect(markup).not.toContain('<h3>Validation errors</h3>');
  });
});
