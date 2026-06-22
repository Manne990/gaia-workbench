import { describe, expect, it } from 'vitest';
import { getAdjacentEnabledCommandId, resolveActiveCommandId } from './commandPaletteNavigation';
import type { CommandSearchCommand } from './commandSearch';

function command(overrides: Partial<CommandSearchCommand> & Pick<CommandSearchCommand, 'id'>): CommandSearchCommand {
  return {
    label: `Command ${overrides.id}`,
    description: 'General command description',
    commandHint: 'Run',
    disabled: false,
    ...overrides
  };
}

describe('resolveActiveCommandId', () => {
  it('keeps the current active command when it is still enabled after filtering', () => {
    const commands = [command({ id: 'alpha' }), command({ id: 'beta' }), command({ id: 'gamma' })];

    expect(resolveActiveCommandId(commands, 'beta')).toBe('beta');
  });

  it('falls back to the first enabled command when the previous active command disappears or becomes disabled', () => {
    const commands = [command({ id: 'alpha', disabled: true }), command({ id: 'beta' }), command({ id: 'gamma' })];

    expect(resolveActiveCommandId(commands, 'missing')).toBe('beta');
    expect(resolveActiveCommandId(commands, 'alpha')).toBe('beta');
  });

  it('returns null when every visible command is disabled', () => {
    const commands = [command({ id: 'alpha', disabled: true }), command({ id: 'beta', disabled: true })];

    expect(resolveActiveCommandId(commands, 'alpha')).toBeNull();
  });
});

describe('getAdjacentEnabledCommandId', () => {
  const commands = [
    command({ id: 'alpha' }),
    command({ id: 'beta', disabled: true }),
    command({ id: 'gamma' }),
    command({ id: 'delta', disabled: true }),
    command({ id: 'epsilon' })
  ];

  it('skips disabled commands when moving forward and backward', () => {
    expect(getAdjacentEnabledCommandId(commands, 'alpha', 'next')).toBe('gamma');
    expect(getAdjacentEnabledCommandId(commands, 'epsilon', 'previous')).toBe('gamma');
  });

  it('keeps the current command when movement would run past the available enabled results', () => {
    expect(getAdjacentEnabledCommandId(commands, 'alpha', 'previous')).toBe('alpha');
    expect(getAdjacentEnabledCommandId(commands, 'epsilon', 'next')).toBe('epsilon');
  });

  it('chooses the first or last enabled command when there is no valid active selection', () => {
    expect(getAdjacentEnabledCommandId(commands, null, 'next')).toBe('alpha');
    expect(getAdjacentEnabledCommandId(commands, 'missing', 'previous')).toBe('epsilon');
    expect(getAdjacentEnabledCommandId(commands, 'beta', 'next')).toBe('alpha');
  });
});
