import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dom: JSDOM;
let renderedMessage: (html: string, fallback: string) => HTMLElement;
let applyStaticTranslations: (root: ParentNode, locale: 'en' | 'th') => void;

beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/' });
  Object.defineProperty(dom.window, 'api', { value: {}, configurable: true });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node
  });
  ({ renderedMessage } = await import('../src/renderer/chat.js'));
  ({ applyStaticTranslations } = await import('../src/renderer/i18n.js'));
});

afterAll(() => {
  dom.window.close();
});

describe('captured ChatGPT rendered HTML', () => {
  it('localizes only explicitly keyed app UI and never arbitrary captured text', () => {
    const host = dom.window.document.createElement('div');
    host.innerHTML = '<p id="raw">Connect</p><span id="owned" data-i18n="common.connect">Connect</span>';
    dom.window.document.body.append(host);

    applyStaticTranslations(host, 'th');

    expect(host.querySelector('#raw')?.textContent).toBe('Connect');
    expect(host.querySelector('#owned')?.textContent).toBe('เชื่อมต่อ');
  });

  it('keeps semantic Markdown structure while stripping executable attributes and unsafe links', () => {
    const rendered = renderedMessage(
      '<h2 onclick="alert(1)">Heading</h2><p><strong>bold</strong> and <em>italic</em></p>' +
        '<pre><code class="language-ts">const x = 1;</code></pre>' +
        '<a href="javascript:alert(1)" title="unsafe">bad link</a>' +
        '<a href="https://example.com/path" onclick="alert(2)">good link</a>',
      'fallback'
    );

    expect(rendered.querySelector('h2')?.textContent).toBe('Heading');
    expect(rendered.querySelector('strong')?.textContent).toBe('bold');
    expect(rendered.querySelector('pre code')?.textContent).toBe('const x = 1;');
    expect(rendered.querySelector('code')?.getAttribute('class')).toBeNull();
    const links = rendered.querySelectorAll('a');
    expect(links[0]?.getAttribute('href')).toBeNull();
    expect(links[1]?.getAttribute('href')).toBe('https://example.com/path');
    expect(links[1]?.getAttribute('onclick')).toBeNull();
    expect(links[1]?.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('drops SVG and MathML namespace content instead of letting it bypass the sanitizer', () => {
    const rendered = renderedMessage(
      '<p>before</p>' +
        '<svg onload="alert(1)"><foreignObject><p>svg payload</p></foreignObject></svg>' +
        '<math><mtext>math payload</mtext></math>' +
        '<script>alert(2)</script><p>after</p>',
      'fallback'
    );

    expect(rendered.querySelector('svg')).toBeNull();
    expect(rendered.querySelector('math')).toBeNull();
    expect(rendered.querySelector('script')).toBeNull();
    expect(rendered.textContent).toBe('beforeafter');
  });
});
