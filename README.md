# FODGuard 🔩

**Loose Object Control & Incident Intelligence for Vehicle Assembly**

**🚀 Try it live:** https://fod-guard.streamlit.app — no install needed.

Bringing aerospace-grade FOD (Foreign Object Debris/Damage) prevention practice to automotive and EV manufacturing: BM25 similarity search over past loose-object incidents, escape-point analytics, cost-of-escape modeling, and one-click professional incident reports.

Built by a manufacturing & process engineer who led a loose-object control program in high-volume EV assembly that achieved a **~95% reduction in retained loose objects** — this tool encodes that program as software.

## The problem

Loose objects — screws, nuts, washers, push clips, waste tape, wire trimmings, weld/cast slag — retained inside a finished vehicle cause:

- **Customer dissatisfaction:** rattling noise is directly perceived as poor build quality (the automotive BSR — Buzz, Squeak, Rattle — literature ties squeak/rattle to J.D. Power quality perception)
- **Safety risk:** a metallic object in the battery enclosure or HV junction area can create a short-circuit path; metallic contamination is a documented trigger for internal short circuits and thermal runaway in lithium-ion systems
- **Cost asymmetry:** an external object on the carpet takes ~20–30 minutes to find and remove; an internal object found at drive test can take **12+ hours** of teardown, retrieval, retest, and reassembly — with paint-scratch risk during disassembly adding another 5–6 hours of repair and bake time

Aerospace formalized this problem decades ago (SAE **AS9146**, **NAS 412**, IAQG SCMH 3.4, NASA MSFC-STD-3598). Automotive has BSR *testing* but no equivalent incident-intelligence tooling. FODGuard fills that gap.

## What it does

**🔎 Similarity search (BM25):** describe a new find or a noise symptom ("rattling from rocker panel during weave test") and retrieve the most similar past incidents with confirmed root causes and corrective actions. Okapi BM25 handles the short, jargon-dense incident narratives better than raw TF-IDF.

**📊 Escape analytics:** source Pareto (which process lines produce the objects), object Pareto, an **introduced-vs-detected escape matrix** (mass right of the diagonal = expensive late escapes), supplier-attribution tracking, and severity-class cost rollups.

**💰 Cost-of-escape model:** parameterized from production estimates — technician rate, teardown/reassembly hours, VDT retest cycles, plastic-object search penalty (magnetic pickup doesn't work on plastic), paint repair with bake/dry time. Tune the constants in `fod_guard/core.py` for your plant.

**📝 Incident reports:** aerospace-style severity classification (Class A Critical → Class D Contained) and a one-click professional .docx incident report — same document engine family as the companion package [pfmea-doc-gen](https://github.com/Fitsumtf/pfmea-doc-gen).

**📚 Countermeasure playbook:** the seven intervention families behind the 95% reduction, encoded as a reusable knowledge base (dedicated line inspectors, return-to-lead accountability, supplier incoming control, senior-tech assignment, 5S/shadow boards/magnetic plates, ergonomic rack redesign, push-clip system redesign).

## Quick start

```bash
git clone https://github.com/Fitsumtf/fod-guard.git
cd fod-guard
pip install -e .
streamlit run app.py
```

Or use the library directly:

```python
from fod_guard.core import load_incidents, BM25Index

df = load_incidents("data/fod_incidents.csv")
index = BM25Index(df)
matches = index.query("clicking noise under driver seat after hard stop")
print(matches[["record_id", "root_cause", "corrective_action"]])
```

## Dataset

`data/fod_incidents.csv` contains **120 synthetic incidents** (no OEM data) generated to match observed production distributions: ~40% from subframe subassembly, ~30% from pre-marriage/marriage, ~20% post-marriage, ~10% other lines; object frequencies led by screws and push clips; ~5% supplier-attributed. Regenerate with `python data/generate_dataset.py`.

## Severity classes

| Class | Definition | Typical cost |
|---|---|---|
| A — Critical | Safety-critical zone (battery enclosure, HV junction) | ~$750+ incl. containment review |
| B — Major | Internal cavity; teardown required | ~$300+ (12+ h worst case) |
| C — Minor | External/visible; quick removal | ~$15 |
| D — Contained | Caught in-station, no escape | ~$4 |

## References

- SAE AS9146, *Foreign Object Damage (FOD) Prevention Program — Requirements for Aviation, Space, and Defense Organizations* (2017, reaffirmed 2022)
- NAS 412, *Foreign Object Damage / Foreign Object Debris (FOD) Prevention*, Aerospace Industries Association
- IAQG Supply Chain Management Handbook §3.4, *Foreign Object Debris*
- NASA MSFC-STD-3598, *Foreign Object Damage Prevention*
- Gosavi, S.S., *Automotive Buzz, Squeak and Rattle (BSR) Detection and Prevention*, SAE Technical Paper 2005-26-056
- Robertson & Zaragoza, *The Probabilistic Relevance Framework: BM25 and Beyond*, Foundations and Trends in IR (2009)

## License

MIT — see [LICENSE](LICENSE)

---

*Developed by [Dr. Fitsum Taye Feyissa](https://github.com/Fitsumtf) — manufacturing & process engineer (Tesla, Thermo Fisher Scientific, IIT Delhi), combining 20+ years of engineering experience with applied data science.*
