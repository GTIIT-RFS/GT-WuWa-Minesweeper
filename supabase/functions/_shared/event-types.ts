export interface Stage {
  id: string;
  round_no: number;
  starts_at: string;
  ends_at: string;
  prize_count: number;
  settled_at: string | null;
}
export interface RankedScore {
  player_id: string;
  rank: number;
  display_name: string;
  elapsed_ms: number;
  achieved_at: string;
}
export interface EventBoard {
  entries: RankedScore[];
  mine: RankedScore | null;
  total: number;
}
export type AwardStatus = 'pending' | 'unclaimed' | 'claimed' | 'waived' | 'disqualified';
export interface Award {
  id: string;
  stage_id: string;
  player_id: string;
  prize_slot: number;
  rank: number;
  display_name: string;
  elapsed_ms: number;
  round_no: number;
  status: AwardStatus;
  predecessor_id: string | null;
  claimed_at: string | null;
  token?: string | null;
}
export interface EventOverview {
  serverNow: string;
  event: {
    id: string;
    title: string;
    event_date: string | null;
    enabled: boolean;
    paused: boolean;
  };
  state: 'unconfigured' | 'upcoming' | 'open' | 'closing' | 'paused' | 'ended';
  stages: Stage[];
  currentStage: Stage | null;
  live: EventBoard;
  evening: EventBoard;
  awards: Award[];
}
export interface AuditEntry {
  id: number;
  actor_id: string | null;
  action: string;
  stage_id: string | null;
  old_state: unknown;
  new_state: unknown;
  reason: string | null;
  created_at: string;
}
export interface AdminData {
  overview: EventOverview;
  wins: {
    id: string;
    stage_id: string;
    player_id: string;
    display_name: string;
    elapsed_ms: number;
    achieved_at: string;
  }[];
  audit: AuditEntry[];
}
export interface EventRepository {
  overview(player: string | null): Promise<unknown>;
  board(kind: string, stage: string | null, player: string | null, page: number): Promise<unknown>;
  awards(player: string): Promise<unknown>;
  adminRead(player: string, page: number): Promise<unknown>;
  adminAction(
    player: string,
    request: string,
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
  testOverview(player: string | null): Promise<unknown>;
  testBoard(kind: string, stage: string | null, player: string | null, page: number): Promise<unknown>;
  testAwards(player: string): Promise<unknown>;
  testAdminSettle(player: string, request: string): Promise<unknown>;
  testAdminAction(
    player: string,
    request: string,
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
}
