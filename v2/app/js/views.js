/* FOD Guard views: one render function per view. */
"use strict";

const V = (window.V = {});
const BRANCH_ORDER = { top: ["People", "Machine", "Method"], bottom: ["Material", "Measurement", "Environment"] };
const LEVEL_COLOR = { Eliminate: "--good", Engineer: "--s1", Administer: "--s7", Detect: "--s4" };
const STATUS_COLOR = { Sustaining: "--good", Done: "--good", Proposed: "--s1", "Not approved": "--muted" };

function shortLever(name) {
  return name.replace("Clean before you leave and daily quality meeting", "Clean before you leave + daily meeting")
    .replace("Magnetic chairs and point-of-use racks", "Magnetic chairs + racks")
    .replace("Shadow boards and paint fixture checklist", "Shadow boards + fixture checklist")
    .replace("EOL post-repair exit checklist", "EOL exit checklist")
    .replace("Supplier SCAR and containment", "Supplier SCAR")
    .replace("Robot wrong-shot alert", "Robot wrong-shot alert");
}
V.shortLever = shortLever;

function baselineSummary(opts = {}) { return FG.summary(FG.D.baseRange, opts); }

/* ===================================================================== overview */
V.overview = function () {
  const D = FG.D, st = FG.state;
  const range = FG.range();
  const S = FG.summary(range);
  const B = baselineSummary();
  const fl = FG.filterLabel();
  FG.$("#overviewLede").textContent = `${FG.periodLabel(range)}${fl ? " · " + fl : ""}. ${FG.phaseOf(st.asOf)} phase.`;

  /* line strip */
  const strip = FG.$("#lineStrip");
  const main = ["BIW", "Paint", "Pre-marriage", "Marriage", "Post-marriage", "EOL repair"];
  const feeders = { Supplier: 3, Subframe: 4 };
  const stationHtml = (area) => {
    const ai = D.areas.indexOf(area);
    const s = FG.summary(range, { area: String(ai) });
    const b = FG.summary(D.baseRange, { area: String(ai) });
    const red = b.per100 ? 1 - s.per100 / b.per100 : 0;
    const lamp = red >= 0.9 ? "good" : red >= 0.7 ? "warn" : "crit";
    const lampText = red >= 0.9 ? "On target" : red >= 0.7 ? "Watch" : "Act";
    const on = st.area !== "all" && Number(st.area) === ai ? " on" : "";
    return `<button type="button" class="station${on}" data-area="${ai}" style="--area-color:var(--s${ai + 1})" aria-pressed="${!!on}"
      title="${FG.esc(area)}: ${FG.fmt(s.per100, 2)} per 100 vehicles, baseline ${FG.fmt(b.per100, 2)}">
      <span class="station-name">${FG.esc(area)}</span>
      <span class="station-rate">${FG.fmt(s.per100, 2)}<small>per 100</small></span>
      <span class="station-delta"><i class="lamp ${lamp}" aria-hidden="true"></i>${lampText} · ${Math.abs(red) < 0.005 ? "at baseline" : `${red >= 0 ? "▼" : "▲"} ${Math.abs(Math.floor(red * 100 + 1e-9))}%`}</span>
    </button>`;
  };
  let html = "";
  for (const [area, col] of Object.entries(feeders)) {
    html += `<div class="ls-feeder" style="grid-column:${col}">${stationHtml(area)}</div>`;
  }
  html += `<div class="ls-rail" aria-hidden="true"></div>`;
  main.forEach((a, i) => { html += `<div class="ls-main" style="grid-column:${i + 1}">${stationHtml(a)}</div>`; });
  strip.innerHTML = html;

  /* KPIs */
  const prevRange = [Math.max(0, range[0] - (range[1] - range[0] + 1)), range[0] - 1];
  const P = prevRange[1] >= prevRange[0] ? FG.summary(prevRange) : null;
  const redB = B.per100 ? 1 - S.per100 / B.per100 : 0;
  const dly = FG.daily(st.asOf).slice(-28).map((p) => +p.rate.toFixed(2));
  const deltaHtml = (cur, prev, goodDown = true, fmt = (v) => FG.fmt(v, 1)) => {
    if (prev == null || !isFinite(prev) || prev === 0) return `<span>No earlier period to compare</span>`;
    const ch = (cur - prev) / prev;
    const good = goodDown ? ch <= 0 : ch >= 0;
    return `<span class="${good ? "delta-good" : "delta-bad"}">${ch <= 0 ? "▼" : "▲"} ${Math.abs(Math.round(ch * 100))}%</span><span>vs previous ${range[1] - range[0] + 1} days (${fmt(prev)})</span>`;
  };
  FG.$("#kpis").innerHTML = `
    <div class="kpi kpi-hero">
      <span class="kpi-label">Loose objects per 100 vehicles at VDT</span>
      <span class="kpi-value">${FG.fmt(S.per100, 2)}</span>
      <span class="kpi-delta"><span class="${redB >= 0 ? "delta-good" : "delta-bad"}">${redB >= 0 ? "▼" : "▲"} ${Math.abs(Math.floor(redB * 100 + 1e-9))}%</span><span>vs baseline ${FG.fmt(B.per100, 1)}</span></span>
      <div class="kpi-spark" id="heroSpark" aria-hidden="true"></div>
    </div>
    <div class="kpi"><span class="kpi-label">Finds per day</span><span class="kpi-value">${FG.fmt(S.perDay, S.perDay < 10 ? 1 : 0)}</span><span class="kpi-delta">${deltaHtml(S.perDay, P?.perDay)}</span></div>
    <div class="kpi"><span class="kpi-label">EOL labor per day</span><span class="kpi-value">${FG.money(S.costPerDay)}</span><span class="kpi-delta">${deltaHtml(S.costPerDay, P?.costPerDay, true, FG.money)}</span></div>
    <div class="kpi"><span class="kpi-label">Found on the first VDT run</span><span class="kpi-value">${FG.pct(S.firstRun)}</span><span class="kpi-delta"><span>Baseline ${FG.pct(B.firstRun)}</span></span></div>
    <div class="kpi"><span class="kpi-label">Escaped to customers</span><span class="kpi-value">${FG.int(S.escapes)}</span><span class="kpi-delta"><span>Baseline ${FG.fmt(B.escapes / B.days * S.days, 1)} for the same days</span></span></div>`;
  FGC.spark(FG.$("#heroSpark"), dly, FG.css("--muted"));

  /* trend */
  const series = FG.daily(st.asOf);
  const alertDays = [...new Set(AI.alertsIn([0, st.asOf]).map((a) => a.d))];
  let limits = null;
  if (st.asOf >= D.sustainIdx + 13) {
    let n = 0, v = 0;
    const al = new Set(alertDays);
    for (let d = D.sustainIdx; d <= st.asOf; d++) if (!al.has(d)) { n += series[d].n; v += series[d].v; }
    const cl = v ? (n / v) * 100 : 0;
    const units = v / 100 / Math.max(1, st.asOf - D.sustainIdx + 1);
    limits = { cl, ucl: cl + 3 * Math.sqrt(cl / units) };
  }
  const launches = FG.M.risk.levers.map((l) => ({ d: D.dates.indexOf(l.launch), name: l.name }));
  FGC.trend(series, { launches, alertDays, limits });

  /* paretos */
  const areaRows = FG.breakdown(range, "area").map(([name, value]) => ({ name, value, color: FG.areaColor(D.areas.indexOf(name)) }));
  const baseArea = {}; const bTot = FG.breakdown(D.baseRange, "area").reduce((a, r) => a + r[1], 0);
  FG.breakdown(D.baseRange, "area").forEach(([k, v]) => { baseArea[k] = v / bTot; });
  FGC.hbars("paretoAreaChart", areaRows, { tableKey: "paretoArea", baseline: baseArea });
  const objRows = FG.breakdown(range, "object_category").map(([name, value]) => ({ name, value, color: FG.css("--s1") }));
  FGC.hbars("paretoObjChart", objRows, { tableKey: "paretoObj" });

  /* brief and alerts */
  V.renderBrief();
  V.renderAlerts(range);
};

