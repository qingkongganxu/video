// ==UserScript==
// @name         Universal Media Downloader
// @name:zh-CN   通用音视频批量下载器
// @namespace    local.codex.asmrmoon-audio-downloader
// @version      8.7
// @description  Batch scan and download accessible audio, video and m3u8 media files from ASMRMOON or generic pages without bypassing access controls.
// @description:zh-CN 支持 ASMRMOON 目录扫描和通用网页明文媒体链接扫描，并发批量下载音频、视频和 m3u8，显示速度，支持分类文件夹和低内存目录保存。
// @author       Codex
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @require      https://cdnjs.cloudflare.com/ajax/libs/mux.js/6.3.0/mux.min.js
// @connect      asmrmoon.com
// @connect      mooncdn.asmrmoon.com
// @connect      *
// ==/UserScript==

// 更新内容 8.7：
// 1. 调整失败重试策略：单个任务即时重试 3 次仍失败后不再立刻放弃，而是标记为“暂时放弃”。
// 2. 普通队列会继续优先下载后面的任务，等其它可下载任务都结束后，再统一处理暂时放弃队列。
// 3. 暂时放弃队列中的任务最后会再重试 5 次，仍失败才正式计为失败项目。
// 4. 任务状态显示新增“暂时放弃/最终重试”，总失败数只统计最终仍失败的任务。
// 5. 本文件命名为“自动下载8.7.js”，后续继续沿用“自动下载8.x.js”命名。
// 更新内容 8.6：
// 1. 修正小目录创建条件：大目录下直接显示的第一层文件不再创建小目录，直接保存到大目录文件夹。
// 2. 只有小目录打开后检测到的第二层文件，才会按“大目录（共N个）/小目录标题/文件名”保存。
// 3. 小目录标题只从真实路径层级识别，不再从文件名第 3 段强行兜底，避免误把第一层文件名当作小目录。
// 4. 本文件命名为“自动下载8.6.js”，后续继续沿用“自动下载8.x.js”命名。
// 更新内容 8.5：
// 1. 新增小目录文件夹：下载路径会按“大目录（共N个）/小目录标题/文件名”保存。
// 2. 小目录标题优先从 ASMRMOON 路径层级自动识别，识别不到时从文件名第 3 段标题兜底提取。
// 3. 下载前查重、任务列表文件夹标记、m3u8 转 MP4 输出都会使用包含小目录的完整保存路径。
// 4. 本文件命名为“自动下载8.5.js”，后续继续沿用“自动下载8.x.js”命名。
// 更新内容 8.4：
// 1. 新增通用站点适配器：非 ASMRMOON 网站会扫描当前页面 DOM、meta、JSON-LD、performance 资源中已明文暴露的媒体链接。
// 2. ASMRMOON 继续使用原 AList 接口适配器，保留全站/目录扫描能力；其它网站只扫描当前页面可直接访问的媒体 URL。
// 3. 通用适配器只处理当前会话正常可访问的 mp3/mp4/m3u8 等直链，不绕过登录、DRM、反盗链、限速或其它访问控制。
// 4. 本文件命名为“自动下载8.4.js”，后续继续沿用“自动下载8.x.js”命名。
// 5. 通用页面按发现顺序显示和入队，导出文件名与界面文案改为通用媒体下载。
// 更新内容 8.3：
// 1. 下载当前列表前会扫描已选择/授权的保存目录，递归查找同名音视频文件。
// 2. 命中同名文件时自动标记为“已跳过”，不进入下载队列；m3u8 按最终 MP4 文件名判断。
// 3. 普通直链模式也会尽量请求选择目录用于查重；浏览器不支持目录读取时会提示无法自动查重。
// 更新内容 v0.8.0：
// 1. 新增下载失败自动重连：单个任务失败后最多自动重试 3 次，仍失败才放弃。
// 2. 重做强制命名：每个任务按扫描列表计算最终保存名，下载名与条目一一对应。
// 3. 新增勾选下载：每个条目前有复选框，支持当前列表全选、反选。
// 4. 新增暂停/恢复：支持总暂停、总恢复，以及单个任务暂停、恢复。
// 5. m3u8 输出改为 MP4；TS 分片通过 mux.js 转封装为 MP4，fMP4 分片直接合并为 MP4。
// 6. 重做分类文件夹：按文件名第 1、2 个 “-” 中间的分类名保存到“分类名（共N个）”文件夹。
// 7. 并发调度改为前序优先：多个并发同时下载时始终优先领取靠前且未暂停的任务。
// 8. 不绕过网站限速；脚本只去掉自身额外等待，并对 429/403/5xx 等失败做退避重试。
// 更新内容 v0.8.1：
// 1. 修复勾选/取消勾选下载项时列表滚动位置跳到顶部的问题。
// 更新内容 8.2：
// 1. 重新强化 MP3/MP4 强制命名：强制命名模式在需要 MP4 或分类文件夹时优先写入所选本地目录，确保文件名与任务一一对应。
// 2. 新增“勾选MP3”“勾选MP4”按钮，可一键只勾选当前列表中的 MP3 或 MP4 下载项。
// 3. 输出文件命名方式沿用“自动下载8.x”，本文件为“自动下载8.3.js”。

