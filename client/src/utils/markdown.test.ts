import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { normalizeMarkdownLinkUrl, renderMarkdownLite, renderMarkdownLiteInline } from './markdown';

function renderBlock(source: string): string {
  return renderToStaticMarkup(createElement(Fragment, null, renderMarkdownLite(source)));
}

function renderInline(source: string): string {
  return renderToStaticMarkup(createElement(Fragment, null, renderMarkdownLiteInline(source)));
}

describe('markdown-lite renderer', () => {
  it('renders inline emphasis code links and line breaks', () => {
    const rendered = renderBlock(
      'Use **bold**, _italic_, `code`, and [docs](https://example.com/path?q=1#top).\nNext line.'
    );

    expect(rendered).toContain('<strong>bold</strong>');
    expect(rendered).toContain('<em>italic</em>');
    expect(rendered).toContain('<code>code</code>');
    expect(rendered).toContain(
      '<a href="https://example.com/path?q=1#top" target="_blank" rel="noopener noreferrer">docs</a>'
    );
    expect(rendered).toContain('<br/>Next line.');
  });

  it('renders fenced code blocks with preserved text', () => {
    const rendered = renderBlock('Before\n\n```\nconst x = 1;\n<tag>\n```\n\nAfter');

    expect(rendered).toContain('<p>Before</p>');
    expect(rendered).toContain('<pre><code>const x = 1;\n&lt;tag&gt;</code></pre>');
    expect(rendered).toContain('<p>After</p>');
  });

  it('renders unsupported and ambiguous syntax as plain text', () => {
    const rendered = renderBlock('# Heading\n- item\n**bold _nested_**');

    expect(rendered).toContain('# Heading');
    expect(rendered).toContain('- item');
    expect(rendered).toContain('**bold _nested_**');
    expect(rendered).not.toContain('<h1');
    expect(rendered).not.toContain('<li');
    expect(rendered).not.toContain('<strong>bold');
  });

  it('keeps malformed overlapping and in-word inline markers as plain text', () => {
    const rendered = renderInline(
      [
        '`unterminated code',
        '**unterminated strong',
        '*unterminated emphasis',
        '[missing url](',
        '****',
        '[](https://example.com)',
        'foo_bar_baz',
        'foo**bar**baz',
        '**bold *x** y*',
        '*a **b* c**'
      ].join(' ')
    );

    expect(rendered).toContain('`unterminated code');
    expect(rendered).toContain('**unterminated strong');
    expect(rendered).toContain('*unterminated emphasis');
    expect(rendered).toContain('[missing url](');
    expect(rendered).toContain('****');
    expect(rendered).toContain('[](https://example.com)');
    expect(rendered).toContain('foo_bar_baz');
    expect(rendered).toContain('foo**bar**baz');
    expect(rendered).toContain('**bold *x** y*');
    expect(rendered).toContain('*a **b* c**');
    expect(rendered).not.toContain('<code>');
    expect(rendered).not.toContain('<strong>');
    expect(rendered).not.toContain('<em>');
    expect(rendered).not.toContain('<a ');
  });

  it('documents literal backslashes without adding escape syntax', () => {
    const rendered = renderInline(
      String.raw`Backslash is literal before text: \*not emphasis* and \[docs](https://example.com).`
    );

    expect(rendered).toContain(String.raw`\*not emphasis*`);
    expect(rendered).toContain('\\');
    expect(rendered).toContain('<a href="https://example.com/" target="_blank" rel="noopener noreferrer">docs</a>');
  });

  it('rejects unsafe link protocols and malformed URLs', () => {
    expect(normalizeMarkdownLinkUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeMarkdownLinkUrl('HTTPS://Example.com/Path')).toBe('https://example.com/Path');
    expect(normalizeMarkdownLinkUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(normalizeMarkdownLinkUrl('MAILTO:HELLO@example.com')).toBe('mailto:HELLO@example.com');
    expect(normalizeMarkdownLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeMarkdownLinkUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(normalizeMarkdownLinkUrl('vbscript:msgbox(1)')).toBeNull();
    expect(normalizeMarkdownLinkUrl('java%73cript:alert(1)')).toBeNull();
    expect(normalizeMarkdownLinkUrl('/relative/path')).toBeNull();
    expect(normalizeMarkdownLinkUrl('https://exa mple.com')).toBeNull();
    expect(normalizeMarkdownLinkUrl('https://example.com/\npath')).toBeNull();
    expect(normalizeMarkdownLinkUrl('https://example.com/\tpath')).toBeNull();
    expect(normalizeMarkdownLinkUrl(`https://example.com/${'a'.repeat(2049)}`)).toBeNull();
    expect(normalizeMarkdownLinkUrl('https://example.com/%0Apath')).toBe('https://example.com/%0Apath');

    const rendered = renderInline(
      '[bad](javascript:alert(1)) [encoded](java%73cript:alert(1)) [data](data:text/html,alert) [relative](/issues/1)'
    );

    expect(rendered).not.toContain('<a ');
    expect(rendered).toContain('[bad](javascript:alert(1))');
    expect(rendered).toContain('[encoded](java%73cript:alert(1))');
    expect(rendered).toContain('[data](data:text/html,alert)');
    expect(rendered).toContain('[relative](/issues/1)');
  });

  it('escapes raw html in link labels while preserving allowed links', () => {
    const rendered = renderInline('[<img src=x onerror=alert(1)>](https://example.com)');

    expect(rendered).toContain(
      '<a href="https://example.com/" target="_blank" rel="noopener noreferrer">&lt;img src=x onerror=alert(1)&gt;</a>'
    );
    expect(rendered).not.toContain('<img');
  });

  it('keeps raw html as text and emits no executable elements', () => {
    const rendered = renderBlock('<script>alert(1)</script>\n<img src=x onerror=alert(1)>');

    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(rendered).not.toContain('<script>');
    expect(rendered).not.toContain('<img');
  });

  it('documents block and inline rendering boundaries', () => {
    const source = ['First line', 'Second line', '', '```', 'const safe = true;', '```'].join('\n');
    const blockRendered = renderBlock(source);
    const inlineRendered = renderInline(source);
    const unterminatedFence = renderBlock('Before\n\n```\nconst safe = true;');

    expect(blockRendered).toContain('<br/>Second line');
    expect(blockRendered).toContain('<pre><code>const safe = true;</code></pre>');
    expect(inlineRendered).toContain('First line Second line');
    expect(inlineRendered).not.toContain('<pre>');
    expect(unterminatedFence).toContain('<pre><code>const safe = true;</code></pre>');
  });
});
