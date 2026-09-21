"use client";

import { useEffect, useRef, useState } from "react";
import type { Prediction } from "@/lib/types";

/* Risk as an attitude indicator. Not just a skin: the horizon rides on the
 * route's own historical rate, so the gap between it and the aircraft symbol
 * is what the model is actually contributing. */

const SIZE = 210;
const R = 86;

function bandColor(band: Prediction["risk_band"]): string {
  return {
    low: "var(--risk-low)",
    moderate: "var(--risk-mod)",
    elevated: "var(--risk-high)",
    high: "var(--risk-severe)",
  }[band];
}

/** Probability -> pitch. Level at the base rate, full deflection around 50%. */
function toPitch(p: number): number {
  return Math.max(-42, Math.min(42, (p - 0.16) * 200));
}

export default function RiskGauge({ result }: { result: Prediction | null }) {
  const [shown, setShown] = useState(0);
  const raf = useRef(0);

  // instruments don't teleport
  useEffect(() => {
    const target = result?.probability ?? 0;
    const from = shown;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / 620, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (target - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.probability]);

  // parked reads as level, not pinned to the bottom of the range
  const pitch = result ? toPitch(shown) : 0;
  const baseline = result?.baseline_route_rate ?? null;
  const basePitch = baseline == null ? null : toPitch(baseline);
  const color = result ? bandColor(result.risk_band) : "var(--text-faint)";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
           aria-label={result ? `Delay risk ${(shown * 100).toFixed(1)} percent` : "Awaiting input"}>
        <defs>
          <clipPath id="ball"><circle cx={SIZE / 2} cy={SIZE / 2} r={R} /></clipPath>
        </defs>

        {/* the moving ball */}
        <g clipPath="url(#ball)">
          <g transform={`translate(0 ${pitch * 1.9})`}>
            <rect x="0" y={-SIZE} width={SIZE} height={SIZE * 1.5 + SIZE / 2} fill="#0a2138" />
            <rect x="0" y={SIZE / 2} width={SIZE} height={SIZE * 1.5} fill="#241605" />
            <line x1="0" y1={SIZE / 2} x2={SIZE} y2={SIZE / 2}
                  stroke="var(--text)" strokeWidth="1.5" opacity="0.85" />
            {/* ladder, every 10 points of probability */}
            {[-30, -20, -10, 10, 20, 30].map((d) => (
              <g key={d} opacity="0.5">
                <line x1={SIZE / 2 - (d % 20 === 0 ? 26 : 15)} y1={SIZE / 2 + d * 1.9}
                      x2={SIZE / 2 + (d % 20 === 0 ? 26 : 15)} y2={SIZE / 2 + d * 1.9}
                      stroke="var(--text-dim)" strokeWidth="1" />
              </g>
            ))}
          </g>

          {/* where this route normally sits */}
          {basePitch != null && (
            <line x1="18" y1={SIZE / 2 + basePitch * 1.9} x2={SIZE - 18}
                  y2={SIZE / 2 + basePitch * 1.9}
                  stroke="var(--cyan)" strokeWidth="1" strokeDasharray="3 4" opacity="0.8" />
          )}
        </g>

        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
                stroke="var(--bezel-lit)" strokeWidth="2" />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R + 5} fill="none"
                stroke="var(--bezel)" strokeWidth="6" />

        {/* fixed aircraft symbol */}
        <g stroke={color} strokeWidth="3" fill="none" strokeLinecap="round">
          <line x1={SIZE / 2 - 38} y1={SIZE / 2} x2={SIZE / 2 - 13} y2={SIZE / 2} />
          <line x1={SIZE / 2 + 13} y1={SIZE / 2} x2={SIZE / 2 + 38} y2={SIZE / 2} />
          <line x1={SIZE / 2 - 13} y1={SIZE / 2} x2={SIZE / 2 - 13} y2={SIZE / 2 + 7} />
          <line x1={SIZE / 2 + 13} y1={SIZE / 2} x2={SIZE / 2 + 13} y2={SIZE / 2 + 7} />
        </g>
        <circle cx={SIZE / 2} cy={SIZE / 2} r="2.4" fill={color} />
      </svg>

      <div style={{ marginTop: 14, textAlign: "center" }}>
        <div style={{
          fontFamily: "var(--mono)", fontSize: 38, fontVariantNumeric: "tabular-nums",
          color, textShadow: `0 0 20px ${result ? color : "transparent"}`, lineHeight: 1,
        }}>
          {result ? `${(shown * 100).toFixed(1)}%` : "\u2013"}
        </div>
        <div className="label" style={{ marginTop: 8, color: result ? color : undefined }}>
          {result ? `${result.risk_band} risk` : "awaiting input"}
        </div>
      </div>
    </div>
  );
}
