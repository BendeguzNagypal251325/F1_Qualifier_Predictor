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
  const state = () => p.evaluate(() => ({ path: location.pathname + location.search, topbar: !!document.querySelector(".topbar"), crashed: !!document.querySelector('[role="alert"]'), h1: document.querySelector("main h1, main h2")?.textContent?.slice(0, 50) }));
  // Wait (up to 15 s, CI runners render 3D in software) for the page heading; a crash fails at once.
  const check = async (what) => {
    await p.waitForTimeout(300);
    let st = await state();
    for (const t0 = Date.now(); !st.crashed && !(st.topbar && st.h1) && Date.now() - t0 < 15000; st = await state()) await p.waitForTimeout(250);
    const ok = st.topbar && !st.crashed && st.h1;
    console.log((ok ? "ok  " : "FAIL") + " " + what.padEnd(26) + JSON.stringify(st));
    if (!ok) failed++;
    return ok;
  };
  await p.goto(base + "/", { waitUntil: "networkidle" });
  await check("load home");
  for (const label of ["Live", "Drivers", "Teams", "Cars", "Tracks", "What if", "Sessions", "Track record", "Heatmap", "How it works"]) {
    await p.click(`nav.nav a:has-text("${label}")`);
    await check("tab " + label);
  }
  await p.click("a.brand");
  await check("logo to overview");
  if (new URL(p.url()).pathname !== "/") { console.log("FAIL logo link " + p.url()); failed++; }
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
  // quick search: Ctrl+K, type, Enter opens the first match
  await p.keyboard.press("Control+k");
  await p.waitForSelector(".palette input", { timeout: 5000 });
  await p.keyboard.type("hamilton");
  await p.waitForTimeout(200);
  await p.keyboard.press("Enter");
  await check("search: hamilton");
  if (!p.url().includes("/drivers/lewis-hamilton")) { console.log("FAIL search opened " + p.url()); failed++; }
  // track page: switch qualifying session
  await p.goto(base + "/tracks/monza", { waitUntil: "networkidle" });
  await p.click('.seg-q button:has-text("Q1")');
  await check("track Q1 breakdown");
  if (!p.url().includes("q=q1") || !(await p.$(".out-chip"))) { console.log("FAIL Q1 breakdown"); failed++; }
  // car page: show one part, then compare it with another car
  await p.goto(base + "/cars/2024/ferrari", { waitUntil: "networkidle" });
  await p.click('.part-list button:has-text("Floor")');
  await check("car part focus");
  await p.click('a.btn:has-text("Compare")');
  await check("compare page");
  if (!p.url().includes("/cars/compare") || !p.url().includes("part=floor")) { console.log("FAIL compare link " + p.url()); failed++; }
  await p.click('.compare-add');
  await p.waitForSelector(".compare-slot >> nth=1", { timeout: 20000 });
  await check("compare: add a car");
  await p.click('.part-list button:has-text("Whole car")');
  await check("compare: whole car");
  await p.click("a.brand");
  await p.waitForTimeout(1500);
  await p.click("svg g.clickable >> nth=1"); // a season row in the dot plot
  await check("overview season row");

  // Phone: no three.js (or model download) on the Cars and Drivers pages until the visitor taps.
  const phone = await b.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true });
  await phone.addInitScript(() => { try { localStorage.setItem("gridcast-intro", "1"); } catch {} });
  const ph = await phone.newPage();
  ph.on("pageerror", (e) => errs.push("PAGEERROR (phone) " + e.message));
  const heavy = [];
  ph.on("request", (r) => { if (/\/assets\/ThreeViews-|\/models\//.test(r.url())) heavy.push(r.url().replace(base, "")); });
  for (const path of ["/cars", "/drivers", "/cars/2026/mercedes"]) {
    await ph.goto(base + path, { waitUntil: "networkidle" });
    await ph.waitForTimeout(1500);
    const ok = heavy.length === 0;
    console.log((ok ? "ok  " : "FAIL") + " " + ("phone: no 3D on " + path).padEnd(26) + JSON.stringify({ requested: heavy.slice(0, 3) }));
    if (!ok) failed++;
  }
  await ph.tap('.tap3d button');
  await ph.waitForSelector(".viewer canvas", { timeout: 30000 }).catch(() => {});
  const loaded = heavy.some((u) => u.includes("ThreeViews-")) && !!(await ph.$(".viewer canvas"));
  console.log((loaded ? "ok  " : "FAIL") + " " + "phone: 3D after tap".padEnd(26) + JSON.stringify({ requested: heavy.length }));
  if (!loaded) failed++;
  await phone.close();

  console.log(errs.length ? errs.join("\n") : "no errors");
  await b.close();
  if (failed || errs.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
