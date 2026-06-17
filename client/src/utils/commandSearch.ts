export type CommandSearchCommand = {
  id: string;
  label: string;
  description: string;
  commandHint: string;
  disabled?: boolean;
};

export const COMMAND_PALETTE_RESULT_LIMIT = 24;

type CommandPaletteSearchOptions = {
  limit?: number;
};

type ScoredCommand<TCommand extends CommandSearchCommand> = {
  command: TCommand;
  index: number;
  score: number;
};

type PreparedCommand = {
  label: string;
  description: string;
  hint: string;
  haystack: string;
  labelWords: string[];
  descriptionWords: string[];
};

function normalizeSearchText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function tokenize(value: string): string[] {
  return normalizeSearchText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function prepareCommand(command: CommandSearchCommand): PreparedCommand {
  const label = normalizeSearchText(command.label);
  const description = normalizeSearchText(command.description);
  const hint = normalizeSearchText(command.commandHint);
  const haystack = `${label} ${description} ${hint}`;

  return {
    label,
    description,
    hint,
    haystack,
    labelWords: tokenize(label),
    descriptionWords: tokenize(description)
  };
}

function scoreTerm(term: string, prepared: PreparedCommand): number | null {
  if (prepared.label === term) {
    return 0;
  }

  if (prepared.label.startsWith(term)) {
    return 1;
  }

  if (prepared.labelWords.some((word) => word.startsWith(term))) {
    return 2;
  }

  if (prepared.hint.startsWith(term)) {
    return 3;
  }

  if (prepared.label.includes(term)) {
    return 4;
  }

  if (prepared.descriptionWords.some((word) => word.startsWith(term))) {
    return 5;
  }

  if (prepared.haystack.includes(term)) {
    return 6;
  }

  return null;
}

function scoreCommand(command: CommandSearchCommand, query: string, terms: string[]): number | null {
  const prepared = prepareCommand(command);
  let score = 0;

  for (const term of terms) {
    const termScore = scoreTerm(term, prepared);

    if (termScore === null) {
      return null;
    }

    score += termScore;
  }

  if (prepared.label === query) {
    score -= 6;
  } else if (prepared.label.startsWith(query)) {
    score -= 4;
  } else if (prepared.haystack.includes(query)) {
    score -= 1;
  }

  return command.disabled ? score + 100 : score;
}

export function getCommandPaletteMatches<TCommand extends CommandSearchCommand>(
  commands: TCommand[],
  searchQuery: string,
  options: CommandPaletteSearchOptions = {}
): TCommand[] {
  const limit = Math.max(1, Math.floor(options.limit ?? COMMAND_PALETTE_RESULT_LIMIT));
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (!normalizedQuery) {
    return commands.slice(0, limit);
  }

  const terms = tokenize(normalizedQuery);

  if (terms.length === 0) {
    return commands.slice(0, limit);
  }

  return commands
    .reduce<ScoredCommand<TCommand>[]>((matches, command, index) => {
      const score = scoreCommand(command, normalizedQuery, terms);

      if (score !== null) {
        matches.push({ command, index, score });
      }

      return matches;
    }, [])
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, limit)
    .map((match) => match.command);
}
