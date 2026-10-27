import { ApiError, handleCompetition, type RoundRepository } from './competition.ts';

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
  authenticate: (token: string) => Promise<string | null>,
  repository: RoundRepository,
  random: () => number,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return json({ error: '仅支持 POST。' }, 405);
    try {
      const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
      const player = token ? await authenticate(token) : null;
      if (!player) throw new ApiError(401, '请先通过邮箱验证码登录。');
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
