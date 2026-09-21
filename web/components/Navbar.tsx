"use client";

import React from "react";

interface NavbarProps {
  activeView: "predict" | "map" | "insights";
  onViewChange: (view: "predict" | "map" | "insights") => void;
}

export default function Navbar({ activeView, onViewChange }: NavbarProps) {
  return (
    <header className="sky-nav">
      <div className="sky-container">
        <div className="sky-nav-top">
          {/* Platform Title & Icon */}
          <div className="sky-logo" onClick={() => onViewChange("predict")}>
            <FlightLogoIcon />
            <span>Flight Delay Predictor</span>
          </div>

          {/* Navigation Categories */}
          <nav className="sky-nav-tabs" style={{ paddingBottom: 0 }}>
            <button
              className={`sky-nav-tab ${activeView === "predict" ? "active" : ""}`}
              onClick={() => onViewChange("predict")}
            >
              <PlaneIcon />
              <span>Predict Delay</span>
            </button>

            <button
              className={`sky-nav-tab ${activeView === "map" ? "active" : ""}`}
              onClick={() => onViewChange("map")}
            >
              <MapIcon />
              <span>Network Map</span>
            </button>

            <button
              className={`sky-nav-tab ${activeView === "insights" ? "active" : ""}`}
              onClick={() => onViewChange("insights")}
            >
              <ChartIcon />
              <span>Airport Statistics</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
}

function FlightLogoIcon() {
  return (
    <svg className="sky-logo-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="#0770E3" />
      <path
        d="M23 16L14 9V14H9L7 12V20L9 18H14V23L23 16Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

function PlaneIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
