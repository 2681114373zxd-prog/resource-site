# data/ · 数据目录速查

这里存放网站的**全部内容数据**。日常维护基本只需要动 `apps.json`；
`site.json` 改站点信息，`categories.json` 改分类。

> 改完任意一个文件后：本地跑 `npm run dev`（或 `npm run build`）即可看到效果。
> `npm run check` 会帮你检查常见的写错（id 重复、下载文件不存在、缺少必填字段等）。

## 文件说明

| 文件 | 是否手改 | 说明 |
| --- | --- | --- |
| `site.json` | ✅ 手改 | 站点名称、简介、网址、作者、联系方式、主题色 |
| `categories.json` | ✅ 手改 | 首页的分类筛选按钮 |
| `apps.json` | ✅ 手改 | 所有软件的数据（重点） |
| `apps.generated.js` | ❌ 自动生成 | `npm run build` 把上面三个文件打包给浏览器用，**不要手改** |

## JSON 书写注意

1. JSON 不能写注释，不能在最后一项结尾多写逗号（这是新手最常见的错误）。
2. 字符串必须用**英文双引号** `"`，不能用中文引号 `“”`。
3. 数组用 `[]`，对象用 `{}`；换行和缩进不影响结果，但保持整齐方便你以后看。
4. 日期统一写 `YYYY-MM-DD`，例如 `"2026-09-19"`。
5. 写完保存后如果网站没变化，先看终端（`npm run dev` 的窗口）有没有报错信息，它会指出第几条数据有问题。

## 最小可用示例

只想加一个「Windows 安装包 + 官方直链」的软件时，最少写这些字段就够了：

```json
{
  "id": "mytool",
  "name": "MyTool",
  "tagline": "一句话介绍",
  "category": "工具",
  "platforms": ["Windows"],
  "version": "1.0.0",
  "updated": "2026-09-19",
  "downloads": [
    {
      "name": "Windows x64",
      "url": "https://example.com/mytool-1.0.0-x64.exe",
      "size": "42 MB",
      "platform": "Windows",
      "arch": "x64",
      "type": "installer"
    }
  ]
}
```

其余字段（`description`、`icon`、`repo`、`requirements`、`changelog`、`history` 等）
都是可选的，不写也能正常运行，写全了页面更好看、信息更完整。

字段的完整说明见项目根目录 `README.md` 的「五、数据字段说明」。