V.briefData = function () {
  const D = FG.D, st = FG.state;
  const range = FG.range();
  const S = FG.summary(range), B = baselineSummary();
  const n = range[1] - range[0] + 1;
  const prev = range[0] > 0 ? FG.summary([Math.max(0, range[0] - n), range[0] - 1]) : null;
  const areas = FG.breakdown(range, "area");
  const causes = FG.breakdown(range, "root_cause");
  const alerts = AI.alertsIn(range);
  const plan = AI.defaultPlan();
  const fc = AI.forecast(plan);
  let hi = { v: 0 };
  fc.grid.forEach((row, i) => row.slice(0, 2).forEach((v, j) => { if (v > hi.v) hi = { v, area: D.areas[i], slot: fc.slots[j] }; }));
  return {
    asOf: D.dates[st.asOf], period: FG.periodLabel(range), filter: FG.filterLabel() || "All areas, both shifts",
    phase: FG.phaseOf(st.asOf),
    per100: +S.per100.toFixed(2), finds: S.n, perDay: +S.perDay.toFixed(1), costPerDay: Math.round(S.costPerDay),
    baselinePer100: +B.per100.toFixed(4), reductionVsBaseline: B.per100 ? +(1 - S.per100 / B.per100).toFixed(4) : null,
    previousPer100: prev ? +prev.per100.toFixed(2) : null,
    firstRunDetection: +S.firstRun.toFixed(4), escapes: S.escapes,
    topAreas: areas.slice(0, 3).map(([a, c]) => ({ area: a, finds: c, share: +(c / Math.max(1, S.n)).toFixed(4) })),
    topCauses: causes.slice(0, 3).map(([c, k]) => ({ cause: D.cause_meta[c]?.label || c, finds: k })),
    alerts: alerts.slice(0, 3).map((a) => ({ date: D.dates[a.d], area: D.areas[a.a], shift: a.s ? "Night" : "Day", observed: a.n, expected: +a.lam.toFixed(1) })),
    nextShiftHighestRisk: hi.area ? { area: hi.area, shift: hi.slot.label, per100: +hi.v.toFixed(2) } : null,
  };
};

