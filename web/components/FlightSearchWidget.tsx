"use client";

import React from "react";
import type { Airport } from "@/lib/types";

interface SearchWidgetProps {
  airports: Airport[];
  origin: string;
  dest: string;
  departure: string;
  onOriginChange: (v: string) => void;
  onDestChange: (v: string) => void;
  onDepartureChange: (v: string) => void;
  onSearch: () => void;
  loading: boolean;
}

export default function FlightSearchWidget({
  airports,
  origin,
  dest,
  departure,
  onOriginChange,
  onDestChange,
  onDepartureChange,
  onSearch,
  loading,
}: SearchWidgetProps) {
  const handleSwap = () => {
    const temp = origin;
    onOriginChange(dest);
    onDestChange(temp);
  };

  const sameAirport = origin === dest;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sameAirport && !loading) {
      onSearch();
    }
  };

  return (
    <div className="sky-search-box">
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--sky-navy)" }}>
          Flight Delay Evaluation &bull; Origin to Destination
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Covers the 30 busiest US hub airports
        </span>
      </div>

      {/* Segmented Search Inputs */}
      <form onSubmit={handleSubmit}>
        <div className="sky-inputs-grid" style={{ gridTemplateColumns: "2.5fr auto 2.5fr 2fr auto" }}>
          {/* Airport A: Origin */}
          <div className="sky-input-segment">
            <label className="sky-segment-label" htmlFor="sky-origin-select">
              Airport A (Origin)
            </label>
            <div className="sky-segment-value">
              <select
                id="sky-origin-select"
                className="sky-select-clean"
                value={origin}
                onChange={(e) => onOriginChange(e.target.value)}
              >
                {airports.map((a) => (
                  <option key={`orig-${a.iata}`} value={a.iata}>
                    {a.city} ({a.iata})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Swap Button */}
          <button
            type="button"
            className="sky-swap-btn"
            onClick={handleSwap}
            title="Swap Origin and Destination"
            aria-label="Swap airports"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 5h18" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 19H3" />
            </svg>
          </button>

          {/* Airport B: Destination */}
          <div className="sky-input-segment">
            <label className="sky-segment-label" htmlFor="sky-dest-select">
              Airport B (Destination)
            </label>
            <div className="sky-segment-value">
              <select
                id="sky-dest-select"
                className="sky-select-clean"
                value={dest}
                onChange={(e) => onDestChange(e.target.value)}
              >
                {airports.map((a) => (
                  <option key={`dest-${a.iata}`} value={a.iata}>
                    {a.city} ({a.iata})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Departure Date & Time */}
          <div className="sky-input-segment">
            <label className="sky-segment-label" htmlFor="sky-dep-date">
              Scheduled Departure
            </label>
            <div className="sky-segment-value">
              <input
                id="sky-dep-date"
                type="datetime-local"
                className="sky-input-clean mono"
                value={departure}
                onChange={(e) => onDepartureChange(e.target.value)}
              />
            </div>
          </div>

          {/* Submit Action */}
          <button
            type="submit"
            className="sky-search-submit"
            disabled={loading || sameAirport}
          >
            {loading ? (
              <>Evaluating...</>
            ) : sameAirport ? (
              <>Pick 2 airports</>
            ) : (
              <>
                <span>Check Route &amp; Delays</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
