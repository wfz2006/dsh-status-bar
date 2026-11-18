// Bake the material under the eye from each original vector skin. Rows of decoration,
// including the gold inlay, are painted with the same paths and gradients as the open mark.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const renderer = resolve('apps/desktop/src/renderer');
const dir = resolve(renderer, 'assets/whale-skins');
const names = (await readdir(dir)).filter(name => name.endsWith('.svg')).sort();
const sources = await Promise.all(names.map(name => readFile(resolve(dir, name), 'utf8')));
const executablePath = chromium.executablePath();
const browser = await chromium.launch(existsSync(executablePath) ? { executablePath } : { channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ path: resolve(renderer, 'vendor/whale-motion.js') });
  const png = await page.evaluate(async sources => {
    const { x, y, w, h } = WhaleMotion.eyeTile([-4, -5.5, 33, 30], 384, 384);
    const sheet = document.createElement('canvas');
    sheet.width = w * sources.length; sheet.height = h;
    const full = document.createElement('canvas'); full.width = full.height = 384;
    const skin = full.getContext('2d'), output = sheet.getContext('2d');
    const parser = new DOMParser(), serializer = new XMLSerializer();
    for (const [column, source] of sources.entries()) {
      const svg = parser.parseFromString(source, 'image/svg+xml');
      const silhouette = svg.querySelector('#silhouette'), paths = silhouette?.getAttribute('d')?.match(/M[^M]+/g);
      if (paths?.length !== 4 || !paths[2].startsWith('M12.2826') || !paths[3].startsWith('M15.2831')) {
        throw new Error('Expected both original eye contours in skin ' + column);
      }
      silhouette.setAttribute('d', paths[0] + paths[1]);
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serializer.serializeToString(svg));
      await image.decode();
      skin.clearRect(0, 0, 384, 384); skin.drawImage(image, 0, 0, 384, 384);
      output.drawImage(full, x, y, w, h, column*w, 0, w, h);
    }
    return sheet.toDataURL('image/png').split(',')[1];
  }, sources);
  await writeFile(resolve(renderer, 'assets/whale-eyelid-materials.png'), Buffer.from(png, 'base64'));
  console.log(`Baked eyelid material for ${names.length} vector skins.`);
} finally { await browser.close(); }