V.renderBrief = function (claudeText) {
  const box = FG.$("#briefText");
  if (claudeText) {
    const lines = claudeText.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
    const st = FG.state;
    box.innerHTML = `<p class="brief-head">As of ${FG.dateLabel(FG.D.dates[st.asOf])} · ${FG.esc(FG.filterLabel() || "All areas, both shifts")}</p>` +
      `<ul>${lines.map((l) => `<li>${FG.esc(l)}</li>`).join("")}</ul><p class="card-hint">Rewritten by Claude from the data above.</p>`;
    return;
  }
  const b = V.briefData();
  const trend = b.previousPer100 == null ? "" : b.per100 <= b.previousPer100 ? `, down from ${FG.fmt(b.previousPer100, 2)}` : `, up from ${FG.fmt(b.previousPer100, 2)}`;
  const items = [
    `<b>${FG.fmt(b.per100, 2)} loose objects per 100 vehicles</b>${trend}. ${b.finds} finds, about ${FG.fmt(b.perDay, 1)} a day${b.reductionVsBaseline != null ? `, ${Math.floor(b.reductionVsBaseline * 100 + 1e-9)}% below the ${FG.fmt(b.baselinePer100, 1)} baseline` : ""}.`,
    b.topAreas.length ? `Biggest source: <b>${FG.esc(b.topAreas[0].area)}</b> (${FG.pct(b.topAreas[0].share)} of finds). Top cause: ${FG.esc(b.topCauses[0]?.cause || "-")}.` : "No finds in this period.",
    b.alerts.length ? `<b>${b.alerts.length === 1 ? "1 anomaly" : b.alerts.length + " anomalies"}</b> flagged. Latest: ${FG.esc(b.alerts[0].area)} ${b.alerts[0].shift.toLowerCase()} shift on ${FG.dateLabel(b.alerts[0].date, false)}, ${b.alerts[0].observed} finds against about ${b.alerts[0].expected} expected.` : "No anomalies flagged by the risk model.",
    b.nextShiftHighestRisk ? `Next shift to watch: <b>${FG.esc(b.nextShiftHighestRisk.area)}</b> (${b.nextShiftHighestRisk.shift.endsWith("N") ? "night" : "day"}), forecast ${FG.fmt(b.nextShiftHighestRisk.per100, 2)} per 100.` : "",
    `EOL labor on loose objects: about ${FG.money(b.costPerDay)} a day.`,
  ].filter(Boolean);
  box.innerHTML = `<p class="brief-head">As of ${FG.dateLabel(b.asOf)} · ${FG.esc(b.filter)}</p><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
};
V.briefPlain = () => FG.$("#briefText").innerText.trim();

V.renderAlerts = function (range) {
  const D = FG.D;
  let list = AI.alertsIn(range);
  let note = "";
  if (!list.length) {
    const before = AI.alertsIn([0, FG.state.asOf]);
    if (before.length) { list = before.slice(0, 2); note = `<li class="empty">No anomalies in this period. Most recent:</li>`; }
  }
  if (!list.length) { FG.$("#alertsList").innerHTML = `<li class="empty">No anomalies flagged up to ${FG.dateLabel(D.dates[FG.state.asOf])}.</li>`; return; }
  FG.$("#alertsList").innerHTML = note + list.slice(0, 6).map((a) => {
    const crit = a.p < 1e-6 ? " crit" : "";
    const top = AI.alertCauses(a)[0];
    return `<li class="alert${crit}" data-alert-d="${a.d}" data-alert-a="${a.a}" tabindex="0">
      <span class="sev" aria-hidden="true"></span>
      <span class="alert-title">${FG.esc(D.areas[a.a])}, ${a.s ? "night" : "day"} shift, ${FG.dateLabel(D.dates[a.d], false)}</span>
      <span class="alert-meta">${a.n} finds vs about ${FG.fmt(a.lam, 1)} expected (${FG.fmt(a.ratio, 0)}x).${top ? " Mostly: " + FG.esc(D.cause_meta[top[0]]?.label.toLowerCase() || top[0]) + "." : ""}${a.newShare > 0.15 ? ` ${Math.round(a.newShare * 100)}% new associates.` : ""}</span>
    </li>`;
  }).join("");
};

/* ===================================================================== triage */
const EXAMPLES = [
  "Rattle at the bump section, run 2. Pulled a zip-tie tail from the IP cavity near the harness.",
  "Clicking under the driver seat on hard stop. Found an M8 flange nut on the floor pan, same type as the seat bolt station.",
  "Spanner left on the rear floor. Vehicle had been in the repair bay.",
  "Screw rattling inside the center console. Module was sealed when received.",
  "Cross-threaded M12 bolt under the front cradle, looks like a robot wrong shot.",
  "Metal piece near the HV battery area, run 3.",
];
V.triageInit = function () {
  FG.$("#exampleChips").innerHTML = EXAMPLES.map((e, i) => `<button type="button" class="chip" data-ex="${i}">${FG.esc(e.split(".")[0])}</button>`).join("");
  FG.$("#exampleChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ex]");
    if (!b) return;
    FG.$("#triageText").value = EXAMPLES[b.dataset.ex];
    V.runTriage();
  });
  FG.$("#triageForm").addEventListener("submit", (e) => { e.preventDefault(); V.runTriage(); });
  FG.$("#triageText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) V.runTriage(); });
  V.triageEmpty();
  V.renderLog();
};
V.triageEmpty = function () {
  FG.$("#triageResult").innerHTML = `<div class="tr-empty">
    <span class="tag tag-ai">AI</span>
    <h2 style="font:600 18px/1.3 var(--font-body)">Type or pick an example to see the model work</h2>
    <p>The text model was trained on ${FG.M.trained_on.split(",")[0]}. It reads the words a technician uses, the part, the place and the symptom, and returns its top three guesses with confidence. In held-out tests it named the right source area ${FG.pct(FG.M.metrics.triage.area.top1_accuracy)} of the time, and had it in the top three ${FG.pct(FG.M.metrics.triage.area.top3_accuracy)} of the time.</p>
  </div>`;
};
V.lastTriage = null;
V.runTriage = function () {
  const text = FG.$("#triageText").value.trim();
  if (text.length < 6) { FG.$("#triageText").focus(); FG.toast("Describe the find in a few words first."); return; }
  const r = AI.triage(text);
  if (!r) { FG.$("#triageResult").innerHTML = `<div class="tr-empty"><p>The model didn't recognize any of these words. Try naming the part, where it was found, and the noise.</p></div>`; return; }
  V.lastTriage = r;
  const D = FG.D;
  const probRows = (list, colorFn) => list.slice(0, 3).map((x) => `
    <div class="prob-row"><span>${FG.esc(colorFn ? x.cls : (D.cause_meta[x.cls]?.label || x.cls))}</span>
      <span class="prob-bar"><span style="width:${(x.p * 100).toFixed(1)}%;--bar:${colorFn ? colorFn(x.cls) : "var(--accent)"}"></span></span>
      <span class="prob-val">${FG.pct(x.p)}</span></div>`).join("");
  const sev = AI.SEVERITY[r.zone.sev];
  const sim = AI.similar(text, 3);
  const conf = r.confidence >= 0.75 ? "High confidence" : r.confidence >= 0.45 ? "Medium confidence. Check the top three" : "Low confidence. Add the part name or location";
  FG.$("#triageResult").innerHTML = `
    <div class="card-head"><h2>Model read</h2><span class="tag tag-ai">${conf}</span></div>
    <div class="tr-section"><span class="tr-label">Likely source area</span>${probRows(r.area, (a) => `var(--s${D.areas.indexOf(a) + 1})`)}</div>
    <div class="tr-section"><span class="tr-label">Likely root cause</span>${probRows(r.cause)}</div>
    <div class="tr-grid">
      <div class="tr-tile"><span>Object</span><b>${FG.esc(r.obj[0].cls)}</b><span>${FG.pct(r.obj[0].p)} sure</span></div>
      <div class="tr-tile"><span>Severity</span><b class="sev-chip"><i style="background:var(${sev.color})"></i>${FG.esc(sev.label.split(",")[0])}</b><span>${FG.esc(r.zone.known ? r.zone.zone : "Zone not stated, assumed internal")}</span></div>
      <div class="tr-tile"><span>Expected to clear</span><b>${FG.fmt(r.minutes, 0)} min</b><span>about ${FG.money(r.cost)} of EOL labor</span></div>
    </div>
    <div class="tr-section"><span class="tr-label">Recommended action</span>
      <div class="action-box"><span>${FG.esc(r.action || "Log the find and review at the daily quality meeting.")}</span>
      ${r.countermeasure ? `<span class="card-hint">Countermeasure: ${FG.esc(r.countermeasure.name)} · ${FG.esc(r.countermeasure.level)} · owner ${FG.esc(r.countermeasure.owner)}</span>` : ""}</div></div>
    <div class="tr-section"><span class="tr-label">Why the model thinks ${FG.esc(r.area[0].cls)}</span>
      <div class="why">${r.why.length ? r.why.map((w) => `<span title="weight ${w.w.toFixed(2)}">${FG.esc(w.term)}</span>`).join("") : '<span>no strong area words</span>'}</div></div>
    <div class="tr-section"><span class="tr-label">Most similar past finds</span>
      <ul class="similar">${sim.map((s) => { const rec = FG.record(s.k); return `<li><span>${FG.esc(rec.description)}</span><span class="meta">${rec.id} · ${FG.dateLabel(rec.date, false)} · ${FG.esc(rec.area)} · ${FG.esc(rec.root_cause_label)}</span></li>`; }).join("") || '<li class="empty">No close matches.</li>'}</ul></div>
    <div class="form-row"><button type="button" class="btn btn-primary" id="logFind">Log this find</button><button type="button" class="btn btn-ghost" id="addFromTriage">Add to the dashboard</button><button type="button" class="btn btn-ghost" id="copyTriage">Copy summary</button></div>`;
  FG.$("#logFind").addEventListener("click", () => V.logFind(r));
  FG.$("#copyTriage").addEventListener("click", () => FG.copy(V.triageSummary(r), "Summary copied"));
  FG.$("#addFromTriage").addEventListener("click", () => EN.startFrom(r.text));
};
V.triageSummary = (r) => `Loose-object find: ${r.text}
Likely source: ${r.area.slice(0, 3).map((x) => `${x.cls} ${FG.pct(x.p)}`).join(", ")}
Likely cause: ${FG.D.cause_meta[r.cause[0].cls]?.label || r.cause[0].cls} (${FG.pct(r.cause[0].p)})
Object: ${r.obj[0].cls}. Severity: ${AI.SEVERITY[r.zone.sev].label}. Zone: ${r.zone.zone}.
Expected to clear: ${Math.round(r.minutes)} min (about ${FG.money(r.cost)}).
Action: ${r.action || "-"}`;

