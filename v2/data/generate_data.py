"""FOD Guard 2 - synthetic loose-object data generator.

Simulates 26 weeks of a vehicle General Assembly + End-of-Line operation
(two 10.5-hour shifts a day, seven days a week, about 50 jobs per hour) and the
loose objects found at the Vehicle Drive Test (VDT).

The simulation is calibrated to the loose-object control program described in
the case study:
  * baseline: about 20 loose objects per 100 vehicles (about 200 a day)
  * an 8D rollout of countermeasures over about 9 weeks
  * about 95% fewer loose objects afterward (about 1 per 100 vehicles)
  * source split: Marriage 20%, Post-marriage 20%, Pre-marriage 15%,
    Subframe 15%, Paint 10%, EOL repair 10%, BIW 5%, Supplier modules 5%
  * object Pareto: fasteners > push clips > zip ties > tools/fixtures >
    weld slag > dirt/debris > personal items
  * about 30 minutes of technician time per find before, about 15 after
  * spikes before breaks and at shift handover, and with new associates

No plant data is used. Every record is synthetic.

Outputs (in ./data):
  incidents.csv   one row per loose object found
  shifts.csv      one row per date x shift x area (exposure and conditions)
"""
from __future__ import annotations

import csv
import math
import random
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np

SEED = 192   # a draw whose 4-week baseline lands near the case study: about 1,000 cars, 20 per 100, 30 min a find
rng = np.random.default_rng(SEED)
random.seed(SEED)

OUT = Path(__file__).resolve().parent

START = date(2026, 5, 25)          # Monday; 26 weeks end Sunday Nov 22, 2026
WEEKS = 26
DAYS = WEEKS * 7
ROLLOUT_START = START + timedelta(weeks=4)   # baseline = first 4 weeks
JPH = 50
SHIFT_HOURS = 10.5
SHIFTS = ["Day", "Night"]
LABOR_RATE = 28.0                  # $ per technician hour

AREAS = ["BIW", "Paint", "Subframe", "Pre-marriage", "Marriage",
         "Post-marriage", "EOL repair", "Supplier"]
AREA_SHARE = {"BIW": .05, "Paint": .10, "Subframe": .15, "Pre-marriage": .15,
              "Marriage": .20, "Post-marriage": .20, "EOL repair": .10,
              "Supplier": .05}
AREA_CODE = {"BIW": "BIW", "Paint": "PNT", "Subframe": "SUB", "Pre-marriage": "PRE",
             "Marriage": "MAR", "Post-marriage": "PST", "EOL repair": "EOL",
             "Supplier": "SUP"}
STATIONS_PER_AREA = {"BIW": 6, "Paint": 4, "Subframe": 10, "Pre-marriage": 12,
                     "Marriage": 8, "Post-marriage": 14, "EOL repair": 6, "Supplier": 2}

# ---------------------------------------------------------------- root causes
# cause -> (object category, 6M branch, plain-language label)
CAUSES = {
    "extra_in_hand":   ("Fasteners", "People", "Extra fasteners carried and dropped"),
    "left_at_break":   ("Fasteners", "Method", "Left on the vehicle at a break or downtime"),
    "rejected_manual": ("Fasteners", "People", "Rejected bolt left after a wrong shot"),
    "robot_drop":      ("Fasteners", "Machine", "Robot NOK rundown dropped the bolt"),
    "clip_broken":     ("Push clips", "Material", "Push clip broke on install"),
    "clip_dropped":    ("Push clips", "People", "Spare push clip dropped"),
    "zip_tail":        ("Zip ties", "Method", "Zip-tie tail cut and dropped"),
    "tool_forgotten":  ("Tools and fixtures", "People", "Tool or jig forgotten in the vehicle"),
    "paint_fixture":   ("Tools and fixtures", "Method", "Paint fixture or guide pin not removed"),
    "eol_leftover":    ("Tools and fixtures", "Method", "Left behind after an EOL repair"),
    "biw_slag":        ("Weld slag", "Machine", "Weld slag trapped in a body cavity"),
    "supplier_sealed": ("Fasteners", "Material", "Sealed inside a supplier module"),
    "housekeeping":    ("Dirt and debris", "Environment", "Dirt or debris carried to the vehicle"),
    "personal":        ("Personal items", "Environment", "Personal item dropped in the vehicle"),
}

