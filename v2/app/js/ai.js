/* FOD Guard AI: browser inference for the models trained in models/train.py.
   1. Triage text classifier (TF-IDF + multinomial logistic regression, 3 heads)
   2. BM25 retrieval of similar past finds
   3. Poisson risk model (forecast, what-if, anomaly detection)               */
"use strict";

const AI = (window.AI = {});

/* ================================================================ triage */
AI.tokenize = (text) => (String(text).toLowerCase().match(/\b\w\w+\b/g) || []);

AI.vectorize = function (text) {
  const T = FG.M.triage;
  if (!T._index) T._index = new Map(T.vocab.map((t, i) => [t, i]));
  const toks = AI.tokenize(text);
  const grams = toks.slice();
  for (let i = 0; i < toks.length - 1; i++) grams.push(toks[i] + " " + toks[i + 1]);
  const tf = new Map();
  for (const g of grams) {
    const j = T._index.get(g);
    if (j !== undefined) tf.set(j, (tf.get(j) || 0) + 1);
  }
  const vec = new Map();
  let norm = 0;
  for (const [j, c] of tf) {
    const v = (1 + Math.log(c)) * T.idf[j];
    vec.set(j, v);
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [j, v] of vec) vec.set(j, v / norm);
  return vec;
};

AI.head = function (vec, name) {
  const H = FG.M.triage.heads[name];
  const z = H.intercept.map((b, c) => {
    let s = b;
    for (const [j, v] of vec) s += v * H.coef[c][j];
    return s;
  });
  const mx = Math.max(...z);
  const e = z.map((v) => Math.exp(v - mx));
  const tot = e.reduce((a, b) => a + b, 0);
  return H.classes.map((cls, c) => ({ cls, p: e[c] / tot, c })).sort((a, b) => b.p - a.p);
};

AI.explain = function (vec, name, c, n = 6) {
  const H = FG.M.triage.heads[name];
  const T = FG.M.triage;
  const contrib = [];
  for (const [j, v] of vec) contrib.push({ term: T.vocab[j], w: v * H.coef[c][j] });
  return contrib.filter((x) => x.w > 0.02).sort((a, b) => b.w - a.w).slice(0, n);
};

const ZONE_RULES = [
  { re: /\b(hv|high.voltage|battery area|battery pack|battery enclosure)\b/, zone: "HV battery area", sev: "A" },
  { re: /\bpedal/, zone: "Pedal box", sev: "A" },
  { re: /\bdoor\b/, zone: "Door cavity", sev: "B" },
  { re: /\b(ip|dash|instrument panel)\b/, zone: "IP / dash cavity", sev: "B" },
  { re: /\bconsole\b/, zone: "Center console", sev: "B" },
  { re: /\b(sill|rocker)\b/, zone: "Rocker / sill cavity", sev: "B" },
  { re: /\b(underbody|subframe|cradle)\b/, zone: "Underbody / subframe", sev: "B" },
  { re: /\b(seat)\b/, zone: "Seat track area", sev: "C" },
  { re: /\b(trunk|frunk)\b/, zone: "Trunk / frunk", sev: "C" },
  { re: /\b(floor|carpet)\b/, zone: "Floor pan, under carpet", sev: "C" },
];
AI.SEVERITY = {
  A: { label: "Class A, safety critical", color: "--crit" },
  B: { label: "Class B, internal", color: "--serious" },
  C: { label: "Class C, external", color: "--warn" },
};
AI.zoneOf = function (text) {
  const t = String(text).toLowerCase();
  for (const r of ZONE_RULES) if (r.re.test(t)) return { zone: r.zone, sev: r.sev, known: true };
  return { zone: "Not stated", sev: "B", known: false };
};

AI.PLAYBOOK = {
  extra_in_hand: { action: "Check the station's point-of-use rack and rolling work seat are in use, and remind the associate: one cycle's fasteners only.", cm: "cm_magnetic" },
  left_at_break: { action: "Confirm the clean-before-you-leave check ran before the last break or handover on this line.", cm: "cm_clean" },
  rejected_manual: { action: "Rejected bolts go in the red reject bin before the next shot. Coach the associate and check the bin is at the station.", cm: "cm_magnetic" },
  robot_drop: { action: "Pull the robot fault log for this shift and confirm the rejected bolt was removed before restart.", cm: "cm_robot" },
  clip_broken: { action: "Check clip part number and revision. Broken clips after the redesign go to design engineering as a quality alert.", cm: "cm_clip" },
  clip_dropped: { action: "Spare clips should stay on the magnetic tray, not in pockets. Check the station layout.", cm: "cm_magnetic" },
  zip_tail: { action: "Tie tails go in the waste pouch, not the cavity. Add this station to the next clean-before-you-leave audit.", cm: "cm_clean" },
  tool_forgotten: { action: "Check the shadow board for the station. A missing tool shape means search the vehicle before release.", cm: "cm_shadow" },
  paint_fixture: { action: "Check the paint jig and fixture checklist for this body. Every fixture is counted back before the body moves.", cm: "cm_paint" },
  eol_leftover: { action: "Ask the repair technician to rerun the post-repair exit checklist, and check the tool count.", cm: "cm_eolcheck" },
  biw_slag: { action: "Send the find to the body shop through the daily quality meeting with the cavity location.", cm: "cm_tier" },
  supplier_sealed: { action: "Quarantine the module lot, photograph the part, and add the find to the supplier SCAR.", cm: "cm_scar" },
  housekeeping: { action: "Raise at the daily quality meeting: tacky mats and no food near the vehicle.", cm: "cm_tier" },
  personal: { action: "Raise at the daily quality meeting: personal items stay in lockers.", cm: "cm_tier" },
};

