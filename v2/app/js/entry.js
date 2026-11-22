/* FOD Guard entry: add new data (AI-guided find intake, shift numbers, CSV upload)
   and merge it into every view. Saved in the shared database when available,
   otherwise in this browser. */
"use strict";

const EN = (window.EN = {
  finds: [],        // finds logged with the AI helper
  batches: [],      // CSV uploads: { id, name, at, rows: [...] }
  shifts: {},       // shift numbers keyed "date|shift"
  mode: "session",  // "db", "local" or "session"
  db: null,
  draft: null,
  step: null,
});

const EN_LS = "fodguard.added.v1";
const EN_COL = { finds: "added_finds", batches: "added_batches", shifts: "added_shifts" };
const EN_CARS = 500;     // 50 an hour x 10 hours
const EN_STOPS = 30;     // minutes of unplanned stops per shift
const EN_ZONES = ["Floor pan, under carpet", "Seat track area", "Door cavity", "IP / dash cavity", "Center console",
  "Trunk / frunk", "Rocker / sill cavity", "Underbody / subframe", "HV battery area", "Pedal box"];
const EN_MATERIAL = { Fasteners: "metallic", "Tools and fixtures": "metallic", "Weld slag": "metallic",
  "Push clips": "plastic", "Zip ties": "plastic", "Personal items": "plastic", "Dirt and debris": "organic" };
const EN_DEFAULT_OBJ = { "Push clips": "push clip", "Zip ties": "zip-tie tail", "Tools and fixtures": "tool",
  "Weld slag": "weld slag", "Dirt and debris": "debris", "Personal items": "personal item", Fasteners: "fastener" };
const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/* ------------------------------------------------------------------ dates */
EN.today = () => new Date().toLocaleDateString("en-CA");                // local YYYY-MM-DD
EN.nowShift = () => { const h = new Date().getHours(); return h >= 6 && h < 18 ? 0 : 1; };
EN.minDate = () => FG.RAW.dates[0];
EN.maxDate = () => { const t = EN.today(), last = FG.RAW.dates[FG.RAW.dates.length - 1]; return t > last ? t : last; };
EN.dayLabel = (iso) => `${FG.weekday(iso)} ${FG.dateLabel(iso, false)}`;
EN.validDate = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso >= EN.minDate() && iso <= EN.maxDate();
EN.uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ------------------------------------------------------------------ merge into the dashboard */
EN.allFinds = () => [...EN.finds, ...EN.batches.flatMap((b) => (b.rows || []).map((r, i) => ({ ...r, id: `${b.id}-${i + 1}`, nid: `CSV-${String(b.id).slice(-4).toUpperCase()}-${i + 1}`, batch: b.id, source: "CSV " + b.name })))];

EN.rebuild = function () {
  if (!FG.RAW || FG.replaced) return;
  const R = FG.RAW;
  const finds = EN.allFinds().filter((f) => EN.validDate(f.date) && R.areas.includes(f.area));
  const shifts = Object.values(EN.shifts).filter((s) => EN.validDate(s.date));
  let last = R.dates[R.dates.length - 1];
  for (const x of [...finds, ...shifts]) if (x.date > last) last = x.date;
  const dates = R.dates.slice();
  while (dates[dates.length - 1] < last) dates.push(FG.addDays(dates[dates.length - 1], 1));
  const di = new Map(dates.map((d, i) => [d, i]));
  const cats = JSON.parse(JSON.stringify(R.cats));
  const code = (k, v) => { let i = cats[k].indexOf(v); if (i < 0) { cats[k].push(v); i = cats[k].length - 1; } return i; };

  // incidents: base rows, then added rows, re-sorted by date
  const keys = Object.keys(R.incidents);
  const inc = {};
  keys.forEach((k) => { inc[k] = R.incidents[k].slice(); });
  inc.bk = inc.d.map((_, k) => k);
  inc.nid = inc.d.map(() => "");
  for (const f of finds) {
    inc.d.push(di.get(f.date)); inc.s.push(f.shift ? 1 : 0); inc.h.push(f.hour ?? 5); inc.a.push(code("area", f.area));
    inc.st.push(code("station", f.station || `${R.area_codes[f.area]}-NA`)); inc.oc.push(code("object_category", f.objCat));
    inc.o.push(code("object", f.object || EN_DEFAULT_OBJ[f.objCat] || f.objCat)); inc.m.push(code("material", EN_MATERIAL[f.objCat] || "metallic"));
    inc.rc.push(code("root_cause", f.cause)); inc.z.push(code("zone", f.zone)); inc.sv.push(code("severity", f.sev || "B"));
    inc.vr.push(Number(f.run) || 1); inc.mn.push(Number(f.minutes) || 15); inc.td.push(0); inc.es.push(0); inc.tn.push(0);
    inc.vm.push(f.model === "Crossover" ? 1 : 0); inc.vin.push(f.vin || "-"); inc.tx.push(f.text || "(no description)");
    inc.bk.push(-1); inc.nid.push(f.nid || "NEW-" + String(f.id).slice(-6).toUpperCase());
  }
  if (finds.length) {
    const n = inc.d.length;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => inc.d[a] - inc.d[b] || a - b);
    Object.keys(inc).forEach((k) => { const col = inc[k]; inc[k] = order.map((i) => col[i]); });
  }

  // shift rows: new dates start with no cars until a shift has finds or numbers
  const sh = {};
  Object.keys(R.shifts).forEach((k) => { sh[k] = R.shifts[k].slice(); });
  const rowOf = new Map();
  for (let k = 0; k < sh.d.length; k++) rowOf.set(`${sh.d[k]}|${sh.s[k]}|${sh.a[k]}`, k);
  const ensure = (d, s) => R.areas.forEach((_, a) => {
    const key = `${d}|${s}|${a}`;
    if (rowOf.has(key)) return;
    rowOf.set(key, sh.d.length);
    sh.d.push(d); sh.s.push(s); sh.a.push(a); sh.v.push(0); sh.dt.push(0); sh.nw.push(0.08); sh.n.push(0);
  });
  for (let d = R.dates.length; d < dates.length; d++) { ensure(d, 0); ensure(d, 1); }
  const setShift = (d, s, cars, stops, nw) => R.areas.forEach((_, a) => {
    const k = rowOf.get(`${d}|${s}|${a}`);
    sh.v[k] = cars; sh.dt[k] = stops; if (nw != null) sh.nw[k] = nw;
  });
  const withNumbers = new Set(shifts.map((x) => `${x.date}|${x.shift}`));
  for (const f of finds) {
    const d = di.get(f.date), s = f.shift ? 1 : 0;
    if (d >= R.dates.length && !withNumbers.has(`${f.date}|${s}`) && !sh.v[rowOf.get(`${d}|${s}|0`)]) setShift(d, s, EN_CARS, EN_STOPS, null);
  }
  for (const x of shifts) setShift(di.get(x.date), x.shift ? 1 : 0, Number(x.cars) || EN_CARS, Number(x.stops) || 0, x.newShare != null ? Number(x.newShare) : null);
  for (const f of finds) {
    const k = rowOf.get(`${di.get(f.date)}|${f.shift ? 1 : 0}|${R.areas.indexOf(f.area)}`);
    sh.n[k] += 1;
  }

  const keepAsOf = FG.state.asOf;
  const wasLast = !FG.D || keepAsOf >= FG.D.nDates - 1;
  FG.decode({ ...R, dates, cats, incidents: inc, shifts: sh });
  if (!wasLast) FG.state.asOf = Math.min(keepAsOf, FG.D.nDates - 1);
  FG.refresh();
  EN.renderList();
};