V.logFind = async function (r) {
  const entry = {
    at: new Date().toISOString(), text: r.text, area: r.area[0].cls, areaP: +r.area[0].p.toFixed(3),
    cause: r.cause[0].cls, object: r.obj[0].cls, severity: r.zone.sev, zone: r.zone.zone, minutes: Math.round(r.minutes),
  };
  FG.logged.unshift({ ...entry, local: true });
  V.renderLog();
  let saved = false;
  if (FG.caps.db) {
    try {
      const id = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await FG.caps.db.doc("finds/" + id).set(entry);
      saved = true;
    } catch (e) { /* read-only viewer or offline: stays in this session */ }
  }
  FG.toast(saved ? "<b>Logged</b> to the shared find log." : "<b>Logged</b> for this session. Sign in as an editor to keep it in the shared log.");
};
V.renderLog = function () {
  const list = FG.logged;
  FG.$("#logHint").textContent = FG.caps.db ? "Shared log" : "This session";
  FG.$("#logList").innerHTML = list.length ? list.slice(0, 30).map((e) => `<li><span>${FG.esc(e.text)}</span>
    <span class="similar meta mono" style="color:var(--muted)">${new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${FG.esc(e.area)} (${FG.pct(e.areaP)}) · ${FG.esc(FG.D.cause_meta[e.cause]?.label || e.cause)} · class ${FG.esc(e.severity)}</span></li>`).join("")
    : `<li class="empty">Nothing logged yet. Analyze a find, then press Log this find.</li>`;
};