(function asmrmoonAudioDownloader() {
  'use strict';

  if (window.__asmrmoonAudioDownloaderLoaded) return;
  window.__asmrmoonAudioDownloaderLoaded = true;

  const API_BASE = `${location.origin}/api`;
  const APP_ID = 'asmrmoon-audio-downloader';
  const PAGE_SIZE = 200;
  const DOWNLOAD_DELAY_MS = 0;
  const DEFAULT_DOWNLOAD_CONCURRENCY = 5;
  const MAX_DOWNLOAD_CONCURRENCY = 20;
  const MAX_DOWNLOAD_RETRIES = 3;
  const FINAL_DOWNLOAD_RETRIES = 5;
  const RETRY_BASE_DELAY_MS = 1200;
  const PROGRESS_RENDER_MS = 250;
  const MAX_NAME_LENGTH = 190;
  const M3U8_SEGMENT_CONCURRENCY = 3;
  const M3U8_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
  const MEDIA_URL_PATTERN = /\.(?:aac|aif|aiff|alac|amr|au|flac|m4a|m4b|mka|mp3|oga|ogg|opus|wav|weba|wma|mp4|m4v|mov|webm|mkv|m3u8)(?:$|[?#])/i;
  const AUDIO_EXTENSIONS = new Set([
    'aac',
    'aif',
    'aiff',
    'alac',
    'amr',
    'au',
    'flac',
    'm4a',
    'm4b',
    'mka',
    'mmf',
    'mp3',
    'oga',
    'ogg',
    'opus',
    'wav',
    'weba',
    'wma',
  ]);
  const M3U8_EXTENSIONS = new Set(['m3u8']);
  const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv']);

  const state = {
    items: new Map(),
    selectedPaths: new Set(),
    pausedPaths: new Set(),
    filter: '',
    scanning: false,
    downloading: false,
    globalPaused: false,
    stopScan: false,
    stopDownload: false,
    scannedDirs: 0,
    scannedFiles: 0,
    failedDirs: 0,
    downloadDone: 0,
    downloadSkipped: 0,
    downloadFailed: 0,
    downloadTotal: 0,
    downloadActive: 0,
    downloadBytesLoaded: 0,
    downloadBytesTotal: 0,
    downloadSpeed: 0,
    downloadConcurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
    downloadTasks: new Map(),
    lastProgressRender: 0,
    status: '等待扫描',
    rootPath: '/',
    adapterName: '',
    nameMode: 'full',
    downloadMode: 'blob',
    forceFileSystemNaming: false,
    saveDirectoryHandle: null,
    saveDirectoryName: '',
  };

  const ui = {};

  function getClientId() {
    const key = 'alist_client_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
  }

  async function apiPost(endpoint, body) {
    const token = localStorage.getItem('token') || '';
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Client-Id': getClientId(),
        ...(token ? { Authorization: token } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    if (!json || json.code !== 200) {
      throw new Error((json && json.message) || 'API 返回异常');
    }
    return json.data;
  }

  async function listDir(path, page) {
    return apiPost('/fs/list', {
      path,
      password: '',
      page,
      per_page: PAGE_SIZE,
      refresh: false,
      force_global_name_sort: false,
    });
  }

  async function getFile(path) {
    return apiPost('/fs/get', {
      path,
      password: '',
    });
  }

  function isAsmrmoonSite() {
    return location.hostname === 'asmrmoon.com' || location.hostname.endsWith('.asmrmoon.com');
  }

  function adapterName() {
    return isAsmrmoonSite() ? 'ASMRMOON目录适配器' : '通用页面适配器';
  }

  function normalizePath(path) {
    let value = path || '/';
    try {
      value = decodeURIComponent(value);
    } catch (error) {
      // Keep the browser path if it is not valid percent-encoding.
    }
    value = value.replace(/\/+/g, '/');
    if (!value.startsWith('/')) value = `/${value}`;
    if (value.length > 1) value = value.replace(/\/+$/, '');
    return value || '/';
  }

  function currentPath() {
    const path = normalizePath(location.pathname);
    if (path.startsWith('/@')) return '/';
    return path;
  }

  function joinPath(parent, name) {
    const cleanParent = normalizePath(parent);
    const cleanName = String(name || '').replace(/^\/+|\/+$/g, '');
    if (!cleanName) return cleanParent;
    return cleanParent === '/' ? `/${cleanName}` : `${cleanParent}/${cleanName}`;
  }

  function parentPath(path) {
    const clean = normalizePath(path);
    if (clean === '/') return '/';
    const parts = clean.split('/');
    parts.pop();
    return parts.join('/') || '/';
  }

  function extension(name) {
    const match = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})(?:$|[?#])/);
    return match ? match[1] : '';
  }

  function mediaKindFor(item) {
    if (!item || item.is_dir) return false;
    if (item.kind) return item.kind;
    const ext = extension(item.name || item.path);
    if (M3U8_EXTENSIONS.has(ext)) return 'm3u8';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (item.type === 3) return 'audio';
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
    return '';
  }

  function isMedia(item) {
    return Boolean(mediaKindFor(item));
  }

  function encodePath(path) {
    return normalizePath(path)
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
  }

  function directUrl(item) {
    if (item && item.source === 'generic' && item.url) return item.url;
    const path = item.path || joinPath(item.parent || '/', item.name);
    const sign = item.sign ? `?sign=${encodeURIComponent(item.sign)}` : '';
    return `${location.origin}/d${encodePath(path)}${sign}`;
  }

  function downloadUrl(item) {
    return directUrl(item);
  }

  function safeNamePart(value) {
    return String(value || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function trimFileName(name) {
    if (name.length <= MAX_NAME_LENGTH) return name;
    const ext = extension(name);
    const suffix = ext ? `.${ext}` : '';
    const base = suffix ? name.slice(0, -suffix.length) : name;
    return `${base.slice(0, Math.max(20, MAX_NAME_LENGTH - suffix.length))}${suffix}`;
  }

  function displayNameFor(item) {
    if (item && item.source === 'generic') {
      return trimFileName(safeNamePart(item.name || nameFromMediaUrl(item.url || item.path) || 'media'));
    }
    const path = normalizePath(item.path || joinPath(item.parent || '/', item.name));
    const parts = path.split('/').filter(Boolean);
    if (state.nameMode === 'original') {
      return trimFileName(safeNamePart(item.name || parts.at(-1) || 'audio'));
    }
    return trimFileName(parts.map(safeNamePart).filter(Boolean).join(' - ') || safeNamePart(item.name) || 'audio');
  }

  function displayTitleParts(displayName) {
    const text = String(displayName || '').trim();
    const strictParts = text.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
    if (strictParts.length >= 3) return strictParts;
    return text.split(/\s*-\s*/).map((part) => part.trim()).filter(Boolean);
  }

  function stripKnownMediaExtension(value) {
    const text = String(value || '').trim();
    const ext = extension(text);
    if (!ext || (!AUDIO_EXTENSIONS.has(ext) && !VIDEO_EXTENSIONS.has(ext) && !M3U8_EXTENSIONS.has(ext))) return text;
    return text.replace(new RegExp(`\\.${ext}$`, 'i'), '').trim();
  }

  function categoryNameFor(displayName) {
    const parts = displayTitleParts(displayName);
    if (parts.length < 3) return '';
    return safeNamePart(parts[1]);
  }

  function pathSmallDirectoryNameFor(item, category) {
    if (!item || item.source === 'generic') return '';
    const parts = normalizePath(item.path || joinPath(item.parent || '/', item.name))
      .split('/')
      .filter(Boolean);
    const parentParts = parts.slice(0, -1);
    if (parentParts.length < 2) return '';
    let categoryIndex = category
      ? parentParts.findIndex((part) => safeNamePart(part) === category)
      : 1;
    if (categoryIndex < 0) categoryIndex = 1;
    const smallPart = parentParts[categoryIndex + 1];
    return smallPart ? safeNamePart(stripKnownMediaExtension(smallPart)) : '';
  }

  function smallDirectoryNameFor(item) {
    const displayName = item && (item.saveName || displayNameFor(item));
    const category = categoryNameFor(displayName);
    if (!category) return '';
    return pathSmallDirectoryNameFor(item, category);
  }

  function categoryCountsFor(items) {
    const counts = new Map();
    items.forEach((item) => {
      const category = categoryNameFor(item.saveName || displayNameFor(item));
      if (!category) return;
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    return counts;
  }

  function categoryFolderFor(category, counts) {
    const count = counts && counts.get(category);
    return count ? `${category}（共${count}个）` : category;
  }

  function downloadNameFor(item, counts) {
    const fileName = displayNameFor(item);
    const category = categoryNameFor(fileName);
    if (!category || !counts || !counts.has(category)) return fileName;
    const categoryFolder = categoryFolderFor(category, counts);
    const smallFolder = smallDirectoryNameFor({ ...item, saveName: fileName });
    return smallFolder ? `${categoryFolder}/${smallFolder}/${fileName}` : `${categoryFolder}/${fileName}`;
  }

  function downloadFolderFor(item, counts) {
    const category = categoryNameFor(item.saveName || displayNameFor(item));
    if (!category || !counts || !counts.has(category)) return '';
    const categoryFolder = categoryFolderFor(category, counts);
    const smallFolder = smallDirectoryNameFor(item);
    return smallFolder ? `${categoryFolder}/${smallFolder}` : categoryFolder;
  }

  function replaceDownloadExtension(name, nextExt) {
    const cleanExt = String(nextExt || '').replace(/^\.+/, '');
    const slashIndex = String(name).lastIndexOf('/');
    const prefix = slashIndex >= 0 ? `${name.slice(0, slashIndex + 1)}` : '';
    const fileName = slashIndex >= 0 ? name.slice(slashIndex + 1) : String(name);
    const dotIndex = fileName.lastIndexOf('.');
    const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    return `${prefix}${base}.${cleanExt || 'ts'}`;
  }

  function outputDownloadNameFor(item, counts) {
    const name = downloadNameFor(item, counts);
    const kind = item && item.kind ? item.kind : mediaKindFor(item);
    return kind === 'm3u8' ? replaceDownloadExtension(name, 'mp4') : name;
  }

  function downloadFileNamePart(name) {
    const parts = String(name || '').split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || '';
  }

  function duplicateKey(value) {
    const text = String(value || '');
    return (typeof text.normalize === 'function' ? text.normalize('NFC') : text).toLowerCase();
  }

  function downloadNameKey(name) {
    return duplicateKey(downloadFileNamePart(name));
  }

  function downloadPathKey(name) {
    return String(name || '')
      .split('/')
      .map(safeFileSystemPart)
      .filter(Boolean)
      .map(duplicateKey)
      .join('/');
  }

  function isOutputMediaFileName(name) {
    const ext = extension(name);
    return AUDIO_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
  }

  function mediaLabelFor(item) {
    const kind = item && item.kind ? item.kind : mediaKindFor(item);
    if (kind === 'm3u8') return 'M3U8视频';
    if (kind === 'video') return 'MP4视频';
    return '音频';
  }

  function normalizeMediaUrl(value) {
    const text = String(value || '').trim();
    if (!text || text.startsWith('blob:') || text.startsWith('data:') || text.startsWith('javascript:')) return '';
    try {
      const url = new URL(text, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function isMediaUrl(value) {
    const url = normalizeMediaUrl(value);
    return Boolean(url && MEDIA_URL_PATTERN.test(url));
  }

  function nameFromMediaUrl(url, fallback) {
    try {
      const parsed = new URL(url, location.href);
      const pathname = decodeURIComponent(parsed.pathname || '');
      const leaf = pathname.split('/').filter(Boolean).pop();
      return safeNamePart(leaf || fallback || parsed.hostname || 'media');
    } catch (error) {
      return safeNamePart(fallback || 'media');
    }
  }

  function kindFromMediaUrl(url) {
    const ext = extension(url);
    if (M3U8_EXTENSIONS.has(ext)) return 'm3u8';
    if (VIDEO_EXTENSIONS.has(ext)) return 'video';
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
    return '';
  }

  function addGenericMediaUrl(rawUrl, label, sourceHint, order) {
    const url = normalizeMediaUrl(rawUrl);
    if (!url || !isMediaUrl(url)) return;
    const kind = kindFromMediaUrl(url);
    if (!kind) return;
    const item = {
      id: url,
      path: url,
      parent: location.hostname,
      name: nameFromMediaUrl(url, label),
      kind,
      size: 0,
      modified: '',
      sign: '',
      rawUrl: url,
      url,
      source: 'generic',
      sourceHint: sourceHint || 'page',
      order: Number.isFinite(order) ? order : state.items.size,
    };
    item.saveName = displayNameFor(item);
    state.items.set(url, item);
    state.selectedPaths.add(url);
  }

  function outputExtensionForItem(item) {
    const kind = item && item.kind ? item.kind : mediaKindFor(item);
    if (kind === 'm3u8') return 'mp4';
    return extension((item && (item.name || item.path || item.saveName)) || '');
  }

  function isMp3Item(item) {
    return outputExtensionForItem(item) === 'mp3';
  }

  function isMp4Item(item) {
    return outputExtensionForItem(item) === 'mp4';
  }

  function needsStrongDirectoryNaming(items, categoryCounts) {
    return state.downloadMode === 'blob'
      && directoryModeSupported()
      && (items.some((item) => isMp3Item(item) || isMp4Item(item)) || (categoryCounts && categoryCounts.size > 0));
  }

  function shouldUseDirectoryWriter(kind) {
    return isDirectoryDownloadMode() || (state.downloadMode === 'blob' && state.forceFileSystemNaming && state.saveDirectoryHandle);
  }

  function downloadModeText() {
    if (state.downloadMode === 'blob') return '强制命名';
    if (state.downloadMode === 'browser') return '普通直链';
    if (state.downloadMode === 'directory') return '低内存目录';
    return state.downloadMode;
  }

  function directoryModeSupported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  function isDirectoryDownloadMode() {
    return state.downloadMode === 'directory';
  }

  function safeFileSystemPart(value) {
    return safeNamePart(value)
      .replace(/[. ]+$/g, '')
      .trim() || '未命名';
  }

  async function verifyDirectoryPermission(handle) {
    if (!handle) return false;
    const options = { mode: 'readwrite' };
    if (typeof handle.queryPermission === 'function') {
      const current = await handle.queryPermission(options);
      if (current === 'granted') return true;
    }
    if (typeof handle.requestPermission === 'function') {
      return (await handle.requestPermission(options)) === 'granted';
    }
    return true;
  }

  async function pickSaveDirectory() {
    if (!directoryModeSupported()) {
      throw new Error('当前浏览器不支持低内存目录保存，请使用 Chrome 或 Edge。');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    state.saveDirectoryHandle = handle;
    state.saveDirectoryName = handle.name || '已选择目录';
    state.status = `已选择保存目录：${state.saveDirectoryName}`;
    render();
    return handle;
  }

  async function ensureSaveDirectory() {
    if (!directoryModeSupported()) {
      throw new Error('当前浏览器不支持低内存目录保存，请使用 Chrome 或 Edge。');
    }
    if (!state.saveDirectoryHandle) return pickSaveDirectory();
    if (await verifyDirectoryPermission(state.saveDirectoryHandle)) {
      return state.saveDirectoryHandle;
    }
    state.saveDirectoryHandle = null;
    state.saveDirectoryName = '';
    return pickSaveDirectory();
  }

  async function createWritableForDownloadName(name) {
    const root = await ensureSaveDirectory();
    const parts = String(name || 'download')
      .split('/')
      .map(safeFileSystemPart)
      .filter(Boolean);
    const fileName = parts.pop() || 'download';
    let directory = root;
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    return fileHandle.createWritable({ keepExistingData: false });
  }

  async function scanExistingDownloadMedia(root) {
    const existing = {
      names: new Set(),
      paths: new Set(),
      count: 0,
    };

    async function walk(directory, prefixParts) {
      for await (const [entryName, entryHandle] of directory.entries()) {
        if (state.stopDownload) return;
        const safeEntryName = safeFileSystemPart(entryName);

        if (entryHandle.kind === 'directory') {
          await walk(entryHandle, [...prefixParts, safeEntryName]);
          continue;
        }

        if (entryHandle.kind !== 'file' || !isOutputMediaFileName(entryName)) continue;
        existing.count += 1;
        existing.names.add(duplicateKey(entryName));
        existing.paths.add([...prefixParts, safeEntryName].map(duplicateKey).join('/'));

        if (existing.count % 200 === 0) {
          state.status = `正在扫描保存目录：已发现 ${existing.count} 个音视频`;
          render();
          await sleep(0);
        }
      }
    }

    await walk(root, []);
    return existing;
  }

  function existingDownloadMatchesName(existing, outputName) {
    const pathKey = downloadPathKey(outputName);
    const nameKey = downloadNameKey(outputName);
    return Boolean((pathKey && existing.paths.has(pathKey)) || (nameKey && existing.names.has(nameKey)));
  }

  function readableSize(size) {
    const value = Number(size || 0);
    if (!value) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = value;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) {
      amount /= 1024;
      index += 1;
    }
    return `${amount.toFixed(index ? 2 : 0)} ${units[index]}`;
  }

  function readableTransferSize(size) {
    const value = Number(size || 0);
    return value > 0 ? readableSize(value) : '0 B';
  }

  function readableSpeed(bytesPerSecond) {
    const value = Number(bytesPerSecond || 0);
    return value > 0 ? `${readableSize(value)}/s` : '-';
  }

  function clampDownloadConcurrency(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_DOWNLOAD_CONCURRENCY;
    return Math.min(MAX_DOWNLOAD_CONCURRENCY, Math.max(1, parsed));
  }

  function addMedia(item, parent) {
    const path = normalizePath(item.path || joinPath(parent, item.name));
    const media = {
      id: path,
      path,
      parent: parentPath(path),
      name: item.name || path.split('/').pop() || 'audio',
      kind: mediaKindFor(item),
      size: item.size || 0,
      modified: item.modified || '',
      sign: item.sign || '',
      rawUrl: item.raw_url || '',
      url: directUrl({ ...item, path }),
    };
    media.saveName = displayNameFor(media);
    state.items.set(path, media);
    state.selectedPaths.add(path);
  }

  function visibleItems() {
    const query = state.filter.trim().toLowerCase();
    const items = Array.from(state.items.values()).map((item) => ({
      ...item,
      saveName: displayNameFor(item),
    }));

    return items
      .filter((item) => {
        if (!query) return true;
        return [item.path, item.name, item.saveName, item.parent, item.kind, item.url, item.sourceHint].join(' ').toLowerCase().includes(query);
      })
      .sort((a, b) => {
        if (a.source === 'generic' || b.source === 'generic') {
          return Number(a.order || 0) - Number(b.order || 0);
        }
        return a.path.localeCompare(b.path, 'zh-Hans-CN');
      });
  }

  function selectedVisibleItems() {
    return visibleItems().filter((item) => state.selectedPaths.has(item.path));
  }

  function setVisibleSelection(selected) {
    visibleItems().forEach((item) => {
      if (selected) {
        state.selectedPaths.add(item.path);
      } else {
        state.selectedPaths.delete(item.path);
      }
    });
    render();
  }

  function invertVisibleSelection() {
    visibleItems().forEach((item) => {
      if (state.selectedPaths.has(item.path)) {
        state.selectedPaths.delete(item.path);
      } else {
        state.selectedPaths.add(item.path);
      }
    });
    render();
  }

  function selectVisibleByOutputType(type) {
    const expected = String(type || '').toLowerCase();
    visibleItems().forEach((item) => {
      if (outputExtensionForItem(item) === expected) {
        state.selectedPaths.add(item.path);
      } else {
        state.selectedPaths.delete(item.path);
      }
    });
    render();
  }

  function collectUrlsFromValue(value, out) {
    if (!value) return;
    if (typeof value === 'string') {
      const direct = normalizeMediaUrl(value);
      if (direct && isMediaUrl(direct)) out.add(direct);
      const decodedText = value.replace(/\\\//g, '/').replace(/&amp;/g, '&');
      const matches = decodedText.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
      matches.forEach((match) => {
        const cleaned = match.replace(/[),.;\]}]+$/g, '');
        if (isMediaUrl(cleaned)) out.add(normalizeMediaUrl(cleaned));
      });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectUrlsFromValue(item, out));
      return;
    }
    if (typeof value === 'object') {
      Object.values(value).forEach((item) => collectUrlsFromValue(item, out));
    }
  }

  function collectGenericMediaUrls() {
    const urls = new Set();
    const selector = [
      'a[href]',
      'audio[src]',
      'audio source[src]',
      'video[src]',
      'video source[src]',
      'track[src]',
      '[data-src]',
      '[data-url]',
      '[data-href]',
      '[data-video]',
      '[data-audio]',
    ].join(',');

    document.querySelectorAll(selector).forEach((element) => {
      ['href', 'src', 'data-src', 'data-url', 'data-href', 'data-video', 'data-audio'].forEach((attr) => {
        const value = element.getAttribute(attr);
        if (isMediaUrl(value)) urls.add(normalizeMediaUrl(value));
      });
      if ((element.tagName === 'VIDEO' || element.tagName === 'AUDIO') && isMediaUrl(element.currentSrc)) {
        urls.add(normalizeMediaUrl(element.currentSrc));
      }
    });

    document.querySelectorAll('meta[property], meta[name]').forEach((meta) => {
      const key = String(meta.getAttribute('property') || meta.getAttribute('name') || '').toLowerCase();
      if (!/(audio|video|stream|media|twitter:player|og:)/.test(key)) return;
      const content = meta.getAttribute('content');
      if (isMediaUrl(content)) urls.add(normalizeMediaUrl(content));
    });

    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        collectUrlsFromValue(JSON.parse(script.textContent || ''), urls);
      } catch (error) {
        collectUrlsFromValue(script.textContent || '', urls);
      }
    });

    performance.getEntriesByType('resource').forEach((entry) => {
      if (isMediaUrl(entry.name)) urls.add(normalizeMediaUrl(entry.name));
    });

    const html = document.documentElement ? document.documentElement.innerHTML : '';
    collectUrlsFromValue(html, urls);

    return Array.from(urls);
  }

  async function scanGenericPage() {
    if (state.scanning) return;

    state.rootPath = location.href;
    state.adapterName = adapterName();
    state.items.clear();
    state.selectedPaths.clear();
    state.pausedPaths.clear();
    state.downloadTasks.clear();
    state.downloadDone = 0;
    state.downloadFailed = 0;
    state.downloadTotal = 0;
    state.downloadActive = 0;
    state.downloadBytesLoaded = 0;
    state.downloadBytesTotal = 0;
    state.downloadSpeed = 0;
    state.lastProgressRender = 0;
    state.globalPaused = false;
    state.forceFileSystemNaming = false;
    state.scanning = true;
    state.stopScan = false;
    state.scannedDirs = 0;
    state.scannedFiles = 0;
    state.failedDirs = 0;
    state.status = '正在扫描当前页面明文媒体链接...';
    render();

    try {
      const urls = collectGenericMediaUrls();
      urls.forEach((url, index) => addGenericMediaUrl(url, document.title, 'generic-page', index));
      state.scannedFiles = urls.length;
      state.status = `完成：当前页面发现媒体 ${state.items.size} 个`;
    } catch (error) {
      state.status = `扫描失败：${error.message || error}`;
    } finally {
      state.scanning = false;
      render();
    }
  }

  async function scan(rootPath) {
    if (!isAsmrmoonSite()) {
      await scanGenericPage();
      return;
    }

    if (state.scanning) return;

    state.rootPath = normalizePath(rootPath || '/');
    state.adapterName = adapterName();
    state.items.clear();
    state.selectedPaths.clear();
    state.pausedPaths.clear();
    state.downloadTasks.clear();
    state.downloadDone = 0;
    state.downloadSkipped = 0;
    state.downloadFailed = 0;
    state.downloadTotal = 0;
    state.downloadActive = 0;
    state.downloadBytesLoaded = 0;
    state.downloadBytesTotal = 0;
    state.downloadSpeed = 0;
    state.lastProgressRender = 0;
    state.globalPaused = false;
    state.forceFileSystemNaming = false;
    state.scanning = true;
    state.stopScan = false;
    state.scannedDirs = 0;
    state.scannedFiles = 0;
    state.failedDirs = 0;
    state.status = `扫描中：${state.rootPath}`;
    render();

    const queue = [state.rootPath];
    const visited = new Set();

    try {
      while (queue.length && !state.stopScan) {
        const dir = normalizePath(queue.shift());
        if (visited.has(dir)) continue;
        visited.add(dir);
        state.scannedDirs += 1;
        state.status = `扫描目录 ${state.scannedDirs} 个，发现媒体 ${state.items.size} 个`;
        render();

        let page = 1;
        let loaded = 0;
        let total = Infinity;

        while (!state.stopScan && loaded < total) {
          let data;
          try {
            data = await listDir(dir, page);
          } catch (error) {
            state.failedDirs += 1;
            break;
          }

          const content = Array.isArray(data.content) ? data.content : [];
          total = Number.isFinite(Number(data.total)) ? Number(data.total) : content.length;
          loaded += content.length;

          for (const item of content) {
            if (state.stopScan) break;
            state.scannedFiles += item.is_dir ? 0 : 1;
            if (item.is_dir) {
              queue.push(joinPath(dir, item.name));
            } else if (isMedia(item)) {
              addMedia(item, dir);
            }
          }

          page += 1;
          if (!content.length) break;
          render();
        }
      }

      state.status = state.stopScan
        ? `已停止：发现媒体 ${state.items.size} 个`
        : `完成：目录 ${state.scannedDirs} 个，媒体 ${state.items.size} 个，失败目录 ${state.failedDirs} 个`;
    } catch (error) {
      state.status = `扫描失败：${error.message || error}`;
    } finally {
      state.scanning = false;
      render();
    }
  }

  async function scanCurrentSmart() {
    if (!isAsmrmoonSite()) {
      await scanGenericPage();
      return;
    }

    const path = currentPath();
    try {
      const data = await getFile(path);
      if (data && data.is_dir === false) {
        await scan(parentPath(path));
        return;
      }
    } catch (error) {
      // Fall back to treating the current route as a directory.
    }
    await scan(path);
  }

  async function refreshItem(item) {
    if (item && item.source === 'generic') {
      const next = {
        ...item,
        url: item.url || item.rawUrl || item.path,
        saveName: displayNameFor(item),
      };
      state.items.set(item.path, next);
      return next;
    }

    try {
      const fresh = await getFile(item.path);
      const next = {
        ...item,
        name: fresh.name || item.name,
        kind: mediaKindFor({ ...item, ...fresh, path: item.path }) || item.kind,
        size: fresh.size || item.size,
        sign: fresh.sign || item.sign,
        rawUrl: fresh.raw_url || '',
        url: directUrl({ ...item, ...fresh, path: item.path }),
      };
      next.saveName = displayNameFor(next);
      state.items.set(item.path, next);
      return next;
    } catch (error) {
      return {
        ...item,
        url: directUrl(item),
        saveName: displayNameFor(item),
      };
    }
  }

  function reportProgress(onProgress, loaded, total, extra) {
    if (typeof onProgress !== 'function') return;
    onProgress({
      loaded: Math.max(0, Number(loaded || 0)),
      total: Math.max(0, Number(total || 0)),
      ...(extra || {}),
    });
  }

  function retryDelayMs(attempt) {
    return RETRY_BASE_DELAY_MS * Math.max(1, attempt);
  }

  function retryableError(error) {
    const message = String((error && error.message) || error || '');
    return /HTTP (403|408|425|429|500|502|503|504)|超时|timeout|network|failed|请求失败|下载失败/i.test(message);
  }

  async function sleepWithPause(ms, task) {
    const endAt = Date.now() + Math.max(0, ms);
    while (!state.stopDownload && Date.now() < endAt) {
      await waitForResume(task);
      await sleep(Math.min(250, endAt - Date.now()));
    }
  }

  function isTaskPaused(task) {
    return Boolean(state.downloading && (state.globalPaused || (task && task.paused)));
  }

  async function waitForResume(task) {
    while (!state.stopDownload && isTaskPaused(task)) {
      renderDownloadProgress(false);
      await sleep(250);
    }
    if (state.downloading && state.stopDownload) throw new Error('下载已停止');
  }

  function pauseTaskByPath(path) {
    state.pausedPaths.add(path);
    const task = state.downloadTasks.get(path);
    if (task) {
      task.paused = true;
      task.speed = 0;
    }
    renderDownloadProgress(true);
  }

  function resumeTaskByPath(path) {
    state.pausedPaths.delete(path);
    const task = state.downloadTasks.get(path);
    if (task) task.paused = false;
    renderDownloadProgress(true);
  }

  function pauseAllDownloads() {
    state.globalPaused = true;
    state.downloadTasks.forEach((task) => {
      if (task.status === 'queued' || task.status === 'downloading' || task.status === 'retrying' || task.status === 'starting' || task.status === 'deferred') {
        task.speed = 0;
      }
    });
    state.status = '已暂停全部下载';
    renderDownloadProgress(true);
  }

  function resumeAllDownloads() {
    state.globalPaused = false;
    state.status = '已恢复全部下载';
    renderDownloadProgress(true);
  }

  function gmRequest(details) {
    if (typeof GM_xmlhttpRequest !== 'function') return null;
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          timeout: M3U8_REQUEST_TIMEOUT_MS,
          ...details,
          onload(response) {
            if (response.status >= 200 && response.status < 400) {
              resolve(response);
            } else {
              reject(new Error(`HTTP ${response.status}`));
            }
          },
          ontimeout() {
            reject(new Error('请求超时'));
          },
          onerror(error) {
            reject(new Error((error && error.error) || '请求失败'));
          },
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function requestText(url) {
    const response = await (gmRequest({ url, responseType: 'text' }) || fetch(url, { credentials: 'include' }));
    if (response && typeof response.responseText === 'string') return response.responseText;
    if (response && typeof response.response === 'string') return response.response;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  function rangeHeaderFor(byteRange) {
    if (!byteRange) return {};
    return {
      Range: `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}`,
    };
  }

  function normalizeRangeBuffer(buffer, byteRange, status) {
    if (!byteRange || !(buffer instanceof ArrayBuffer)) return buffer;
    if (buffer.byteLength === byteRange.length) return buffer;
    if (status === 206) return buffer;
    if (buffer.byteLength >= byteRange.offset + byteRange.length) {
      return buffer.slice(byteRange.offset, byteRange.offset + byteRange.length);
    }
    return buffer.slice(0, byteRange.length);
  }

  async function requestArrayBuffer(url, onProgress, options) {
    const byteRange = options && options.byteRange;
    const task = options && options.task;
    const expectedLength = byteRange ? byteRange.length : Number((options && options.expectedLength) || 0);
    const headers = {
      ...rangeHeaderFor(byteRange),
      ...((options && options.headers) || {}),
    };
    await waitForResume(task);
    const gmPromise = gmRequest({
      url,
      headers,
      responseType: 'arraybuffer',
      onprogress(event) {
        const total = expectedLength || (event && event.lengthComputable ? event.total : 0);
        reportProgress(onProgress, event && event.loaded, total);
      },
    });

    if (gmPromise) {
      const response = await gmPromise;
      if (response.response instanceof ArrayBuffer) {
        return normalizeRangeBuffer(response.response, byteRange, response.status);
      }
      if (response.response instanceof Blob) {
        const buffer = await response.response.arrayBuffer();
        return normalizeRangeBuffer(buffer, byteRange, response.status);
      }
      if (typeof response.responseText === 'string') {
        const buffer = new TextEncoder().encode(response.responseText).buffer;
        return normalizeRangeBuffer(buffer, byteRange, response.status);
      }
      throw new Error('下载响应为空');
    }

    const response = await fetch(url, { credentials: 'include', headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const total = expectedLength || Number(response.headers.get('content-length') || 0);
    if (!response.body || typeof response.body.getReader !== 'function') {
      const buffer = await response.arrayBuffer();
      reportProgress(onProgress, buffer.byteLength, total || buffer.byteLength);
      return normalizeRangeBuffer(buffer, byteRange, response.status);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      await waitForResume(task);
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      reportProgress(onProgress, loaded, total);
    }

    const buffer = new Uint8Array(loaded);
    let offset = 0;
    chunks.forEach((chunk) => {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    });
    reportProgress(onProgress, loaded, total || loaded);
    return normalizeRangeBuffer(buffer.buffer, byteRange, response.status);
  }

  function resolveM3u8Url(baseUrl, value) {
    return new URL(String(value || '').trim(), baseUrl).href;
  }

  function parseM3u8Attributes(line) {
    const text = String(line || '').includes(':') ? String(line).slice(String(line).indexOf(':') + 1) : String(line || '');
    const attrs = {};
    const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
    let match;
    while ((match = pattern.exec(text))) {
      attrs[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, '');
    }
    return attrs;
  }

  function parseM3u8ByteRange(value, previousEnd) {
    const match = String(value || '').trim().match(/^(\d+)(?:@(\d+))?$/);
    if (!match) return null;
    const length = Number(match[1]);
    const offset = match[2] === undefined ? Number(previousEnd || 0) : Number(match[2]);
    if (!Number.isFinite(length) || !Number.isFinite(offset) || length <= 0 || offset < 0) return null;
    return { length, offset };
  }

  function parseM3u8Playlist(text, baseUrl) {
    const lines = String(text || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim());
    const variants = [];
    const segments = [];
    let pendingVariant = null;
    let mediaSequence = 0;
    let currentKey = null;
    let initMap = null;
    let pendingByteRange = null;
    let previousByteRangeEnd = 0;

    for (const line of lines) {
      if (!line) continue;

      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = Number.parseInt(line.slice(line.indexOf(':') + 1), 10) || 0;
        continue;
      }

      if (line.startsWith('#EXT-X-BYTERANGE')) {
        const value = line.includes(':') ? line.slice(line.indexOf(':') + 1) : '';
        pendingByteRange = parseM3u8ByteRange(value, previousByteRangeEnd);
        if (pendingByteRange) previousByteRangeEnd = pendingByteRange.offset + pendingByteRange.length;
        continue;
      }

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        pendingVariant = parseM3u8Attributes(line);
        continue;
      }

      if (pendingVariant && !line.startsWith('#')) {
        variants.push({
          url: resolveM3u8Url(baseUrl, line),
          bandwidth: Number(pendingVariant.BANDWIDTH || 0),
          resolution: pendingVariant.RESOLUTION || '',
        });
        pendingVariant = null;
        continue;
      }

      if (line.startsWith('#EXT-X-KEY:')) {
        const attrs = parseM3u8Attributes(line);
        const method = String(attrs.METHOD || '').toUpperCase();
        currentKey = method && method !== 'NONE'
          ? {
              method,
              uri: attrs.URI ? resolveM3u8Url(baseUrl, attrs.URI) : '',
              iv: attrs.IV || '',
            }
          : null;
        continue;
      }

      if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = parseM3u8Attributes(line);
        if (attrs.URI) {
          const byteRange = attrs.BYTERANGE ? parseM3u8ByteRange(attrs.BYTERANGE, 0) : null;
          initMap = {
            url: resolveM3u8Url(baseUrl, attrs.URI),
            byteRange,
            key: currentKey,
            sequence: mediaSequence,
            init: true,
          };
        }
        continue;
      }

      if (line.startsWith('#')) continue;

      segments.push({
        url: resolveM3u8Url(baseUrl, line),
        byteRange: pendingByteRange,
        key: currentKey,
        sequence: mediaSequence + segments.length,
        init: false,
      });
      pendingByteRange = null;
    }

    return { variants, segments, initMap };
  }

  function chooseM3u8Variant(variants) {
    return variants
      .slice()
      .sort((a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0))[0];
  }

  async function loadM3u8MediaPlaylist(url) {
    let currentUrl = url;
    for (let depth = 0; depth < 5; depth += 1) {
      const text = await requestText(currentUrl);
      const parsed = parseM3u8Playlist(text, currentUrl);
      if (parsed.variants.length) {
        const variant = chooseM3u8Variant(parsed.variants);
        currentUrl = variant.url;
        continue;
      }
      return { url: currentUrl, ...parsed };
    }
    throw new Error('m3u8 嵌套层级过深');
  }

  function m3u8OutputExtension(playlist) {
    return 'mp4';
  }

  function hexToBytes(hex) {
    const clean = String(hex || '').replace(/^0x/i, '').padStart(32, '0');
    const bytes = new Uint8Array(16);
    for (let index = 0; index < 16; index += 1) {
      bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16) || 0;
    }
    return bytes;
  }

  function sequenceIvBytes(sequence) {
    const bytes = new Uint8Array(16);
    let value = Math.max(0, Number(sequence || 0));
    for (let index = 15; index >= 8; index -= 1) {
      bytes[index] = value & 0xff;
      value = Math.floor(value / 256);
    }
    return bytes;
  }

  async function getM3u8KeyBytes(keyInfo, keyCache) {
    if (!keyInfo || !keyInfo.uri) return null;
    if (keyCache.has(keyInfo.uri)) return keyCache.get(keyInfo.uri);
    const buffer = await requestArrayBuffer(keyInfo.uri);
    const bytes = new Uint8Array(buffer);
    keyCache.set(keyInfo.uri, bytes);
    return bytes;
  }

  async function decryptM3u8Buffer(buffer, resource, keyCache) {
    const keyInfo = resource && resource.key;
    if (!keyInfo) return buffer;
    if (keyInfo.method !== 'AES-128') {
      throw new Error(`暂不支持 ${keyInfo.method || '未知'} 加密的 m3u8`);
    }
    if (!keyInfo.uri) throw new Error('m3u8 加密片段缺少密钥地址');
    if (resource.init && !keyInfo.iv) throw new Error('加密初始化片段缺少 IV');
    if (!globalThis.crypto || !globalThis.crypto.subtle) throw new Error('当前浏览器不支持 WebCrypto 解密 m3u8');

    const keyBytes = await getM3u8KeyBytes(keyInfo, keyCache);
    const cryptoKey = await globalThis.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
    const iv = keyInfo.iv ? hexToBytes(keyInfo.iv) : sequenceIvBytes(resource.sequence);
    return globalThis.crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, buffer);
  }

  function playlistUsesFmp4(playlist) {
    if (playlist.initMap) return true;
    const firstSegment = playlist.segments.find((segment) => segment && segment.url);
    const ext = firstSegment ? extension(firstSegment.url) : '';
    return ['m4s', 'mp4', 'm4v'].includes(ext);
  }

  function ensureMuxJs() {
    const mux = globalThis.muxjs || globalThis.mux;
    const transmuxer = mux && mux.mp4 && mux.mp4.Transmuxer;
    if (!transmuxer) {
      throw new Error('mux.js 未加载，无法将 TS 分片转封装为 MP4');
    }
    return transmuxer;
  }

  function createMp4Transmuxer(writeChunk) {
    const Transmuxer = ensureMuxJs();
    const transmuxer = new Transmuxer({ keepOriginalTimestamps: true });
    let wroteInit = false;
    let pendingWrite = Promise.resolve();

    transmuxer.on('data', (segment) => {
      const chunks = [];
      if (!wroteInit && segment.initSegment) {
        chunks.push(segment.initSegment);
        wroteInit = true;
      }
      if (segment.data) chunks.push(segment.data);
      chunks.forEach((chunk) => {
        pendingWrite = pendingWrite.then(() => writeChunk(chunk));
      });
    });

    return {
      async push(buffer) {
        transmuxer.push(new Uint8Array(buffer));
        transmuxer.flush();
        await pendingWrite;
      },
    };
  }

  async function transmuxTsBuffersToMp4Blob(buffers) {
    const chunks = [];
    const transmuxer = createMp4Transmuxer((chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    });
    for (const buffer of buffers) {
      await transmuxer.push(buffer);
    }
    return new Blob(chunks, { type: 'video/mp4' });
  }

  async function abortWritable(writer) {
    if (!writer || typeof writer.abort !== 'function') return;
    try {
      await writer.abort();
    } catch (error) {
      // The stream may already be closed; nothing else to clean up here.
    }
  }

  async function downloadDirectToDirectory(url, name, onProgress, task) {
    let writer = null;
    try {
      await waitForResume(task);
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      writer = await createWritableForDownloadName(name);
      const total = Number(response.headers.get('content-length') || 0);

      if (!response.body || typeof response.body.getReader !== 'function') {
        const buffer = await response.arrayBuffer();
        await writer.write(buffer);
        reportProgress(onProgress, buffer.byteLength, total || buffer.byteLength);
        await writer.close();
        return;
      }

      const reader = response.body.getReader();
      let loaded = 0;
      while (!state.stopDownload) {
        await waitForResume(task);
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
        loaded += value.byteLength;
        reportProgress(onProgress, loaded, total);
      }
      if (state.stopDownload) throw new Error('下载已停止');
      await writer.close();
      return;
    } catch (error) {
      if (writer) {
        await abortWritable(writer);
        throw error;
      }
    }

    writer = null;
    try {
      const buffer = await requestArrayBuffer(url, onProgress, { task });
      writer = await createWritableForDownloadName(name);
      await writer.write(buffer);
      reportProgress(onProgress, buffer.byteLength, buffer.byteLength);
      await writer.close();
    } catch (error) {
      await abortWritable(writer);
      throw error;
    }
  }

  async function downloadM3u8ToDirectory(url, name, onProgress, task) {
    const playlist = await loadM3u8MediaPlaylist(url);
    if (!playlist.segments.length) throw new Error('m3u8 中没有可下载分片');

    const resources = [
      ...(playlist.initMap ? [playlist.initMap] : []),
      ...playlist.segments,
    ];
    const outputExt = m3u8OutputExtension(playlist);
    const outputName = replaceDownloadExtension(name, outputExt);
    const totalBytes = resources.every((resource) => resource.byteRange)
      ? resources.reduce((total, resource) => total + resource.byteRange.length, 0)
      : 0;
    const keyCache = new Map();
    const useFmp4 = playlistUsesFmp4(playlist);
    let writer = null;
    let transmuxer = null;
    let completed = 0;
    let completedBytes = 0;

    function emitProgress(currentLoaded) {
      reportProgress(onProgress, completedBytes + Number(currentLoaded || 0), totalBytes, {
        segmentsDone: completed,
        segmentsTotal: resources.length,
      });
    }

    try {
      writer = await createWritableForDownloadName(outputName);
      if (!useFmp4) {
        transmuxer = createMp4Transmuxer((chunk) => writer.write(chunk));
      }
      for (const resource of resources) {
        await waitForResume(task);
        if (state.stopDownload) throw new Error('下载已停止');
        const buffer = await requestArrayBuffer(resource.url, (progress) => emitProgress(progress.loaded), {
          byteRange: resource.byteRange,
          task,
        });
        const decrypted = await decryptM3u8Buffer(buffer, resource, keyCache);
        if (useFmp4) {
          await writer.write(decrypted);
        } else {
          await transmuxer.push(decrypted);
        }
        completedBytes += decrypted.byteLength || decrypted.size || buffer.byteLength || 0;
        completed += 1;
        emitProgress(0);
      }
      await writer.close();
    } catch (error) {
      await abortWritable(writer);
      throw error;
    }
  }

  async function downloadM3u8(url, name, onProgress, saveAs, task) {
    const playlist = await loadM3u8MediaPlaylist(url);
    if (!playlist.segments.length) throw new Error('m3u8 中没有可下载分片');

    const resources = [
      ...(playlist.initMap ? [playlist.initMap] : []),
      ...playlist.segments,
    ];
    const loadedByIndex = new Map();
    const totalByIndex = new Map();
    const buffers = new Array(resources.length);
    const keyCache = new Map();
    const useFmp4 = playlistUsesFmp4(playlist);
    let completed = 0;
    let segmentError = null;

    function emitProgress() {
      const loaded = Array.from(loadedByIndex.values()).reduce((total, value) => total + Number(value || 0), 0);
      const total = Array.from(totalByIndex.values()).reduce((sum, value) => sum + Number(value || 0), 0);
      reportProgress(onProgress, loaded, total, {
        segmentsDone: completed,
        segmentsTotal: resources.length,
      });
    }

    let nextIndex = 0;
    async function segmentWorker() {
      while (!state.stopDownload && !segmentError) {
        await waitForResume(task);
        const index = nextIndex;
        nextIndex += 1;
        if (index >= resources.length) break;

        try {
          const resource = resources[index];
          const buffer = await requestArrayBuffer(resource.url, (progress) => {
            loadedByIndex.set(index, progress.loaded);
            if (progress.total) totalByIndex.set(index, progress.total);
            emitProgress();
          }, { byteRange: resource.byteRange, task });

          loadedByIndex.set(index, buffer.byteLength);
          if (!totalByIndex.has(index)) totalByIndex.set(index, buffer.byteLength);
          buffers[index] = await decryptM3u8Buffer(buffer, resource, keyCache);
          completed += 1;
          emitProgress();
        } catch (error) {
          segmentError = error;
          throw error;
        }
      }
    }

    const workerCount = Math.min(M3U8_SEGMENT_CONCURRENCY, resources.length);
    const results = await Promise.allSettled(Array.from({ length: workerCount }, () => segmentWorker()));
    if (state.stopDownload) throw new Error('下载已停止');
    if (segmentError) throw segmentError;
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;

    const outputExt = m3u8OutputExtension(playlist);
    const outputName = replaceDownloadExtension(name, outputExt);
    const blob = useFmp4 ? new Blob(buffers, { type: 'video/mp4' }) : await transmuxTsBuffersToMp4Blob(buffers);
    await saveBlob(blob, outputName, saveAs);
  }

  async function downloadOne(item, saveAs, onProgress, categoryCounts, task) {
    const fresh = await refreshItem(item);
    const url = downloadUrl(fresh);
    const name = downloadNameFor(fresh, categoryCounts);
    const kind = fresh.kind || mediaKindFor(fresh);

    if (shouldUseDirectoryWriter(kind)) {
      if (kind === 'm3u8') {
        await downloadM3u8ToDirectory(url, name, onProgress, task);
      } else {
        await downloadDirectToDirectory(url, name, onProgress, task);
      }
      return;
    }

    if (kind === 'm3u8') {
      await downloadM3u8(url, name, onProgress, saveAs, task);
      return;
    }

    if (state.downloadMode === 'blob') {
      if (typeof GM_download === 'function') {
        await downloadByBrowser(url, name, saveAs, onProgress, task);
      } else {
        await downloadByBlob(url, name, onProgress, saveAs, task);
      }
      return;
    }

    await downloadByBrowser(url, name, saveAs, onProgress, task);
  }

  async function downloadByBrowser(url, name, saveAs, onProgress, task) {
    await waitForResume(task);
    if (typeof GM_download !== 'function') {
      clickDownload(url, name);
      return Promise.resolve();
    }

    await new Promise((resolve, reject) => {
      try {
        GM_download({
          url,
          name,
          saveAs: Boolean(saveAs),
          onprogress: (event) => reportProgress(onProgress, event && event.loaded, event && event.total),
          onload: resolve,
          onerror: (error) => reject(new Error((error && error.error) || '下载失败')),
          ontimeout: () => reject(new Error('下载超时')),
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function downloadByBlob(url, name, onProgress, saveAs, task) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        waitForResume(task).then(() => {
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            responseType: 'blob',
            timeout: 30 * 60 * 1000,
            onprogress(event) {
              const total = event && event.lengthComputable ? event.total : 0;
              reportProgress(onProgress, event && event.loaded, total);
            },
            onload(response) {
              if (response.status >= 200 && response.status < 400 && response.response) {
                const size = response.response.size || 0;
                reportProgress(onProgress, size, size);
                saveBlob(response.response, name, saveAs).then(resolve, reject);
              } else {
                reject(new Error(`HTTP ${response.status}`));
              }
            },
            ontimeout() {
              reject(new Error('下载超时'));
            },
            onerror(error) {
              reject(new Error((error && error.error) || '下载失败'));
            },
          });
        }, reject);
      });
    }

    return waitForResume(task).then(() => fetch(url, { credentials: 'include' })).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const total = Number(response.headers.get('content-length') || 0);
      const type = response.headers.get('content-type') || '';
      if (!response.body || typeof response.body.getReader !== 'function') {
        const blob = await response.blob();
        reportProgress(onProgress, blob.size, total || blob.size);
        await saveBlob(blob, name, saveAs);
        return;
      }

      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;

      while (true) {
        await waitForResume(task);
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        reportProgress(onProgress, loaded, total);
      }

      const blob = new Blob(chunks, { type });
      reportProgress(onProgress, blob.size, total || blob.size);
      await saveBlob(blob, name, saveAs);
    });
  }

  async function saveBlob(blob, name, saveAs) {
    const url = URL.createObjectURL(blob);
    if (typeof GM_download === 'function') {
      try {
        await new Promise((resolve, reject) => {
          GM_download({
            url,
            name,
            saveAs: Boolean(saveAs),
            onload: resolve,
            onerror: (error) => reject(new Error((error && error.error) || '下载失败')),
            ontimeout: () => reject(new Error('下载超时')),
          });
        });
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return;
      } catch (error) {
        // Fall back to the browser click method below. Some older Tampermonkey versions do not accept blob URLs here.
      }
    }

    try {
      clickDownload(url, name);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }

  function clickDownload(url, name) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.documentElement.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function createDownloadTask(item, index, categoryCounts) {
    const kind = item.kind || mediaKindFor(item);
    const size = kind === 'm3u8' ? 0 : Number(item.size || 0);
    return {
      id: item.path,
      index,
      name: item.saveName,
      path: item.path,
      kind,
      folder: downloadFolderFor(item, categoryCounts),
      outputName: outputDownloadNameFor(item, categoryCounts),
      size,
      status: 'queued',
      paused: state.pausedPaths.has(item.path),
      retryCount: 0,
      maxRetries: MAX_DOWNLOAD_RETRIES,
      retryPhase: 'initial',
      loaded: 0,
      total: size,
      segmentsDone: 0,
      segmentsTotal: 0,
      speed: 0,
      error: '',
      startedAt: 0,
      finishedAt: 0,
      lastLoaded: 0,
      lastAt: 0,
    };
  }

  function resetDownloadTasks(items, categoryCounts) {
    state.pausedPaths.clear();
    state.downloadTasks = new Map(items.map((item, index) => [item.path, createDownloadTask(item, index, categoryCounts)]));
    state.downloadDone = 0;
    state.downloadSkipped = 0;
    state.downloadFailed = 0;
    state.downloadTotal = items.length;
    state.downloadActive = 0;
    state.downloadBytesLoaded = 0;
    state.downloadBytesTotal = items.reduce((total, item) => total + Number(item.size || 0), 0);
    state.downloadSpeed = 0;
    state.lastProgressRender = 0;
    state.globalPaused = false;
  }

  function updateDownloadStats() {
    const tasks = Array.from(state.downloadTasks.values());
    state.downloadActive = tasks.filter((task) => task.status === 'downloading' && !isTaskPaused(task)).length;
    state.downloadBytesLoaded = tasks.reduce((total, task) => total + Number(task.loaded || 0), 0);
    state.downloadBytesTotal = tasks.reduce(
      (total, task) => total + Math.max(Number(task.total || 0), Number(task.size || 0), Number(task.loaded || 0)),
      0,
    );
    state.downloadSpeed = tasks.reduce(
      (total, task) => total + (task.status === 'downloading' && !isTaskPaused(task) ? Number(task.speed || 0) : 0),
      0,
    );

    if (state.downloading) {
      const finished = state.downloadDone + state.downloadSkipped + state.downloadFailed;
      const skippedText = state.downloadSkipped ? `，跳过 ${state.downloadSkipped} 个` : '';
      const deferredText = deferredTaskCount() ? `，暂缓 ${deferredTaskCount()} 个` : '';
      const totalText = state.downloadBytesTotal
        ? `，已下 ${readableTransferSize(state.downloadBytesLoaded)}/${readableTransferSize(state.downloadBytesTotal)}`
        : '';
      state.status = `下载中：完成 ${finished}/${state.downloadTotal}${skippedText}${deferredText}，进行 ${state.downloadActive} 个，速度 ${readableSpeed(state.downloadSpeed)}${totalText}`;
    }
  }

  function renderDownloadProgress(force) {
    updateDownloadStats();
    const now = Date.now();
    if (force || now - state.lastProgressRender >= PROGRESS_RENDER_MS) {
      state.lastProgressRender = now;
      render();
    }
  }

  function startDownloadTask(task, retryCount, retryPhase) {
    const now = Date.now();
    task.status = 'downloading';
    task.retryCount = Number(retryCount || 0);
    task.retryPhase = retryPhase || 'initial';
    task.maxRetries = task.retryPhase === 'final' ? FINAL_DOWNLOAD_RETRIES : MAX_DOWNLOAD_RETRIES;
    task.startedAt = now;
    task.finishedAt = 0;
    task.loaded = 0;
    task.speed = 0;
    task.error = '';
    task.lastLoaded = 0;
    task.lastAt = now;
    renderDownloadProgress(true);
  }

  function updateTaskProgress(task, progress) {
    const now = Date.now();
    const loaded = Math.max(0, Number((progress && progress.loaded) || 0));
    const total = Math.max(0, Number((progress && progress.total) || 0));

    if (Number.isFinite(Number(progress && progress.segmentsDone))) {
      task.segmentsDone = Number(progress.segmentsDone);
    }
    if (Number.isFinite(Number(progress && progress.segmentsTotal))) {
      task.segmentsTotal = Number(progress.segmentsTotal);
    }

    if (total > 0) task.total = Math.max(task.total, total, loaded);
    if (loaded > task.total && task.kind !== 'm3u8') task.total = loaded;

    if (task.lastAt && now > task.lastAt && loaded >= task.lastLoaded) {
      const instantSpeed = ((loaded - task.lastLoaded) * 1000) / (now - task.lastAt);
      task.speed = task.speed ? task.speed * 0.65 + instantSpeed * 0.35 : instantSpeed;
    }

    task.loaded = Math.max(task.loaded, loaded);
    task.lastLoaded = loaded;
    task.lastAt = now;
    renderDownloadProgress(false);
  }

  function finishDownloadTask(task) {
    task.status = 'done';
    task.finishedAt = Date.now();
    task.speed = 0;
    if (task.total > 0 && task.loaded < task.total) {
      task.loaded = task.total;
    } else if (!task.loaded && task.size > 0) {
      task.loaded = task.size;
      task.total = Math.max(task.total, task.size);
    }
    state.downloadDone += 1;
    renderDownloadProgress(true);
  }

  function skipDownloadTask(task, reason) {
    task.status = 'skipped';
    task.finishedAt = Date.now();
    task.speed = 0;
    task.loaded = 0;
    task.total = 0;
    task.size = 0;
    task.error = reason || '本地已存在同名文件';
    state.downloadSkipped += 1;
  }

  function failDownloadTask(task, error) {
    task.status = 'failed';
    task.finishedAt = Date.now();
    task.speed = 0;
    task.error = (error && error.message) || String(error || '下载失败');
    state.downloadFailed += 1;
    renderDownloadProgress(true);
  }

  function deferDownloadTask(task, error) {
    task.status = 'deferred';
    task.finishedAt = 0;
    task.speed = 0;
    task.loaded = 0;
    task.retryPhase = 'final';
    task.retryCount = 0;
    task.maxRetries = FINAL_DOWNLOAD_RETRIES;
    task.error = (error && error.message) || String(error || '下载失败');
    renderDownloadProgress(true);
  }

  function retryTextForTask(task) {
    if (!task || !task.retryCount) return '';
    const label = task.retryPhase === 'final' ? '最终重试' : '重试';
    return `${label} ${task.retryCount}/${task.maxRetries}`;
  }

  function downloadTaskLabel(task) {
    if (!task) return '';
    if (isTaskPaused(task) && (task.status === 'queued' || task.status === 'starting' || task.status === 'downloading' || task.status === 'retrying' || task.status === 'deferred')) {
      return state.globalPaused ? '全部暂停中' : '已暂停';
    }
    if (task.status === 'queued') return '等待下载';
    if (task.status === 'starting') return '准备下载';
    if (task.status === 'retrying') return `等待${retryTextForTask(task)}：${task.error || '下载失败'}`;
    if (task.status === 'deferred') return `暂时放弃，等待最后重试：${task.error || '下载失败'}`;
    if (task.status === 'done') return '已完成';
    if (task.status === 'skipped') return `已跳过：${task.error || '本地已存在同名文件'}`;
    if (task.status === 'failed') return `失败：${task.error || '下载失败'}`;
    if (task.status === 'downloading') {
      const retryText = retryTextForTask(task);
      const prefix = retryText ? `${retryText} · ` : '';
      if (task.kind === 'm3u8') {
        const segmentText = task.segmentsTotal ? `分片 ${task.segmentsDone}/${task.segmentsTotal}` : '解析m3u8';
        return `下载中 ${prefix}${segmentText} · ${readableTransferSize(task.loaded)} · ${readableSpeed(task.speed)}`;
      }
      const progress = task.total > 0 ? `${Math.min(100, (task.loaded / task.total) * 100).toFixed(1)}%` : readableTransferSize(task.loaded);
      return `下载中 ${prefix}${progress} · ${readableSpeed(task.speed)}`;
    }
    return task.status;
  }

  function queuedTaskCount() {
    return Array.from(state.downloadTasks.values()).filter((task) => task.status === 'queued').length;
  }

  function deferredTaskCount() {
    return Array.from(state.downloadTasks.values()).filter((task) => task.status === 'deferred').length;
  }

  async function skipExistingDownloadTasks(items, categoryCounts) {
    if (!state.saveDirectoryHandle) return 0;

    state.status = `正在扫描保存目录：${state.saveDirectoryName || '已选择目录'}`;
    render();

    const existing = await scanExistingDownloadMedia(state.saveDirectoryHandle);
    let skipped = 0;
    items.forEach((item) => {
      const task = state.downloadTasks.get(item.path);
      if (!task || task.status !== 'queued') return;
      const outputName = outputDownloadNameFor(item, categoryCounts);
      if (!existingDownloadMatchesName(existing, outputName)) return;
      skipDownloadTask(task, `已存在：${downloadFileNamePart(outputName)}`);
      skipped += 1;
    });

    updateDownloadStats();
    state.status = skipped
      ? `保存目录扫描完成：发现 ${existing.count} 个音视频，已跳过 ${skipped} 个同名文件`
      : `保存目录扫描完成：发现 ${existing.count} 个音视频，未发现同名文件`;
    render();
    return skipped;
  }

  function claimNextDownload(items, status) {
    const expectedStatus = status || 'queued';
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const task = state.downloadTasks.get(item.path);
      if (!task || task.status !== expectedStatus || task.paused) continue;
      task.status = 'starting';
      renderDownloadProgress(true);
      return { item, task };
    }
    return null;
  }

  async function runDownloadTask(item, task, categoryCounts, options) {
    const finalPhase = Boolean(options && options.finalPhase);
    const maxAttempts = finalPhase ? FINAL_DOWNLOAD_RETRIES : MAX_DOWNLOAD_RETRIES + 1;
    const maxRetries = finalPhase ? FINAL_DOWNLOAD_RETRIES : MAX_DOWNLOAD_RETRIES;
    const retryPhase = finalPhase ? 'final' : 'initial';
    task.maxRetries = maxRetries;
    task.retryPhase = retryPhase;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await waitForResume(task);
        const retryCount = finalPhase ? attempt + 1 : attempt;
        startDownloadTask(task, retryCount, retryPhase);
        await downloadOne(item, false, (progress) => updateTaskProgress(task, progress), categoryCounts, task);
        finishDownloadTask(task);
        return;
      } catch (error) {
        if (state.stopDownload) {
          task.status = 'queued';
          task.speed = 0;
          task.error = '';
          renderDownloadProgress(true);
          return;
        }

        const isRetryable = retryableError(error);
        const canRetry = attempt < maxAttempts - 1 && isRetryable;
        if (!canRetry) {
          if (!finalPhase && isRetryable) {
            deferDownloadTask(task, error);
            return;
          }
          failDownloadTask(task, error);
          return;
        }

        task.status = 'retrying';
        task.retryPhase = retryPhase;
        task.retryCount = attempt + 1;
        task.maxRetries = maxRetries;
        task.error = (error && error.message) || String(error || '下载失败');
        task.loaded = 0;
        task.speed = 0;
        task.lastLoaded = 0;
        task.lastAt = Date.now();
        renderDownloadProgress(true);
        try {
          await sleepWithPause(retryDelayMs(attempt + 1), task);
        } catch (waitError) {
          if (state.stopDownload) {
            task.status = 'queued';
            task.speed = 0;
            renderDownloadProgress(true);
            return;
          }
          throw waitError;
        }
      }
    }
  }

  async function downloadVisible() {
    if (state.downloading) return;

    const items = selectedVisibleItems();
    if (!items.length) {
      state.status = '当前列表没有已勾选的可下载媒体';
      render();
      return;
    }

    state.downloadConcurrency = clampDownloadConcurrency(state.downloadConcurrency);
    const concurrency = Math.min(state.downloadConcurrency, items.length);
    const categoryCounts = categoryCountsFor(items);
    const categoryText = categoryCounts.size ? `\n\n将按名称中间段保存到 ${categoryCounts.size} 个大目录；大目录下直接显示的第一层文件直接放入大目录，只有小目录内的第二层文件才会保存到“小目录标题/文件名”。` : '';
    const strongDirectoryNeeded = needsStrongDirectoryNaming(items, categoryCounts);
    const strongDirectoryText = strongDirectoryNeeded
      ? '\n\n强制命名将使用本地目录写入，确保 MP3/MP4 文件名和分类文件夹不会被浏览器改名。'
      : '';
    const directoryText = isDirectoryDownloadMode()
      ? `\n\n低内存目录模式会写入你选择的本地目录，m3u8 将边下载分片边写入文件，不走浏览器下载管理器。`
      : '';
    const duplicateScanText = directoryModeSupported()
      ? '\n\n下载前会扫描你选择/已授权的保存目录，发现同名音视频会自动跳过。'
      : '\n\n当前浏览器不支持读取本地下载目录，无法自动跳过已存在文件。';
    const downloadTip = isDirectoryDownloadMode() || strongDirectoryNeeded
      ? ''
      : '\n\n建议在浏览器下载设置里关闭“每次下载前询问保存位置”，否则会弹出很多保存窗口。';
    const confirmed = window.confirm(
      `将以最多 ${concurrency} 个并发任务下载 ${items.length} 个音视频文件。${categoryText}${strongDirectoryText}${directoryText}${duplicateScanText}${downloadTip}\n\n继续？`,
    );
    if (!confirmed) return;

    state.forceFileSystemNaming = false;
    if (!directoryModeSupported()) {
      state.status = '当前浏览器不支持读取本地下载目录，无法自动跳过已存在文件';
      render();
      return;
    }

    try {
      await ensureSaveDirectory();
      state.forceFileSystemNaming = state.downloadMode === 'blob' && strongDirectoryNeeded;
    } catch (error) {
      state.status = `未选择保存目录：${error.message || error}`;
      render();
      return;
    }

    state.downloading = true;
    state.stopDownload = false;
    resetDownloadTasks(items, categoryCounts);
    renderDownloadProgress(true);

    try {
      await skipExistingDownloadTasks(items, categoryCounts);
    } catch (error) {
      state.downloading = false;
      state.status = `扫描保存目录失败：${error.message || error}`;
      render();
      return;
    }

    if (!queuedTaskCount()) {
      state.downloading = false;
      updateDownloadStats();
      state.status = `下载完成：成功 ${state.downloadDone} 个，跳过 ${state.downloadSkipped} 个，失败 ${state.downloadFailed} 个`;
      render();
      return;
    }

    async function worker(workerIndex) {
      if (workerIndex > 0) await sleep(workerIndex * DOWNLOAD_DELAY_MS);

      while (!state.stopDownload) {
        try {
          await waitForResume(null);
        } catch (error) {
          break;
        }
        const claimed = claimNextDownload(items);
        if (!claimed) {
          if (!queuedTaskCount()) break;
          await sleep(250);
          continue;
        }

        try {
          await runDownloadTask(claimed.item, claimed.task, categoryCounts);
        } catch (error) {
          failDownloadTask(claimed.task, error);
        }
      }
    }

    const activeConcurrency = Math.min(state.downloadConcurrency, queuedTaskCount());
    await Promise.all(Array.from({ length: activeConcurrency }, (_, index) => worker(index)));

    if (!state.stopDownload && deferredTaskCount()) {
      const deferredItems = items.filter((item) => {
        const task = state.downloadTasks.get(item.path);
        return task && task.status === 'deferred';
      });
      state.status = `开始最终重试：${deferredItems.length} 个暂时放弃任务，每个最多再重试 ${FINAL_DOWNLOAD_RETRIES} 次`;
      renderDownloadProgress(true);

      async function finalRetryWorker(workerIndex) {
        if (workerIndex > 0) await sleep(workerIndex * DOWNLOAD_DELAY_MS);

        while (!state.stopDownload) {
          try {
            await waitForResume(null);
          } catch (error) {
            break;
          }
          const claimed = claimNextDownload(deferredItems, 'deferred');
          if (!claimed) {
            if (!deferredTaskCount()) break;
            await sleep(250);
            continue;
          }

          try {
            await runDownloadTask(claimed.item, claimed.task, categoryCounts, { finalPhase: true });
          } catch (error) {
            failDownloadTask(claimed.task, error);
          }
        }
      }

      const activeFinalConcurrency = Math.min(state.downloadConcurrency, deferredItems.length);
      await Promise.all(Array.from({ length: activeFinalConcurrency }, (_, index) => finalRetryWorker(index)));
    }

    state.downloading = false;
    updateDownloadStats();
    const notStarted = Math.max(0, state.downloadTotal - state.downloadDone - state.downloadSkipped - state.downloadFailed);
    state.status = state.stopDownload
      ? `下载已停止：成功 ${state.downloadDone} 个，跳过 ${state.downloadSkipped} 个，失败 ${state.downloadFailed} 个，未开始 ${notStarted} 个`
      : `下载完成：成功 ${state.downloadDone} 个，跳过 ${state.downloadSkipped} 个，失败 ${state.downloadFailed} 个`;
    render();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
      return;
    }
    navigator.clipboard.writeText(text);
  }

  function copyLinks() {
    const text = visibleItems()
      .map((item) => `${item.saveName}\t${item.path}\t${downloadUrl(item)}`)
      .join('\n');
    copyText(text);
    state.status = `已复制 ${visibleItems().length} 条链接`;
    render();
  }

  function exportJson() {
    const data = visibleItems().map((item) => ({
      name: item.name,
      saveName: item.saveName,
      kind: item.kind || mediaKindFor(item),
      path: item.path,
      size: item.size,
      modified: item.modified,
      url: downloadUrl(item),
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `universal-media-${Date.now()}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function ensureUi() {
    if (ui.host) return;

    ui.host = document.createElement('div');
    ui.host.id = APP_ID;
    ui.host.style.all = 'initial';
    document.documentElement.append(ui.host);
    ui.root = ui.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      button, input, select {
        font: inherit;
      }
      .toggle {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        height: 38px;
        padding: 0 12px;
        border: 1px solid rgba(15, 23, 42, 0.18);
        border-radius: 8px;
        background: #0f172a;
        color: #fff;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.22);
        cursor: pointer;
      }
      .panel {
        position: fixed;
        right: 18px;
        bottom: 66px;
        z-index: 2147483647;
        display: none;
        width: min(720px, calc(100vw - 24px));
        max-height: min(760px, calc(100vh - 92px));
        overflow: hidden;
        border: 1px solid rgba(15, 23, 42, 0.16);
        border-radius: 8px;
        background: #f8fafc;
        color: #0f172a;
        box-shadow: 0 18px 46px rgba(15, 23, 42, 0.24);
      }
      .panel.open {
        display: grid;
        grid-template-rows: auto auto auto 1fr auto;
      }
      .head, .bar, .summary, .foot {
        padding: 10px 12px;
        border-bottom: 1px solid #e2e8f0;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        background: #fff;
      }
      .title strong {
        display: block;
        font-size: 14px;
        line-height: 20px;
      }
      .status {
        display: block;
        max-width: 460px;
        overflow: hidden;
        color: #64748b;
        font-size: 12px;
        line-height: 18px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .actions, .bar, .summary {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }
      .button, .input, .select {
        height: 32px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        background: #fff;
        color: #0f172a;
        box-sizing: border-box;
      }
      .button {
        padding: 0 10px;
        cursor: pointer;
      }
      .button:hover {
        background: #f1f5f9;
      }
      .button.primary {
        border-color: #0f766e;
        background: #0f766e;
        color: #fff;
      }
      .button.primary:hover {
        background: #115e59;
      }
      .button.danger {
        border-color: #dc2626;
        color: #dc2626;
      }
      .button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      .input {
        min-width: 170px;
        flex: 1 1 220px;
        padding: 0 10px;
      }
      .select {
        min-width: 120px;
        padding: 0 8px;
      }
      .summary {
        background: #fff;
        color: #475569;
        font-size: 12px;
        line-height: 18px;
      }
      .list {
        min-height: 180px;
        overflow: auto;
        background: #fff;
      }
      .empty {
        padding: 24px 16px;
        color: #64748b;
        text-align: center;
        font-size: 13px;
      }
      .item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid #eef2f7;
      }
      .item:hover {
        background: #f8fafc;
      }
      .name {
        display: block;
        overflow-wrap: anywhere;
        color: #0f172a;
        font-size: 13px;
        line-height: 19px;
        font-weight: 600;
      }
      .path {
        margin-top: 3px;
        overflow-wrap: anywhere;
        color: #64748b;
        font-size: 12px;
        line-height: 18px;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 6px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        padding: 0 7px;
        border-radius: 999px;
        background: #e2e8f0;
        color: #334155;
        font-size: 12px;
      }
      .badge.audio {
        background: #fef3c7;
        color: #92400e;
      }
      .badge.download.queued {
        background: #e2e8f0;
        color: #475569;
      }
      .badge.download.downloading {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .badge.download.done {
        background: #dcfce7;
        color: #166534;
      }
      .badge.download.skipped {
        background: #fef9c3;
        color: #854d0e;
      }
      .badge.download.failed {
        background: #fee2e2;
        color: #991b1b;
      }
      .item-main {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        gap: 8px;
        align-items: start;
      }
      .check {
        width: 16px;
        height: 16px;
        margin: 2px 0 0;
      }
      .item-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .foot {
        border-bottom: 0;
        border-top: 1px solid #e2e8f0;
        color: #64748b;
        font-size: 12px;
        line-height: 18px;
      }
      @media (max-width: 560px) {
        .panel {
          right: 12px;
          bottom: 64px;
          width: calc(100vw - 24px);
        }
        .toggle {
          right: 12px;
          bottom: 14px;
        }
        .item {
          grid-template-columns: 1fr;
        }
      }
    `;

    ui.panel = document.createElement('section');
    ui.panel.className = 'panel';

    ui.toggle = button('媒体 0');
    ui.toggle.className = 'toggle';

    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('div');
    title.className = 'title';
    title.innerHTML = '<strong>通用音视频下载</strong><span class="status">等待扫描</span>';
    ui.status = title.querySelector('.status');
    const headActions = document.createElement('div');
    headActions.className = 'actions';
    ui.close = button('关闭');
    headActions.append(ui.close);
    head.append(title, headActions);

    const bar = document.createElement('div');
    bar.className = 'bar';
    ui.scanCurrent = button(isAsmrmoonSite() ? '扫描当前目录' : '扫描当前页', 'primary');
    ui.scanAll = button(isAsmrmoonSite() ? '扫描全站' : '重新扫描页面');
    ui.stop = button('停止', 'danger');
    ui.download = button('下载当前列表', 'primary');
    ui.stopDownload = button('停止下载', 'danger');
    ui.pauseAll = button('全部暂停');
    ui.resumeAll = button('全部恢复');
    ui.selectAll = button('全选');
    ui.invertSelect = button('反选');
    ui.selectMp3 = button('勾选MP3');
    ui.selectMp4 = button('勾选MP4');
    ui.copy = button('复制链接');
    ui.export = button('导出 JSON');
    bar.append(
      ui.scanCurrent,
      ui.scanAll,
      ui.stop,
      ui.download,
      ui.stopDownload,
      ui.pauseAll,
      ui.resumeAll,
      ui.selectAll,
      ui.invertSelect,
      ui.selectMp3,
      ui.selectMp4,
      ui.copy,
      ui.export,
    );

    const controls = document.createElement('div');
    controls.className = 'bar';
    ui.filter = document.createElement('input');
    ui.filter.className = 'input';
    ui.filter.type = 'search';
    ui.filter.placeholder = '搜索名称 / 路径';
    ui.nameMode = document.createElement('select');
    ui.nameMode.className = 'select';
    ui.nameMode.innerHTML = '<option value="full">文件名含目录</option><option value="original">仅原文件名</option>';
    ui.downloadMode = document.createElement('select');
    ui.downloadMode.className = 'select';
    ui.downloadMode.innerHTML = '<option value="blob">强制命名</option><option value="browser">普通直链</option><option value="directory">低内存目录</option>';
    ui.chooseDirectory = button('选择目录');
    ui.concurrency = document.createElement('select');
    ui.concurrency.className = 'select';
    ui.concurrency.innerHTML = Array.from(
      { length: MAX_DOWNLOAD_CONCURRENCY },
      (_, index) => `<option value="${index + 1}">并发 ${index + 1}</option>`,
    ).join('');
    ui.concurrency.value = String(state.downloadConcurrency);
    controls.append(ui.filter, ui.nameMode, ui.downloadMode, ui.chooseDirectory, ui.concurrency);

    ui.summary = document.createElement('div');
    ui.summary.className = 'summary';

    ui.list = document.createElement('div');
    ui.list.className = 'list';

    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.textContent = '脚本只下载站点接口或当前页面已明文返回、当前会话可访问的音视频；不会绕过登录、权限、DRM、反盗链、限速或其他访问控制。';

    ui.panel.append(head, bar, controls, ui.summary, ui.list, foot);
    ui.root.append(style, ui.panel, ui.toggle);

    let open = false;
    ui.toggle.addEventListener('click', () => {
      open = !open;
      ui.panel.classList.toggle('open', open);
      if (open && state.items.size === 0 && !state.scanning) scanCurrentSmart();
    });
    ui.close.addEventListener('click', () => {
      open = false;
      ui.panel.classList.remove('open');
    });
    ui.scanCurrent.addEventListener('click', scanCurrentSmart);
    ui.scanAll.addEventListener('click', () => scan('/'));
    ui.stop.addEventListener('click', () => {
      state.stopScan = true;
      state.status = '正在停止扫描...';
      render();
    });
    ui.download.addEventListener('click', downloadVisible);
    ui.stopDownload.addEventListener('click', () => {
      state.stopDownload = true;
      state.status = '正在停止下载...';
      render();
    });
    ui.pauseAll.addEventListener('click', pauseAllDownloads);
    ui.resumeAll.addEventListener('click', resumeAllDownloads);
    ui.selectAll.addEventListener('click', () => setVisibleSelection(true));
    ui.invertSelect.addEventListener('click', invertVisibleSelection);
    ui.selectMp3.addEventListener('click', () => selectVisibleByOutputType('mp3'));
    ui.selectMp4.addEventListener('click', () => selectVisibleByOutputType('mp4'));
    ui.copy.addEventListener('click', copyLinks);
    ui.export.addEventListener('click', exportJson);
    ui.filter.addEventListener('input', () => {
      state.filter = ui.filter.value;
      render();
    });
    ui.nameMode.addEventListener('change', () => {
      state.nameMode = ui.nameMode.value;
      render();
    });
    ui.downloadMode.addEventListener('change', () => {
      state.downloadMode = ui.downloadMode.value;
      render();
    });
    ui.chooseDirectory.addEventListener('click', async () => {
      try {
        await pickSaveDirectory();
      } catch (error) {
        state.status = `选择目录失败：${error.message || error}`;
        render();
      }
    });
    ui.concurrency.addEventListener('change', () => {
      state.downloadConcurrency = clampDownloadConcurrency(ui.concurrency.value);
      ui.concurrency.value = String(state.downloadConcurrency);
      render();
    });
  }

  function button(text, variant) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `button${variant ? ` ${variant}` : ''}`;
    element.textContent = text;
    return element;
  }

  function render() {
    if (!ui.host) return;

    const items = visibleItems();
    const listScrollTop = ui.list ? ui.list.scrollTop : 0;
    const selectedCount = items.filter((item) => state.selectedPaths.has(item.path)).length;
    const asmrmoon = isAsmrmoonSite();
    state.adapterName = adapterName();
    ui.toggle.textContent = `媒体 ${state.items.size}`;
    ui.scanCurrent.textContent = asmrmoon ? '扫描当前目录' : '扫描当前页';
    ui.scanAll.textContent = asmrmoon ? '扫描全站' : '重新扫描页面';
    ui.status.textContent = state.status;
    const modeText = downloadModeText();
    const directoryText = state.saveDirectoryName
      ? ` · 保存/查重目录：${state.saveDirectoryName}`
      : (state.downloadMode === 'directory' ? ` · 保存目录：${directoryModeSupported() ? '未选择' : '浏览器不支持'}` : '');
    const downloadText = state.downloading || state.downloadTotal
      ? ` · 并发 ${state.downloadActive}/${state.downloadConcurrency} · 速度 ${readableSpeed(state.downloadSpeed)} · 已下 ${readableTransferSize(state.downloadBytesLoaded)}/${readableTransferSize(state.downloadBytesTotal)}`
      : ` · 并发 ${state.downloadConcurrency}`;
    const skippedText = state.downloadSkipped ? ` · 已跳过 ${state.downloadSkipped}` : '';
    ui.summary.textContent = `适配器：${state.adapterName} · 当前路径：${state.rootPath} · 已扫描目录 ${state.scannedDirs} · 已扫描文件 ${state.scannedFiles} · 媒体 ${state.items.size} · 当前显示 ${items.length} · 已勾选 ${selectedCount} · 下载模式：${modeText}${directoryText}${downloadText}${skippedText}`;

    ui.scanCurrent.disabled = state.scanning || state.downloading;
    ui.scanAll.disabled = state.scanning || state.downloading;
    ui.stop.disabled = !state.scanning;
    ui.download.disabled = state.scanning || state.downloading || !selectedCount;
    ui.stopDownload.disabled = !state.downloading;
    ui.pauseAll.disabled = !state.downloading || state.globalPaused;
    ui.resumeAll.disabled = !state.downloading || !state.globalPaused;
    ui.selectAll.disabled = state.downloading || !items.length;
    ui.invertSelect.disabled = state.downloading || !items.length;
    ui.selectMp3.disabled = state.downloading || !items.some((item) => isMp3Item(item));
    ui.selectMp4.disabled = state.downloading || !items.some((item) => isMp4Item(item));
    ui.copy.disabled = !items.length;
    ui.export.disabled = !items.length;
    ui.nameMode.disabled = state.downloading;
    ui.downloadMode.disabled = state.downloading;
    ui.chooseDirectory.disabled = state.downloading || !directoryModeSupported();
    ui.chooseDirectory.textContent = state.saveDirectoryName ? `目录：${state.saveDirectoryName}` : '选择目录';
    ui.concurrency.disabled = state.downloading;

    ui.list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = state.items.size ? '当前搜索没有匹配媒体。' : '还没有媒体，点击扫描。';
      ui.list.append(empty);
      ui.list.scrollTop = listScrollTop;
      return;
    }

    const fragment = document.createDocumentFragment();
    items.slice(0, 600).forEach((item) => fragment.append(row(item)));
    if (items.length > 600) {
      const more = document.createElement('div');
      more.className = 'empty';
      more.textContent = `列表较大，仅渲染前 600 条；下载/复制仍会处理当前筛选的 ${items.length} 条。`;
      fragment.append(more);
    }
    ui.list.append(fragment);
    ui.list.scrollTop = listScrollTop;
    requestAnimationFrame(() => {
      if (ui.list) ui.list.scrollTop = listScrollTop;
    });
  }

  function row(item) {
    const wrap = document.createElement('article');
    wrap.className = 'item';

    const main = document.createElement('div');
    main.className = 'item-main';
    const check = document.createElement('input');
    check.className = 'check';
    check.type = 'checkbox';
    check.checked = state.selectedPaths.has(item.path);
    check.disabled = state.downloading;
    check.addEventListener('change', () => {
      if (check.checked) {
        state.selectedPaths.add(item.path);
      } else {
        state.selectedPaths.delete(item.path);
      }
      render();
    });
    const content = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.saveName;
    const path = document.createElement('div');
    path.className = 'path';
    path.textContent = item.path;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.append(badge(mediaLabelFor(item), 'audio'), badge(readableSize(item.size)), badge(extension(item.name).toUpperCase() || 'MEDIA'));
    const task = state.downloadTasks.get(item.path);
    if (task) meta.append(badge(downloadTaskLabel(task), `download ${task.status}`));
    if (task && task.folder) meta.append(badge(task.folder));
    content.append(name, path, meta);
    main.append(check, content);

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const one = button('下载');
    one.disabled = state.downloading;
    one.addEventListener('click', async () => {
      one.disabled = true;
      try {
        const singleCategoryCounts = categoryCountsFor([item]);
        state.forceFileSystemNaming = false;
        if (!directoryModeSupported()) {
          state.status = '当前浏览器不支持读取本地下载目录，无法自动跳过已存在文件';
          return;
        }

        await ensureSaveDirectory();
        state.stopDownload = false;
        state.forceFileSystemNaming = state.downloadMode === 'blob' && needsStrongDirectoryNaming([item], singleCategoryCounts);

        state.status = `正在扫描保存目录：${state.saveDirectoryName || '已选择目录'}`;
        render();
        const existing = await scanExistingDownloadMedia(state.saveDirectoryHandle);
        const outputName = outputDownloadNameFor(item, singleCategoryCounts);
        if (existingDownloadMatchesName(existing, outputName)) {
          state.status = `已跳过：${downloadFileNamePart(outputName)} 已存在`;
          return;
        }

        let lastError = null;
        for (let attempt = 0; attempt <= MAX_DOWNLOAD_RETRIES; attempt += 1) {
          try {
            state.status = attempt ? `正在重试 ${attempt}/${MAX_DOWNLOAD_RETRIES}：${item.saveName}` : `正在下载：${item.saveName}`;
            render();
            await downloadOne(item, true, null, singleCategoryCounts);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (attempt >= MAX_DOWNLOAD_RETRIES || !retryableError(error)) break;
            await sleep(retryDelayMs(attempt + 1));
          }
        }
        if (lastError && retryableError(lastError)) {
          state.status = `暂时放弃后开始最终重试：${item.saveName}`;
          render();
          for (let attempt = 1; attempt <= FINAL_DOWNLOAD_RETRIES; attempt += 1) {
            try {
              state.status = `最终重试 ${attempt}/${FINAL_DOWNLOAD_RETRIES}：${item.saveName}`;
              render();
              await downloadOne(item, true, null, singleCategoryCounts);
              lastError = null;
              break;
            } catch (error) {
              lastError = error;
              if (attempt >= FINAL_DOWNLOAD_RETRIES || !retryableError(error)) break;
              await sleep(retryDelayMs(attempt));
            }
          }
        }
        if (lastError) throw lastError;
        state.status = `已下载：${item.saveName}`;
      } catch (error) {
        state.status = `下载失败：${error.message || error}`;
      } finally {
        one.disabled = false;
        render();
      }
    });
    const open = button('打开');
    open.addEventListener('click', async () => {
      const fresh = await refreshItem(item);
      window.open(downloadUrl(fresh), '_blank', 'noopener,noreferrer');
    });
    const copy = button('复制');
    copy.addEventListener('click', async () => {
      const fresh = await refreshItem(item);
      copyText(`${displayNameFor(fresh)}\n${downloadUrl(fresh)}`);
      state.status = `已复制：${displayNameFor(fresh)}`;
      render();
    });
    const pause = button(task && task.paused ? '恢复' : '暂停');
    pause.disabled = !task || !state.downloading || task.status === 'done' || task.status === 'failed';
    pause.addEventListener('click', () => {
      const current = state.downloadTasks.get(item.path);
      if (!current) return;
      if (current.paused) {
        resumeTaskByPath(item.path);
      } else {
        pauseTaskByPath(item.path);
      }
    });
    actions.append(one, pause, open, copy);
    wrap.append(main, actions);
    return wrap;
  }

  function badge(text, className) {
    const element = document.createElement('span');
    element.className = `badge${className ? ` ${className}` : ''}`;
    element.textContent = text;
    return element;
  }

  ensureUi();
  render();
})();
