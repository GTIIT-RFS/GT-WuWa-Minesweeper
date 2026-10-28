import { ApiError, handleCompetition, uuid, type RoundRepository } from './competition.ts';
import type { EventRepository } from './event-types.ts';
export interface Identity {
  id: string;
  isAnonymous: boolean;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '600',
  'Access-Control-Expose-Headers': 'Server-Timing, X-Request-Id',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** Authenticate every request before touching private state; credentials stay in the Edge adapter. */
export function createCompetitionHandler(
  authenticate: (token: string, options?: { requireCurrentUser?: boolean }) => Promise<Identity | null>,
  repository: RoundRepository,
  random: () => number,
  events?: EventRepository,
  testRepository?: RoundRepository,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    const startedAt = performance.now();
    let authMs = 0;
    let dbMs = 0;
    const measureDb = async <T>(operation: () => Promise<T>): Promise<T> => {
      const dbStartedAt = performance.now();
      try {
        return await operation();
      } finally {
        dbMs += Math.max(0, performance.now() - dbStartedAt);
      }
    };
    const timedRepository: RoundRepository = {
      start: (player, name, state) => measureDb(() => repository.start(player, name, state)),
      get: (id, player) => measureDb(() => repository.get(id, player)),
      commit: (round, state, requestId) => measureDb(() => repository.commit(round, state, requestId)),
    };
    const timedTestRepository: RoundRepository | undefined = testRepository
      ? {
          start: (player, name, state) => measureDb(() => testRepository.start(player, name, state)),
          get: (id, player) => measureDb(() => testRepository.get(id, player)),
          commit: (round, state, requestId) =>
            measureDb(() => testRepository.commit(round, state, requestId)),
        }
      : undefined;
    const requestId = crypto.randomUUID();
    const reply = (body: unknown, status = 200) => {
      const totalMs = Math.max(0, performance.now() - startedAt);
      const response = json(body, status);
      response.headers.set(
        'Server-Timing',
        `auth;dur=${authMs.toFixed(1)}, db;dur=${dbMs.toFixed(1)}, app;dur=${Math.max(0, totalMs - authMs - dbMs).toFixed(1)}, total;dur=${totalMs.toFixed(1)}`,
      );
      response.headers.set('X-Request-Id', requestId);
      return response;
    };
    if (request.method !== 'POST') return reply({ error: '仅支持 POST。' }, 405);
    try {
      // Bound the stream before parsing, even for chunked requests without Content-Length.
      const reader = request.body?.getReader();
      if (!reader) throw new ApiError(400, '请求为空。');
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2048) {
          await reader.cancel();
          throw new ApiError(413, '请求过大。');
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new ApiError(400, '无效 JSON。');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new ApiError(400, '无效请求。');
      const input = body as Record<string, unknown>;
      const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
      let identity: Identity | null = null;
      if (token && !token.startsWith('sb_publishable_')) {
        const authStartedAt = performance.now();
        try {
          identity = await authenticate(token, {
            requireCurrentUser: ['awards', 'test_awards', 'admin_read', 'admin_action', 'test_admin_settle', 'test_admin_action'].includes(input.action as string),
          });
        } finally {
          authMs += Math.max(0, performance.now() - authStartedAt);
        }
      }
      const player = identity?.id ?? null;
      const page = input.page === undefined ? 0 : input.page;
      if (!Number.isInteger(page) || (page as number) < 0 || (page as number) > 10000)
        throw new ApiError(400, '无效页码。');
      // Public results do not create anonymous accounts. A supplied userId is always ignored.
      if (input.action === 'test_overview') {
        if (!events) throw new ApiError(503, '测试服务尚未升级。');
        return reply(await measureDb(() => events.testOverview(player)));
      }
      if (input.action === 'test_board') {
        if (!events) throw new ApiError(503, '测试服务尚未升级。');
        if (
          !['live', 'history', 'evening'].includes(input.kind as string) ||
          (input.stageId != null &&
            (typeof input.stageId !== 'string' || !uuid.test(input.stageId)))
        )
          throw new ApiError(400, '无效测试排行榜。');
        return reply(
          await measureDb(() => events.testBoard(
            input.kind as string,
            (input.stageId as string) ?? null,
            player,
            page as number,
          )),
        );
      }
      if (input.action === 'overview') {
        if (!events) throw new ApiError(503, '比赛服务尚未升级。');
        return reply(await measureDb(() => events.overview(player)));
      }
      if (input.action === 'board') {
        if (!events) throw new ApiError(503, '比赛服务尚未升级。');
        if (
          !['live', 'history', 'evening'].includes(input.kind as string) ||
          (input.stageId != null &&
            (typeof input.stageId !== 'string' || !uuid.test(input.stageId)))
        )
          throw new ApiError(400, '无效排行榜。');
        return reply(
          await measureDb(() => events.board(
            input.kind as string,
            (input.stageId as string) ?? null,
            player,
            page as number,
          )),
        );
      }
      if (!player) throw new ApiError(401, '匿名身份已失效，请重新连接；不要清除浏览器数据。');
      if (input.action === 'awards' || input.action === 'test_awards') {
        if (!events) throw new ApiError(503, '领奖服务尚未升级。');
        return reply(
          await measureDb(() => input.action === 'test_awards'
            ? events.testAwards(player)
            : events.awards(player)),
        );
      }
      if (input.action === 'test_start' || input.action === 'test_move') {
        if (!testRepository) throw new ApiError(503, '在线测试服务尚未升级。');
        const mapped = { ...input, action: input.action === 'test_start' ? 'start' : 'move' };
        return reply(await handleCompetition(mapped, player, timedTestRepository!, Date.now(), random));
      }
      if (input.action === 'test_admin_settle' || input.action === 'test_admin_action') {
        if (identity!.isAnonymous) throw new ApiError(403, '需要工作人员账号。');
        if (!events) throw new ApiError(503, '测试管理服务尚未升级。');
        if (typeof input.requestId !== 'string' || !uuid.test(input.requestId))
          throw new ApiError(400, '无效管理请求编号。');
        if (input.action === 'test_admin_settle')
          return reply(await measureDb(() => events.testAdminSettle(player, input.requestId as string)));
        if (
          !['claim', 'status', 'rollover'].includes(input.operation as string) ||
          !input.payload ||
          typeof input.payload !== 'object' ||
          Array.isArray(input.payload)
        )
          throw new ApiError(400, '无效测试管理操作。');
        return reply(
          await measureDb(() => events.testAdminAction(
            player,
            input.requestId as string,
            input.operation as string,
            input.payload as Record<string, unknown>,
          )),
        );
      }
      if (input.action === 'admin_read' || input.action === 'admin_action') {
        if (identity!.isAnonymous) throw new ApiError(403, '需要工作人员账号。');
        if (!events) throw new ApiError(503, '管理服务尚未升级。');
        if (input.action === 'admin_read')
          return reply(await measureDb(() => events.adminRead(player, page as number)));
        if (
          typeof input.requestId !== 'string' ||
          !uuid.test(input.requestId) ||
          ![
            'configure',
            'pause',
            'schedule',
            'prizes',
            'settle',
            'claim',
            'status',
            'rollover',
          ].includes(input.operation as string) ||
          !input.payload ||
          typeof input.payload !== 'object' ||
          Array.isArray(input.payload)
        )
          throw new ApiError(400, '无效管理操作。');
        return reply(
          await measureDb(() => events.adminAction(
            player,
            input.requestId as string,
            input.operation as string,
            input.payload as Record<string, unknown>,
          )),
        );
      }
      return reply(
        await handleCompetition(
          body as Record<string, unknown>,
          player,
          timedRepository,
          Date.now(),
          random,
        ),
      );
    } catch (error) {
      if (error instanceof ApiError) return reply({ error: error.message }, error.status);
      return reply({ error: '排行榜服务暂时不可用，请重试。' }, 503);
    }
  };
}
