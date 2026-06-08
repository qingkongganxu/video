import * as cheerio from 'cheerio';
import {
  inferResourceType,
  inferResolutionFromUrl,
  isLikelyHtmlPage,
  normalizeUrl,
  resolveHttpUrl,
  resolutionLabel
} from './utils.js';

export function extractFromHtml(html, pageUrl, origin) {
  const $ = cheerio.load(html);
  const resources = [];
  const links = [];
  const seenLinks = new Set();

  function addLink(value) {
    const resolved = resolveHttpUrl(value, pageUrl);
    if (!resolved) {
      return;
    }
    const url = new URL(resolved);
    if (url.origin !== origin || !isLikelyHtmlPage(resolved) || seenLinks.has(resolved)) {
      return;
    }
    seenLinks.add(resolved);
    links.push(resolved);
  }

  function addResource(value, details = {}) {
    const resolved = resolveHttpUrl(value, pageUrl);
    if (!resolved) {
      return;
    }

    const type = details.type || inferResourceType(resolved, details.contentType);
    if (type === 'other' && !details.allowOther) {
      return;
    }

    const inferredResolution = inferResolutionFromUrl(resolved);
    const width = details.width || inferredResolution.width || null;
    const height = details.height || inferredResolution.height || null;
    const resolution =
      details.resolution || inferredResolution.resolution || resolutionLabel(width, height, details.descriptor);

    resources.push({
      url: normalizeUrl(resolved),
      sourcePage: pageUrl,
      source: details.source || 'html',
      type,
      contentType: details.contentType || '',
      width,
      height,
      resolution,
      descriptor: details.descriptor || '',
      label: details.label || ''
    });
  }

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const resolved = resolveHttpUrl(href, pageUrl);
    if (!resolved) {
      return;
    }

    const type = inferResourceType(resolved);
    if (type !== 'other') {
      addResource(href, {
        type,
        source: 'a[href]',
        label: cleanText($(element).text())
      });
      return;
    }

    if ($(element).attr('download') !== undefined) {
      addResource(href, {
        type: 'other',
        allowOther: true,
        source: 'a[download]',
        label: cleanText($(element).text())
      });
      return;
    }

    addLink(href);
  });

  $('img').each((_, element) => {
    const image = $(element);
    const width = parseDimension(image.attr('width'));
    const height = parseDimension(image.attr('height'));
    const alt = cleanText(image.attr('alt'));

    for (const attr of ['src', 'data-src', 'data-original', 'data-lazy-src']) {
      addResource(image.attr(attr), {
        type: 'image',
        source: `img[${attr}]`,
        width,
        height,
        label: alt
      });
    }

    for (const candidate of parseSrcset(image.attr('srcset'))) {
      addResource(candidate.url, {
        type: 'image',
        source: 'img[srcset]',
        descriptor: candidate.descriptor,
        width: candidate.width || width,
        height,
        resolution: candidate.resolution,
        label: alt
      });
    }
  });

  $('picture source[srcset], source[srcset]').each((_, element) => {
    const source = $(element);
    for (const candidate of parseSrcset(source.attr('srcset'))) {
      addResource(candidate.url, {
        type: 'image',
        contentType: source.attr('type') || '',
        source: 'source[srcset]',
        descriptor: candidate.descriptor,
        width: candidate.width,
        resolution: candidate.resolution
      });
    }
  });

  $('video').each((_, element) => {
    const video = $(element);
    const width = parseDimension(video.attr('width'));
    const height = parseDimension(video.attr('height'));
    addResource(video.attr('src'), {
      type: 'video',
      source: 'video[src]',
      width,
      height
    });
    addResource(video.attr('poster'), {
      type: 'image',
      source: 'video[poster]'
    });
  });

  $('audio').each((_, element) => {
    addResource($(element).attr('src'), {
      type: 'audio',
      source: 'audio[src]'
    });
  });

  $('video source[src], audio source[src]').each((_, element) => {
    const source = $(element);
    const parentName = source.parent().prop('tagName')?.toLowerCase();
    addResource(source.attr('src'), {
      type: parentName === 'audio' ? 'audio' : 'video',
      contentType: source.attr('type') || '',
      source: `${parentName || 'media'} source[src]`
    });
  });

  $('link[href]').each((_, element) => {
    const link = $(element);
    const rel = String(link.attr('rel') || '').toLowerCase();
    const as = String(link.attr('as') || '').toLowerCase();
    const href = link.attr('href');
    const resolved = resolveHttpUrl(href, pageUrl);
    if (!resolved) {
      return;
    }

    if (rel.includes('icon')) {
      addResource(href, { type: 'image', source: 'link[icon]' });
      return;
    }

    const preloadType = asToResourceType(as);
    if (preloadType) {
      addResource(href, {
        type: preloadType,
        contentType: link.attr('type') || '',
        source: 'link[preload]'
      });
      return;
    }

    const type = inferResourceType(resolved, link.attr('type') || '');
    if (type !== 'other') {
      addResource(href, {
        type,
        contentType: link.attr('type') || '',
        source: 'link[href]'
      });
    }
  });

  $('meta[content]').each((_, element) => {
    const meta = $(element);
    const key = `${meta.attr('property') || ''} ${meta.attr('name') || ''}`.toLowerCase();
    if (!/(image|video|audio|pdf|download|media)/.test(key)) {
      return;
    }
    const content = meta.attr('content');
    const type =
      key.includes('image') ? 'image' : key.includes('video') ? 'video' : key.includes('audio') ? 'audio' : undefined;
    addResource(content, {
      type,
      source: 'meta[content]'
    });
  });

  $('[data-src], [data-url], [data-href]').each((_, element) => {
    const item = $(element);
    for (const attr of ['data-src', 'data-url', 'data-href']) {
      const value = item.attr(attr);
      const resolved = resolveHttpUrl(value, pageUrl);
      if (resolved && inferResourceType(resolved) !== 'other') {
        addResource(value, {
          type: inferResourceType(resolved),
          source: `[${attr}]`
        });
      }
    }
  });

  $('[style]').each((_, element) => {
    const style = $(element).attr('style') || '';
    for (const value of extractCssUrls(style)) {
      const resolved = resolveHttpUrl(value, pageUrl);
      if (resolved && inferResourceType(resolved) !== 'other') {
        addResource(value, {
          type: inferResourceType(resolved),
          source: 'inline-style'
        });
      }
    }
  });

  return {
    resources,
    links,
    hasScript: $('script').length > 0
  };
}

export function parseSrcset(srcset) {
  if (!srcset) {
    return [];
  }

  return String(srcset)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, ...descriptors] = part.split(/\s+/);
      const descriptor = descriptors.join(' ');
      const widthMatch = descriptor.match(/(\d+)w\b/);
      const densityMatch = descriptor.match(/(\d+(?:\.\d+)?)x\b/);
      const width = widthMatch ? Number.parseInt(widthMatch[1], 10) : null;
      const resolution = width ? `${width}w` : densityMatch ? `${densityMatch[1]}x` : descriptor;
      return {
        url,
        descriptor,
        width,
        density: densityMatch ? densityMatch[1] : null,
        resolution
      };
    });
}

function parseDimension(value) {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(String(value).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function asToResourceType(asValue) {
  const map = {
    audio: 'audio',
    document: 'document',
    fetch: null,
    image: 'image',
    object: 'document',
    video: 'video'
  };
  return map[asValue] || null;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractCssUrls(style) {
  const urls = [];
  const pattern = /url\((['"]?)(.*?)\1\)/gi;
  let match;
  while ((match = pattern.exec(style))) {
    urls.push(match[2]);
  }
  return urls;
}
