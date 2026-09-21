"use client";

import React, { useMemo, useState } from "react";
import FlightCard, { type PlaneFlightItem } from "./FlightCard";
import type { OperatingCarrier, Prediction, Route } from "@/lib/types";

interface FlightResultsProps {
  origin: string;
  dest: string;
  departure: string;
  routeExists: boolean;
  route: Route | null;
  operatingCarriers: OperatingCarrier[];
  predictions: Record<string, Prediction>;
  loading: boolean;
  predictingMap: Record<string, boolean>;
}

export default function FlightResults({
  origin,
  dest,
  departure,
  routeExists,
  route,
  operatingCarriers,
  predictions,
  loading,
  predictingMap,
}: FlightResultsProps) {
  const [sortKey, setSortKey] = useState<"risk" | "historical" | "frequency">("risk");
  const [riskFilter, setRiskFilter] = useState<"all" | "low" | "moderate">("all");

  const carrierNames: Record<string, string> = {
    UA: "United Airlines",
    AA: "American Airlines",
    DL: "Delta Air Lines",
    WN: "Southwest Airlines",
    B6: "JetBlue Airways",
    AS: "Alaska Airlines",
    NK: "Spirit Airlines",
    F9: "Frontier Airlines",
    G4: "Allegiant Air",
    HA: "Hawaiian Airlines",
    OO: "SkyWest Airlines",
    MQ: "Envoy Air",
    YX: "Republic Airways",
    OH: "PSA Airlines",
  };

  // Build items for each airline operating on this route
  const planeItems = useMemo<PlaneFlightItem[]>(() => {
    if (!route || !operatingCarriers.length) return [];

    const depDate = new Date(departure);
    const baseHour = isNaN(depDate.getTime()) ? 9 : depDate.getHours();
    const distanceKm = route.distance_km || 1200;
    const flightMins = Math.round(distanceKm / 12) + 35;
    const durHours = Math.floor(flightMins / 60);
    const durMins = flightMins % 60;
    const durationStr = `${durHours}h ${durMins}m`;

    return operatingCarriers.map((oc, index) => {
      // Stagger flight times slightly by airline for a realistic schedule comparison
      const slotHour = (baseHour + index * 2) % 24;
      const depH = String(slotHour).padStart(2, "0");
      const depM = index % 2 === 0 ? "00" : "30";
      const depTimeStr = `${depH}:${depM}`;

      const totalArrMinutes = slotHour * 60 + parseInt(depM) + flightMins;
      const arrH = String(Math.floor((totalArrMinutes / 60) % 24)).padStart(2, "0");
      const arrM = String(totalArrMinutes % 60).padStart(2, "0");
      const arrTimeStr = `${arrH}:${arrM}`;

      const pred = predictions[oc.carrier] ?? null;

      return {
        id: `plane-${oc.carrier}-${origin}-${dest}`,
        carrier: oc.carrier,
        carrierName: carrierNames[oc.carrier] || `${oc.carrier} Airlines`,
        flightsOnRoute: oc.flights,
        historicalDelayRate: oc.carrier_route_delay_rate,
        depTime: depTimeStr,
        arrTime: arrTimeStr,
        duration: durationStr,
        origin,
        dest,
        prediction: pred,
        loading: predictingMap[oc.carrier] ?? false,
      };
    });
  }, [route, operatingCarriers, departure, origin, dest, predictions, predictingMap]);

  // Filter
  const filteredPlanes = useMemo(() => {
    return planeItems.filter((p) => {
      if (riskFilter === "low" && p.prediction && p.prediction.risk_band !== "low") {
        return false;
      }
      if (riskFilter === "moderate" && p.prediction && !["low", "moderate"].includes(p.prediction.risk_band)) {
        return false;
      }
      return true;
    });
  }, [planeItems, riskFilter]);

  // Sort
  const sortedPlanes = useMemo(() => {
    const list = [...filteredPlanes];
    if (sortKey === "risk") {
      list.sort((a, b) => {
        const probA = a.prediction?.probability ?? a.historicalDelayRate;
        const probB = b.prediction?.probability ?? b.historicalDelayRate;
        return probA - probB;
      });
    } else if (sortKey === "historical") {
      list.sort((a, b) => a.historicalDelayRate - b.historicalDelayRate);
    } else {
      list.sort((a, b) => b.flightsOnRoute - a.flightsOnRoute);
    }
    return list;
  }, [filteredPlanes, sortKey]);

  // 1. Loading State
  if (loading) {
    return (
      <div className="sky-flight-card" style={{ padding: 40, textAlign: "center", background: "#ffffff" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--sky-blue)", marginBottom: 8 }}>
          Checking flights between {origin} and {dest}...
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          Verifying commercial route connectivity and retrieving operating carriers.
        </div>
      </div>
    );
  }

  // 2. Route Check Failed: No direct flights between A and B
  if (!routeExists || !route) {
    return (
      <div
        className="sky-flight-card"
        style={{
          padding: 36,
          textAlign: "center",
          background: "#ffffff",
          borderLeft: "4px solid #d9381e",
        }}
      >
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#fbebe8", color: "#d9381e", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <h3 style={{ fontSize: 18, color: "var(--text-primary)", marginBottom: 8 }}>
          No Direct Flights Between {origin} and {dest}
        </h3>
        <p style={{ color: "var(--text-secondary)", maxWidth: 540, margin: "0 auto 16px", fontSize: 13.5, lineHeight: 1.6 }}>
          In our BTS reporting dataset across the 30 busiest US hub airports, there are no scheduled direct flights
          operating between <b>{origin}</b> and <b>{dest}</b>.
        </p>
        <div style={{ background: "var(--bg-page)", borderRadius: 8, padding: "12px 18px", maxWidth: 480, margin: "0 auto", fontSize: 12.5, color: "var(--text-secondary)" }}>
          💡 <b>Tip:</b> Try major connected hub corridors like <b>EWR ➔ ORD</b>, <b>LAX ➔ JFK</b>, <b>ATL ➔ DFW</b>, or <b>SFO ➔ SEA</b>.
        </div>
      </div>
    );
  }

  // 3. Route Exists: Show planes between A and B across various airlines
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Route Verification Banner */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          padding: "16px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", width: 8, height: 8, borderRadius: "50%", background: "var(--risk-low)" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--sky-navy)" }}>
              Route Confirmed: {route.origin_city} ({route.origin}) ➔ {route.dest_city} ({route.dest})
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 }}>
            Distance: <b>{Math.round(route.distance_km).toLocaleString()} km</b> &bull; Total BTS flights: <b>{route.flights.toLocaleString()}</b> &bull; Route baseline delay rate: <b>{(route.delay_rate * 100).toFixed(1)}%</b>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
            Airlines operating on this route:
          </span>
          <span style={{ background: "var(--sky-blue-subtle)", color: "var(--sky-blue)", padding: "4px 10px", borderRadius: 9999, fontWeight: 700, fontSize: 12 }}>
            {operatingCarriers.length} Carriers
          </span>
        </div>
      </div>

      {/* Sort & Filter Controls */}
      <div className="sky-sort-bar">
        <button
          type="button"
          className={`sky-sort-btn ${sortKey === "risk" ? "active" : ""}`}
          onClick={() => setSortKey("risk")}
        >
          <span className="sky-sort-label">Lowest Delay Risk</span>
          <span className="sky-sort-sub">Ranked by ML probability</span>
        </button>

        <button
          type="button"
          className={`sky-sort-btn ${sortKey === "historical" ? "active" : ""}`}
          onClick={() => setSortKey("historical")}
        >
          <span className="sky-sort-label">Most Reliable</span>
          <span className="sky-sort-sub">Historical BTS rate</span>
        </button>

        <button
          type="button"
          className={`sky-sort-btn ${sortKey === "frequency" ? "active" : ""}`}
          onClick={() => setSortKey("frequency")}
        >
          <span className="sky-sort-label">Most Frequent</span>
          <span className="sky-sort-sub">By total flight volume</span>
        </button>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", paddingRight: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Filter Risk:</span>
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value as "all" | "low" | "moderate")}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid var(--border-subtle)",
              background: "#ffffff",
              cursor: "pointer",
            }}
          >
            <option value="all">All Risk Tiers</option>
            <option value="low">Low Risk Only (&lt;15%)</option>
            <option value="moderate">Under 30% Risk</option>
          </select>
        </div>
      </div>

      {/* List of Planes Across Various Airlines */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {sortedPlanes.map((plane) => (
          <FlightCard key={plane.id} flight={plane} />
        ))}
      </div>
    </div>
  );
}
