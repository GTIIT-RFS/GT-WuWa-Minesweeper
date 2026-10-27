import { describe, expect, it } from 'vitest';
import {
  createGame,
  reveal,
  toggleFlag,
  neighbors,
  expire,
  validateConfig,
  type Game,
} from './engine';
const config = { rows: 5, cols: 5, mines: 3 };
function fixture(): Game {
  const g = createGame({ rows: 3, cols: 3, mines: 1 });
  g.planted = true;
  g.status = 'playing';
  g.cells[0].mine = true;
  g.cells.forEach((c, i) => (c.adjacent = [1, 3, 4].includes(i) ? 1 : 0));
  return g;
}
describe('Minesweeper rules', () => {
  it('excludes every first-click position and places exactly the requested mines', () => {
    for (let i = 0; i < 25; i++)
      for (let trial = 0; trial < 15; trial++) {
        const g = reveal(createGame(config), i);
        expect(g.cells[i].mine).toBe(false);
        expect(g.cells.filter((c) => c.mine)).toHaveLength(3);
        expect(g.status).not.toBe('lost');
      }
  });
  it('calculates corner, edge and center counts without wrapping rows', () => {
    expect(neighbors(0, config)).toEqual([1, 5, 6]);
    expect(neighbors(4, config)).toEqual([3, 8, 9]);
    expect(neighbors(12, config)).toHaveLength(8);
    const g = reveal(createGame(config), 12, () => 0);
    expect(g.cells.slice(0, 3).map((c) => c.mine)).toEqual([true, true, true]);
    expect(g.cells[6].adjacent).toBe(3);
    expect(g.cells[5].adjacent).toBe(2);
    expect(g.cells[4].adjacent).toBe(0);
  });
  it('expands zero regions and wins only when all safe cells are open', () => {
    const g = reveal(fixture(), 8);
    expect(g.status).toBe('won');
    expect(g.cells.filter((c) => c.revealed)).toHaveLength(8);
    expect(g.cells[0].revealed).toBe(false);
  });
  it('flags do not reveal cells or start the timer; flagged safe cells block a win', () => {
    const flagged = toggleFlag(fixture(), 8);
    expect(reveal(flagged, 8)).toBe(flagged);
    const g = reveal(flagged, 7);
    expect(g.status).toBe('playing');
    expect(g.cells[8].revealed).toBe(false);
    expect(reveal(toggleFlag(g, 8), 8).status).toBe('won');
    expect(toggleFlag(createGame(config), 0).status).toBe('ready');
  });
  it('reveals all mines on loss, marks the hit and locks ended games', () => {
    const g = reveal(fixture(), 0);
    expect(g.status).toBe('lost');
    expect(g.hit).toBe(0);
    expect(g.cells[0].revealed).toBe(true);
    expect(reveal(g, 5)).toBe(g);
    expect(toggleFlag(g, 5)).toBe(g);
  });
  it('does not mutate input and resets all state for a new game', () => {
    const original = createGame(config);
    reveal(original, 0);
    expect(original).toEqual(createGame(config));
    const g = createGame(config);
    expect(g.planted).toBe(false);
    expect(g.hit).toBeNull();
    expect(g.cells.every((c) => !c.flagged && !c.revealed && !c.mine)).toBe(true);
  });
  it('limits flags and supports timeout only after first reveal', () => {
    const g = toggleFlag(toggleFlag(toggleFlag(createGame(config), 0), 1), 2);
    expect(toggleFlag(g, 3)).toBe(g);
    expect(expire(createGame(config)).status).toBe('ready');
    expect(expire(fixture()).status).toBe('timeout');
  });
  it('rejects invalid or excessive boards; supports dense boards', () => {
    for (const c of [
      { rows: 0, cols: 5, mines: 2 },
      { rows: 5, cols: 5, mines: 25 },
      { rows: 5.5, cols: 5, mines: 2 },
      { rows: 21, cols: 5, mines: 2 },
    ])
      expect(() => validateConfig(c)).toThrow();
    const g = reveal(createGame({ rows: 3, cols: 3, mines: 8 }), 4);
    expect(g.status).toBe('won');
    expect(g.cells[4].adjacent).toBe(8);
  });
});
