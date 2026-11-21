"""FOD Guard 2 - train, evaluate and export the AI models.

Models
  1. Triage (text): TF-IDF + multinomial logistic regression, three heads:
       source area (8 classes), object category (7), root cause (14).
       Used when a technician describes a new find in plain words.
  2. Risk (counts): Poisson regression on loose objects per area and shift,
       with vehicles built as exposure. Inputs: area, night shift, share of new
       associates, downtime, and how far each countermeasure lever has ramped.
       Powers the 7-day outlook, the what-if levers and the anomaly alerts.
  3. Impact: the risk model run lever by lever in launch order, giving each
       countermeasure's share of the 95% reduction (the waterfall).

All three export to plain JSON so the dashboard runs them in the browser with
no server. A model card with held-out metrics is written to reports/.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, PoissonRegressor
from sklearn.metrics import accuracy_score, f1_score, top_k_accuracy_score
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "data"))
import generate_data as gen  # noqa: E402

APP = ROOT / "app"
REPORTS = ROOT / "reports"
APP.mkdir(exist_ok=True)
(APP / "data").mkdir(exist_ok=True)
REPORTS.mkdir(exist_ok=True)

inc = pd.read_csv(ROOT / "data" / "incidents.csv")
shifts = pd.read_csv(ROOT / "data" / "shifts.csv")


def r(x, n=4):
    return float(round(float(x), n))


# =========================================================== 1. triage
text = inc["description"].astype(str)
vec = TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_features=2200, sublinear_tf=True)
X = vec.fit_transform(text)
idx_train, idx_test = train_test_split(np.arange(len(inc)), test_size=0.2, random_state=7,
                                       stratify=inc["area"])
heads = {}
triage_metrics = {}
for target in ["area", "object_category", "root_cause"]:
    y = inc[target].values
    clf = LogisticRegression(C=6.0, max_iter=3000)
    clf.fit(X[idx_train], y[idx_train])
    proba = clf.predict_proba(X[idx_test])
    pred = clf.classes_[proba.argmax(1)]
    k3 = min(3, len(clf.classes_))
    triage_metrics[target] = {
        "classes": len(clf.classes_),
        "test_rows": int(len(idx_test)),
        "top1_accuracy": r(accuracy_score(y[idx_test], pred), 3),
        "top3_accuracy": r(top_k_accuracy_score(y[idx_test], proba, k=k3, labels=clf.classes_), 3),
        "macro_f1": r(f1_score(y[idx_test], pred, average="macro"), 3),
    }
    heads[target] = {
        "classes": clf.classes_.tolist(),
        "intercept": [r(v, 4) for v in clf.intercept_],
        "coef": [[r(v, 3) for v in row] for row in clf.coef_],
    }
    print(target, triage_metrics[target])

vocab = vec.get_feature_names_out().tolist()
triage_export = {
    "vocab": vocab,
    "idf": [r(v, 4) for v in vec.idf_],
    "heads": heads,
    "token_pattern": "\\b\\w\\w+\\b",
    "ngram_range": [1, 2],
    "sublinear_tf": True,
}

# parity samples so the browser implementation can be checked
parity_texts = [
    "Rattle at the bump section, tech pulled zip-tie tail from IP cavity near harness",
    "Spanner left on rear floor after repair",
    "M12 bolt with damaged thread found under subframe, looks like a wrong shot",
    "Screw rattling inside center console, module was sealed when received",
    "Broken push clip in door cavity, clip head snapped off",
    "weld slag in rocker sill cavity",
]
P = vec.transform(parity_texts)
parity = []
for t, row in zip(parity_texts, P):
    item = {"text": t}
    for target in heads:
        clf_coef = np.array(heads[target]["coef"])
        clf_int = np.array(heads[target]["intercept"])
        z = row.toarray()[0] @ clf_coef.T + clf_int
        p = np.exp(z - z.max())
        p /= p.sum()
        item[target] = {heads[target]["classes"][i]: r(p[i], 4) for i in np.argsort(-p)[:3]}
    parity.append(item)
triage_export["parity"] = parity

# typical minutes by object category and severity (current state, last 8 weeks)
recent_cut = (pd.to_datetime(inc["date"]).max() - pd.Timedelta(days=56)).date().isoformat()
recent = inc[inc["date"] >= recent_cut]
base = inc[inc["phase"] == "Baseline"]
minutes_lookup = {}
for (cat, sev), g in recent.groupby(["object_category", "severity"]):
    if len(g) >= 3:
        minutes_lookup[f"{cat}|{sev}"] = r(g["minutes"].median(), 1)
for sev, g in recent.groupby("severity"):
    minutes_lookup[f"*|{sev}"] = r(g["minutes"].median(), 1)
triage_export["minutes"] = minutes_lookup

# =========================================================== 2. risk model
LEVERS = [
    {"key": "L1", "name": "Clean before you leave and daily quality meeting", "cms": ["cm_clean", "cm_tier"]},
    {"key": "L2", "name": "Robot wrong-shot alert", "cms": ["cm_robot"]},
    {"key": "L3", "name": "Magnetic chairs and point-of-use racks", "cms": ["cm_magnetic"]},
    {"key": "L4", "name": "Shadow boards and paint fixture checklist", "cms": ["cm_shadow", "cm_paint"]},
    {"key": "L5", "name": "EOL post-repair exit checklist", "cms": ["cm_eolcheck"]},
    {"key": "L6", "name": "Push clip redesign", "cms": ["cm_clip"]},
    {"key": "L7", "name": "Supplier SCAR and containment", "cms": ["cm_scar"]},
]
cm_week = {cm.key: cm.week for cm in gen.CMS}
for lv in LEVERS:
    lv["launch"] = (gen.ROLLOUT_START + timedelta(days=round(cm_week[lv["cms"][0]] * 7))).isoformat()
RAMP_TAU = gen.RAMP_DAYS / 3.0
# Domain mask: a lever only acts on areas where one of its countermeasures
# targets a root cause that occurs there.
for lv in LEVERS:
    causes = set()
    for cm in gen.CMS:
        if cm.key in lv["cms"]:
            causes |= set(cm.causes)
    lv["areas"] = [a for a in gen.AREAS if causes & set(gen.AREA_CAUSE_MIX[a])]
AREAS = gen.AREAS
ASSEMBLY = ["Subframe", "Pre-marriage", "Marriage", "Post-marriage"]


def lever_progress(launch_iso: str, d_iso: str) -> float:
    t = (date.fromisoformat(d_iso) - date.fromisoformat(launch_iso)).days
    return 0.0 if t < 0 else 1.0 - math.exp(-t / RAMP_TAU)


feature_names = [f"area:{a}" for a in AREAS[1:]] + ["night", "new_assoc_x_people_areas", "downtime_hr"]
for lv in LEVERS:
    for a in lv["areas"]:
        feature_names.append(f"{lv['key']}x{a}")


def build_row(area, night, new_share, downtime_min, progress: dict):
    row = [1.0 if area == a else 0.0 for a in AREAS[1:]]
    row += [night, new_share if area in ASSEMBLY + ["EOL repair"] else 0.0, downtime_min / 60.0]
    for lv in LEVERS:
        for a in lv["areas"]:
            row.append(progress[lv["key"]] if a == area else 0.0)
    return row


rows, y, w = [], [], []
dates_sorted = sorted(shifts["date"].unique())
prog_cache = {d: {lv["key"]: lever_progress(lv["launch"], d) for lv in LEVERS} for d in dates_sorted}
for rec in shifts.itertuples(index=False):
    rows.append(build_row(rec.area, 1.0 if rec.shift == "Night" else 0.0, rec.new_assoc_share,
                          rec.downtime_min, prog_cache[rec.date]))
    y.append(rec.loose_objects / rec.vehicles * 100.0)
    w.append(rec.vehicles / 100.0)
Xr = np.array(rows)
yr = np.array(y)
wr = np.array(w)

# time-based hold-out: last 4 weeks
cut = dates_sorted[-28]
is_test = shifts["date"].values >= cut
risk = PoissonRegressor(alpha=1e-5, max_iter=3000)
risk.fit(Xr[~is_test], yr[~is_test], sample_weight=wr[~is_test])
pred_test = risk.predict(Xr[is_test])
d2_test = risk.score(Xr[is_test], yr[is_test], sample_weight=wr[is_test])
d2_train = risk.score(Xr[~is_test], yr[~is_test], sample_weight=wr[~is_test])

# daily plant-level error on the hold-out weeks
sh_test = shifts[is_test].copy()
sh_test["pred_count"] = pred_test * sh_test["vehicles"].values / 100.0
daily = sh_test.groupby("date").agg(obs=("loose_objects", "sum"), pred=("pred_count", "sum"),
                                     veh=("vehicles", "sum"))
# vehicles are repeated per area; use one area's vehicles per shift
veh_day = shifts[is_test].groupby(["date", "shift"]).vehicles.first().groupby("date").sum()
daily["obs_rate"] = daily["obs"] / veh_day * 100
daily["pred_rate"] = daily["pred"] / veh_day * 100
mae_daily = float((daily["obs_rate"] - daily["pred_rate"]).abs().mean())

# random 20% hold-out for deviance explained (the time hold-out has very low counts)
rs = np.random.default_rng(3)
rmask = rs.random(len(yr)) < 0.2
risk_r = PoissonRegressor(alpha=1e-5, max_iter=3000).fit(Xr[~rmask], yr[~rmask], sample_weight=wr[~rmask])
d2_random = risk_r.score(Xr[rmask], yr[rmask], sample_weight=wr[rmask])

# refit on all data for deployment
risk.fit(Xr, yr, sample_weight=wr)
risk_metrics = {
    "rows": int(len(yr)), "test_rows": int(is_test.sum()),
    "holdout": f"last 4 weeks ({cut} onward)",
    "d2_train": r(d2_train, 3), "d2_holdout": r(d2_test, 3),
    "daily_rate_mae_holdout": r(mae_daily, 3),
    "d2_random_holdout": r(d2_random, 3),
    "holdout_mean_rate": r(float(daily["obs_rate"].mean()), 3),
}
print("risk", risk_metrics)
coef = dict(zip(feature_names, risk.coef_))

# staffing assumptions for the planner (associates per area per shift)
ASSOCIATES = {"BIW": 10, "Paint": 8, "Subframe": 18, "Pre-marriage": 24, "Marriage": 16,
              "Post-marriage": 28, "EOL repair": 12, "Supplier": 0}

risk_export = {
    "intercept": r(risk.intercept_, 5),
    "coef": {k: r(v, 5) for k, v in coef.items()},
    "areas": AREAS,
    "people_areas": ASSEMBLY + ["EOL repair"],
    "levers": LEVERS,
    "ramp_tau_days": RAMP_TAU,
    "associates": ASSOCIATES,
}

# =========================================================== 3. impact waterfall
last_day = dates_sorted[-1]
base_new = float(shifts[shifts["phase"] == "Baseline"]["new_assoc_share"].mean())
base_down = float(shifts["downtime_min"].mean())


def plant_rate(progress):
    tot = 0.0
    for a in AREAS:
        for night in (0.0, 1.0):
            z = risk.intercept_ + np.dot(risk.coef_, build_row(a, night, base_new, base_down, progress))
            tot += math.exp(z)
    return tot / 2.0       # areas sum to the plant rate; average the two shifts


progress = {lv["key"]: 0.0 for lv in LEVERS}
steps = [{"label": "Baseline", "rate": r(plant_rate(progress), 3)}]
for lv in LEVERS:
    progress[lv["key"]] = 1.0
    steps.append({"label": lv["name"], "key": lv["key"], "rate": r(plant_rate(progress), 3)})
for i in range(1, len(steps)):
    steps[i]["drop"] = r(steps[i - 1]["rate"] - steps[i]["rate"], 3)
print("waterfall", [(s["label"][:24], s["rate"]) for s in steps])
impact_export = {"steps": steps, "conditions": {"new_assoc_share": r(base_new, 3), "downtime_min": r(base_down, 1)}}

# =========================================================== countermeasure register
register = []
for cm in gen.CMS:
    lv = next((l for l in LEVERS if cm.key in l["cms"]), None)
    register.append({
        "key": cm.key, "name": cm.name, "level": cm.level, "owner": cm.owner,
        "launch": (gen.ROLLOUT_START + timedelta(days=round(cm.week * 7))).isoformat(),
        "lever": lv["key"] if lv else None, "status": "Sustaining",
        "causes": [c for c in cm.causes] if cm.causes else [],
    })
proposals = [
    {"name": "EOL scanning tunnel (vision and electronic scan)", "level": "Detect", "owner": "Quality, EOL",
     "status": "Not approved", "note": "Vendor quote about $900K. Department kept the low-cost approach that delivered 95%."},
    {"name": "Fastener dispensers at assembly stations", "level": "Engineer", "owner": "Manufacturing engineering",
     "status": "Not approved", "note": "Not approved at this plant. The approach is used at the Shanghai plant."},
    {"name": "Zone close-out checks before cavities are closed", "level": "Detect", "owner": "Production", "status": "Proposed",
     "note": "Catch objects at the station that can fix them, not at EOL."},
    {"name": "Count-controlled fastener kits", "level": "Engineer", "owner": "Logistics, ME", "status": "Proposed",
     "note": "A leftover fastener is an instant signal. Low-cost step toward dispensers."},
    {"name": "Rundown-count interlock at the station", "level": "Engineer", "owner": "Controls", "status": "Proposed",
     "note": "Vehicle can't be released until the rundown count matches."},
    {"name": "Seeded-object VDT capability check", "level": "Detect", "owner": "Quality", "status": "Proposed",
     "note": "Measure how often each technician finds known objects on the bump route."},
    {"name": "Layered process audits", "level": "Administer", "owner": "Production managers", "status": "Proposed",
     "note": "Lead every shift, supervisor daily, manager weekly (AIAG CQI-8)."},
]

# =========================================================== compact data export
cats = {}


def enc(col):
    vals = sorted(inc[col].astype(str).unique().tolist())
    cats[col] = vals
    m = {v: i for i, v in enumerate(vals)}
    return [m[v] for v in inc[col].astype(str)]


all_dates = [(gen.START + timedelta(days=i)).isoformat() for i in range(gen.DAYS)]
date_idx = {d: i for i, d in enumerate(all_dates)}
cols = {
    "d": [date_idx[d] for d in inc["date"]],
    "s": [0 if s == "Day" else 1 for s in inc["shift"]],
    "h": [r(v, 1) for v in inc["hour_of_shift"]],
    "a": enc("area"), "st": enc("station"), "oc": enc("object_category"), "o": enc("object"),
    "m": enc("material"), "rc": enc("root_cause"), "z": enc("zone"), "sv": enc("severity"),
    "vr": inc["vdt_runs"].astype(int).tolist(),
    "mn": [r(v, 1) for v in inc["minutes"]],
    "td": inc["teardown"].astype(int).tolist(),
    "es": inc["escaped_to_customer"].astype(int).tolist(),
    "tn": inc["associate_tenure_days"].astype(int).tolist(),
    "vm": [0 if v == "Sedan" else 1 for v in inc["vehicle_model"]],
    "vin": inc["vin"].tolist(),
    "tx": inc["description"].tolist(),
}
cause_meta = {k: {"category_hint": v[0], "branch": v[1], "label": v[2]} for k, v in gen.CAUSES.items()}
shift_cols = {
    "d": [date_idx[d] for d in shifts["date"]],
    "s": [0 if s == "Day" else 1 for s in shifts["shift"]],
    "a": [AREAS.index(a) for a in shifts["area"]],
    "v": shifts["vehicles"].astype(int).tolist(),
    "dt": [r(v, 1) for v in shifts["downtime_min"]],
    "nw": [r(v, 3) for v in shifts["new_assoc_share"]],
    "n": shifts["loose_objects"].astype(int).tolist(),
}
data_export = {
    "plant": {"name": "Plant A", "scope": "General Assembly and End-of-Line", "jph": gen.JPH,
              "shift_hours": gen.SHIFT_HOURS, "shifts": gen.SHIFTS, "labor_rate": gen.LABOR_RATE,
              "breaks": gen.BREAKS, "rollout_start": gen.ROLLOUT_START.isoformat(),
              "sustain_start": (gen.ROLLOUT_START + timedelta(weeks=9)).isoformat()},
    "dates": all_dates,
    "areas": AREAS,
    "area_codes": gen.AREA_CODE,
    "cats": cats,
    "cause_meta": cause_meta,
    "incidents": cols,
    "shifts": shift_cols,
    "register": register,
    "proposals": proposals,
    "synthetic": True,
}

models_export = {
    "version": "2.0.0",
    "trained_on": f"{len(inc):,} synthetic loose-object records, {len(shifts):,} area-shift rows",
    "triage": triage_export,
    "risk": risk_export,
    "impact": impact_export,
    "metrics": {"triage": triage_metrics, "risk": risk_metrics},
}

with open(APP / "data" / "plant.json", "w") as f:
    json.dump(data_export, f, separators=(",", ":"))
with open(APP / "data" / "models.json", "w") as f:
    json.dump(models_export, f, separators=(",", ":"))
with open(REPORTS / "metrics.json", "w") as f:
    json.dump(models_export["metrics"], f, indent=2)

# =========================================================== model card
mt = triage_metrics
card = f"""# FOD Guard 2 model card

