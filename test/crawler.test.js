import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { crawlSite } from '../src/crawler.js';
import { parseDashVariants, parseM3u8Variants } from '../src/streams.js';

test('discovers same-origin media, documents, srcset variants, stream variants, and depth-2 pages', async () => {
  await withFixtureServer(async (baseUrl) => {
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'resource-crawler-'));
    const manifest = await crawlSite({
      url: `${baseUrl}/`,
      depth: 2,
      maxPages: 20,
      out,
      concurrency: 2,
      timeout: 5000,
      browser: false,
      manifestOnly: true,
      requestDelayMs: 0
    });

    const paths = manifest.resources.map((resource) => new URL(resource.url).pathname);
    assert.equal(manifest.pages.length, 3);
    assert(paths.includes('/assets/photo-320.jpg'));
    assert(paths.includes('/assets/photo-640.jpg'));
    assert(paths.includes('/assets/photo-1280.webp'));
    assert(paths.includes('/docs/file.pdf'));
    assert(paths.includes('/audio/sound.mp3'));
    assert(paths.includes('/docs/deep.zip'));
    assert(paths.includes('/streams/master.m3u8'));
    assert(paths.includes('/streams/low/prog.m3u8'));
    assert(paths.includes('/streams/high/prog.m3u8'));
    assert(!manifest.pages.some((page) => page.url.includes('outside.example')));
    assert(manifest.resources.some((resource) => resource.resolution === '640x360'));
    assert(manifest.resources.some((resource) => resource.resolution === '1280x720'));

    const manifestJson = await fs.readFile(manifest.manifestPaths.jsonPath, 'utf8');
    assert.match(manifestJson, /photo-640\.jpg/);
  });
});

test('downloads direct public resources and records local paths', async () => {
  await withFixtureServer(async (baseUrl) => {
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'resource-crawler-'));
    const manifest = await crawlSite({
      url: `${baseUrl}/download.html`,
      depth: 0,
      maxPages: 5,
      out,
      concurrency: 2,
      timeout: 5000,
      browser: false,
      manifestOnly: false,
      requestDelayMs: 0
    });

    const image = manifest.resources.find((resource) => resource.url.endsWith('/assets/photo-320.jpg'));
    const pdf = manifest.resources.find((resource) => resource.url.endsWith('/docs/file.pdf'));
    assert(image?.downloaded);
    assert(pdf?.downloaded);
    assert.equal(await fs.readFile(image.localPath, 'utf8'), 'jpg-320');
    assert.equal(await fs.readFile(pdf.localPath, 'utf8'), 'pdf-file');
  });
});

test('parses HLS and DASH variant metadata', () => {
  const hls = parseM3u8Variants(
    `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1"
low/prog.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080
high/prog.m3u8`,
    'https://example.com/streams/master.m3u8'
  );

  assert.equal(hls.length, 2);
  assert.equal(hls[0].url, 'https://example.com/streams/low/prog.m3u8');
  assert.equal(hls[1].resolution, '1920x1080');

  const dash = parseDashVariants(
    `<MPD>
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="v1" width="640" height="360" bandwidth="800000" />
      <Representation id="v2" width="1280" height="720" bandwidth="1800000" />
    </AdaptationSet>
  </Period>
</MPD>`,
    'https://example.com/streams/manifest.mpd'
  );

  assert.equal(dash.length, 2);
  assert.equal(dash[0].resolution, '640x360');
  assert.equal(dash[1].inputUrl, 'https://example.com/streams/manifest.mpd');
});

async function withFixtureServer(callback) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const route = routes[url.pathname];

    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }

    response.writeHead(200, {
      'content-type': route.contentType,
      'content-length': Buffer.byteLength(route.body)
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(route.body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const routes = {
  '/': html(`<!doctype html>
    <html>
      <body>
        <img src="/assets/photo-320.jpg" srcset="/assets/photo-320.jpg 320w, /assets/photo-640.jpg 640w" alt="Photo">
        <picture>
          <source srcset="/assets/photo-1280.webp 1280w" type="image/webp">
          <img src="/assets/photo-fallback.jpg">
        </picture>
        <a href="/docs/file.pdf">PDF</a>
        <video width="1280" height="720"><source src="/video/movie-1280x720.mp4" type="video/mp4"></video>
        <a href="/streams/master.m3u8">HLS</a>
        <a href="/page1.html">Page 1</a>
        <a href="https://outside.example/page.html">Outside</a>
      </body>
    </html>`),
  '/page1.html': html(`<!doctype html>
    <html>
      <body>
        <audio src="/audio/sound.mp3"></audio>
        <a href="/page2.html">Page 2</a>
      </body>
    </html>`),
  '/page2.html': html(`<!doctype html>
    <html>
      <body>
        <a href="/docs/deep.zip">Deep ZIP</a>
      </body>
    </html>`),
  '/download.html': html(`<!doctype html>
    <html>
      <body>
        <img src="/assets/photo-320.jpg">
        <a href="/docs/file.pdf">PDF</a>
      </body>
    </html>`),
  '/assets/photo-320.jpg': body('jpg-320', 'image/jpeg'),
  '/assets/photo-640.jpg': body('jpg-640', 'image/jpeg'),
  '/assets/photo-1280.webp': body('webp-1280', 'image/webp'),
  '/assets/photo-fallback.jpg': body('fallback', 'image/jpeg'),
  '/docs/file.pdf': body('pdf-file', 'application/pdf'),
  '/docs/deep.zip': body('zip-file', 'application/zip'),
  '/video/movie-1280x720.mp4': body('mp4-file', 'video/mp4'),
  '/audio/sound.mp3': body('mp3-file', 'audio/mpeg'),
  '/streams/master.m3u8': body(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/prog.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720
high/prog.m3u8`, 'application/vnd.apple.mpegurl'),
  '/streams/low/prog.m3u8': body('#EXTM3U\n#EXT-X-ENDLIST', 'application/vnd.apple.mpegurl'),
  '/streams/high/prog.m3u8': body('#EXTM3U\n#EXT-X-ENDLIST', 'application/vnd.apple.mpegurl')
};

function html(value) {
  return body(value, 'text/html; charset=utf-8');
}

function body(value, contentType) {
  return {
    body: value,
    contentType
  };
}
