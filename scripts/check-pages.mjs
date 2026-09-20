/* ==========================================================================
   check-pages.mjs · 部署前检查 GitHub Pages 是否已经开启
   --------------------------------------------------------------------------
   为什么需要它：
     仓库如果从来没开过 Pages，actions/configure-pages 会直接抛出一串英文报错
     （Get Pages site failed ... Error: Not Found），新手很难看懂。
     这里提前检查一次，用中文告诉你「该点哪里」。

   用法：
     GitHub Actions 里自动运行（deploy.yml 里已经接好）。
     本地也可以手动跑：GH_TOKEN=xxx node scripts/check-pages.mjs
   ========================================================================== */

const REPO = process.env.GITHUB_REPOSITORY || '';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const SETTINGS_URL = REPO ? `https://github.com/${REPO}/settings/pages` : '';

/** 在 Actions 日志里发一条红色注解；普通终端里也看得懂 */
function fail(title, lines) {
  console.log(lines.join('\n'));
  console.log(`::error title=${title}::${lines.join(' ')}`);
  return 1;
}

async function main() {
  if (!REPO) {
    console.log('（当前不是 GitHub Actions 环境，跳过 Pages 检查）');
    return 0;
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'resource-site/check-pages',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${REPO}/pages`, { headers });
  } catch (error) {
    console.log(`! 连不上 GitHub API（${error.message}），跳过 Pages 检查，继续构建。`);
    return 0;
  }

  // 404 = 这个仓库还没开启过 Pages
  if (response.status === 404) {
    return fail('GitHub Pages 还没开启', [
      '',
      '\u2717 这个仓库还没有开启 GitHub Pages，所以拿不到站点信息（HTTP 404）。',
      '',
      '  解决办法（只做一次，点几下鼠标就行）：',
      `    1. 打开 ${SETTINGS_URL}`,
      '    2. Build and deployment \u2192 Source 选「GitHub Actions」',
      '    3. 回到 Actions 页面，点右上角「Re-run all jobs」重跑一次',
      '',
    ]);
  }

  // 权限不足等情况不拦，交给后面的步骤
  if (!response.ok) {
    console.log(`! 读取 Pages 配置失败（HTTP ${response.status}），跳过检查，继续构建。`);
    return 0;
  }

  const pages = await response.json();

  // Source 选了「Deploy from a branch」时，官方 deploy-pages 是不能用的
  if (pages.build_type && pages.build_type !== 'workflow') {
    return fail('Pages 的 Source 需要改成 GitHub Actions', [
      '',
      '\u2717 这个仓库的 Pages 目前是「从分支部署」（Source = Deploy from a branch），',
      '  而本工作流用的是官方 actions/deploy-pages，两者不兼容。',
      '',
      '  解决办法：',
      `    1. 打开 ${SETTINGS_URL}`,
      '    2. Build and deployment \u2192 Source 改成「GitHub Actions」',
      '    3. 回到 Actions 页面，点右上角「Re-run all jobs」重跑一次',
      '',
      '  （如果你就是想要「从分支部署」，那就把 .github/workflows/deploy.yml 删掉，',
      '    改成每次改完数据先在本机跑 npm run build 再 push。）',
      '',
    ]);
  }

  console.log(`\u2713 GitHub Pages 已开启${pages.html_url ? `：${pages.html_url}` : ''}`);
  return 0;
}

process.exitCode = await main();