# Within-area cause mix at baseline (raw weights, normalized below).
AREA_CAUSE_MIX = {
    "BIW":           {"biw_slag": .96, "housekeeping": .04},
    "Paint":         {"paint_fixture": .88, "housekeeping": .05, "personal": .07},
    "Subframe":      {"extra_in_hand": .36, "left_at_break": .25, "rejected_manual": .12,
                      "robot_drop": .15, "tool_forgotten": .03, "housekeeping": .02, "zip_tail": .05},
    "Pre-marriage":  {"extra_in_hand": .20, "left_at_break": .14, "rejected_manual": .07,
                      "clip_broken": .32, "clip_dropped": .04, "zip_tail": .12,
                      "tool_forgotten": .03, "personal": .03, "housekeeping": .02},
    "Marriage":      {"extra_in_hand": .15, "left_at_break": .11, "rejected_manual": .05,
                      "robot_drop": .10, "clip_broken": .20, "clip_dropped": .03,
                      "zip_tail": .28, "tool_forgotten": .03, "housekeeping": .02, "personal": .02},
    "Post-marriage": {"extra_in_hand": .13, "left_at_break": .12, "rejected_manual": .05,
                      "clip_broken": .27, "clip_dropped": .03, "zip_tail": .28,
                      "tool_forgotten": .03, "housekeeping": .02, "personal": .03},
    "EOL repair":    {"eol_leftover": .65, "zip_tail": .15, "housekeeping": .08, "personal": .06,
                      "extra_in_hand": .06},
    "Supplier":      {"supplier_sealed": 1.0},
}
for _a, _m in AREA_CAUSE_MIX.items():
    _t = sum(_m.values())
    AREA_CAUSE_MIX[_a] = {k: v / _t for k, v in _m.items()}

# Target share of each cause among the loose objects that remain after the
# program (sustain phase). Together with the 95% overall reduction this sets
# how strong each countermeasure has to be.
FINAL_SHARE = {"extra_in_hand": .16, "left_at_break": .14, "rejected_manual": .05,
               "robot_drop": .04, "zip_tail": .12, "clip_broken": .01, "clip_dropped": .04,
               "tool_forgotten": .07, "paint_fixture": .07, "eol_leftover": .08,
               "biw_slag": .06, "supplier_sealed": .01, "housekeeping": .10, "personal": .05}
OVERALL_REMAINING = 0.0475   # lands the sustain phase near 1 per 100 (95% reduction)

# ---------------------------------------------------------------- countermeasures
@dataclass
class CM:
    key: str
    name: str
    week: float          # weeks after rollout start
    level: str           # Eliminate | Engineer | Administer | Detect
    owner: str
    causes: dict         # cause -> final multiplier from this countermeasure

CMS = [
    CM("cm_clean", "Clean before you leave and hourly clean-up check", 0.0, "Administer", "Line leads",
       {"left_at_break": None, "zip_tail": None, "housekeeping": None, "personal": None}),
    CM("cm_tier", "Daily quality meeting and line ownership", 0.0, "Administer", "Production managers",
       {c: .82 for c in ["extra_in_hand", "left_at_break", "rejected_manual", "clip_dropped",
                         "zip_tail", "tool_forgotten", "eol_leftover", "housekeeping", "personal"]}
       | {"biw_slag": None}),
    CM("cm_robot", "Robot wrong-shot process alert and training", 1.0, "Administer", "Robotics, line leads",
       {"robot_drop": None}),
    CM("cm_magnetic", "Magnetic chairs and point-of-use fastener racks", 2.0, "Engineer", "Manufacturing engineering",
       {"extra_in_hand": None, "rejected_manual": None, "clip_dropped": None}),
    CM("cm_shadow", "Shadow boards for tools and jigs", 3.0, "Engineer", "Manufacturing engineering",
       {"tool_forgotten": None}),
    CM("cm_paint", "Paint jig and fixture checklist", 3.0, "Administer", "Paint",
       {"paint_fixture": None}),
    CM("cm_eolcheck", "EOL post-repair exit checklist", 4.0, "Administer", "EOL repair",
       {"eol_leftover": None}),
    CM("cm_bumps", "VDT route rebuilt with added bumps", 4.0, "Detect", "EOL, quality", {}),
    CM("cm_clip", "Push clip redesign (material and structure)", 5.0, "Eliminate", "Design engineering",
       {"clip_broken": None}),
    CM("cm_scar", "Supplier SCAR and containment at source", 6.0, "Administer", "Supplier quality, EOL",
       {"supplier_sealed": None}),
    CM("cm_camera", "Magnetic camera retrieval tool with hooks", 7.0, "Engineer", "EOL, ME", {}),
]
RAMP_DAYS = 6.0   # how fast a countermeasure reaches full effect

