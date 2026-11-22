/* FOD Guard assistant: Claude answers with the dashboard's own data and
   models as tools. Without Claude, a built-in analyst answers common questions. */
"use strict";

const AS = (window.AS = { history: [], busy: false });

const PROMPTS = [
  "Write the shift handover brief for today",
  "What caused the October spike, and how do we stop it happening again?",
  "Draft a short 8D summary of the program for my director",
  "Draft an email to the IP and console supplier about sealed-in screws",
  "What happens if the magnetic racks stop being used?",
  "How do we get from 95% to 99%?",
];

const INSTRUCTIONS = `You are the analyst inside FOD Guard, a loose-object control dashboard for a vehicle General Assembly and End-of-Line operation (two 10.5-hour shifts a day, about 50 vehicles an hour, 100% Vehicle Drive Test). The data is synthetic but calibrated to a real program that cut loose objects from about 20 to about 1 per 100 vehicles in 8 to 9 weeks.
Rules:
- Get every number from the tools. Never invent figures. Say which period a number covers.
- Lead with the answer. Plain words, short sentences, no headings. Short lists are fine.
- Drafts (emails, briefs, 8D summaries) must be ready to send, in a professional manufacturing voice.
- Name the area, shift and cause when you can. Give one concrete next action.
- If the data can't answer, say so and say what data would.`;

function periodRange(p) {
  const D = FG.D;
  if (p === "baseline") return D.baseRange;
  if (p === "rollout") return [D.rolloutIdx, D.sustainIdx - 1];
  if (p === "sustain") return [D.sustainIdx, FG.state.asOf];
  return FG.range(p || FG.state.period);
}
function optsFrom(input) {
  const o = {};
  if (input.area) { const i = FG.D.areas.findIndex((a) => a.toLowerCase() === String(input.area).toLowerCase()); if (i >= 0) o.area = String(i); }
  if (input.shift) o.shift = /night/i.test(input.shift) ? "1" : "0";
  return o;
}

