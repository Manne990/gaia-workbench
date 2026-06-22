import type { CommandSearchCommand } from './commandSearch';

export function resolveActiveCommandId(
  commands: CommandSearchCommand[],
  previousCommandId: string | null
): string | null {
  if (previousCommandId) {
    const previousCommand = commands.find((command) => command.id === previousCommandId);

    if (previousCommand && !previousCommand.disabled) {
      return previousCommand.id;
    }
  }

  return commands.find((command) => !command.disabled)?.id ?? null;
}

export function getAdjacentEnabledCommandId(
  commands: CommandSearchCommand[],
  activeCommandId: string | null,
  direction: 'next' | 'previous'
): string | null {
  const step = direction === 'next' ? 1 : -1;
  const enabledIndexes = commands
    .map((command, index) => (!command.disabled ? index : -1))
    .filter((index) => index !== -1);

  if (enabledIndexes.length === 0) {
    return null;
  }

  const activeIndex = activeCommandId
    ? commands.findIndex((command) => command.id === activeCommandId && !command.disabled)
    : -1;

  if (activeIndex === -1) {
    const fallbackIndex = direction === 'next' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1];

    return commands[fallbackIndex]?.id ?? null;
  }

  for (let index = activeIndex + step; index >= 0 && index < commands.length; index += step) {
    if (!commands[index]?.disabled) {
      return commands[index]?.id ?? null;
    }
  }

  return commands[activeIndex]?.id ?? null;
}
