# 第三方组件与数据

Lumina 使用以下主要组件。项目源码许可证与第三方许可证分开；本清单不更改任何第三方授权条件。

| 组件 | 用途 | 上游许可证 / 来源 |
| --- | --- | --- |
| Electron / Chromium / Node.js | 桌面与浏览器运行时 | Electron MIT，Chromium/Node.js 及附带组件见运行包 `LICENSE`、`LICENSES.chromium.html` |
| React / React DOM | 界面 | MIT，https://github.com/facebook/react |
| better-sqlite3 / SQLite | 本地数据库 | better-sqlite3 MIT，SQLite 公有领域，https://github.com/WiseLibs/better-sqlite3 |
| sharp / libvips | 图片缩略图与处理 | sharp Apache-2.0；libvips LGPL-2.1-or-later，具体二进制依赖见 sharp 上游，https://github.com/lovell/sharp |
| ffmpeg-static / FFmpeg | 视频元数据、缩略图与兼容预览 | ffmpeg-static GPL-3.0-or-later；实际 FFmpeg 编译选项与许可证以运行包中的 `ffmpeg-version.txt`、`ffmpeg-license.txt` 为准，https://github.com/eugeneware/ffmpeg-static ，https://ffmpeg.org/ |
| pinyin-pro | 标签拼音检索 | MIT，https://github.com/zh-lx/pinyin-pro |
| GeoNames 城市数据 | 离线附近城市匹配 | CC BY 4.0，见 [GeoNames 说明](packages/core/src/data/LICENSE-GeoNames.md) |

GeoNames 数据经过字段精简及离线 JSON 转换，来源和修改方式在随附说明中记录。城市匹配为附近城市估计，不作为行政边界判定。

运行包保留 Electron 的许可文件，并在 `resources/third-party/` 随附本次构建的运行依赖许可证、FFmpeg 版本/构建信息和上游地址。自行构建发行版时，也应保留所采用二进制及依赖的许可说明。

## 日语读音

Kuromoji 0.1.2（Apache-2.0，https://github.com/takuyaa/kuromoji.js）使用 mecab-ipadic-2.7.0-20070801 词典。发行包 dist/japanese-dict 随附 LICENSE-2.0.txt、完整 NOTICE.md（NAIST / ICOT 条款）及 async、doublearray、lodash、zlibjs 的 MIT 许可证。词典仅用于离线读音，不提供翻译。
