/* FOD Guard charts: ECharts with colors read from the page's theme tokens. */
"use strict";

const FGC = (window.FGC = { inst: {}, tables: {} });

FGC.t = function () {
  const c = FG.css;
  return {
    ink: c("--ink"), ink2: c("--ink-2"), muted: c("--muted"), line: c("--line"), line2: c("--line-2"),
    surface: c("--surface"), surface2: c("--surface-2"), accent: c("--accent"), accentSoft: c("--accent-soft"),
    good: c("--good"), warn: c("--warn"), serious: c("--serious"), crit: c("--crit"),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => c(`--s${i}`)),
    font: c("--font-body") || "sans-serif",
  };
};

FGC.mount = function (id) {
  const el = document.getElementById(id);
  if (!el || typeof echarts === "undefined") return null;
  let ch = FGC.inst[id];
  if (ch && ch.getDom() !== el) { ch.dispose(); ch = null; }
  if (!ch) {
    ch = echarts.init(el, null, { renderer: "canvas" });
    FGC.inst[id] = ch;
    new ResizeObserver(() => ch.resize()).observe(el);
  }
  return ch;
};
FGC.resizeAll = () => Object.values(FGC.inst).forEach((c) => c.resize());

FGC.base = function (t) {
  return {
    animationDuration: 500,
    textStyle: { fontFamily: t.font, color: t.ink2 },
    tooltip: {
      backgroundColor: t.surface, borderColor: t.line2, borderWidth: 1,
      textStyle: { color: t.ink, fontSize: 12, fontFamily: t.font }, extraCssText: "box-shadow:0 4px 14px rgba(0,0,0,.12);border-radius:8px;",
    },
  };
};
FGC.axis = (t, extra = {}) => ({
  axisLine: { lineStyle: { color: t.line2 } }, axisTick: { show: false },
  axisLabel: { color: t.muted, fontSize: 11 }, splitLine: { lineStyle: { color: t.line } }, ...extra,
});

