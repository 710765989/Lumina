# Lumina 开发状态

当前开发基线是 UI 0.8，对应开发里程碑为 M0/M1。版本号只用于设计交付物，开发阶段的小修订继续使用小版本号，不因每次代码变更频繁升版。

## M0：已完成

- pnpm workspace、TypeScript、core-host、contracts、storage、core 工程骨架。
- SQLite 初始化，启用 WAL 和外键约束。
- media、albums、album_media、tags、media_tags、settings、tasks 基础表。
- 递归扫描目录，识别常见照片和视频格式。
- 媒体路径稳定 ID、文件指纹、扫描任务进度和完成状态。
- M0 验证脚本覆盖临时图库扫描、SQLite 入库、任务完成和外键检查。

验证命令：

```text
pnpm typecheck
pnpm test
pnpm m0:verify
```

## M1：开发完成，已生成 Windows 未安装包验证目录

- 目录根管理：新增、启停、移除和批量扫描入口。
- 媒体索引：按修改时间分页浏览，支持隐藏状态。
- 普通相册：创建、编辑描述、删除、加入/移除媒体和手动/默认封面。
- 标签：创建、删除和批量设置媒体标签。
- 搜索：文件路径/类型的 FTS5 搜索，并支持按标签名称匹配。
- 隐藏媒体：基础隐藏/恢复模型；从索引移除会保留用户文件，文件删除、回收站和跨设备同步留到后续里程碑。
- 桌面端基础交互：Electron + React + Vite、目录选择/启停/移除、core-host IPC、媒体列表/搜索、相册编辑/删除/加入/移出/封面、批量添加/移除标签。
- Windows x64 未安装包目录可由 `pnpm --filter @lumina/desktop package:dir` 生成；流程使用 workspace 外部 staging 目录，打包时会隔离重建 better-sqlite3 原生依赖并内置 core-host bundle，不影响日常 Node 测试。
- Windows portable 单文件可由 `pnpm --filter @lumina/desktop package:portable` 生成，适合直接双击启动。

## 后续里程碑边界

账号、私有相册、端到端加密、手机端上传、Web 访问、分享、智能相册计算和备份恢复不属于当前 M0/M1 实现范围。

## M2：媒体呈现

- 缩略图生成、缓存和重建任务。
- 桌面端媒体网格与媒体详情预览。
- 照片大图查看、视频播放和基础加载失败状态。
- 媒体预览任务的进度、暂停、失败重试和恢复。