# Global baseline share of each cause.
BASE_CAUSE_SHARE = {}
for _a, _m in AREA_CAUSE_MIX.items():
    for _c, _v in _m.items():
        BASE_CAUSE_SHARE[_c] = BASE_CAUSE_SHARE.get(_c, 0) + AREA_SHARE[_a] * _v

# Solve each countermeasure's primary factor so that every cause lands on its
# FINAL_SHARE of the remaining 5%.
for _c, _base in BASE_CAUSE_SHARE.items():
    need = OVERALL_REMAINING * FINAL_SHARE[_c] / _base
    fixed = 1.0
    prim = None
    for _cm in CMS:
        if _c in _cm.causes:
            if _cm.causes[_c] is None:
                prim = _cm
            else:
                fixed *= _cm.causes[_c]
    prim.causes[_c] = need / fixed

# The simulation multiplies the rate by night-shift, staffing and downtime
# effects, so scale the input rate to land on 20 loose objects per 100 vehicles.
BASE_RATE = 17.65

# Unplanned stops: about 30 minutes per 10.5-hour shift, so the line builds
# about 50 x 10 = 500 cars a shift and about 1,000 a day.
DOWNTIME_SCALE = 18.75

# Technician minutes per find: about 30 before the program and about 15 after.
MIN_SCALE_BEFORE = 0.968
MIN_SCALE_AFTER = 1.06


def cm_progress(cm: CM, d: date) -> float:
    start = ROLLOUT_START + timedelta(days=round(cm.week * 7))
    t = (d - start).days
    if t < 0:
        return 0.0
    return 1.0 - math.exp(-t / (RAMP_DAYS / 3.0))


def cause_multiplier(cause: str, d: date, compliance: float = 1.0) -> float:
    m = 1.0
    for cm in CMS:
        f = cm.causes.get(cause)
        if f is None:
            continue
        p = cm_progress(cm, d) * compliance
        m *= f ** p
    return m


# ---------------------------------------------------------------- text generation
ZONES = {
    "floor": ("Floor pan, under carpet", "C"),
    "door": ("Door cavity", "B"),
    "ip": ("IP / dash cavity", "B"),
    "console": ("Center console", "B"),
    "sill": ("Rocker / sill cavity", "B"),
    "trunk": ("Trunk / frunk", "C"),
    "seat": ("Seat track area", "C"),
    "underbody": ("Underbody / subframe", "B"),
    "hv": ("HV battery area", "A"),
    "pedal": ("Pedal box", "A"),
}
CAUSE_ZONES = {
    "extra_in_hand": {"floor": .32, "underbody": .22, "seat": .14, "door": .12, "trunk": .08, "hv": .03, "pedal": .02, "sill": .07},
    "left_at_break": {"floor": .36, "seat": .18, "trunk": .14, "underbody": .14, "door": .10, "hv": .03, "pedal": .02, "sill": .03},
    "rejected_manual": {"floor": .30, "underbody": .32, "seat": .16, "door": .12, "hv": .04, "pedal": .03, "sill": .03},
    "robot_drop": {"underbody": .55, "floor": .25, "hv": .08, "sill": .12},
    "clip_broken": {"door": .46, "ip": .22, "floor": .14, "trunk": .10, "sill": .08},
    "clip_dropped": {"door": .30, "floor": .40, "ip": .15, "trunk": .15},
    "zip_tail": {"ip": .32, "floor": .26, "trunk": .14, "door": .14, "underbody": .10, "hv": .04},
    "tool_forgotten": {"floor": .40, "trunk": .25, "seat": .15, "door": .10, "underbody": .10},
    "paint_fixture": {"sill": .45, "door": .25, "trunk": .15, "floor": .15},
    "eol_leftover": {"floor": .30, "ip": .18, "door": .18, "console": .10, "trunk": .14, "seat": .10},
    "biw_slag": {"sill": .65, "door": .20, "floor": .15},
    "supplier_sealed": {"console": .62, "ip": .38},
    "housekeeping": {"floor": .55, "trunk": .20, "seat": .15, "door": .10},
    "personal": {"floor": .45, "seat": .30, "console": .15, "trunk": .10},
}