/* ===================================================================== risk */
V.plan = null;
V.riskInit = function () { V.plan = AI.defaultPlan(); };
V.risk = function () {
  const D = FG.D, R = FG.M.risk;
  if (!V.plan) V.plan = AI.defaultPlan();
  const plan = V.plan;
  /* planner */
  const pa = R.people_areas;
  FG.$("#planner").innerHTML = `
    <label class="scenario" for="waveToggle"><input type="checkbox" id="waveToggle" ${plan.hiringWave ? "checked" : ""}>
      <span><b>Scenario: hiring wave.</b> Six new associates start on Post-marriage nights, days 3 to 5. This is what happened before the October spike.</span></label>
    <h3 class="sub-h">New associates per shift</h3>
    ${pa.map((a) => `<div class="planner-row"><label for="na-${D.areas.indexOf(a)}">${FG.esc(a)} <span class="card-hint">of ${R.associates[a]}</span></label>
      <input type="number" min="0" max="${R.associates[a]}" step="1" id="na-${D.areas.indexOf(a)}" data-area="${FG.esc(a)}" value="${plan.newAssoc[a] || 0}"></div>`).join("")}
    <div class="planner-row"><label for="downIn">Expected downtime per shift (minutes)</label><input type="number" min="0" max="240" step="5" id="downIn" value="${plan.downtime}"></div>
    <button type="button" class="link-btn" id="planReset">Reset to the last two weeks</button>`;
  FG.$("#levers").innerHTML = R.levers.map((lv) => `<div class="lever"><label for="lv-${lv.key}">${FG.esc(shortLever(lv.name))}</label>
    <span class="switch"><input type="checkbox" role="switch" id="lv-${lv.key}" data-lever="${lv.key}" ${plan.slipped[lv.key] ? "" : "checked"}><span></span></span></div>`).join("");
  V.riskOutputs();
};
V.riskOutputs = function () {
  const D = FG.D, plan = V.plan;
  const fc = AI.forecast(plan);
  FGC.heat(fc);
  const basePlan = { ...plan, slipped: {}, hiringWave: false };
  const ref = AI.forecast(basePlan);
  const finds = (fc.avg * fc.vehPerShift * 2) / 100;
  const cost = finds * (FG.M.triage.minutes["*|C"] * 0.5 + FG.M.triage.minutes["*|B"] * 0.5) / 60 * D.plant.labor_rate;
  const diff = fc.avg - ref.avg;
  FG.$("#riskSummary").innerHTML = `
    <div class="tr-tile"><span>Plant forecast, next 7 days</span><b>${FG.fmt(fc.avg, 2)} per 100</b><span>${Math.abs(diff) > 0.005 ? `${diff > 0 ? "+" : ""}${FG.fmt(diff, 2)} vs current plan` : "current plan"}</span></div>
    <div class="tr-tile"><span>Expected finds per day</span><b>${FG.fmt(finds, 1)}</b><span>at ${FG.int(fc.vehPerShift * 2)} vehicles a day</span></div>
    <div class="tr-tile"><span>Expected EOL labor</span><b>${FG.money(cost)} a day</b><span>${FG.money(cost * 365)} a year at this rate</span></div>`;
  /* recommendations */
  const cells = [];
  fc.grid.forEach((row, i) => row.forEach((v, j) => cells.push({ v, area: D.areas[i], slot: fc.slots[j] })));
  cells.sort((a, b) => b.v - a.v);
  const recs = [];
  const slipped = Object.keys(plan.slipped).filter((k) => plan.slipped[k]);
  for (const k of slipped) {
    const lv = FG.M.risk.levers.find((l) => l.key === k);
    const p2 = { ...plan, slipped: { [k]: true }, hiringWave: false };
    const d2 = AI.forecast(p2).avg - ref.avg;
    recs.push(`<b>${FG.esc(shortLever(lv.name))} has slipped.</b> On its own that adds about ${FG.fmt(d2, 2)} per 100 vehicles, roughly ${FG.fmt((d2 * fc.vehPerShift * 2) / 100, 1)} more finds a day. Restore it first: re-audit and retrain the affected lines.`);
  }
  const top = cells[0];
  if (top) {
    const people = FG.M.risk.people_areas.includes(top.area);
    recs.push(`<b>Highest risk: ${FG.esc(top.area)}, ${top.slot.label.endsWith("N") ? "night" : "day"} shift ${FG.weekday(top.slot.iso)} ${FG.dateLabel(top.slot.iso, false)}</b>, ${FG.fmt(top.v, 2)} per 100. ${people ? "Pair new associates with a buddy for the first week and add a clean-before-you-leave audit before each break." : "Review the area's checklist at the start of shift."}`);
  }
  if (plan.hiringWave) recs.push(`<b>Hiring wave on Post-marriage nights.</b> Ask the line lead to brief the six new associates on one-cycle fasteners and the reject bin, and have the supervisor run the clean-before-you-leave check personally on days 3 to 5.`);
  if (!slipped.length) recs.push(`All seven countermeasure levers are in place. Keep the layered audits on schedule: the risk model shows the biggest jump would come from letting ${FG.esc(shortLever(V.biggestLever(plan).name).toLowerCase())} slip.`);
  FG.$("#recs").innerHTML = recs.map((r) => `<li>${r}</li>`).join("");
};
V.biggestLever = function (plan) {
  const ref = AI.forecast({ ...plan, slipped: {}, hiringWave: false }).avg;
  let best = null, bd = -1;
  for (const lv of FG.M.risk.levers) {
    if (lv.key === "L6") continue;   // a design change can't quietly slip
    const d = AI.forecast({ ...plan, slipped: { [lv.key]: true }, hiringWave: false }).avg - ref;
    if (d > bd) { bd = d; best = lv; }
  }
  return best;
};

/* ===================================================================== root cause */
V.rootCause = function () {
  const D = FG.D, range = FG.range();
  const counts = Object.fromEntries(FG.breakdown(range, "root_cause"));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const baseC = Object.fromEntries(FG.breakdown(D.baseRange, "root_cause"));
  const baseT = Object.values(baseC).reduce((a, b) => a + b, 0) || 1;
  const S = FG.summary(range);
  FG.$("#fishHint").textContent = `${FG.int(total)} finds · ${FG.periodLabel(range)}${FG.filterLabel() ? " · " + FG.filterLabel() : ""}`;
  V.drawFishbone(counts, total, baseC, baseT, S);

  /* hours */
  const bins = 21;
  const hb = new Array(bins).fill(0), hn = new Array(bins).fill(0);
  let tb = 0, tn = 0;
  const I = D.incidents;
  FG.each(D.baseRange, (k) => { hb[Math.min(bins - 1, Math.floor(I.h[k] * 2))]++; tb++; });
  FG.each(range, (k) => { hn[Math.min(bins - 1, Math.floor(I.h[k] * 2))]++; tn++; });
  const labels = hb.map((_, i) => (i / 2).toFixed(1));
  FGC.hours(hb.map((v) => v / Math.max(1, tb)), hn.map((v) => v / Math.max(1, tn)), labels,
    [{ label: "1.5", name: "Break" }, { label: "4.0", name: "Lunch" }, { label: "7.0", name: "Break" }, { label: "10.0", name: "Handover" }]);

  /* detection matrix */
  const cols = ["Run 1", "Run 2", "Run 3", "Run 4", "Escaped"];
  const m = D.areas.map(() => [0, 0, 0, 0, 0]), rowT = D.areas.map(() => 0);
  FG.each(range, (k) => {
    const a = D.cats.areaIndex[I.a[k]];
    m[a][Math.min(3, I.vr[k] - 1)]++;
    if (I.es[k]) m[a][4]++;
    rowT[a]++;
  });
  const acc = FG.css("--accent");
  FG.$("#detectMatrix").innerHTML = `<table><thead><tr><th>Area</th>${cols.map((c) => `<th style="text-align:center">${c}</th>`).join("")}<th style="text-align:center">Finds</th></tr></thead><tbody>${
    D.areas.map((a, i) => `<tr><th>${FG.esc(a)}</th>${m[i].map((v, j) => {
      const sh = rowT[i] ? v / rowT[i] : 0;
      const alpha = Math.min(0.85, sh * (j === 4 ? 8 : 1.1));
      return `<td style="background:color-mix(in srgb, ${j === 4 ? FG.css("--crit") : acc} ${Math.round(alpha * 100)}%, transparent);color:${alpha > 0.5 ? "#fff" : "var(--ink)"}">${rowT[i] ? FG.pct(sh) : "-"}</td>`;
    }).join("")}<td>${FG.int(rowT[i])}</td></tr>`).join("")}</tbody></table>`;
};

