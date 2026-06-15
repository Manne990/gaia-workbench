export function getIssueIdFromPath(pathname: string): string | null {
  const match = /^\/issues\/([^/]+)\/?$/.exec(pathname);

  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function getIssueIdFromLocation(): string | null {
  return getIssueIdFromPath(window.location.pathname);
}

export function buildIssuePath(issueId: string): string {
  return `/issues/${encodeURIComponent(issueId)}`;
}

export function pushIssuePath(issueId: string | null): void {
  const nextPath = issueId ? buildIssuePath(issueId) : '/';

  if (window.location.pathname !== nextPath || window.location.search || window.location.hash) {
    window.history.pushState(null, '', nextPath);
  }
}
