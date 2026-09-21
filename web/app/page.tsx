"use client";

import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useState } from "react";
import Dashboard from "@/components/Dashboard";
import Navbar from "@/components/Navbar";
import FlightSearchWidget from "@/components/FlightSearchWidget";
import FlightResults from "@/components/FlightResults";
import { checkRoute, getAirports, getCarriers, getDashboard, getRoutes, predict } from "@/lib/api";
import type { Airport, CarrierRow, DashboardSummary, OperatingCarrier, Prediction, Route } from "@/lib/types";

// Map touches window on import
const DelayMap = dynamic(() => import("@/components/DelayMap"), {
  ssr: false,
  loading: () => (
    <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--text-secondary)" }}>
      Loading network delay map&hellip;
    </div>
  ),
});

function defaultTomorrowAtNine(): string {
  const t = new Date(Date.now() + 864e5);
  t.setHours(9, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:00`;
}

export default function Page() {
  const [activeView, setActiveView] = useState<"predict" | "map" | "insights">("predict");

  // Reference Data
  const [airports, setAirports] = useState<Airport[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [carriers, setCarriers] = useState<CarrierRow[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search Inputs
  const [origin, setOrigin] = useState("EWR");
  const [dest, setDest] = useState("ORD");
  const [departure, setDeparture] = useState(defaultTomorrowAtNine);
  const [focus, setFocus] = useState<string | null>(null);

  // Route & Predictions State
  const [checkingRoute, setCheckingRoute] = useState(false);
  const [routeExists, setRouteExists] = useState(true);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [operatingCarriers, setOperatingCarriers] = useState<OperatingCarrier[]>([]);
  const [predictions, setPredictions] = useState<Record<string, Prediction>>({});
  const [predictingMap, setPredictingMap] = useState<Record<string, boolean>>({});

  // Initial Reference Data Fetch
  useEffect(() => {
    Promise.all([getAirports(), getRoutes(400), getCarriers(), getDashboard()])
      .then(([a, r, c, s]) => {
        setAirports(a);
        setRoutes(r);
        setCarriers(c);
        setSummary(s);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Step 1: Check if flight exists between A and B
  // Step 2: For all operating airlines, compute predicted delays
  const evaluateRouteAndDelays = useCallback(async (orig = origin, dst = dest, dep = departure) => {
    if (orig === dst) return;
    setCheckingRoute(true);
    setError(null);

    try {
      const checkRes = await checkRoute(orig, dst);
      setRouteExists(checkRes.exists);
      setActiveRoute(checkRes.route);
      setOperatingCarriers(checkRes.operatingCarriers);

      // If route exists, compute delay prediction for each airline operating on this route
      if (checkRes.exists && checkRes.operatingCarriers.length > 0) {
        const loadingMap: Record<string, boolean> = {};
        checkRes.operatingCarriers.forEach((oc) => {
          loadingMap[oc.carrier] = true;
        });
        setPredictingMap(loadingMap);

        // Run predictions concurrently for each operating airline
        const promises = checkRes.operatingCarriers.map(async (oc) => {
          try {
            const pred = await predict({
              origin: orig,
              dest: dst,
              carrier: oc.carrier,
              departure_local: dep,
            });
            return { carrier: oc.carrier, pred };
          } catch (err) {
            console.warn(`Failed prediction for ${oc.carrier}:`, err);
            return { carrier: oc.carrier, pred: null };
          }
        });

        const results = await Promise.all(promises);
        const newPreds: Record<string, Prediction> = {};
        results.forEach((r) => {
          if (r.pred) newPreds[r.carrier] = r.pred;
        });
        setPredictions(newPreds);
        setPredictingMap({});
      } else {
        setPredictions({});
        setPredictingMap({});
      }
    } catch (err) {
      console.warn("Route check error:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingRoute(false);
    }
  }, [origin, dest, departure]);

  // Run on initial load once airports are available
  useEffect(() => {
    if (airports.length > 0 && !activeRoute && !checkingRoute) {
      evaluateRouteAndDelays("EWR", "ORD");
    }
  }, [airports, activeRoute, checkingRoute, evaluateRouteAndDelays]);

  const handleOriginChange = (val: string) => {
    setOrigin(val);
    setFocus(val);
  };

  return (
    <div className="sky-app">
      {/* Platform Navigation */}
      <Navbar activeView={activeView} onViewChange={setActiveView} />

      <main className="sky-main">
        {/* Clean Hero & Input Section */}
        <section className="sky-hero">
          <div className="sky-container">
            <h1 className="sky-hero-headline">
              Flight Delay Prediction &amp; Route Availability
            </h1>
            <p className="sky-hero-sub">
              Enter two airports to verify direct flight routes, discover all operating airlines, and
              forecast arrival delay risks using machine learning trained on BTS performance data.
            </p>

            {/* Airport A & B Search Widget */}
            <FlightSearchWidget
              airports={airports}
              origin={origin}
              dest={dest}
              departure={departure}
              onOriginChange={handleOriginChange}
              onDestChange={setDest}
              onDepartureChange={setDeparture}
              onSearch={() => evaluateRouteAndDelays(origin, dest, departure)}
              loading={checkingRoute}
            />

            {/* Explanatory Badges */}
            <div className="sky-hero-badges">
              <span className="sky-hero-badge-item">
                <CheckIcon />
                <span>Route Connectivity Verification</span>
              </span>
              <span className="sky-hero-badge-item">
                <CheckIcon />
                <span>Multi-Airline Delay Comparison</span>
              </span>
              <span className="sky-hero-badge-item">
                <CheckIcon />
                <span>Pre-Departure Schedule &amp; METAR Weather</span>
              </span>
            </div>
          </div>
        </section>

        {/* Content Section */}
        <div className="sky-container" style={{ marginTop: 24 }}>
          {error && (
            <div
              style={{
                background: "#fbebe8",
                color: "#d9381e",
                padding: "14px 18px",
                borderRadius: "10px",
                border: "1px solid #f7c3bb",
                marginBottom: 20,
              }}
            >
              <b>Notice:</b> {error}
            </div>
          )}

          {/* View Mode Bar */}
          <div className="sky-view-bar">
            <div>
              <h2 style={{ fontSize: 18, color: "var(--sky-navy)" }}>
                {activeView === "predict" && `Flight Predictions: ${origin} ➔ ${dest}`}
                {activeView === "map" && "US Domestic Network Delay Bottlenecks"}
                {activeView === "insights" && "Airport & Carrier On-Time Performance"}
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
                {activeView === "predict" && "Checking direct flight routes and comparing arrival delay probabilities across airlines."}
                {activeView === "map" && "Interactive Deck.gl corridor transit and airport hub congestion."}
                {activeView === "insights" && `Historical BTS seasonal trends and carrier reliability (${summary?.meta.year ?? 2025}).`}
              </p>
            </div>

            {/* View Switch Tabs */}
            <div className="sky-view-tabs">
              <button
                type="button"
                className={`sky-view-tab ${activeView === "predict" ? "active" : ""}`}
                onClick={() => setActiveView("predict")}
              >
                <FlightIcon />
                <span>Predict Delay</span>
              </button>

              <button
                type="button"
                className={`sky-view-tab ${activeView === "map" ? "active" : ""}`}
                onClick={() => setActiveView("map")}
              >
                <MapPinIcon />
                <span>Network Map</span>
              </button>

              <button
                type="button"
                className={`sky-view-tab ${activeView === "insights" ? "active" : ""}`}
                onClick={() => setActiveView("insights")}
              >
                <BarChartIcon />
                <span>Airport Statistics</span>
              </button>
            </div>
          </div>

          {/* View 1: Delay Predictions Across Airlines */}
          {activeView === "predict" && (
            <FlightResults
              origin={origin}
              dest={dest}
              departure={departure}
              routeExists={routeExists}
              route={activeRoute}
              operatingCarriers={operatingCarriers}
              predictions={predictions}
              loading={checkingRoute}
              predictingMap={predictingMap}
            />
          )}

          {/* View 2: Interactive Bottleneck Map */}
          {activeView === "map" && summary && (
            <div className="sky-map-wrapper">
              <div className="sky-map-header">
                <div>
                  <h3>Interactive Hub Bottleneck Visualizer</h3>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                    Deck.gl arc layers colored by arrival delay risk &bull; {routes.length} domestic routes
                  </div>
                </div>
                <div className="sky-map-legend">
                  <span>Reliable (8.7%)</span>
                  <div className="sky-map-ramp" />
                  <span>High Delay (21.4%+)</span>
                </div>
              </div>
              <div style={{ height: "calc(100% - 60px)", position: "relative" }}>
                <DelayMap
                  routes={routes}
                  airports={summary.airports}
                  selected={focus}
                  onSelectAirport={setFocus}
                />
              </div>
            </div>
          )}

          {/* View 3: Dashboard Analytics */}
          {activeView === "insights" && summary && (
            <Dashboard summary={summary} routes={routes} selected={focus} />
          )}
        </div>
      </main>

      {/* Clean Platform Footer */}
      <footer className="sky-footer">
        <div className="sky-container">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--sky-navy)", fontSize: 14 }}>
                Flight Delay Prediction Platform
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 4 }}>
                LightGBM pre-departure delay modeling trained on 2.5 million Bureau of Transportation Statistics flights.
              </div>
            </div>

            <div style={{ display: "flex", gap: 24, fontSize: 12.5, color: "var(--text-secondary)" }}>
              <span>Strict Pre-Departure Features</span>
              <span>Calibrated 30+ Min Delay Probabilities</span>
              <span>METAR Weather Integration</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00a698" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function FlightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function BarChartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
