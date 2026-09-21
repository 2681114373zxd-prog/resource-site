# Xixi · 个人软件 / 资源下载站

一个**纯静态**的个人软件下载站：HTML + CSS + 原生 JavaScript，没有任何前端框架，也不需要 `npm install` 装依赖。所有内容都来自 `data/` 目录下的 JSON 文件。

发布软件有四种方式，从省事到彻底手动：

1. **在线后台**：打开 `https://2681114373.ccwu.cc/admin/`，粘一个 GitHub 令牌，然后把安装包拖进去 —— 安装包会传进 GitHub Releases，`data/apps.json` 直接提交，随后 GitHub Actions 自动重建网站。**不用在自己电脑上跑任何东西，换台电脑照样用。**
2. **本地后台**（本机图形界面）：双击 `Xixi后台.cmd`，把安装包拖进去、填个名字和版本号，点「保存并构建」，再点「一键上传到 GitHub」——完事。
3. **一键发布命令**：`npm run publish -- "D:\下载\某软件.exe" "某软件"`，或者把安装包直接拖到 `发布软件.cmd` 上。
4. **手写 JSON**：自己编辑 `data/apps.json` + 把安装包丢进 `downloads/` + `npm run build` + `git push`。

公开站点本身仍然是纯静态的：没有数据库、没有服务端接口、没有第三方请求。两种后台都是**没有服务器**的：本地后台跑在你自己电脑的 `127.0.0.1` 上，密码存在本地；在线后台用的是你自己浏览器里的 GitHub 令牌，令牌只发给 `api.github.com`，不经过任何第三方。

**主要特性**

- 首页：搜索、分类筛选、排序、网格 / 列表切换、深浅色模式、响应式（手机优先）
- 详情页：每个软件一个独立静态页面（SEO 友好），含版本、大小、平台、系统要求、多平台下载按钮、更新日志、历史版本
- 自动识别访客系统（Windows / macOS / Linux / Android），把对应安装包排在前面并标注「推荐给你」
- 构建时自动生成 `sitemap.xml`、`robots.txt`、`feed.xml`（RSS 更新订阅）、favicon 与分享封面图
- 所有文本都经过 HTML 转义，下载链接只允许 `http(s)` 与站内相对路径，无跟踪、无第三方脚本
- 一键发布 / 本地后台：自动算大小与 SHA256、按后缀猜平台架构、版本号自动 +1、老版本自动进「历史版本」
- 「一键上传到 GitHub」会在后台页面里显示 `git add` / `commit` / `push` 每一步的真实日志
- 在线后台（`/admin/`）：页面直接调 GitHub API，不需要服务器；令牌只存在浏览器本地，随时可在 GitHub 撤销
- 两种后台共用同一套「只改那一段」的 JSON 改写逻辑，所以手写风格的 `apps.json` 不会被整体重排版
- 工具自身有版本号（`package.json` 的 `version`，当前 **v1.2.0**），更新历史见 `CHANGELOG.md`

---

## 一、项目结构

