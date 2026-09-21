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

function defaultDeparture(): string {
  const t = new Date(Date.now() + 24 * 3600 * 1000);
  t.setMinutes(0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:00`;
}

export default function PredictForm({
  airports, carriers, origin, dest, onOriginChange, onDestChange,
}: Props) {
  const [carrier, setCarrier] = useState("AA");
  const [departure, setDeparture] = useState(defaultDeparture);
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
      <div className="bay">
        <div className="bay-head">
          <h2 className="label" style={{ color: "var(--amber)" }}>Flight plan</h2>
        </div>

        <form onSubmit={submit}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="origin">Origin</label>
              <select id="origin" value={origin} onChange={(e) => onOriginChange(e.target.value)}>
                {airports.map((a) => (
                  <option key={a.iata} value={a.iata}>{a.iata} &middot; {a.city}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="dest">Destination</label>
              <select id="dest" value={dest} onChange={(e) => onDestChange(e.target.value)}>
                {airports.map((a) => (
                  <option key={a.iata} value={a.iata}>{a.iata} &middot; {a.city}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid2">
            <div className="field">
              <label htmlFor="carrier">Carrier</label>
              <select id="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                {carriers.map((c) => (
                  <option key={c.carrier} value={c.carrier}>{c.carrier}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="dep">Departure &middot; local</label>
              <input id="dep" type="datetime-local" value={departure}
                     onChange={(e) => setDeparture(e.target.value)} />
            </div>
          </div>

          <button className="execute" type="submit" data-busy={busy} disabled={busy || same}>
            {busy ? "Computing" : same ? "Select two airports" : "Compute risk"}
          </button>
        </form>

        {error && <div className="err">{error}</div>}
      </div>

      <div className="bay">
        <RiskGauge result={result} />
        {!result && !error && (
          <p style={{
            margin: "14px 0 0", fontSize: 11, lineHeight: 1.7,
            color: "var(--text-faint)", textAlign: "center",
          }}>
            Probability this flight arrives more than 30 minutes late, from the
            schedule, the airport&apos;s own history and live weather at both ends.
            The dashed cyan line marks this route&apos;s usual rate.
          </p>
        )}
      </div>

      {result && <Readout result={result} origin={origin} dest={dest} />}
    </>
  );
}

function Readout({ result, origin, dest }: { result: Prediction; origin: string; dest: string }) {
  const base = result.baseline_route_rate;
  const delta = base == null ? null : result.probability - base;

  return (
    <>
      <div className="bay">
        <div className="bay-head">
          <h2 className="label" style={{ color: "var(--amber)" }}>Conditions</h2>
          <span className="label" style={{ fontSize: 9 }}>
            {sourceLegend(result.weather.origin as Record<string, number | string | null>)}
          </span>
        </div>
        <MetarStrip result={result} origin={origin} dest={dest} />

        <div style={{ marginTop: 14 }}>
          {base != null && (
            <div className="row">
              <span>{origin}&ndash;{dest} historical</span>
              <span>{(base * 100).toFixed(1)}%</span>
            </div>
          )}
          {delta != null && (
            <div className="row">
              <span>Model delta</span>
              <span style={{ color: delta > 0 ? "var(--red)" : "var(--green)" }}>
                {delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)} pts
              </span>
            </div>
          )}
          <div className="row">
            <span>Arrives</span>
            <span>{result.scheduled_arrival_local.replace("T", " ")}</span>
          </div>
          <div className="row">
            <span>Distance</span>
            <span>{Math.round(result.distance_km).toLocaleString()} km</span>
          </div>
        </div>
      </div>

      <div className="bay">
        <div className="bay-head">
          <h2 className="label" style={{ color: "var(--amber)" }}>Contributing factors</h2>
        </div>
        {result.top_drivers.map((d) => {
          const mag = Math.min(1, Math.abs(d.contribution) / 0.4);
          const up = d.direction === "increases";
          return (
            <div key={d.feature} className="driver">
              <span className="nm">{d.feature.replace(/_/g, " ")}</span>
              <span className={up ? "up" : "dn"}>
                {up ? "▲" : "▼"} {Math.abs(d.contribution).toFixed(3)}
              </span>
              <span className="driver-bar">
                <i style={{
                  background: up ? "var(--red)" : "var(--green)",
                  width: `${mag * 50}%`,
                  left: up ? "50%" : `${50 - mag * 50}%`,
                }} />
              </span>
            </div>
          );
        })}
        <p style={{ margin: "12px 0 0", fontSize: 10, lineHeight: 1.6, color: "var(--text-faint)" }}>
          Log-odds contributions from the model itself, not a narrative added afterwards.
        </p>
      </div>
    </>
  );
}
