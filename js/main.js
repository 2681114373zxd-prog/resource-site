/* ==========================================================================
   main.js · 首页逻辑
   --------------------------------------------------------------------------
   流程：加载数据 → 填充站点信息 → 渲染分类 → 渲染软件卡片
         （搜索 / 分类 / 排序 / 视图切换 都在本地完成，无后端请求）
   ========================================================================== */

import {
  ROOT,
  loadData,
  initThemeToggle,
  applySiteTheme,
  initSiteChrome,
  detectPlatform,
  initReveal,
  initToTop,
  initMenu,
  initKeyboardShortcuts,
  readUrlState,
  writeUrlState,
  store,
  toast,
} from './core.js';
import { cardHtml, hydrateIcons, icon } from './render.js';
import {
  matchQuery,
  matchCategory,
  sortApps,
  countPackages,
  latestUpdate,
  formatDate,
  relativeDate,
  debounce,
  escapeHtml,
} from './shared.js';

const VIEW_KEY = 'resource-site-view';

// 标记「JS 可用」：CSS 里靠 html.js 来显示/隐藏需要 JS 的交互组件。
// 如果浏览器禁用了 JavaScript，脚本不会执行，页面会保持「无 JS 模式」：
// 构建时预渲染好的列表照常显示，也不会出现点了没反应的按钮。
document.documentElement.classList.add('js');

const el = {
  grid: document.querySelector('[data-app-grid]'),
  chips: document.querySelector('[data-category-chips]'),
  search: document.querySelector('[data-search-input]'),
  searchBox: document.querySelector('.search-box'),
  searchClear: document.querySelector('[data-search-clear]'),
  sort: document.querySelector('[data-sort]'),
  resultBar: document.querySelector('[data-result-bar]'),
  empty: document.querySelector('[data-empty-state]'),
  viewBtns: document.querySelectorAll('[data-view-btn]'),
};

const state = {
  data: null,
  query: '',
  category: 'all',
  sort: 'default',
  view: store.get(VIEW_KEY, 'grid'),
  platform: detectPlatform(),
};

/* --------------------------------------------------------------------------
   启动
   -------------------------------------------------------------------------- */
async function main() {
  initThemeToggle();
  initMenu();
  initToTop();

  // 先放骨架屏，避免白屏
  if (el.grid) {
    el.grid.innerHTML = Array.from({ length: 6 })
      .map(() => '<div class="skeleton"></div>')
      .join('');
  }

  try {
    state.data = await loadData();
  } catch (error) {
    renderError(error);
    return;
  }

  const { site, categories, apps } = state.data;
  applySiteTheme(site);
  initSiteChrome(site);
  apps.forEach((app) => {
    app.__platform = state.platform;
  });

  // 从 URL 恢复筛选状态（支持 ?q=&c=&sort=&view=）
  const urlState = readUrlState({ q: '', c: 'all', sort: 'default' });
  state.query = urlState.q;
  state.category = urlState.c;
  state.sort = urlState.sort;

  renderStats(apps);
  renderCategoryChips();
  if (el.search) {
    el.search.value = state.query;
    updateSearchBox();
    el.search.addEventListener('input', debounce(() => {
      state.query = el.search.value.trim();
      updateSearchBox();
      render();
    }, 140));
  }
  if (el.searchClear) {
    el.searchClear.addEventListener('click', () => {
      el.search.value = '';
      state.query = '';
      updateSearchBox();
      render();
      el.search.focus();
    });
  }
  if (el.sort) {
    el.sort.value = state.sort;
    el.sort.addEventListener('change', () => {
      state.sort = el.sort.value;
      render();
    });
  }
  el.viewBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.viewBtn;
      store.set(VIEW_KEY, state.view);
      applyView();
    });
  });
  const resetBtn = document.querySelector('[data-reset-filters]');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.query = '';
      state.category = 'all';
      if (el.search) el.search.value = '';
      updateSearchBox();
      renderCategoryChips();
      render();
    });
  }
  initKeyboardShortcuts(el.search);
  applyView();
  render();
}