```
/
├── index.html                  首页（SEO、统计、软件卡片由 npm run build 预渲染，改数据后会自动更新）
├── 404.html                    找不到页面时的提示，会尝试跳转到通用详情页
├── apps/
│   ├── <软件id>/index.html     ★ 自动生成：每个软件的详情页（不要手改）
│   └── app.html                ★ 自动生成：通用详情页（兜底用，支持 ?id=xxx）
├── data/                       ★ 你平时主要改这里
│   ├── site.json               站点名称、简介、Logo 说明、联系方式、主题色、网址
│   ├── categories.json         分类（首页筛选按钮，从数据读取）
│   ├── apps.json               ★★ 所有软件的数据（版本、下载地址、更新日志……）
│   ├── apps.generated.js       ★ 自动生成：把上面三个 JSON 打包给浏览器用
│   └── README.md               数据字段速查（本文件里也有）
├── downloads/                  安装包放这里（附说明；大文件建议用 GitHub Releases）
├── assets/
│   ├── css/style.css           全站样式（配色变量在文件顶部）
│   ├── css/admin.css           后台界面样式
│   ├── images/logo.svg         网站 Logo（想换 Logo 直接替换这个文件）
│   ├── images/og-cover.png     社交分享封面图（1200×630，可用 npm run icons 重新生成）
│   ├── favicon/                favicon.svg / favicon-32.png / apple-touch-icon.png
│   └── icons/                  （可选）自己给软件准备的图标，例如 my-app.svg
├── js/
│   ├── shared.js               纯函数：筛选、排序、格式化、Markdown 子集渲染
│   ├── core.js                 数据加载、主题切换、系统识别、站名填充等通用逻辑
│   ├── render.js               用数据生成 HTML（浏览器和构建脚本共用同一份代码）
│   ├── main.js                 首页逻辑
│   ├── app-page.js             详情页逻辑
│   ├── admin.js                本地后台的界面逻辑（只在 npm run admin 时打开）
│   ├── admin-github.js         在线后台：直接调 GitHub API（不用服务器，见第四节第 2 小节）
│   ├── admin-lib.js            ★ 自动生成：把 scripts/json-style.mjs + app-data.mjs 打包给浏览器
│   ├── home.js                 ★ 自动生成：把上面几个模块打包成普通脚本给首页用
│   └── app.js                  ★ 自动生成：把上面几个模块打包成普通脚本给详情页用
├── admin/index.html            ★ 后台界面（本地后台 / 在线后台共用；会跟着网站一起部署）
├── scripts/                    构建与维护脚本（Node，零依赖）
│   ├── build.mjs               构建：生成详情页 / sitemap / robots / feed / dist
│   ├── bundle.mjs              把 js/ 里的 ES 模块打包成普通脚本（见下文说明）
│   ├── serve.mjs               本地预览服务器
│   ├── dev.mjs                 本地开发：构建 + 预览 + 自动重建
│   ├── new-app.mjs             交互式添加新软件（一问一答，适合慢慢填）
│   ├── publish.mjs             ★ 一键发布：安装包 + 名字 = 网站上多一个软件
│   ├── files.mjs               安装包相关的共用小工具（大小 / SHA256 / 猜平台）
│   ├── admin-server.mjs        ★ 本地后台服务器（npm run admin，浏览器里管理站点）
│   ├── app-data.mjs            发布共用的数据逻辑（合并下载项 / 版本 +1 / 历史版本）
│   ├── json-style.mjs          按手写风格局部改写 JSON（不重排整个 apps.json）
│   ├── check.mjs               检查数据有没有写错
│   ├── hash.mjs                计算安装包大小与 SHA256
│   ├── make-icons.mjs          生成 favicon 与分享封面图
│   ├── validate.mjs            校验逻辑（build 与 check 共用）
│   └── templates/detail.html   详情页模板（改详情页版式改这里）
├── 发布软件.cmd                Windows 下把安装包拖上去就能发布
├── Xixi后台.cmd                Windows 下双击打开本地后台
├── CHANGELOG.md                工具自身的版本更新记录
├── dist/                       构建输出（部署用；不需要时删掉，下次构建会重新生成）
├── sitemap.xml / robots.txt / feed.xml    自动生成
├── .github/workflows/deploy.yml           GitHub Actions 自动部署
└── package.json                只有一个 scripts 列表，没有依赖
```

> 标了 ★ 的文件是「数据」或「自动生成」的。**日常维护只改 `data/*.json` 和 `downloads/` 就够了。**

---

## 二、在本地运行

