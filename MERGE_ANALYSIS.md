# 合并分析记录

## 来源仓库

- `https://github.com/qingkongganxu/video-auto-download.git`
- `https://github.com/qingkongganxu/-.git`

## 分析结论

`video-auto-download` 是较早主线，内容更新到 `自动下载8.10.js`。

`-.git` 已经包含 `video-auto-download` 的 8.5 到 8.10 版本脚本、Node.js 同源资源爬虫、测试和修改记录，并额外包含：

- `自动下载8.11.js`
- 更新后的 `asmrmoon-audio-downloader.user.js`
- 更新后的 `CHANGELOG.md`
- `apk-analysis/apk_analysis_summary.md`
- 云端合并历史相关资料

文件哈希对比显示，两个仓库中重叠的 `src/`、`test/`、`package.json`、`package-lock.json`、`自动下载8.5.js` 到 `自动下载8.10.js` 内容一致。

因此新仓库 `video` 以 `-.git` 的最新内容作为合并基底，保留全部版本脚本和 APK 分析资料，并重写 README 说明合并后的项目结构。

## 保留策略

- 保留最新主脚本：`asmrmoon-audio-downloader.user.js`
- 保留最新命名版本：`自动下载8.11.js`
- 保留历史命名版本：`自动下载8.5.js` 到 `自动下载8.10.js`
- 保留 CLI 源码：`src/`
- 保留测试：`test/`
- 保留变更记录：`CHANGELOG.md`
- 保留 APK 分析资料：`apk-analysis/`

## 未合并内容

未复制两个源仓库的 `.git/` 目录。新仓库 `video` 使用新的 Git 历史，来源关系通过本文档记录。
