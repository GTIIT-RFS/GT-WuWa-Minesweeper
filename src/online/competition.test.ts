import { describe, expect, it } from 'vitest';
import {
  applyMove,
  displayName,
  newOnlineGame,
  parseMove,
  publicRound,
  type Round,
} from '../../supabase/functions/_shared/competition';

const round = (): Round => ({
  id: 'round',
  player_id: 'player',
  competition_id: 'club-night-v1',
  display_name: '土豆',
  state: newOnlineGame(),
  revision: 0,
  started_at: new Date(0).toISOString(),
  finished_at: null,
  last_request_id: null,
});
describe('authoritative game rules', () => {
  it('validates names and board indexes rather than accepting arbitrary client fields', () => {
    for (const value of ['', 'x'.repeat(17), '土豆\n', null])
      expect(() => displayName(value)).toThrow();
    expect(displayName(' 土豆 ')).toBe('土豆');
    for (const value of [
      null,
      { kind: 'win' },
      { kind: 'reveal', index: -1 },
      { kind: 'flag', index: 64 },
      { kind: 'reveal', index: 1.5 },
    ])
      expect(() => parseMove(value)).toThrow();
  });
  it('enforces first reveal safety, loss, and server deadline including an untouched board', () => {
    const r = round();
    r.state = applyMove(r, { kind: 'reveal', index: 0 }, 1000, () => 0);
    expect(r.state.cells[0].mine).toBe(false);
    expect(applyMove(r, { kind: 'reveal', index: 1 }, 2000, () => 0).status).toBe('lost');
    expect(applyMove(round(), { kind: 'reveal', index: 63 }, 180000, () => 0).status).toBe(
      'timeout',
    );
  });
  it('redacts both mines and adjacent counts for hidden cells and freezes terminal elapsed time', () => {
    const r = round();
    r.state = applyMove(r, { kind: 'reveal', index: 0 }, 1000, () => 0);
    const view = publicRound(r, 1000);
    for (const cell of view.game.cells.filter((c) => !c.revealed)) {
      expect(cell.mine).toBe(false);
      expect(cell.adjacent).toBe(0);
    }
    r.finished_at = new Date(1200).toISOString();
    r.state.status = 'lost';
    expect(publicRound(r, 5000).elapsedMs).toBe(1200);
  });
});
