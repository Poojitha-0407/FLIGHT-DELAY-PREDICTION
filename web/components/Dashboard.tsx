"use client";

import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { delayColor, getAirportHours, rgb } from "@/lib/api";
import type { DashboardSummary, HourRow, Route } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const AXIS = {
  stroke: "#62656b",
  fontSize: 10,
  fontFamily: "var(--font-mono-stack)",
  tickLine: false,
} as const;
const GRID = "rgba(255,255,255,0.07)";
const CYAN = "#62c9ff";
const AMBER = "#ffb224";
const DEEP = "#2b3a4d";

const tooltipStyle = {
  background: "rgba(10,11,13,0.97)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 10,
  fontFamily: "var(--font-mono-stack)",
  fontSize: 11,
} as const;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

interface Props {
  summary: DashboardSummary;
  routes: Route[];
  selected: string | null;
}

export default function Dashboard({ summary, routes, selected }: Props) {
  const focus = selected ?? summary.airports[0]?.iata;
  const [hours, setHours] = useState<HourRow[]>([]);

  useEffect(() => {
    if (!focus) return;
    let live = true;
    getAirportHours(focus)
      .then((h) => { if (live) setHours(h); })
      .catch(() => { if (live) setHours([]); });
    return () => { live = false; };
  }, [focus]);

  // Both ends. A worst-12 list clamps every bar to the top of the ramp, so
  // the colour says nothing and you learn only that bad routes are bad.
  const ranked = [...routes]
    .filter((r) => r.flights >= 1000)
    .sort((a, b) => b.delay_rate - a.delay_rate)
    .map((r) => ({ ...r, label: `${r.origin}–${r.dest}` }));
  const spread = [...ranked.slice(0, 8), ...ranked.slice(-8).reverse()];

  const monthly = summary.monthly.map((m) => ({ ...m, label: MONTHS[m.month - 1] }));
  const busiest = [...summary.airports].slice(0, 15);

  return (
    <div style={{ display: "contents" }}>
      <Metrics summary={summary} />

      <div className="tile">
        <h2>Seasonality</h2>
        <p className="note">
          Seasonality across {summary.meta.year}: summer thunderstorms and the
          December holiday peak are the two structural bulges.
        </p>
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={monthly} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="label" {...AXIS} />
            <YAxis tickFormatter={pct} {...AXIS} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => pct(v)} />
            <Line type="monotone" dataKey="delay_rate" stroke={CYAN} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="tile">
        <h2>{focus} &middot; hourly bank structure</h2>
        <p className="note">
          Departures and their delay rate through the operating day. Delay
          compounds as the bank structure fills up.
        </p>
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={hours} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="hour_of_day" {...AXIS} />
            <YAxis yAxisId="left" {...AXIS} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={pct} {...AXIS} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-mono-stack)" }} />
            <Bar yAxisId="left" dataKey="flights" name="departures" fill={DEEP} />
            <Line yAxisId="right" type="monotone" dataKey="delay_rate" name="delay rate"
                  stroke={AMBER} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="tile">
        <h2>Corridor reliability spread</h2>
        <p className="note">
          The eight least and eight most reliable corridors carrying at least
          1,000 flights in {summary.meta.year}.
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={spread} layout="vertical"
                    margin={{ top: 8, right: 16, bottom: 0, left: 24 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={pct} {...AXIS} />
            <YAxis type="category" dataKey="label" width={80} {...AXIS} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => pct(v)} />
            <Bar dataKey="delay_rate" name="delay rate">
              {spread.map((r) => (
                <Cell key={r.label} fill={rgb(delayColor(r.delay_rate))} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="tile">
        <h2>Carrier performance</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={summary.carriers} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="carrier" {...AXIS} />
            <YAxis tickFormatter={pct} {...AXIS} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => pct(v)} />
            <Bar dataKey="delay_rate" name="delay rate">
              {summary.carriers.map((c) => (
                <Cell key={c.carrier} fill={rgb(delayColor(c.delay_rate))} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="tile">
        <h2>Traffic and reliability</h2>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={busiest} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="iata" {...AXIS} />
            <YAxis yAxisId="left" {...AXIS} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={pct} {...AXIS} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-mono-stack)" }} />
            <Bar yAxisId="left" dataKey="departures" name="departures" fill={DEEP} />
            <Line yAxisId="right" type="monotone" dataKey="dep_delay_rate" name="delay rate"
                  stroke={AMBER} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Metrics({ summary }: { summary: DashboardSummary }) {
  const m = summary.model_metrics;
  return (
    <div className="tile">
      <h2>Model &middot; held-out test</h2>
      {m ? (
        <>
          <p className="note">
            {m.date_range[0]} to {m.date_range[1]} · {m.rows.toLocaleString()} flights ·
            never seen during training or early stopping.
          </p>
          <div className="kv"><span>ROC-AUC</span><span>{m.roc_auc.toFixed(3)}</span></div>
          <div className="kv">
            <span>PR-AUC</span>
            <span>{m.pr_auc.toFixed(3)} ({m.pr_auc_lift_over_base}× base rate)</span>
          </div>
          <div className="kv"><span>Base delay rate</span><span>{pct(m.base_delay_rate)}</span></div>
          <div className="kv">
            <span>Brier</span>
            <span>{m.brier.toFixed(4)} vs {m.brier_baseline.toFixed(4)} baseline</span>
          </div>
          <div className="kv"><span>Log loss</span><span>{m.log_loss.toFixed(4)}</span></div>
        </>
      ) : (
        <p className="note">Run <code>make evaluate</code> then <code>make export</code>.</p>
      )}
    </div>
  );
}
