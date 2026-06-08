import * as cheerio from 'cheerio';
import { makeAbortSignal, resolveHttpUrl, resolutionLabel, USER_AGENT } from './utils.js';

export async function discoverStreamVariants(resource, options = {}) {
  const url = typeof resource === 'string' ? resource : resource.url;
  const timeout = options.timeout || 30000;
  const response = await fetch(url, {
    headers: {
      accept:
        'application/vnd.apple.mpegurl, application/x-mpegurl, application/dash+xml, text/plain, */*',
      'user-agent': USER_AGENT
    },
    redirect: 'follow',
    signal: makeAbortSignal(timeout)
  });

  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const loweredUrl = url.toLowerCase();

  if (loweredUrl.includes('.mpd') || contentType.includes('dash') || /^\s*<MPD[\s>]/i.test(text)) {
    return parseDashVariants(text, url);
  }

  return parseM3u8Variants(text, url);
}

export function parseM3u8Variants(text, manifestUrl) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const encrypted = lines.some((line) => /^#EXT-X-KEY:/i.test(line) && !/METHOD=NONE/i.test(line));
  const variants = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.toUpperCase().startsWith('#EXT-X-STREAM-INF:')) {
      continue;
    }

    const attributes = parseAttributeList(line.slice(line.indexOf(':') + 1));
    const nextUri = findNextUri(lines, index + 1);
    if (!nextUri) {
      continue;
    }

    const [width, height] = String(attributes.RESOLUTION || '')
      .split(/[xX]/)
      .map((part) => Number.parseInt(part, 10) || null);

    variants.push({
      url: resolveHttpUrl(nextUri, manifestUrl),
      inputUrl: resolveHttpUrl(nextUri, manifestUrl),
      manifestUrl,
      protocol: 'hls',
      type: 'stream',
      width,
      height,
      resolution: resolutionLabel(width, height),
      bandwidth: attributes.BANDWIDTH || '',
      codecs: attributes.CODECS || '',
      encrypted
    });
  }

  if (variants.length === 0) {
    variants.push({
      url: manifestUrl,
      inputUrl: manifestUrl,
      manifestUrl,
      protocol: 'hls',
      type: 'stream',
      width: null,
      height: null,
      resolution: '',
      bandwidth: '',
      codecs: '',
      encrypted
    });
  }

  return variants.filter((variant) => Boolean(variant.url));
}

export function parseDashVariants(text, manifestUrl) {
  const $ = cheerio.load(text, { xmlMode: true });
  const encrypted = $('ContentProtection').length > 0;
  const variants = [];

  $('Representation').each((index, element) => {
    const representation = $(element);
    const adaptation = representation.parents('AdaptationSet').first();
    const mimeType =
      representation.attr('mimeType') || adaptation.attr('mimeType') || adaptation.attr('contentType') || '';
    if (mimeType && !String(mimeType).toLowerCase().includes('video')) {
      return;
    }

    const width = numberAttr(representation.attr('width') || adaptation.attr('width'));
    const height = numberAttr(representation.attr('height') || adaptation.attr('height'));
    const representationBase = representation.children('BaseURL').first().text().trim();
    const adaptationBase = adaptation.children('BaseURL').first().text().trim();
    const mpdBase = $('MPD > BaseURL').first().text().trim();
    const variantUrl = resolveHttpUrl(representationBase || adaptationBase || mpdBase || manifestUrl, manifestUrl);

    variants.push({
      url: variantUrl || manifestUrl,
      inputUrl: manifestUrl,
      manifestUrl,
      protocol: 'dash',
      type: 'stream',
      width,
      height,
      resolution: resolutionLabel(width, height),
      bandwidth: representation.attr('bandwidth') || '',
      codecs: representation.attr('codecs') || '',
      representationId: representation.attr('id') || '',
      dashMapIndex: index,
      encrypted
    });
  });

  if (variants.length === 0) {
    variants.push({
      url: manifestUrl,
      inputUrl: manifestUrl,
      manifestUrl,
      protocol: 'dash',
      type: 'stream',
      width: null,
      height: null,
      resolution: '',
      bandwidth: '',
      codecs: '',
      representationId: '',
      dashMapIndex: 0,
      encrypted
    });
  }

  return variants;
}

function parseAttributeList(value) {
  const attributes = {};
  const pattern = /([A-Z0-9-]+)=("(?:[^"]*)"|[^,]*)/gi;
  let match;
  while ((match = pattern.exec(value))) {
    attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, '');
  }
  return attributes;
}

function findNextUri(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('#')) {
      return line;
    }
  }
  return null;
}

function numberAttr(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
