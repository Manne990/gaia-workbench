import { describe, expect, it } from 'vitest';
import {
  clientStorageVersionStorageKey,
  dashboardDensityStorageKey,
  readStoredDashboardDensity,
  runClientStorageMigrations,
  writeStoredDashboardDensity,
  type ClientStorage,
  type ClientStorageMigrationStep
} from './clientStorage';

class MemoryStorage implements ClientStorage {
  private readonly values = new Map<string, string>();

  constructor(initialValues: Record<string, string> = {}) {
    Object.entries(initialValues).forEach(([key, value]) => this.values.set(key, value));
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('client storage migrations', () => {
  it('runs pending migration steps in version order and records the final version', () => {
    const storage = new MemoryStorage();
    const observed: string[] = [];
    const steps: ClientStorageMigrationStep[] = [
      {
        version: 1,
        name: 'first migration',
        migrate: (targetStorage) => {
          observed.push('first');
          targetStorage.setItem('migration:first', 'done');
        }
      },
      {
        version: 2,
        name: 'second migration',
        migrate: (targetStorage) => {
          observed.push(targetStorage.getItem('migration:first') ?? 'missing-first');
          targetStorage.setItem('migration:second', 'done');
        }
      }
    ];

    runClientStorageMigrations(storage, steps);

    expect(observed).toEqual(['first', 'done']);
    expect(storage.getItem('migration:second')).toBe('done');
    expect(storage.getItem(clientStorageVersionStorageKey)).toBe('2');
  });

  it('skips completed migration steps from the stored version', () => {
    const storage = new MemoryStorage({ [clientStorageVersionStorageKey]: '1' });
    const observed: string[] = [];
    const steps: ClientStorageMigrationStep[] = [
      {
        version: 1,
        name: 'completed migration',
        migrate: () => observed.push('first')
      },
      {
        version: 2,
        name: 'pending migration',
        migrate: () => observed.push('second')
      }
    ];

    runClientStorageMigrations(storage, steps);

    expect(observed).toEqual(['second']);
    expect(storage.getItem(clientStorageVersionStorageKey)).toBe('2');
  });

  it('cleans unsupported dashboard density values during the default migration path', () => {
    const storage = new MemoryStorage({ [dashboardDensityStorageKey]: 'dense' });

    expect(readStoredDashboardDensity(storage)).toBe('comfortable');
    expect(storage.getItem(dashboardDensityStorageKey)).toBeNull();
    expect(storage.getItem(clientStorageVersionStorageKey)).toBe('2');
  });

  it('preserves and writes supported dashboard density values', () => {
    const storage = new MemoryStorage({ [dashboardDensityStorageKey]: 'compact' });

    expect(readStoredDashboardDensity(storage)).toBe('compact');
    writeStoredDashboardDensity('comfortable', storage);

    expect(storage.getItem(dashboardDensityStorageKey)).toBe('comfortable');
    expect(storage.getItem(clientStorageVersionStorageKey)).toBe('2');
  });

  it('keeps density preferences best-effort when storage operations fail', () => {
    const storage: ClientStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
      removeItem: () => {
        throw new Error('storage unavailable');
      }
    };

    expect(readStoredDashboardDensity(storage)).toBe('comfortable');
    expect(() => writeStoredDashboardDensity('compact', storage)).not.toThrow();
  });
});