AS.tools = function (log) {
  const D = FG.D;
  const wrap = (name, fn) => (input) => { log.push(name); return fn(input || {}); };
  const periodSchema = { type: "string", enum: ["7", "28", "all", "baseline", "rollout", "sustain"], description: "7 or 28 = last N days up to the as-of date; all = program to date; baseline/rollout/sustain = program phases" };
  return [
    { name: "get_summary", description: "Loose-object KPIs for a period: finds, per 100 vehicles, per day, minutes per find, cost per day, first-run VDT detection, escapes.",
      inputSchema: { type: "object", properties: { period: periodSchema, area: { type: "string" }, shift: { type: "string", enum: ["Day", "Night"] } } },
      execute: wrap("get_summary", (i) => { const r = periodRange(i.period); const s = FG.summary(r, optsFrom(i)); return { period: FG.periodLabel(r), finds: s.n, per100: +s.per100.toFixed(2), perDay: +s.perDay.toFixed(1), minutesPerFind: +s.minutes.toFixed(1), costPerDay: Math.round(s.costPerDay), firstRunDetection: +s.firstRun.toFixed(3), escapes: s.escapes, vehicles: s.veh }; }) },
    { name: "breakdown", description: "Counts of loose objects grouped by area, object_category, root_cause, shift or station for a period (top 10).",
      inputSchema: { type: "object", properties: { by: { type: "string", enum: ["area", "object_category", "root_cause", "shift", "station"] }, period: periodSchema, area: { type: "string" }, shift: { type: "string" } }, required: ["by"] },
      execute: wrap("breakdown", (i) => { const r = periodRange(i.period); const rows = FG.breakdown(r, i.by, optsFrom(i)); const tot = rows.reduce((a, x) => a + x[1], 0); return { period: FG.periodLabel(r), total: tot, rows: rows.slice(0, 10).map(([k, v]) => ({ key: i.by === "root_cause" ? (D.cause_meta[k]?.label || k) : k, finds: v, share: +(v / Math.max(1, tot)).toFixed(3) })) }; }) },
    { name: "list_alerts", description: "Anomaly alerts from the risk model: area-shifts with far more finds than expected.",
      inputSchema: { type: "object", properties: { period: periodSchema } },
      execute: wrap("list_alerts", (i) => { const r = periodRange(i.period || "all"); return AI.alertsIn(r).slice(0, 8).map((a) => ({ date: D.dates[a.d], area: D.areas[a.a], shift: a.s ? "Night" : "Day", observed: a.n, expected: +a.lam.toFixed(1), newAssociateShare: +a.newShare.toFixed(2), topCauses: AI.alertCauses(a).slice(0, 2).map(([c, n]) => ({ cause: D.cause_meta[c]?.label || c, finds: n })) })); }) },
    { name: "forecast", description: "Risk model forecast for the next 7 days. Optionally let countermeasure levers slip, add new associates, or apply the hiring-wave scenario.",
      inputSchema: { type: "object", properties: { slipped_levers: { type: "array", items: { type: "string" }, description: "Lever keys L1-L7 or names" }, hiring_wave: { type: "boolean" }, downtime_min: { type: "number" }, new_associates: { type: "object", description: "area name -> new associates per shift" } } },
      execute: wrap("forecast", (i) => {
        const plan = AI.defaultPlan();
        for (const s of i.slipped_levers || []) { const lv = FG.M.risk.levers.find((l) => l.key === s || l.name.toLowerCase().includes(String(s).toLowerCase())); if (lv) plan.slipped[lv.key] = true; }
        if (i.hiring_wave) plan.hiringWave = true;
        if (i.downtime_min != null) plan.downtime = i.downtime_min;
        Object.assign(plan.newAssoc, i.new_associates || {});
        const fc = AI.forecast(plan), ref = AI.forecast(AI.defaultPlan());
        return { levers: FG.M.risk.levers.map((l) => ({ key: l.key, name: l.name, slipped: !!plan.slipped[l.key] })), plantPer100: +fc.avg.toFixed(2), currentPlanPer100: +ref.avg.toFixed(2), findsPerDay: +((fc.avg * fc.vehPerShift * 2) / 100).toFixed(1), byArea: D.areas.map((a, k) => ({ area: a, per100: +(fc.grid[k].reduce((x, y) => x + y, 0) / fc.grid[k].length).toFixed(3) })) };
      }) },
    { name: "triage_text", description: "Run the triage model on a free-text description of a find.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: wrap("triage_text", (i) => { const r = AI.triage(i.text); if (!r) return { error: "no known words" }; return { area: r.area.slice(0, 3).map((x) => ({ area: x.cls, p: +x.p.toFixed(3) })), cause: r.cause.slice(0, 3).map((x) => ({ cause: D.cause_meta[x.cls]?.label || x.cls, p: +x.p.toFixed(3) })), object: r.obj[0].cls, severity: r.zone.sev, zone: r.zone.zone, minutes: Math.round(r.minutes), action: r.action }; }) },
    { name: "countermeasures", description: "The countermeasure register with launch dates, control levels, owners, the model's estimate of each lever's contribution, and proposals not yet approved.",
      inputSchema: { type: "object", properties: {} },
      execute: wrap("countermeasures", () => ({ steps: FG.M.impact.steps.map((s) => ({ step: s.label, ratePer100After: s.rate, removed: s.drop ?? null })), register: D.register.map((r) => ({ name: r.name, launch: r.launch, level: r.level, owner: r.owner })), proposals: D.proposals })) },
  ];
};

AS.contextNote = function () {
  const b = V.briefData();
  return `[Dashboard state] As of ${b.asOf}. Filters: period ${FG.state.period === "all" ? "program to date" : "last " + FG.state.period + " days"}, ${b.filter}. Phase: ${b.phase}. Current rate ${b.per100} per 100 vehicles (baseline ${b.baselinePer100}).`;
};

AS.init = function () {
  FG.$("#promptChips").innerHTML = PROMPTS.map((p, i) => `<button type="button" class="chip" data-p="${i}">${FG.esc(p)}</button>`).join("");
  FG.$("#promptChips").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) AS.ask(PROMPTS[b.dataset.p]); });
  FG.$("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); const v = FG.$("#chatInput").value.trim(); if (v) { FG.$("#chatInput").value = ""; AS.ask(v); } });
  AS.greet();
};
AS.greet = function () {
  const on = !!FG.caps.sample;
  FG.$("#asstLede").textContent = on
    ? "Ask about the data in plain words. Claude answers using the dashboard's own data and models as tools."
    : "Claude isn't available in this view, so the built-in analyst answers. It handles the suggested questions and simple ones about rates, areas and causes.";
  FG.$("#chat").innerHTML = "";
  AS.bubble("ai", on
    ? "Hi. I can read every record in this dashboard, run the risk model, and triage a description. Try a suggestion below, or ask your own question."
    : "Hi. I'm the built-in analyst. I work from the same data and models. Pick a suggested question below.");
};
AS.bubble = function (who, text, tools) {
  const div = document.createElement("div");
  div.className = "msg msg-" + who;
  div.textContent = text;
  if (tools) { const t = document.createElement("div"); t.className = "msg-tools"; t.textContent = tools; div.appendChild(t); }
  FG.$("#chat").appendChild(div);
  FG.$("#chat").scrollTop = FG.$("#chat").scrollHeight;
  return div;
};

