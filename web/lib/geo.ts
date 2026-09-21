// Great-circle interp, so the markers follow the same path ArcLayer draws.

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface Leg {
  from: [number, number];
  to: [number, number];
  delta: number;  // angular distance, rad

}

export function leg(from: [number, number], to: [number, number]): Leg {
  const [lon1, lat1] = from.map(toRad) as [number, number];
  const [lon2, lat2] = to.map(toRad) as [number, number];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );
  return { from, to, delta: d };
}

/** Position at fraction t along the circle. */
export function along(l: Leg, t: number): [number, number] {
  const d = l.delta;
  if (d < 1e-9) return l.from;
  const [lon1, lat1] = l.from.map(toRad) as [number, number];
  const [lon2, lat2] = l.to.map(toRad) as [number, number];
  const a = Math.sin((1 - t) * d) / Math.sin(d);
  const b = Math.sin(t * d) / Math.sin(d);
  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
  const z = a * Math.sin(lat1) + b * Math.sin(lat2);
  return [toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.hypot(x, y)))];
}
