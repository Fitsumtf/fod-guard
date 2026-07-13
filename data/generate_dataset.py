"""Generate a realistic synthetic loose-object incident dataset (no real OEM data).

Distributions follow expert production estimates:
  sources: ~40% subframe, ~30% pre-marriage+marriage, ~20% post-marriage, ~10% other
  objects: screws > push clips > nuts > washers > tape > wire > dirt > slag > rivets > tools
  ~5% supplier-attributed (center console / IP assemblies)

Run:  python data/generate_dataset.py
"""

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from fod_guard.taxonomy import (OBJECT_TYPES, SOURCE_DISTRIBUTION, ZONES,
                                STATION_INDEX)
from fod_guard.core import estimate_cost

random.seed(42)
N = 120

NOISES = ["rattling", "clicking", "ticking", "clunking", "rolling", "buzzing"]
MANEUVERS = ["left-right weave at 35 mph", "hard-stop brake test",
             "quick lane-change maneuver", "rough-road section",
             "acceleration ramp"]
LOCS = {
    "battery enclosure": ["battery tray", "pack perimeter seal area", "module bay"],
    "HV junction area": ["HV junction box vicinity", "penthouse area", "HV cable channel"],
    "underbody / subframe": ["rear subframe pocket", "front subframe crossmember", "underbody shield"],
    "door cavity": ["LH front door cavity", "RH rear door cavity", "door inner panel"],
    "dash / IP cavity": ["behind IP carrier", "dash crossbeam area", "HVAC duct pocket"],
    "seat track area": ["under driver seat track", "rear bench mounting area"],
    "under carpet": ["under front carpet", "under rear footwell carpet"],
    "center console": ["inside center console bin", "console side trim"],
    "carpet (visible)": ["on front carpet", "on rear footwell carpet"],
    "trunk / frunk": ["trunk floor", "frunk tub"],
}

ROOT_CAUSES = [
    ("dropped during fastening; not retrieved under {ct}s cycle-time pressure",
     ["screw", "nut", "metallic washer", "plastic washer"]),
    ("cross-threaded fastener replaced; original left in vehicle",
     ["screw", "nut"]),
    ("clip broke during installation with incorrect gun; fragments fell into cavity",
     ["push clip"]),
    ("arrived loose inside supplier-built assembly (incoming control gap)",
     ["screw", "push clip"]),
    ("masking/harness tape discarded into open cavity instead of waste bin",
     ["waste tape"]),
    ("harness trimming performed over open body; offcut not collected",
     ["wire trimming"]),
    ("carried in on shoes / transport cart; unclean rack from warehouse",
     ["stones/sand/dirt"]),
    ("spatter not fully removed after weld operation",
     ["weld slag"]),
    ("casting flash/slag detached during handling downstream",
     ["cast slag"]),
    ("rivet mandrel snapped and fragment ejected into cavity",
     ["broken rivet"]),
    ("hand tool left in work area after task; missed at shadow-board check",
     ["tool/jig/fixture"]),
]

CORRECTIVES = {
    "screw": "Magnetic point-of-use plate installed; return-to-lead accountability with origin trace (CM-02/CM-05)",
    "nut": "Magnetic point-of-use plate installed; technician retraining on drop-retrieval rule (CM-04/CM-05)",
    "metallic washer": "Magnetic plate at station; drop-event log added to check sheet (CM-01/CM-05)",
    "plastic washer": "Non-magnetic retrieval kit issued; drop-event log added (CM-01)",
    "push clip": "Clip gun standardized and clip material redesigned to prevent breakage (CM-07)",
    "waste tape": "Waste pouch on operator apron; cavity-open tape discipline in check sheet (CM-01)",
    "wire trimming": "Trim-over-tray rule; harness prep moved off-line (CM-06)",
    "stones/sand/dirt": "Cart wheel cleaning station; rack cleaning added to warehouse 5S (CM-05/CM-06)",
    "weld slag": "Post-weld spatter inspection added to quality-inspector checklist (CM-01)",
    "cast slag": "Deflash verification at casting exit; inspector sign-off (CM-01)",
    "broken rivet": "Mandrel-catch attachment fitted to rivet gun (CM-07)",
    "tool/jig/fixture": "Shadow board audit at shift end; tool count sign-off (CM-05)",
}

DETECT_BY_STAGE = {
    "same": ["in-station visual", "quality inspector audit"],
    "late": ["EOL inspection", "VDT dynamic test", "water test"],
    "field": ["customer report"],
}


