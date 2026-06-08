#!/usr/bin/env node
import { crawlSite } from './crawler.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const manifest = await crawlSite(options);
  const summary = manifest.summary;

  console.log(`Visited pages: ${summary.pagesVisited}`);
  console.log(`Resources found: ${summary.resourcesFound}`);
  console.log(`Manifest entries: ${summary.manifestEntries}`);
  console.log(`Downloaded: ${summary.downloaded}`);
  console.log(`Failed/skipped: ${summary.failed}`);
  console.log(`Output: ${manifest.outputDirectory}`);
  console.log(`Manifest JSON: ${manifest.manifestPaths.jsonPath}`);
  console.log(`Manifest CSV: ${manifest.manifestPaths.csvPath}`);

  if (manifest.warnings.length > 0) {
    console.warn('\nWarnings:');
    for (const warning of manifest.warnings) {
      console.warn(`- ${warning}`);
    }
  }
}

function parseArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--no-browser') {
      options.browser = false;
      continue;
    }
    if (arg === '--manifest-only') {
      options.manifestOnly = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[key] = value;
    index += 1;
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run crawl -- --url https://example.com [options]

Options:
  --url <url>            Entry URL. Required.
  --depth <n>            Crawl depth. Default: 2.
  --max-pages <n>        Maximum same-origin pages. Default: 200.
  --out <dir>            Output directory. Default: downloads.
  --concurrency <n>      Concurrent page/resource work. Default: 4.
  --timeout <ms>         Request timeout. Default: 30000.
  --no-browser           Disable Playwright rendering.
  --manifest-only        Write manifests without downloading files.
  --help                 Show this help.
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