V.drawFishbone = function (counts, total, baseC, baseT, S) {
  const D = FG.D;
  const svg = FG.$("#fishbone");
  const W = 1120, H = 470, spineY = 235, headX = 940;
  const t = FGC.t();
  const branches = {};
  for (const [c, meta] of Object.entries(D.cause_meta)) (branches[meta.branch] ||= []).push(c);
  const measurement = [
    { label: "Found late, only at the EOL drive test", static: true },
    { label: `First-run detection ${FG.pct(S.firstRun)}`, static: true },
    { label: `Internal objects take ${FG.fmt(S.internalRuns, 1)} VDT runs`, static: true },
    { label: "Detection relies on the technician's hearing", static: true },
  ];
  const att = [330, 610, 890];
  const bone = (x, sign, name, items) => {
    const yEnd = spineY - sign * 190, xEnd = x - 70;
    let g = `<line x1="${x}" y1="${spineY}" x2="${xEnd}" y2="${yEnd}" stroke="${t.ink2}" stroke-width="2"/>`;
    g += `<rect x="${xEnd - 74}" y="${sign > 0 ? yEnd - 34 : yEnd + 4}" width="148" height="30" rx="7" fill="${t.accentSoft}" stroke="${t.accent}" stroke-width="1"/>`;
    g += `<text x="${xEnd}" y="${sign > 0 ? yEnd - 14 : yEnd + 24}" text-anchor="middle" font-family="${FG.css("--font-display")}" font-weight="700" font-size="15" letter-spacing="1" fill="${t.accent}">${name.toUpperCase()}</text>`;
    items.forEach((it, i) => {
      const dd = 32 + i * 38;
      const y = spineY - sign * dd;
      const bx = x - 70 * dd / 190;
      const n = it.static ? null : (counts[it.key] || 0);
      const share = n != null && total ? n / total : 0;
      const bshare = it.static ? 0 : (baseC[it.key] || 0) / baseT;
      const label = it.static ? it.label : D.cause_meta[it.key].label;
      g += `<line x1="${bx - 14}" y1="${y}" x2="${bx}" y2="${y}" stroke="${t.line2}" stroke-width="1"/>`;
      g += `<text x="${bx - 20}" y="${y - 2}" text-anchor="end" font-size="11.5" fill="${it.static ? t.muted : t.ink}">${FG.esc(label)}</text>`;
      if (!it.static) {
        const bw = Math.max(2, Math.round(share * 150));
        g += `<rect x="${bx - 20 - bw}" y="${y + 4}" width="${bw}" height="5" rx="2" fill="${t.accent}" opacity="0.75"/>`;
        g += `<text x="${bx - 20 - bw - 5}" y="${y + 10}" text-anchor="end" font-size="10.5" fill="${t.ink2}">${FG.int(n)} · ${FG.pct(share)}${bshare ? ` (was ${FG.pct(bshare)})` : ""}</text>`;
      }
    });
    return g;
  };
  let g = `<line x1="20" y1="${spineY}" x2="${headX}" y2="${spineY}" stroke="${t.ink}" stroke-width="3"/>
    <polygon points="${headX},${spineY - 8} ${headX + 14},${spineY} ${headX},${spineY + 8}" fill="${t.ink}"/>
    <rect x="${headX + 18}" y="${spineY - 62}" width="${W - headX - 22}" height="124" rx="10" fill="${t.ink}"/>
    <text x="${headX + 18 + (W - headX - 22) / 2}" y="${spineY - 32}" text-anchor="middle" font-size="11" fill="${t.surface}" opacity=".7" letter-spacing="1">EFFECT</text>
    <text x="${headX + 18 + (W - headX - 22) / 2}" y="${spineY - 6}" text-anchor="middle" font-size="15" font-weight="600" fill="${t.surface}">Loose objects</text>
    <text x="${headX + 18 + (W - headX - 22) / 2}" y="${spineY + 14}" text-anchor="middle" font-size="15" font-weight="600" fill="${t.surface}">at VDT</text>
    <text x="${headX + 18 + (W - headX - 22) / 2}" y="${spineY + 40}" text-anchor="middle" font-size="12" fill="${t.surface}" opacity=".8">${FG.int(total)} finds · ${FG.fmt(S.per100, 2)} per 100</text>`;
  const items = (b) => (b === "Measurement" ? measurement : (branches[b] || []).map((key) => ({ key })).sort((x, y) => (counts[y.key] || 0) - (counts[x.key] || 0)));
  BRANCH_ORDER.top.forEach((b, i) => { g += bone(att[i], 1, b, items(b)); });
  BRANCH_ORDER.bottom.forEach((b, i) => { g += bone(att[i], -1, b, items(b)); });
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = g;
};

/* ===================================================================== countermeasures */
V.actions = function () {
  const D = FG.D;
  const steps = FG.M.impact.steps.map((s, i) => {
    const lv = FG.M.risk.levers.find((l) => l.key === s.key);
    return { ...s, short: lv ? shortLever(lv.name) : s.label, launch: lv?.launch };
  });
  FGC.waterfall(steps);
  const total = steps[0].rate - steps[steps.length - 1].rate;
  const dropBy = Object.fromEntries(steps.slice(1).map((s, i) => [s.key, steps[i].rate - s.rate]));
  const levels = ["Eliminate", "Engineer", "Administer", "Detect"];
  FG.$("#levelLegend").innerHTML = levels.map((l) => `<span><span class="level" style="border-color:var(${LEVEL_COLOR[l]});color:var(--ink)">${l}</span></span>`).join("");
  const asOf = FG.state.asOf;
  const rows = D.register.map((r, i) => {
    const launched = D.dates.indexOf(r.launch) <= asOf;
    const drop = r.lever ? dropBy[r.lever] : null;
    const shared = r.lever ? D.register.filter((x) => x.lever === r.lever).length > 1 : false;
    const status = launched ? "Sustaining" : "Planned";
    return `<tr><td class="mono">${i + 1}</td><td>${FG.esc(r.name)}</td><td class="mono">${FG.dateLabel(r.launch, false)}</td>
      <td><span class="level" style="border-color:var(${LEVEL_COLOR[r.level]})">${r.level}</span></td><td>${FG.esc(r.owner)}</td>
      <td><span class="status"><i style="background:var(${launched ? "--good" : "--muted"})"></i>${status}</span></td>
      <td class="num">${drop != null ? `-${FG.fmt(drop, 2)}${shared ? "*" : ""}` : r.key === "cm_bumps" ? "Finds sooner" : r.key === "cm_camera" ? "Clears faster" : "-"}</td></tr>`;
  }).join("");
  const props = D.proposals.map((p, i) => `<tr><td class="mono">${D.register.length + i + 1}</td><td>${FG.esc(p.name)}<div class="card-hint">${FG.esc(p.note)}</div></td><td class="mono">-</td>
    <td><span class="level" style="border-color:var(${LEVEL_COLOR[p.level]})">${p.level}</span></td><td>${FG.esc(p.owner)}</td>
    <td><span class="status"><i style="background:var(${STATUS_COLOR[p.status]})"></i>${p.status}</span></td><td class="num">-</td></tr>`).join("");
  FG.$("#registerTable").innerHTML = `<thead><tr><th>#</th><th>Countermeasure</th><th>Launch</th><th>Control level</th><th>Owner</th><th>Status</th><th class="num">Per 100 removed</th></tr></thead>
    <tbody>${rows}${props}</tbody><tfoot><tr><td colspan="7" class="card-hint">* Launched the same day as another countermeasure, so the model credits the pair together. Total removed: ${FG.fmt(total, 1)} per 100 vehicles.</td></tr></tfoot>`;
};