Trained on {len(inc):,} synthetic loose-object records and {len(shifts):,} area-shift rows.
No plant data was used. Retrain on your own data before relying on the numbers.

## 1. Triage (text classifier)

TF-IDF (unigrams and bigrams, {len(vocab):,} terms, sublinear tf) feeding multinomial
logistic regression. Held-out test set: {mt['area']['test_rows']:,} records (20%, stratified).

| Head | Classes | Top-1 accuracy | Top-3 accuracy | Macro F1 |
|---|---|---|---|---|
| Source area | {mt['area']['classes']} | {mt['area']['top1_accuracy']:.1%} | {mt['area']['top3_accuracy']:.1%} | {mt['area']['macro_f1']:.3f} |
| Object category | {mt['object_category']['classes']} | {mt['object_category']['top1_accuracy']:.1%} | {mt['object_category']['top3_accuracy']:.1%} | {mt['object_category']['macro_f1']:.3f} |
| Root cause | {mt['root_cause']['classes']} | {mt['root_cause']['top1_accuracy']:.1%} | {mt['root_cause']['top3_accuracy']:.1%} | {mt['root_cause']['macro_f1']:.3f} |

About 20% of descriptions carry no area cue on purpose, so the area head can't be
perfect. Show the top three to the technician, not just the first.

