import type { IssueDependencyReference } from '../types';

function isActiveBlockingDependency(dependency: IssueDependencyReference): boolean {
  return dependency.archivedAt === null && dependency.status !== 'done';
}

function summarizeTitles(dependencies: IssueDependencyReference[]): string {
  if (dependencies.length === 1) {
    return dependencies[0].title;
  }

  if (dependencies.length === 2) {
    return `${dependencies[0].title} and ${dependencies[1].title}`;
  }

  return `${dependencies[0].title}, ${dependencies[1].title}, and ${dependencies.length - 2} more`;
}

export function blockedDependencySummary(dependencies: IssueDependencyReference[]): string {
  const activeDependencies = dependencies.filter(isActiveBlockingDependency);
  const resolvedDependencies = dependencies.length - activeDependencies.length;

  if (activeDependencies.length === 0) {
    return 'Waiting on at least one active dependency.';
  }

  const dependencyLabel = activeDependencies.length === 1 ? 'dependency remains' : 'dependencies remain';
  const summary = `${activeDependencies.length} unresolved ${dependencyLabel}: ${summarizeTitles(activeDependencies)}.`;

  if (resolvedDependencies === 0) {
    return summary;
  }

  const resolvedLabel = resolvedDependencies === 1 ? 'dependency is' : 'dependencies are';
  return `${summary} ${resolvedDependencies} other ${resolvedLabel} already resolved.`;
}