/* ------------------------------------------------------------------ storage */
EN.init = function (db) {
  EN.db = db || null;
  if (EN.db) {
    EN.mode = "db";
    let pending = 0;
    const timer = setTimeout(() => { if (EN.mode === "db") FG.$("#enStoreNote").textContent = "Shared database not reachable yet. New entries stay in this session."; }, 10000);
    const sched = () => { clearTimeout(pending); pending = setTimeout(EN.rebuild, 120); };
    const sub = (kind, apply) => {
      try {
        EN.db.collection(EN_COL[kind]).onSnapshot((snap) => {
          clearTimeout(timer);
          apply(snap.docs.map((d) => d.data()).filter(Boolean));
          sched();
        }, () => { clearTimeout(timer); EN.mode = "session"; EN.renderList(); });
      } catch (e) { EN.mode = "session"; }
    };
    sub("finds", (rows) => { EN.finds = rows.sort((a, b) => String(a.at).localeCompare(String(b.at))); });
    sub("batches", (rows) => { EN.batches = rows.sort((a, b) => String(a.at).localeCompare(String(b.at))); });
    sub("shifts", (rows) => { EN.shifts = Object.fromEntries(rows.map((r) => [`${r.date}|${r.shift}`, r])); });
  } else {
    try {
      const raw = localStorage.getItem(EN_LS);
      EN.mode = "local";
      if (raw) {
        const o = JSON.parse(raw);
        EN.finds = o.finds || []; EN.batches = o.batches || []; EN.shifts = o.shifts || {};
        if (EN.allFinds().length || Object.keys(EN.shifts).length) EN.rebuild();
      }
    } catch (e) { EN.mode = "session"; }
  }
  EN.renderList();
};

EN.persistLocal = function () {
  if (EN.mode !== "local") return;
  try { localStorage.setItem(EN_LS, JSON.stringify({ finds: EN.finds, batches: EN.batches, shifts: EN.shifts })); }
  catch (e) { EN.mode = "session"; }
};

EN.put = async function (kind, obj) {
  if (kind === "finds") EN.finds = [...EN.finds.filter((x) => x.id !== obj.id), obj];
  else if (kind === "batches") EN.batches = [...EN.batches.filter((x) => x.id !== obj.id), obj];
  else EN.shifts = { ...EN.shifts, [`${obj.date}|${obj.shift}`]: obj };
  EN.rebuild();
  if (EN.mode === "db") {
    try { await EN.db.doc(`${EN_COL[kind]}/${obj.id}`).set(obj); return true; }
    catch (e) { EN.mode = "session"; EN.renderList(); FG.toast("Saved for this session only. Your account can't write to the shared database here."); return false; }
  }
  EN.persistLocal();
  return true;
};

EN.drop = async function (kind, id) {
  if (kind === "finds") EN.finds = EN.finds.filter((x) => x.id !== id);
  else if (kind === "batches") EN.batches = EN.batches.filter((x) => x.id !== id);
  else EN.shifts = Object.fromEntries(Object.entries(EN.shifts).filter(([, v]) => v.id !== id));
  EN.rebuild();
  if (EN.mode === "db") { try { await EN.db.doc(`${EN_COL[kind]}/${id}`).delete(); } catch (e) { /* stays removed in this session */ } }
  EN.persistLocal();
};