AS.ask = async function (q) {
  if (AS.busy) return;
  AS.busy = true;
  FG.$("#chatSend").disabled = true;
  AS.bubble("user", q);
  const out = AS.bubble("ai", "Thinking...");
  try {
    if (FG.caps.sample) {
      const log = [];
      const first = AS.history.length === 0;
      const content = (first ? INSTRUCTIONS + "\n\n" : "") + q + "\n\n" + AS.contextNote();
      const msgs = [...AS.history.slice(-8), { role: "user", content }];
      const res = await FG.caps.sample(msgs, {
        tools: AS.tools(log), cache: false, modelTier: "default",
        onText: ({ text }) => { out.textContent = text || "Thinking..."; FG.$("#chat").scrollTop = FG.$("#chat").scrollHeight; },
      });
      out.textContent = res.text;
      if (log.length) { const t = document.createElement("div"); t.className = "msg-tools"; t.textContent = "Used: " + [...new Set(log)].join(", "); out.appendChild(t); }
      AS.addCopy(out, res.text);
      AS.history.push({ role: "user", content }, { role: "assistant", content: res.text });
    } else {
      const text = AS.offline(q);
      out.textContent = text;
      AS.addCopy(out, text);
    }
  } catch (e) {
    if (e && e.code === "not_granted") { FG.caps.sample = null; AS.greet(); out.textContent = AS.offline(q); }
    else if (e && e.code === "rate_limited") out.textContent = "Claude is busy right now. Try again in a minute.";
    else out.textContent = "Something went wrong reaching Claude. The built-in analyst says:\n\n" + AS.offline(q);
  } finally {
    AS.busy = false;
    FG.$("#chatSend").disabled = false;
  }
};
AS.addCopy = function (el, text) {
  const b = document.createElement("div");
  b.className = "msg-actions";
  b.innerHTML = `<button type="button" class="link-btn">Copy</button>`;
  b.firstChild.addEventListener("click", () => FG.copy(text, "Answer copied"));
  el.appendChild(b);
};

