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

  it('rejects unsafe link protocols and malformed URLs', () => {
    expect(normalizeMarkdownLinkUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeMarkdownLinkUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    expect(normalizeMarkdownLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeMarkdownLinkUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(normalizeMarkdownLinkUrl('vbscript:msgbox(1)')).toBeNull();
    expect(normalizeMarkdownLinkUrl('/relative/path')).toBeNull();
    expect(normalizeMarkdownLinkUrl('https://exa mple.com')).toBeNull();

    const rendered = renderInline('[bad](javascript:alert(1)) [data](data:text/html,alert) [relative](/issues/1)');

    expect(rendered).not.toContain('<a ');
    expect(rendered).toContain('[bad](javascript:alert(1))');
    expect(rendered).toContain('[data](data:text/html,alert)');
    expect(rendered).toContain('[relative](/issues/1)');
  });

  it('keeps raw html as text and emits no executable elements', () => {
    const rendered = renderBlock('<script>alert(1)</script>\n<img src=x onerror=alert(1)>');

    expect(rendered).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(rendered).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(rendered).not.toContain('<script>');
    expect(rendered).not.toContain('<img');
  });
});
