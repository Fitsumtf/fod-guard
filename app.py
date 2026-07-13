"""FODGuard — Loose Object Control & Incident Intelligence for Vehicle Assembly.

Run locally:  streamlit run app.py
"""

import tempfile

import pandas as pd
import plotly.express as px
import streamlit as st

from fod_guard.core import (BM25Index, cost_summary, escape_matrix,
                            estimate_cost, load_incidents)
from fod_guard.report import generate_incident_report
from fod_guard.taxonomy import (COUNTERMEASURES, DETECTION_METHODS,
                                OBJECT_TYPES, SEVERITY_CLASSES, STATIONS,
                                ZONES)

st.set_page_config(page_title="FODGuard", page_icon="🔩", layout="wide")

st.title("🔩 FODGuard — Loose Object Control for Vehicle Assembly")
st.caption(
    "Product-FOD incident intelligence: BM25 similarity search over past "
    "incidents, escape-point analytics, and cost-of-escape modeling. "
    "Practices aligned with SAE AS9146 / NAS 412 (aerospace FOD prevention), "
    "adapted for EV assembly. Demo dataset is synthetic — no OEM data."
)

@st.cache_data
def _load():
    return load_incidents("data/fod_incidents.csv")

df = _load()
index = BM25Index(df)

page = st.sidebar.radio("Module", [
    "🔎 Find similar incidents",
    "📊 Escape analytics",
    "📝 Log incident & report",
    "📚 Countermeasure playbook",
])
st.sidebar.metric("Incidents in knowledge base", len(df))
st.sidebar.metric("Modeled cost of escapes", f"${df.total_cost_usd.sum():,.0f}")

# ===========================================================================
if page == "🔎 Find similar incidents":
    st.header("Find similar past incidents")
    st.write(
        "Describe a new find or symptom — e.g. a noise from VDT — and retrieve "
        "the most similar past incidents with their confirmed root causes and "
        "corrective actions."
    )
    q = st.text_input(
        "Describe the incident",
        placeholder="rattling noise from rocker panel during weave test, suspect weld slag",
    )
    k = st.slider("Results", 3, 10, 5)
    if q:
        res = index.query(q, top_k=k)
        if res.empty:
            st.info("No matching incidents — try different words (object, zone, noise, station).")
        for _, r in res.iterrows():
            with st.expander(
                f"**{r.record_id}** · {r.object_type} · {r.vehicle_zone} · "
                f"{r.severity_class} · score {r.bm25_score}"
            ):
                st.write(f"**Description:** {r.description}")
                st.write(f"**Introduced:** {r.station_introduced} → "
                         f"**Detected:** {r.station_detected} ({r.detection_method})")
                st.error(f"**Root cause:** {r.root_cause}")
                st.success(f"**Corrective action:** {r.corrective_action}")
                st.write(f"**Cost:** ${r.total_cost_usd:,.0f} · "
                         f"removal {r.removal_time_hr} h · "
                         f"secondary damage: {r.secondary_damage}")

# ===========================================================================
elif page == "📊 Escape analytics":
    st.header("Escape analytics")

    c1, c2 = st.columns(2)
    with c1:
        st.subheader("Where loose objects come from")
        src = df.station_introduced.value_counts().reset_index()
        src.columns = ["station", "incidents"]
        st.plotly_chart(px.bar(src, x="incidents", y="station", orientation="h",
                               color="incidents", color_continuous_scale="Reds"),
                        use_container_width=True)
    with c2:
        st.subheader("What the objects are")
        ob = df.object_type.value_counts().reset_index()
        ob.columns = ["object", "incidents"]
        st.plotly_chart(px.bar(ob, x="incidents", y="object", orientation="h",
                               color="incidents", color_continuous_scale="Oranges"),
                        use_container_width=True)

    st.subheader("Escape matrix — introduced (rows) vs detected (columns)")
    st.write(
        "Mass on the diagonal = caught at the source (cheap). Mass to the "
        "right = escapes; the farther right, the more expensive the retrieval."
    )
    m = escape_matrix(df)
    st.plotly_chart(px.imshow(m, text_auto=True, aspect="auto",
                              color_continuous_scale="YlOrRd",
                              labels=dict(x="Detected at", y="Introduced at",
                                          color="Incidents")),
                    use_container_width=True)

    st.subheader("Cost of escape by severity class")
    st.dataframe(cost_summary(df), use_container_width=True)
    st.write(
        "The asymmetry is the business case: a contained (Class D) find costs "
        "a few dollars of retrieval time; a Class A/B escape costs hundreds — "
        "teardown, retest, and secondary paint-damage risk included."
    )

    st.subheader("Supplier-attributed incidents")
    sup = df[df.supplier_attributed]
    st.write(f"{len(sup)} of {len(df)} incidents "
             f"({100 * len(sup) / len(df):.0f}%) arrived inside supplier-built "
             f"assemblies (center console / IP) — managed via incoming control "
             f"and supplier corrective-action loop (CM-03).")