EN.clearAll = async function () {
  const jobs = [
    ...EN.finds.map((x) => ["finds", x.id]),
    ...EN.batches.map((x) => ["batches", x.id]),
    ...Object.values(EN.shifts).map((x) => ["shifts", x.id]),
  ];
  EN.finds = []; EN.batches = []; EN.shifts = {};
  EN.rebuild();
  if (EN.mode === "db") for (const [k, id] of jobs) { try { await EN.db.doc(`${EN_COL[k]}/${id}`).delete(); } catch (e) { /* ignore */ } }
  EN.persistLocal();
  FG.toast("Your entries are removed. The dashboard is back to the demo data.");
};

/* ------------------------------------------------------------------ reading a description */
EN.parseDate = function (t) {
  const today = EN.today();
  if (/\btoday\b|\bthis (morning|afternoon|evening)\b|\btonight\b|\bjust now\b/.test(t)) return today;
  if (/\byesterday\b|\blast night\b/.test(t)) return FG.addDays(today, -1);
  const iso = t.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (iso) return iso[0];
  const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  const pad = (x) => String(x).padStart(2, "0");
  if (m) return `${today.slice(0, 4)}-${pad(EN_MONTHS.indexOf(m[1]) + 1)}-${pad(m[2])}`;
  const s = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (s) return `${s[3] ? (s[3].length === 2 ? "20" + s[3] : s[3]) : today.slice(0, 4)}-${pad(s[1])}-${pad(s[2])}`;
  const wd = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd) {
    const want = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(wd[1]);
    for (let i = 0; i < 7; i++) { const d = FG.addDays(today, -i); if (new Date(d + "T12:00:00Z").getUTCDay() === want) return d; }
  }
  return null;
};

