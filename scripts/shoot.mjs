#!/usr/bin/env node
/**
 * GLYPHFIELD visual QA harness — drives the installed Chrome headlessly via playwright-core.
 *
 *   node scripts/shoot.mjs [--url http://localhost:5173/] [--out screenshots] [--tag qa]
 *                          [--viewports 1440x900,1920x1080] [--modes waves,attractor,topology]
 *                          [--dpr 1] [--extra true|false] [--channel chrome|msedge]
 *
 * For each viewport: waits for the engine's `ready`, lets the intro play, then for every
 * experiment shoots an idle frame and a frame after pointer interaction. With --extra it
 * also shoots THE MATH drawer, the top-down wave view and presentation mode (H).
 * Console errors/warnings and page errors are collected into <out>/<tag>-report.json.
 * Requires the dev server (npm run dev) or `npm run preview` + `?debug` in the URL.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const next = argv[i + 1];
  args[argv[i].slice(2)] = next && !next.startsWith('--') ? next : 'true';
}

const url = args.url ?? 'http://localhost:5173/';
const out = resolve(args.out ?? 'screenshots');
const tag = args.tag ?? 'qa';
const dpr = Number(args.dpr ?? 1);
const extra = (args.extra ?? 'true') === 'true';
const modes = (args.modes ?? 'waves,attractor,topology').split(',').filter(Boolean);
const viewports = (args.viewports ?? '1440x900').split(',').map((v) => {
  const [width, height] = v.split('x').map(Number);
  return { width, height };
});
const KEY = { waves: '1', attractor: '2', topology: '3' };

mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: args.channel ?? 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const report = { url, tag, runs: [] };

try {
  for (const vp of viewports) {
    const vpTag = `${vp.width}x${vp.height}`;
    const context = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const logs = [];
    const shots = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    const stats = () =>
      page.evaluate(() => {
        const s = window.__GLYPHFIELD__?.live.getState().stats;
        return s
          ? { fps: Math.round(s.fps), frameMs: +s.frameMs.toFixed(2), glyphs: s.glyphs, cols: s.cols, rows: s.rows, quality: s.quality, mode: s.mode, ready: s.ready }
          : null;
      });
    const shoot = async (name) => {
      const file = join(out, `${tag}-${vpTag}-${name}.png`);
      await page.screenshot({ path: file });
      shots.push({ name, file, stats: await stats() });
    };
    // Sweep the pointer along a Lissajous path across the lower stage.
    const sweep = async (n = 36) => {
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        await page.mouse.move(vp.width * (0.5 + 0.3 * Math.sin(t)), vp.height * (0.64 + 0.16 * Math.sin(2 * t)), { steps: 2 });
        await page.waitForTimeout(16);
      }
    };

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page
      .waitForFunction(() => window.__GLYPHFIELD__?.live.getState().stats.ready === true, null, { timeout: 15000 })
      .catch(() => logs.push('[harness] engine never reported ready (is window.__GLYPHFIELD__ installed?)'));
    await page.waitForTimeout(2600); // let the intro decode finish

    for (const mode of modes) {
      if (mode !== 'waves') {
        await page.keyboard.press(KEY[mode]);
        await page.waitForTimeout(1600);
      }
      await shoot(`${mode}-idle`);
      await sweep();
      if (mode === 'topology') {
        await page.mouse.move(vp.width * 0.5, vp.height * 0.55);
        await page.mouse.down();
        await page.mouse.move(vp.width * 0.63, vp.height * 0.5, { steps: 14 });
        await page.mouse.up();
      } else {
        await page.mouse.click(vp.width * 0.56, vp.height * 0.7);
        await page.mouse.click(vp.width * 0.34, vp.height * 0.74);
      }
      await page.waitForTimeout(700);
      await shoot(`${mode}-interact`);
    }

    if (extra) {
      await page.keyboard.press('m');
      await page.waitForTimeout(900);
      await shoot('math-drawer');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await page.keyboard.press('1');
      await page.waitForTimeout(1600);
      await page.evaluate(() => window.__GLYPHFIELD__?.store.getState().setParam('waves', 'view', 'plane'));
      await page.waitForTimeout(1000);
      await shoot('waves-plane');
      await page.evaluate(() => window.__GLYPHFIELD__?.store.getState().setParam('waves', 'view', 'horizon'));
      await page.keyboard.press('h');
      await page.waitForTimeout(900);
      await shoot('presentation');
      await page.keyboard.press('h');
    }

    report.runs.push({ viewport: vpTag, shots, logs });
    await context.close();
  }
} finally {
  await browser.close();
}

writeFileSync(join(out, `${tag}-report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
