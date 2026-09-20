# DevShelf · 个人软件 / 资源下载站

一个**纯静态**的个人软件下载站：HTML + CSS + 原生 JavaScript，没有任何前端框架、没有后端、没有数据库、没有登录，也不需要 `npm install` 装依赖。所有内容都来自 `data/` 目录下的 JSON 文件，你用记事本改 JSON、把安装包丢进 `downloads/`，然后 `git push`，网站就更新了。

**主要特性**

- 首页：搜索、分类筛选、排序、网格 / 列表切换、深浅色模式、响应式（手机优先）
- 详情页：每个软件一个独立静态页面（SEO 友好），含版本、大小、平台、系统要求、多平台下载按钮、更新日志、历史版本
- 自动识别访客系统（Windows / macOS / Linux / Android），把对应安装包排在前面并标注「推荐给你」
- 构建时自动生成 `sitemap.xml`、`robots.txt`、`feed.xml`（RSS 更新订阅）、favicon 与分享封面图
- 所有文本都经过 HTML 转义，下载链接只允许 `http(s)` 与站内相对路径，无跟踪、无第三方脚本

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
│   ├── home.js                 ★ 自动生成：把上面几个模块打包成普通脚本给首页用
│   └── app.js                  ★ 自动生成：把上面几个模块打包成普通脚本给详情页用
├── scripts/                    构建与维护脚本（Node，零依赖）
│   ├── build.mjs               构建：生成详情页 / sitemap / robots / feed / dist
│   ├── bundle.mjs              把 js/ 里的 ES 模块打包成普通脚本（见下文说明）
│   ├── serve.mjs               本地预览服务器
│   ├── dev.mjs                 本地开发：构建 + 预览 + 自动重建
│   ├── new-app.mjs             交互式添加新软件
│   ├── check.mjs               检查数据有没有写错
│   ├── hash.mjs                计算安装包大小与 SHA256
│   ├── make-icons.mjs          生成 favicon 与分享封面图
│   ├── validate.mjs            校验逻辑（build 与 check 共用）
│   └── templates/detail.html   详情页模板（改详情页版式改这里）
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
| `npm run build` | 只构建：生成详情页、sitemap、feed、dist（提交前跑一次） |
| `npm run check` | 只检查 `data/`：id 重复、下载链接写错、文件不存在…… |
| `npm run new` | 交互式添加一个新软件（推荐新手用这个） |
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

## 四、日常维护（重点）

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

## 五、数据字段说明

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

## 六、常见问题

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

---

## 七、安全与隐私

- **没有后端**：所有功能都在浏览器里完成，不存在服务器被拿下的问题，也没有数据库、没有登录、没有用户系统。
- **没有收集信息**：没有统计脚本、没有 Cookie 追踪、没有第三方 CDN 请求（图标全部内联 SVG）。
- **防 XSS**：软件介绍、更新日志等所有文本在渲染前都会做 HTML 转义，只允许一个极小的 Markdown 子集；`javascript:` / `data:text/html` 之类的链接会被自动替换成 `#`。
- **下载安全**：下载地址来自你自己的 `data/apps.json`；站外链接一律加 `rel="noopener noreferrer"`。建议给重要安装包计算 SHA256（`npm run hash`）填进 `sha256` 字段，方便用户校验。
- **本地预览服务器**：默认只监听 `127.0.0.1`，只有显式加 `--lan` 或 `lan` 参数才会开放给局域网。

---

## 八、许可

站点代码你可以自由修改、商用、二次分发。`data/apps.json` 里收录的软件版权归各自作者所有，请遵守对应软件的授权协议。
