import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/');
});
test('flags, first-click safety, actual loss animation and complete reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: /开始挑战/ }).click();
  await page.getByRole('button', { name: /插旗模式/ }).click();
  const first = page.getByRole('button', { name: '第1行第1列，未翻开', exact: true });
  await first.click();
  await expect(page.getByRole('button', { name: '第1行第1列，已插旗' })).toBeVisible();
  await expect(page.getByText('等待首次探索')).toBeVisible();
  await page.getByRole('button', { name: '第1行第1列，已插旗' }).click();
  await page.getByRole('button', { name: /插旗模式/ }).click();
  await first.click();
  await expect(page.getByRole('button', { name: /第1行第1列，周围/ })).toBeVisible();
  await page.getByRole('button', { name: '第1行第2列，未翻开', exact: true }).click();
  await expect(page.getByRole('status', { name: '土豆爆炸动画' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'BOOM！你踩到土豆了！' })).toBeVisible();
  await expect(page.locator('.cell.open:has(img)')).toHaveCount(10);
  await page.getByRole('button', { name: '再来一次' }).click();
  await expect(page.locator('.cell.open')).toHaveCount(0);
  await expect(page.getByText('等待首次探索')).toBeVisible();
  await expect(page.getByRole('button', { name: /插旗模式/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(errors).toEqual([]);
});
test('win, nickname and leaderboard survive a reload, separated by rules', async ({ page }) => {
  await page.getByRole('button', { name: /路人体验/ }).click();
  await page.getByPlaceholder('留下你的代号').fill('土豆队长');
  await page.getByRole('button', { name: /开始挑战/ }).click();
  await page.getByRole('button', { name: '第5行第5列，未翻开' }).click();
  await expect(page.getByRole('heading', { name: '漂亮！安全撤离！' })).toBeVisible();
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '排行榜', exact: true }).click();
  await expect(page.locator('.score-list')).toContainText('土豆队长');
  await expect(page.locator('.score-list li')).toHaveCount(1);
});
test('upload immediately, persist image and effects, preview, restore', async ({ page }) => {
  await page.getByRole('button', { name: /管理员设置/ }).click();
  await page.getByRole('tab', { name: '素材管理' }).click();
  const card = page
    .locator('.setting-card')
    .filter({ has: page.getByRole('heading', { name: '土豆地雷', exact: true }) });
  await card.locator('input[type=file]').setInputFiles({
    name: 'potato.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByText('素材已保存，立即生效。')).toBeVisible();
  await expect(card.locator('img')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('tab', { name: '特效编辑器' }).click();
  await page.getByRole('button', { name: '极简模式', exact: true }).click();
  await expect(page.getByRole('status', { name: '土豆爆炸动画' })).toBeVisible();
  await expect(page.getByRole('status', { name: '土豆爆炸动画' })).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /管理员设置/ }).click();
  await page.getByRole('tab', { name: '特效编辑器' }).click();
  await expect(page.getByRole('checkbox', { name: '减少动态效果' })).toBeChecked();
  await page.getByRole('tab', { name: '素材管理' }).click();
  await expect(card.locator('img')).toHaveAttribute('src', /^blob:/);
  await card.getByRole('button', { name: '恢复默认' }).click();
  await expect(card.locator('img')).toHaveAttribute('src', './potato.svg');
});
test('invalid upload and custom board handled; responsive layout', async ({ page }) => {
  await page.getByRole('button', { name: /自定义模式/ }).click();
  await page.getByLabel('土豆数', { exact: true }).fill('999');
  await page.getByRole('button', { name: /开始挑战/ }).click();
  await expect(page.getByRole('alert')).toContainText('行列须为');
  await page.getByRole('button', { name: /管理员设置/ }).click();
  await page.getByRole('tab', { name: '素材管理' }).click();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'bad.png',
      mimeType: 'image/png',
      buffer: Buffer.from('invalid image'),
    });
  await expect(page.getByText('图片无法解码或像素过大，请换一张图片。')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
test('countdown expires and records a nonwinning result without ranking', async ({ page }) => {
  await page.getByRole('button', { name: /管理员设置/ }).click();
  await page.getByRole('checkbox', { name: '开启限时模式' }).check();
  await page.getByLabel('挑战时长').fill('10');
  await page.getByRole('button', { name: '关闭设置 ×' }).click();
  await page.getByRole('button', { name: /开始挑战/ }).click();
  await page.clock.install();
  await page.getByRole('button', { name: '第1行第1列，未翻开', exact: true }).click();
  await page.clock.runFor(10100);
  await expect(page.getByRole('heading', { name: '时间到！土豆赢了这一局' })).toBeVisible();
  const results = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('gt-wuwa:scores:v1') || '[]'),
  );
  expect(results).toHaveLength(1);
  expect(results[0].won).toBe(false);
  expect(results[0].seconds).toBe(10);
});
test('several consecutive rounds and screenshot', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: /路人体验/ }).click();
  await page.getByRole('button', { name: /开始挑战/ }).click();
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: '第5行第5列，未翻开' }).click();
    await expect(page.getByRole('heading', { name: '漂亮！安全撤离！' })).toBeVisible();
    await page.getByRole('button', { name: '再来一次' }).click();
  }
  const records = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('gt-wuwa:scores:v1') || '[]'),
  );
  expect(records).toHaveLength(5);
  await page.getByRole('button', { name: '扫雷终端', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('menu.png'), fullPage: true });
  await expect(page.locator('h1')).toContainText('土豆');
});

test('right click flags without revealing on desktop; dense custom board stays contained', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: /自定义模式/ }).click();
  await page.getByLabel('行数', { exact: true }).fill('20');
  await page.getByLabel('列数', { exact: true }).fill('20');
  await page.getByLabel('土豆数', { exact: true }).fill('399');
  await page.getByRole('button', { name: /开始挑战/ }).click();
  await expect(page.locator('.cell')).toHaveCount(400);
  if (testInfo.project.name === 'desktop') {
    await page
      .getByRole('button', { name: '第1行第1列，未翻开', exact: true })
      .click({ button: 'right' });
    await expect(
      page.getByRole('button', { name: '第1行第1列，已插旗', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.cell.open')).toHaveCount(0);
    await expect(page.getByText('等待首次探索')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '第1行第2列，未翻开', exact: true }).click();
  await expect(page.getByRole('heading', { name: '漂亮！安全撤离！' })).toBeVisible();
});
