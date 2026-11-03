// Click-through test of the running app: every tab, cards into detail pages, browser back/forward,
// a chart click. Loading pages by URL alone misses crashes that only happen when React switches
// pages (e.g. an effect returning a non-function). Exits with code 1 on any failure.
//
//   node web/scripts/check-navigation.cjs http://localhost:8000
const { chromium } = require("playwright");
(async () => {
  const base = process.argv[2] || "http://127.0.0.1:8000";
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  let failed = 0;
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  p.on("console", (m) => m.type() === "error" && errs.push("CONSOLE " + m.text()));
  const check = async (what) => {
    await p.waitForTimeout(1200);
    const st = await p.evaluate(() => ({ path: location.pathname + location.search, topbar: !!document.querySelector(".topbar"), crashed: !!document.querySelector('[role="alert"]'), h1: document.querySelector("main h1, main h2")?.textContent?.slice(0, 50) }));
    const ok = st.topbar && !st.crashed && st.h1;
    console.log((ok ? "ok  " : "FAIL") + " " + what.padEnd(26) + JSON.stringify(st));
    if (!ok) failed++;
    return ok;
  };
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await check("load home");
  for (const label of ["Live", "Drivers", "Teams", "Cars", "Tracks", "What if", "Sessions", "Heatmap", "Overview"]) {
    await p.click(`nav.nav a:has-text("${label}")`);
    await check("tab " + label);
  }
  const steps = [
    ["Drivers", ".card-grid .card", "driver card"],
    ["Teams", ".card-grid .card", "team card"],
    ["Cars", ".card-grid .card", "car card"],
    ["Tracks", ".card-grid .card", "track card"],
  ];
  for (const [tab, sel, what] of steps) {
    await p.click(`nav.nav a:has-text("${tab}")`);
    await p.waitForSelector(sel, { timeout: 20000 });
    await p.click(sel);
    await check(what);
    await p.goBack();
    await check("back from " + what);
    await p.goForward();
    await check("forward to " + what);
  }
  await p.click(`nav.nav a:has-text("Overview")`);
  await p.waitForTimeout(1500);
  await p.click("svg g.clickable >> nth=1"); // a season row in the dot plot
  await check("overview season row");
  console.log(errs.length ? errs.join("\n") : "no errors");
  await b.close();
  if (failed || errs.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
