# 光匣 Lumina

本仓库是 Lumina 本地照片/视频管理器的开发仓库。当前完成 M0，正在实现 M1 的本地图库核心能力。

## 开发环境

- Node.js 20+
- pnpm 11+
- Windows 原生依赖需要可用的 Visual Studio C++ Build Tools（better-sqlite3）

## 常用命令

```text
pnpm install
pnpm typecheck
pnpm test
pnpm m0:verify
pnpm m1:verify
pnpm --filter @lumina/core-host start
pnpm --filter @lumina/core-host start:stdio
pnpm --filter @lumina/desktop build
pnpm --filter @lumina/desktop dev
pnpm --filter @lumina/desktop package:portable
```

架构说明见 [`docs/architecture.md`](docs/architecture.md)，里程碑状态见 [`docs/development-status.md`](docs/development-status.md)。
