import type { DashboardDensity } from '../types';

export const dashboardDensityStorageKey = 'tinytracker.dashboardDensity';
export const clientStorageVersionStorageKey = 'tinytracker.clientStorageVersion';
export const currentClientStorageVersion = 2;

export type ClientStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type ClientStorageMigrationStep = {
  version: number;
  name: string;
  migrate: (storage: ClientStorage) => void;
};

export function isDashboardDensity(value: string | null): value is DashboardDensity {
  return value === 'comfortable' || value === 'compact';
}

function parseStoredClientStorageVersion(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function removeUnsupportedDashboardDensity(storage: ClientStorage): void {
  const storedDensity = storage.getItem(dashboardDensityStorageKey);

  if (storedDensity !== null && !isDashboardDensity(storedDensity)) {
    storage.removeItem(dashboardDensityStorageKey);
  }
}

export const clientStorageMigrationSteps = [
  {
    version: 1,
    name: 'remove unsupported dashboard density preference',
    migrate: removeUnsupportedDashboardDensity
  },
  {
    version: 2,
    name: 'establish client storage version marker',
    migrate: () => undefined
  }
] as const satisfies readonly ClientStorageMigrationStep[];

function getBrowserStorage(): ClientStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function runClientStorageMigrations(
  storage: ClientStorage,
  steps: readonly ClientStorageMigrationStep[] = clientStorageMigrationSteps
): void {
  const storedVersion = parseStoredClientStorageVersion(storage.getItem(clientStorageVersionStorageKey));

  for (const step of steps) {
    if (step.version <= storedVersion) {
      continue;
    }

    step.migrate(storage);
    storage.setItem(clientStorageVersionStorageKey, String(step.version));
  }
}

export function migrateClientStorage(storage: ClientStorage | null = getBrowserStorage()): void {
  if (!storage) {
    return;
  }

  try {
    runClientStorageMigrations(storage);
  } catch {
    // Client preferences must not block rendering when browser storage fails.
  }
}

export function readStoredDashboardDensity(storage: ClientStorage | null = getBrowserStorage()): DashboardDensity {
  if (!storage) {
    return 'comfortable';
  }

  try {
    migrateClientStorage(storage);

    const storedDensity = storage.getItem(dashboardDensityStorageKey);

    return isDashboardDensity(storedDensity) ? storedDensity : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function writeStoredDashboardDensity(
  value: DashboardDensity,
  storage: ClientStorage | null = getBrowserStorage()
): void {
  if (!storage) {
    return;
  }

  try {
    migrateClientStorage(storage);
    storage.setItem(dashboardDensityStorageKey, value);
  } catch {
    // Density is a local preference; storage failures should not block UI changes.
  }
}
