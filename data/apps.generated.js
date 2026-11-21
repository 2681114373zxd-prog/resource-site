/* 由 scripts/build.mjs 自动生成，请勿手动修改。
   数据来源：data/site.json + data/categories.json + data/apps.json
   生成时间：2026-11-20T00:00:00.000Z */
window.SITE_DATA = {
  "generatedAt": "2026-11-20T00:00:00.000Z",
  "site": {
    "name": "Xixi",
    "nameCn": "Xixi 软件站",
    "tagline": "我自己制作与整理的软件、安装包与资源合集",
    "description": "Xixi 是一个个人软件与资源下载站，收集我自己制作、整理、汉化或常用的软件安装包，提供版本、更新时间、文件大小、更新日志与多平台下载。",
    "keywords": [
      "软件下载",
      "安装包",
      "资源站",
      "开源软件",
      "Windows",
      "Android",
      "Linux",
      "macOS"
    ],
    "url": "https://xdzhu-apps.cloudzyro.app",
    "author": "xdzhu",
    "email": "",
    "github": "https://github.com/2681114373zxd-prog/resource-site",
    "contact": {
      "email": "",
      "telegram": "",
      "qq": ""
    },
    "theme": {
      "accent": "#4f7cff",
      "accent2": "#7c5cff"
    },
    "footerNote": "本站仅收录个人整理与开源软件资源，所有文件版权归原作者所有。",
    "buildInfo": true
  },
  "categories": {
    "all": {
      "slug": "all",
      "name": "全部"
    },
    "items": [
      {
        "slug": "windows",
        "name": "Windows"
      },
      {
        "slug": "android",
        "name": "Android"
      },
      {
        "slug": "linux",
        "name": "Linux"
      },
      {
        "slug": "macos",
        "name": "macOS"
      },
      {
        "slug": "tools",
        "name": "工具"
      },
      {
        "slug": "other",
        "name": "其他"
      }
    ]
  },
  "apps": [
    {
      "id": "7zip",
      "name": "7-Zip",
      "tagline": "免费开源的高压缩率压缩 / 解压工具",
      "description": "7-Zip 是一款完全免费、开源的压缩 / 解压工具，支持 7z、zip、rar、tar、gz 等格式。\n\n本站的安装包全部指向 7-Zip 官方 GitHub Releases 直链，点开即下载：\n\n- 7z 格式压缩率高，适合长期归档\n- 自带 Windows 右键菜单\n- 无广告、免费、开源\n- Windows x64 / ARM64 / 32 位，Linux x64 / ARM64 命令行版",
      "icon": "",
      "category": "工具",
      "platforms": [
        "Windows",
        "Linux"
      ],
      "tags": [
        "压缩",
        "解压",
        "开源",
        "免费",
        "7z"
      ],
      "version": "26.06",
      "releaseDate": "2026-11-07",
      "updated": "2026-11-07",
      "size": "约1.6 MB",
      "license": "LGPL-2.1(部分BSD/unrar限制)",
      "homepage": "https://www.7-zip.org/",
      "repo": "https://github.com/ip7z/7zip",
      "requirements": [
        "Windows7/8/10/11",
        "支持x86/x64/ARM64",
        "Linux x64/ARM64/ARM32位(命令行版本)"
      ],
      "featured": true,
      "downloads": [
        {
          "name": "Windows x64 安装版",
          "url": "https://github.com/ip7z/7zip/releases/download/26.06/7z2606-x64.exe",
          "size": "约1.6 MB",
          "platform": "Windows",
          "arch": "x64",
          "type": "installer"
        },
        {
          "name": "Windows ARM64 安装版",
          "url": "https://github.com/ip7z/7zip/releases/download/26.06/7z2606-arm64.exe",
          "size": "约1.5 MB",
          "platform": "Windows",
          "arch": "arm64",
          "type": "installer"
        },
        {
          "name": "Windows 32 位安装版",
          "url": "https://github.com/ip7z/7zip/releases/download/26.06/7z2606.exe",
          "size": "约1.3 MB",
          "platform": "Windows",
          "arch": "x86",
          "type": "installer"
        },
        {
          "name": "Windows x64 MSI",
          "url": "https://github.com/ip7z/7zip/releases/download/26.06/7z2606-x64.msi",
          "size": "约1.9 MB",
          "platform": "Windows",
          "arch": "x64",
          "type": "installer"
        },
        {
          "name": "Linux x64 命令行版",
          "url": "https://github.com/ip7z/7zip/releases/download/26.06/7z2606-linux-x64.tar.xz",
          "size": "约1.5 MB",
          "platform": "Linux",
          "arch": "x64",
          "type": "archive"
        },
        {
          "name": "Linux ARM64 命令行版",
          "url": "https://github.com/ip7z/7zip/releases/download/26.06/7z2606-linux-arm64.tar.xz",
          "size": "约1.3 MB",
          "platform": "Linux",
          "arch": "arm64",
          "type": "archive"
        },
        {
          "name": "官方全部下载",
          "url": "https://github.com/ip7z/7zip/releases/latest",
          "size": "-",
          "platform": "全平台",
          "arch": "",
          "type": "link"
        }
      ],
      "changelog": [
        {
          "version": "26.06",
          "date": "2026-11-07",
          "notes": [
            "更新至 7-Zip 26.06（GitHub 官方发布）",
            "Windows x64 / ARM64 / x86 安装包与 MSI",
            "Linux x64 / ARM64 命令行版直链"
          ]
        }
      ],
      "history": []
    },
    {
      "id": "umi-ocr",
      "name": "Umi-OCR",
      "tagline": "免费开源的离线批量 OCR 文字识别工具",
      "description": "Umi-OCR 是一款免费开源的离线批量 OCR 文字识别工具，截图、批量图片、PDF 都能识别，全程不联网。\n\n本站的安装包指向官方 GitHub Releases 直链：\n\n- 离线识别，不上传图片\n- 批量处理、忽略区域、公式识别\n- Windows Rapid（体积小）/ Paddle（精度高）\n- 另有 Linux Paddle 版",
      "icon": "",
      "category": "工具",
      "platforms": [
        "Windows"
      ],
      "tags": [
        "OCR",
        "文字识别",
        "离线",
        "中文",
        "开源"
      ],
      "version": "2.1.5",
      "releaseDate": "2025-03-25",
      "updated": "2025-03-25",
      "size": "约99 MB",
      "license": "MIT",
      "homepage": "https://github.com/hiroi-sora/Umi-OCR",
      "repo": "https://github.com/hiroi-sora/Umi-OCR",
      "requirements": [
        "Windows 7 x64 及以上",
        "建议 4 GB 以上内存"
      ],
      "featured": false,
      "downloads": [
        {
          "name": "Windows Rapid 版（推荐）",
          "url": "https://github.com/hiroi-sora/Umi-OCR/releases/download/v2.1.5/Umi-OCR_Rapid_v2.1.5.7z.exe",
          "size": "约99 MB",
          "platform": "Windows",
          "arch": "x64",
          "type": "installer"
        },
        {
          "name": "Windows Paddle 版",
          "url": "https://github.com/hiroi-sora/Umi-OCR/releases/download/v2.1.5/Umi-OCR_Paddle_v2.1.5.7z.exe",
          "size": "约128 MB",
          "platform": "Windows",
          "arch": "x64",
          "type": "installer"
        },
        {
          "name": "Linux Paddle 版",
          "url": "https://github.com/hiroi-sora/Umi-OCR/releases/download/v2.1.5/Umi-OCR_Linux_Paddle_2.1.5.tar.xz",
          "size": "约265 MB",
          "platform": "Linux",
          "arch": "x64",
          "type": "archive"
        },
        {
          "name": "官方全部下载",
          "url": "https://github.com/hiroi-sora/Umi-OCR/releases/latest",
          "size": "-",
          "platform": "全平台",
          "arch": "",
          "type": "link"
        }
      ],
      "changelog": [
        {
          "version": "2.1.5",
          "date": "2025-03-25",
          "notes": [
            "Umi-OCR 2.1.5（GitHub 官方发布）",
            "Windows Rapid / Paddle 与 Linux Paddle 直链",
            "离线批量 OCR，无需联网"
          ]
        }
      ],
      "history": []
    },
    {
      "id": "obs-studio",
      "name": "OBS Studio",
      "tagline": "开源免费的录屏与直播推流软件",
      "description": "OBS Studio 是一款开源免费的录屏、直播推流与视频采集软件。\n\n本站的安装包全部指向 OBS 官方 GitHub Releases 直链（Installer / 便携 zip / dmg / deb）：\n\n- 录屏与直播推流\n- 窗口 / 游戏 / 摄像头采集，虚拟摄像头\n- 支持 Windows / macOS（Apple 芯片与 Intel）/ Ubuntu\n- 插件生态丰富",
      "icon": "",
      "category": "其他",
      "platforms": [
        "Windows",
        "macOS",
        "Linux"
      ],
      "tags": [
        "录屏",
        "直播",
        "推流",
        "开源",
        "视频"
      ],
      "version": "33.0.2",
      "releaseDate": "2026-11-20",
      "updated": "2026-11-20",
      "size": "约185 MB",
      "license": "GPL-2.0",
      "homepage": "https://obsproject.com/",
      "repo": "https://github.com/obsproject/obs-studio",
      "requirements": [
        "Windows 10 / 11",
        "macOS 13.0 及以上",
        "Linux"
      ],
      "featured": true,
      "downloads": [
        {
          "name": "Windows x64 安装版",
          "url": "https://github.com/obsproject/obs-studio/releases/download/33.0.2/OBS-Studio-33.0.2-Windows-x64-Installer.exe",
          "size": "约185 MB",
          "platform": "Windows",
          "arch": "x64",
          "type": "installer"
        },
        {
          "name": "Windows x64 便携版",
          "url": "https://github.com/obsproject/obs-studio/releases/download/33.0.2/OBS-Studio-33.0.2-Windows-x64.zip",
          "size": "约225 MB",
          "platform": "Windows",
          "arch": "x64",
          "type": "archive"
        },
        {
          "name": "macOS Apple 芯片版",
          "url": "https://github.com/obsproject/obs-studio/releases/download/33.0.2/OBS-Studio-33.0.2-macOS-Apple.dmg",
          "size": "约200 MB",
          "platform": "macOS",
          "arch": "arm64",
          "type": "installer"
        },
        {
          "name": "macOS Intel 版",
          "url": "https://github.com/obsproject/obs-studio/releases/download/33.0.2/OBS-Studio-33.0.2-macOS-Intel.dmg",
          "size": "约211 MB",
          "platform": "macOS",
          "arch": "x64",
          "type": "installer"
        },
        {
          "name": "Ubuntu 26.04 x86_64 安装包",
          "url": "https://github.com/obsproject/obs-studio/releases/download/33.0.2/OBS-Studio-33.0.2-Ubuntu-26.04-x86_64.deb",
          "size": "约152 MB",
          "platform": "Linux",
          "arch": "x64",
          "type": "installer"
        },
        {
          "name": "官方全部下载",
          "url": "https://github.com/obsproject/obs-studio/releases/latest",
          "size": "-",
          "platform": "全平台",
          "arch": "",
          "type": "link"
        }
      ],
      "changelog": [
        {
          "version": "33.0.2",
          "date": "2026-11-20",
          "notes": [
            "更新至 OBS Studio 33.0.2（GitHub 官方发布）",
            "Windows / macOS / Ubuntu 安装包全部直链",
            "旧的 32.2.2 下载地址已失效，全部换到官方 Releases"
          ]
        }
      ],
      "history": []
    },
    {
      "id": "termux",
      "name": "Termux",
      "tagline": "Android上的Linux终端模拟器",
      "description": "Termux 在安卓手机上提供完整的 Linux 命令行环境，可以装 Python、Git、Node.js、SSH 等工具。\n\n本站提供官方 GitHub Releases 的 APK 直链，按手机架构选一个就行：\n\n- 不需要 root 权限\n- 支持 pkg / apt 包管理器\n- 可运行 shell、Python 等程序\n- 适合手机开发、SSH 与脚本运行\n\n注意：F-Droid、GitHub、Google Play 三个渠道签名不同，不要混装。",
      "icon": "",
      "category": "Android",
      "platforms": [
        "Android"
      ],
      "tags": [
        "终端",
        "Linux",
        "命令行",
        "开源",
        "开发"
      ],
      "version": "0.118.3",
      "releaseDate": "2025-05-22",
      "updated": "2025-05-22",
      "size": "约112 MB",
      "license": "GPL-3.0",
      "homepage": "https://termux.dev/",
      "repo": "https://github.com/termux/termux-app",
      "requirements": [
        "Android7.0及以上",
        "支持ARM64/ARMv7/x86/x86_64"
      ],
      "featured": false,
      "downloads": [
        {
          "name": "通用版 APK（推荐）",
          "url": "https://github.com/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3%2Bgithub-debug_universal.apk",
          "size": "约112 MB",
          "platform": "Android",
          "arch": "universal",
          "type": "installer"
        },
        {
          "name": "arm64-v8a APK",
          "url": "https://github.com/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3%2Bgithub-debug_arm64-v8a.apk",
          "size": "约34 MB",
          "platform": "Android",
          "arch": "arm64",
          "type": "installer"
        },
        {
          "name": "armeabi-v7a APK",
          "url": "https://github.com/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3%2Bgithub-debug_armeabi-v7a.apk",
          "size": "约31 MB",
          "platform": "Android",
          "arch": "arm",
          "type": "installer"
        },
        {
          "name": "x86_64 APK",
          "url": "https://github.com/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3%2Bgithub-debug_x86_64.apk",
          "size": "约34 MB",
          "platform": "Android",
          "arch": "x64",
          "type": "installer"
        },
        {
          "name": "官方全部下载",
          "url": "https://github.com/termux/termux-app/releases/latest",
          "size": "-",
          "platform": "全平台",
          "arch": "",
          "type": "link"
        }
      ],
      "changelog": [
        {
          "version": "0.118.3",
          "date": "2025-05-22",
          "notes": [
            "Termux 0.118.3（GitHub 官方发布）",
            "通用版 / arm64-v8a / armeabi-v7a / x86_64 四种 APK 直链",
            "支持 Android 7.0 及以上"
          ]
        }
      ],
      "history": []
    }
  ]
};
