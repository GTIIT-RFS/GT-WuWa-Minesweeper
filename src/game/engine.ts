/** Pure immutable game rules. Coordinates are row-major. No React or storage dependencies. */
export interface BoardConfig {
  rows: number;
  cols: number;
  mines: number;
}
export type Status = 'ready' | 'playing' | 'won' | 'lost' | 'timeout';
export interface Cell {
  mine: boolean;
  adjacent: number;
  revealed: boolean;
  flagged: boolean;
}
export interface Game {
  config: BoardConfig;
  cells: Cell[];
  status: Status;
  planted: boolean;
  hit: number | null;
}
export const PRESETS = {
  easy: { label: '路人体验', rows: 5, cols: 5, mines: 3 },
  normal: { label: '普通模式', rows: 8, cols: 8, mines: 10 },
  hard: { label: '挑战模式', rows: 10, cols: 10, mines: 15 },
} as const;
export function validateConfig(c: BoardConfig): void {
  if (
    ![c.rows, c.cols, c.mines].every(Number.isInteger) ||
    c.rows < 3 ||
    c.rows > 20 ||
    c.cols < 3 ||
    c.cols > 20 ||
    c.mines < 1 ||
    c.mines >= c.rows * c.cols
  )
    throw new Error('行列须为 3–20 的整数，土豆数须为 1 到总格数减 1。');
}
export function createGame(config: BoardConfig): Game {
  validateConfig(config);
  return {
    config: { ...config },
    cells: Array.from({ length: config.rows * config.cols }, () => ({
      mine: false,
      adjacent: 0,
      revealed: false,
      flagged: false,
    })),
    status: 'ready',
    planted: false,
    hit: null,
  };
}
export function neighbors(i: number, { rows, cols }: BoardConfig): number[] {
  const out: number[] = [],
    row = Math.floor(i / cols),
    col = i % cols;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if ((dr || dc) && row + dr >= 0 && row + dr < rows && col + dc >= 0 && col + dc < cols)
        out.push((row + dr) * cols + col + dc);
    }
  return out;
}
const active = (g: Game) => g.status === 'ready' || g.status === 'playing';
export function toggleFlag(g: Game, index: number): Game {
  if (!active(g) || !g.cells[index] || g.cells[index].revealed) return g;
  if (!g.cells[index].flagged && g.cells.filter((c) => c.flagged).length >= g.config.mines)
    return g;
  return { ...g, cells: g.cells.map((c, i) => (i === index ? { ...c, flagged: !c.flagged } : c)) };
}
export function reveal(g: Game, index: number, random: () => number = Math.random): Game {
  if (!active(g) || !g.cells[index] || g.cells[index].flagged || g.cells[index].revealed) return g;
  const cells = g.cells.map((c) => ({ ...c }));
  if (!g.planted) {
    const available = cells.map((_, i) => i).filter((i) => i !== index);
    // Partial Fisher–Yates: uniform sampling, exactly mines unique positions; first click excluded.
    for (let k = 0; k < g.config.mines; k++) {
      const j = k + Math.floor(random() * (available.length - k));
      [available[k], available[j]] = [available[j], available[k]];
      cells[available[k]].mine = true;
    }
    cells.forEach((c, i) => {
      c.adjacent = neighbors(i, g.config).filter((n) => cells[n].mine).length;
    });
  }
  if (cells[index].mine) {
    cells.forEach((c) => {
      if (c.mine) c.revealed = true;
    });
    return { ...g, cells, planted: true, status: 'lost', hit: index };
  }
  const queue = [index];
  while (queue.length) {
    const i = queue.pop()!,
      c = cells[i];
    if (c.revealed || c.flagged || c.mine) continue;
    c.revealed = true;
    if (!c.adjacent) queue.push(...neighbors(i, g.config));
  }
  const won = cells.every((c) => c.mine || c.revealed);
  return { ...g, cells, planted: true, status: won ? 'won' : 'playing' };
}
export function expire(g: Game): Game {
  return g.status === 'playing'
    ? {
        ...g,
        status: 'timeout',
        cells: g.cells.map((c) => (c.mine ? { ...c, revealed: true } : c)),
      }
    : g;
}
