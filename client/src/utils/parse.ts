export function parseLabelsInput(value: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const rawLabel of value.split(',')) {
    const label = rawLabel.trim();

    if (!label) {
      continue;
    }

    if (label.length > 32) {
      throw new Error('Labels must be 32 characters or fewer.');
    }

    const key = label.toLowerCase();

    if (!seen.has(key)) {
      labels.push(label);
      seen.add(key);
    }
  }

  return labels;
}

export function parseDueDateInput(value: string): string | null {
  const dueDate = value.trim();

  if (!dueDate) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error('Due date must be a valid date.');
  }

  const [year, month, day] = dueDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

  if (!isRealDate) {
    throw new Error('Due date must be a valid date.');
  }

  return dueDate;
}
