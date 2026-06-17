import { type ChangeEvent, type FormEvent, type KeyboardEvent, type RefObject, useMemo } from 'react';
import { getCommandPaletteMatches, type CommandSearchCommand } from '../utils/commandSearch';

type CommandDefinition = CommandSearchCommand;

type CommandPaletteProps = {
  isOpen: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onRunCommand: (commandId: string) => void;
  onClose: () => void;
  commands: CommandDefinition[];
};

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
  );
}

export function CommandPalette({
  isOpen,
  searchQuery,
  onSearchQueryChange,
  searchInputRef,
  onRunCommand,
  onClose,
  commands
}: CommandPaletteProps) {
  const filteredCommands = useMemo(() => getCommandPaletteMatches(commands, searchQuery), [commands, searchQuery]);

  if (!isOpen) {
    return null;
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = getFocusableElements(event.currentTarget);

    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextCommand = filteredCommands.find((command) => !command.disabled);

    if (nextCommand) {
      onRunCommand(nextCommand.id);
    }
  }

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleDialogKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <form className="command-search-form" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="command-palette-search">
            Search commands
          </label>
          <input
            id="command-palette-search"
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchQueryChange(event.target.value)}
            className="command-search-input"
            placeholder="Search commands"
            aria-label="Search commands"
          />
          <button type="submit" className="sr-only" aria-label="Run first matching command" tabIndex={-1}>
            Run command
          </button>
        </form>

        <ul className="command-list" aria-label="Available commands">
          {filteredCommands.length === 0 ? (
            <li className="command-empty" role="status">
              No matching commands.
            </li>
          ) : (
            filteredCommands.map((command) => (
              <li key={command.id}>
                <button
                  type="button"
                  className="command-item"
                  disabled={command.disabled}
                  onClick={() => onRunCommand(command.id)}
                  aria-label={`${command.label}. ${command.description}`}
                >
                  <span className="command-item-label">{command.label}</span>
                  <span className="command-item-hint" aria-hidden="true">
                    {command.commandHint}
                  </span>
                  <span className="command-item-description">{command.description}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
