// Shapes returned by the f1qp API (f1qp/server.py).

export type Group = "driver" | "car" | "weekend" | "context";
export const GROUPS: Group[] = ["driver", "car", "weekend", "context"];
export type Contrib = Record<Group, number>;

export interface DriverMeta {
  id: string;
  name: string;
  team: string;
  last_season: number;
  number: number | null;
  sessions: number;
  /** season -> team id that season (last team if they changed mid-season) */
  teams: Record<string, string>;
}
export interface TeamMeta { id: string; name: string; color: string }
export interface CircuitMeta { id: string; name: string; outline: string | null; length_m: number | null }
export interface LiveStatus { enabled: boolean; interval_s: number; last_run: string | null; running: boolean; error: string | null }

export interface Meta {
  seasons: number[];
  latest: number;
  data_version: string;
  built_at: string;
  drivers: DriverMeta[];
  teams: TeamMeta[];
  circuits: CircuitMeta[];
  groups: Record<Group, string[]>;
  live: LiveStatus;
}

export interface Metrics {
  sessions: number;
  correct_per_10: number;
  perfect_sessions: number;
  worst_session: number;
  mae_all: number;
  mae_top10: number;
}

export interface Overview {
  seasons: number[];
  latest: number;
  overall: Metrics;
  by_season: Record<string, Metrics>;
  baselines: Record<string, Metrics>;
  baselines_by_season: Record<string, Record<string, number>>;
  histogram: Record<string, number>;
  importance: [string, number][];
  group_size: Record<Group, number>;
  feature_groups: Record<Group, string[]>;
}

export interface Result {
  season: number;
  round: number;
  race_key: string;
  gp: string;
  circuit: string;
  team: string;
  pos: number;
  status: string | null;
  pred: number;
  pred_rank: number;
  picked: boolean;
  right: boolean;
}

export interface Stats {
  sessions: number;
  avg_pos: number | null;
  best: number | null;
  q3_rate: number | null;
  poles: number;
  avg_pred: number | null;
  right: number;
  contrib_driver: number | null;
  contrib_car: number | null;
  contrib_weekend: number | null;
  contrib_context: number | null;
}

export interface DriverDetail extends Stats {
  id: string;
  name: string;
  teams: { team: string; season: number; sessions: number }[];
  tracks: (Stats & { circuit: string; name: string; results: Result[] })[];
}

export interface TrackDetail {
  id: string;
  name: string;
  model_correct: number | null;
  sessions: { race_key: string; season: number; correct: number; pole: string }[];
  drivers: (Stats & { driver: string; name: string; team: string; results: Result[] })[];
}

export interface SessionSummary { race_key: string; season: number; round: number; gp: string; circuit: string; date: string; sprint: boolean; correct: number }

export interface SessionRow extends Result { driver: string; fp_last_pos: number | null; contrib: Contrib; baseline: number }
export interface SessionDetail extends Omit<SessionSummary, "correct"> { correct: number; mae: number; rows: SessionRow[] }

export interface CarSummary {
  team: string;
  name: string;
  engine: string;
  chassis: string | null;
  livery: [string, string, string];
  era: string;
  era_label: string;
  era_summary: string;
  avg_pos: number;
  pace_gap: number;
  car_contrib: number;
  q3_rate: number;
  drivers: string[];
}
export interface CarList { season: number; era: string; cars: CarSummary[]; parts: Record<string, string> }

export interface CarDetail extends Stats {
  season: number;
  team: string;
  name: string;
  engine: string;
  chassis: string | null;
  livery: [string, string, string];
  era: string;
  era_label: string;
  era_summary: string;
  parts: Record<string, string>;
  pace_gap: number;
  pace_rank: number;
  teams_in_season: number;
  lineage: { season: number; team: string; name: string }[];
  trend: { race_key: string; round: number; gp: string; gap: number | null; rank: number | null; best_pos: number; car_contrib: number }[];
  drivers: (Stats & { driver: string; name: string; vs_teammate: number | null })[];
}

export interface Heatmap {
  circuits: string[];
  drivers: { driver: string; avg: number; team: string }[];
  cells: { driver: string; circuit: string; avg: number; n: number; best: number; right: number }[];
}

export interface Swap {
  race_key: string;
  driver: string;
  team: string;
  from_team: string;
  score: number;
  grid: number;
  own_score: number;
  own_grid: number;
  actual: number | null;
  contrib: Contrib;
  own_contrib: Contrib;
  baseline: number;
}

export interface LivePrediction {
  race_key: string;
  season: number;
  round: number;
  grand_prix: string;
  circuit: string;
  date: string;
  sessions_used: string[];
  qualifying_done: boolean;
  model: string;
  correct?: number;
  mae?: number;
  rows: { pred_pos: number; score: number; driver_id: string; constructor_id: string; fp_last_pos: number | null; quali_pos: number | null; contrib: Contrib }[];
}
export interface Live { status: LiveStatus; prediction: LivePrediction | null }
