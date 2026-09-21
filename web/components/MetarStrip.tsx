"use client";

import type { Prediction } from "@/lib/types";

/* Not a real METAR -- the model's inputs written in METAR's grammar, which is
 * a good compact encoding. Anything that'd draw a caution in a briefing goes
 * amber: gusts, low vis, precip. */

type Wx = Record<string, number | string | null>;

const n = (v: number | string | null | undefined): number | null =>
  typeof v === "number" ? v : null;

function pad(v: number | null, width: number, digits = 0): string {
  if (v == null) return "///";
  return Math.abs(v).toFixed(digits).padStart(width, "0");
}

function Wind({ wx }: { wx: Wx }) {
  const w = n(wx.wind_kt);
  const g = n(wx.gust_kt);
  if (w == null) return <span>/////KT </span>;
  const gusting = g != null && g > 0;
  return (
    <span className={gusting ? "warn" : undefined}>
      {pad(Math.round(w), 2)}
      {gusting ? `G${pad(Math.round(g), 2)}` : ""}KT{" "}
    </span>
  );
}

function Visibility({ wx }: { wx: Wx }) {
  const v = n(wx.visibility_mi);
  if (v == null) return <span>////SM </span>;
  // under 3SM is where approaches start getting restricted
  return <span className={v < 3 ? "warn" : undefined}>{v.toFixed(0)}SM </span>;
}

function Precip({ wx }: { wx: Wx }) {
  const p = n(wx.precip_in);
  if (p == null || p <= 0.0005) return null;
  return <span className="warn">RA{p.toFixed(2)}IN </span>;
}

function Temp({ wx }: { wx: Wx }) {
  const t = n(wx.temp_f);
  if (t == null) return <span>//C </span>;
  const c = Math.round((t - 32) * 5 / 9);
  // real METAR is temp/dewpoint; no dewpoint here so drop the slash
  return <span>{c < 0 ? "M" : ""}{pad(c, 2)}C </span>;
}

function Row({ station, wx }: { station: string; wx: Wx }) {
  const src = String(wx.source ?? "");
  const tag = src.startsWith("open-meteo") ? "FCST"
    : src.startsWith("iem") ? "OBS"
    : "NORM";
  return (
    <div>
      <span className="stn">{station}</span>{" "}
      <Wind wx={wx} />
      <Visibility wx={wx} />
      <Precip wx={wx} />
      <Temp wx={wx} />
      <span className="src">{tag}</span>
    </div>
  );
}

export default function MetarStrip({
  result, origin, dest,
}: { result: Prediction; origin: string; dest: string }) {
  return (
    <div className="metar">
      <Row station={origin} wx={result.weather.origin as Wx} />
      <Row station={dest} wx={result.weather.dest as Wx} />
    </div>
  );
}

/** Expands the tag above. */
export function sourceLegend(wx: Wx): string {
  const src = String(wx?.source ?? "");
  if (src.startsWith("open-meteo")) return "FCST - hourly forecast";
  if (src.startsWith("iem")) return "OBS - latest observation";
  return "NORM - monthly normal, beyond forecast range";
}
