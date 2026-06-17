import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_RESULT_LIMIT, getCommandPaletteMatches, type CommandSearchCommand } from './commandSearch';

function command(overrides: Partial<CommandSearchCommand> & Pick<CommandSearchCommand, 'id'>): CommandSearchCommand {
  return {
    label: `Command ${overrides.id}`,
    description: 'General command description',
    commandHint: 'Run',
    ...overrides
  };
}

describe('getCommandPaletteMatches', () => {
  it('caps broad command lists to a bounded result set', () => {
    const commands = Array.from({ length: COMMAND_PALETTE_RESULT_LIMIT + 50 }, (_, index) =>
      command({
        id: `command-${index}`,
        label: `Saved view ${index}`,
        description: `Load saved view ${index}`
      })
    );

    const matches = getCommandPaletteMatches(commands, '');

    expect(matches).toHaveLength(COMMAND_PALETTE_RESULT_LIMIT);
    expect(matches.map((match) => match.id)).toEqual(
      commands.slice(0, COMMAND_PALETTE_RESULT_LIMIT).map((match) => match.id)
    );
  });

  it('ranks label and word-prefix matches ahead of description-only matches', () => {
    const matches = getCommandPaletteMatches(
      [
        command({
          id: 'description-only',
          label: 'Show dashboard',
          description: 'Open issue details from the current list'
        }),
        command({
          id: 'word-prefix',
          label: 'Open first visible issue',
          description: 'Open the first issue in the current list'
        }),
        command({
          id: 'label-prefix',
          label: 'Open issue detail',
          description: 'Open the currently selected issue'
        })
      ],
      'open issue'
    );

    expect(matches.map((match) => match.id)).toEqual(['label-prefix', 'word-prefix', 'description-only']);
  });

  it('finds specific saved-view commands without returning the entire saved-view set', () => {
    const commands = [
      ...Array.from({ length: COMMAND_PALETTE_RESULT_LIMIT + 25 }, (_, index) =>
        command({
          id: `saved-view-${index}`,
          label: `Apply saved view: Queue ${index}`,
          description: `Load filters from Queue ${index}`,
          commandHint: 'View'
        })
      ),
      command({
        id: 'target-saved-view',
        label: 'Apply saved view: Palette Review View',
        description: 'Load filters from Palette Review View',
        commandHint: 'View'
      })
    ];

    const matches = getCommandPaletteMatches(commands, 'palette review view');

    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('target-saved-view');
  });

  it('matches hidden imported issue aliases and drops stale aliases after command refresh', () => {
    const importedIssueCommand = command({
      id: 'open-imported-issue',
      label: 'Open issue: Imported issue from JSON',
      description: 'Open Imported issue from JSON',
      commandHint: 'Issue',
      searchText: ['e2e-import-issue', 'legacy-tracker-42']
    });

    expect(getCommandPaletteMatches([importedIssueCommand], 'legacy-tracker-42').map((match) => match.id)).toEqual([
      'open-imported-issue'
    ]);

    const refreshedIssueCommand = {
      ...importedIssueCommand,
      searchText: ['e2e-import-issue', 'refreshed-tracker-84']
    };

    expect(getCommandPaletteMatches([refreshedIssueCommand], 'legacy-tracker-42')).toEqual([]);
    expect(getCommandPaletteMatches([refreshedIssueCommand], 'refreshed-tracker-84').map((match) => match.id)).toEqual([
      'open-imported-issue'
    ]);
  });
});
