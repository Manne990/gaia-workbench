import { type ReactNode } from 'react';

const allowedLinkProtocols = new Set(['http:', 'https:', 'mailto:']);
const maxLinkLength = 2048;
const boundaryPattern = /[\s()[\]{}.,:;!?'"-]/;
const inlineSpecialChars = new Set(['`', '[', '*', '_']);

type RenderOptions = {
  className?: string;
};

function combineClassName(className: string | undefined, extraClassName: string): string {
  return className ? `${className} ${extraClassName}` : extraClassName;
}

function hasInlineMarkupCharacters(value: string): boolean {
  return /[`*_[\]]/.test(value);
}

function hasControlOrWhitespace(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);

    if (code <= 31 || code === 127 || /\s/.test(char)) {
      return true;
    }
  }

  return false;
}

function isBoundary(value: string | undefined): boolean {
  return value === undefined || boundaryPattern.test(value);
}

export function normalizeMarkdownLinkUrl(rawUrl: string): string | null {
  const url = rawUrl.trim();

  if (!url || url.length > maxLinkLength || hasControlOrWhitespace(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (!allowedLinkProtocols.has(parsed.protocol)) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
}

function findNextSpecialCharacter(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (inlineSpecialChars.has(source[index])) {
      return index;
    }
  }

  return source.length;
}

function renderTextSegment(source: string, start: number, end: number, nodes: ReactNode[]): number {
  if (end > start) {
    nodes.push(source.slice(start, end));
  }

  return end;
}

function renderInline(source: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;

  while (index < source.length) {
    if (source[index] === '`') {
      const end = source.indexOf('`', index + 1);

      if (end > index + 1) {
        nodes.push(<code key={`${keyPrefix}-code-${index}`}>{source.slice(index + 1, end)}</code>);
        index = end + 1;
        continue;
      }
    }

    if (source[index] === '[') {
      const labelEnd = source.indexOf(']', index + 1);
      const urlStart = labelEnd + 1;

      if (labelEnd > index + 1 && source[urlStart] === '(') {
        const urlEnd = source.indexOf(')', urlStart + 1);

        if (urlEnd > urlStart + 1) {
          const label = source.slice(index + 1, labelEnd);
          const rawUrl = source.slice(urlStart + 1, urlEnd);
          const href = hasInlineMarkupCharacters(label) ? null : normalizeMarkdownLinkUrl(rawUrl);

          if (href) {
            nodes.push(
              <a key={`${keyPrefix}-link-${index}`} href={href} target="_blank" rel="noopener noreferrer">
                {label}
              </a>
            );
            index = urlEnd + 1;
            continue;
          }
        }
      }
    }

    const doubleMarker = source.slice(index, index + 2);

    if (doubleMarker === '**' || doubleMarker === '__') {
      const end = source.indexOf(doubleMarker, index + 2);

      if (end > index + 2 && isBoundary(source[index - 1]) && isBoundary(source[end + 2])) {
        const value = source.slice(index + 2, end);

        if (value.trim() === value && !hasInlineMarkupCharacters(value)) {
          nodes.push(<strong key={`${keyPrefix}-strong-${index}`}>{value}</strong>);
          index = end + 2;
          continue;
        }
      }
    }

    const marker = source[index];

    if (marker === '*' || marker === '_') {
      const end = source.indexOf(marker, index + 1);

      if (end > index + 1 && isBoundary(source[index - 1]) && isBoundary(source[end + 1])) {
        const value = source.slice(index + 1, end);

        if (value.trim() === value && !hasInlineMarkupCharacters(value)) {
          nodes.push(<em key={`${keyPrefix}-em-${index}`}>{value}</em>);
          index = end + 1;
          continue;
        }
      }
    }

    index = renderTextSegment(source, index, findNextSpecialCharacter(source, index + 1), nodes);
  }

  return nodes;
}

function renderInlineWithBreaks(lines: string[], keyPrefix: string): ReactNode[] {
  return lines.flatMap((line, lineIndex) => {
    const renderedLine = renderInline(line, `${keyPrefix}-line-${lineIndex}`);

    return lineIndex === 0 ? renderedLine : [<br key={`${keyPrefix}-br-${lineIndex}`} />, ...renderedLine];
  });
}

export function renderMarkdownLite(source: string, options: RenderOptions = {}): ReactNode {
  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const blocks: ReactNode[] = [];
  let paragraphLines: string[] = [];
  let index = 0;

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return;
    }

    const blockIndex = blocks.length;
    blocks.push(
      <p key={`paragraph-${blockIndex}`}>{renderInlineWithBreaks(paragraphLines, `paragraph-${blockIndex}`)}</p>
    );
    paragraphLines = [];
  }

  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith('```')) {
      flushParagraph();

      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push(
        <pre key={`code-block-${blocks.length}`}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }

    paragraphLines.push(line);
    index += 1;
  }

  flushParagraph();

  return <div className={combineClassName(options.className, 'markdown-lite')}>{blocks}</div>;
}

export function renderMarkdownLiteInline(source: string, options: RenderOptions = {}): ReactNode {
  const normalized = source.replace(/\r\n?/g, '\n').split('\n').join(' ');

  return (
    <span className={combineClassName(options.className, 'markdown-lite-inline')}>
      {renderInline(normalized, 'inline')}
    </span>
  );
}
