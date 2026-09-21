# Xixi 更新记录

这里的版本号是**工具本身**的版本（写在 `package.json` 里），
和网站上每个软件的版本号（写在 `data/apps.json` 里）是两回事。

## v1.2.0（2026-09-21）

- 新增**在线后台**：`admin/` 页面会跟着网站一起部署，打开 `https://2681114373.ccwu.cc/admin/` 就能发布软件
  - 没有服务器：页面直接调 GitHub API，粘一个细粒度令牌（只给本仓库 Contents 读写）即可
  - 安装包传进 **GitHub Releases**（自动按 `v版本号` 建 release），`apps.json` 里记 Release 直链
  - `data/apps.json` / `data/site.json` 直接提交，提交后由 GitHub Actions 自动重建部署
  - 令牌只存在浏览器 localStorage，只发给 `api.github.com`；页面有 `noindex`，`robots.txt` 屏蔽 `/admin/`
  - 支持「已有下载直链」：安装包已经在别处（Releases / R2 / OSS）时直接填直链，跳过上传
  - 提交撞车（HTTP 409）会自动重读重试最多 3 次
- 修复**安全隐患**：`data/admin.json`（本地后台明文密码）和 `.wrangler/` 缓存以前会被复制进 `dist/` 一起发布到公网，现在都被排除；`npm test` 增加了对应检查
- 浏览器与本地后台共用同一套 JSON 改写逻辑（新增 `js/admin-lib.js`，由 `scripts/json-style.mjs` + `scripts/app-data.mjs` 打包而来），保证两种后台改出来的 `apps.json` 完全一致
- 命令行参数支持 `--port=9000` 这种写法（原来只认 `--port 9000`，写错会静默退回默认端口，现在两种都认、填错会明确报错）
- 自检从 52 项增加到 76 项：新增在线后台（地址解析、UTF-8 base64、错误翻译、读文件、提交、409 重试、自动建 release）与两种后台端到端发布流程的测试
- 本地后台也可以换端口写法之外，启动时会打印工具版本号；后台页脚会标明当前是「本地后台」还是「在线后台」

## v1.1.0（2026-09-21）

- 站点更名为 **Xixi**（原 DevShelf），图标与分享封面同步重新生成
- 新增**一键发布**：`npm run publish -- "安装包" "名字"` 或直接把安装包拖到 `发布软件.cmd` 上
  - 自动复制到 `downloads/`、算大小和 SHA256、按后缀猜平台 / 架构 / 类型
  - 自动写入 `data/apps.json`：同平台同架构替换下载项，否则追加；支持 `--bump patch|minor|major` 自动升版本
  - 老版本自动进「历史版本」，更新说明写进「更新日志」
  - `--push` 可以发布完直接 `git commit` + `git push`
- 新增**本地后台**：`npm run admin` 或双击 `Xixi后台.cmd`
  - 浏览器里拖拽安装包 → 填名字 / 版本 → 保存并构建
  - 一键上传到 GitHub（自动 `git add` / `commit` / `push`，并显示每一步日志）
  - 软件管理（编辑 / 删除 / 预览）、站点信息编辑（站名、简介、主题色）
  - 只监听 `127.0.0.1`，密码存在 `data/admin.json`（不提交到仓库）
- 改写 JSON 的方式改为「局部改写」：不会再因为发布而把 `data/apps.json` 整个重排
- 自检从 46 项增加到 52 项，覆盖发布工具的猜后缀、版本 +1、局部改写等逻辑

## v1.0.0

- 纯静态个人软件下载站：首页搜索 / 分类 / 排序、每个软件的详情页、更新日志、历史版本
- 构建时自动生成 `sitemap.xml` / `robots.txt` / `feed.xml` / favicon / 分享封面图
- 所有文本做 HTML 转义，下载链接只允许 `http(s)` 与站内相对路径
