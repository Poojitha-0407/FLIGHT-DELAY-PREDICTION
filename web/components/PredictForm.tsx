"use client";

import { useState } from "react";
import { predict } from "@/lib/api";
import MetarStrip, { sourceLegend } from "./MetarStrip";
import RiskGauge from "./RiskGauge";
import type { Airport, CarrierRow, Prediction } from "@/lib/types";

interface Props {
  airports: Airport[];
  carriers: CarrierRow[];
  origin: string;
  dest: string;
  onOriginChange: (v: string) => void;
  onDestChange: (v: string) => void;
}

const BAND_COLOR: Record<Prediction["risk_band"], string> = {
  low: "var(--green)",
  moderate: "var(--amber)",
  elevated: "var(--orange)",
  high: "var(--red)",
};

function tomorrowAtNine(): string {
  const t = new Date(Date.now() + 864e5);
  t.setHours(9, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:00`;
}

export default function PredictForm({
  airports, carriers, origin, dest, onOriginChange, onDestChange,
}: Props) {
  const [carrier, setCarrier] = useState("UA");
  const [departure, setDeparture] = useState(tomorrowAtNine);
  const [result, setResult] = useState<Prediction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await predict({ origin, dest, carrier, departure_local: departure }));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const same = origin === dest;

  return (
    <>
      <div className="section">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Flight</div>
        <form onSubmit={submit}>
          <div className="pair">
            <div className="field">
              <label className="eyebrow" htmlFor="origin">From</label>
              <select id="origin" value={origin} onChange={(e) => onOriginChange(e.target.value)}>
                {airports.map((a) => (
                  <option key={a.iata} value={a.iata}>{a.iata} &nbsp;{a.city}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="eyebrow" htmlFor="dest">To</label>
              <select id="dest" value={dest} onChange={(e) => onDestChange(e.target.value)}>
                {airports.map((a) => (
                  <option key={a.iata} value={a.iata}>{a.iata} &nbsp;{a.city}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pair">
            <div className="field">
              <label className="eyebrow" htmlFor="carrier">Airline</label>
              <select id="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                {carriers.map((c) => <option key={c.carrier} value={c.carrier}>{c.carrier}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="eyebrow" htmlFor="dep">Departs</label>
              <input id="dep" type="datetime-local" value={departure}
                     onChange={(e) => setDeparture(e.target.value)} />
            </div>
          </div>

          <button className="btn" type="submit" disabled={busy || same}>
            {busy ? "Working…" : same ? "Pick two airports" : "Estimate risk"}
          </button>
        </form>
        {error && <div className="err" style={{ marginTop: 9 }}>{error}</div>}
      </div>

      <div className="section">
        {result ? <Verdict result={result} /> : <Empty />}
      </div>

      {result && <Conditions result={result} origin={origin} dest={dest} />}
      {result && <Drivers result={result} />}
    </>
  );
}

function Empty() {
  return (
    <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
      <RiskGauge result={null} />
      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6, color: "var(--fg-3)" }}>
        Chance of arriving more than 30 minutes late, from the schedule, the
        airport&apos;s own history and the weather at both ends.
      </p>
    </div>
  );
}

function Verdict({ result }: { result: Prediction }) {
  const color = BAND_COLOR[result.risk_band];
  const base = result.baseline_route_rate;
  const delta = base == null ? null : result.probability - base;

  return (
    <>
      <div className="verdict">
        <RiskGauge result={result} />
        <div>
          <div className="verdict-num" style={{ color }}>
            {(result.probability * 100).toFixed(1)}%
          </div>
          <div className="chip" style={{ color, marginTop: 8 }}>
            <i />{result.risk_band}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 13 }}>
        {base != null && (
          <div className="kv">
            <span>Route average</span>
            <span>{(base * 100).toFixed(1)}%</span>
          </div>
        )}
        {delta != null && (
          <div className="kv">
            <span>Difference</span>
            <span style={{ color: delta > 0 ? "var(--red)" : "var(--green)" }}>
              {delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)} pts
            </span>
          </div>
        )}
        <div className="kv">
          <span>Arrives</span>
          <span>{result.scheduled_arrival_local.replace("T", " ").slice(0, 16)}</span>
        </div>
        <div className="kv">
          <span>Distance</span>
          <span>{Math.round(result.distance_km).toLocaleString()} km</span>
        </div>
      </div>
    </>
  );
}

function Conditions({ result, origin, dest }: { result: Prediction; origin: string; dest: string }) {
  return (
    <div className="section">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
        <span className="eyebrow">Conditions</span>
        <span className="eyebrow" style={{ letterSpacing: 0, textTransform: "none" }}>
          {sourceLegend(result.weather.origin as Record<string, number | string | null>)}
        </span>
      </div>
      <MetarStrip result={result} origin={origin} dest={dest} />
    </div>
  );
}

function Drivers({ result }: { result: Prediction }) {
  return (
    <div className="section">
      <div className="eyebrow" style={{ marginBottom: 9 }}>What moved it</div>
      {result.top_drivers.map((d) => {
        const up = d.direction === "increases";
        const mag = Math.min(1, Math.abs(d.contribution) / 0.4);
        return (
          <div className="driver" key={d.feature}>
            <span className="nm">{d.feature.replace(/_/g, " ")}</span>
            <span className="val" style={{ color: up ? "var(--red)" : "var(--green)" }}>
              {up ? "+" : "−"}{Math.abs(d.contribution).toFixed(3)}
            </span>
            <span className="track">
              <i style={{
                background: up ? "var(--red)" : "var(--green)",
                width: `${mag * 50}%`,
                left: up ? "50%" : `${50 - mag * 50}%`,
              }} />
            </span>
          </div>
        );
      })}
      <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--fg-3)", lineHeight: 1.5 }}>
        Log-odds contributions from the model, not a story added afterwards.
      </p>
    </div>
  );
}
