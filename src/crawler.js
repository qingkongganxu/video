import path from 'node:path';
import { createBrowserRenderer } from './browser.js';
import { extractFromHtml } from './extract.js';
import { processResources, prepareOutputDirectories } from './download.js';
import { writeManifest } from './manifest.js';
import {
  delay,
  inferResourceType,
  isLikelyHtmlPage,
  makeAbortSignal,
  normalizeUrl,
  parseNumericOption,
  runPool,
  safeDomain,
  USER_AGENT
} from './utils.js';

const DEFAULTS = {
  depth: 2,
  maxPages: 200,
  out: 'downloads',
  concurrency: 4,
  timeout: 30000,
  browser: true,
  manifestOnly: false,
  requestDelayMs: 200
};

export async function crawlSite(rawOptions) {
  const options = normalizeOptions(rawOptions);
  const entryUrl = normalizeUrl(options.url);
  const entry = new URL(entryUrl);
  const origin = entry.origin;
  const domain = safeDomain(entry.hostname);
  const outputDirectory = path.resolve(options.out, domain);
  const pages = [];
  const errors = [];
  const warnings = [];
  const resourceMap = new Map();

  await prepareOutputDirectories(options.out, domain);

  let renderer = null;
  if (options.browser) {
    renderer = await createBrowserRenderer({ timeout: options.timeout });
    if (!renderer.available) {
      warnings.push(renderer.reason);
      renderer = null;
    }
  }

  const scheduled = new Set([entryUrl]);
  let currentLevel = [entryUrl];

  try {
    for (let currentDepth = 0; currentDepth <= options.depth; currentDepth += 1) {
      if (currentLevel.length === 0 || pages.length >= options.maxPages) {
        break;
      }

      const remaining = options.maxPages - pages.length;
      const pageBatch = currentLevel.slice(0, remaining);
      const results = await runPool(pageBatch, options.concurrency, async (pageUrl) => {
        const result = await processPage(pageUrl, currentDepth, origin, options, renderer);
        if (options.requestDelayMs > 0) {
          await delay(options.requestDelayMs);
        }
        return result;
      });

      const nextLevel = [];
      for (const result of results) {
        pages.push(result.page);
        if (result.page.error) {
          errors.push({ url: result.page.url, error: result.page.error });
        }
        for (const resource of result.resources) {
          mergeResource(resourceMap, resource);
        }
        for (const link of result.links) {
          if (
            scheduled.size < options.maxPages &&
            !scheduled.has(link) &&
            new URL(link).origin === origin &&
            isLikelyHtmlPage(link)
          ) {
            scheduled.add(link);
            nextLevel.push(link);
          }
        }
      }

      currentLevel = nextLevel;
    }
  } finally {
    await renderer?.close();
  }

  const resources = [...resourceMap.values()];
  const manifestResources = await processResources(resources, {
    ...options,
    domain
  });

  const manifest = {
    generatedAt: new Date().toISOString(),
    entryUrl,
    origin,
    options: {
      depth: options.depth,
      maxPages: options.maxPages,
      concurrency: options.concurrency,
      timeout: options.timeout,
      browser: options.browser,
      manifestOnly: options.manifestOnly
    },
    outputDirectory,
    pages,
    resources: manifestResources,
    errors,
    warnings,
    summary: {
      pagesVisited: pages.length,
      resourcesFound: resources.length,
      manifestEntries: manifestResources.length,
      downloaded: manifestResources.filter((resource) => resource.downloaded).length,
      failed: manifestResources.filter((resource) => resource.error).length
    }
  };

  const manifestPaths = await writeManifest(manifest, outputDirectory);
  manifest.manifestPaths = manifestPaths;
  return manifest;
}

async function processPage(pageUrl, depth, origin, options, renderer) {
  const page = {
    url: pageUrl,
    depth,
    status: '',
    contentType: '',
    rendered: false,
    resourceCount: 0,
    linkCount: 0,
    error: ''
  };
  const resources = [];
  const links = [];

  try {
    const response = await fetch(pageUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': USER_AGENT
      },
      redirect: 'follow',
      signal: makeAbortSignal(options.timeout)
    });

    page.status = response.status;
    page.contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      page.error = `HTTP ${response.status}`;
      return { page, resources, links };
    }

    if (!isHtmlResponse(pageUrl, page.contentType)) {
      resources.push({
        url: pageUrl,
        sourcePage: pageUrl,
        source: 'entry-non-html',
        type: inferResourceType(pageUrl, page.contentType),
        contentType: page.contentType,
        status: page.status
      });
      return { page, resources, links };
    }

    const html = await response.text();
    const extracted = extractFromHtml(html, pageUrl, origin);
    resources.push(...extracted.resources);
    links.push(...extracted.links);

    if (renderer && shouldRender(extracted, html)) {
      try {
        const rendered = await renderer.render(pageUrl, origin);
        resources.push(...rendered.resources);
        links.push(...rendered.links);
        page.rendered = true;
      } catch (error) {
        page.renderError = error.message;
      }
    }
  } catch (error) {
    page.error = error.message;
  }

  page.resourceCount = resources.length;
  page.linkCount = links.length;
  return { page, resources, links: [...new Set(links)] };
}

function isHtmlResponse(url, contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!mime) {
    return isLikelyHtmlPage(url);
  }
  return mime.includes('text/html') || mime.includes('application/xhtml') || mime.includes('application/xml');
}

function shouldRender(extracted, html) {
  return extracted.hasScript || extracted.resources.length === 0 || /data-(src|url|href)=/i.test(html);
}

function mergeResource(map, resource) {
  if (!resource.url) {
    return;
  }

  const normalized = normalizeUrl(resource.url);
  const key = `${normalized}|${resource.type || ''}|${resource.resolution || ''}|${resource.variantOf || ''}`;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      ...resource,
      url: normalized,
      sourcePages: resource.sourcePage ? [resource.sourcePage] : []
    });
    return;
  }

  if (resource.sourcePage && !existing.sourcePages.includes(resource.sourcePage)) {
    existing.sourcePages.push(resource.sourcePage);
  }

  for (const field of ['contentType', 'status', 'contentLength', 'width', 'height', 'resolution', 'descriptor']) {
    if (!existing[field] && resource[field]) {
      existing[field] = resource[field];
    }
  }

  if (resource.source && !String(existing.source || '').includes(resource.source)) {
    existing.source = existing.source ? `${existing.source};${resource.source}` : resource.source;
  }
}

function normalizeOptions(rawOptions = {}) {
  if (!rawOptions.url) {
    throw new Error('--url is required');
  }

  let url;
  try {
    url = normalizeUrl(rawOptions.url);
  } catch {
    throw new Error(`Invalid --url value: ${rawOptions.url}`);
  }

  const parsedUrl = new URL(url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('--url must use http or https');
  }

  return {
    ...DEFAULTS,
    ...rawOptions,
    url,
    depth: parseNumericOption(rawOptions.depth, DEFAULTS.depth, 0),
    maxPages: parseNumericOption(rawOptions.maxPages, DEFAULTS.maxPages, 1),
    concurrency: parseNumericOption(rawOptions.concurrency, DEFAULTS.concurrency, 1),
    timeout: parseNumericOption(rawOptions.timeout, DEFAULTS.timeout, 1000),
    browser: rawOptions.browser !== false,
    manifestOnly: Boolean(rawOptions.manifestOnly),
    out: rawOptions.out || DEFAULTS.out
  };
}
