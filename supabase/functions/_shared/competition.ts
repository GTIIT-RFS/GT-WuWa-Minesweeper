import { createGame, expire, reveal, toggleFlag, type Game } from './engine.ts';

export const COMPETITION = 'club-night-v1';
export const RULES = { rows: 8, cols: 8, mines: 10 } as const;
export const LIMIT_MS = 180_000;
export interface Round {
  id: string;
  player_id: string;
  competition_id: string;
  display_name: string;
  state: Game;
  revision: number;
  started_at: string;
  finished_at: string | null;
  last_request_id: string | null;
}
export interface PublicRound {
  id: string;
  game: Game;
  revision: number;
  elapsedMs: number;
  limitMs: number;
  displayName: string;
}
export type Move = { kind: 'reveal' | 'flag' | 'sync'; index?: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function displayName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value.trim()].length > 16 ||
    /[\p{C}]/u.test(value)
  )
    throw new ApiError(400, '昵称须为 1–16 字，不能包含控制字符。');
  return value.trim();
}
export function parseMove(value: unknown): Move {
  const move = value as Move | null;
  if (!move || !['reveal', 'flag', 'sync'].includes(move.kind))
    throw new ApiError(400, '无效操作。');
  if (
    move.kind !== 'sync' &&
    (!Number.isInteger(move.index) || move.index! < 0 || move.index! >= 64)
  )
    throw new ApiError(400, '无效方格。');
  return { kind: move.kind, ...(move.kind === 'sync' ? {} : { index: move.index }) };
}
export function applyMove(round: Round, move: Move, now: number, random: () => number): Game {
  if (now - Date.parse(round.started_at) >= LIMIT_MS) {
    // A player can also run out of time before the first reveal.
    return { ...expire(round.state), status: 'timeout' };
  }
  if (move.kind === 'sync') return round.state;
  return move.kind === 'reveal'
    ? reveal(round.state, move.index!, random)
    : toggleFlag(round.state, move.index!);
}
export function publicRound(round: Round, now: number): PublicRound {
  const terminal = ['won', 'lost', 'timeout'].includes(round.state.status);
  return {
    id: round.id,
    revision: round.revision,
    elapsedMs: Math.min(
      LIMIT_MS,
      Math.max(
        0,
        Date.parse(round.finished_at ?? new Date(now).toISOString()) - Date.parse(round.started_at),
      ),
    ),
    limitMs: LIMIT_MS,
    displayName: round.display_name,
    game: {
      ...round.state,
      cells: round.state.cells.map((cell) =>
        cell.revealed || terminal ? cell : { ...cell, mine: false, adjacent: 0 },
      ),
    },
  };
}
export const newOnlineGame = () => createGame(RULES);

export interface RoundRepository {
  start(player: string, name: string, state: Game): Promise<Round>;
  get(id: string, player: string): Promise<Round | null>;
  commit(round: Round, state: Game, requestId: string): Promise<Round>;
}
export async function handleCompetition(
  body: Record<string, unknown>,
  player: string,
  repository: RoundRepository,
  now = Date.now(),
  random = Math.random,
): Promise<PublicRound> {
  if (body.action === 'start') {
    const round = await repository.start(player, displayName(body.name), newOnlineGame());
    return publicRound(round, now);
  }
  if (body.action !== 'move' || typeof body.roundId !== 'string' || !uuid.test(body.roundId))
    throw new ApiError(400, '无效比赛请求。');
  const move = parseMove(body.move);
  if (
    typeof body.requestId !== 'string' ||
    !uuid.test(body.requestId) ||
    !Number.isInteger(body.revision)
  )
    throw new ApiError(400, '缺少操作序号。');
  const round = await repository.get(body.roundId, player);
  if (!round) throw new ApiError(404, '对局不存在或不属于当前账号。');
  if (round.last_request_id === body.requestId || round.finished_at) return publicRound(round, now);
  if (round.revision !== body.revision) throw new ApiError(409, '对局已更新，请重新连接。');
  const state = applyMove(round, move, now, random);
  const saved = await repository.commit(round, state, body.requestId);
  return publicRound(saved, now);
}