AI.triage = function (text) {
  const vec = AI.vectorize(text);
  if (!vec.size) return null;
  const area = AI.head(vec, "area");
  const obj = AI.head(vec, "object_category");
  const cause = AI.head(vec, "root_cause");
  const z = AI.zoneOf(text);
  const mins = FG.M.triage.minutes[`${obj[0].cls}|${z.sev}`] ?? FG.M.triage.minutes[`*|${z.sev}`] ?? 15;
  const meta = FG.D.cause_meta[cause[0].cls] || {};
  const play = AI.PLAYBOOK[cause[0].cls] || {};
  const reg = FG.D.register.find((r) => r.key === play.cm);
  return {
    text, vec, area, obj, cause, zone: z,
    minutes: mins, cost: (mins / 60) * FG.D.plant.labor_rate,
    causeLabel: meta.label || cause[0].cls, branch: meta.branch,
    action: play.action, countermeasure: reg,
    why: AI.explain(vec, "area", area[0].c),
    whyCause: AI.explain(vec, "root_cause", cause[0].c, 4),
    confidence: area[0].p,
  };
};

/* ================================================================ BM25 */
AI.bm25 = null;
AI.buildBM25 = function () {
  const tx = FG.D.incidents.tx;
  const docs = tx.map((t) => AI.tokenize(t));
  const df = new Map();
  const tfs = docs.map((d) => {
    const m = new Map();
    for (const t of d) m.set(t, (m.get(t) || 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
    return m;
  });
  const N = docs.length;
  const avg = docs.reduce((a, d) => a + d.length, 0) / N;
  const idf = new Map();
  for (const [t, n] of df) idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  const post = new Map();
  tfs.forEach((m, i) => { for (const [t, f] of m) { if (!post.has(t)) post.set(t, []); post.get(t).push([i, f]); } });
  AI.bm25 = { post, idf, len: docs.map((d) => d.length), avg };
};
AI.similar = function (text, k = 3, preferRecent = true) {
  if (!AI.bm25) AI.buildBM25();
  const { post, idf, len, avg } = AI.bm25;
  const k1 = 1.4, b = 0.75;
  const score = new Map();
  for (const t of new Set(AI.tokenize(text))) {
    const p = post.get(t);
    if (!p) continue;
    const w = idf.get(t);
    for (const [i, f] of p) score.set(i, (score.get(i) || 0) + w * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * len[i]) / avg)));
  }
  const asOf = FG.state.asOf;
  const res = [];
  for (const [i, s] of score) {
    if (FG.D.incidents.d[i] > asOf) continue;
    res.push([i, s + (preferRecent ? FG.D.incidents.d[i] / FG.D.nDates * 0.3 : 0)]);
  }
  res.sort((a, b) => b[1] - a[1]);
  // keep distinct descriptions
  const seen = new Set(), out = [];
  for (const [i, s] of res) {
    const key = FG.D.incidents.tx[i];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ k: i, score: s });
    if (out.length >= k) break;
  }
  return out;
};

/* ================================================================ risk model */
AI.progressAt = function (leverKey, iso) {
  const R = FG.M.risk;
  const lv = R.levers.find((l) => l.key === leverKey);
  const t = (Date.parse(iso + "T12:00:00Z") - Date.parse(lv.launch + "T12:00:00Z")) / 864e5;
  return t < 0 ? 0 : 1 - Math.exp(-t / R.ramp_tau_days);
};
AI.progressAll = function (iso) {
  const out = {};
  for (const lv of FG.M.risk.levers) out[lv.key] = AI.progressAt(lv.key, iso);
  return out;
};

// predicted loose objects per 100 vehicles for one area and shift
AI.riskRate = function (area, night, newShare, downtimeMin, progress) {
  const R = FG.M.risk, c = R.coef;
  let z = R.intercept;
  if (area !== R.areas[0]) z += c["area:" + area] || 0;
  z += (c.night || 0) * (night ? 1 : 0);
  if (R.people_areas.includes(area)) z += (c.new_assoc_x_people_areas || 0) * newShare;
  z += (c.downtime_hr || 0) * (downtimeMin / 60);
  for (const lv of R.levers) {
    const k = `${lv.key}x${area}`;
    if (k in c) z += c[k] * progress[lv.key];
  }
  return Math.exp(z);
};

