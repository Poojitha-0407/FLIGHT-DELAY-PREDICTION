"use client";

import { useEffect, useRef, useState } from "react";
import type { Prediction } from "@/lib/types";

/* The one part of this UI that isn't borrowed from somewhere else. A PFD
 * answers the same question the model does -- how far from level are we -- and
 * the horizon rides on the route's own historical rate, so the gap between it
 * and the aircraft symbol is what the model is actually contributing. */

const S = 84;
const R = 36;

const BAND: Record<Prediction["risk_band"], string> = {
  low: "var(--green)",
  moderate: "var(--amber)",
  elevated: "var(--orange)",
  high: "var(--red)",
};

/** Probability -> pitch. Level near the base rate, full deflection around 50%. */
const pitchOf = (p: number) => Math.max(-38, Math.min(38, (p - 0.16) * 190));

export default function RiskGauge({ result }: { result: Prediction | null }) {
  const [shown, setShown] = useState(0);
  const raf = useRef(0);

  // instruments don't teleport
  useEffect(() => {
    const target = result?.probability ?? 0;
    const from = shown;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - t0) / 550, 1);
      setShown(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.probability]);

  // parked reads as level, not pinned to the bottom of the range
  const pitch = result ? pitchOf(shown) : 0;
  const base = result?.baseline_route_rate;
  const basePitch = base == null ? null : pitchOf(base);
  const color = result ? BAND[result.risk_band] : "var(--fg-3)";
  const k = 0.82; // px per degree

  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ flex: "none" }}
         role="img"
         aria-label={result ? `Delay risk ${(shown * 100).toFixed(1)}%` : "No estimate yet"}>
      <defs>
        <clipPath id="rg-ball"><circle cx={S / 2} cy={S / 2} r={R} /></clipPath>
      </defs>

      <g clipPath="url(#rg-ball)">
        <g transform={`translate(0 ${pitch * k})`}>
          <rect x="0" y={-S} width={S} height={S * 1.5} fill="#16202e" />
          <rect x="0" y={S / 2} width={S} height={S * 1.5} fill="#2a1e0d" />
          <line x1="0" y1={S / 2} x2={S} y2={S / 2} stroke="var(--fg)" strokeWidth="1" opacity="0.7" />
          {/* ladder, every 10 points of probability */}
          {[-20, -10, 10, 20].map((d) => (
            <line key={d} x1={S / 2 - 9} y1={S / 2 + d * k} x2={S / 2 + 9} y2={S / 2 + d * k}
                  stroke="var(--fg-2)" strokeWidth="0.8" opacity="0.45" />
          ))}
        </g>
        {/* where this route normally sits */}
        {basePitch != null && (
          <line x1="8" y1={S / 2 + basePitch * k} x2={S - 8} y2={S / 2 + basePitch * k}
                stroke="var(--cyan)" strokeWidth="0.9" strokeDasharray="2 3" opacity="0.85" />
        )}
      </g>

      <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke="var(--line-hi)" strokeWidth="1" />

      {/* fixed aircraft symbol */}
      <g stroke={color} strokeWidth="1.8" fill="none" strokeLinecap="round">
        <line x1={S / 2 - 16} y1={S / 2} x2={S / 2 - 6} y2={S / 2} />
        <line x1={S / 2 + 6} y1={S / 2} x2={S / 2 + 16} y2={S / 2} />
        <line x1={S / 2 - 6} y1={S / 2} x2={S / 2 - 6} y2={S / 2 + 3.5} />
        <line x1={S / 2 + 6} y1={S / 2} x2={S / 2 + 6} y2={S / 2 + 3.5} />
      </g>
      <circle cx={S / 2} cy={S / 2} r="1.3" fill={color} />
    </svg>
  );
}
