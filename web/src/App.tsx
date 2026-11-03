import { useEffect } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { MetaContext, useApi } from "./api";
import { Wordmark } from "./components/Brand";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SpeedLines } from "./components/SpeedLines";
import { ErrorBox, Info, TooltipLayer } from "./components/ui";
import type { Meta } from "./types";
import Overview from "./pages/Overview";
import LivePage from "./pages/Live";
import { DriverList, DriverPage } from "./pages/Drivers";
import { TrackList, TrackPage } from "./pages/Tracks";
import { CarList, CarPage } from "./pages/Cars";
import { TeamList, TeamPage } from "./pages/Teams";
import WhatIf from "./pages/WhatIf";
import Sessions from "./pages/Sessions";
import HeatmapPage from "./pages/Heatmap";

const NAV = [
  ["/", "Overview"],
  ["/live", "Live"],
  ["/drivers", "Drivers"],
  ["/teams", "Teams"],
  ["/cars", "Cars"],
  ["/tracks", "Tracks"],
  ["/what-if", "What if"],
  ["/sessions", "Sessions"],
  ["/heatmap", "Heatmap"],
] as const;

/** "Lights out": fade the boot screen from index.html once the first data is in. */
/** Fade out the boot screen from index.html, after the first-visit start sequence if one is playing. */
function dismissBoot() {
  const hold = (window as unknown as { __bootHold?: Promise<void> }).__bootHold;
  void Promise.resolve(hold).then(() => {
    const boot = document.getElementById("boot");
    if (!boot || boot.classList.contains("out")) return;
    boot.classList.add("out");
    window.setTimeout(() => boot.remove(), 600);
  });
}

export default function App() {
  const meta = useApi<Meta>("/api/meta");
  const { pathname } = useLocation();
  // Braces matter: in current Chrome window.scrollTo returns a Promise, and an effect must not return
  // anything but a cleanup function (React would try to call the Promise on the next navigation).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    if (meta.data || meta.error) dismissBoot();
  }, [meta.data, meta.error]);
  // Fetch the 3D code in the background once the first page is up, so 3D pages open quickly.
  useEffect(() => {
    if (!meta.data) return;
    // not on connections where the visitor asked to save data, or that are very slow
    const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? "")) return;
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(() => {
      void import("./components/ThreeViews");
    });
  }, [meta.data]);

  return (
    <>
      <SpeedLines />
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="Gridcast home"><Wordmark /></NavLink>
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
        {meta.data && (
          <MetaContext.Provider value={meta.data}>
            <div className="page" key={pathname} style={{ display: "grid", gap: 20 }}>
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<Overview />} />
                  <Route path="/live" element={<LivePage />} />
                  <Route path="/drivers" element={<DriverList />} />
                  <Route path="/drivers/:id" element={<DriverPage />} />
                  <Route path="/tracks" element={<TrackList />} />
                  <Route path="/tracks/:id" element={<TrackPage />} />
                  <Route path="/teams" element={<TeamList />} />
                  <Route path="/teams/:id" element={<TeamPage />} />
                  <Route path="/cars" element={<CarList />} />
                  <Route path="/cars/:season/:team" element={<CarPage />} />
                  <Route path="/what-if" element={<WhatIf />} />
                  <Route path="/sessions" element={<Sessions />} />
                  <Route path="/sessions/:key" element={<Sessions />} />
                  <Route path="/heatmap" element={<HeatmapPage />} />
                  <Route path="*" element={<div className="panel empty-state"><h2>Page not found</h2><NavLink to="/" className="btn">Back to the overview</NavLink></div>} />
                </Routes>
              </ErrorBoundary>
            </div>
          </MetaContext.Provider>
        )}
      </main>
      {meta.data && (
        <footer className="foot">
          <span className="chequer" aria-hidden />
          <span>Gridcast · data to {meta.data.data_version} · out-of-sample forecasts</span>
          <Info label="Sources and credits">
            Every prediction is out-of-sample: before each session the model is retrained on earlier sessions only.
            Results: <a href="https://github.com/f1db/f1db">F1DB</a> (CC BY 4.0). Live sessions: <a href="https://openf1.org">OpenF1</a>.
            Track outlines: <a href="https://github.com/bacinger/f1-circuits">bacinger/f1-circuits</a> (MIT). 3D models adapted from CC BY 4.0 Sketchfab models (repainted, sponsor logos removed):{" "}
            <a href="https://skfb.ly/pOvxI">2026 Redbull RB22</a> by Dave Love SketchFab, <a href="https://skfb.ly/pHXyZ">2025 alpine A525</a> by Abu Saif,{" "}
            <a href="https://skfb.ly/owxuQ">Formula 1 2022 Car</a> by Luis Adrian V. (reshaped for 2020–21) and{" "}
            <a href="https://skfb.ly/pEDBZ">Helmet Redbull - Max Verstappen</a> by Maubian.
            Not affiliated with Formula 1.
          </Info>
        </footer>
      )}
      <TooltipLayer />
    </>
  );
}
