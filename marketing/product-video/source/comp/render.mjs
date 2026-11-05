// Parallel frame renderer: N browsers, each renders a contiguous frame range into its own H.264 chunk.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';

const FPS = 30;
const N = Number(process.env.WORKERS || 4);
const OUT = process.env.OUT || 'out';
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('vo.js', 'utf8') + fs.readFileSync('timeline.js', 'utf8').replace("typeof module !== 'undefined'", 'false'), Object.assign(ctx, { window: ctx }));
const TOTAL = Number(process.env.TOTAL || ctx.TL.total);
const START = Number(process.env.START || 0);
const frames = Math.round((TOTAL - START) * FPS);
fs.mkdirSync(OUT, { recursive: true });
console.log('frames', frames, 'workers', N);

async function worker(w, f0, f1) {
  const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('pageerror', w, e.message));
  await page.goto('file://' + process.cwd() + '/index.html');
  await page.evaluate(() => document.fonts.ready);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), `${OUT}/chunk_${String(w).padStart(2, '0')}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = f0; f < f1; f++) {
    const t = START + f / FPS;
    await page.evaluate((t) => window.renderAt(t), t);
    const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((f - f0) % 300 === 0) console.log(`w${w} ${f - f0}/${f1 - f0} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();
}
const per = Math.ceil(frames / N);
await Promise.all([...Array(N)].map((_, w) => worker(w, w * per, Math.min(frames, (w + 1) * per))));
fs.writeFileSync(`${OUT}/list.txt`, [...Array(N)].map((_, w) => `file 'chunk_${String(w).padStart(2, '0')}.mp4'`).join('\n') + '\n');
console.log('done');
