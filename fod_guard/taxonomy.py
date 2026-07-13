"""fod_guard.taxonomy — controlled vocabularies for loose-object (product-FOD) control.

Encodes domain knowledge from 20+ years of manufacturing & process engineering
experience in EV vehicle assembly, aligned with aerospace FOD-prevention
practice (SAE AS9146, NAS 412, IAQG SCMH 3.4).

Terminology note: what vehicle assembly calls a "loose object" is what
aerospace standards call *product FOD* — a foreign object that could remain
within the delivered unit (vs. *process FOD*, which disrupts production).
"""

# ---------------------------------------------------------------------------
# Object taxonomy — ranked by observed frequency in EV assembly
# ---------------------------------------------------------------------------

OBJECT_TYPES = {
    # name: (material_class, typical_frequency_weight)
    "screw":            ("metallic", 0.22),
    "push clip":        ("plastic",  0.18),   # both broken and unbroken clips
    "nut":              ("metallic", 0.12),
    "plastic washer":   ("plastic",  0.09),
    "metallic washer":  ("metallic", 0.08),
    "waste tape":       ("organic",  0.07),
    "wire trimming":    ("metallic", 0.06),
    "stones/sand/dirt": ("organic",  0.06),   # from shoes, transport carts, unclean racks
    "weld slag":        ("metallic", 0.03),
    "cast slag":        ("metallic", 0.02),
    "broken rivet":     ("metallic", 0.04),
    "tool/jig/fixture": ("metallic", 0.03),
}

# ---------------------------------------------------------------------------
# Station map — ordered EV assembly flow (introduction → detection distance
# along this sequence defines the "escape distance" of an incident)
# ---------------------------------------------------------------------------

STATIONS = [
    "BIW",
    "Casting",
    "Welding",
    "Paint",
    "Subassembly (subframe)",
    "Subassembly (other)",
    "Pre-marriage",
    "Marriage",
    "Post-marriage",
    "Water test",
    "End of line",
    "Final inspection",
    "VDT",            # Vehicle Drive Test — dynamic detection (weave, hard stop)
    "VRI / wrapping", # Vehicle Readiness Inspection
    "Customer/field",
]

STATION_INDEX = {s: i for i, s in enumerate(STATIONS)}

# Observed source distribution (expert estimate from production data):
#   ~40% subframe subassembly, ~30% pre-marriage + marriage,
#   ~20% post-marriage, ~10% other process lines.
SOURCE_DISTRIBUTION = {
    "Subassembly (subframe)": 0.40,
    "Pre-marriage":           0.15,
    "Marriage":               0.15,
    "Post-marriage":          0.20,
    "BIW":                    0.030,
    "Casting":                0.020,
    "Welding":                0.020,
    "Paint":                  0.015,
    "Subassembly (other)":    0.015,
}

# ---------------------------------------------------------------------------
# Vehicle zones and criticality
# ---------------------------------------------------------------------------

ZONES = {
    # zone: criticality
    "battery enclosure":    "safety-critical",  # metallic FOD → short-circuit / thermal-event risk
    "HV junction area":     "safety-critical",
    "underbody / subframe": "internal",
    "door cavity":          "internal",
    "dash / IP cavity":     "internal",
    "seat track area":      "internal",
    "under carpet":         "internal",
    "center console":       "cosmetic",  # major supplier-attributed source (console/IP assemblies)
    "carpet (visible)":     "cosmetic",
    "trunk / frunk":        "cosmetic",
}

# Roughly 5% of loose-object incidents are supplier-attributed, dominated by
# screws and clips arriving loose inside center-console and IP assemblies.
SUPPLIER_ATTRIBUTION_RATE = 0.05

# ---------------------------------------------------------------------------
# Detection methods
# ---------------------------------------------------------------------------

DETECTION_METHODS = [
    "in-station visual",       # line-side inspection at BIW/casting/welding/paint/assembly
    "quality inspector audit", # dedicated inspector per line (key countermeasure)
    "water test",
    "EOL inspection",
    "VDT dynamic test",        # 30-40 mph weave left/right + hard stop to dislodge objects
    "customer report",
]

