export function formatImportErrorValue(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
