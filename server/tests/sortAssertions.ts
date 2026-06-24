import { expect } from 'vitest';

export function expectValuesInAnyOrder<T extends number | string>(actual: Iterable<T>, expected: Iterable<T>) {
  expect([...actual].sort()).toEqual([...expected].sort());
}

export function expectValuesSortedAscending<T>(values: T[], toComparable: (value: T) => number | string = String) {
  const comparableValues = values.map(toComparable);

  expect(comparableValues).toEqual(
    [...comparableValues].sort((left, right) => {
      if (typeof left === 'number' && typeof right === 'number') {
        return left - right;
      }

      return String(left).localeCompare(String(right));
    })
  );
}