# ---------------------------------------------------------------------------
# Severity classes — aerospace-style (adapted from AS9146 / NAS 412 practice)
# ---------------------------------------------------------------------------

SEVERITY_CLASSES = {
    "Class A — Critical": (
        "FOD in a safety-critical zone (battery enclosure, HV junction) or any "
        "metallic object with short-circuit/spark potential near HV components. "
        "Mandatory containment review and engineering disposition."
    ),
    "Class B — Major": (
        "FOD retained in an internal cavity requiring disassembly to retrieve "
        "(teardown + retrieval + reassembly + retest; typically > 4 hours, with "
        "secondary-damage risk such as paint scratches during teardown)."
    ),
    "Class C — Minor": (
        "FOD in an external/visible location (carpet, console surface, trunk); "
        "removable in ~20-30 minutes with retest."
    ),
    "Class D — Contained": (
        "Caught in-station before vehicle progression; no escape, no teardown. "
        "Logged for Pareto/trend analysis only."
    ),
}

# ---------------------------------------------------------------------------
# Countermeasure playbook — the interventions behind a ~95% reduction in
# retained loose objects, encoded as a reusable knowledge base
# ---------------------------------------------------------------------------

COUNTERMEASURES = [
    {
        "id": "CM-01",
        "name": "Dedicated quality inspectors per line",
        "detail": "Assign a quality inspector to each assembly line and to BIW, "
                  "casting, welding, and paint; structured check points with "
                  "sign-off forms; each technician accountable for each "
                  "loose-object nonconformance (NC).",
        "targets": ["all"],
    },
    {
        "id": "CM-02",
        "name": "Visual diagrams + return-to-lead accountability",
        "detail": "Visual diagram of every loose-object find reviewed in team "
                  "meetings; found objects returned to lead/supervisor to "
                  "identify exact origin and responsible station. Addresses the "
                  "dominant root cause: technicians dropping/forgetting objects "
                  "under 90-120 s cycle-time pressure (e.g., cross-threaded bolt "
                  "replaced but the original never retrieved).",
        "targets": ["screw", "nut", "metallic washer", "broken rivet"],
    },
    {
        "id": "CM-03",
        "name": "Supplier loose-object control",
        "detail": "Incoming control for supplier-built assemblies (center "
                  "console, IP) which arrive with loose screws/clips inside; "
                  "supplier corrective-action loop; ~5% of incidents are "
                  "supplier-attributed.",
        "targets": ["screw", "push clip"],
    },
    {
        "id": "CM-04",
        "name": "Training + senior technicians on critical lines",
        "detail": "Loose-object awareness training for all technicians; assign "
                  "senior technicians to the most critical lines (battery/HV "
                  "adjacent stations).",
        "targets": ["all"],
    },
    {
        "id": "CM-05",
        "name": "5S, shadow boards, magnetic plates",
        "detail": "5S with shadow boards for tools; magnetic plates for holding "
                  "bolts/nuts at the point of use so hardware cannot fall into "
                  "the vehicle. Note: magnetic pickup sticks do not retrieve "
                  "plastic objects (push clips, plastic washers) — plastic "
                  "retrieval takes materially longer.",
        "targets": ["screw", "nut", "metallic washer", "tool/jig/fixture"],
    },
    {
        "id": "CM-06",
        "name": "Ergonomic rack redesign",
        "detail": "Racks modified so parts and fasteners are within ergonomic "
                  "reach, minimizing back-and-forth movement that causes drops.",
        "targets": ["all"],
    },
    {
        "id": "CM-07",
        "name": "Push-clip system redesign",
        "detail": "Redesigned push-clip holding system with the appropriate "
                  "installation gun; clip material/mechanism redesign to prevent "
                  "breakage during assembly (broken clips are a top-2 object type).",
        "targets": ["push clip"],
    },
]
