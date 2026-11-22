/* FOD Guard main: boot, routing, filters, timeline, story mode, capabilities. */
"use strict";

(function () {
  const VIEWS = ["overview", "triage", "risk", "root-cause", "actions", "roi", "assistant", "data-models"];
  const RENDER = {
    overview: () => V.overview(),
    triage: () => {},
    risk: () => V.risk(),
    "root-cause": () => V.rootCause(),
    actions: () => V.actions(),
    roi: () => V.roi(),
    assistant: () => {},
    "data-models": () => V.data(),
  };
  let pending = 0;

  function render() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      try { RENDER[FG.state.view]?.(); } catch (e) { console.error(e); }
    });
  }
  FG.render = render;

  /* ------------------------------------------------------------ routing */
  function route() {
    const h = (location.hash || "").replace("#", "");
    const view = VIEWS.includes(h) ? h : "overview";
    FG.state.view = view;
    FG.$$(".view").forEach((s) => { s.hidden = s.dataset.view !== view; });
    FG.$$(".sidenav a").forEach((a) => a.classList.toggle("on", a.dataset.view === view));
    FG.$("#filterbar").style.display = ["overview", "root-cause", "data-models"].includes(view) ? "" : "none";
    render();
    requestAnimationFrame(FGC.resizeAll);
  }
  FG.go = (view) => { if (location.hash !== "#" + view) location.hash = view; else route(); };

  /* ------------------------------------------------------------ filters */
  function setSeg(id, attr, value) {
    FG.$$(`#${id} button`).forEach((b) => {
      const on = b.dataset[attr] === String(value);
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on);
    });
  }
  function syncFilters() {
    setSeg("periodSeg", "period", FG.state.period);
    setSeg("shiftSeg", "shift", FG.state.shift);
    FG.$("#areaSel").value = String(FG.state.area);
    const D = FG.D;
    FG.$("#asOf").value = FG.state.asOf;
    FG.$("#asOfLabel").textContent = `${FG.dateLabel(D.dates[FG.state.asOf])} · ${FG.phaseOf(FG.state.asOf)}`;
    FG.$("#filterNote").textContent = `${FG.periodLabel()}`;
  }
  FG.setState = function (patch) {
    Object.assign(FG.state, patch);
    syncFilters();
    if ("asOf" in patch) { V.plan = null; }
    render();
  };

  function wire() {
    const D = FG.D;
    FG.$("#areaSel").innerHTML = `<option value="all">All areas</option>` + D.areas.map((a, i) => `<option value="${i}">${FG.esc(a)}</option>`).join("");
    FG.$("#periodSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) FG.setState({ period: b.dataset.period }); });
    FG.$("#shiftSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) FG.setState({ shift: b.dataset.shift }); });
    FG.$("#areaSel").addEventListener("change", (e) => FG.setState({ area: e.target.value }));
    FG.$("#lineStrip").addEventListener("click", (e) => {
      const b = e.target.closest("[data-area]");
      if (!b) return;
      const a = b.dataset.area;
      FG.setState({ area: String(FG.state.area) === a ? "all" : a });
    });
    FG.$("#alertsList").addEventListener("click", (e) => {
      const li = e.target.closest("[data-alert-d]");
      if (!li) return;
      FG.setState({ asOf: Math.min(FG.D.nDates - 1, Number(li.dataset.alertD) + 1), period: "7", area: li.dataset.alertA });
      FG.go("root-cause");
      FG.toast("Showing the week around that alert on the root-cause view.");
    });

    /* timeline */
    const asOf = FG.$("#asOf");
    asOf.max = D.nDates - 1;
    const ph = FG.$("#timelinePhases");
    const w = (a, b) => ((b - a) / D.nDates) * 100 + "%";
    ph.innerHTML = `<span class="ph-base" style="width:${w(0, D.rolloutIdx)}"></span><span class="ph-roll" style="width:${w(D.rolloutIdx, D.sustainIdx)}"></span><span class="ph-sus" style="width:${w(D.sustainIdx, D.nDates)}"></span>`;
    asOf.addEventListener("input", () => { stopPlay(); FG.setState({ asOf: Number(asOf.value) }); });
    FG.$("#playBtn").addEventListener("click", () => (playing ? stopPlay() : play()));

    /* overview */
    FG.$("#copyBrief").addEventListener("click", () => FG.copy(V.briefPlain(), "Brief copied"));
    FG.$("#claudeBrief").addEventListener("click", () => AS.rewriteBrief());

    /* risk */
    FG.$("#planner").addEventListener("input", (e) => {
      const el = e.target;
      if (el.id === "waveToggle") V.plan.hiringWave = el.checked;
      else if (el.id === "downIn") V.plan.downtime = Math.max(0, Number(el.value) || 0);
      else if (el.dataset.area) V.plan.newAssoc[el.dataset.area] = Math.max(0, Number(el.value) || 0);
      V.riskOutputs();
    });
    FG.$("#planner").addEventListener("click", (e) => { if (e.target.id === "planReset") { V.plan = AI.defaultPlan(); V.risk(); } });
    FG.$("#levers").addEventListener("change", (e) => {
      const k = e.target.dataset.lever;
      if (!k) return;
      V.plan.slipped[k] = !e.target.checked;
      V.riskOutputs();
      if (!e.target.checked) FG.toast(`<b>${FG.esc(V.shortLever(FG.M.risk.levers.find((l) => l.key === k).name))}</b> switched off in the model.`);
    });

    /* data table */
    let tmr = 0;
    FG.$("#tableSearch").addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(() => { V.tablePage = 0; V.data(); }, 180); });
    FG.$("#pager").addEventListener("click", (e) => { const b = e.target.closest("[data-page]"); if (b) { V.tablePage += Number(b.dataset.page); V.data(); } });
    FG.$("#exportCsv").addEventListener("click", exportCsv);

    /* import */
    V.importInit();
    const dz = FG.$("#dropzone");
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); const f = e.dataTransfer.files[0]; if (f) importFile(f); });
    FG.$("#csvFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importFile(f); });
    FG.$("#copyTemplate").addEventListener("click", () => FG.copy(TEMPLATE, "Template copied. Paste it into a spreadsheet."));
    FG.$("#restoreDemo").addEventListener("click", () => location.reload());

    /* theme changes */
    const rerender = () => { Object.values(FGC.inst).forEach((c) => c.dispose()); FGC.inst = {}; render(); };
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerender);
    new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("hashchange", route);
  }

  /* ------------------------------------------------------------ timeline playback */
  let playing = false, timer = 0;
  function play() {
    const D = FG.D;
    playing = true;
    FG.$("#playIcon").setAttribute("d", "M7 5h4v14H7zm6 0h4v14h-4z");
    FG.$("#playBtn").setAttribute("aria-label", "Pause the timeline");
    if (FG.state.asOf >= D.nDates - 1) FG.state.asOf = 13;
    if (FG.state.view !== "overview") FG.go("overview");
    const launches = new Map(FG.M.risk.levers.map((l) => [D.dates.indexOf(l.launch), l.name]));
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      if (!playing) return;
      const next = Math.min(D.nDates - 1, FG.state.asOf + (reduce ? 14 : 2));
      for (let d = FG.state.asOf + 1; d <= next; d++) {
        if (launches.has(d)) FG.toast(`<b>Launched:</b> ${FG.esc(launches.get(d))}`, 2600);
        if (d === D.sustainIdx) FG.toast(`<b>95% reached.</b> Sustain phase begins.`, 3000);
      }
      FG.setState({ asOf: next, period: "7" });
      if (next >= D.nDates - 1) return stopPlay();
      timer = setTimeout(tick, reduce ? 600 : 140);
    };
    tick();
  }
  function stopPlay() {
    playing = false;
    clearTimeout(timer);
    FG.$("#playIcon").setAttribute("d", "M8 5v14l11-7z");
    FG.$("#playBtn").setAttribute("aria-label", "Play the program timeline");
  }
  FG.stopPlay = stopPlay;

  /* ------------------------------------------------------------ story mode */
  const STORY = () => {
    const D = FG.D;
    const B = FG.summary(D.baseRange, { area: "all", shift: "all" });
    const end = FG.D.nDates - 1;
    const S = FG.summary([end - 27, end], { area: "all", shift: "all" });
    const steps = FG.M.impact.steps;
    const yearB = B.costPerDay * 365, yearA = S.costPerDay * 365;
    return [
      { view: "overview", state: { asOf: D.rolloutIdx - 1, period: "28", area: "all", shift: "all" }, spot: "#kpis",
        title: "The problem", body: `Before the program, the drive test found ${FG.fmt(B.per100, 1)} loose objects in every 100 vehicles, about ${Math.round(B.perDay)} a day. Each one meant an NC, a repair and often another test.` },
      { view: "overview", state: { asOf: D.rolloutIdx - 1, period: "28" }, spot: "#lineStripCard",
        title: "Where they came from", body: "Every stage added risk, but the four assembly lines produced 70% of all loose objects. That decided where the first wave of fixes went." },
      { view: "root-cause", state: { asOf: D.rolloutIdx - 1, period: "28" }, spot: "#fishbone",
        title: "Why they got there", body: "Traced by part number, location and process flow. Human error was the starting point, not the root cause: no place to hold fasteners, no check before breaks, weak clips, a sealed supplier module." },
      { view: "actions", state: { asOf: end, period: "all" }, spot: "#waterfallChart",
        title: "What we changed", body: `Seven levers, cheapest first: standard work, magnetic chairs and racks, shadow boards, checklists, a clip redesign and a supplier SCAR. The risk model credits each one: ${FG.fmt(steps[0].rate, 1)} down to ${FG.fmt(steps[steps.length - 1].rate, 1)} per 100.` },
      { view: "overview", state: { asOf: D.sustainIdx, period: "7" }, spot: "#trendCard",
        title: "The result", body: `95% fewer loose objects in 8 to 9 weeks. Better detection helped too: bumps on the VDT route and a magnetic camera tool cut the time per find in half.` },
      { view: "roi", state: { asOf: end }, spot: "#roiOut",
        title: "What it was worth", body: `About ${FG.money(yearB)} a year of EOL labor before, about ${FG.money(yearA)} after in this dataset. On labor alone, a $900K scanning tunnel would take decades to pay back, which is why the department kept the low-cost approach.` },
      { view: "risk", state: { asOf: end }, spot: "#heatChart", wave: true,
        title: "Staying there, with AI", body: "The risk model watches every area and shift. Here it is warning about a hiring wave on Post-marriage nights, the same pattern that caused the October spike, before it happens." },
      { view: "triage", state: {}, spot: "#triageResult", triage: true,
        title: "AI at the line", body: "A technician describes a find in plain words, or speaks it. The model names the likely source, cause, severity and fix, and pulls the closest past finds. Then it's logged for everyone." },
    ];
  };
  let tourIdx = 0, tourSteps = [];
  function tourShow(i) {
    tourIdx = Math.max(0, Math.min(tourSteps.length - 1, i));
    const st = tourSteps[tourIdx];
    FG.$$(".spotlight").forEach((e) => e.classList.remove("spotlight"));
    if (st.state && Object.keys(st.state).length) FG.setState(st.state);
    if (st.wave !== undefined) { V.plan = AI.defaultPlan(); V.plan.hiringWave = !!st.wave; }
    FG.go(st.view);
    setTimeout(() => {
      if (st.triage) { FG.$("#triageText").value = "Rattle at the bump section, run 2. Pulled a zip-tie tail from the IP cavity near the harness."; V.runTriage(); }
      const el = FG.$(st.spot);
      if (el) { el.classList.add("spotlight"); el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); }
    }, 120);
    FG.$("#tourStep").textContent = `Step ${tourIdx + 1} of ${tourSteps.length}`;
    FG.$("#tourTitle").textContent = st.title;
    FG.$("#tourBody").textContent = st.body;
    FG.$("#tourDots").innerHTML = tourSteps.map((_, k) => `<i class="${k === tourIdx ? "on" : ""}"></i>`).join("");
    FG.$("#tourPrev").disabled = tourIdx === 0;
    FG.$("#tourNext").textContent = tourIdx === tourSteps.length - 1 ? "Finish" : "Next";
  }
  function tourStart() { stopPlay(); tourSteps = STORY(); FG.$("#tour").hidden = false; tourShow(0); }
  function tourEnd() {
    FG.$("#tour").hidden = true;
    FG.$$(".spotlight").forEach((e) => e.classList.remove("spotlight"));
    if (V.plan) V.plan.hiringWave = false;
    FG.setState({ asOf: FG.D.nDates - 1, period: "7" });
    FG.go("overview");
  }
  function wireTour() {
    FG.$("#presentBtn").addEventListener("click", tourStart);
    FG.$("#tourNext").addEventListener("click", () => (tourIdx >= tourSteps.length - 1 ? tourEnd() : tourShow(tourIdx + 1)));
    FG.$("#tourPrev").addEventListener("click", () => tourShow(tourIdx - 1));
    FG.$("#tourClose").addEventListener("click", tourEnd);
    document.addEventListener("keydown", (e) => {
      if (FG.$("#tour").hidden) return;
      if (e.key === "ArrowRight") FG.$("#tourNext").click();
      if (e.key === "ArrowLeft") tourShow(tourIdx - 1);
      if (e.key === "Escape") tourEnd();
    });
  }

  /* ------------------------------------------------------------ export and import */
  async function exportCsv() {
    const ks = V.tableRows.slice().reverse();
    const csv = V.csvOf(ks);
    const name = `fod-guard-loose-objects-${FG.D.dates[FG.state.asOf]}.csv`;
    if (FG.caps.downloads) {
      try { await FG.caps.downloads.save({ filename: name, data: csv }); FG.toast("CSV saved."); return; }
      catch (e) { if (e && e.code === "declined") return; }
    }
    if (ks.length > 3000) { FG.copy(V.csvOf(ks.slice(-3000)), "Copied the latest 3,000 rows as CSV. Narrow the filters to copy fewer."); return; }
    FG.copy(csv, `Copied ${FG.int(ks.length)} rows as CSV. Paste into a spreadsheet.`);
  }

  const TEMPLATE = `date,shift,area,root_cause,object_category,zone,minutes,description
2026-11-25,Day,Marriage,zip_tail,Zip ties,IP / dash cavity,22,Rattle at bump section; zip-tie tail behind IP near harness
2026-11-25,Night,,,,,,Clicking under driver seat; M8 nut on floor pan after break
2026-11-26,Day,EOL repair,eol_leftover,Tools and fixtures,Floor pan, under carpet,15,Spanner on rear floor after repair`;

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }

  async function importFile(file) {
    const note = FG.$("#importNote");
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      const head = rows.shift().map((h) => h.trim().toLowerCase());
      const col = (n) => head.indexOf(n);
      if (col("date") < 0 || col("description") < 0) throw new Error("The file needs at least a date column and a description column.");
      const D = FG.D;
      const recs = [];
      let filled = 0;
      for (const r of rows) {
        const get = (n) => (col(n) >= 0 ? (r[col(n)] || "").trim() : "");
        const date = get("date").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const desc = get("description");
        let area = get("area"), cause = get("root_cause"), obj = get("object_category"), zone = get("zone");
        if (!area || !D.areas.includes(area) || !cause || !obj) {
          const t = AI.triage(desc || " ");
          if (t) {
            if (!area || !D.areas.includes(area)) area = t.area[0].cls;
            if (!cause) cause = t.cause[0].cls;
            if (!obj) obj = t.obj[0].cls;
            if (!zone) zone = t.zone.zone;
            filled++;
          }
        }
        if (!D.areas.includes(area)) continue;
        const z = zone || AI.zoneOf(desc).zone;
        const sev = AI.zoneOf(z + " " + desc).sev;
        recs.push({ date, shift: /night/i.test(get("shift")) ? 1 : 0, area, cause: cause || "housekeeping", obj: obj || "Fasteners", zone: z, sev,
          minutes: Number(get("minutes")) || FG.M.triage.minutes[`*|${sev}`] || 15, desc: desc || "(no description)" });
      }
      if (!recs.length) throw new Error("No usable rows. Check the date format (YYYY-MM-DD) and the area names.");
      loadImported(recs);
      note.textContent = `Loaded ${FG.int(recs.length)} rows from ${file.name}. The triage model filled in ${FG.int(filled)} rows with missing fields. Vehicles per shift are assumed at ${D.plant.jph} an hour.`;
      FG.$("#restoreDemo").hidden = false;
      FG.$("#plantPill").textContent = `Your data · ${file.name}`;
      FG.toast(`<b>${FG.int(recs.length)} finds loaded.</b> Every view now shows your data.`);
    } catch (e) {
      note.textContent = "Couldn't load the file: " + (e.message || e);
    }
  }

  function loadImported(recs) {
    const old = FG.D;
    recs.sort((a, b) => a.date.localeCompare(b.date));
    const first = recs[0].date, last = recs[recs.length - 1].date;
    const dates = [];
    for (let d = first; d <= last; d = FG.addDays(d, 1)) dates.push(d);
    const di = new Map(dates.map((d, i) => [d, i]));
    const uniq = (arr) => [...new Set(arr)].sort();
    const cats = {
      area: uniq(recs.map((r) => r.area)), station: ["-"], object_category: uniq(recs.map((r) => r.obj)), object: uniq(recs.map((r) => r.obj)),
      material: ["unknown"], root_cause: uniq(recs.map((r) => r.cause)), zone: uniq(recs.map((r) => r.zone)), severity: ["A", "B", "C"],
    };
    const ix = (k, v) => cats[k].indexOf(v);
    const inc = { d: [], s: [], h: [], a: [], st: [], oc: [], o: [], m: [], rc: [], z: [], sv: [], vr: [], mn: [], td: [], es: [], tn: [], vm: [], vin: [], tx: [] };
    for (const r of recs) {
      inc.d.push(di.get(r.date)); inc.s.push(r.shift); inc.h.push(5); inc.a.push(ix("area", r.area)); inc.st.push(0);
      inc.oc.push(ix("object_category", r.obj)); inc.o.push(ix("object", r.obj)); inc.m.push(0); inc.rc.push(ix("root_cause", r.cause));
      inc.z.push(ix("zone", r.zone)); inc.sv.push(ix("severity", r.sev)); inc.vr.push(1); inc.mn.push(r.minutes); inc.td.push(0); inc.es.push(0);
      inc.tn.push(0); inc.vm.push(0); inc.vin.push("-"); inc.tx.push(r.desc);
    }
    const veh = Math.round(old.plant.jph * old.plant.shift_hours);
    const sh = { d: [], s: [], a: [], v: [], dt: [], nw: [], n: [] };
    const cnt = new Map();
    recs.forEach((r) => { const k = `${di.get(r.date)}|${r.shift}|${old.areas.indexOf(r.area)}`; cnt.set(k, (cnt.get(k) || 0) + 1); });
    dates.forEach((_, d) => [0, 1].forEach((s) => old.areas.forEach((_, a) => {
      sh.d.push(d); sh.s.push(s); sh.a.push(a); sh.v.push(veh); sh.dt.push(0); sh.nw.push(0.08); sh.n.push(cnt.get(`${d}|${s}|${a}`) || 0);
    })));
    const third = Math.max(1, Math.floor(dates.length / 3));
    const plant = { ...old.plant, rollout_start: dates[Math.min(dates.length - 1, third)], sustain_start: dates[Math.min(dates.length - 1, third * 2)] };
    const cause_meta = { ...old.cause_meta };
    cats.root_cause.forEach((c) => { if (!cause_meta[c]) cause_meta[c] = { branch: "Method", label: c }; });
    FG.decode({ ...old, plant, dates, cats, cause_meta, incidents: inc, shifts: sh });
    AI.bm25 = null; AI.alerts = null; V.plan = null;
    FG.state.period = "all";
    FG.$("#asOf").max = FG.D.nDates - 1;
    syncFilters();
    render();
  }

  /* ------------------------------------------------------------ capabilities */
  async function capabilities() {
    const use = (n) => (window.claude?.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
    const [sample, dictation, downloads, db] = await Promise.all([use("sample"), use("dictation"), use("downloads"), use("db")]);
    Object.assign(FG.caps, { sample, dictation, downloads, db });
    FG.$("#aiPillText").textContent = sample ? "AI models ready · Claude on" : "AI models ready";
    FG.$("#claudeBrief").hidden = !sample;
    AS.greet();
    if (dictation) setupMic(dictation);
    else FG.$("#micNote").textContent = "Tip: press Ctrl or Cmd + Enter to analyze.";
    FG.$("#exportCsv").textContent = downloads ? "Export CSV" : "Copy CSV";
    if (db) subscribeLog(db);
    V.renderLog();
  }

  function subscribeLog(db) {
    let done = false;
    const t = setTimeout(() => { if (!done) FG.$("#logHint").textContent = "Shared log not reachable yet"; }, 10000);
    try {
      db.collection("finds").orderBy("at", "desc").limit(100).onSnapshot((snap) => {
        done = true; clearTimeout(t);
        const shared = snap.docs.map((d) => d.data()).filter(Boolean);
        const local = FG.logged.filter((x) => x.local && !shared.some((s) => s.at === x.at && s.text === x.text));
        FG.logged = [...local, ...shared];
        V.renderLog();
      }, () => { done = true; clearTimeout(t); FG.$("#logHint").textContent = "This session"; });
    } catch (e) { clearTimeout(t); }
  }

  function setupMic(d) {
    const btn = FG.$("#micBtn"), ta = FG.$("#triageText");
    btn.hidden = false;
    FG.$("#micNote").textContent = "Or press the mic and speak the find.";
    let baseText = "", listening = false;
    d.onPartial(({ text }) => { ta.value = (baseText + " " + text).trim(); });
    d.onFinal(({ text }) => { baseText = (baseText + " " + text).trim(); ta.value = baseText; });
    d.onState(({ state }) => {
      listening = state === "listening";
      btn.classList.toggle("listening", listening);
      btn.setAttribute("aria-label", listening ? "Stop dictation" : "Dictate the description");
      if (!listening && baseText) V.runTriage();
    });
    btn.addEventListener("click", () => {
      if (listening) { d.stop().catch(() => {}); return; }
      baseText = ta.value.trim();
      d.start().catch((e) => {
        if (e && e.code === "not_granted") { btn.hidden = true; FG.$("#micNote").textContent = "Microphone not allowed. Typing works just as well."; }
      });
    });
  }

  /* ------------------------------------------------------------ boot */
  async function boot() {
    try {
      await FG.load();
    } catch (e) {
      FG.$("#loading").innerHTML = `<div class="error-box"><b>The plant data didn't load.</b><p>${FG.esc(e.message || e)}. Reload the page to try again.</p></div>`;
      return;
    }
    if (typeof echarts === "undefined") FG.toast("The chart library didn't load, so charts are hidden. Everything else works.", 6000);
    wire();
    wireTour();
    V.triageInit();
    V.roiInit();
    V.modelCards();
    AS.init();
    AI.computeAlerts();
    syncFilters();
    FG.$("#aiPill").classList.add("ready");
    FG.$("#aiPillText").textContent = "AI models ready";
    route();
    FG.$("#loading").classList.add("done");
    capabilities();
  }
  boot();
})();
