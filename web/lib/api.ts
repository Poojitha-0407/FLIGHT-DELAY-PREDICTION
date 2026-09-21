import type {
  Airport, CarrierRow, DashboardSummary, HourRow, Prediction, Route,
} from "./types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getAirports = () =>
  get<{ airports: Airport[] }>("/api/airports").then((d) => d.airports);

export const getRoutes = (minFlights = 500) =>
  get<{ routes: Route[] }>(`/api/routes?min_flights=${minFlights}&limit=2000`)
    .then((d) => d.routes);

export const getDashboard = () => get<DashboardSummary>("/api/dashboard");

export const getCarriers = () =>
  get<{ carriers: CarrierRow[] }>("/api/carriers").then((d) => d.carriers);

export const getAirportHours = (iata: string) =>
  get<{ hours: HourRow[] }>(`/api/airports/${iata}/hours`).then((d) => d.hours);

export async function predict(body: {
  origin: string;
  dest: string;
  carrier: string;
  departure_local: string;
}): Promise<Prediction> {
  const res = await fetch("/api/predict", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail ?? "Prediction failed");
  }
  return res.json();
}

/* Risk ramp, anchored on the real spread rather than round numbers. Rates run
 * 0.07-0.36 but 90% sit between these two, so a 0.10-0.45 ramp spent most of
 * itself on routes that don't exist and everything came out yellow. */
export const RISK_P05 = 0.087;
export const RISK_P95 = 0.214;

const RAMP: Array<[number, [number, number, number]]> = [
  [0.00, [0, 255, 156]],
  [0.38, [120, 230, 90]],
  [0.62, [255, 176, 0]],
  [0.82, [255, 107, 31]],
  [1.00, [255, 59, 48]],
];

export function delayColor(rate: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (rate - RISK_P05) / (RISK_P95 - RISK_P05)));
  for (let i = 1; i < RAMP.length; i++) {
    const [stop, col] = RAMP[i];
    const [prevStop, prevCol] = RAMP[i - 1];
    if (t <= stop) {
      const k = stop === prevStop ? 0 : (t - prevStop) / (stop - prevStop);
      return [
        Math.round(prevCol[0] + k * (col[0] - prevCol[0])),
        Math.round(prevCol[1] + k * (col[1] - prevCol[1])),
        Math.round(prevCol[2] + k * (col[2] - prevCol[2])),
      ];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

export const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
