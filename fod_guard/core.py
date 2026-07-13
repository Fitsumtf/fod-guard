"""fod_guard.core — incident model, BM25 retrieval, escape analytics, cost model.

Cost-model constants are seeded from expert production estimates and are
intended to be tuned per plant.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import pandas as pd

from .taxonomy import STATION_INDEX, STATIONS

# ===========================================================================
# Incident model
# ===========================================================================

@dataclass
class FODIncident:
    record_id: str
    object_type: str
    material: str                # metallic | plastic | organic
    station_introduced: str
    station_detected: str
    vehicle_zone: str
    zone_criticality: str        # safety-critical | internal | cosmetic
    detection_method: str
    supplier_attributed: bool
    severity_class: str          # Class A/B/C/D
    description: str             # free text — what was heard/found/retrieved
    root_cause: str
    corrective_action: str
    removal_time_hr: float
    secondary_damage: str        # none | paint scratch | part damaged
    total_cost_usd: float

    @property
    def escape_distance(self) -> int:
        """How many stations the object traveled past its introduction point."""
        return max(0, STATION_INDEX[self.station_detected]
                      - STATION_INDEX[self.station_introduced])


def load_incidents(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    df["escape_distance"] = (
        df["station_detected"].map(STATION_INDEX)
        - df["station_introduced"].map(STATION_INDEX)
    ).clip(lower=0)
    return df


# ===========================================================================
# BM25 retrieval (Okapi BM25) — find similar past incidents
# ===========================================================================

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9\-\.]*")


def _tokenize(text: str) -> List[str]:
    return _TOKEN_RE.findall(str(text).lower())


class BM25Index:
    """BM25 over incident text (description + root cause + object/zone fields).

    BM25 is preferred over raw TF-IDF cosine for this corpus: it handles
    term-frequency saturation and document-length normalization, which matters
    for short incident narratives with repeated part words.
    """

    SEARCH_FIELDS = ["object_type", "vehicle_zone", "station_introduced",
                     "description", "root_cause", "corrective_action"]

    def __init__(self, df: pd.DataFrame, k1: float = 1.5, b: float = 0.75):
        self.df = df.reset_index(drop=True)
        self.k1, self.b = k1, b
        corpus = self.df[self.SEARCH_FIELDS].fillna("").agg(" ".join, axis=1)
        self.docs = [_tokenize(t) for t in corpus]
        self.doc_len = [len(d) for d in self.docs]
        self.avgdl = (sum(self.doc_len) / len(self.docs)) if self.docs else 0.0
        self.n = len(self.docs)
        self.tf: Dict[str, Dict[int, int]] = {}
        for i, doc in enumerate(self.docs):
            for tok in doc:
                self.tf.setdefault(tok, {})
                self.tf[tok][i] = self.tf[tok].get(i, 0) + 1
        self.idf = {
            t: math.log(1 + (self.n - len(p) + 0.5) / (len(p) + 0.5))
            for t, p in self.tf.items()
        }

    def query(self, text: str, top_k: int = 5) -> pd.DataFrame:
        """Return the top_k most similar incidents with a bm25_score column."""
        scores = [0.0] * self.n
        for tok in _tokenize(text):
            postings = self.tf.get(tok)
            if not postings:
                continue
            idf = self.idf[tok]
            for i, f in postings.items():
                denom = f + self.k1 * (1 - self.b + self.b * self.doc_len[i] / self.avgdl)
                scores[i] += idf * f * (self.k1 + 1) / denom
        order = sorted(range(self.n), key=lambda i: scores[i], reverse=True)[:top_k]
        order = [i for i in order if scores[i] > 0]
        out = self.df.iloc[order].copy()
        out.insert(0, "bm25_score", [round(scores[i], 2) for i in order])
        return out


# ===========================================================================
# Cost model — seeded from expert production estimates (tune per plant)
# ===========================================================================

COST_PARAMS = {
    "tech_rate_hr": 35.0,          # technician loaded labor rate, $/hr
    "external_removal_hr": 0.4,    # visible/external object: test+search+remove+retest ~20-30 min
    "teardown_hr": 4.0,            # internal object: minimum disassembly time
    "reassembly_hr": 1.0,
    "part_fetch_hr": 0.33,         # bringing parts from the part store ~20 min
    "vdt_retest_hr": 0.4,          # >20 min per run for complex cases
    "vdt_retests": 2,              # noise confirmation typically needs 2-3 runs
    "plastic_multiplier": 1.4,     # no magnetic pickup for plastic objects → longer search
    "scratch_repair_hr": 5.5,      # paint repair incl. baking/drying (5-6 hr)
    "scratch_queue_hr": 0.5,       # repair queue wait ~30 min
    "paint_materials_usd": 120.0,
    "part_replacement_usd": 180.0, # average damaged trim/fastener kit
    "critical_review_hr": 8.0,     # Class A: containment review + engineering disposition
    "engineer_rate_hr": 60.0,
}


def estimate_cost(severity_class: str, material: str,
                  secondary_damage: str = "none",
                  p: dict = COST_PARAMS) -> dict:
    """Estimate fully-loaded cost of one incident. Returns line-item breakdown."""
    lines: Dict[str, float] = {}
    mult = p["plastic_multiplier"] if material == "plastic" else 1.0

    if severity_class.startswith("Class D"):
        lines["in-station retrieval"] = 0.1 * p["tech_rate_hr"]
    elif severity_class.startswith("Class C"):
        lines["external search & removal"] = (
            p["external_removal_hr"] * mult * p["tech_rate_hr"])
    else:  # Class A or B — internal retrieval
        lines["teardown"] = p["teardown_hr"] * p["tech_rate_hr"]
        lines["search (material-adjusted)"] = (
            0.5 * mult * p["tech_rate_hr"])
        lines["reassembly"] = p["reassembly_hr"] * p["tech_rate_hr"]
        lines["part fetch"] = p["part_fetch_hr"] * p["tech_rate_hr"]
        lines["VDT retests"] = (
            p["vdt_retest_hr"] * p["vdt_retests"] * p["tech_rate_hr"])
        if severity_class.startswith("Class A"):
            lines["containment review & disposition"] = (
                p["critical_review_hr"] * p["engineer_rate_hr"])

    if secondary_damage == "paint scratch":
        lines["paint repair (incl. bake/dry)"] = (
            (p["scratch_repair_hr"] + p["scratch_queue_hr"]) * p["tech_rate_hr"])
        lines["paint materials"] = p["paint_materials_usd"]
    elif secondary_damage == "part damaged":
        lines["replacement part"] = p["part_replacement_usd"]

    lines["TOTAL"] = round(sum(lines.values()), 2)
    return lines


# ===========================================================================
# Escape analytics
# ===========================================================================

def source_pareto(df: pd.DataFrame) -> pd.Series:
    return df["station_introduced"].value_counts()


def object_pareto(df: pd.DataFrame) -> pd.Series:
    return df["object_type"].value_counts()


def escape_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """Introduced-station (rows) × detected-station (cols) incident counts.

    Mass far above/right of the diagonal = late, expensive escapes.
    """
    m = pd.crosstab(df["station_introduced"], df["station_detected"])
    rows = [s for s in STATIONS if s in m.index]
    cols = [s for s in STATIONS if s in m.columns]
    return m.loc[rows, cols]


def cost_summary(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby("severity_class").agg(
        incidents=("record_id", "count"),
        total_cost=("total_cost_usd", "sum"),
        avg_cost=("total_cost_usd", "mean"),
        avg_removal_hr=("removal_time_hr", "mean"),
    ).round(1)
    return g.sort_index()
