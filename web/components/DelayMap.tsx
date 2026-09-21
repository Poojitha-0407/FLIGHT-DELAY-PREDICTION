"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import Map from "react-map-gl/mapbox";
import { delayColor } from "@/lib/api";
import { along, leg, type Leg } from "@/lib/geo";
import type { AirportSummary, Route } from "@/lib/types";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const INITIAL_VIEW = {
  longitude: -96,
  latitude: 38.5,
  zoom: 3.5,
  pitch: 20,
  bearing: 0,
  padding: { left: 40, top: 40, right: 40, bottom: 40 },
};
const ARC_HEIGHT = 0.32;

const MAX_AIRCRAFT = 190;
const TRANSIT_SECONDS = 26;

interface Props {
  routes: Route[];
  airports: AirportSummary[];
  selected: string | null;
  onSelectAirport: (iata: string | null) => void;
}

interface Flight {
  key: string;
  leg: Leg;
  phase: number;
  color: [number, number, number];
  label: string;
}

export default function DelayMap({ routes, airports, selected, onSelectAirport }: Props) {
  const [hover, setHover] = useState<PickingInfo | null>(null);
  const [clock, setClock] = useState(0);
  const raf = useRef(0);

  const shown = useMemo(
    () => (selected ? routes.filter((r) => r.origin === selected || r.dest === selected) : routes),
    [routes, selected],
  );

  const flights = useMemo<Flight[]>(() => {
    return [...shown]
      .sort((a, b) => b.flights - a.flights)
      .slice(0, MAX_AIRCRAFT)
      .map((r, i) => ({
        key: `${r.origin}-${r.dest}`,
        leg: leg([r.origin_lon, r.origin_lat], [r.dest_lon, r.dest_lat]),
        phase: (i * 0.618) % 1,
        color: delayColor(r.delay_rate),
        label: `${r.origin}-${r.dest}`,
      }));
  }, [shown]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const tick = (now: number) => {
      setClock((now - start) / 1000);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const positions = useMemo(
    () =>
      flights.map((f) => {
        const t = (clock / TRANSIT_SECONDS + f.phase) % 1;
        return { ...f, position: along(f.leg, t), t };
      }),
    [flights, clock],
  );

  const layers = [
    new ArcLayer<Route>({
      id: "routes",
      data: shown,
      pickable: true,
      greatCircle: true,
      getSourcePosition: (d) => [d.origin_lon, d.origin_lat],
      getTargetPosition: (d) => [d.dest_lon, d.dest_lat],
      getSourceColor: (d) => [...delayColor(d.delay_rate), 45] as [number, number, number, number],
      getTargetColor: (d) => [...delayColor(d.delay_rate), 180] as [number, number, number, number],
      getHeight: ARC_HEIGHT,
      getWidth: (d) => 0.6 + Math.sqrt(d.flights) / 60,
      widthMinPixels: 0.8,
      widthMaxPixels: 6,
      onHover: setHover,
      updateTriggers: { getSourceColor: selected, getTargetColor: selected },
    }),

    new ScatterplotLayer({
      id: "wake",
      data: positions,
      radiusUnits: "pixels",
      getPosition: (d: (typeof positions)[number]) => d.position,
      getRadius: 7,
      getFillColor: (d: (typeof positions)[number]) =>
        [...d.color, 40] as [number, number, number, number],
      updateTriggers: { getPosition: clock, getFillColor: clock },
    }),
    new ScatterplotLayer({
      id: "aircraft",
      data: positions,
      pickable: true,
      radiusUnits: "pixels",
      getPosition: (d: (typeof positions)[number]) => d.position,
      getRadius: 2.5,
      getFillColor: (d: (typeof positions)[number]) =>
        [...d.color, 245] as [number, number, number, number],
      onHover: setHover,
      updateTriggers: { getPosition: clock, getFillColor: clock },
    }),

    new ScatterplotLayer<AirportSummary>({
      id: "airports",
      data: airports,
      pickable: true,
      radiusUnits: "pixels",
      stroked: true,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 3.5 + Math.sqrt(d.departures) / 100,
      radiusMinPixels: 5,
      getFillColor: (d) =>
        d.iata === selected
          ? [7, 112, 227, 255]
          : ([...delayColor(d.dep_delay_rate), 235] as [number, number, number, number]),
      getLineColor: (d) =>
        d.iata === selected ? [255, 255, 255, 240] : [10, 25, 45, 220],
      lineWidthMinPixels: 1.5,
      onHover: setHover,
      onClick: (info) => {
        const a = info.object as AirportSummary | undefined;
        onSelectAirport(a && a.iata !== selected ? a.iata : null);
      },
      updateTriggers: { getFillColor: selected, getLineColor: selected },
    }),
  ];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#051329" }}>
      <DeckGL
        initialViewState={INITIAL_VIEW}
        controller
        layers={layers}
        onClick={(info) => {
          if (!info.object) onSelectAirport(null);
        }}
        getCursor={({ isDragging }) => (isDragging ? "grabbing" : "crosshair")}
      >
        {MAPBOX_TOKEN && (
          <Map
            mapboxAccessToken={MAPBOX_TOKEN}
            mapStyle="mapbox://styles/mapbox/dark-v11"
            reuseMaps
          />
        )}
      </DeckGL>

      {/* Skyscanner Styled Tooltip */}
      {hover?.object && (
        <div
          style={{
            position: "absolute",
            zIndex: 30,
            pointerEvents: "none",
            left: hover.x + 16,
            top: hover.y + 16,
            background: "#ffffff",
            color: "#111236",
            padding: "10px 14px",
            borderRadius: "10px",
            boxShadow: "0 6px 20px rgba(5, 32, 60, 0.2)",
            border: "1px solid #e0e4eb",
            fontSize: "12px",
            minWidth: "160px",
          }}
        >
          <Tip object={hover.object} />
        </div>
      )}

      {/* Skyscanner Legend Card */}
      <div
        style={{
          position: "absolute",
          right: 20,
          bottom: 20,
          zIndex: 20,
          background: "#ffffff",
          color: "#111236",
          padding: "14px 18px",
          borderRadius: "12px",
          boxShadow: "0 6px 20px rgba(5, 32, 60, 0.15)",
          border: "1px solid #e0e4eb",
          width: "220px",
        }}
      >
        <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#68697f" }}>
          Arrival Delay &gt; 30 Min
        </div>
        <div style={{ height: 6, borderRadius: 3, margin: "8px 0 6px", background: "linear-gradient(90deg, #00a698, #ffb224, #ff8a3d, #f4523b)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#68697f", fontFamily: "var(--font-mono-stack)" }}>
          <span>8.7% (Low)</span>
          <span>14.8%</span>
          <span>21.4%+ (High)</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#68697f", lineHeight: 1.4 }}>
          {selected ? (
            <span>Filtering hub: <b>{selected}</b>. Click outside to reset.</span>
          ) : (
            <span>Click any airport hub to filter corridors.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Tip({ object }: { object: unknown }) {
  const o = object as Record<string, unknown>;

  if ("label" in o && "t" in o) {
    return (
      <>
        <b style={{ fontSize: 13, color: "var(--sky-blue)" }}>{String(o.label)}</b>
        <div style={{ color: "#68697f", marginTop: 2 }}>{(Number(o.t) * 100).toFixed(0)}% enroute</div>
      </>
    );
  }

  if ("origin" in o) {
    const r = object as Route;
    return (
      <>
        <b style={{ fontSize: 13, color: "var(--sky-navy)" }}>{r.origin} &rarr; {r.dest}</b>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <span style={{ color: "#68697f" }}>Flights:</span>
          <span className="mono" style={{ fontWeight: 600 }}>{r.flights.toLocaleString()}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#68697f" }}>Delay Rate:</span>
          <span className="mono" style={{ fontWeight: 600, color: delayColorText(r.delay_rate) }}>
            {(r.delay_rate * 100).toFixed(1)}%
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#68697f" }}>Avg Delay:</span>
          <span className="mono" style={{ fontWeight: 600 }}>{r.avg_delay_min.toFixed(1)} min</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "#68697f" }}>Cancellations:</span>
          <span className="mono" style={{ fontWeight: 600 }}>{(r.cancel_rate * 100).toFixed(2)}%</span>
        </div>
      </>
    );
  }

  const a = object as AirportSummary;
  return (
    <>
      <b style={{ fontSize: 14, color: "var(--sky-blue)" }}>{a.iata}</b>
      <div style={{ color: "#68697f", marginBottom: 6 }}>{a.city}</div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "#68697f" }}>Departures:</span>
        <span className="mono" style={{ fontWeight: 600 }}>{a.departures.toLocaleString()}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "#68697f" }}>Dep Delay Rate:</span>
        <span className="mono" style={{ fontWeight: 600, color: delayColorText(a.dep_delay_rate) }}>
          {(a.dep_delay_rate * 100).toFixed(1)}%
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "#68697f" }}>Peak Hourly Dep:</span>
        <span className="mono" style={{ fontWeight: 600 }}>{a.peak_hourly_departures}</span>
      </div>
    </>
  );
}

function delayColorText(rate: number): string {
  if (rate < 0.12) return "#00a698";
  if (rate < 0.2) return "#e67e22";
  return "#d9381e";
}
