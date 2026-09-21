export interface Airport {
  iata: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  tz: string;
  summary: AirportSummary | null;
}

export interface AirportSummary {
  iata: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  departures: number;
  arrivals: number;
  dep_delay_rate: number;
  arr_delay_rate: number;
  avg_delay_min: number;
  peak_hourly_departures: number;
}

export interface OperatingCarrier {
  carrier: string;
  flights: number;
  carrier_route_delay_rate: number;
}

export interface Route {
  origin: string;
  dest: string;
  origin_name: string;
  origin_city: string;
  origin_lat: number;
  origin_lon: number;
  dest_name: string;
  dest_city: string;
  dest_lat: number;
  dest_lon: number;
  flights: number;
  delay_rate: number;
  avg_delay_min: number;
  p90_delay_min: number;
  distance_km: number;
  cancelled: number;
  cancel_rate: number;
  operating_carriers?: OperatingCarrier[];
}

export interface HourRow {
  iata: string;
  hour_of_day: number;
  flights: number;
  delay_rate: number;
  avg_delay_min: number;
}

export interface CarrierRow {
  carrier: string;
  flights: number;
  delay_rate: number;
  avg_delay_min: number;
}

export interface MonthRow {
  month: number;
  flights: number;
  delay_rate: number;
  avg_delay_min: number;
}

export interface ModelMetrics {
  split: string;
  rows: number;
  date_range: [string, string];
  base_delay_rate: number;
  roc_auc: number;
  pr_auc: number;
  pr_auc_lift_over_base: number;
  brier: number;
  brier_baseline: number;
  log_loss: number;
}

export interface DashboardSummary {
  meta: { year: number; train_end: string; valid_end: string; target: string };
  model_metrics: ModelMetrics | null;
  carriers: CarrierRow[];
  monthly: MonthRow[];
  airports: AirportSummary[];
}

export interface Driver {
  feature: string;
  value: number;
  contribution: number;
  direction: "increases" | "decreases";
}

export interface Prediction {
  probability: number;
  probability_uncalibrated: number;
  risk_band: "low" | "moderate" | "elevated" | "high";
  baseline_route_rate: number | null;
  scheduled_arrival_local: string;
  distance_km: number;
  weather: {
    origin: Record<string, number | string | null>;
    dest: Record<string, number | string | null>;
  };
  top_drivers: Driver[];
}
