# README 演示素材

- `gallery-browsing.gif`：实际应用中的缩略图大小调整，以及默认/时间/瀑布视图切换。
- `tag-search.gif`：通过拼音首字母查找标签，组合文件名条件，再清除搜索条件。

两段动图由 `scripts/record-readme-demos.mjs` 在独立测试用户目录录制。示例媒体为脚本生成的风景插画，标签与文件名均为测试内容；无需下载素材，不使用开发者的真实图库。录制完成后退出测试实例。

重新录制需已构建的 Windows EXE 和 Playwright：设置 `LUMINA_QA_ROOT` 为可写隔离目录、`LUMINA_PLAYWRIGHT_PATH` 为 Playwright 模块路径，然后在源码根目录运行：

```powershell
node scripts/record-readme-demos.mjs <Lumina.exe的绝对路径>
```

脚本会替换本目录这两个演示 GIF，原始截图与隔离数据库保留在 QA 目录供核验，不纳入源码导出。GIF 为1080像素宽、12 FPS压缩展示，不表示应用的实际渲染帧率或大图库性能。
