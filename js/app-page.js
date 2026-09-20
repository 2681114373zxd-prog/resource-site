/* ==========================================================================
   app-page.js · 软件详情页逻辑
   --------------------------------------------------------------------------
   详情页的内容在构建时就已经写进静态 HTML（SEO 友好、无白屏），
   这里负责：主题/站名填充、「适合你的版本」推荐、复制链接、分享、跳转等交互。
   如果页面里没有预渲染内容（例如手动打开 app.html?id=xxx），也会用同一份
   render.js 现场渲染出来。
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
  toast,
} from './core.js';
import { detailContentHtml, hydrateIcons, icon } from './render.js';
import { escapeHtml, pickBestDownload, formatDate } from './shared.js';

const rootNode = document.querySelector('[data-app-root]');
const platform = detectPlatform();

// 同 main.js：标记 JS 可用（CSS 用来显示需要 JS 的交互元素）
document.documentElement.classList.add('js');

async function main() {
  initThemeToggle();
  initMenu();

  let data;
  try {
    data = await loadData();
  } catch (error) {
    renderFatal(`数据加载失败：${error.message || error}`);
    return;
  }

  const { site, categories, apps } = data;
  applySiteTheme(site);
  initSiteChrome(site);

  const appId =
    (rootNode && rootNode.dataset.appId) ||
    document.querySelector('meta[name="app-id"]')?.content ||
    new URLSearchParams(window.location.search).get('id') ||
    '';
  const app = apps.find((item) => item.id === appId);

  if (!app) {
    renderFatal(`找不到 id 为 <code>${escapeHtml(appId || '(空)')}</code> 的软件，可能已经被删除或改名。`);
    return;
  }

  // 没有预渲染内容时，现场渲染（同一份代码，保证两种方式结果一致）
  const hasPrerender = rootNode && rootNode.dataset.prerendered === 'true';
  if (!hasPrerender && rootNode) {
    rootNode.innerHTML = detailContentHtml(app, {
      root: ROOT,
      site,
      categories,
      apps,
      platform,
    });
  } else {
    // 预渲染页面：把「相关软件」等依赖平台的信息补上（这里只需 hydrate 图标）
    hydrateIcons(rootNode || document);
  }

  enhanceDownloads(app);
  initActions(app);
  initReveal(document);
  initToTop();
  document.body.dataset.ready = 'true';
}

/* --------------------------------------------------------------------------
   推荐最合适的下载项 + 把你所在平台的安装包排到最前
   -------------------------------------------------------------------------- */
function enhanceDownloads(app) {
  const section = document.querySelector('#downloads');
  if (!section) return;

  const groups = [...section.querySelectorAll('.dl-group-label')].map((label) => ({
    label,
    list: label.nextElementSibling,
    platforms: [...(label.nextElementSibling?.querySelectorAll('.dl-row') || [])].map((r) => r.dataset.platform),
  }));

  if (platform) {
    const mine = groups.filter((group) => group.platforms.includes(platform));
    const rest = groups.filter((group) => !group.platforms.includes(platform));
    if (mine.length && groups.length > 1) {
      [...mine, ...rest].forEach((group) => {
        if (!group.list) return;
        section.append(group.label, group.list); // 把「你的系统」那一组移到最前面
      });
    }
  }

  // 标记「最适合你」的那一个
  const rows = [...section.querySelectorAll('.dl-row')];
  const best = pickBestDownload(app.downloads || [], platform);
  if (best && rows.length) {
    // 优先高亮「你的系统」里的第一个安装包，否则高亮默认首选项
    const target =
      (platform && rows.find((row) => row.dataset.platform === platform)) ||
      rows.find((row) => row.dataset.platform === (best.platform || '')) ||
      rows[0];
    target.dataset.recommended = 'true';
    const badge = target.querySelector('.dl-rec');
    if (badge) badge.hidden = false;
  }
}

/* --------------------------------------------------------------------------
   复制链接 / 分享 / 锚点定位
   -------------------------------------------------------------------------- */
function initActions(app) {
  const copyBtn = document.querySelector('[data-copy-link]');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const url = window.location.href;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(url);
        } else {
          const input = document.createElement('input');
          input.value = url;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          input.remove();
        }
        copyBtn.innerHTML = `${icon('check')} 已复制`;
        toast('链接已复制到剪贴板');
        setTimeout(() => {
          copyBtn.innerHTML = `${icon('link')} 复制本页链接`;
        }, 1800);
      } catch {
        toast('复制失败，请手动复制地址栏链接');
      }
    });
  }

  const shareBtn = document.querySelector('[data-share-app]');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const shareData = {
        title: `${app.name} v${app.version || ''}`.trim(),
        text: app.tagline || '',
        url: window.location.href,
      };
      if (navigator.share) {
        try {
          await navigator.share(shareData);
        } catch {
          /* 用户取消分享，忽略 */
        }
      } else {
        try {
          await navigator.clipboard.writeText(window.location.href);
          toast('当前浏览器不支持系统分享，链接已复制');
        } catch {
          toast('请手动复制地址栏链接');
        }
      }
    });
  }

  // 详情页内的锚点跳转（#downloads 等）
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 顺便把对应的折叠面板打开（例如点了「历史版本」）
      target.querySelectorAll('details').forEach((d) => (d.open = true));
    });
  });

  // 页面底部显示构建时间（便于确认线上是不是最新)
  const buildNode = document.querySelector('[data-build-date]');
  if (buildNode && buildNode.textContent.trim() === '') {
    buildNode.textContent = formatDate(new Date().toISOString(), 'iso');
  }
}

/* --------------------------------------------------------------------------
   找不到软件 / 数据出错
   -------------------------------------------------------------------------- */
function renderFatal(message) {
  if (!rootNode) return;
  rootNode.innerHTML = `<div class="alert" style="margin:24px 0">
    <b>${icon('info')} 无法显示这个页面</b>
    <p style="margin:8px 0 0">${message}</p>
    <p style="margin:8px 0 0"><a href="${ROOT}index.html">${icon('arrowLeft')} 返回首页</a></p>
  </div>`;
}

main();
