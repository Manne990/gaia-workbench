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
});
