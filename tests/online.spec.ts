import { test, expect, type Page } from '@playwright/test';
import {
  handleCompetition,
  type Round,
  type RoundRepository,
} from '../supabase/functions/_shared/competition';

const player = '11111111-1111-4111-8111-111111111111';
async function setupOnline(page: Page) {
  let round: Round | null = null;
  let score: unknown[] = [];
  let dropNextResponse = false;
  const repository: RoundRepository = {
    async start(id, name, state) {
      if (round && !round.finished_at) return round;
      round = {
        id: crypto.randomUUID(),
        player_id: id,
        competition_id: 'club-night-v1',
        display_name: name,
        state,
        revision: 0,
        started_at: new Date().toISOString(),
        finished_at: null,
        last_request_id: null,
      };
      return round;
    },
    async get(id, owner) {
      return round?.id === id && owner === player ? round : null;
    },
    async commit(previous, state, requestId) {
      const ended = !['ready', 'playing'].includes(state.status);
      round = {
        ...previous,
        state,
        revision: previous.revision + 1,
        last_request_id: requestId,
        finished_at: ended ? new Date().toISOString() : null,
      };
      if (state.status === 'won')
        score = [
          {
            player_id: player,
            display_name: round.display_name,
            elapsed_ms: 12345,
            achieved_at: round.finished_at,
          },
        ];
      return round;
    },
  };
  await page.route('https://wuwa-test.supabase.co/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'content-type': 'application/json',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers, body: '{}' });
    if (path.endsWith('/otp')) return route.fulfill({ headers, body: '{}' });
    if (path.endsWith('/verify')) {
      const user = {
        id: player,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'player@example.com',
        email_confirmed_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      };
      const access_token = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: player })).toString('base64url')}.test`;
      return route.fulfill({
        headers,
        json: {
          access_token,
          refresh_token: 'test-refresh',
          token_type: 'bearer',
          expires_in: 3600,
          user,
        },
      });
    }
    if (path.endsWith('/online_best_scores')) {
      expect(new URL(request.url()).searchParams.get('order')).toBe(
        'elapsed_ms.asc,achieved_at.asc,player_id.asc',
      );
      return route.fulfill({ headers, json: score });
    }
    if (path.endsWith('/competition')) {
      const body = request.postDataJSON();
      expect(body).not.toHaveProperty('seconds');
      expect(body).not.toHaveProperty('state');
      const response = await handleCompetition(body, player, repository, Date.now(), () => 0);
      if (dropNextResponse) {
        dropNextResponse = false;
        return route.abort('failed');
      }
      return route.fulfill({ headers, json: response });
    }
    return route.fulfill({ status: 404, headers, json: { error: 'Unexpected test endpoint' } });
  });
  await page.goto('/#online');
  await page.getByLabel('参赛邮箱').fill('player@example.com');
  await page.getByRole('button', { name: '发送邮箱验证码', exact: true }).click();
  await page.getByLabel('邮箱验证码').fill('123456');
  await page.getByRole('button', { name: '验证并登录' }).click();
  await page.getByLabel('公开参赛昵称').fill('在线土豆');
  return {
    dropNext: () => {
      dropNextResponse = true;
    },
    getRound: () => round,
  };
}

test('online login, mobile flags, server-verified win and projection ranking', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setupOnline(page);
  await page.getByRole('button', { name: '开始在线挑战', exact: true }).click();
  await page.getByRole('button', { name: /在线插旗模式/ }).click();
  await page.getByRole('button', { name: '第1行第1列，未翻开', exact: true }).click();
  await expect(page.getByRole('button', { name: '第1行第1列，已插旗' })).toBeEnabled();
  await page.getByRole('button', { name: '第1行第1列，已插旗' }).click();
  await page.getByRole('button', { name: /在线插旗模式/ }).click();
  await page.getByRole('button', { name: '第1行第1列，未翻开', exact: true }).click();
  await expect(page.getByText('探索中', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('公开参赛昵称').fill('重连昵称');
  await page.getByRole('button', { name: '开始在线挑战', exact: true }).click();
  await expect(page.getByRole('button', { name: /第1行第1列，周围/ })).toBeVisible();
  await page.getByRole('button', { name: '第8行第8列，未翻开', exact: true }).click();
  await expect(page.getByText('有效胜局，已入榜', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '刷新排行榜' }).click();
  await expect(page.locator('.online-score-list li')).toHaveCount(1);
  await expect(page.locator('.online-score-list')).toContainText('在线土豆');
  await page.goto('/#display');
  await expect(page.getByRole('heading', { name: '土豆扫雷 · 全场排行榜' })).toBeVisible();
  await expect(page.locator('.projection .online-score-list')).toContainText('12.345');
  await expect(page.locator('.join-address a')).toHaveAttribute('href', '#online');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('a lost server response can retry the same move without executing it twice', async ({
  page,
}) => {
  const server = await setupOnline(page);
  await page.getByRole('button', { name: '开始在线挑战', exact: true }).click();
  await expect(page.getByRole('button', { name: '第1行第1列，未翻开', exact: true })).toBeEnabled();
  server.dropNext();
  await page.getByRole('button', { name: '第1行第1列，未翻开', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试上次请求' })).toBeVisible();
  expect(server.getRound()?.revision).toBe(1);
  await page.getByRole('button', { name: '重试上次请求' }).click();
  await expect(page.getByRole('button', { name: /第1行第1列，周围/ })).toBeVisible();
  expect(server.getRound()?.revision).toBe(1);
  await page.getByRole('button', { name: '第1行第2列，未翻开', exact: true }).click();
  await expect(page.getByRole('status', { name: '土豆爆炸动画' })).toBeVisible();
  await expect(page.getByText('踩到土豆', { exact: true })).toBeVisible();
  await expect(page.locator('.online-score-list li')).toHaveCount(0);
});

test('projection polls, rotates ranks and keeps last good data on refresh failure', async ({
  page,
}, testInfo) => {
  let reads = 0;
  let failed = false;
  const rows = Array.from({ length: 7 }, (_, i) => ({
    player_id: `player-${i}`,
    display_name: `投影玩家${i + 1}`,
    elapsed_ms: (i + 1) * 1000,
    achieved_at: '2026-10-27T12:00:00Z',
  }));
  await page.route('https://wuwa-test.supabase.co/rest/v1/online_best_scores**', async (route) => {
    reads++;
    await route.fulfill({
      status: failed ? 503 : 200,
      json: failed ? { message: 'Unavailable' } : rows,
    });
  });
  await page.clock.install();
  await page.goto('/#display');
  await expect(page.locator('.online-score-list li')).toHaveCount(5);
  await expect(page.locator('.online-score-list')).toContainText('投影玩家1');
  if (testInfo.project.name === 'desktop') {
    expect(
      await page
        .locator('.join-address')
        .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
    ).toBe(true);
  }
  await page.clock.runFor(10_100);
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  await page.clock.runFor(5_100);
  await expect(page.locator('.online-score-list li')).toHaveCount(2);
  await expect(page.locator('.online-score-list .online-rank').first()).toHaveText('06');
  failed = true;
  await page.getByRole('button', { name: '刷新排行榜' }).click();
  await expect(page.getByRole('alert')).toContainText('上次成功读取');
  await expect(page.locator('.online-score-list')).toContainText('投影玩家7');
  failed = false;
  await page.getByRole('button', { name: '刷新排行榜' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