EN.parse = function (text, d) {
  const t = String(text || "").toLowerCase();
  const set = (k, v) => { if (v == null || v === "" || d.src[k] === "you") return; d[k] = v; d.src[k] = "text"; };
  const date = EN.parseDate(t);
  if (date && EN.validDate(date)) set("date", date);
  if (/\bnight\b|\bnights\b|\bsecond shift\b|\b2nd shift\b|\bgraveyard\b|\btonight\b|\blast night\b/.test(t)) set("shift", 1);
  else if (/\bday shift\b|\bfirst shift\b|\b1st shift\b|\bmorning\b|\bafternoon\b/.test(t)) set("shift", 0);
  let run = null;
  const r1 = t.match(/\brun\s*(?:#|no\.?\s*)?(\d)\b/);
  if (r1) run = Number(r1[1]);
  const r2 = t.match(/\b(first|second|third|fourth|1st|2nd|3rd|4th)\s+(?:vdt\s+|drive\s+test\s+)?(?:run|pass)\b/);
  if (r2) run = { first: 1, second: 2, third: 3, fourth: 4, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4 }[r2[1]];
  if (run) set("run", Math.min(4, Math.max(1, run)));
  const mm = t.match(/\b(\d{1,3})\s*(?:min|mins|minute|minutes)\b/);
  if (mm) set("minutes", Number(mm[1]));
  else { const hh = t.match(/\b(\d(?:\.\d)?)\s*(?:h|hr|hrs|hour|hours)\b/); if (hh) set("minutes", Math.round(Number(hh[1]) * 60)); }
  const z = AI.zoneOf(t);
  if (z.known) set("zone", z.zone);
  const ft = t.match(/\b(bolt|nut|screw|washer)s?\b/);
  if (ft) set("fastType", ft[1]);
  const fs = t.match(/\bm\s?(4|5|6|8|10|12|14|16)(?:\s?x\s?\d+)?\b/);
  if (fs) set("fastSize", "M" + fs[1]);
  if (/damaged thread|cross[- ]?thread|stripped/.test(t)) d.damaged = true;
  const vin = String(text || "").match(/\bvin\s*[:#]?\s*([a-z0-9]{6,17})\b/i);
  if (vin) set("vin", vin[1].toUpperCase());
  if (/\bcrossover\b|\bsuv\b|\bmodel y\b/.test(t)) set("model", "Crossover");
  else if (/\bsedan\b|\bmodel 3\b/.test(t)) set("model", "Sedan");

  const tr = AI.triage(d.text);
  if (tr) {
    d.ai = { area: tr.area.slice(0, 3), obj: tr.obj.slice(0, 3), cause: tr.cause.slice(0, 3), minutes: Math.round(tr.minutes) };
    if (d.src.area !== "you") { d.area = tr.area[0].cls; d.areaP = tr.area[0].p; d.src.area = "ai"; }
    if (d.src.objCat !== "you") { d.objCat = tr.obj[0].cls; d.objP = tr.obj[0].p; d.src.objCat = "ai"; }
    if (d.src.cause !== "you") { d.cause = tr.cause[0].cls; d.causeP = tr.cause[0].p; d.src.cause = "ai"; }
  }
  if (ft && d.src.objCat !== "you") { d.objCat = "Fasteners"; d.objP = Math.max(d.objP || 0, 0.99); d.src.objCat = "text"; }
};

EN.objectName = function (d) {
  if (d.objCat === "Fasteners") {
    const type = d.fastType || "fastener";
    const size = d.fastSize && d.fastSize !== "Not sure" ? d.fastSize + " " : "";
    return `${size}${type}${d.damaged ? " with damaged thread" : ""}`;
  }
  // closest existing object name of the same kind that shares words with the description
  const R = FG.RAW, words = new Set(AI.tokenize(d.text));
  let best = null, score = 0;
  R.cats.object.forEach((name, i) => {
    if (EN.objCatOf[i] !== d.objCat) return;
    const s = AI.tokenize(name).filter((w) => words.has(w)).length;
    if (s > score) { score = s; best = name; }
  });
  return best || EN_DEFAULT_OBJ[d.objCat] || "object";
};

/* ------------------------------------------------------------------ the questions */
const EN_STEPS = [
  { key: "date", need: (d) => !d.date, q: () => "When was it found?",
    choices: () => [0, 1, 2, 3, 4].map((i) => FG.addDays(EN.today(), -i)).filter(EN.validDate).map((iso, i) => ({ label: i === 0 ? `Today, ${EN.dayLabel(iso)}` : i === 1 ? `Yesterday, ${EN.dayLabel(iso)}` : EN.dayLabel(iso), value: iso })),
    free: (d, t) => { const v = EN.parseDate(t.toLowerCase()); if (v && EN.validDate(v)) { d.date = v; return true; } return false; } },
  { key: "shift", need: (d) => d.shift == null, q: () => "Which shift?",
    choices: (d) => { const now = d.date === EN.today() ? EN.nowShift() : -1; const c = [{ label: "Day shift" + (now === 0 ? " (now)" : ""), value: 0 }, { label: "Night shift" + (now === 1 ? " (now)" : ""), value: 1 }]; return now === 1 ? c.reverse() : c; },
    free: (d, t) => { if (/night|second|2nd/.test(t)) { d.shift = 1; return true; } if (/day|first|1st|morning/.test(t)) { d.shift = 0; return true; } return false; } },
  { key: "zone", need: (d) => !d.zone, q: () => "Where in the car did the technician find it?",
    choices: () => EN_ZONES.map((z) => ({ label: z, value: z })),
    free: (d, t) => { const z = AI.zoneOf(t); if (z.known) { d.zone = z.zone; return true; } return false; } },
  { key: "objCat", need: (d) => !d.objCat || (d.src.objCat === "ai" && (d.objP || 0) < 0.7), q: () => "What kind of object was it? I'm not sure from the description.",
    choices: (d) => { const top = (d.ai?.obj || []).map((o) => ({ label: `${o.cls} (${FG.pct(o.p)})`, value: o.cls })); const rest = FG.RAW.cats.object_category.filter((c) => !top.some((x) => x.value === c)).map((c) => ({ label: c, value: c })); return [...top, ...rest]; },
    free: (d, t) => { const c = FG.RAW.cats.object_category.find((x) => t.includes(x.toLowerCase().replace(/s$/, ""))); if (c) { d.objCat = c; return true; } if (/bolt|nut|screw|washer/.test(t)) { d.objCat = "Fasteners"; return true; } return false; } },
  { key: "fastType", need: (d) => d.objCat === "Fasteners" && !d.fastType, q: () => "What kind of fastener?",
    choices: () => ["bolt", "nut", "screw", "washer"].map((x) => ({ label: x[0].toUpperCase() + x.slice(1), value: x })),
    free: (d, t) => { const m = t.match(/bolt|nut|screw|washer/); if (m) { d.fastType = m[0]; return true; } return false; } },
  { key: "fastSize", need: (d) => d.objCat === "Fasteners" && !d.fastSize, q: (d) => `What size is the ${d.fastType || "fastener"}?`,
    choices: () => ["M5", "M6", "M8", "M10", "M12", "Not sure"].map((x) => ({ label: x, value: x })),
    free: (d, t) => { const m = t.match(/m\s?(\d{1,2})/); if (m) { d.fastSize = "M" + m[1]; return true; } if (/not sure|don.?t know|unknown/.test(t)) { d.fastSize = "Not sure"; return true; } return false; } },
  { key: "area", need: (d) => !d.area || (d.src.area === "ai" && (d.areaP || 0) < 0.6), q: (d) => (d.ai ? "Which line do you think it came from? These are the model's best guesses." : "Which line do you think it came from?"),
    choices: (d) => (d.ai ? [...d.ai.area.map((a) => ({ label: `${a.cls} (${FG.pct(a.p)})`, value: a.cls })), { label: "Not sure, keep the model's guess", value: "__keep" }] : FG.RAW.areas.map((a) => ({ label: a, value: a }))),
    free: (d, t) => { const a = FG.RAW.areas.find((x) => t.includes(x.toLowerCase())); if (a) { d.area = a; return true; } return false; } },
  { key: "cause", need: (d) => !d.cause || (d.src.cause === "ai" && (d.causeP || 0) < 0.5), q: () => "What's the most likely cause? Pick the closest.",
    choices: (d) => (d.ai ? [...d.ai.cause.map((c) => ({ label: FG.RAW.cause_meta[c.cls]?.label || c.cls, value: c.cls })), { label: "Not sure, keep the model's guess", value: "__keep" }] : FG.RAW.cats.root_cause.map((c) => ({ label: FG.RAW.cause_meta[c]?.label || c, value: c }))),
    free: () => false },
  { key: "run", need: (d) => !d.run, q: () => "Which VDT run found it?",
    choices: () => [1, 2, 3, 4].map((n) => ({ label: n === 4 ? "Run 4 or later" : `Run ${n}`, value: n })),
    free: (d, t) => { const m = t.match(/\d/); if (m) { d.run = Math.min(4, Number(m[0])); return true; } return false; } },
  { key: "minutes", need: (d) => d.minutes == null, q: () => "About how long did it take to find and remove?",
    choices: (d) => { const est = d.ai?.minutes || 15; return [{ label: `About ${est} min (model estimate)`, value: est }, ...[10, 15, 20, 30, 45, 60].filter((x) => x !== est).map((x) => ({ label: `${x} min`, value: x }))]; },
    free: (d, t) => { const m = t.match(/(\d{1,3})/); if (m) { d.minutes = Number(m[1]); return true; } return false; } },
];

/* ------------------------------------------------------------------ chat */
EN.msg = function (html, who = "ai") {
  const box = FG.$("#enChat");
  const div = document.createElement("div");
  div.className = "msg " + (who === "user" ? "msg-user" : "msg-ai");
  div.innerHTML = html;
  box.appendChild(div);
  box.hidden = false;
  box.scrollTop = box.scrollHeight;
  return div;
};

EN.start = function (text) {
  text = (text ?? FG.$("#enText").value).trim();
  if (!text) { FG.toast("Type or say what was found first."); FG.$("#enText").focus(); return; }
  if (!FG.D || !FG.M) return;
  EN.draft = { text, src: {}, damaged: false };
  FG.$("#enChat").innerHTML = "";
  FG.$("#enConfirm").hidden = true;
  EN.msg(FG.esc(text), "user");
  EN.parse(text, EN.draft);
  EN.summary();
  EN.next();
};

EN.summary = function () {
  const d = EN.draft, items = [];
  const tag = (k, p) => (d.src[k] === "ai" ? `<span class="en-src">model ${FG.pct(p)}</span>` : `<span class="en-src">from your words</span>`);
  if (d.date) items.push(`Date: <b>${EN.dayLabel(d.date)}</b> ${tag("date")}`);
  if (d.shift != null) items.push(`Shift: <b>${d.shift ? "Night" : "Day"}</b> ${tag("shift")}`);
  if (d.zone) items.push(`Where in the car: <b>${FG.esc(d.zone)}</b> ${tag("zone")}`);
  if (d.objCat) items.push(`Object: <b>${FG.esc(d.objCat)}</b>${d.fastSize || d.fastType ? ` (${FG.esc([d.fastSize, d.fastType].filter(Boolean).join(" "))})` : ""} ${tag("objCat", d.objP)}`);
  if (d.area) items.push(`Likely source: <b>${FG.esc(d.area)}</b> ${tag("area", d.areaP)}`);
  if (d.cause) items.push(`Likely cause: <b>${FG.esc(FG.RAW.cause_meta[d.cause]?.label || d.cause)}</b> ${tag("cause", d.causeP)}`);
  if (d.run) items.push(`VDT run: <b>${d.run}</b> ${tag("run")}`);
  if (d.minutes != null) items.push(`Time to clear: <b>${d.minutes} min</b> ${tag("minutes")}`);
  EN.msg(`Here's what I picked up:<ul class="en-got">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`);
};

EN.next = function () {
  const d = EN.draft;
  const step = EN_STEPS.find((s) => !d.asked?.[s.key] && s.need(d));
  EN.step = step || null;
  const ans = FG.$("#enAnswer");
  if (!step) { ans.hidden = true; EN.confirm(); return; }
  EN.msg(FG.esc(step.q(d)));
  FG.$("#enChoices").innerHTML = step.choices(d).map((c, i) => `<button type="button" class="chip${i === 0 ? " chip-first" : ""}" data-i="${i}">${FG.esc(c.label)}</button>`).join("");
  EN.choiceList = step.choices(d);
  FG.$("#enAnswerText").value = "";
  ans.hidden = false;
};

EN.answer = function (value, label, isFree) {
  const d = EN.draft, step = EN.step;
  if (!d || !step) return;
  d.asked = d.asked || {};
  if (isFree && /^\s*(not sure|don.?t know|no idea|skip|unknown)\b/i.test(label)) {
    // "not sure": keep the model's guess, or take the most likely choice
    const ch = step.choices(d);
    const pick = ch.find((c) => c.value === "__keep" || c.value === "Not sure") || ch[0];
    return EN.answer(pick.value, `${label} (${pick.value === "__keep" ? "keeping the model's guess" : pick.label})`, false);
  }
  if (isFree) {
    EN.msg(FG.esc(label), "user");
    if (!step.free(d, String(label).toLowerCase())) {
      // not a direct answer: treat it as more description and read it again
      d.text = `${d.text}. ${label}`;
      EN.parse(label, d);
      d.text = d.text.replace(/\.\s*$/, "");
      if (step.need(d)) { EN.msg("I didn't catch that. Tap one of the choices, or try different words."); return; }
    }
    d.src[step.key] = "you";
  } else {
    EN.msg(FG.esc(label), "user");
    if (value !== "__keep") { d[step.key] = value; d.src[step.key] = "you"; }
    if (step.key === "objCat" && value !== "Fasteners") { d.fastType = null; d.fastSize = null; }
  }
  d.asked[step.key] = true;
  EN.next();
};

EN.confirm = function () {
  const d = EN.draft, R = FG.RAW;
  const object = EN.objectName(d);
  const sev = AI.zoneOf(d.zone || "").sev;
  const code = R.area_codes[d.area];
  const stations = R.cats.station.filter((s) => s.startsWith(code + "-")).sort();
  const opt = (arr, cur) => arr.map((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${FG.esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${FG.esc(l)}</option>`; }).join("");
  const aiHint = (k, p) => (d.src[k] === "ai" ? ` <span class="en-src">model ${FG.pct(p)}</span>` : "");
  EN.msg("I have everything. Check the details and save.");
  const f = FG.$("#enConfirm");
  f.innerHTML = `
    <div class="en-grid">
      <label><span class="en-lab">Date</span><input type="date" name="date" value="${d.date}" min="${EN.minDate()}" max="${EN.maxDate()}" required></label>
      <label><span class="en-lab">Shift</span><select name="shift">${opt([[0, "Day"], [1, "Night"]], d.shift)}</select></label>
      <label><span class="en-lab">Line it came from${aiHint("area", d.areaP)}</span><select name="area">${opt(R.areas, d.area)}</select></label>
      <label><span class="en-lab">Station</span><select name="station">${opt([[`${code}-NA`, "Not recorded"], ...stations], `${code}-NA`)}</select></label>
      <label><span class="en-lab">Where in the car</span><select name="zone">${opt(EN_ZONES, d.zone)}</select></label>
      <label><span class="en-lab">Object type${aiHint("objCat", d.objP)}</span><select name="objCat">${opt(R.cats.object_category, d.objCat)}</select></label>
      <label><span class="en-lab">Object</span><input type="text" name="object" value="${FG.esc(object)}"></label>
      <label><span class="en-lab">Likely cause${aiHint("cause", d.causeP)}</span><select name="cause">${opt(R.cats.root_cause.map((c) => [c, R.cause_meta[c]?.label || c]), d.cause)}</select></label>
      <label><span class="en-lab">VDT run</span><select name="run">${opt([[1, "1"], [2, "2"], [3, "3"], [4, "4 or later"]], d.run)}</select></label>
      <label><span class="en-lab">Minutes to clear</span><input type="number" name="minutes" min="1" max="600" value="${d.minutes}"></label>
      <label><span class="en-lab">Vehicle</span><select name="model">${opt(["Sedan", "Crossover"], d.model || "Sedan")}</select></label>
      <label><span class="en-lab">VIN (optional)</span><input type="text" name="vin" value="${FG.esc(d.vin || "")}" placeholder="Scan or type"></label>
      <label class="en-wide"><span class="en-lab">Description</span><textarea name="text" rows="2">${FG.esc(d.text)}</textarea></label>
    </div>
    <p class="card-hint" id="enSevNote">Severity from the location: <b>${FG.esc(AI.SEVERITY[sev].label)}</b>.</p>
    <div class="form-row"><button type="submit" class="btn btn-primary">Save to the dashboard</button><button type="button" class="btn btn-ghost" id="enRestart">Start over</button></div>`;
  f.hidden = false;
  f.zone.addEventListener("change", () => { FG.$("#enSevNote").innerHTML = `Severity from the location: <b>${FG.esc(AI.SEVERITY[AI.zoneOf(f.zone.value).sev].label)}</b>.`; });
  f.area.addEventListener("change", () => {
    const c = R.area_codes[f.area.value];
    f.station.innerHTML = opt([[`${c}-NA`, "Not recorded"], ...R.cats.station.filter((s) => s.startsWith(c + "-")).sort()], `${c}-NA`);
  });
  f.scrollIntoView({ block: "nearest", behavior: "smooth" });
};

EN.save = async function (form) {
  const v = (n) => form[n].value;
  const date = v("date");
  if (!EN.validDate(date)) { FG.toast(`Pick a date between ${FG.dateLabel(EN.minDate())} and ${FG.dateLabel(EN.maxDate())}.`); return; }
  const shift = Number(v("shift"));
  let hour = 5;
  if (date === EN.today() && shift === EN.nowShift()) { const n = new Date(); hour = Math.min(10.5, Math.max(0, ((n.getHours() - 6 + 24) % 12) + n.getMinutes() / 60)); }
  const zone = v("zone");
  const find = {
    id: EN.uid("f"), at: new Date().toISOString(), source: "AI helper",
    date, shift, hour: Math.round(hour * 100) / 100, area: v("area"), station: v("station"), zone, sev: AI.zoneOf(zone).sev,
    objCat: v("objCat"), object: v("object").trim() || EN_DEFAULT_OBJ[v("objCat")], cause: v("cause"),
    run: Number(v("run")) || 1, minutes: Math.max(1, Number(v("minutes")) || 15), model: v("model"), vin: v("vin").trim(),
    text: v("text").trim() || EN.draft.text,
    ai: { area: EN.draft.areaP ?? null, objCat: EN.draft.objP ?? null, cause: EN.draft.causeP ?? null },
  };
  form.hidden = true;
  await EN.put("finds", find);
  EN.msg(`<b>Saved.</b> ${FG.esc(find.object)} in ${FG.esc(find.zone.toLowerCase())}, ${FG.esc(find.area)}, ${EN.dayLabel(find.date)} ${find.shift ? "night" : "day"} shift. Every view now includes it.
    <div class="chips en-after"><button type="button" class="chip" data-go="data-models">See it in Data and models</button><button type="button" class="chip" data-go="overview">Back to Overview</button><button type="button" class="chip" data-go="again">Log another find</button></div>`);
  FG.$("#enText").value = "";
  EN.draft = null;
};

/* ------------------------------------------------------------------ shift numbers */
EN.saveShift = async function (form) {
  const date = form.sDate.value;
  if (!EN.validDate(date)) { FG.toast(`Pick a date between ${FG.dateLabel(EN.minDate())} and ${FG.dateLabel(EN.maxDate())}.`); return; }
  const shift = Number(form.sShift.value);
  const cars = Math.round(Number(form.sCars.value));
  const stops = Math.max(0, Number(form.sStops.value) || 0);
  const newPct = Math.min(60, Math.max(0, Number(form.sNew.value) || 0));
  if (!(cars > 0 && cars <= 600)) { FG.toast("Cars built should be between 1 and 600 for one shift (50 an hour, 10.5 hours at most)."); return; }
  await EN.put("shifts", { id: `${date}_${shift}`, date, shift, cars, stops, newShare: newPct / 100, at: new Date().toISOString() });
  FG.toast(`<b>Saved.</b> ${EN.dayLabel(date)}, ${shift ? "night" : "day"} shift: ${cars} cars, ${stops} min of stops.`);
};

/* ------------------------------------------------------------------ CSV */
EN.TEMPLATE = () => {
  const t = EN.today();
  return `date,shift,area,object_category,object,zone,vdt_run,minutes,description
${t},Day,Marriage,Zip ties,zip-tie tail,IP / dash cavity,2,22,Rattle at bump section; zip-tie tail behind IP near harness
${t},Day,,,,,,,Clicking under driver seat; M8 nut on floor pan after break
${t},Night,EOL repair,Tools and fixtures,spanner,Floor pan under carpet,1,15,Spanner on rear floor after repair`;
};

EN.importCSV = async function (file) {
  const note = FG.$("#enCsvNote");
  try {
    const text = await file.text();
    const rows = FG.parseCSV(text);
    const head = rows.shift().map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const col = (n) => head.indexOf(n);
    if (col("date") < 0 || col("description") < 0) throw new Error("the file needs at least a date column and a description column");
    if (rows.length > 500) throw new Error("upload up to 500 rows at a time");
    const out = [];
    let filled = 0, skipped = 0;
    for (const r of rows) {
      const get = (n) => (col(n) >= 0 ? String(r[col(n)] || "").trim() : "");
      const date = get("date").slice(0, 10), desc = get("description");
      if (!EN.validDate(date) || !desc) { skipped++; continue; }
      const d = { text: desc, src: {}, damaged: false };
      EN.parse(desc, d);
      const area = FG.RAW.areas.find((a) => a.toLowerCase() === get("area").toLowerCase()) || d.area;
      const objCat = FG.RAW.cats.object_category.find((c) => c.toLowerCase() === get("object_category").toLowerCase()) || d.objCat;
      const cause = FG.RAW.cats.root_cause.includes(get("root_cause")) ? get("root_cause") : d.cause;
      const zone = EN_ZONES.find((z) => z.toLowerCase().replace(/[^a-z]/g, "") === get("zone").toLowerCase().replace(/[^a-z]/g, "")) || d.zone || "Floor pan, under carpet";
      if (!get("area") || !get("object_category") || !get("zone")) filled++;
      if (!area || !objCat || !cause) { skipped++; continue; }
      d.objCat = objCat;
      out.push({
        date, shift: /night|2|second/i.test(get("shift")) ? 1 : 0, hour: 5, area, station: get("station") || "", zone, sev: AI.zoneOf(zone).sev,
        objCat, object: get("object") || EN.objectName(d), cause, run: Number(get("vdt_run")) || d.run || 1,
        minutes: Number(get("minutes")) || d.minutes || d.ai?.minutes || 15, model: "Sedan", vin: get("vin"), text: desc,
      });
    }
    if (!out.length) throw new Error(`no usable rows. Dates must be YYYY-MM-DD between ${EN.minDate()} and ${EN.maxDate()}`);
    const batch = { id: EN.uid("b"), name: file.name, at: new Date().toISOString(), rows: out };
    await EN.put("batches", batch);
    note.textContent = `Added ${out.length} finds from ${file.name}. The AI filled in missing details on ${filled} ${filled === 1 ? "row" : "rows"}.${skipped ? ` Skipped ${skipped} ${skipped === 1 ? "row" : "rows"} with a missing description or a date outside the data.` : ""}`;
    FG.toast(`<b>${out.length} finds added</b> from ${FG.esc(file.name)}. Every view now includes them.`);
  } catch (e) {
    note.textContent = "Couldn't add the file: " + (e.message || e) + ".";
  }
};

/* ------------------------------------------------------------------ list of what was added */
EN.renderList = function () {
  const box = FG.$("#enList");
  if (!box) return;
  const note = { db: "Saved in the shared database. It stays until you remove it.", local: "Saved in this browser. It stays until you remove it.", session: "Kept for this session only." }[EN.mode];
  FG.$("#enStoreNote").textContent = note;
  const finds = EN.finds.slice().reverse();
  const shifts = Object.values(EN.shifts).sort((a, b) => (b.date + b.shift).localeCompare(a.date + a.shift));
  const batches = EN.batches.slice().reverse();
  const rows = [
    ...finds.map((f) => `<tr><td class="mono">${EN.dayLabel(f.date)} ${f.shift ? "N" : "D"}</td><td>${FG.esc(f.object)}</td><td>${FG.esc(f.area)}</td><td>${FG.esc(f.zone)}</td><td class="num">${f.minutes}</td><td><span class="tag tag-ai">AI helper</span></td><td><button type="button" class="link-btn" data-drop="finds" data-id="${FG.esc(f.id)}">Remove</button></td></tr>`),
    ...batches.map((b) => `<tr><td class="mono">${FG.esc(b.rows.length ? EN.dayLabel(b.rows[0].date) : "")}</td><td colspan="4">${b.rows.length} finds from <b>${FG.esc(b.name)}</b></td><td><span class="tag">CSV</span></td><td><button type="button" class="link-btn" data-drop="batches" data-id="${FG.esc(b.id)}">Remove</button></td></tr>`),
    ...shifts.map((s) => `<tr><td class="mono">${EN.dayLabel(s.date)} ${s.shift ? "N" : "D"}</td><td colspan="4">${FG.int(s.cars)} cars built, ${FG.fmt(s.stops, 0)} min of stops, ${FG.pct(s.newShare)} new associates</td><td><span class="tag">Shift</span></td><td><button type="button" class="link-btn" data-drop="shifts" data-id="${FG.esc(s.id)}">Remove</button></td></tr>`),
  ];
  box.innerHTML = rows.length
    ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Object or entry</th><th>Line</th><th>Where</th><th class="num">Min</th><th>Source</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : `<p class="empty">Nothing added yet. Log a find, enter a shift's numbers, or upload a CSV.</p>`;
  FG.$("#enClear").hidden = !rows.length;
};

/* ------------------------------------------------------------------ wiring */
EN.EXAMPLES = [
  "M8 nut under the carpet on the driver side, second run",
  "Zip-tie tail rattling inside the door, night shift",
  "Something loose in the center console, found today",
  "Spanner left on the rear floor after repair, took 12 minutes",
];

EN.wire = function () {
  // object -> category lookup from the base data
  const I = FG.RAW.incidents;
  EN.objCatOf = {};
  for (let k = 0; k < I.o.length; k++) if (!(I.o[k] in EN.objCatOf)) EN.objCatOf[I.o[k]] = FG.RAW.cats.object_category[I.oc[k]];
  FG.$("#enExamples").innerHTML = EN.EXAMPLES.map((e) => `<button type="button" class="chip">${FG.esc(e)}</button>`).join("");
  FG.$("#enExamples").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) { FG.$("#enText").value = b.textContent; EN.start(); } });
  FG.$("#enStart").addEventListener("click", () => EN.start());
  FG.$("#enText").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); EN.start(); } });
  FG.$("#enChoices").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; const c = EN.choiceList[Number(b.dataset.i)]; EN.answer(c.value, c.label, false); });
  FG.$("#enAnswerForm").addEventListener("submit", (e) => { e.preventDefault(); const t = FG.$("#enAnswerText").value.trim(); if (t) EN.answer(null, t, true); });
  FG.$("#enConfirm").addEventListener("submit", (e) => { e.preventDefault(); EN.save(e.target); });
  FG.$("#enConfirm").addEventListener("click", (e) => { if (e.target.id === "enRestart") { FG.$("#enConfirm").hidden = true; FG.$("#enChat").innerHTML = ""; FG.$("#enChat").hidden = true; FG.$("#enAnswer").hidden = true; EN.draft = null; FG.$("#enText").focus(); } });
  FG.$("#enChat").addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (!b) return;
    if (b.dataset.go === "again") { FG.$("#enChat").innerHTML = ""; FG.$("#enChat").hidden = true; FG.$("#enText").focus(); return; }
    if (b.dataset.go === "data-models") { FG.setState({ period: "7", shift: "all", area: "all", asOf: FG.D.nDates - 1 }); FG.$("#tableSearch").value = ""; V.tablePage = 0; }
    FG.go(b.dataset.go);
  });
  // shift numbers
  const sf = FG.$("#enShiftForm");
  sf.sDate.value = EN.today() <= EN.maxDate() ? EN.today() : EN.maxDate();
  sf.sDate.min = EN.minDate(); sf.sDate.max = EN.maxDate();
  sf.sShift.value = String(EN.nowShift());
  sf.addEventListener("submit", (e) => { e.preventDefault(); EN.saveShift(sf); });
  // CSV
  const dz = FG.$("#enDrop");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); const f = e.dataTransfer.files[0]; if (f) EN.importCSV(f); });
  FG.$("#enCsvFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) EN.importCSV(f); e.target.value = ""; });
  FG.$("#enTemplate").addEventListener("click", () => FG.copy(EN.TEMPLATE(), "Template copied. Paste it into a spreadsheet, fill it in, and save as CSV."));
  // list
  FG.$("#enList").addEventListener("click", (e) => { const b = e.target.closest("[data-drop]"); if (b) EN.drop(b.dataset.drop, b.dataset.id); });
  let armed = 0;
  FG.$("#enClear").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (!armed) { btn.textContent = "Click again to remove everything you added"; btn.classList.add("btn-warn"); armed = setTimeout(() => { armed = 0; btn.textContent = "Remove my entries"; btn.classList.remove("btn-warn"); }, 4000); return; }
    clearTimeout(armed); armed = 0; btn.textContent = "Remove my entries"; btn.classList.remove("btn-warn");
    EN.clearAll();
  });
  EN.renderList();
};

EN.startFrom = function (text) {
  FG.go("add-data");
  FG.$("#enText").value = text;
  requestAnimationFrame(() => EN.start(text));
};