def weighted_choice(d):
    items, weights = zip(*d.items())
    return random.choices(items, weights=weights, k=1)[0]


rows = []
for i in range(1, N + 1):
    obj = weighted_choice({k: v[1] for k, v in OBJECT_TYPES.items()})
    material = OBJECT_TYPES[obj][0]
    src = weighted_choice(SOURCE_DISTRIBUTION)

    supplier = False
    zone = random.choice(list(ZONES))
    # ~5% supplier-attributed: loose screws/clips inside console/IP assemblies
    if obj in ("screw", "push clip") and random.random() < 0.18:
        supplier = True
        zone = random.choice(["center console", "dash / IP cavity"])
    # metallic objects near HV occur mostly around marriage stations
    if zone in ("battery enclosure", "HV junction area") and src in ("BIW", "Casting", "Paint"):
        zone = "underbody / subframe"
    crit = ZONES[zone]

    # Detection: most caught same/near station; meaningful share escapes to
    # EOL/VDT; small tail reaches the customer (post-95%-reduction regime).
    r = random.random()
    if r < 0.55:
        det_station = src
        method = random.choice(DETECT_BY_STAGE["same"])
    elif r < 0.97:
        det_station = random.choices(
            ["Water test", "End of line", "Final inspection", "VDT"],
            weights=[0.1, 0.25, 0.15, 0.5])[0]
        method = {"Water test": "water test", "End of line": "EOL inspection",
                  "Final inspection": "EOL inspection",
                  "VDT": "VDT dynamic test"}[det_station]
        if STATION_INDEX[det_station] <= STATION_INDEX[src]:
            det_station, method = "VDT", "VDT dynamic test"
    else:
        det_station, method = "Customer/field", "customer report"

    # Severity
    if det_station == src:
        sev = "Class D — Contained"
    elif crit == "safety-critical":
        sev = "Class A — Critical"
    elif crit == "internal":
        sev = "Class B — Major"
    else:
        sev = "Class C — Minor"

    damage = "none"
    if sev.startswith(("Class A", "Class B")) and random.random() < 0.22:
        damage = "paint scratch" if random.random() < 0.7 else "part damaged"

    cost_lines = estimate_cost(sev, material, damage)
    cost = cost_lines["TOTAL"]
    hours = round(cost_lines.get("teardown", 0) / 35
                  + cost_lines.get("reassembly", 0) / 35
                  + cost_lines.get("external search & removal", 0) / 35
                  + cost_lines.get("search (material-adjusted)", 0) / 35
                  + 0.1, 1)

    loc = random.choice(LOCS[zone])
    rc_template, _ = random.choice(
        [rc for rc in ROOT_CAUSES if obj in rc[1]] or [ROOT_CAUSES[0]])
    root_cause = rc_template.format(ct=random.choice([90, 100, 120]))
    if supplier:
        root_cause = "arrived loose inside supplier-built assembly (incoming control gap)"

    if method == "VDT dynamic test":
        desc = (f"{random.choice(NOISES).capitalize()} noise from {loc} during "
                f"{random.choice(MANEUVERS)}; retrieved {obj} lodged near {loc}.")
    elif method == "customer report":
        desc = (f"Customer reported {random.choice(NOISES)} noise; dealer "
                f"retrieved {obj} from {loc}.")
    else:
        desc = (f"{obj.capitalize()} found {('in ' if not loc.startswith(('on','under','behind','inside')) else '')}{loc} "
                f"during {method}; origin traced to {src}.")

    rows.append(dict(
        record_id=f"FOD-{i:04d}", object_type=obj, material=material,
        station_introduced=src, station_detected=det_station,
        vehicle_zone=zone, zone_criticality=crit, detection_method=method,
        supplier_attributed=supplier, severity_class=sev, description=desc,
        root_cause=root_cause, corrective_action=CORRECTIVES[obj],
        removal_time_hr=hours, secondary_damage=damage, total_cost_usd=cost,
    ))

df = pd.DataFrame(rows)
out = Path(__file__).parent / "fod_incidents.csv"
df.to_csv(out, index=False)
print(f"Wrote {len(df)} incidents -> {out}")
print("\nSource distribution check:")
print((df.station_introduced.value_counts(normalize=True) * 100).round(1))
print("\nSeverity mix:")
print(df.severity_class.value_counts())