## 2. Risk (Poisson regression)

Loose objects per area and shift, with vehicles built as exposure. Inputs: area,
night shift, share of new associates (people-driven areas), downtime hours, and
the ramp of each of 7 countermeasure levers by area. Countermeasures launched on
the same day are grouped into one lever because their effects can't be separated.

- Hold-out: {risk_metrics['holdout']}
- Deviance explained (D²) on a random 20% hold-out: {risk_metrics['d2_random_holdout']:.3f}
- Forecast check on the last 4 weeks: daily plant rate mean absolute error
  {risk_metrics['daily_rate_mae_holdout']:.2f} per 100 vehicles, against an actual mean of
  {risk_metrics['holdout_mean_rate']:.2f}. (D² on those 4 weeks alone is {risk_metrics['d2_holdout']:.2f},
  because counts that low are mostly noise.)

## 3. Impact

The risk model run lever by lever in launch order, at baseline staffing and
downtime. Baseline {steps[0]['rate']:.1f} per 100 vehicles, all levers on
{steps[-1]['rate']:.2f} per 100 vehicles.

## Limits

- Synthetic data follows the patterns it was built with; real data will be noisier.
- The risk model has no memory of compliance slipping (for example the October
  spike); that is what the anomaly alert is for.
- Text triage only knows words seen in training. New part names need retraining.
"""
(REPORTS / "model_card.md").write_text(card)
sz = lambda p: f"{(APP / 'data' / p).stat().st_size / 1024:.0f} KB"
print("plant.json", sz("plant.json"), " models.json", sz("models.json"))