/* ===================================================================== cost and roi */
V.roiState = { veh: 1000, before: 20, after: 1, minB: 30, minA: 15, rate: 28, days: 365, capex: 900000, removes: 100, escCost: 0, escYear: 0 };
V.roiInit = function () {
  const f = FG.$("#roiForm");
  const s = V.roiState;
  const row = (id, label, v, step = "any") => `<div class="roi-row"><label for="roi-${id}">${label}</label><input type="number" id="roi-${id}" data-k="${id}" value="${v}" step="${step}" min="0"></div>`;
  f.innerHTML = `<div class="roi-group">Volume</div>${row("veh", "Vehicles per day", s.veh, 10)}${row("days", "Production days per year", s.days, 1)}
    <div class="roi-group">Loose objects per 100 vehicles</div>${row("before", "Before the program", s.before, 0.1)}${row("after", "After the program", s.after, 0.1)}
    <div class="roi-group">Technician time per find (repair plus one VDT run)</div>${row("minB", "Before, minutes", s.minB, 1)}${row("minA", "After, minutes", s.minA, 1)}
    <div class="roi-group">Labor</div>${row("rate", "EOL technician rate, $ per hour", s.rate, 1)}`;
  const capex = FG.$("#capex");
  capex.innerHTML = `<form class="roi-form" id="capexForm" novalidate>
      ${row("capex", "Investment, $", s.capex, 1000)}${row("removes", "Share of remaining finds it would remove, %", s.removes, 5)}
      ${row("escYear", "Customer escapes per year it would prevent", s.escYear, 1)}${row("escCost", "Cost of one escape, $ (warranty, service, goodwill)", s.escCost, 50)}
    </form><div id="capexOut"></div>`;
  const on = (e) => { const k = e.target.dataset.k; if (!k) return; V.roiState[k] = Math.max(0, Number(e.target.value) || 0); V.roi(); };
  f.addEventListener("input", on);
  FG.$("#capexForm").addEventListener("input", on);
  FG.$("#roiFromData").addEventListener("click", () => {
    const D = FG.D;
    const B = FG.summary(D.baseRange, { area: "all", shift: "all" });
    const S = FG.summary([D.sustainIdx, FG.state.asOf], { area: "all", shift: "all" });
    Object.assign(V.roiState, { veh: Math.round(B.veh / B.days), before: +B.per100.toFixed(1), after: +S.per100.toFixed(2), minB: Math.round(B.minutes), minA: Math.round(S.minutes) });
    V.roiInit(); V.roi();
    FG.toast("Filled from the dataset: baseline and sustain averages.");
  });
};
V.roi = function () {
  const s = V.roiState;
  const findsB = (s.veh * s.before) / 100, findsA = (s.veh * s.after) / 100;
  const dayB = findsB * (s.minB / 60) * s.rate, dayA = findsA * (s.minA / 60) * s.rate;
  const yrB = dayB * s.days, yrA = dayA * s.days, save = yrB - yrA;
  FG.$("#roiOut").innerHTML = `
    <div class="kpi"><span class="kpi-label">Before, per year</span><span class="kpi-value">${FG.money(yrB)}</span><span class="kpi-delta"><span>${FG.int(findsB)} finds a day × ${s.minB} min = ${FG.money(dayB)} a day</span></span></div>
    <div class="kpi"><span class="kpi-label">After, per year</span><span class="kpi-value">${FG.money(yrA)}</span><span class="kpi-delta"><span>${FG.fmt(findsA, 1)} finds a day × ${s.minA} min = ${FG.money(dayA)} a day</span></span></div>
    <div class="kpi"><span class="kpi-label">Saved per year</span><span class="kpi-value" style="color:var(--good-ink)">${FG.money(save)}</span><span class="kpi-delta"><span>EOL labor only. Leaves out long teardowns, parts, VDT capacity and escapes.</span></span></div>`;
  FGC.roi(yrB, yrA);
  const benefit = yrA * (s.removes / 100) + s.escYear * s.escCost;
  const years = benefit > 0 ? s.capex / benefit : Infinity;
  const ok = years <= 3;
  const needEsc = Math.max(0, (s.capex / 3 - yrA * (s.removes / 100)));
  FG.$("#capexOut").innerHTML = `<div class="capex-verdict${ok ? " ok" : ""}">
      <span class="kpi-label">Simple payback</span>
      <b>${isFinite(years) ? (years >= 100 ? "Over 100 years" : FG.fmt(years, years < 10 ? 1 : 0) + " years") : "Never"}</b>
      <span>The option would save about ${FG.money(benefit)} a year: ${FG.money(yrA * (s.removes / 100))} of remaining EOL labor${s.escYear && s.escCost ? ` plus ${FG.money(s.escYear * s.escCost)} of prevented escapes` : ""}.</span>
      <span class="card-hint">To pay back in 3 years it would also need to prevent about ${FG.money(needEsc)} a year of escape cost. That is the number to bring to the capital review.</span>
    </div>`;
};