/* ---------------------------------------------------------------- built-in analyst */
AS.offline = function (q) {
  const D = FG.D, s = q.toLowerCase();
  const b = V.briefData();
  const base = FG.summary(D.baseRange, { area: "all", shift: "all" });
  const now = FG.summary([Math.max(D.sustainIdx, FG.state.asOf - 27), FG.state.asOf], { area: "all", shift: "all" });
  const red = 1 - now.per100 / base.per100;
  if (s.includes("brief") || s.includes("handover")) return V.briefPlain();
  if (s.includes("october") || s.includes("spike")) {
    const al = AI.alertsIn([0, FG.state.asOf]).filter((a) => D.dates[a.d].startsWith("2026-10"));
    if (!al.length) return "No October alerts up to the current as-of date. Move the timeline past October 8 to see them.";
    const a = al.reduce((m, x) => (x.n > m.n ? x : m), al[0]);
    const causes = AI.alertCauses(a).slice(0, 2).map(([c, n]) => `${D.cause_meta[c].label.toLowerCase()} (${n})`).join(" and ");
    return `The risk model flagged ${D.areas[a.a]} on night shift from ${FG.dateLabel(D.dates[al[al.length - 1].d], false)} to ${FG.dateLabel(D.dates[al[0].d], false)}. On the worst shift there were ${a.n} finds against about ${FG.fmt(a.lam, 1)} expected. ${Math.round(a.newShare * 100)}% of the associates on that line were new, and most finds were ${causes}.\n\nWhat it points to: new associates without the clean-before-you-leave habit, and the check before breaks not running.\n\nTo stop it repeating:\n1. When a hiring wave is planned, run it through the Risk outlook first. It flags the shifts at risk before they happen.\n2. Pair new associates with a buddy for their first week.\n3. Have the supervisor run the clean-before-you-leave check personally during the first three nights.`;
  }
  if (s.includes("8d")) {
    const steps = FG.M.impact.steps;
    return `8D summary: loose-object control, General Assembly and EOL\n\nD2 Problem: VDT was finding ${FG.fmt(base.per100, 1)} loose objects per 100 vehicles (about ${Math.round(base.perDay)} a day), costing about ${FG.money(base.costPerDay)} a day in EOL labor.\nD3 Containment: 100% VDT, repeat runs until clear, an NC with photo for every find.\nD4 Root cause: 70% came from the four assembly lines. Main causes: extra fasteners in hand, fasteners left at breaks, broken push clips, zip-tie tails, and EOL repair leftovers.\nD5/D6 Actions: ${steps.slice(1).map((x) => V.shortLever(x.label)).join("; ")}.\nResult: ${FG.fmt(now.per100, 2)} per 100 vehicles over the last 28 days, ${Math.round(red * 100)}% below baseline, and about ${FG.money(now.costPerDay)} a day in labor.\nD7 Sustain: standard work and checklists, daily quality meeting with manager ownership, supplier SCAR closed, PFMEA updated. The risk model watches for spikes.\nD8: Team recognized by the Senior Manager and Director.`;
  }
  if (s.includes("supplier") || s.includes("console") || s.includes("scar")) {
    const sup = FG.breakdown(D.baseRange, "area", { area: "all", shift: "all" }).find((x) => x[0] === "Supplier");
    return `Subject: Loose screws and clips sealed inside IP and console modules\n\nHello,\n\nOur Vehicle Drive Test is finding screws and clips sealed inside the IP and center console modules you supply. Over our four-week baseline that was ${sup ? sup[1] : "a number of"} finds, about 5% of all loose objects at our line, and each one costs a teardown and a repeat drive test.\n\nWe've opened a SCAR. Please:\n1. Contain at your site: add a shake or tilt check before sealing each module.\n2. Send your root cause and corrective action within 10 working days.\n3. Cover the cost of containment and any teardown at our plant until the fix is verified.\n\nWe can share photos, part numbers and dates for every find.\n\nThank you,`;
  }
  if (s.includes("magnetic") || s.includes("rack") || s.includes("slip") || s.includes("stop")) {
    const plan = AI.defaultPlan();
    const ref = AI.forecast(plan).avg;
    plan.slipped.L3 = true;
    const fc = AI.forecast(plan).avg;
    return `If the magnetic chairs and point-of-use racks stop being used, the risk model expects the plant rate to rise from ${FG.fmt(ref, 2)} to about ${FG.fmt(fc, 2)} per 100 vehicles, roughly ${FG.fmt(((fc - ref) * 1000) / 100, 1)} more finds a day at 1,000 vehicles. Most of the rise lands on Subframe, Pre-marriage, Marriage and Post-marriage, through extra fasteners carried in hand. Try it yourself in Risk outlook by switching that lever off.`;
  }
  if (s.includes("99") || s.includes("next") || s.includes("further")) {
    return `The low-cost fixes got the plant to about ${Math.round(red * 100)}%. The last few percent are spread thin across many causes, so the next step is to catch objects earlier and make errors harder to make:\n1. Zone close-out checks before cavities are closed (carpet, IP, door trim).\n2. Count-controlled fastener kits, a cheaper step toward dispensers.\n3. A rundown-count interlock so a vehicle can't leave a station with a missing or rejected bolt.\n4. Seeded-object tests to measure how well VDT finds plastic and small parts.\n5. Layered process audits to keep the current countermeasures alive.\nThe scanning tunnel (about $900K) would remove the remaining labor cost of about ${FG.money(now.costPerDay * 365)} a year, so it only pays back if it prevents costly escapes. See Cost and ROI.`;
  }
  // generic routing
  if (s.includes("area") || s.includes("where")) {
    const r = FG.breakdown(FG.range(), "area");
    return `For ${b.period}: ${r.slice(0, 4).map(([a, n]) => `${a} ${n}`).join(", ")}. ${r[0] ? r[0][0] + " is the biggest source." : ""}`;
  }
  if (s.includes("cause") || s.includes("why")) {
    const r = FG.breakdown(FG.range(), "root_cause");
    return `Top causes for ${b.period}: ${r.slice(0, 4).map(([c, n]) => `${D.cause_meta[c].label.toLowerCase()} (${n})`).join("; ")}.`;
  }
  return `Right now: ${FG.fmt(b.per100, 2)} loose objects per 100 vehicles for ${b.period}, ${b.reductionVsBaseline != null ? Math.round(b.reductionVsBaseline * 100) + "% below baseline" : ""}. The built-in analyst answers the suggested questions and simple ones about areas and causes. With Claude available, you can ask anything.`;
};

