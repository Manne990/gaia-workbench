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
});
