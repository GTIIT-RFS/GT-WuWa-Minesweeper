import { test, expect, type EventServer } from './helpers/event-server';
import type { Page } from '@playwright/test';
async function start(page: Page) {
  await page.goto('/#online');
  await page.getByLabel('公开参赛昵称').fill('在线土豆');
  await page.getByRole('button', { name: '开始在线挑战', exact: true }).click();
  await expect(page.getByRole('button', { name: '第1行第1列，未翻开', exact: true })).toBeEnabled();
}
async function win(page: Page, server: EventServer) {
  await page.getByRole('button', { name: '第1行第1列，未翻开', exact: true }).click();
  await expect(page.getByText('探索中', { exact: true })).toBeVisible();
  await server.advance(12345);
  await page.getByRole('button', { name: '第8行第8列，未翻开', exact: true }).click();
  await expect(page.getByText('有效胜局，已入榜', { exact: true })).toBeVisible();
}

test('anonymous creation, restored session, touch flags and authoritative victory', async ({
  page,
  eventServer,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#online');
  await expect(page.getByText('输入昵称即可匿名参赛', { exact: false })).toBeVisible();
  expect(eventServer.getSignupCount()).toBe(0);
  await start(page);
  expect(eventServer.getSignupCount()).toBe(1);
  await page.getByRole('button', { name: /在线插旗模式/ }).click();
  await page.getByRole('button', { name: '第1行第1列，未翻开', exact: true }).click();
  await expect(page.getByRole('button', { name: '第1行第1列，已插旗' })).toBeEnabled();
  await page.getByRole('button', { name: '第1行第1列，已插旗' }).click();
  await page.reload();
  await page.getByLabel('公开参赛昵称').fill('恢复代号');
  await page.getByRole('button', { name: '开始在线挑战', exact: true }).click();
  await expect(page.getByRole('button', { name: '第1行第1列，未翻开', exact: true })).toBeEnabled();
  expect(eventServer.getSignupCount()).toBe(1);
  await win(page, eventServer);
  await page.getByRole('button', { name: '刷新排行榜' }).click();
  await expect(page.locator('.online-score-list li')).toHaveCount(1);
  await expect(page.getByText(/你的排名 #1/)).toBeVisible();
  expect(await eventServer.rows('select * from public.event_wins')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('a lost move response retries safely and loss still triggers the potato explosion', async ({
  page,
  eventServer,
}) => {
  await start(page);
  eventServer.dropNextMove();
  await page.getByRole('button', { name: '第1行第1列，未翻开', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试上次请求' })).toBeVisible();
  expect(
    (
      await eventServer.rows<{ revision: number }>(
        'select revision from public.online_rounds where finished_at is null',
      )
    )[0].revision,
  ).toBe(1);
  await page.getByRole('button', { name: '重试上次请求' }).click();
  await expect(page.getByRole('button', { name: /第1行第1列，周围/ })).toBeVisible();
  expect(
    (
      await eventServer.rows<{ revision: number }>(
        'select revision from public.online_rounds where finished_at is null',
      )
    )[0].revision,
  ).toBe(1);
  await page.getByRole('button', { name: '第1行第2列，未翻开', exact: true }).click();
  await expect(page.getByRole('status', { name: '土豆爆炸动画' })).toBeVisible();
  await expect(page.getByText('踩到土豆', { exact: true })).toBeVisible();
  expect(await eventServer.rows('select * from public.event_wins')).toHaveLength(0);
});

test('projection polls, rotates five players and preserves data after a network failure', async ({
  page,
  eventServer,
}, testInfo) => {
  for (let i = 0; i < 7; i++) await eventServer.seedWin(`投影玩家${i + 1}`, 1000 + i * 1000);
  await page.clock.install();
  await page.goto('/#display');
  await expect(page.locator('.online-score-list li')).toHaveCount(5);
  await expect(page.getByRole('img', { name: '扫码进入匿名竞速赛' })).toBeVisible();
  if (testInfo.project.name === 'desktop')
    expect(
      await page
        .locator('.join-address')
        .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
    ).toBe(true);
  await page.clock.runFor(15100);
  await expect(page.locator('.online-score-list li')).toHaveCount(2);
  await expect(page.locator('.online-rank').first()).toHaveText('06');
  expect(eventServer.getOverviewReads()).toBeGreaterThanOrEqual(2);
  eventServer.failOverview(true);
  await page.getByRole('button', { name: '刷新排行榜' }).click();
  await expect(page.getByRole('alert')).toContainText('上次成功读取');
  await expect(page.locator('.online-score-list')).toContainText('投影玩家7');
  eventServer.failOverview(false);
  await page.getByRole('button', { name: '刷新排行榜' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('round settlement reveals winners while the next stage is already open and history stays available', async ({
  page,
  eventServer,
}) => {
  for (let i = 0; i < 3; i++) await eventServer.seedWin(`获奖者${i + 1}`, 2000 + i * 1000);
  await page.clock.install();
  await page.goto('/#display');
  await expect(page.locator('.online-score-list li')).toHaveCount(3);
  await eventServer.setTime('2030-06-01T11:00:00Z');
  await eventServer.rpc('event_settle_due');
  // Let the automatic poll discover settlement. A manual click can be intercepted
  // by the reveal which another in-flight automatic refresh has already opened.
  await page.clock.runFor(5100);
  await expect(page.getByRole('status', { name: '获奖揭晓' })).toBeVisible();
  await expect(page.locator('.stage-banner')).toContainText('第 2 轮');
  expect(
    (await eventServer.rpc<{ currentStage: { round_no: number } }>('event_overview', [null]))
      .currentStage.round_no,
  ).toBe(2);
  await page.clock.runFor(10100);
  await expect(page.getByRole('status', { name: '获奖揭晓' })).toHaveCount(0);
  await page.getByRole('tab', { name: '历史获奖榜' }).click();
  await expect(page.locator('.online-score-list li')).toHaveCount(3);
  await expect(page.locator('.online-score-list')).toContainText('获奖者1');
  const text = await page.locator('.online-leaderboard').innerText();
  expect(text).not.toContain('token');
});

test('private reward credential, staff verification and CSV export keep the participant session intact', async ({
  page,
  eventServer,
}) => {
  await start(page);
  await win(page, eventServer);
  await eventServer.setTime('2030-06-01T11:00:00Z');
  await eventServer.rpc('event_settle_due');
  await page.goto('/#awards');
  await expect(page.getByRole('heading', { name: '我的领奖凭证' })).toBeVisible();
  const token = await page.locator('.claim-token').innerText();
  expect(token.length).toBeGreaterThan(64);
  await expect(page.getByRole('img', { name: '仅供工作人员扫描的私人领奖二维码' })).toBeVisible();
  const award = (
    await eventServer.rows<{ id: string }>('select * from public.event_awards where player_id=$1', [
      eventServer.getPlayer(),
    ])
  )[0];
  const anonymousStorage = await page.evaluate(() =>
    localStorage.getItem('sb-wuwa-test-auth-token'),
  );
  await page.goto(`/#event-admin?award=${award.id}&credential=${encodeURIComponent(token)}`);
  await page.getByLabel('工作人员邮箱').fill('staff@example.com');
  await page.getByLabel('工作人员密码').fill('test-password');
  await page.getByRole('button', { name: '登录工作人员后台' }).click();
  await expect(page.getByRole('button', { name: '紧急暂停比赛' })).toBeVisible();
  expect(page.url()).not.toContain('credential=');
  const claim = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: '现场核验并发放奖品' }) });
  await expect(claim.locator('select[name=awardId]')).toHaveValue(award.id);
  await expect(claim.getByLabel('玩家设备上的一次性凭证')).toHaveValue(token);
  await claim.getByLabel('现场手环／贴纸编号').fill('sticker-001');
  await claim.getByRole('checkbox').check();
  await claim.getByRole('button', { name: '确认领奖', exact: true }).click();
  await expect(page.getByText('操作已由服务器确认并记入审计。')).toBeVisible();
  expect(
    (
      await eventServer.rows<{ status: string }>(
        'select status from public.event_awards where id=$1',
        [award.id],
      )
    )[0].status,
  ).toBe('claimed');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV 获奖记录' }).click();
  expect((await download).suggestedFilename()).toContain('获奖记录.csv');
  expect(await page.evaluate(() => localStorage.getItem('sb-wuwa-test-auth-token'))).toBe(
    anonymousStorage,
  );
  await page.goto('/#awards');
  await expect(page.locator('.award-card')).toContainText('已领取');
  await expect(page.locator('.claim-token')).toHaveCount(0);
  expect(eventServer.getSignupCount()).toBe(1);
});

test('a non-admin permanent account cannot access the management controls', async ({
  page,
  eventServer,
}) => {
  eventServer.nonAdminStaff();
  await page.goto('/#event-admin');
  await page.getByLabel('工作人员邮箱').fill('non-admin@example.com');
  await page.getByLabel('工作人员密码').fill('test-password');
  await page.getByRole('button', { name: '登录工作人员后台' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认领奖', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '紧急暂停比赛' })).toHaveCount(0);
});
