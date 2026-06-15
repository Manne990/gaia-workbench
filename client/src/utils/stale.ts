export const staleIssueThresholdDays = 30;

const staleIssueThresholdMs = staleIssueThresholdDays * 24 * 60 * 60 * 1000;

export function isIssueStale(updatedAt: string, now = new Date()): boolean {
  const updatedAtMs = Date.parse(updatedAt);

  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return now.getTime() - updatedAtMs >= staleIssueThresholdMs;
}

export function staleIssueDescription(): string {
  return `No updates in ${staleIssueThresholdDays}+ days`;
}
