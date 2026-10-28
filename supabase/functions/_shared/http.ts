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
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** Authenticate every request before touching private state; credentials stay in the Edge adapter. */
export function createCompetitionHandler(
  authenticate: (token: string) => Promise<Identity | null>,
  repository: RoundRepository,
  random: () => number,
  events?: EventRepository,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return json({ error: '仅支持 POST。' }, 405);
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
      const identity =
        token && !token.startsWith('sb_publishable_') ? await authenticate(token) : null;
      const player = identity?.id ?? null;
      const page = input.page === undefined ? 0 : input.page;
      if (!Number.isInteger(page) || (page as number) < 0 || (page as number) > 10000)
        throw new ApiError(400, '无效页码。');
      // Public results do not create anonymous accounts. A supplied userId is always ignored.
      if (input.action === 'overview') {
        if (!events) throw new ApiError(503, '比赛服务尚未升级。');
        return json(await events.overview(player));
      }
      if (input.action === 'board') {
        if (!events) throw new ApiError(503, '比赛服务尚未升级。');
        if (
          !['live', 'history', 'evening'].includes(input.kind as string) ||
          (input.stageId != null &&
            (typeof input.stageId !== 'string' || !uuid.test(input.stageId)))
        )
          throw new ApiError(400, '无效排行榜。');
        return json(
          await events.board(
            input.kind as string,
            (input.stageId as string) ?? null,
            player,
            page as number,
          ),
        );
      }
      if (!player) throw new ApiError(401, '匿名身份已失效，请重新连接；不要清除浏览器数据。');
      if (input.action === 'awards') {
        if (!events) throw new ApiError(503, '领奖服务尚未升级。');
        return json(await events.awards(player));
      }
      if (input.action === 'admin_read' || input.action === 'admin_action') {
        if (identity!.isAnonymous) throw new ApiError(403, '需要工作人员账号。');
        if (!events) throw new ApiError(503, '管理服务尚未升级。');
        if (input.action === 'admin_read')
          return json(await events.adminRead(player, page as number));
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
        return json(
          await events.adminAction(
            player,
            input.requestId,
            input.operation as string,
            input.payload as Record<string, unknown>,
          ),
        );
      }
      return json(
        await handleCompetition(
          body as Record<string, unknown>,
          player,
          repository,
          Date.now(),
          random,
        ),
      );
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      return json({ error: '排行榜服务暂时不可用，请重试。' }, 503);
    }
  };
}
