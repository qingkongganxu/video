import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ffmpegPath from 'ffmpeg-static';
import { discoverStreamVariants } from './streams.js';
import {
  extensionForType,
  filenameFromUrl,
  makeAbortSignal,
  runPool,
  TYPE_DIRECTORIES,
  USER_AGENT
} from './utils.js';

export async function prepareOutputDirectories(rootDirectory, domain) {
  const baseDirectory = path.resolve(rootDirectory, domain);
  await fs.mkdir(baseDirectory, { recursive: true });
  await Promise.all(
    Object.values(TYPE_DIRECTORIES).map((directory) =>
      fs.mkdir(path.join(baseDirectory, directory), { recursive: true })
    )
  );
  return baseDirectory;
}

export async function processResources(resources, options) {
  const rootDirectory = await prepareOutputDirectories(options.out, options.domain);
  const entries = [];

  await runPool(resources, options.concurrency, async (resource) => {
    if (resource.type === 'stream') {
      const streamEntries = await processStreamResource(resource, rootDirectory, options);
      entries.push(...streamEntries);
      return;
    }

    const entry = options.manifestOnly
      ? await probeResource(resource, options)
      : await downloadDirectResource(resource, rootDirectory, options);
    entries.push(entry);
  });

  return entries.sort((left, right) => {
    const byType = String(left.type).localeCompare(String(right.type));
    if (byType !== 0) {
      return byType;
    }
    return String(left.url).localeCompare(String(right.url));
  });
}

async function probeResource(resource, options) {
  const entry = createEntry(resource);
  try {
    const response = await fetch(resource.url, {
      method: 'HEAD',
      headers: {
        'user-agent': USER_AGENT,
        accept: '*/*'
      },
      redirect: 'follow',
      signal: makeAbortSignal(options.timeout)
    });
    entry.status = response.status;
    entry.contentType = response.headers.get('content-type') || entry.contentType || '';
    entry.contentLength = response.headers.get('content-length') || entry.contentLength || '';
    entry.downloaded = false;
  } catch (error) {
    entry.error = error.message;
    entry.downloaded = false;
  }
  return entry;
}

async function downloadDirectResource(resource, rootDirectory, options) {
  const entry = createEntry(resource);
  const targetDirectory = path.join(rootDirectory, TYPE_DIRECTORIES[resource.type] || TYPE_DIRECTORIES.other);

  try {
    const response = await fetch(resource.url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: '*/*'
      },
      redirect: 'follow',
      signal: makeAbortSignal(options.timeout)
    });

    entry.status = response.status;
    entry.contentType = response.headers.get('content-type') || entry.contentType || '';
    entry.contentLength = response.headers.get('content-length') || entry.contentLength || '';

    if (!response.ok) {
      entry.error = `HTTP ${response.status}`;
      entry.downloaded = false;
      return entry;
    }

    const extension = extensionForType(resource.type, entry.contentType, resource.url);
    const filename = filenameFromUrl(resource.url, {
      fallback: resource.type,
      forcedExtension: extension,
      suffix: resource.resolution || ''
    });
    const targetPath = path.join(targetDirectory, filename);

    await fs.mkdir(targetDirectory, { recursive: true });
    await pipeline(Readable.fromWeb(response.body), await fs.open(targetPath, 'w').then((file) => file.createWriteStream()));

    entry.localPath = targetPath;
    entry.downloaded = true;
    return entry;
  } catch (error) {
    entry.error = error.message;
    entry.downloaded = false;
    return entry;
  }
}

async function processStreamResource(resource, rootDirectory, options) {
  const manifestEntry = createEntry(resource);
  manifestEntry.isManifest = true;
  const entries = [manifestEntry];

  let variants;
  try {
    variants = await discoverStreamVariants(resource, options);
    manifestEntry.variantCount = variants.length;
  } catch (error) {
    manifestEntry.error = error.message;
    manifestEntry.downloaded = false;
    return entries;
  }

  for (const variant of variants) {
    const variantResource = {
      ...resource,
      ...variant,
      url: variant.url,
      type: 'stream',
      source: `${resource.source || 'stream'}:${variant.protocol || 'variant'}`,
      sourcePage: resource.sourcePage,
      sourcePages: resource.sourcePages,
      variantOf: resource.url
    };

    const variantEntry = createEntry(variantResource);
    variantEntry.variantOf = resource.url;
    variantEntry.protocol = variant.protocol || '';
    variantEntry.bandwidth = variant.bandwidth || '';
    variantEntry.codecs = variant.codecs || '';

    if (variant.encrypted) {
      variantEntry.error = 'Encrypted stream variant skipped';
      variantEntry.downloaded = false;
      entries.push(variantEntry);
      continue;
    }

    if (options.manifestOnly) {
      variantEntry.downloaded = false;
      entries.push(variantEntry);
      continue;
    }

    const downloaded = await downloadStreamVariant(variant, variantEntry, rootDirectory, options);
    entries.push(downloaded);
  }

  return entries;
}

async function downloadStreamVariant(variant, entry, rootDirectory, options) {
  const targetDirectory = path.join(rootDirectory, TYPE_DIRECTORIES.stream);
  const filename = filenameFromUrl(variant.url || variant.inputUrl, {
    fallback: 'stream',
    forcedExtension: '.mp4',
    suffix: entry.resolution || entry.bandwidth || 'variant'
  });
  const targetPath = path.join(targetDirectory, filename);

  if (!ffmpegPath) {
    entry.error = 'ffmpeg-static did not provide an executable path';
    entry.downloaded = false;
    return entry;
  }

  const args = buildFfmpegArgs(variant, targetPath);

  try {
    await fs.mkdir(targetDirectory, { recursive: true });
    await runFfmpeg(args, options.timeout * 4);
    const stat = await fs.stat(targetPath);
    entry.localPath = targetPath;
    entry.contentLength = stat.size;
    entry.downloaded = true;
  } catch (error) {
    entry.error = error.message;
    entry.downloaded = false;
  }

  return entry;
}

function buildFfmpegArgs(variant, targetPath) {
  const inputUrl = variant.inputUrl || variant.url;
  const args = [
    '-y',
    '-loglevel',
    'error',
    '-user_agent',
    USER_AGENT,
    '-i',
    inputUrl
  ];

  if (variant.protocol === 'dash' && Number.isInteger(variant.dashMapIndex)) {
    args.push('-map', `0:v:${variant.dashMapIndex}?`, '-map', '0:a?');
  }

  args.push('-c', 'copy');
  if (String(inputUrl).toLowerCase().includes('.m3u8')) {
    args.push('-bsf:a', 'aac_adtstoasc');
  }
  args.push(targetPath);
  return args;
}

function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true
    });
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`FFmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}

function createEntry(resource) {
  return {
    url: resource.url,
    sourcePage: resource.sourcePage || '',
    sourcePages: resource.sourcePages || (resource.sourcePage ? [resource.sourcePage] : []),
    type: resource.type || 'other',
    resolution: resource.resolution || '',
    width: resource.width || '',
    height: resource.height || '',
    status: resource.status || '',
    contentType: resource.contentType || '',
    contentLength: resource.contentLength || '',
    localPath: '',
    downloaded: false,
    error: '',
    source: resource.source || ''
  };
}
