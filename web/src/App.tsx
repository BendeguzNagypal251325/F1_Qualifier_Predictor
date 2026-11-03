import { useEffect } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { MetaContext, useApi } from "./api";
import { ErrorBox, Loading, TooltipLayer } from "./components/ui";
import type { Meta } from "./types";
import Overview from "./pages/Overview";
import LivePage from "./pages/Live";
import { DriverList, DriverPage } from "./pages/Drivers";
import { TrackList, TrackPage } from "./pages/Tracks";
import { CarList, CarPage } from "./pages/Cars";
import WhatIf from "./pages/WhatIf";
import Sessions from "./pages/Sessions";
import HeatmapPage from "./pages/Heatmap";

const NAV = [
  ["/", "Overview"],
  ["/live", "Live"],
  ["/drivers", "Drivers"],
  ["/cars", "Cars"],
  ["/tracks", "Tracks"],
  ["/what-if", "What if"],
  ["/sessions", "Sessions"],
  ["/heatmap", "Heatmap"],
] as const;

export default function App() {
  const meta = useApi<Meta>("/api/meta");
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="Q3 Predictor home">
            Q3<b>Predictor</b><small>F1 qualifying</small>
          </NavLink>
          <nav className="nav" aria-label="Main">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === "/"}>
                {label === "Live" && <span className={`live-dot${meta.data?.live.enabled ? " on" : ""}`} aria-hidden />}
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {meta.error && <ErrorBox error={meta.error} />}
        {!meta.data && !meta.error && <Loading height={320} />}
        {meta.data && (
          <MetaContext.Provider value={meta.data}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/live" element={<LivePage />} />
              <Route path="/drivers" element={<DriverList />} />
              <Route path="/drivers/:id" element={<DriverPage />} />
              <Route path="/tracks" element={<TrackList />} />
              <Route path="/tracks/:id" element={<TrackPage />} />
              <Route path="/cars" element={<CarList />} />
              <Route path="/cars/:season/:team" element={<CarPage />} />
              <Route path="/what-if" element={<WhatIf />} />
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/sessions/:key" element={<Sessions />} />
              <Route path="/heatmap" element={<HeatmapPage />} />
              <Route path="*" element={<div className="panel empty-state"><h2>Page not found</h2><NavLink to="/" className="btn">Back to the overview</NavLink></div>} />
            </Routes>
          </MetaContext.Provider>
        )}
      </main>
      {meta.data && (
        <footer className="foot">
          <span>Every prediction is out-of-sample: before each session the model is retrained on earlier sessions only. Data up to {meta.data.data_version}.</span>
          <span>Results: <a href="https://github.com/f1db/f1db">F1DB</a> (CC BY 4.0) · Live sessions: <a href="https://openf1.org">OpenF1</a> · Track outlines: <a href="https://github.com/bacinger/f1-circuits">bacinger/f1-circuits</a> (MIT)
            {" "}· 3D cars and helmets are our own models, not replicas. Not affiliated with Formula 1.</span>
        </footer>
      )}
      <TooltipLayer />
    </>
  );
}
