"""fod_guard.report — generate a professional FOD incident report as .docx.

Visual language follows the companion package pfmea-doc-gen (same author):
shaded callout for root cause, color-coded severity, cost-breakdown table,
sign-off block.
"""

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

from .core import estimate_cost

_SEV_COLORS = {
    "Class A — Critical": "E74C3C",
    "Class B — Major": "E67E22",
    "Class C — Minor": "F1C40F",
    "Class D — Contained": "2ECC71",
}


def _shade(cell, color):
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), color)
    cell._tc.get_or_add_tcPr().append(shd)


def generate_incident_report(incident: dict, output_path: str) -> str:
    """incident: a dict/row with the FODIncident fields."""
    doc = Document()
    t = doc.add_heading(f"Loose Object (FOD) Incident Report — {incident['record_id']}", 0)
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER

    meta = doc.add_table(rows=3, cols=2)
    meta.style = "Table Grid"
    fields = [
        ("Object", f"{incident['object_type']} ({incident['material']})"),
        ("Vehicle zone", f"{incident['vehicle_zone']} [{incident['zone_criticality']}]"),
        ("Introduced at", incident["station_introduced"]),
        ("Detected at", f"{incident['station_detected']} via {incident['detection_method']}"),
        ("Supplier attributed", "Yes" if incident.get("supplier_attributed") else "No"),
        ("Severity", incident["severity_class"]),
    ]
    for i, (label, value) in enumerate(fields):
        cell = meta.rows[i // 2].cells[i % 2]
        p = cell.paragraphs[0]
        r = p.add_run(f"{label}: ")
        r.bold = True
        p.add_run(str(value))
        if label == "Severity":
            _shade(cell, _SEV_COLORS.get(incident["severity_class"], "BDC3C7"))

    doc.add_heading("1. Incident Description", 1)
    doc.add_paragraph(incident["description"])

    doc.add_heading("2. Root Cause", 1)
    box = doc.add_table(rows=1, cols=1)
    box.style = "Table Grid"
    cell = box.rows[0].cells[0]
    _shade(cell, "FDEBD0")
    p = cell.paragraphs[0]
    r = p.add_run("ROOT CAUSE:  ")
    r.bold = True
    r.font.color.rgb = RGBColor(0xC0, 0x39, 0x2B)
    p.add_run(incident["root_cause"])

    doc.add_heading("3. Corrective Action", 1)
    doc.add_paragraph(incident["corrective_action"])

    doc.add_heading("4. Cost Impact (estimated)", 1)
    lines = estimate_cost(incident["severity_class"], incident["material"],
                          incident.get("secondary_damage", "none"))
    ct = doc.add_table(rows=1, cols=2)
    ct.style = "Table Grid"
    for j, h in enumerate(["Cost element", "USD"]):
        c = ct.rows[0].cells[j]
        run = c.paragraphs[0].add_run(h)
        run.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        _shade(c, "2C3E50")
    for name, value in lines.items():
        row = ct.add_row()
        row.cells[0].text = name
        row.cells[1].text = f"{value:,.2f}"
        if name == "TOTAL":
            for c in row.cells:
                for para in c.paragraphs:
                    for run in para.runs:
                        run.bold = True
            _shade(row.cells[1], "D6EAF8")
    ct.columns[0].width = Inches(4.2)

    doc.add_heading("5. Approval", 1)
    sign = doc.add_table(rows=2, cols=3)
    sign.style = "Table Grid"
    for i, role in enumerate(["Prepared By", "Quality Lead", "Approved By"]):
        run = sign.rows[0].cells[i].paragraphs[0].add_run(role)
        run.bold = True
        cell = sign.rows[1].cells[i]
        cell.paragraphs[0].text = ""
        cell.add_paragraph("")
        cell.add_paragraph("Signature / Date")

    doc.save(output_path)
    return output_path
