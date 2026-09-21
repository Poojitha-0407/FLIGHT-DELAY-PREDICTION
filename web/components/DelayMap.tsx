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

// Shallow pitch and low arcs on purpose. 48deg looked great in a screenshot
// and was unreadable in motion -- arcs just left the top of the frame.
const INITIAL_VIEW = {
  longitude: -96,
  latitude: 38.2,
  zoom: 3.15,
  pitch: 22,
  bearing: 0,
  // The panel floats over the deck, so centre the network in what's actually
  // visible rather than in the viewport. Same trick FR24 and Maps use.
  padding: { left: 360, top: 60, right: 20, bottom: 70 },
};
const ARC_HEIGHT = 0.32;

const MAX_AIRCRAFT = 190;    // all 800 at once is a smear, not a picture
const TRANSIT_SECONDS = 26;  // ambience, not a simulation

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

  // one per busy route, phase-offset so they don't all leave at once
  const flights = useMemo<Flight[]>(() => {
    return [...shown]
      .sort((a, b) => b.flights - a.flights)
      .slice(0, MAX_AIRCRAFT)
      .map((r, i) => ({
        key: `${r.origin}-${r.dest}`,
        leg: leg([r.origin_lon, r.origin_lat], [r.dest_lon, r.dest_lat]),
        phase: (i * 0.618) % 1, // golden ratio, spreads evenly
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
      getSourceColor: (d) => [...delayColor(d.delay_rate), 36] as [number, number, number, number],
      getTargetColor: (d) => [...delayColor(d.delay_rate), 150] as [number, number, number, number],
      getHeight: ARC_HEIGHT,
      getWidth: (d) => 0.5 + Math.sqrt(d.flights) / 70,
      widthMinPixels: 0.5,
      widthMaxPixels: 5,
      onHover: setHover,
      updateTriggers: { getSourceColor: selected, getTargetColor: selected },
    }),

    // glow behind each one, so motion reads at low zoom
    new ScatterplotLayer({
      id: "wake",
      data: positions,
      radiusUnits: "pixels",
      getPosition: (d: (typeof positions)[number]) => d.position,
      getRadius: 7,
      getFillColor: (d: (typeof positions)[number]) =>
        [...d.color, 34] as [number, number, number, number],
      updateTriggers: { getPosition: clock, getFillColor: clock },
    }),
    new ScatterplotLayer({
      id: "aircraft",
      data: positions,
      pickable: true,
      radiusUnits: "pixels",
      getPosition: (d: (typeof positions)[number]) => d.position,
      getRadius: 2.2,
      getFillColor: (d: (typeof positions)[number]) =>
        [...d.color, 235] as [number, number, number, number],
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
      getRadius: (d) => 3 + Math.sqrt(d.departures) / 110,
      radiusMinPixels: 4,
      getFillColor: (d) =>
        d.iata === selected
          ? [77, 208, 255, 255]
          : ([...delayColor(d.dep_delay_rate), 225] as [number, number, number, number]),
      getLineColor: (d) =>
        d.iata === selected ? [255, 255, 255, 220] : [5, 8, 13, 210],
      lineWidthMinPixels: 1.4,
      onHover: setHover,
      onClick: (info) => {
        const a = info.object as AirportSummary | undefined;
        onSelectAirport(a && a.iata !== selected ? a.iata : null);
      },
      updateTriggers: { getFillColor: selected, getLineColor: selected },
    }),
  ];

  return (
    <div className="deck" data-basemap={MAPBOX_TOKEN ? "on" : "off"}>
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

      {hover?.object && (
        <div className="tip" style={{ left: hover.x + 16, top: hover.y + 16 }}>
          <Tip object={hover.object} />
        </div>
      )}

      <div className="float card legend">
        <div className="eyebrow">Arrival delay &gt; 30 min</div>
        <div className="ramp" />
        <div className="ramp-ends">
          <span>8.7%</span>
          <span>14.8%</span>
          <span>21.4%+</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--fg-3)", lineHeight: 1.5 }}>
          {selected ? `Showing ${selected}. Esc to clear.` : "Click an airport to filter."}
          {!MAPBOX_TOKEN && " No basemap \u2014 add a Mapbox token for terrain."}
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
        <b>{String(o.label)}</b>
        <div style={{ color: "var(--fg-3)" }}>{(Number(o.t) * 100).toFixed(0)}% enroute</div>
      </>
    );
  }

  if ("origin" in o) {
    const r = object as Route;
    return (
      <>
        <b>{r.origin} &rarr; {r.dest}</b>
        <div className="kv"><span>Flights</span><span>{r.flights.toLocaleString()}</span></div>
        <div className="kv"><span>Delayed</span><span>{(r.delay_rate * 100).toFixed(1)}%</span></div>
        <div className="kv"><span>Mean</span><span>{r.avg_delay_min.toFixed(1)} min</span></div>
        <div className="kv"><span>P90</span><span>{r.p90_delay_min.toFixed(0)} min</span></div>
        <div className="kv"><span>Cancelled</span><span>{(r.cancel_rate * 100).toFixed(2)}%</span></div>
      </>
    );
  }

  const a = object as AirportSummary;
  return (
    <>
      <b>{a.iata}</b>
      <div style={{ color: "var(--fg-3)", marginBottom: 5 }}>{a.city}</div>
      <div className="kv"><span>Departures</span><span>{a.departures.toLocaleString()}</span></div>
      <div className="kv"><span>Delayed</span><span>{(a.dep_delay_rate * 100).toFixed(1)}%</span></div>
      <div className="kv"><span>Peak/hr</span><span>{a.peak_hourly_departures}</span></div>
    </>
  );
}
