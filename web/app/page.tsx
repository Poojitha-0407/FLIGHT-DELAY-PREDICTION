"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import CockpitIntro, { introAlreadySeen } from "@/components/CockpitIntro";
import Dashboard from "@/components/Dashboard";
import PredictForm from "@/components/PredictForm";
import { getAirports, getCarriers, getDashboard, getRoutes } from "@/lib/api";
import type { Airport, CarrierRow, DashboardSummary, Route } from "@/lib/types";

// both touch window on import
const DelayMap = dynamic(() => import("@/components/DelayMap"), {
  ssr: false,
  loading: () => <div className="notice">Initialising nav display&hellip;</div>,
});

type Tab = "map" | "dashboard";

export default function Page() {
  // client-only: no sessionStorage during SSR, and guessing wrong either
  // flashes the intro or eats it
  const [introDone, setIntroDone] = useState<boolean | null>(null);
  useEffect(() => setIntroDone(introAlreadySeen()), []);

  const [tab, setTab] = useState<Tab>("map");
  const [airports, setAirports] = useState<Airport[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [carriers, setCarriers] = useState<CarrierRow[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [origin, setOrigin] = useState("EWR");
  const [dest, setDest] = useState("ORD");
  const [error, setError] = useState<string | null>(null);

  // fires during the intro, so the handoff lands on a full screen
  useEffect(() => {
    Promise.all([getAirports(), getRoutes(400), getCarriers(), getDashboard()])
      .then(([a, r, c, s]) => {
        setAirports(a); setRoutes(r); setCarriers(c); setSummary(s);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const totalFlights = summary?.airports.reduce((s, a) => s + (a.departures ?? 0), 0) ?? 0;

  return (
    <>
      {introDone === false && <CockpitIntro onDone={() => setIntroDone(true)} />}

      {error ? (
        <div className="notice">
          <h1 style={{ color: "var(--red)", fontFamily: "var(--mono)", letterSpacing: "0.16em" }}>
            API UNAVAILABLE
          </h1>
          <p className="err">{error}</p>
          <p>
            Start it with <code>make api</code>, and make sure <code>make export</code> has
            written <code>web/api/_artifacts/</code>.
          </p>
        </div>
      ) : !summary ? (
        <div className="notice">Loading one year of flights&hellip;</div>
      ) : (
        <div className="shell">
          <aside className="rail">
            <div className="brand">
              <h1>FLIGHT DELAY</h1>
              <p>
                {summary.meta.year} BTS on-time performance &middot; 30 busiest US airports.
                Target: arrival more than 30 minutes late.
              </p>
            </div>

            <PredictForm
              airports={airports}
              carriers={carriers}
              origin={origin}
              dest={dest}
              onOriginChange={(v) => { setOrigin(v); setSelected(v); }}
              onDestChange={setDest}
            />

            <div className="bay" style={{ borderBottom: "none", marginTop: "auto" }}>
              <div className="bay-head">
                <h2 className="label">Network</h2>
              </div>
              <div className="row"><span>Airports</span><span>{airports.length}</span></div>
              <div className="row">
                <span>Routes drawn</span><span>{routes.length.toLocaleString()}</span>
              </div>
              <div className="row">
                <span>Flights analysed</span><span>{totalFlights.toLocaleString()}</span>
              </div>
            </div>
          </aside>

          <main className="stage">
            <div className="statusbar">
              <span><i className="dot" />LIVE</span>
              <span className="sep">|</span>
              <span>MODEL ROC-AUC {summary.model_metrics?.roc_auc.toFixed(3) ?? "--"}</span>
              <span className="sep">|</span>
              <span>TEST {summary.model_metrics?.rows.toLocaleString() ?? "--"} FLIGHTS</span>
              <span className="sep">|</span>
              <span className="live">{selected ? `FILTER ${selected}` : "ALL ROUTES"}</span>
            </div>

            <nav className="tabs">
              {(["map", "dashboard"] as Tab[]).map((t) => (
                <button key={t} className="tab" data-on={tab === t} onClick={() => setTab(t)}>
                  {t === "map" ? "Nav display" : "Analysis"}
                </button>
              ))}
            </nav>

            {tab === "map" ? (
              <DelayMap
                routes={routes}
                airports={summary.airports}
                selected={selected}
                onSelectAirport={setSelected}
              />
            ) : (
              <Dashboard summary={summary} routes={routes} selected={selected} />
            )}
          </main>
        </div>
      )}
    </>
  );
}
