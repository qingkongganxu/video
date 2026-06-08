import fs from 'node:fs/promises';
import path from 'node:path';
import { csvEscape } from './utils.js';

const CSV_FIELDS = [
  'url',
  'sourcePage',
  'sourcePages',
  'type',
  'resolution',
  'width',
  'height',
  'status',
  'contentType',
  'contentLength',
  'localPath',
  'downloaded',
  'error',
  'source'
];

export async function writeManifest(manifest, baseDirectory) {
  await fs.mkdir(baseDirectory, { recursive: true });

  const jsonPath = path.join(baseDirectory, 'manifest.json');
  const csvPath = path.join(baseDirectory, 'manifest.csv');

  await fs.writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.writeFile(csvPath, toCsv(manifest.resources || []), 'utf8');

  return { jsonPath, csvPath };
}

export function toCsv(resources) {
  const lines = [CSV_FIELDS.join(',')];
  for (const resource of resources) {
    lines.push(
      CSV_FIELDS.map((field) => {
        const value = Array.isArray(resource[field]) ? resource[field].join(' | ') : resource[field];
        return csvEscape(value);
      }).join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}