OBJECTS = {
    "extra_in_hand": ["M6x16 flange bolt", "M8 flange nut", "M6 washer", "M5 screw", "M8x20 bolt", "M10 nut"],
    "left_at_break": ["M6x16 flange bolt", "M8 flange nut", "M6 washer", "M8x20 bolt", "M5 screw"],
    "rejected_manual": ["cross-threaded M8 bolt", "stripped M6 bolt", "damaged M10 bolt"],
    "robot_drop": ["cross-threaded M12 bolt", "M10 bolt with damaged thread", "rejected M12 flange bolt"],
    "clip_broken": ["broken push clip", "broken trim clip", "snapped door panel clip", "broken fir-tree clip"],
    "clip_dropped": ["new push clip", "unused trim clip", "spare fir-tree clip"],
    "zip_tail": ["zip-tie tail", "cut zip-tie end", "broken zip tie"],
    "tool_forgotten": ["socket", "small spanner", "trim tool", "assembly jig pin"],
    "paint_fixture": ["paint guide pin", "masking jig", "door holding fixture", "hood prop fixture"],
    "eol_leftover": ["spanner", "spanner", "flush cutter", "flush cutter", "repair rag", "dry adhesive lump",
                     "loose M6 screw after rework", "loose M6 screw after rework", "loose M5 screw after rework",
                     "trim tool", "socket", "loose M5 screw after rework"],
    "biw_slag": ["weld slag", "weld spatter bead", "sand-like grit"],
    "supplier_sealed": ["M4 screw", "plastic clip", "M5 screw", "retaining clip", "M4 screw", "M5 screw"],
    "housekeeping": ["sand from shoes", "gum wrapper", "candy wrapper", "rag fragment"],
    "personal": ["lip balm", "press-on nail", "ring", "pen cap"],
}
MATERIAL = {"clip_broken": "plastic", "clip_dropped": "plastic", "zip_tail": "plastic",
            "housekeeping": "organic", "personal": "plastic", "supplier_sealed": "metallic"}

AREA_CUES = {
    "BIW": ["sill cavity", "body shop", "weld seam", "rocker inner"],
    "Paint": ["paint hospital", "after paint", "e-coat", "paint shop"],
    "Subframe": ["subframe", "front cradle", "rear cradle", "suspension mount"],
    "Pre-marriage": ["underbody", "brake line", "floor pan", "heat shield"],
    "Marriage": ["battery bracket", "decking", "harness", "drive unit mount"],
    "Post-marriage": ["seat bolt", "door trim", "carpet", "trim panel"],
    "EOL repair": ["after repair", "rework bay", "repair tech", "after teardown"],
    "Supplier": ["inside center console", "inside IP module", "sealed module", "supplier assembly"],
}
SYMPTOMS = ["Rattle at the bump section", "Clicking on hard stop", "Buzz at highway speed",
            "Rattle on left turns", "Knock over rough road", "Clunk on sudden stop",
            "Light tick on right turns", "Noise during weave test"]
VERBS = ["found", "pulled", "removed", "retrieved", "located"]


def object_category(obj: str, cause: str) -> str:
    o = obj.lower()
    if "zip" in o:
        return "Zip ties"
    if "clip" in o:
        return "Push clips"
    if any(k in o for k in ("slag", "spatter", "grit")):
        return "Weld slag"
    if any(k in o for k in ("rag", "adhesive", "sand", "wrapper")):
        return "Dirt and debris"
    if any(k in o for k in ("lip balm", "nail", "ring", "pen cap")):
        return "Personal items"
    if any(k in o for k in ("bolt", "nut", "washer", "screw")):
        return "Fasteners"
    return "Tools and fixtures"


VAGUE = {"metallic": ["small metal part", "metal piece", "piece of hardware"],
         "plastic": ["plastic piece", "small plastic part", "hard plastic bit"],
         "organic": ["debris", "small piece of debris"]}


ZONE_TEXT = {"floor": "floor pan, under carpet", "door": "door cavity", "ip": "IP / dash cavity",
             "console": "center console", "sill": "rocker / sill cavity", "trunk": "trunk / frunk",
             "seat": "seat track area", "underbody": "underbody / subframe", "hv": "HV battery area",
             "pedal": "pedal box"}
