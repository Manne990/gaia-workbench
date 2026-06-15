import { describe, expect, it } from 'vitest';
import { parseDueDateInput, parseLabelsInput } from './parse';

describe('client parse helpers', () => {
  it('deduplicates labels case-insensitively while preserving first spelling', () => {
    expect(parseLabelsInput('ui, Bug, ui, bug, docs')).toEqual(['ui', 'Bug', 'docs']);
  });

  it('rejects labels longer than 32 characters', () => {
    expect(() => parseLabelsInput('this-label-is-far-too-long-for-v1-ui')).toThrow(
      'Labels must be 32 characters or fewer.'
    );
  });

  it('parses blank and valid due dates', () => {
    expect(parseDueDateInput('')).toBeNull();
    expect(parseDueDateInput('  ')).toBeNull();
    expect(parseDueDateInput('2026-06-15')).toBe('2026-06-15');
  });

  it('rejects impossible or malformed due dates', () => {
    expect(() => parseDueDateInput('2026-02-30')).toThrow('Due date must be a valid date.');
    expect(() => parseDueDateInput('tomorrow')).toThrow('Due date must be a valid date.');
  });
});
