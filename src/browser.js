import { extractFromHtml } from './extract.js';
import { inferResourceType, isCollectibleResource, normalizeUrl, USER_AGENT } from './utils.js';

export async function createBrowserRenderer(options = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    return unavailable(`Playwright is not installed: ${error.message}`);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    return unavailable(`Playwright browser could not be launched: ${error.message}`);
  }

  return {
    available: true,
    async render(url, origin) {
      const context = await browser.newContext({
        userAgent: USER_AGENT,
        ignoreHTTPSErrors: true
      });
      const page = await context.newPage();
      const networkResources = [];

      page.on('response', (response) => {
        const responseUrl = response.url();
        const headers = response.headers();
        const contentType = headers['content-type'] || '';
        if (!isCollectibleResource(responseUrl, contentType)) {
          return;
        }

        networkResources.push({
          url: normalizeUrl(responseUrl),
          sourcePage: url,
          source: 'browser-network',
          type: inferResourceType(responseUrl, contentType),
          contentType,
          status: response.status(),
          contentLength: headers['content-length'] || '',
          width: null,
          height: null,
          resolution: ''
        });
      });

      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: options.timeout || 30000
        });
        await page.waitForLoadState('networkidle', {
          timeout: Math.min(options.timeout || 30000, 10000)
        }).catch(() => {});

        const html = await page.content();
        const extracted = extractFromHtml(html, url, origin);
        return {
          resources: [...extracted.resources, ...networkResources],
          links: extracted.links
        };
      } finally {
        await context.close().catch(() => {});
      }
    },
    async close() {
      await browser.close().catch(() => {});
    }
  };
}

function unavailable(reason) {
  return {
    available: false,
    reason,
    async render() {
      throw new Error(reason);
    },
    async close() {}
  };
}