NEAR_AREAS = {"BIW", "Subframe", "Pre-marriage", "Marriage", "Post-marriage"}


def describe(cause: str, area: str, obj: str, zone_key: str, vdt_run: int, material: str = "metallic") -> str:
    zone = ZONE_TEXT[zone_key]
    if random.random() < 0.12:          # technicians don't always name the part
        obj = random.choice(VAGUE[material])
    sym = random.choice(SYMPTOMS)
    verb = random.choice(VERBS)
    r = random.random()
    cue = random.choice(AREA_CUES[area]) if random.random() < 0.80 else None
    parts = []
    if r < 0.55:
        parts.append(f"{sym}, VDT run {vdt_run}.")
        joiner = " near " if area in NEAR_AREAS else ", "
        parts.append(f"Tech {verb} {obj} from {zone}" + (f"{joiner}{cue}." if cue else "."))
    elif r < 0.85:
        parts.append(f"{obj[0].upper() + obj[1:]} {verb} in {zone}" + (f", {cue}." if cue else "."))
        parts.append(f"{sym.lower()} on run {vdt_run}.".capitalize())
    else:
        parts.append(f"Loose {obj} in {zone}" + (f" ({cue})" if cue else "") + ".")
    if cause == "eol_leftover" and random.random() < 0.6:
        parts.append("Vehicle had been in the repair bay.")
    if cause == "supplier_sealed" and random.random() < 0.6:
        parts.append("Module was sealed when received.")
    if cause in ("rejected_manual", "robot_drop") and random.random() < 0.5:
        parts.append("Thread damaged, looks like a wrong shot.")
    if cause == "left_at_break" and random.random() < 0.4:
        parts.append("Same fastener type as station install, found right after break.")
    if cause == "clip_broken" and random.random() < 0.5:
        parts.append("Clip head snapped off.")
    return " ".join(parts)


# ---------------------------------------------------------------- simulation
BREAKS = [2.0, 4.5, 7.5]   # hours into the shift; handover at 10.5


def sample_hour(cause: str) -> float:
    if cause == "left_at_break":
        if random.random() < 0.82:
            b = random.choice(BREAKS + [SHIFT_HOURS, SHIFT_HOURS])
            return max(0.0, b - random.uniform(0, 0.6))
    if cause in ("extra_in_hand", "rejected_manual", "zip_tail") and random.random() < 0.18:
        return max(0.0, SHIFT_HOURS - random.uniform(0, 0.7))
    return random.uniform(0, SHIFT_HOURS)


def weighted(d: dict):
    keys = list(d.keys())
    w = np.array(list(d.values()), dtype=float)
    return keys[rng.choice(len(keys), p=w / w.sum())]