AS.rewriteBrief = async function () {
  if (!FG.caps.sample) return;
  const btn = FG.$("#claudeBrief");
  btn.disabled = true;
  btn.textContent = "Writing...";
  try {
    const b = V.briefData();
    const pct = (x) => (x == null ? null : FG.pct(x));
    // Same numbers as the screen, already rounded and labelled with units.
    const data = {
      period: b.period, scope: b.filter, phase: b.phase,
      looseObjectsPer100Vehicles: b.per100.toFixed(2),
      previousPeriodPer100Vehicles: b.previousPer100 == null ? null : b.previousPer100.toFixed(2),
      baselinePer100Vehicles: b.baselinePer100.toFixed(1),
      belowBaseline: b.reductionVsBaseline == null ? null : Math.floor(b.reductionVsBaseline * 100 + 1e-9) + "%",
      finds: b.finds, findsPerDay: b.perDay.toFixed(1),
      eolLaborPerDay: "$" + b.costPerDay.toLocaleString("en-US"),
      foundOnFirstVdtRun: pct(b.firstRunDetection), escapesToCustomers: b.escapes,
      topAreas: b.topAreas.map((a) => `${a.area}: ${a.finds} finds (${pct(a.share)})`),
      topCauses: b.topCauses.map((c) => `${c.cause}: ${c.finds} finds`),
      anomalyAlerts: b.alerts.map((a) => `${a.area}, ${a.shift.toLowerCase()} shift, ${a.date}: ${a.observed} finds vs about ${a.expected} expected`),
      shiftToWatchNext: b.nextShiftHighestRisk ? `${b.nextShiftHighestRisk.area}, ${b.nextShiftHighestRisk.shift.endsWith("N") ? "night" : "day"} shift, forecast ${b.nextShiftHighestRisk.per100.toFixed(2)} per 100 vehicles` : null,
    };
    const prompt = `Write a shift handover brief for a production manager in a vehicle assembly plant, from the loose-object data below.

Rules:
- Exactly 5 lines. Each line is one short sentence of at most 20 words.
- Line 1: the rate per 100 vehicles, compared with the previous period and the baseline.
- Line 2: where the finds came from and the top cause.
- Line 3: first-run detection and escapes, or the anomaly alerts if there are any.
- Line 4: the shift to watch next.
- Line 5: one concrete action for the next shift, starting with a verb.
- Use the numbers exactly as given. Say "vehicles", never "units". Keep the $ sign on money.
- Plain words. No headings, no bullets, no markdown, no line numbers.

Data: ${JSON.stringify(data)}`;
    const res = await FG.caps.sample(prompt, { modelTier: "quick", cache: false });
    V.renderBrief(res.text.trim());
  } catch (e) {
    FG.toast(e && e.code === "not_granted" ? "Claude wasn't allowed in this view." : "Claude couldn't write the brief right now.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Rewrite with Claude";
  }
};
