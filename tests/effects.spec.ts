import { test, expect } from '@playwright/test';

test('transparent default mascot, each preset, editable parameters and preview lifecycle', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const mascot = page.locator('.mission-potato img');
  await expect(mascot).toHaveAttribute('src', './mascot.png');
  const image = await mascot.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    return { loaded: el.complete && el.naturalWidth > 500, fit: getComputedStyle(el).objectFit };
  });
  expect(image.loaded).toBe(true);
  expect(image.fit).toBe('contain');
  await page.getByRole('button', { name: /管理员设置/ }).click();
  await page.getByRole('tab', { name: '特效编辑器' }).click();
  await page.clock.install({ time: new Date('2026-10-27T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-28T00:00:00Z'));
  for (const [name, preset, count, duration] of [
    ['经典爆炸', 'classic', 42, 1600],
    ['超级土豆爆炸', 'super', 72, 2100],
    ['土豆雨', 'rain', 40, 2200],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click();
    const burst = page.getByRole('status', { name: '土豆爆炸动画' });
    await expect(burst).toHaveClass(new RegExp(`preset-${preset}`));
    await expect(burst.locator('.particle')).toHaveCount(count);
    await expect(burst.locator('.shockwave')).toHaveCount(2);
    if (preset === 'rain') {
      await expect(burst.locator('.potato-particle img')).toHaveCount(count);
      await expect(burst.locator('.potato-particle img').first()).toHaveAttribute(
        'src',
        './mascot.png',
      );
    }
    await page.clock.runFor(duration + 50);
    await expect(burst).not.toBeVisible();
  }
  await page.getByRole('spinbutton', { name: '动画总时长数值' }).fill('800');
  await page.getByRole('spinbutton', { name: '粒子数量数值' }).fill('12');
  await page.getByRole('button', { name: '测试爆炸特效' }).click();
  await expect(page.locator('.explosion .particle')).toHaveCount(12);
  await expect(page.locator('.explosion')).toHaveAttribute('style', /--duration: 800ms/);
  await page.getByRole('spinbutton', { name: '动画总时长数值' }).fill('1000');
  await page.getByRole('spinbutton', { name: '粒子数量数值' }).fill('16');
  await expect(page.locator('.explosion')).toHaveAttribute('style', /--duration: 800ms/);
  await expect(page.locator('.explosion .particle')).toHaveCount(12);
  await page.clock.runFor(850);
  await expect(page.locator('.explosion')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /管理员设置/ }).click();
  await page.getByRole('tab', { name: '特效编辑器' }).click();
  await expect(page.getByRole('spinbutton', { name: '粒子数量数值' })).toHaveValue('16');
  expect(errors).toEqual([]);
});

test('system reduced motion disables particles and content shake', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-27T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-28T00:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: /管理员设置/ }).click();
  await page.getByRole('tab', { name: '特效编辑器' }).click();
  await page.getByRole('button', { name: '超级土豆爆炸', exact: true }).click();
  const burst = page.locator('.explosion');
  await expect(burst).toHaveClass(/reduced/);
  await expect(burst.locator('.particle')).toHaveCount(0);
  expect(await page.locator('main').evaluate((el) => getComputedStyle(el).animationName)).toBe(
    'none',
  );
  await page.clock.runFor(700);
  await expect(burst).not.toBeVisible();
});

test('new mascot and effects load on the GitHub Pages project subpath', async ({ page }) => {
  // Simulate a static host mounting the exact built output below the repository name.
  const base = '/GT-WuWa-Minesweeper/';
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const root = path.resolve('dist');
  await page.route(`**${base}**`, async (route) => {
    const relative =
      decodeURIComponent(new URL(route.request().url()).pathname.slice(base.length)) ||
      'index.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return route.abort();
    try {
      const contentTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      };
      await route.fulfill({
        body: await fs.readFile(file),
        contentType: contentTypes[path.extname(file)] || 'application/octet-stream',
      });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole('button', { name: /开始挑战/ }).click();
  await expect(page.locator('.cell')).toHaveCount(64);
  await page.getByRole('button', { name: '第1行第1列，未翻开', exact: true }).click();
  expect(
    await page.locator('.mission-potato img').evaluate((el: HTMLImageElement) => el.naturalWidth),
  ).toBeGreaterThan(500);
  expect(errors).toEqual([]);
});
