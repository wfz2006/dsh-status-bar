import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const renderer = resolve('apps/desktop/src/renderer');
const skinDirectory = resolve(renderer, 'assets/whale-skins');
const sheetUrl = 'data:image/png;base64,' + (await readFile(resolve(renderer, 'assets/whale-eyelid-materials.png'))).toString('base64');
const skins = [{ name: 'classic' }];
for (const name of await readdir(skinDirectory)) {
  if (!/\.(svg|png)$/.test(name)) continue;
  const mime = name.endsWith('svg') ? 'image/svg+xml' : 'image/png';
  const data = await readFile(resolve(skinDirectory, name));
  skins.push({ name, url: `data:${mime};base64,${data.toString('base64')}` });
}

const bundledBrowser = chromium.executablePath();
const browser = await chromium.launch({
  ...(existsSync(bundledBrowser) ? { executablePath: bundledBrowser } : { channel: 'chrome' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  await page.addScriptTag({ path: resolve(renderer, 'vendor/whale-motion.js') });
  const results = await page.evaluate(async ({ skins, sheetUrl }) => {
    const size = 384, scale = size / 24;
    const sheet = new Image(); sheet.src = sheetUrl; await sheet.decode();
    const vectorIds = skins.map(s => s.name).filter(n => n.endsWith('.svg')).sort();
    const coverageMask = document.createElement('canvas');
    coverageMask.width = coverageMask.height = size;
    const mask = coverageMask.getContext('2d', { willReadFrequently: true });
    mask.scale(scale, scale);
    const contours = WhaleMotion.mark.match(/M[^M]+/g);
    const dot = new Path2D(contours[2]), sweep = new Path2D(contours[3]);
    mask.fill(dot);
    const dotMask = mask.getImageData(0, 0, size, size).data;
    mask.clearRect(0, 0, 24, 24); mask.fill(sweep);
    const sweepMask = mask.getImageData(0, 0, size, size).data;
    mask.fill(dot); mask.lineWidth = 1.1; mask.stroke(sweep); mask.stroke(dot);
    const permitted = mask.getImageData(0, 0, size, size).data;
    const results = [], timings = [];
    for (const software of [false, true]) {
      const canvas = document.createElement('canvas');
      if (software) {
        const getContext = canvas.getContext.bind(canvas);
        canvas.getContext = (kind, ...args) => kind === 'webgl' ? null : getContext(kind, ...args);
      }
      class StillWhale extends WhaleMotion.Animator {
        wake() {}
        actors() { return [{ x: size / 2, y: size / 2, size }]; }
      }
      const whale = new StillWhale(canvas, null, { energy: 0 });
      whale.resize(size, size);
      const capture = document.createElement('canvas');
      capture.width = capture.height = size;
      const ctx = capture.getContext('2d', { willReadFrequently: true });
      function pixels(openness) {
        whale.pose.eye = openness;
        whale.render();
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(canvas, 0, 0);
        return ctx.getImageData(0, 0, size, size).data;
      }
      function changes(open, frame) {
        let inside = 0, outside = 0, dotArea = 0, sweepArea = 0, dotCovered = 0, sweepCovered = 0;
        for (let i = 0; i < open.length; i += 4) {
          const alpha = i + 3, change = frame[alpha] - open[alpha];
          if (dotMask[alpha] > 128) { dotArea += 255 - open[alpha]; dotCovered += change; }
          if (sweepMask[alpha] > 128) { sweepArea += 255 - open[alpha]; sweepCovered += change; }
          if (Math.abs(open[i]-frame[i]) <= 3 && Math.abs(open[i+1]-frame[i+1]) <= 3 &&
              Math.abs(open[i+2]-frame[i+2]) <= 3 && Math.abs(open[i+3]-frame[i+3]) <= 3) continue;
          if (!permitted[alpha]) outside++;
          else inside++;
        }
        return { inside, outside, dot: dotCovered/dotArea, sweep: sweepCovered/sweepArea };
      }
      function crease(frame) {
        const side = 5*scale, x0 = 11.5*scale, y0 = 9.5*scale;
        const dark = new Uint8Array(side*side), bands = [[], [], []];
        for (let y=0; y<side; y++) for (let x=0; x<side; x++) {
          const alpha = ((y+y0)*size+x+x0)*4+3;
          if (permitted[alpha]<128 || frame[alpha]>150) continue;
          dark[y*side+x]=1;
          const dx=(x+x0+.5)/scale-13.82, dy=(y+y0+.5)/scale-11.84;
          const u=dx*Math.cos(.58)+dy*Math.sin(.58), v=dy*Math.cos(.58)-dx*Math.sin(.58);
          [-1.55,0,1.55].forEach((center,i)=>{if(Math.abs(u-center)<.17)bands[i].push(v);});
        }
        let shapes=0;
        for (let i=0; i<dark.length; i++) if(dark[i]) {
          const todo=[i]; dark[i]=0; let count=0;
          while(todo.length) {
            const p=todo.pop(); count++;
            for(const dy of [-1,0,1]) for(const dx of [-1,0,1]) {
              if (p%side+dx<0 || p%side+dx>=side) continue;
              const q=p+dy*side+dx;
              if(dark[q]){dark[q]=0;todo.push(q);}
            }
          }
          if(count>=3)shapes++;
        }
        const [left,mid,right]=bands.map(values=>values.reduce((a,b)=>a+b,0)/values.length);
        return { shapes, bow:(left+right)/2-mid };
      }
      for (const skin of skins) {
        if (skin.url) {
          const image = new Image(); image.src = skin.url; await image.decode();
          const column=vectorIds.indexOf(skin.name);
          let coat=null;
          if (column>=0) {
            coat=document.createElement('canvas');
            coat.width=sheet.naturalWidth/vectorIds.length; coat.height=sheet.naturalHeight;
            coat.getContext('2d').drawImage(sheet,column*coat.width,0,coat.width,coat.height,0,0,coat.width,coat.height);
          }
          whale.setSkin(image, [-4, -5.5, 33, 30], coat);
        }
        const open = pixels(1);
        const sequence = [.90,.75,.50,.25,.10].map(gap=>changes(open,pixels(gap)));
        const shut = pixels(0);
        results.push({ skin: skin.name, software, renderer: whale.renderer, crease: crease(shut),
          sequence, half:sequence[2], shut: changes(open, shut), reopened: changes(open, pixels(1)) });
      }
      // Read the skin before the swimming transforms, so body motion cannot be mistaken for a blink.
      whale.setSkin(null, [0, 0, 24, 24]);
      const source = whale.textureCanvas.getContext('2d');
      function eyeAlpha() {
        const data = source.getImageData(12*scale, 10*scale, 4*scale, 4*scale).data;
        let sum = 0;
        for (let i = 3; i < data.length; i += 4) sum += data[i];
        return sum;
      }
      pixels(0); const closed = eyeAlpha();
      pixels(1); const open = eyeAlpha(), samples = [];
      whale.nextBlink = .03;
      for (let i = 0; i < 42; i++) {
        whale.tick(1000 + i * 1000 / 120);
        samples.push({ age: whale.clock - whale.blinkStart, closed: (eyeAlpha() - open) / (closed - open) });
      }
      const shut = samples.filter(s => s.age >= 0 && s.age < 1 && s.closed > .96);
      const closing = samples.find(s => s.age >= 0 && s.age < .10 && s.closed > .02);
      const reopened = samples.find(s => s.age > .12 && s.age < 1 && s.closed < .02);
      whale.blinkStart = whale.clock - .09;
      whale.render();
      whale.setReduced(true);
      timings.push({ closingAt: closing?.age, closedAt: shut[0]?.age, heldUntil: shut.at(-1)?.age, reopenedAt: reopened?.age, reducedIsOpen: eyeAlpha() === open });
      whale.destroy();
    }
    return { skins: results, timings };
  }, { skins, sheetUrl });
  const problems = results.skins.filter(r =>
    r.renderer !== (r.software ? 'canvas' : 'articulated-whale') ||
    r.sequence.some((frame,i) => frame.outside || (i>0 && frame.sweep < r.sequence[i-1].sweep-.02)) ||
    r.half.outside || r.shut.outside || r.half.sweep < .12 || r.half.sweep > .91 ||
    r.shut.dot < .85 || r.shut.sweep < .87 || r.shut.sweep <= r.half.sweep || r.crease.shapes !== 1 || !(r.crease.bow > .14) ||
    r.reopened.inside || r.reopened.outside);
  assert.equal(problems.length, 0, JSON.stringify(problems.slice(0, 2)));
  for (const t of results.timings) {
    assert.ok(t.closedAt > 0 && t.closedAt <= .09 && t.heldUntil - t.closedAt >= .02, JSON.stringify(t));
    assert.ok(t.reopenedAt - t.heldUntil > t.closedAt - t.closingAt && t.reopenedAt <= .25 && t.reducedIsOpen, JSON.stringify(t));
  }
  console.log(`Blink pixels passed for ${skins.length} skins in WebGL and Canvas 2D, including timing and reduced motion.`);
} finally { await browser.close(); }
