import { describe, expect, it } from 'vitest';
import type { IssueDependencyReference } from '../types';
import { blockedDependencySummary } from './dependencySummary';

function buildDependency(overrides: Partial<IssueDependencyReference> = {}): IssueDependencyReference {
  return {
    id: overrides.id ?? 'issue-1',
    title: overrides.title ?? 'Default dependency',
    status: overrides.status ?? 'todo',
    archivedAt: overrides.archivedAt ?? null
  };
}

describe('blockedDependencySummary', () => {
  it('falls back to the generic copy when no active blockers remain', () => {
    expect(
      blockedDependencySummary([
        buildDependency({ title: 'Done blocker', status: 'done' }),
        buildDependency({ id: 'issue-2', title: 'Archived blocker', archivedAt: '2026-06-01T00:00:00.000Z' })
      ])
    ).toBe('Waiting on at least one active dependency.');
  });

  it('names one active blocker directly', () => {
    expect(blockedDependencySummary([buildDependency({ title: 'API contract' })])).toBe(
      '1 unresolved dependency remains: API contract.'
    );
  });

  it('summarizes multiple active blockers and counts resolved dependencies separately', () => {
    expect(
      blockedDependencySummary([
        buildDependency({ title: 'API contract' }),
        buildDependency({ id: 'issue-2', title: 'Accessibility audit', status: 'in_progress' }),
        buildDependency({ id: 'issue-3', title: 'Done blocker', status: 'done' })
      ])
    ).toBe(
      '2 unresolved dependencies remain: API contract and Accessibility audit. 1 other dependency is already resolved.'
    );
  });
});