def main():
    incidents = []
    shift_rows = []
    seq = 0
    new_assoc_week = {}
    for w in range(WEEKS):
        base = 0.08 + 0.03 * math.sin(w / 3.0)
        if w in (9, 21):          # hiring waves
            base += 0.09
        new_assoc_week[w] = max(0.03, base + rng.normal(0, 0.012))

    spike_start, spike_end = date(2026, 10, 12), date(2026, 10, 15)

    for day in range(DAYS):
        d = START + timedelta(days=day)
        week = day // 7
        phase = "Baseline" if d < ROLLOUT_START else (
            "Rollout" if d < ROLLOUT_START + timedelta(weeks=9) else "Sustain")
        for shift in SHIFTS:
            downtime = float(min(120, rng.gamma(1.6, DOWNTIME_SCALE)))
            vehicles = int(round(JPH * (SHIFT_HOURS - downtime / 60.0) + rng.normal(0, 6)))
            night = 1.12 if shift == "Night" else 1.0
            for area in AREAS:
                new_share = new_assoc_week[week] + rng.normal(0, 0.01)
                compliance = 1.0
                spike = 1.0
                if area == "Post-marriage" and shift == "Night" and spike_start <= d <= spike_end:
                    new_share += 0.22
                    compliance = 0.25
                    spike = 1.6
                new_share = float(min(0.6, max(0.0, new_share)))
                person = 1.0 + 3.0 * (new_share - 0.08)
                down_eff = 1.0 + downtime / 70.0
                lam_area = vehicles / 100.0 * BASE_RATE * AREA_SHARE[area] * night * spike
                n_area = 0
                for cause, share in AREA_CAUSE_MIX[area].items():
                    mult = cause_multiplier(cause, d, compliance)
                    lam = lam_area * share * mult
                    if cause in ("extra_in_hand", "rejected_manual", "clip_dropped", "tool_forgotten", "left_at_break"):
                        lam *= person
                    if cause == "left_at_break":
                        lam *= down_eff
                    n = rng.poisson(lam)
                    n_area += n
                    for _ in range(n):
                        seq += 1
                        _, branch, label = CAUSES[cause]
                        zone_key = weighted(CAUSE_ZONES[cause])
                        zone_label, sev = ZONES[zone_key]
                        material = MATERIAL.get(cause, "metallic")
                        obj = random.choice(OBJECTS[cause])
                        cat = object_category(obj, cause)
                        if "rag" in obj or "adhesive" in obj or "sand" in obj or "wrapper" in obj:
                            material = "organic"
                        if "clip" in obj or "lip balm" in obj or "nail" in obj or "cap" in obj:
                            material = "plastic"
                        internal = sev in ("A", "B")
                        bumps = cm_progress(CMS[7], d)
                        camera = cm_progress(CMS[10], d)
                        # VDT runs needed to find and clear
                        p1 = (0.36 if material == "metallic" else 0.17) + 0.25 * bumps
                        if not internal:
                            p1 += 0.30
                        runs = 1
                        while runs < 4 and random.random() > min(0.97, p1):
                            runs += 1
                        # technician minutes to find and remove, including one VDT run
                        if internal:
                            mins = rng.lognormal(math.log(30), 0.45) * (1 - 0.55 * camera)
                            if material == "plastic":
                                mins *= 1.25 * (1 - 0.15 * camera)
                            if random.random() < 0.006 * (1 - camera):
                                mins = rng.uniform(240, 480)        # teardown outliers
                        else:
                            mins = rng.lognormal(math.log(15), 0.35) * (1 - 0.25 * camera)
                        mins += 2.0 * (runs - 1)
                        mins *= MIN_SCALE_BEFORE + (MIN_SCALE_AFTER - MIN_SCALE_BEFORE) * camera
                        mins = float(round(max(6.0, mins), 1))
                        teardown = bool(internal and random.random() < 0.55 * (1 - 0.75 * camera))
                        escaped = bool(random.random() < (0.0045 * (1 - 0.7 * bumps)) / (1 if internal else 2))
                        hour = round(sample_hour(cause), 2)
                        st = f"{AREA_CODE[area]}-{rng.integers(1, STATIONS_PER_AREA[area] + 1):02d}"
                        model = "Sedan" if random.random() < 0.55 else "Crossover"
                        vin = ("SDN" if model == "Sedan" else "CRS") + f"{rng.integers(100000, 999999)}"
                        tenure = int(rng.integers(1, 30)) if random.random() < new_share * 2.2 else int(rng.integers(30, 1500))
                        incidents.append({
                            "id": f"LO-{seq:06d}",
                            "date": d.isoformat(),
                            "shift": shift,
                            "hour_of_shift": hour,
                            "phase": phase,
                            "area": area,
                            "station": st,
                            "object_category": cat,
                            "object": obj,
                            "material": material,
                            "root_cause": cause,
                            "root_cause_label": label,
                            "branch_6m": branch,
                            "zone": zone_label,
                            "severity": sev,
                            "vdt_runs": runs,
                            "minutes": mins,
                            "cost_usd": round(mins / 60.0 * LABOR_RATE, 2),
                            "teardown": teardown,
                            "escaped_to_customer": escaped,
                            "associate_tenure_days": tenure,
                            "vehicle_model": model,
                            "vin": vin,
                            "description": describe(cause, area, obj, zone_key, runs, material),
                        })
                shift_rows.append({
                    "date": d.isoformat(), "shift": shift, "area": area, "phase": phase,
                    "vehicles": vehicles, "downtime_min": round(downtime, 1),
                    "new_assoc_share": round(new_share, 4), "loose_objects": n_area,
                })

    with open(OUT / "incidents.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(incidents[0].keys()))
        w.writeheader()
        w.writerows(incidents)
    with open(OUT / "shifts.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(shift_rows[0].keys()))
        w.writeheader()
        w.writerows(shift_rows)
    print(f"incidents: {len(incidents):,}  shift-area rows: {len(shift_rows):,}")


if __name__ == "__main__":
    main()
