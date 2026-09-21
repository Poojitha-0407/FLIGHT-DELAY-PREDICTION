"use client";

import React, { useState } from "react";
import type { Prediction } from "@/lib/types";

export interface PlaneFlightItem {
  id: string;
  carrier: string;
  carrierName: string;
  flightsOnRoute: number;
  historicalDelayRate: number;
  depTime: string;
  arrTime: string;
  duration: string;
  origin: string;
  dest: string;
  prediction: Prediction | null;
  loading?: boolean;
}

interface FlightCardProps {
  flight: PlaneFlightItem;
}

export default function FlightCard({ flight }: FlightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const p = flight.prediction;

  const band = p ? p.risk_band : "low";
  const probPercent = p ? (p.probability * 100).toFixed(1) : "--";
  const baseRate = p?.baseline_route_rate ?? flight.historicalDelayRate;
  const delta = p && baseRate != null ? p.probability - baseRate : null;

  return (
    <article className="sky-flight-card">
      <div className="sky-flight-body" style={{ gridTemplateColumns: "1fr auto" }}>
        {/* Main Flight & Airline Information */}
        <div className="sky-flight-main">
          {/* Airline Header & Delay Risk Status */}
          <div className="sky-airline-info">
            <span className="sky-airline-pill">
              <span className="sky-airline-logo">{flight.carrier.slice(0, 2)}</span>
              <span style={{ fontWeight: 700 }}>{flight.carrierName}</span>
              <span className="mono" style={{ color: "var(--text-muted)" }}>({flight.carrier})</span>
            </span>

            {/* Delay Risk Badge */}
            {flight.loading ? (
              <span className="sky-risk-badge moderate">
                <span>Calculating delay probability...</span>
              </span>
            ) : p ? (
              <span className={`sky-risk-badge ${band}`}>
                <span className="sky-risk-dot" />
                <span>{probPercent}% Predicted Delay Risk ({band})</span>
              </span>
            ) : null}

            {/* Delta vs Route Avg */}
            {delta != null && !flight.loading && (
              <span
                className="mono"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: delta <= 0 ? "var(--risk-low)" : "var(--risk-high)",
                }}
              >
                {delta <= 0 ? "−" : "+"}{Math.abs(delta * 100).toFixed(1)} pts vs route avg
              </span>
            )}

            {/* Pre-departure Weather Chip */}
            {p?.weather && (
              <div className="sky-weather-chip" title="Pre-departure weather at departure and arrival">
                <WeatherIcon />
                <span>
                  {flight.origin}: {tempStr(p.weather.origin)} &middot; {flight.dest}: {tempStr(p.weather.dest)}
                </span>
              </div>
            )}
          </div>

          {/* Timeline Row */}
          <div className="sky-timeline-row">
            {/* Origin Airport */}
            <div className="sky-time-col">
              <span className="sky-time-val mono">{flight.depTime}</span>
              <span className="sky-airport-code">{flight.origin}</span>
            </div>

            {/* Midline Flight Path */}
            <div className="sky-flight-path">
              <span className="sky-flight-dur mono">{flight.duration}</span>
              <div className="sky-path-line">
                <div className="sky-path-plane">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
                  </svg>
                </div>
              </div>
              <span className="sky-path-type">Direct Flight</span>
            </div>

            {/* Destination Airport */}
            <div className="sky-time-col">
              <span className="sky-time-val mono">{flight.arrTime}</span>
              <span className="sky-airport-code">{flight.dest}</span>
            </div>
          </div>
        </div>

        {/* Right Column: Historical Route Context */}
        <div className="sky-flight-action" style={{ minWidth: 160, alignItems: "flex-end" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700 }}>
            Historical Reliability
          </span>
          <span className="mono" style={{ fontSize: 20, fontWeight: 800, color: "var(--sky-navy)" }}>
            {(flight.historicalDelayRate * 100).toFixed(1)}%
          </span>
          <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
            {flight.flightsOnRoute.toLocaleString()} flights recorded
          </span>
        </div>
      </div>

      {/* Card Footer with Expandable Details */}
      <div className="sky-card-footer">
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          Predicted probability of arriving &gt;30 mins late based on pre-departure schedule and METAR weather
        </span>
        {p && (
          <button
            type="button"
            className="sky-details-btn"
            onClick={() => setExpanded(!expanded)}
          >
            <span>{expanded ? "Hide delay drivers" : "View delay drivers & weather"}</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 140ms ease" }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Expanded Root-Cause & Weather Drawer */}
      {expanded && p && (
        <div className="sky-drawer-content">
          {/* Column 1: Feature Contributions */}
          <div className="sky-drawer-col">
            <h4>Delay Risk Drivers (LightGBM Tree Contributions)</h4>
            {p.top_drivers && p.top_drivers.length > 0 ? (
              p.top_drivers.map((d) => {
                const up = d.direction === "increases";
                const mag = Math.min(1, Math.abs(d.contribution) / 0.35);
                return (
                  <div key={d.feature} className="sky-driver-bar-item">
                    <span className="sky-driver-name" title={d.feature}>
                      {d.feature.replace(/_/g, " ")}
                    </span>
                    <span
                      className="sky-driver-val"
                      style={{ color: up ? "var(--risk-high)" : "var(--risk-low)" }}
                    >
                      {up ? "+" : "−"}{Math.abs(d.contribution).toFixed(3)}
                    </span>
                    <div className="sky-driver-track">
                      <div
                        className="sky-driver-fill"
                        style={{
                          width: `${Math.max(8, mag * 100)}%`,
                          background: up ? "var(--risk-high)" : "var(--risk-low)",
                        }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Baseline route factors apply.
              </p>
            )}
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
              Direct log-odds contributions from the model. Green decreases delay risk, red increases risk.
            </p>
          </div>

          {/* Column 2: Flight & Pre-Departure Weather Breakdown */}
          <div className="sky-drawer-col">
            <h4>Flight Metrics & Pre-Departure Weather</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-secondary)" }}>Route Distance:</span>
                <span className="mono" style={{ fontWeight: 600 }}>{Math.round(p.distance_km).toLocaleString()} km</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-secondary)" }}>Scheduled Arrival:</span>
                <span className="mono" style={{ fontWeight: 600 }}>{p.scheduled_arrival_local.replace("T", " ").slice(0, 16)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-secondary)" }}>Overall Route Baseline:</span>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {baseRate != null ? `${(baseRate * 100).toFixed(1)}%` : "N/A"}
                </span>
              </div>
            </div>

            {/* Weather Strip */}
            <div className="sky-metar-quote">
              <div><b>{flight.origin}:</b> {formatWx(p.weather.origin)}</div>
              <div style={{ marginTop: 3 }}><b>{flight.dest}:</b> {formatWx(p.weather.dest)}</div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function tempStr(wx?: Record<string, unknown> | null): string {
  if (!wx) return "--";
  const temp = wx.temp_f;
  const wind = wx.wind_kt;
  return `${temp ?? "--"}°F, ${wind ?? 0}kt`;
}

function formatWx(wx?: Record<string, unknown> | null): string {
  if (!wx) return "No data";
  const temp = wx.temp_f != null ? `${wx.temp_f}°F` : "--";
  const wind = wx.wind_kt != null ? `${wx.wind_kt}kt` : "0kt";
  const gust = wx.gust_kt ? ` G${wx.gust_kt}kt` : "";
  const vis = wx.visibility_mi != null ? ` ${wx.visibility_mi}SM` : "";
  const src = wx.source ? ` [${wx.source}]` : "";
  return `${temp}, wind ${wind}${gust}${vis}${src}`;
}

function WeatherIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}
