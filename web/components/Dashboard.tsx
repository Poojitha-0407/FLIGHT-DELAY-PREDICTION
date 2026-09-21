"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { delayColor, getAirportHours, rgb } from "@/lib/api";
import type { DashboardSummary, HourRow, Route } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const AXIS = {
  stroke: "#8d90a5",
  fontSize: 11,
  fontFamily: "var(--font-mono-stack)",
  tickLine: false,
} as const;

const GRID = "#e8edf5";
const SKY_BLUE = "#0770e3";
const SKY_TEAL = "#00a698";
const SKY_NAVY = "#05203c";
const AMBER = "#f39c12";

const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid #e0e4eb",
  borderRadius: 8,
  boxShadow: "0 4px 14px rgba(5, 32, 60, 0.12)",
  fontFamily: "var(--font-mono-stack)",
  fontSize: 12,
  color: "#111236",
} as const;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

interface Props {
  summary: DashboardSummary;
  routes: Route[];
  selected: string | null;
}

export default function Dashboard({ summary, routes, selected }: Props) {
  const focus = selected ?? summary.airports[0]?.iata ?? "EWR";
  const [hours, setHours] = useState<HourRow[]>([]);

  useEffect(() => {
    if (!focus) return;
    let live = true;
    getAirportHours(focus)
      .then((h) => {
        if (live) setHours(h);
      })
      .catch(() => {
        if (live) setHours([]);
      });
    return () => {
      live = false;
    };
  }, [focus]);

  const ranked = [...routes]
    .filter((r) => r.flights >= 1000)
    .sort((a, b) => b.delay_rate - a.delay_rate)
    .map((r) => ({ ...r, label: `${r.origin}–${r.dest}` }));
  const spread = [...ranked.slice(0, 8), ...ranked.slice(-8).reverse()];

  const monthly = summary.monthly.map((m) => ({ ...m, label: MONTHS[m.month - 1] }));
  const busiest = [...summary.airports].slice(0, 15);

  return (
    <div style={{ width: "100%" }}>
      {/* Top Skyscanner KPI Row */}
      <div className="sky-kpi-row">
        <div className="sky-kpi-card">
          <div className="sky-kpi-num mono">{summary.meta.year}</div>
          <div className="sky-kpi-label">BTS Analysis Year</div>
        </div>

        <div className="sky-kpi-card">
          <div className="sky-kpi-num mono">
            {summary.model_metrics?.roc_auc.toFixed(3) ?? "--"}
          </div>
          <div className="sky-kpi-label">Model ROC-AUC Score</div>
        </div>

        <div className="sky-kpi-card">
          <div className="sky-kpi-num mono">
            {summary.model_metrics
              ? pct(summary.model_metrics.base_delay_rate)
              : "--"}
          </div>
          <div className="sky-kpi-label">Base Delay Rate (&gt;30m)</div>
        </div>

        <div className="sky-kpi-card">
          <div className="sky-kpi-num mono">
            {summary.model_metrics
              ? `${summary.model_metrics.pr_auc_lift_over_base}×`
              : "--"}
          </div>
          <div className="sky-kpi-label">PR-AUC Lift Over Baseline</div>
        </div>
      </div>

      {/* Grid of Skyscanner Insight Cards */}
      <div className="sky-insights-grid">
        {/* Card 1: Seasonality */}
        <div className="sky-insight-card">
          <h3>Annual Flight Delay Seasonality</h3>
          <p className="sky-insight-desc">
            Historical monthly delay rates: summer thunderstorms (June–July) and December holiday peak congestions.
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthly} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis tickFormatter={pct} {...AXIS} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => pct(v)} />
              <Line type="monotone" dataKey="delay_rate" stroke={SKY_BLUE} strokeWidth={2.5} dot={{ r: 3, fill: SKY_BLUE }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Card 2: Airport Hourly Bank Structure */}
        <div className="sky-insight-card">
          <h3>{focus} Hub &middot; Hourly Flight Departures & Delays</h3>
          <p className="sky-insight-desc">
            Scheduled departures and cascading delay rates through the operating day. Delays compound heavily after 16:00.
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={hours} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="hour_of_day" {...AXIS} />
              <YAxis yAxisId="left" {...AXIS} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={pct} {...AXIS} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: "var(--font-sans-stack)" }} />
              <Bar yAxisId="left" dataKey="flights" name="Scheduled departures" fill={SKY_NAVY} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="delay_rate" name="Delay rate" stroke={AMBER} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Card 3: Corridor Spread */}
        <div className="sky-insight-card">
          <h3>Corridor Reliability Spread</h3>
          <p className="sky-insight-desc">
            The 8 least and 8 most reliable high-volume domestic flight corridors (&ge;1,000 flights).
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={spread} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 28 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={pct} {...AXIS} />
              <YAxis type="category" dataKey="label" width={80} {...AXIS} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => pct(v)} />
              <Bar dataKey="delay_rate" name="Delay rate" radius={[0, 3, 3, 0]}>
                {spread.map((r) => (
                  <Cell key={r.label} fill={rgb(delayColor(r.delay_rate))} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Card 4: Carrier Performance */}
        <div className="sky-insight-card">
          <h3>Major US Carrier Delay Rates</h3>
          <p className="sky-insight-desc">
            Full-year arrival delay percentage by reporting carrier across the 30 busiest airports.
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={summary.carriers} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="carrier" {...AXIS} />
              <YAxis tickFormatter={pct} {...AXIS} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => pct(v)} />
              <Bar dataKey="delay_rate" name="Delay rate" radius={[3, 3, 0, 0]}>
                {summary.carriers.map((c) => (
                  <Cell key={c.carrier} fill={rgb(delayColor(c.delay_rate))} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
