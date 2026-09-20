# downloads/ · 安装包目录

把你自己的安装包直接放进这个目录，例如：

```
downloads/
├── mytool-1.2.0-x64.exe
├── mytool-1.2.0-arm64.exe
└── mytool-1.2.0.apk
```

然后在 `data/apps.json` 里这样写下载地址（**以 `downloads/` 开头就表示站内文件**，不用写域名）：

```json
{
  "name": "Windows x64 安装版",
  "url": "downloads/mytool-1.2.0-x64.exe",
  "size": "42 MB",
  "platform": "Windows",
  "arch": "x64",
  "type": "installer"
}
```

构建时脚本会检查文件是否存在，找不到会打印提醒。

## 几个重要提醒

1. **单个文件不要超过 100 MB**：GitHub 仓库单文件限制 100 MB，超过会被拒绝推送。
   大文件请使用 GitHub Releases（见下面），仓库里只放小文件。
2. **GitHub Pages 有 1 GB 仓库 / 每月 100 GB 流量** 的软限制，如果把安装包都放在仓库里，
   请留意体积；下载量大建议改用 Releases 或对象存储（Cloudflare R2、阿里云 OSS 等）。
3. 安装包更新时，**直接覆盖同名文件**即可（也可以改成带版本号的新文件名，然后同步修改 `apps.json`）。
4. 计算文件大小和 SHA256：`npm run hash -- downloads/你的文件.exe`

## 用 GitHub Releases 放安装包（推荐）

1. 打开仓库页面 → Releases → Draft a new release
2. Tag 填版本号，例如 `v1.2.0`，标题随便写
3. 把安装包拖进附件区域，发布
4. 右键附件 → 复制链接，得到类似：
   `https://github.com/你的用户名/仓库名/releases/download/v1.2.0/mytool-1.2.0-x64.exe`
5. 把这个地址填进 `data/apps.json` 的 `url`

Releases 的附件既可以放很大的文件，也不占用仓库体积，适合长期维护。
