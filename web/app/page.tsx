"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import CockpitIntro, { introAlreadySeen } from "@/components/CockpitIntro";
import Dashboard from "@/components/Dashboard";
import PredictForm from "@/components/PredictForm";
import { getAirports, getCarriers, getDashboard, getRoutes } from "@/lib/api";
import type { Airport, CarrierRow, DashboardSummary, Route } from "@/lib/types";

// both touch window on import
const DelayMap = dynamic(() => import("@/components/DelayMap"), {
  ssr: false,
  loading: () => <div className="boot">Loading network&hellip;</div>,
});

export default function Page() {
  // client-only: no sessionStorage during SSR, and guessing wrong either
  // flashes the intro or eats it
  const [introDone, setIntroDone] = useState<boolean | null>(null);
  useEffect(() => setIntroDone(introAlreadySeen()), []);

  const [analysis, setAnalysis] = useState(false);
  const [airports, setAirports] = useState<Airport[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [carriers, setCarriers] = useState<CarrierRow[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
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

  const onKey = useCallback((e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLElement
      && ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName);
    if (typing) return;
    if (e.key === "a" || e.key === "A") setAnalysis((v) => !v);
    if (e.key === "Escape") { setAnalysis(false); setFocus(null); }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  if (error) {
    return (
      <div className="boot" style={{ flexDirection: "column", gap: 10, textAlign: "center" }}>
        <div className="err">API unreachable</div>
        <div style={{ maxWidth: 380 }}>
          {error}
          <br />Start it with <code className="mono">make api</code>.
        </div>
      </div>
    );
  }

  return (
    <>
      {introDone === false && <CockpitIntro onDone={() => setIntroDone(true)} />}

      <div className="stage">
        <div className="deck">
          {summary && (
            <DelayMap
              routes={routes}
              airports={summary.airports}
              selected={focus}
              onSelectAirport={setFocus}
            />
          )}
        </div>

        <header className="float card topbar">
          <div className="mark">
            <Logo />
            <h1>Flight Delay</h1>
          </div>
          {summary ? (
            <>
              <div className="stat">
                <b className="mono">{summary.model_metrics?.roc_auc.toFixed(3) ?? "--"}</b>
                <span>ROC-AUC</span>
              </div>
              <div className="stat">
                <b className="mono">{routes.length}</b>
                <span>routes</span>
              </div>
              <div className="stat">
                <b className="mono">{summary.meta.year}</b>
                <span>BTS</span>
              </div>
            </>
          ) : (
            <span style={{ color: "var(--fg-3)" }}>Loading&hellip;</span>
          )}
          <div className="spacer" />
          {focus && (
            <button className="icon-btn" onClick={() => setFocus(null)} title="Clear filter (Esc)">
              &times;
            </button>
          )}
          <span className="kbd">A</span>
          <span style={{ color: "var(--fg-3)", fontSize: 11 }}>analysis</span>
        </header>

        {summary && (
          <aside className="float card panel">
            <div className="panel-scroll">
              <PredictForm
                airports={airports}
                carriers={carriers}
                origin={origin}
                dest={dest}
                onOriginChange={(v) => { setOrigin(v); setFocus(v); }}
                onDestChange={setDest}
              />
            </div>
          </aside>
        )}

        {summary && analysis && (
          <section className="float card sheet">
            <div className="sheet-head">
              <div>
                <h2>Analysis</h2>
                <div className="eyebrow" style={{ marginTop: 2 }}>
                  {summary.meta.year} &middot; {focus ?? "all airports"}
                </div>
              </div>
              <button className="icon-btn" onClick={() => setAnalysis(false)} title="Close (Esc)">
                &times;
              </button>
            </div>
            <div className="sheet-body">
              <Dashboard summary={summary} routes={routes} selected={focus} />
            </div>
          </section>
        )}

        <nav className="float card dock">
          <button data-on={!analysis} onClick={() => setAnalysis(false)}>
            <MapIcon /> Map
          </button>
          <button data-on={analysis} onClick={() => setAnalysis(true)}>
            <ChartIcon /> Analysis
          </button>
        </nav>
      </div>
    </>
  );
}

function Logo() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 2 14.2 9.8 22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"
            fill="var(--amber)" opacity="0.9" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M4 19V5M4 19h16M8 15l4-5 3 3 5-7" />
    </svg>
  );
}