# ===========================================================================
elif page == "📝 Log incident & report":
    st.header("Log a new incident and generate a report")

    c1, c2, c3 = st.columns(3)
    obj = c1.selectbox("Object type", list(OBJECT_TYPES))
    material = OBJECT_TYPES[obj][0]
    c1.caption(f"Material class: **{material}**")
    zone = c2.selectbox("Vehicle zone", list(ZONES))
    crit = ZONES[zone]
    c2.caption(f"Zone criticality: **{crit}**")
    method = c3.selectbox("Detection method", DETECTION_METHODS)

    c4, c5 = st.columns(2)
    intro = c4.selectbox("Station introduced", STATIONS[:-1], index=4)
    detect = c5.selectbox("Station detected", STATIONS,
                          index=STATIONS.index("VDT"))

    supplier = st.checkbox("Supplier-attributed (arrived inside supplier assembly)")
    desc = st.text_area("Description", placeholder="What was heard/found, where, during what test?")
    rc = st.text_area("Root cause (if known)")
    ca = st.text_area("Corrective action (if defined)")
    damage = st.selectbox("Secondary damage", ["none", "paint scratch", "part damaged"])

    # Auto severity per aerospace-style rules
    if detect == intro:
        sev = "Class D — Contained"
    elif crit == "safety-critical":
        sev = "Class A — Critical"
    elif crit == "internal":
        sev = "Class B — Major"
    else:
        sev = "Class C — Minor"
    st.info(f"Auto-classified severity: **{sev}** — {SEVERITY_CLASSES[sev]}")

    lines = estimate_cost(sev, material, damage)
    st.metric("Estimated cost of this incident", f"${lines['TOTAL']:,.2f}")

    if st.button("🚀 Generate incident report (.docx)", type="primary"):
        incident = dict(
            record_id=f"FOD-NEW-{len(df) + 1:04d}", object_type=obj,
            material=material, station_introduced=intro,
            station_detected=detect, vehicle_zone=zone, zone_criticality=crit,
            detection_method=method, supplier_attributed=supplier,
            severity_class=sev, description=desc or "—",
            root_cause=rc or "Under investigation",
            corrective_action=ca or "To be defined via countermeasure playbook",
            secondary_damage=damage,
        )
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
            generate_incident_report(incident, tmp.name)
            data = open(tmp.name, "rb").read()
        st.success("Report generated.")
        st.download_button(
            "⬇️ Download FOD incident report", data=data,
            file_name=f"{incident['record_id']}.docx",
            mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

# ===========================================================================
else:
    st.header("Countermeasure playbook")
    st.write(
        "The intervention set behind a ~95% reduction in retained loose "
        "objects, encoded as a reusable knowledge base. Each new incident's "
        "corrective action should reference a countermeasure ID."
    )
    for cm in COUNTERMEASURES:
        with st.expander(f"**{cm['id']} — {cm['name']}**"):
            st.write(cm["detail"])
            st.caption("Primary targets: " + ", ".join(cm["targets"]))
    st.subheader("Severity classes (aerospace-style, adapted from AS9146/NAS 412 practice)")
    for k, v in SEVERITY_CLASSES.items():
        st.write(f"**{k}** — {v}")
