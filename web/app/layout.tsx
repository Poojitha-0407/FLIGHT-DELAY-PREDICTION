import type { Metadata } from "next";
import "./globals.css";
import "mapbox-gl/dist/mapbox-gl.css";

export const metadata: Metadata = {
  title: "Flight Delay Platform",
  description:
    "Delay risk and network bottlenecks across the 30 busiest US airports, from one year of BTS on-time performance data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