/* ---------------------------------------------------------------- table views */
FGC.setTable = function (key, headers, rows) {
  FGC.tables[key] = { headers, rows };
  const box = document.getElementById(key + "Table");
  if (box && !box.hidden) FGC.renderTable(key);
};
FGC.renderTable = function (key) {
  const box = document.getElementById(key + "Table");
  const tb = FGC.tables[key];
  if (!box || !tb) return;
  box.innerHTML = `<table class="table table-dense"><thead><tr>${tb.headers.map((h, i) => `<th class="${i ? "num" : ""}">${FG.esc(h)}</th>`).join("")}</tr></thead><tbody>${
    tb.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${i ? "num" : ""}">${FG.esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-table-for]");
  if (!b) return;
  const key = b.dataset.tableFor;
  const box = document.getElementById(key + "Table");
  const chart = document.getElementById(key + "Chart");
  if (!box) return;
  const show = box.hidden;
  box.hidden = !show;
  if (chart) chart.style.display = show ? "none" : "";
  b.textContent = show ? "View as chart" : "View as table";
  if (show) FGC.renderTable(key); else FGC.inst[key + "Chart"]?.resize();
});

/* ---------------------------------------------------------------- trend */
FGC.trend = function (series, opts) {
  const ch = FGC.mount("trendChart");
  if (!ch) return;
  const t = FGC.t();
  const D = FG.D;
  const x = series.map((p) => p.date);
  const y = series.map((p) => +p.rate.toFixed(2));
  const last = series.length - 1;
  const phases = [
    ["Baseline", 0, Math.min(last, D.rolloutIdx - 1), t.crit],
    ["Rollout", D.rolloutIdx, Math.min(last, D.sustainIdx - 1), t.warn],
    ["Sustain", D.sustainIdx, last, t.good],
  ].filter((p) => p[1] <= last);
  const markAreas = phases.map(([name, a, b, col]) => [
    { name, xAxis: x[a], itemStyle: { color: col, opacity: 0.07 }, label: { color: t.muted, fontSize: 11, position: "insideTop" } },
    { xAxis: x[b] },
  ]);
  const pins = (opts.launches || []).filter((l) => l.d <= last).map((l, i) => ({
    xAxis: x[l.d], label: { formatter: String(i + 1), color: t.ink2, fontSize: 10, position: "end" },
    lineStyle: { color: t.line2, type: "solid", width: 1 },
  }));
  const anomalies = (opts.alertDays || []).filter((d) => d <= last).map((d) => ({ coord: [x[d], y[d]], value: y[d] }));
  const limits = opts.limits;
  const option = {
    ...FGC.base(t),
    grid: { left: 44, right: 18, top: 26, bottom: 54 },
    tooltip: { ...FGC.base(t).tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.line2 } },
      formatter: (ps) => {
        const p = ps[0]; const s = series[p.dataIndex];
        return `<b>${FG.dateLabel(s.date)}</b><br>${FG.fmt(s.rate, 2)} per 100 vehicles<br>${FG.int(s.n)} finds, ${FG.int(s.v)} vehicles<br><span style="color:${t.muted}">${FG.phaseOf(s.d)}</span>`;
      } },
    xAxis: { type: "category", data: x, boundaryGap: false, ...FGC.axis(t, { splitLine: { show: false } }),
      axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => FG.dateLabel(v, false), hideOverlap: true } },
    yAxis: { type: "value", min: 0, ...FGC.axis(t), name: "", axisLabel: { color: t.muted, fontSize: 11 } },
    dataZoom: [{ type: "inside", startValue: opts.zoomStart ?? 0, endValue: last }, {
      type: "slider", height: 16, bottom: 8, borderColor: t.line, backgroundColor: t.surface2, fillerColor: FG.css("--accent-soft"),
      handleStyle: { color: t.surface, borderColor: t.line2 }, dataBackground: { lineStyle: { color: t.line2 }, areaStyle: { color: t.line } },
      textStyle: { color: t.muted }, labelFormatter: (i) => (x[i] ? FG.dateLabel(x[i], false) : ""), startValue: opts.zoomStart ?? 0, endValue: last }],
    series: [
      {
        type: "line", name: "Rate", data: y, symbol: "none", lineStyle: { width: 2, color: t.accent },
        areaStyle: { color: t.accent, opacity: 0.08 },
        markArea: { silent: true, data: markAreas },
        markLine: { silent: true, symbol: "none", data: [...pins, ...(limits ? [
          { yAxis: limits.ucl, lineStyle: { color: t.crit, type: "solid", width: 1, opacity: 0.6 }, label: { formatter: `UCL ${limits.ucl.toFixed(2)}`, color: t.muted, fontSize: 10, position: "insideEndTop" } },
          { yAxis: limits.cl, lineStyle: { color: t.good, type: "solid", width: 1, opacity: 0.6 }, label: { formatter: `CL ${limits.cl.toFixed(2)}`, color: t.muted, fontSize: 10, position: "insideEndBottom" } },
        ] : [])] },
        markPoint: { symbol: "circle", symbolSize: 10, itemStyle: { color: t.crit, borderColor: t.surface, borderWidth: 2 }, label: { show: false }, data: anomalies },
      },
    ],
  };
  ch.setOption(option, true);
  FGC.setTable("trend", ["Date", "Finds", "Vehicles", "Per 100"], series.slice().reverse().map((s) => [FG.dateLabel(s.date), s.n, s.v, FG.fmt(s.rate, 2)]));
};

/* ---------------------------------------------------------------- horizontal bars (Pareto) */
FGC.hbars = function (id, rows, opts = {}) {
  const ch = FGC.mount(id);
  if (!ch) return;
  const t = FGC.t();
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const data = rows.slice().reverse();
  ch.setOption({
    ...FGC.base(t),
    grid: { left: 8, right: 64, top: 6, bottom: 6, containLabel: true },
    tooltip: { ...FGC.base(t).tooltip, trigger: "item", formatter: (p) => `<b>${FG.esc(p.name)}</b><br>${FG.int(p.value)} finds, ${FG.pct(p.value / total)}${opts.baseline ? `<br><span style="color:${t.muted}">Baseline share ${FG.pct((opts.baseline[p.name] || 0))}</span>` : ""}` },
    xAxis: { type: "value", show: false, max: (v) => v.max * 1.02 },
    yAxis: { type: "category", data: data.map((r) => r.name), ...FGC.axis(t, { axisLine: { show: false } }), axisLabel: { color: t.ink2, fontSize: 12 } },
    series: [{
      type: "bar", data: data.map((r) => ({ value: r.value, itemStyle: { color: r.color || t.series[0], borderRadius: [0, 4, 4, 0] } })),
      barMaxWidth: 18, barCategoryGap: "35%",
      label: { show: true, position: "right", color: t.ink2, fontSize: 11.5, formatter: (p) => FG.pct(p.value / total) },
    }],
  }, true);
  if (opts.tableKey) FGC.setTable(opts.tableKey, ["Category", "Finds", "Share"], rows.map((r) => [r.name, r.value, FG.pct(r.value / total)]));
};

/* ---------------------------------------------------------------- sparkline */
FGC.spark = function (el, values, color) {
  if (!el || typeof echarts === "undefined") return;
  let ch = echarts.getInstanceByDom(el) || echarts.init(el, null, { renderer: "svg" });
  const t = FGC.t();
  ch.setOption({
    animation: false, grid: { left: 0, right: 4, top: 4, bottom: 2 },
    xAxis: { type: "category", show: false, data: values.map((_, i) => i) },
    yAxis: { type: "value", show: false, min: 0 },
    series: [{ type: "line", data: values, symbol: "none", lineStyle: { width: 1.5, color: color || t.muted },
      areaStyle: { color: color || t.muted, opacity: 0.1 },
      markPoint: { symbol: "circle", symbolSize: 6, itemStyle: { color: t.accent, borderColor: t.surface, borderWidth: 1.5 }, label: { show: false },
        data: [{ coord: [values.length - 1, values[values.length - 1]] }] } }],
  }, true);
};

/* ---------------------------------------------------------------- hour of shift */
FGC.hours = function (baseShare, nowShare, labels, breaks) {
  const ch = FGC.mount("hourChart");
  if (!ch) return;
  const t = FGC.t();
  ch.setOption({
    ...FGC.base(t),
    grid: { left: 40, right: 12, top: 34, bottom: 30 },
    legend: { top: 0, left: 0, itemWidth: 14, itemHeight: 8, textStyle: { color: t.ink2, fontSize: 12 }, data: ["Baseline", "Selected period"] },
    tooltip: { ...FGC.base(t).tooltip, trigger: "axis", valueFormatter: (v) => FG.pct(v, 1) },
    xAxis: { type: "category", data: labels, ...FGC.axis(t, { splitLine: { show: false } }), axisLabel: { color: t.muted, fontSize: 10.5, interval: 1 } },
    yAxis: { type: "value", ...FGC.axis(t), axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => Math.round(v * 100) + "%" } },
    series: [
      { name: "Baseline", type: "line", data: baseShare, symbol: "none", lineStyle: { width: 2, color: t.muted }, areaStyle: { color: t.muted, opacity: 0.08 } },
      { name: "Selected period", type: "line", data: nowShare, symbol: "circle", symbolSize: 5, lineStyle: { width: 2, color: t.accent }, itemStyle: { color: t.accent },
        markLine: { silent: true, symbol: "none", data: breaks.map((b) => ({ xAxis: b.label, lineStyle: { color: t.warn, type: "solid", width: 1 }, label: { formatter: b.name, color: t.ink2, fontSize: 10 } })) } },
    ],
  }, true);
  FGC.setTable("hour", ["Hour of shift", "Baseline share", "Selected share"], labels.map((l, i) => [l, FG.pct(baseShare[i], 1), FG.pct(nowShare[i], 1)]));
};

/* ---------------------------------------------------------------- heatmap */
FGC.isDark = () => {
  const th = document.documentElement.dataset.theme;
  return th === "dark" || (!th && matchMedia("(prefers-color-scheme: dark)").matches);
};
FGC.heat = function (fc) {
  const ch = FGC.mount("heatChart");
  if (!ch) return;
  const t = FGC.t();
  const areas = FG.D.areas;
  const dark = FGC.isDark();
  let mx = 0;
  fc.grid.forEach((row) => row.forEach((v) => { mx = Math.max(mx, v); }));
  mx = Math.max(0.4, mx);
  const ramp = dark
    ? ["#16263d", "#1c3a66", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"]
    : ["#eef4fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#104281"];
  const data = [];
  fc.grid.forEach((row, i) => row.forEach((v, j) => {
    const strong = v / mx > 0.55;
    const light = dark ? !strong : strong;
    data.push({ value: [j, i, +v.toFixed(3)], label: { color: light ? "#ffffff" : "#0b0b0b" } });
  }));
  ch.setOption({
    ...FGC.base(t),
    grid: { left: 8, right: 12, top: 8, bottom: 56, containLabel: true },
    tooltip: { ...FGC.base(t).tooltip, formatter: (p) => `<b>${areas[p.value[1]]}</b>, ${fc.slots[p.value[0]].label.replace(" D", " day").replace(" N", " night")} ${FG.dateLabel(fc.slots[p.value[0]].iso, false)}<br>${FG.fmt(p.value[2], 2)} per 100 vehicles<br>about ${FG.fmt(p.value[2] * fc.vehPerShift / 100, 1)} finds this shift` },
    xAxis: { type: "category", data: fc.slots.map((s) => s.label), ...FGC.axis(t, { splitLine: { show: false }, axisLine: { show: false } }), axisLabel: { color: t.muted, fontSize: 10.5 } },
    yAxis: { type: "category", data: areas, inverse: true, ...FGC.axis(t, { splitLine: { show: false }, axisLine: { show: false } }), axisLabel: { color: t.ink2, fontSize: 12 } },
    visualMap: { min: 0, max: mx, calculable: false, orient: "horizontal", left: "center", bottom: 4, itemWidth: 10, itemHeight: 160,
      text: ["higher risk", "lower"], textStyle: { color: t.muted, fontSize: 11 }, inRange: { color: ramp } },
    series: [{ type: "heatmap", data, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
      label: { show: true, fontSize: 10, formatter: (p) => (p.value[2] >= 0.01 ? p.value[2].toFixed(2) : "") },
      emphasis: { itemStyle: { borderColor: t.accent, borderWidth: 2 } } }],
  }, true);
  FGC.setTable("heat", ["Area", ...fc.slots.map((s) => s.label)], fc.grid.map((row, i) => [areas[i], ...row.map((v) => FG.fmt(v, 2))]));
};

/* ---------------------------------------------------------------- waterfall */
FGC.waterfall = function (steps, status) {
  const ch = FGC.mount("waterfallChart");
  if (!ch) return;
  const t = FGC.t();
  const labels = steps.map((s, i) => (i === 0 ? "Baseline" : s.short));
  labels.push("Now");
  const base = [], drop = [], totals = [];
  steps.forEach((s, i) => {
    if (i === 0) { base.push(0); drop.push("-"); totals.push(s.rate); return; }
    base.push(s.rate); drop.push(+(steps[i - 1].rate - s.rate).toFixed(3)); totals.push("-");
  });
  base.push(0); drop.push("-"); totals.push(steps[steps.length - 1].rate);
  ch.setOption({
    ...FGC.base(t),
    grid: { left: 44, right: 16, top: 24, bottom: 74 },
    tooltip: { ...FGC.base(t).tooltip, trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => {
        const i = ps[0].dataIndex;
        if (i === 0) return `<b>Baseline</b><br>${FG.fmt(steps[0].rate, 1)} per 100 vehicles`;
        if (i === steps.length) return `<b>All countermeasures in place</b><br>${FG.fmt(steps[steps.length - 1].rate, 2)} per 100 vehicles`;
        const s = steps[i];
        return `<b>${FG.esc(s.label)}</b><br>Launched ${FG.dateLabel(s.launch)}<br>Removed ${FG.fmt(steps[i - 1].rate - s.rate, 2)} per 100 vehicles<br>${FG.pct((steps[i - 1].rate - s.rate) / (steps[0].rate - steps[steps.length - 1].rate))} of the total drop`;
      } },
    xAxis: { type: "category", data: labels, ...FGC.axis(t, { splitLine: { show: false } }), axisLabel: { color: t.ink2, fontSize: 11, interval: 0, width: 92, overflow: "break", lineHeight: 13 } },
    yAxis: { type: "value", min: 0, ...FGC.axis(t) },
    series: [
      { type: "bar", stack: "w", data: base, itemStyle: { color: "transparent" }, emphasis: { disabled: true }, barMaxWidth: 46 },
      { type: "bar", stack: "w", data: drop, barMaxWidth: 46, itemStyle: { color: t.good, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: t.ink2, fontSize: 11, formatter: (p) => (p.value === "-" ? "" : "-" + Number(p.value).toFixed(1)) } },
      { type: "bar", stack: "w", data: totals, barMaxWidth: 46, itemStyle: { color: t.ink2, borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: t.ink, fontSize: 12, fontWeight: 600, formatter: (p) => (p.value === "-" ? "" : Number(p.value).toFixed(1)) } },
    ],
  }, true);
  FGC.setTable("waterfall", ["Step", "Rate after step", "Removed"], steps.map((s, i) => [i ? s.label : "Baseline", FG.fmt(s.rate, 2), i ? FG.fmt(steps[i - 1].rate - s.rate, 2) : "-"]));
};

/* ---------------------------------------------------------------- roi */
FGC.roi = function (before, after) {
  const ch = FGC.mount("roiChart");
  if (!ch) return;
  const t = FGC.t();
  ch.setOption({
    ...FGC.base(t),
    grid: { left: 8, right: 70, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...FGC.base(t).tooltip, trigger: "item", formatter: (p) => `<b>${p.name}</b><br>${FG.money(p.value)} a year` },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", data: ["After", "Before"], ...FGC.axis(t, { axisLine: { show: false } }), axisLabel: { color: t.ink2, fontSize: 12 } },
    series: [{ type: "bar", barMaxWidth: 22, data: [
      { value: after, itemStyle: { color: t.good, borderRadius: [0, 4, 4, 0] } },
      { value: before, itemStyle: { color: t.crit, borderRadius: [0, 4, 4, 0] } }],
      label: { show: true, position: "right", color: t.ink, fontWeight: 600, formatter: (p) => FG.money(p.value) } }],
  }, true);
};
