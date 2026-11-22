/* FOD Guard core: data loading, decoding, filters and shared metrics. */
"use strict";

const FG = (window.FG = {
  D: null,          // decoded plant data
  M: null,          // models
  state: { asOf: 0, period: "7", shift: "all", area: "all", view: "overview" },
  logged: [],       // finds logged this session or from the shared log
  caps: {},         // capability namespaces once resolved
  listeners: [],
});

/* ---------------------------------------------------------------- helpers */
FG.$ = (sel, root = document) => root.querySelector(sel);
FG.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
FG.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
FG.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
FG.fmt = (v, d = 1) => (v == null || !isFinite(v) ? "-" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
FG.int = (v) => (v == null || !isFinite(v) ? "-" : Math.round(v).toLocaleString("en-US"));
FG.money = (v) => {
  if (v == null || !isFinite(v)) return "-";
  const a = Math.abs(v);
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + "M";
  if (a >= 1e4) return "$" + Math.round(v / 1e3) + "K";
  return "$" + Math.round(v).toLocaleString("en-US");
};
FG.pct = (v, d = 0) => (v == null || !isFinite(v) ? "-" : (v * 100).toFixed(d) + "%");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
FG.dateLabel = (iso, withYear = true) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? ", " + y : ""}`;
};
FG.addDays = (iso, n) => {
  const t = new Date(iso + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
FG.weekday = (iso) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(iso + "T12:00:00Z").getUTCDay()];

FG.toast = (html, ms = 3600) => {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = html;
  FG.$("#toasts").appendChild(t);
  setTimeout(() => t.remove(), ms);
};
FG.copy = async (text, label = "Copied") => {
  try {
    await navigator.clipboard.writeText(text);
    FG.toast(label);
  } catch (e) {
    FG.toast("Copy was blocked by the browser. Select the text and copy it instead.");
  }
};

FG.areaColor = (i) => FG.css(`--s${i + 1}`);
FG.onChange = (fn) => FG.listeners.push(fn);
FG.emit = () => FG.listeners.forEach((fn) => fn());

/* ---------------------------------------------------------------- loading */
FG.load = async function () {
  const [plant, models] = await Promise.all([
    fetch("data/plant.json").then((r) => {
      if (!r.ok) throw new Error("plant data " + r.status);
      return r.json();
    }),
    fetch("data/models.json").then((r) => {
      if (!r.ok) throw new Error("models " + r.status);
      return r.json();
    }),
  ]);
  FG.M = models;
  FG.RAW = typeof structuredClone === "function" ? structuredClone(plant) : JSON.parse(JSON.stringify(plant));
  FG.decode(plant);
};

FG.decode = function (plant) {
  const D = (FG.D = plant);
  const I = D.incidents;
  D.n = I.d.length;
  D.nDates = D.dates.length;
  D.cats.areaIndex = D.cats.area.map((a) => D.areas.indexOf(a));   // incident area code -> D.areas index
  // vehicles per date and shift (same for every area row)
  D.veh = D.dates.map(() => [0, 0]);
  D.newShare = D.dates.map(() => D.areas.map(() => [0, 0]));
  D.downtime = D.dates.map(() => [0, 0]);
  D.areaCount = D.dates.map(() => D.areas.map(() => [0, 0]));
  const S = D.shifts;
  for (let k = 0; k < S.d.length; k++) {
    D.veh[S.d[k]][S.s[k]] = S.v[k];
    D.newShare[S.d[k]][S.a[k]][S.s[k]] = S.nw[k];
    D.downtime[S.d[k]][S.s[k]] = S.dt[k];
    D.areaCount[S.d[k]][S.a[k]][S.s[k]] = S.n[k];
  }
  // incidents are written in date order: index the first record of each date
  D.firstOfDate = new Array(D.nDates + 1).fill(D.n);
  for (let k = D.n - 1; k >= 0; k--) D.firstOfDate[I.d[k]] = k;
  for (let d = D.nDates - 1; d >= 0; d--) if (D.firstOfDate[d] > D.firstOfDate[d + 1]) D.firstOfDate[d] = D.firstOfDate[d + 1];
  D.rolloutIdx = D.dates.indexOf(D.plant.rollout_start);
  D.sustainIdx = D.dates.indexOf(D.plant.sustain_start);
  D.baseRange = [0, D.rolloutIdx - 1];
  FG.state.asOf = D.nDates - 1;
};

/* ---------------------------------------------------------------- filters */
FG.range = function (period = FG.state.period, asOf = FG.state.asOf) {
  if (period === "all") return [0, asOf];
  const n = Number(period);
  return [Math.max(0, asOf - n + 1), asOf];
};

// iterate incident indices that pass the filters
FG.each = function (range, fn, opts = {}) {
  const D = FG.D, I = D.incidents;
  const shift = opts.shift ?? FG.state.shift;
  const area = opts.area ?? FG.state.area;
  const k0 = D.firstOfDate[range[0]], k1 = D.firstOfDate[range[1] + 1];
  for (let k = k0; k < k1; k++) {
    if (shift !== "all" && I.s[k] !== Number(shift)) continue;
    if (area !== "all" && D.cats.areaIndex[I.a[k]] !== Number(area)) continue;
    fn(k);
  }
};

FG.vehicles = function (range, shift = FG.state.shift) {
  let v = 0;
  for (let d = range[0]; d <= range[1]; d++) {
    if (shift === "all") v += FG.D.veh[d][0] + FG.D.veh[d][1];
    else v += FG.D.veh[d][Number(shift)];
  }
  return v;
};

FG.summary = function (range, opts = {}) {
  const D = FG.D, I = D.incidents;
  let n = 0, mins = 0, run1 = 0, esc = 0, internal = 0, td = 0, runsInt = 0;
  FG.each(range, (k) => {
    n++;
    mins += I.mn[k];
    if (I.vr[k] === 1) run1++;
    if (I.es[k]) esc++;
    const sev = D.cats.severity[I.sv[k]];
    if (sev === "A" || sev === "B") { internal++; runsInt += I.vr[k]; if (I.td[k]) td++; }
  }, opts);
  const veh = FG.vehicles(range, opts.shift ?? FG.state.shift);
  const days = range[1] - range[0] + 1;
  const rate = D.plant.labor_rate;
  return {
    n, veh, days,
    per100: veh ? (n / veh) * 100 : 0,
    perDay: n / days,
    minutes: n ? mins / n : 0,
    costPerDay: (mins / 60) * rate / days,
    firstRun: n ? run1 / n : 0,
    escapes: esc,
    internalRuns: internal ? runsInt / internal : 0,
    teardownShare: internal ? td / internal : 0,
  };
};

FG.breakdown = function (range, field, opts = {}) {
  const D = FG.D, I = FG.D.incidents;
  const counts = {};
  FG.each(range, (k) => {
    let key;
    if (field === "area") key = D.cats.area[I.a[k]];
    else if (field === "object_category") key = D.cats.object_category[I.oc[k]];
    else if (field === "root_cause") key = D.cats.root_cause[I.rc[k]];
    else if (field === "shift") key = I.s[k] ? "Night" : "Day";
    else if (field === "zone") key = D.cats.zone[I.z[k]];
    else if (field === "station") key = D.cats.station[I.st[k]];
    counts[key] = (counts[key] || 0) + 1;
  }, opts);
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
};

FG.daily = function (toIdx = FG.state.asOf, opts = {}) {
  const out = [];
  const D = FG.D;
  const shift = opts.shift ?? FG.state.shift;
  const counts = new Array(D.nDates).fill(0);
  FG.each([0, toIdx], (k) => { counts[D.incidents.d[k]]++; }, opts);
  for (let d = 0; d <= toIdx; d++) {
    const v = shift === "all" ? D.veh[d][0] + D.veh[d][1] : D.veh[d][Number(shift)];
    out.push({ d, date: D.dates[d], n: counts[d], v, rate: v ? (counts[d] / v) * 100 : 0 });
  }
  return out;
};

FG.record = function (k) {
  const D = FG.D, I = D.incidents, C = D.cats;
  return {
    id: (I.nid && I.nid[k]) || "LO-" + String((I.bk ? I.bk[k] : k) + 1).padStart(6, "0"),
    date: D.dates[I.d[k]],
    shift: I.s[k] ? "Night" : "Day",
    hour_of_shift: I.h[k],
    area: C.area[I.a[k]],
    station: C.station[I.st[k]],
    object_category: C.object_category[I.oc[k]],
    object: C.object[I.o[k]],
    material: C.material[I.m[k]],
    root_cause: C.root_cause[I.rc[k]],
    root_cause_label: D.cause_meta[C.root_cause[I.rc[k]]]?.label || C.root_cause[I.rc[k]],
    zone: C.zone[I.z[k]],
    severity: C.severity[I.sv[k]],
    vdt_runs: I.vr[k],
    minutes: I.mn[k],
    teardown: !!I.td[k],
    escaped_to_customer: !!I.es[k],
    associate_tenure_days: I.tn[k],
    vehicle_model: I.vm[k] ? "Crossover" : "Sedan",
    vin: I.vin[k],
    description: I.tx[k],
  };
};

FG.periodLabel = function (range = FG.range()) {
  const D = FG.D;
  if (range[0] === range[1]) return FG.dateLabel(D.dates[range[0]]);
  return `${FG.dateLabel(D.dates[range[0]], false)} to ${FG.dateLabel(D.dates[range[1]])}`;
};
FG.filterLabel = function () {
  const s = FG.state;
  const parts = [];
  if (s.area !== "all") parts.push(FG.D.areas[s.area]);
  if (s.shift !== "all") parts.push(Number(s.shift) ? "Night shift" : "Day shift");
  return parts.join(" · ");
};
FG.phaseOf = function (d) {
  const D = FG.D;
  return d < D.rolloutIdx ? "Baseline" : d < D.sustainIdx ? "Rollout" : "Sustain";
};