/* ===================================================================== data and models */
V.tablePage = 0;
V.tableRows = [];
V.data = function () {
  const q = (FG.$("#tableSearch").value || "").trim().toLowerCase();
  const range = FG.range();
  const rows = [];
  const I = FG.D.incidents;
  FG.each(range, (k) => {
    if (q) {
      const hay = (I.tx[k] + " " + FG.D.cats.station[I.st[k]] + " " + I.vin[k] + " " + FG.D.cats.object[I.o[k]]).toLowerCase();
      if (!hay.includes(q)) return;
    }
    rows.push(k);
  });
  rows.reverse();
  V.tableRows = rows;
  const per = 20, pages = Math.max(1, Math.ceil(rows.length / per));
  V.tablePage = Math.min(V.tablePage, pages - 1);
  const slice = rows.slice(V.tablePage * per, V.tablePage * per + per);
  FG.$("#recordTable").innerHTML = `<thead><tr><th>ID</th><th>Date</th><th>Area</th><th>Object</th><th>Root cause</th><th>Zone</th><th>Class</th><th class="num">Runs</th><th class="num">Min</th><th>Description</th></tr></thead><tbody>${
    slice.map((k) => { const r = FG.record(k); return `<tr${/^(NEW|CSV)-/.test(r.id) ? ' class="row-new"' : ""}><td class="mono">${r.id}${/^(NEW|CSV)-/.test(r.id) ? '<div><span class="tag tag-ai">Added</span></div>' : ""}</td><td class="mono">${FG.dateLabel(r.date, false)} ${r.shift[0]}</td><td>${FG.esc(r.area)}<div class="card-hint mono">${FG.esc(r.station)}</div></td><td>${FG.esc(r.object)}</td><td>${FG.esc(r.root_cause_label)}</td><td>${FG.esc(r.zone)}</td><td>${r.severity}</td><td class="num">${r.vdt_runs}</td><td class="num">${FG.fmt(r.minutes, 0)}</td><td class="card-hint" style="max-width:340px">${FG.esc(r.description)}</td></tr>`; }).join("")
    || `<tr><td colspan="10" class="empty">No records match. Clear the search or widen the period.</td></tr>`}</tbody>`;
  FG.$("#pager").innerHTML = `<span>${FG.int(rows.length)} records · page ${V.tablePage + 1} of ${pages}</span><div>
    <button type="button" class="btn btn-ghost" data-page="-1" ${V.tablePage === 0 ? "disabled" : ""}>Previous</button>
    <button type="button" class="btn btn-ghost" data-page="1" ${V.tablePage >= pages - 1 ? "disabled" : ""}>Next</button></div>`;
};
V.csvOf = function (ks) {
  const cols = ["id", "date", "shift", "hour_of_shift", "area", "station", "object_category", "object", "material", "root_cause", "zone", "severity", "vdt_runs", "minutes", "teardown", "escaped_to_customer", "vehicle_model", "vin", "description"];
  const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...ks.map((k) => { const r = FG.record(k); return cols.map((c) => q(r[c])).join(","); })].join("\n");
};

V.modelCards = function () {
  const m = FG.M.metrics, t = m.triage, r = m.risk;
  const steps = FG.M.impact.steps;
  FG.$("#modelCards").innerHTML = `
    <div class="mcard"><h3>1. Triage: reads a technician's description</h3>
      <p>TF-IDF on words and word pairs (${FG.int(FG.M.triage.vocab.length)} terms) into multinomial logistic regression with three heads. Tested on ${FG.int(t.area.test_rows)} records it never saw.</p>
      <div class="metric-row">
        <span class="metric">Source area <b>${FG.pct(t.area.top1_accuracy)}</b> top-1, <b>${FG.pct(t.area.top3_accuracy)}</b> top-3</span>
        <span class="metric">Root cause <b>${FG.pct(t.root_cause.top1_accuracy)}</b> top-1, <b>${FG.pct(t.root_cause.top3_accuracy)}</b> top-3</span>
        <span class="metric">Object <b>${FG.pct(t.object_category.top1_accuracy)}</b> top-1</span></div></div>
    <div class="mcard"><h3>2. Risk: predicts loose objects per area and shift</h3>
      <p>Poisson regression with vehicles as exposure. Inputs: area, night shift, new associates, downtime, and how far each of ${FG.M.risk.levers.length} countermeasure levers has ramped. Used for the outlook, the what-if levers and the anomaly alerts.</p>
      <div class="metric-row"><span class="metric">Deviance explained <b>${FG.fmt(r.d2_random_holdout, 2)}</b> on a 20% hold-out</span>
        <span class="metric">Last 4 weeks: off by <b>${FG.fmt(r.daily_rate_mae_holdout, 2)}</b> per 100 a day on an actual <b>${FG.fmt(r.holdout_mean_rate, 2)}</b></span></div></div>
    <div class="mcard"><h3>3. Anomaly alerts and impact</h3>
      <p>An area and shift is flagged when its count is very unlikely under the risk model's expectation (Poisson tail under 0.1%, at least 4 finds). The waterfall runs the same model lever by lever: ${FG.fmt(steps[0].rate, 1)} down to ${FG.fmt(steps[steps.length - 1].rate, 2)} per 100.</p></div>
    <p class="card-hint">${FG.esc(FG.M.trained_on)}. All synthetic, calibrated to a real loose-object program. Retrain on plant data with <span class="mono">python models/train.py</span>.</p>`;
};

V.importInit = function () {
  FG.$("#importBox").innerHTML = `
    <p>Load a CSV of your own loose-object finds. Only a date and a description are required. The triage model fills in any missing area, root cause or object, so free-text logs work too.</p>
    <div class="dropzone" id="dropzone">
      <strong>Drop a CSV here</strong><span class="card-hint">or</span>
      <label class="btn btn-ghost" for="csvFile">Choose a file</label><input type="file" id="csvFile" accept=".csv,text/csv" class="sr">
    </div>
    <div class="form-row"><button type="button" class="btn btn-ghost" id="copyTemplate">Copy the CSV template</button>
      <button type="button" class="btn btn-ghost" id="restoreDemo" hidden>Back to the demo data</button></div>
    <p class="card-hint" id="importNote">Columns: date, shift, area, root_cause, object_category, zone, minutes, description. Your file stays in this browser.</p>`;
};
