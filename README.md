# video

这是由两个仓库合并整理后的音视频下载工具仓库：

- `qingkongganxu/video-auto-download.git`
- `qingkongganxu/-.git`

合并后的主线保留最新 userscript、历史版本脚本、同源资源爬虫 CLI、测试用例、修改记录，以及云端同步过来的 APK 分析资料。

## 主脚本

推荐使用仓库根目录的 `asmrmoon-audio-downloader.user.js`，它和当前最新命名版本 `自动下载8.11.js` 内容一致。

脚本能力概览：

- ASMRMOON 目录/全站音视频扫描与批量下载。
- MP3、MP4、m3u8 自动识别并统一进入下载队列。
- m3u8 尽量合并为 MP4。
- 并发下载，默认 5，最高 20。
- 下载速度、总进度、失败重试、最终重试、暂停/恢复。
- 低内存目录保存模式，支持按分类和小目录写入本地文件夹。
- 通用页面媒体扫描，只处理当前页面已经明文暴露且当前会话可访问的媒体链接。

脚本不绕过登录、付费墙、DRM、反盗链、网站限速或其它访问控制。

## 历史版本

根目录保留 `自动下载8.5.js` 到 `自动下载8.11.js`，方便回退或对比。

详细修改记录见 [CHANGELOG.md](CHANGELOG.md)。

## 同源资源爬虫 CLI

仓库同时包含 Node.js CLI，用于在同源范围内发现和下载公开资源。

安装依赖：

```bash
npm install
```

如需渲染 JavaScript 页面，安装 Playwright Chromium：

```bash
npm run install:browsers
```

使用示例：

```bash
npm run crawl -- --url https://example.com --depth 2 --max-pages 200 --out downloads
```

常用参数：

```bash
--url <url>            入口 URL，必填
--depth <n>            爬取深度，默认 2
--max-pages <n>        最大同源页面数，默认 200
--out <dir>            输出目录，默认 downloads
--concurrency <n>      并发数，默认 4
--timeout <ms>         请求超时，默认 30000
--no-browser           禁用 Playwright 渲染
--manifest-only        只写 manifest，不下载文件
```

输出结构：

```text
downloads/<domain>/
  images/
  videos/
  audios/
  documents/
  streams/
  manifest.json
  manifest.csv
```

## 合并说明

本次合并分析见 [MERGE_ANALYSIS.md](MERGE_ANALYSIS.md)。

## APK 分析资料

云端同步过来的 APK 分析资料位于 [apk-analysis/apk_analysis_summary.md](apk-analysis/apk_analysis_summary.md)。
