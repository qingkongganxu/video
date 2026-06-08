import crypto from 'node:crypto';
import path from 'node:path';

export const USER_AGENT =
  'SameOriginResourceCrawler/1.0 (+https://example.local; public resources only)';

const IMAGE_EXTENSIONS = new Set([
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp'
]);

const VIDEO_EXTENSIONS = new Set([
  '.avi',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ogv',
  '.webm'
]);

const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
  '.weba'
]);

const DOCUMENT_EXTENSIONS = new Set([
  '.7z',
  '.csv',
  '.doc',
  '.docx',
  '.epub',
  '.gz',
  '.json',
  '.pdf',
  '.ppt',
  '.pptx',
  '.rar',
  '.tar',
  '.tgz',
  '.txt',
  '.xls',
  '.xlsx',
  '.xml',
  '.zip'
]);

const STREAM_EXTENSIONS = new Set(['.m3u8', '.mpd']);

const HTML_PAGE_EXTENSIONS = new Set([
  '',
  '.asp',
  '.aspx',
  '.htm',
  '.html',
  '.jsp',
  '.php',
  '.shtml',
  '.xhtml'
]);

export const TYPE_DIRECTORIES = {
  image: 'images',
  video: 'videos',
  audio: 'audios',
  document: 'documents',
  stream: 'streams',
  other: 'other'
};

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

export function resolveHttpUrl(value, baseUrl) {
  if (!value) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  if (
    lowered.startsWith('data:') ||
    lowered.startsWith('blob:') ||
    lowered.startsWith('javascript:') ||
    lowered.startsWith('mailto:') ||
    lowered.startsWith('tel:') ||
    lowered.startsWith('about:')
  ) {
    return null;
  }

  try {
    return normalizeUrl(new URL(trimmed, baseUrl).href);
  } catch {
    return null;
  }
}

export function getExtensionFromUrl(resourceUrl) {
  try {
    const pathname = new URL(resourceUrl).pathname.toLowerCase();
    if (pathname.endsWith('.tar.gz')) {
      return '.tar.gz';
    }
    return path.extname(pathname);
  } catch {
    return '';
  }
}

export function inferResourceType(resourceUrl, contentType = '') {
  const mime = String(contentType).split(';')[0].trim().toLowerCase();
  if (mime.startsWith('image/')) {
    return 'image';
  }
  if (mime.startsWith('video/')) {
    return 'video';
  }
  if (mime.startsWith('audio/')) {
    return 'audio';
  }
  if (
    mime === 'application/pdf' ||
    mime.includes('zip') ||
    mime.includes('rar') ||
    mime.includes('7z') ||
    mime.includes('officedocument') ||
    mime.includes('msword') ||
    mime.includes('excel') ||
    mime.includes('powerpoint') ||
    mime === 'text/csv'
  ) {
    return 'document';
  }
  if (
    mime === 'application/vnd.apple.mpegurl' ||
    mime === 'application/x-mpegurl' ||
    mime === 'audio/mpegurl' ||
    mime === 'application/dash+xml'
  ) {
    return 'stream';
  }

  const extension = getExtensionFromUrl(resourceUrl);
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'video';
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return 'audio';
  }
  if (STREAM_EXTENSIONS.has(extension)) {
    return 'stream';
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return 'document';
  }

  return 'other';
}

export function isCollectibleResource(resourceUrl, contentType = '') {
  return inferResourceType(resourceUrl, contentType) !== 'other';
}

export function isLikelyHtmlPage(candidateUrl) {
  try {
    const url = new URL(candidateUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }
    const extension = getExtensionFromUrl(url.href);
    return HTML_PAGE_EXTENSIONS.has(extension);
  } catch {
    return false;
  }
}

export function parseNumericOption(value, fallback, minimum = 0) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }
  return parsed;
}

export function safeDomain(hostname) {
  return hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sanitizeFilename(name, fallback = 'resource') {
  const cleaned = decodeSafe(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');

  return (cleaned || fallback).slice(0, 140);
}

export function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function shortHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);
}

export function filenameFromUrl(resourceUrl, options = {}) {
  const { fallback = 'resource', forcedExtension, suffix } = options;
  let basename = fallback;
  let extension = forcedExtension || '';

  try {
    const url = new URL(resourceUrl);
    const urlBasename = path.posix.basename(url.pathname);
    if (urlBasename) {
      basename = urlBasename;
    }
    if (!extension) {
      extension = getExtensionFromUrl(resourceUrl);
    }
  } catch {
    // Keep fallback values.
  }

  const currentExtension = extension && basename.toLowerCase().endsWith(extension)
    ? extension
    : path.extname(basename);
  const stem = currentExtension ? basename.slice(0, -currentExtension.length) : basename;
  const safeStem = sanitizeFilename(stem, fallback);
  const safeSuffix = suffix ? `-${sanitizeFilename(suffix, 'variant')}` : '';
  const finalExtension = forcedExtension || currentExtension || extension || '.bin';

  return `${safeStem}${safeSuffix}-${shortHash(resourceUrl)}${finalExtension}`;
}

export function extensionForType(type, contentType = '', resourceUrl = '') {
  const existing = getExtensionFromUrl(resourceUrl);
  if (existing && existing !== '.m3u8' && existing !== '.mpd') {
    return existing;
  }

  const mime = String(contentType).split(';')[0].trim().toLowerCase();
  const byMime = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/svg+xml': '.svg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'application/pdf': '.pdf',
    'application/zip': '.zip'
  };

  if (byMime[mime]) {
    return byMime[mime];
  }

  const byType = {
    image: '.img',
    video: '.mp4',
    audio: '.audio',
    document: '.bin',
    stream: '.mp4',
    other: '.bin'
  };

  return byType[type] || '.bin';
}

export function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

export function resolutionLabel(width, height, fallback) {
  if (width && height) {
    return `${width}x${height}`;
  }
  if (width) {
    return `${width}w`;
  }
  return fallback || '';
}

export function inferResolutionFromUrl(resourceUrl) {
  try {
    const decoded = decodeSafe(new URL(resourceUrl).pathname);
    const match = decoded.match(/(?:^|[^0-9])([1-9][0-9]{2,4})[xX]([1-9][0-9]{2,4})(?:[^0-9]|$)/);
    if (!match) {
      return {};
    }
    const width = Number.parseInt(match[1], 10);
    const height = Number.parseInt(match[2], 10);
    return { width, height, resolution: `${width}x${height}` };
  } catch {
    return {};
  }
}

export function makeAbortSignal(timeoutMs) {
  if (AbortSignal.timeout) {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}