// Poisson upper tail P(X >= n)
AI.poissonTail = function (n, lam) {
  if (n <= 0) return 1;
  let term = Math.exp(-lam), cdf = term;
  for (let i = 1; i < n; i++) { term *= lam / i; cdf += term; }
  return Math.max(0, 1 - cdf);
};

AI.alerts = null;
AI.computeAlerts = function () {
  const D = FG.D, out = [];
  for (let d = 0; d < D.nDates; d++) {
    const iso = D.dates[d];
    const prog = AI.progressAll(iso);
    for (let a = 0; a < D.areas.length; a++) {
      for (let s = 0; s < 2; s++) {
        const n = D.areaCount[d][a][s];
        if (n < 4) continue;
        const rate = AI.riskRate(D.areas[a], s, D.newShare[d][a][s], D.downtime[d][s], prog);
        const lam = (rate * D.veh[d][s]) / 100;
        const p = AI.poissonTail(n, lam);
        if (p < 0.001) out.push({ d, a, s, n, lam, p, ratio: n / Math.max(lam, 0.05), newShare: D.newShare[d][a][s] });
      }
    }
  }
  AI.alerts = out.sort((x, y) => y.d - x.d || x.p - y.p);
};
AI.alertsIn = function (range) {
  if (!AI.alerts) AI.computeAlerts();
  const st = FG.state;
  return AI.alerts.filter((x) => x.d >= range[0] && x.d <= range[1] &&
    (st.area === "all" || x.a === Number(st.area)) && (st.shift === "all" || x.s === Number(st.shift)));
};
AI.alertCauses = function (al) {
  // top causes on that area, date and shift
  const D = FG.D, I = D.incidents, cnt = {};
  for (let k = D.firstOfDate[al.d]; k < D.firstOfDate[al.d + 1]; k++) {
    if (D.cats.areaIndex[I.a[k]] !== al.a || I.s[k] !== al.s) continue;
    const c = D.cats.root_cause[I.rc[k]];
    cnt[c] = (cnt[c] || 0) + 1;
  }
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]);
};

/* ---------------------------------------------------------------- forecast */
AI.defaultPlan = function () {
  const D = FG.D, R = FG.M.risk, asOf = FG.state.asOf;
  const lookback = [Math.max(0, asOf - 13), asOf];
  const typicalNew = {}, typicalDown = [0, 0];
  for (const a of D.areas) {
    const ai = D.areas.indexOf(a);
    let s = 0, n = 0;
    for (let d = lookback[0]; d <= lookback[1]; d++) { s += D.newShare[d][ai][0] + D.newShare[d][ai][1]; n += 2; }
    typicalNew[a] = Math.round((s / n) * (R.associates[a] || 0));
  }
  for (let d = lookback[0]; d <= lookback[1]; d++) { typicalDown[0] += D.downtime[d][0]; typicalDown[1] += D.downtime[d][1]; }
  const days = lookback[1] - lookback[0] + 1;
  return {
    newAssoc: typicalNew,
    downtime: Math.round((typicalDown[0] + typicalDown[1]) / (2 * days)),
    hiringWave: false,
    slipped: {},
  };
};

AI.forecast = function (plan) {
  const D = FG.D, R = FG.M.risk;
  const start = FG.addDays(D.dates[FG.state.asOf], 1);
  const slots = [];
  for (let i = 0; i < 7; i++) {
    const iso = FG.addDays(start, i);
    for (const s of [0, 1]) slots.push({ iso, s, label: `${FG.weekday(iso)} ${s ? "N" : "D"}` });
  }
  const vehPerShift = D.plant.jph * (D.plant.shift_hours - plan.downtime / 60);
  const grid = D.areas.map((area) => slots.map((sl, j) => {
    const prog = AI.progressAll(sl.iso);
    for (const k of Object.keys(plan.slipped)) if (plan.slipped[k]) prog[k] = 0;
    let nw = (plan.newAssoc[area] || 0) / Math.max(1, R.associates[area] || 1);
    const day = Math.floor(j / 2);
    if (plan.hiringWave && area === "Post-marriage" && sl.s === 1 && day >= 2 && day <= 4) nw += 6 / R.associates[area];
    return AI.riskRate(area, sl.s, Math.min(0.6, nw), plan.downtime, prog);
  }));
  const plantBySlot = slots.map((_, j) => grid.reduce((a, row) => a + row[j], 0));
  const avg = plantBySlot.reduce((a, b) => a + b, 0) / plantBySlot.length;
  return { slots, grid, plantBySlot, avg, vehPerShift };
};
