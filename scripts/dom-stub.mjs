/* ==========================================================================
   dom-stub.mjs · 极简 DOM 替身（只给 npm test 用）
   --------------------------------------------------------------------------
   目的：在没有浏览器的环境下，把打包出来的 js/home.js / js/app.js 真正跑一遍，
   验证「数据 → 筛选 → 排序 → 生成卡片 → 写进页面」这条链路没有报错。
   它只实现页面脚本真正用到的那几个 API，不是一个完整的 DOM。
   ========================================================================== */

function makeClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    contains: (name) => set.has(name),
    toggle: (name) => (set.has(name) ? set.delete(name) : set.add(name)),
    _values: () => [...set],
  };
}

export function makeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: makeClassList(),
    _attrs: {},
    innerHTML: '',
    textContent: '',
    hidden: false,
    value: '',
    content: undefined,
    children: [],
    _listeners: {},
    setAttribute(name, value) {
      this._attrs[name] = String(value);
    },
    getAttribute(name) {
      return name in this._attrs ? this._attrs[name] : null;
    },
    removeAttribute(name) {
      delete this._attrs[name];
    },
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    removeEventListener(type, handler) {
      const list = this._listeners[type];
      if (!list) return;
      this._listeners[type] = list.filter((item) => item !== handler);
    },
    /** 触发事件：接受 'input' 或 { type: 'input' } 两种写法 */
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event && event.type;
      const list = this._listeners[type] || [];
      list.forEach((handler) => handler.call(this, typeof event === 'string' ? { type } : event));
      return true;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(child) {
      this.children.unshift(child);
      return child;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    remove() {},
    replaceWith() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    matches() {
      return false;
    },
    focus() {},
    blur() {},
    select() {},
    scrollIntoView() {},
  };
  return el;
}

/**
 * 创建一个「够用」的 document / window 替身。
 * @param {object} options
 * @param {string} options.pathname 当前页面路径（用于测试 siteRoot 推导）
 * @param {string} options.search   query string
 * @param {string} options.protocol 'file:' 或 'https:'
 * @param {Record<string, object>} options.elements 选择器 → 元素，供 querySelector 返回
 */
export function createDom({ pathname = '/index.html', search = '', protocol = 'https:', elements = {} } = {}) {
  const documentElement = makeElement('html');
  const body = makeElement('body');
  const head = makeElement('head');

  const document = {
    documentElement,
    body,
    head,
    activeElement: null,
    title: '',
    querySelector(selector) {
      if (selector in elements) return elements[selector];
      if (selector === 'html') return documentElement;
      if (selector === 'body') return body;
      return null;
    },
    querySelectorAll(selector) {
      const value = elements[selector];
      if (Array.isArray(value)) return value;
      return [];
    },
    createElement: (tag) => makeElement(tag),
    addEventListener() {},
    removeEventListener() {},
    getElementById(id) {
      return elements[`#${id}`] || null;
    },
  };

  const storage = new Map();
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };

  const location = {
    protocol,
    pathname,
    search,
    href: `${protocol === 'file:' ? 'file://' : 'https://example.com'}${pathname}${search}`,
    replace() {},
    assign() {},
  };

  const window = {
    SITE_DATA: undefined,
    document,
    localStorage,
    // 浏览器里 window.btoa / window.atob 是全局的，替身也得有，
    // 否则 js/admin-github.js 这类脚本拿不到（Node 自己的 btoa 不在 window 上）
    btoa: (text) => Buffer.from(String(text), 'binary').toString('base64'),
    atob: (text) => Buffer.from(String(text), 'base64').toString('binary'),
    location,
    history: { replaceState() {}, pushState() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
    innerWidth: 1280,
    scrollY: 0,
    isSecureContext: false,
    navigator: undefined,
  };

  const navigator = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    clipboard: { writeText: async () => {} },
    share: undefined,
  };
  window.navigator = navigator;

  class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  const fetch = async () => {
    throw new Error('测试环境不支持 fetch（本站应优先使用 data/apps.generated.js）');
  };

  return {
    document,
    window,
    localStorage,
    navigator,
    location,
    IntersectionObserver,
    fetch,
    // 需要时由测试塞一个假的进来（js/admin.js 上传安装包要用）
    XMLHttpRequest: undefined,
    documentElement,
  };
}

/** 在替身环境里执行一段浏览器脚本（打包后的 js/*.js） */
export async function runScript(code, dom) {
  // fetch / XMLHttpRequest 在浏览器里是「用时才查全局」，所以这里也不能提前快照，
  // 否则测试中途换掉 dom.fetch 就不生效了。
  const fetchProxy = (...args) =>
    dom.fetch ? dom.fetch(...args) : Promise.reject(new Error('测试环境没有提供 fetch'));
  class XMLHttpRequestProxy {
    constructor() {
      const Impl = dom.XMLHttpRequest;
      if (!Impl) throw new Error('测试环境没有提供 XMLHttpRequest：请在测试里给 dom.XMLHttpRequest 赋值');
      return new Impl();
    }
  }
  const factory = new Function(
    'window',
    'document',
    'localStorage',
    'navigator',
    'location',
    'history',
    'IntersectionObserver',
    'fetch',
    'XMLHttpRequest',
    code
  );
  factory(
    dom.window,
    dom.document,
    dom.localStorage,
    dom.navigator,
    dom.location,
    dom.window.history,
    dom.IntersectionObserver,
    fetchProxy,
    XMLHttpRequestProxy
  );
  // 让脚本内部的异步初始化（await main()）跑完
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