需要 [Node.js](https://nodejs.org/) 18 或更高版本（推荐 20+；本项目零依赖，不用 `npm install`）。

### 最简单的方式（Windows）

**双击项目里的 `启动预览.cmd`** —— 它会自动构建、启动本地服务器并打开浏览器，关掉那个黑窗口就等于停止预览。

### 命令行方式（Windows / macOS / Linux 通用）

```bash
cd resource-site
npm run dev          # 构建 + 启动本地预览 http://127.0.0.1:5173
```

`npm run dev` 会监听 `data/`、`js/`、`assets/` 的变化，你改完 JSON 保存后自动重新构建，刷新浏览器即可看到效果。

想在手机上看效果（手机和电脑连同一个 Wi-Fi）：

```bash
npm run dev -- --lan
```

终端里会打印一个 `http://192.168.x.x:5173` 的地址，用手机浏览器打开即可。

### 关于「直接双击 index.html」

直接双击 `index.html`（地址栏是 `file:///...`）时，**页面内容、软件列表和下载链接都能正常查看**，因为它们在构建时就已经写进 HTML 了。

浏览器出于安全限制会拦截 `file://` 下的 **ES 模块**，所以项目在构建时会用 `scripts/bundle.mjs` 把 `js/` 里的模块按依赖顺序拼成两个普通脚本：

- `js/home.js` —— 首页用（`shared.js` + `render.js` + `core.js` + `main.js`）
- `js/app.js` —— 详情页用（`shared.js` + `render.js` + `core.js` + `app-page.js`）

页面只加载这两个打包后的文件，所以**直接双击打开也能用搜索、分类筛选、深浅色切换**，不需要本地服务器。

一句话：**直接双击 `index.html` 就能用全部功能**；`启动预览.cmd`（或 `npm run dev`）适合改完数据后预览，因为它会自动重建。

> ⚠️ 改完 `js/` 里的源码后一定要运行一次 `npm run build`，否则 `js/home.js`、`js/app.js` 还是旧的。这两个文件是自动生成的，**不要直接改它们**。

### 命令速查

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 本地开发（构建 + 预览 + 自动重建），最常用 |
| `npm run admin` | ★ 打开本地后台（浏览器里发布软件、改站点信息、一键上传到 GitHub） |
| `npm run publish -- "安装包" "名字"` | ★ 一键发布：复制安装包 + 写数据 + 构建（加 `--push` 连推送一起做） |
| `npm run build` | 只构建：生成详情页、sitemap、feed、dist（提交前跑一次） |
| `npm run check` | 只检查 `data/`：id 重复、下载链接写错、文件不存在…… |
| `npm run new` | 交互式添加一个新软件（一问一答，适合慢慢填字段） |
| `npm run hash -- downloads/xx.exe` | 计算文件大小 + SHA256，并输出可粘贴的 JSON |
| `npm run icons` | 重新生成 favicon / Logo / 分享封面图 |
| `npm run serve` | 只启动预览服务器（不构建） |

---

## 三、部署到 GitHub Pages

### 第 1 步：把项目推上 GitHub

```bash
cd resource-site
git init                        # 如果还没初始化过（本项目已初始化）
git add .
git commit -m "init: 资源站"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

> **推送失败（`Connection was reset` / 连接超时）？**
> 这是国内网络的常见情况：浏览器能打开 GitHub，是因为系统代理生效了，但 **git 默认不走系统代理**。
> 让 git 也走你的本地代理即可（端口填你自己的，v2rayN / Clash 常见端口是 `10808`、`10809`、`7890`）：
>
> ```bash
> git config --global http.https://github.com/.proxy http://127.0.0.1:10808
> ```
>
> 这条配置只对 GitHub 生效，不影响其他网站；想取消执行
> `git config --global --unset http.https://github.com/.proxy`。
> 第一次 `push` 会弹出登录窗口，用浏览器授权登录你的 GitHub 账号，之后 Windows 会记住凭据。

### 第 2 步：改 `data/site.json` 里的网址

把 `url` 改成你的真实地址，例如 `https://你的用户名.github.io/你的仓库名`。
（`npm run check` 会提醒你这一点。）这个值只用于生成 canonical、sitemap、RSS 的绝对地址，**改完要重新构建**。

### 第 3 步：选择一种部署方式

**方式 A：GitHub Actions 自动构建（推荐）**

1. 仓库 → **Settings** → **Pages** → **Build and deployment** → **Source** 选 **GitHub Actions**
2. 之后每次 `git push` 到 `main`，`.github/workflows/deploy.yml` 会自动执行：
   检查数据 → 构建 → 自检 → 把 `dist/` 发布到 Pages。你**不需要**在本地跑构建。
3. 部署完成后地址是 `https://你的用户名.github.io/你的仓库名/`

**方式 B：直接从分支部署（不想用 Actions 时）**

1. 本地先跑一次 `npm run build`（生成 `apps/*/index.html`、`sitemap.xml` 等）
2. 把生成结果一起提交并 push
3. 仓库 → **Settings** → **Pages** → **Source** 选 **Deploy from a branch** → 分支选 `main`，目录选 `/(root)`

这种方式下，**每次改完 `data/apps.json` 都要先在本地 `npm run build` 再 push**，否则新的详情页不会被生成。

**方式 C：Cloudflare Pages（国内访问更快）**

1. Cloudflare 控制台 → **Workers & Pages** → **Create** → **Pages** → 连接你的 GitHub 仓库
2. 构建设置：
   - Framework preset：`None`
   - Build command：`node scripts/build.mjs`
   - Build output directory：`dist`
3. 保存并部署，之后每次 push 都会自动构建

> **本项目当前的实际状态**：站点已经用「直传（Direct Upload）」方式部署在 Cloudflare Pages 上，
> 项目名 `resource-site`，自定义域名 <https://2681114373.ccwu.cc>。
>
> 直传方式**不会**跟着 push 自动部署，改完数据后在本机执行：
>
> ```bash
> npm run build
> npx wrangler pages deploy dist --project-name=resource-site --branch=main
> ```
>
> （wrangler 需要授权：`npx wrangler login`，或设置环境变量
> `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。）
> 如果想让每次 push 都自动部署，就按上面的「连接 GitHub 仓库」方式再建一个项目。

### 关于子目录

本站所有链接都是相对路径，所以部署在 `https://域名/子目录/`（GitHub Pages 项目站点就是这种）不会白屏或丢样式。唯一要手动改的是 `data/site.json` 里的 `url`。

---

## 四、发布软件（本地后台 / 在线后台 / 命令行）

### 1. 本地后台（图形界面，最省事）

双击项目里的 **`Xixi后台.cmd`**（或者在项目目录执行 `npm run admin`），终端里会打印地址和密码：

```
▶ Xixi 本地后台 v1.2.0
  地址：http://127.0.0.1:8787/admin/
  密码：xixi-16dfb4   ← 第一次运行自动生成（也在 data/admin.json 里）
```

浏览器打开那个地址、输入密码，就能：

- **发布软件**：把安装包拖进去 → 填软件名字（网址短名、版本号、平台、架构会自动填好）→ 点「保存并构建」
- **保存并一键上传到 GitHub**：连 `git add` / `git commit` / `git push` 一起做完，页面下方显示每一步的真实输出
- **软件管理**：搜索、编辑、删除（删除时可以连它独占的安装包文件一起删掉）、打开详情页预览
- **站点信息**：改站名、副标题、简介、主题色、页脚说明，改完自动重新构建
- **上传到 GitHub**：单独执行一次上传，并查看当前分支、远程仓库地址、未提交的改动数量

几个要点：

- 只监听 `127.0.0.1`，外网访问不到；**关掉那个黑窗口就等于关掉后台**
- 密码存在 `data/admin.json`（已在 `.gitignore` 里，不会提交）。想换密码：`npm run admin -- --password 新密码`
- 换端口：`npm run admin -- --port 9000`；想启动后自动打开浏览器：`npm run admin -- --open`
- 只用 Node 自带模块，不需要 `npm install`
- 单个安装包上限 4 GB；更大的文件建议放 GitHub Releases / 对象存储，`url` 填外链
- 后台只跑在你自己电脑上，界面里的东西不会进公网；密码文件 `data/admin.json` 构建时会被挡在 `dist/` 之外

### 2. 在线后台（部署在网站上，换台电脑也能用）

本地后台要开着自己电脑才行。**在线后台**把同一个界面部署到网站上，打开就能用：

```
https://2681114373.ccwu.cc/admin/
```

第一次打开会让你**连接 GitHub**，只要填两样：

| 填什么 | 说明 |
| --- | --- |
| GitHub 令牌 | 一串 `github_pat_…`，怎么建见下面 |
| 仓库 | 一般已经自动填好 `2681114373zxd-prog/resource-site`，不用改 |

连上之后和本地后台一样：拖安装包 → 填名字 → 点「保存并提交到 GitHub」。区别是：

- 安装包传进 **GitHub Releases**（每个版本一个 release），`data/apps.json` 里记的是 Release 直链
- 提交之后 **GitHub Actions 自动重建并部署**，一分钟左右网站就更新了
- 安装包放在 Releases 里、不进 git 历史，所以不会把仓库撑大，单文件也不受 100 MB 限制

**怎么建令牌**（只给这一个仓库、只给 Contents 读写，别开全仓库权限）：

1. GitHub → 右上角头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. **Repository access** 选 **Only select repositories**，只勾 `resource-site`
3. **Permissions** → **Repository permissions** → **Contents** 改成 **Read and write**
4. 生成后那串 `github_pat_…` 只显示一次，复制过来粘到后台页面上

要点：

- 令牌只存在**你浏览器的 localStorage** 里，只发给 `api.github.com`，不经过任何第三方服务器
- 页面本身公开可见，但没有令牌**谁也改不了你的仓库**；`robots.txt` 也屏蔽了 `/admin/`
- 不想用了：点页面上的「清除已保存的令牌」，或者直接去 GitHub 撤销令牌（撤销后页面立刻失效）
- 单个附件上限 2 GB；再大的先自己传到 Releases 或对象存储，把直链填进「已有下载直链」
- 提交撞车（比如你同时在本地改）会自动重读重试 3 次

### 3. 一键发布命令（命令行 / 拖拽）

**用法一：拖拽。** 把安装包直接拖到项目里的 `发布软件.cmd` 上，按提示输入软件名字，剩下的它自己干。

**用法二：命令行。**

```bash
# 最简：安装包 + 名字
npm run publish -- "D:\下载\MyTool-1.2.3-x64.exe" "我的工具"

# 更全：指定短名、版本号、更新说明，发布完直接上传到 GitHub
npm run publish -- "D:\下载\MyTool-1.2.3-x64.exe" "我的工具" --id my-tool \
  --version 1.2.3 --notes "修复闪退;新增深色模式" --push
```

它会依次：复制安装包到 `downloads/` → 算文件大小和 SHA256 → 按后缀猜平台 / 架构 / 类型 → 写进 `data/apps.json` → 重新构建 → 自检 → 问你（或直接）提交推送。

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--id <短名>` | 网址用的 id，例如 `my-tool`；**已经存在同 id 时自动按「更新这个软件」处理** |
| `--version <版本号>` | 默认 `1.0.0` |
| `--bump patch\|minor\|major` | 在已有版本号上自动 +1（`1.2.3` → `1.2.4` / `1.3.0` / `2.0.0`） |
| `--category <分类>` | 默认按平台猜（Windows / Android / Linux / macOS / 工具 / 其他） |
| `--platform` / `--arch` / `--type` | 猜错了可以用这些覆盖 |
| `--tagline <一句话>` | 卡片上的一句话介绍 |
| `--notes "a;b"` | 这次更新了什么，会写进「更新日志」 |
| `--featured` | 在首页置顶并加星标 |
| `--push` | 发布完自动 `git commit` + `git push` |
| `--no-build` | 只改数据，不重新构建 |

几条规则（后台和命令行完全一致）：

- 同一个软件、同一个「平台 + 架构」再次发布，就是**替换**那个下载按钮（例如 Windows x64 换了新版本）；换了平台则是**新增**一个按钮
- 版本号变化时，**上一个版本会自动进「历史版本」**，详情页上能看到旧版下载
- 重名的安装包不会被覆盖，会自动改成 `xxx-2.exe` 这样的名字
- 下载地址会写成 `downloads/文件名`，中文文件名会自动换成 `短名-版本.后缀`

---

## 五、日常维护（重点）

> 只是加软件、更新软件的话，用上一节的「本地后台」或 `npm run publish` 就够了。
> 下面这些是「手工操作」的完整说明，字段含义、批量调整、隐藏/删除等场景还是得看这里。

### 1. 添加一个新软件

**推荐：用交互式命令**

```bash
npm run new
```

跟着提示填：id、名称、简介、分类、平台、版本、日期、下载地址……填完会自动写进 `data/apps.json`。

**或者手写 JSON：** 打开 `data/apps.json`，在 `apps` 数组里加一段：

```json
{
  "id": "mytool",
  "name": "MyTool",
  "tagline": "一句话介绍这个软件",
  "description": "详细介绍，支持 **加粗**、`代码`、[链接](https://example.com)，\n\n- 支持列表\n- 第二条",
  "icon": "",
  "category": "工具",
  "platforms": ["Windows", "Android"],
  "tags": ["关键词", "方便搜索"],
  "version": "1.0.0",
  "releaseDate": "2026-09-19",
  "updated": "2026-09-19",
  "size": "42 MB",
  "license": "MIT",
  "homepage": "https://example.com",
  "repo": "https://github.com/you/mytool",
  "requirements": ["Windows 10 及以上", "4 GB 内存"],
  "featured": false,
  "downloads": [
    {
      "name": "Windows x64 安装版",
      "url": "downloads/mytool-1.0.0-x64.exe",
      "size": "42 MB",
      "platform": "Windows",
      "arch": "x64",
      "type": "installer"
    }
  ],
  "changelog": [
    { "version": "1.0.0", "date": "2026-09-19", "notes": ["第一个版本", "支持 Windows"] }
  ],
  "history": []
}
```

然后：

```bash
npm run check         # 检查有没有写错（id 重复、文件不存在等）
npm run dev           # 本地看一眼
git add . && git commit -m "add mytool" && git push
```

### 2. 更新一个软件（例如 1.0.0 → 1.1.0）

1. 把新安装包放进 `downloads/`（文件名建议带版本号：`mytool-1.1.0-x64.exe`）
2. 在 `data/apps.json` 里改这个软件的：
   - `version` → `"1.1.0"`
   - `releaseDate` / `updated` → 新日期
   - `size` → 新大小（可以 `npm run hash -- downloads/mytool-1.1.0-x64.exe` 得到）
   - `downloads[].url` / `size` → 指向新文件
3. 在 `changelog` 数组**最前面**插入一条新版本记录：

```json
{ "version": "1.1.0", "date": "2026-10-01", "notes": ["新增 xx 功能", "修复 yy 问题"] }
```

4. 如果还想保留旧版本下载，把它移到 `history`：

```json
"history": [
  {
    "version": "1.0.0",
    "date": "2026-09-19",
    "size": "42 MB",
    "notes": ["第一个版本"],
    "downloads": [
      { "name": "Windows x64（旧版）", "url": "downloads/mytool-1.0.0-x64.exe", "size": "42 MB", "platform": "Windows", "arch": "x64", "type": "installer" }
    ]
  }
]
```

5. `npm run build`（用方式 A 部署的话可以省略，Actions 会自动构建）→ `git add . && git commit -m "mytool 1.1.0" && git push`

### 3. 替换安装包

- **站内文件**：直接用新文件覆盖 `downloads/` 里的旧文件（同名覆盖最简单），或者换成带版本号的新名字并同步修改 `url`。
- **外部链接**：如果安装包放在 GitHub Releases / 对象存储上，只要把新的下载地址填进 `url` 就行，`downloads/` 目录可以为空。

单个文件超过 100 MB 时 GitHub 会拒绝 push，此时请用 GitHub Releases：在仓库 Releases 页面新建一个 release，把文件拖进附件区，发布后复制附件的直链填进 `url`。`downloads/README.md` 里有图文步骤。

### 4. 删除 / 隐藏一个软件

- 彻底删除：从 `data/apps.json` 的 `apps` 数组里删掉那一段，然后 `npm run build`（旧的 `apps/<id>/index.html` 会留在磁盘上，可以手动删除该目录）。
- 暂时隐藏：给这个软件加 `"hidden": true`，构建时会跳过它（不出现在首页，也不生成详情页）。

### 5. 添加 / 修改分类

编辑 `data/categories.json`：

```json
{
  "all": { "slug": "all", "name": "全部" },
  "items": [
    { "slug": "windows", "name": "Windows" },
    { "slug": "macos", "name": "macOS" },
    { "slug": "tools", "name": "工具" },
    { "slug": "games", "name": "游戏" }
  ]
}
```

软件的 `category` 字段填分类的 `name`（例如 `"游戏"`），或者软件的平台里包含这个分类名，都会被归到这个分类下。首页的分类按钮和数量统计会自动更新。

### 6. 修改网站名称 / Logo / 主题色

| 想改什么 | 改哪里 |
| --- | --- |
| 网站名称、简介、关键词、作者、邮箱 | `data/site.json` 的 `name` / `tagline` / `description` / `keywords` / `author` / `email` |
| GitHub 地址、页脚说明 | `data/site.json` 的 `github` / `footerNote` |
| 主题色（按钮、渐变、高亮） | `data/site.json` 的 `theme.accent` 与 `theme.accent2`（改完执行 `npm run icons` 让图标配色也一起更新） |
| Logo | 替换 `assets/images/logo.svg`（默认由 `npm run icons` 生成；想用自己的图就放一个同名 SVG） |
| favicon | `npm run icons` 重新生成，或直接替换 `assets/favicon/` 里的文件 |
| 分享封面图 | `assets/images/og-cover.png`（1200×630），或 `npm run icons` 重新生成 |
| 网址（用于 sitemap / canonical） | `data/site.json` 的 `url` |
| 首页文案（Hero 标题下的大段说明、「关于本站」） | `index.html` 里对应的文字（JS 会用 `site.json` 覆盖 `data-site` 标记的部分） |
| 页脚备案号等自定义内容 | `index.html` 页脚部分 |

改完颜色后记得再执行一次 `npm run build`（或 `npm run dev`）让页面生效。

---

## 六、数据字段说明

### `data/site.json`

| 字段 | 说明 |
| --- | --- |
| `name` | 网站名称（导航、页脚、分享标题都用它） |
| `nameCn` | 中文名（可选，暂时用于占位/备用） |
| `tagline` | 一句话简介（Hero 副标题） |
| `description` | 站点描述（首页「关于本站」+ meta description） |
| `keywords` | 数组，SEO 关键词 |
| `url` | 部署后的网址，**必须改成你自己的**，用于 sitemap / canonical / RSS |
| `author` | 作者名（详情页显示「整理 / 上传」） |
| `email` | 联系邮箱，留空则不显示邮箱链接 |
| `github` | 仓库地址，留空则隐藏 GitHub 链接 |
| `theme.accent` / `theme.accent2` | 主题主色 / 渐变色 |
| `footerNote` | 页脚版权说明 |

### `data/apps.json` → `apps[]`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 唯一标识，同时是详情页地址：`apps/<id>/`。建议只用小写字母、数字、短横线 |
| `name` | ✅ | 软件名称 |
| `tagline` | ✅ | 一句话介绍（卡片和详情页副标题） |
| `description` | | 详细介绍，支持 `**加粗**`、`` `代码` ``、`- 列表`、`> 引用`、`[链接](url)` |
| `icon` | | 图标路径；留空自动生成「首字母方块」（例如放 `assets/icons/mytool.svg`） |
| `category` | | 分类名，要和 `categories.json` 里的 `name` 对得上 |
| `platforms` | | 数组，如 `["Windows","Android"]`，用于分类筛选和"支持平台"显示 |
| `tags` | | 数组，参与搜索，例如 `["压缩","开源"]` |
| `version` | | 版本号（显示为 `v1.2.0`） |
| `releaseDate` | | 发布日期 `YYYY-MM-DD` |
| `updated` | | 最后更新日期，用于排序和「x 天前」显示 |
| `size` | | 文件总大小（如 `"42 MB"`），只是显示用，写你自己方便的格式 |
| `license` | | 授权协议 |
| `homepage` / `repo` | | 项目主页 / 源码仓库地址，会生成按钮 |
| `requirements` | | 数组或字符串，显示在「系统要求」 |
| `featured` | | `true` 时排在前面并带星标 |
| `hidden` | | `true` 时不在网站上出现 |
| `downloads[]` | | 下载项，见下表 |
| `changelog[]` | | 更新日志，最新版本放最前面：`{ "version", "date", "notes": [] }` |
| `history[]` | | 历史版本：`{ "version", "date", "size", "notes", "downloads": [] }` |

### `downloads[]`（每个安装包一项）

| 字段 | 说明 |
| --- | --- |
| `name` | 按钮旁边的名称，如 `Windows x64 安装版` |
| `url` | **以 `http(s)://` 开头** = 外部链接；**以 `downloads/` 开头** = 站内文件（也可写 `/downloads/xx.exe`） |
| `size` | 显示在按钮上，如 `"42 MB"` |
| `platform` | `Windows` / `macOS` / `Linux` / `Android` / `全平台`，用于分组和「推荐给你」 |
| `arch` | `x64` / `arm64` / `x86` / `universal` |
| `type` | `installer` / `portable` / `apk` / `dmg` / `deb` / `appimage` / `archive` / `link` / `file` |
| `note` | 可选说明，显示在名称下方 |
| `sha256` | 可选，填了会在下载项上标注「SHA256 已提供」 |

---

## 七、常见问题

**Q：推送到 GitHub 后页面没更新？**
A：GitHub Pages 有缓存（一般 1～10 分钟）；另外确认 Actions 跑成功了，或者（方式 B）你本地确实执行过 `npm run build`。也可以在页脚查看构建日期。

**Q：Actions 报 `Get Pages site failed ... Error: Not Found`（部署任务失败）？**
A：这说明仓库**还没有开启 Pages**（或 Source 不是「GitHub Actions」），不是代码问题。每个人第一次部署只会遇到一次：
① 打开仓库 → **Settings** → **Pages**；② **Build and deployment** → **Source** 选 **GitHub Actions**；
③ 回到 **Actions** 页面点 **Re-run all jobs** 重跑。
`scripts/check-pages.mjs` 会在部署前先检查一遍，并把上面这段话直接打印在日志里。

**Q：详情页 404？**
A：三种可能：① 忘了 `npm run build`；② `id` 改了但旧的链接还在（`apps/<旧id>/` 目录可以手动删）；③ 链接大小写不一致（`id` 建议全小写）。

**Q：直接双击 `index.html` 打开，软件列表是空白的 / 点了卡片打不开？**
A：先确认 `js/home.js`、`js/app.js` 存在（它们是构建产物）。如果不存在，在项目文件夹里运行一次 `npm run build`。
另外注意卡片链接指向的是 `apps/<id>/index.html`（不是 `apps/<id>/`）——指向目录时，`file://` 下浏览器只会显示一个文件列表。

**Q：`npm run check` 提示「找不到文件 downloads/xxx」？**
A：说明 JSON 里写了本地文件但文件不在 `downloads/` 里。要么把文件放进去，要么改成外部直链。

**Q：想给某个软件加自己的图标？**
A：把图片放进 `assets/icons/`（SVG 或 PNG 都行），在 `apps.json` 里写 `"icon": "assets/icons/你的文件.svg"`。图片加载失败时会自动回退成首字母方块，不会出现破图。

**Q：怎么让下载量更大也不怕？**
A：安装包放在 GitHub Releases 或对象存储（Cloudflare R2、阿里云 OSS 等）上，`url` 填直链。GitHub 仓库单文件上限 100 MB，仓库总量也建议控制在 1 GB 以内。

**Q：搜索能不能搜拼音？**
A：不能，搜索是「名称 / 简介 / 介绍 / 标签 / 分类 / 平台」的子串匹配（支持空格分词，例如 `7zip windows`）。想提升命中率，把常用别名写进 `tags`。

**Q：手机上检查？**
A：`npm run dev -- --lan`，用手机打开终端里打印的局域网地址即可。

**Q：后台密码是多少？忘了怎么办？**
A：第一次运行 `npm run admin`（或双击 `Xixi后台.cmd`）时，终端里会打印一行「密码：xixi-xxxxxx」，同时也写进了 `data/admin.json`。忘了就直接打开那个文件看，或者重设：`npm run admin -- --password 新密码`。

**Q：点「一键上传到 GitHub」报 `Authentication failed` / `Permission denied`？**
A：这是 git 本身的登录问题，不是后台的问题。先在项目目录里手动执行一次 `git push`，把 GitHub 账号密码或 Personal Access Token 填好（Windows 上一般会弹出凭据窗口），之后后台就能一键上传了。

**Q：报 `Please tell me who you are`？**
A：电脑上的 git 还没配置身份，执行一次即可：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

**Q：安装包太大，传不上去？**
A：本地后台单个文件上限 4 GB；在线后台（传进 GitHub Releases）上限 2 GB。再大的话，先自己传到 GitHub Releases 或对象存储（Cloudflare R2、阿里云 OSS 等），然后在后台填「已有下载直链」。注意：如果要走在线后台的上传，单个附件不要超过 2 GB。

**Q：在线后台安全吗？令牌会不会被人看到？**
A：令牌只存在**你这台电脑的浏览器**（localStorage）里，只发给 `api.github.com`，不经过任何第三方服务器，也不写进仓库。别的访客打开 `/admin/` 只会看到一个「连接 GitHub」表单，没有令牌什么都做不了。另外令牌是细粒度的、只给 `resource-site` 一个仓库的 Contents 读写，泄露风险面很小；真泄露了，去 GitHub 撤销那一个令牌就行。

**Q：在线后台连不上，报 404 / 说没权限？**
A：按顺序检查三件事：① 令牌是不是 **Fine-grained** 的、**Repository access** 里显式勾了 `resource-site`（没勾就是 404）；② **Contents** 权限是不是 **Read and write**；③ 令牌有没有过期。权限改完之后重新生成一次令牌再粘。

**Q：在线后台换个浏览器/换台电脑就要重连？**
A：是的，令牌存在浏览器本地，不会跟着账号走（这是故意的）。换设备就重新粘一次令牌；也可以点「清除已保存的令牌」换一个。

**Q：不想让别人看到 `/admin/` 这个页面怎么办？**
A：在 `scripts/build.mjs` 里把 `admin` 加回 `skip` 集合（`const skip = new Set([...])`），再 `npm run build`——这样在线后台就不会被部署，本地后台照常用。

**Q：`data/admin.json`（本地后台密码）会不会被传到网站上？**
A：不会。它已经在 `.gitignore` 里，而且构建时也会被排除在 `dist/` 之外；`npm test` 里有一条专门的检查盯着这件事。如果你以前部署过旧版本，建议换一次密码（`npm run admin -- --password 新密码`）以防万一。

**Q：怎么改工具自身的版本号？**
A：改 `package.json` 里的 `version`，并在 `CHANGELOG.md` 里记一笔。后台页面（本地和在线两种都会显示）和命令行启动时显示的 `v1.2.0` 就是读的这里。注意这跟网站上「每个软件的版本号」（写在 `data/apps.json` 里）是两回事。

---

## 八、安全与隐私

- **没有后端**：站点和两个后台都没有服务端进程 —— 在线后台页面直接调 GitHub API，本地后台跑在你自己电脑上。不存在服务器被拿下的问题，也没有数据库、没有用户系统。
- **没有收集信息**：没有统计脚本、没有 Cookie 追踪、没有第三方 CDN 请求（图标全部内联 SVG）。
- **防 XSS**：软件介绍、更新日志等所有文本在渲染前都会做 HTML 转义，只允许一个极小的 Markdown 子集；`javascript:` / `data:text/html` 之类的链接会被自动替换成 `#`。
- **下载安全**：下载地址来自你自己的 `data/apps.json`；站外链接一律加 `rel="noopener noreferrer"`。建议给重要安装包计算 SHA256（`npm run hash`）填进 `sha256` 字段，方便用户校验。
- **本地预览服务器**：默认只监听 `127.0.0.1`，只有显式加 `--lan` 或 `lan` 参数才会开放给局域网。
- **本地后台**：同样只监听 `127.0.0.1`（外网访问不到），需要密码登录，改数据的请求还要带一个自定义标记头（用来挡 CSRF）；密码存在 `data/admin.json`，已在 `.gitignore` 里，而且**构建时会被挡在 `dist/` 之外**（`data/admin.json` 绝不会跟着网站发出去），`robots.txt` 也屏蔽了 `/admin/`。
- **在线后台**（`/admin/`，公网可见）：它只是一个静态页面，本身没有服务器、不存密码、也没有任何后端接口。能不能改你的仓库，完全取决于那台浏览器里有没有粘过 GitHub 令牌；令牌只存在浏览器本地、只发给 `api.github.com`，别人打开这个页面只会看到一个「连接 GitHub」表单。不想让它公开，可以按上面的说明把 `admin` 加回 `scripts/build.mjs` 的 skip 列表（那样只剩本地后台）。

---

## 九、许可

站点代码你可以自由修改、商用、二次分发。`data/apps.json` 里收录的软件版权归各自作者所有，请遵守对应软件的授权协议。
