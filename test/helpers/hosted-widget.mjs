import vm from 'node:vm';
import { registerLookUi } from '../../mcp/cloud/hosted-look-ui.mjs';

export function widget(html) {
  if (!html)
    registerLookUi({
      registerResource: (_n, _u, _m, read) => {
        html = read().contents[0].text;
      },
    });
  class El {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.textContent = '';
    }
    append(...items) {
      this.children.push(...items);
    }
    replaceChildren(...items) {
      this.children = items;
    }
    get text() {
      return this.textContent + this.children.map(x => x.text).join(' ');
    }
    get all() {
      return [this, ...this.children.flatMap(x => x.all)];
    }
  }
  const root = new El('main'),
    window = { addEventListener() {} };
  const context = vm.createContext({
    URL,
    window,
    document: { querySelector: () => root, createElement: tag => new El(tag), documentElement: { lang: 'ko' }, body: {} },
    navigator: { language: 'ko' },
    parent: { postMessage() {} },
    ResizeObserver: class {
      observe() {}
    },
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return {
    root,
    window,
    globals: () => vm.runInContext('fromGlobals()', context),
    render: result => {
      context.result = result;
      vm.runInContext('render(result)', context);
    },
  };
}