/* --------------------------------------------------------------------------
   Hero 统计
   -------------------------------------------------------------------------- */
function renderStats(apps) {
  const set = (key, value) => {
    document.querySelectorAll(`[data-stat="${key}"]`).forEach((node) => {
      node.textContent = value;
    });
  };
  set('apps', String(apps.length));
  set('packages', String(countPackages(apps)));
  const latest = latestUpdate(apps);
  set('updated', latest ? relativeDate(latest) : '—');
  const latestNode = document.querySelector('[data-stat-updated-date]');
  if (latestNode) latestNode.setAttribute('title', latest ? `最近更新：${formatDate(latest, 'iso')}` : '');
}

/* --------------------------------------------------------------------------
   分类筛选条（带每个分类的数量）
   -------------------------------------------------------------------------- */
function renderCategoryChips() {
  if (!el.chips) return;
  const { categories, apps } = state.data;
  const list = [{ ...categories.all }, ...(categories.items || [])];
  // 搜索时统计「命中搜索词」的数量，让用户知道每个分类下有多少结果
  const searched = apps.filter((app) => matchQuery(app, state.query));
  el.chips.innerHTML = list
    .map((category) => {
      const count = searched.filter((app) => matchCategory(app, category, categories.all.slug)).length;
      return `<button class="chip" type="button" data-category="${escapeAttr(category.slug)}" aria-pressed="${
        state.category === category.slug ? 'true' : 'false'
      }">${escapeHtml(category.name)}<span class="chip-count">${count}</span></button>`;
    })
    .join('');
  el.chips.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.category = chip.dataset.category;
      el.chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      render();
    });
  });
}

const escapeAttr = escapeHtml;

/* --------------------------------------------------------------------------
   渲染列表
   -------------------------------------------------------------------------- */
function render() {
  if (!el.grid || !state.data) return;
  const { categories, apps } = state.data;
  const category = categories.items.find((c) => c.slug === state.category) || categories.all;

  const filtered = apps
    .filter((app) => matchQuery(app, state.query))
    .filter((app) => matchCategory(app, category, categories.all.slug));
  const sorted = sortApps(filtered, state.sort);

  el.grid.dataset.animate = 'true'; // 由 JS 渲染的卡片才做入场动画
  el.grid.innerHTML = sorted.map((app) => cardHtml(app, { root: ROOT })).join('');
  hydrateIcons(el.grid);
  initReveal(el.grid);

  if (el.empty) el.empty.dataset.visible = sorted.length ? 'false' : 'true';
  if (el.resultBar) {
    const bits = [`共 <b>${sorted.length}</b> 个结果`];
    if (state.query) bits.push(`搜索：<b>${escapeHtml(state.query)}</b>`);
    if (state.category !== categories.all.slug) bits.push(`分类：<b>${escapeHtml(category.name)}</b>`);
    el.resultBar.innerHTML = `<span>${bits.join(' · ')}</span><span class="muted">${
      state.platform ? `检测到你在使用 <b>${escapeHtml(state.platform)}</b>，下载按钮已优先匹配` : '点击卡片进入详情页'
    }</span>`;
  }
  writeUrlState(state);
}

function updateSearchBox() {
  if (el.searchBox) el.searchBox.dataset.filled = el.search && el.search.value ? 'true' : 'false';
}

function applyView() {
  if (!el.grid) return;
  el.grid.dataset.view = state.view;
  el.viewBtns.forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.viewBtn === state.view));
  });
}

/* --------------------------------------------------------------------------
   出错提示
   -------------------------------------------------------------------------- */
function renderError(error) {
  const message = error && error.message ? error.message : String(error);
  if (el.grid) {
    el.grid.innerHTML = `<div class="alert" style="grid-column:1/-1">
      <b>数据加载失败：</b>${escapeHtml(message)}
      <p style="margin:8px 0 0">${icon('info')} 请确认项目根目录下存在 <code>data/apps.generated.js</code>。
      如果缺少这个文件，在项目文件夹里运行 <code>npm run build</code> 重新生成即可。</p>
    </div>`;
  }
  toast('数据加载失败，请查看页面提示');
}

main();
