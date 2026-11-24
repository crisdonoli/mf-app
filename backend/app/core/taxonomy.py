"""Canonical FOMC macroeconomic topic taxonomy (13 macro-categories & sub-classes).

Derived directly from the MiningFOMC zero-shot classification taxonomy
(``fomc-labels/source/classify/taxonomy.py``). Provides a single source of truth
for category ordering, display names, definitions, parent-child mappings, and
aggregation indices across both the Explorer and Comparator.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Sequence


MACRO_CATEGORIES: list[str] = [
    "growth",
    "labor_market",
    "inflation",
    "fiscal",
    "monetary_policy",
    "monetary_aggregates",
    "communication",
    "financial_conditions",
    "operations",
    "fx_international",
    "procedural",
    "discourse",
    "irrelevant",
]

MACRO_DISPLAY_NAMES: dict[str, str] = {
    "growth": "Growth & Real Activity",
    "gdp_activity": "GDP & Aggregate Activity",
    "labor_market": "Labor Market",
    "inflation": "Inflation",
    "fiscal": "Fiscal Policy",
    "monetary_policy": "Monetary Policy",
    "monetary_aggregates": "Monetary Aggregates",
    "communication": "Communication & Guidance",
    "financial_conditions": "Financial Conditions",
    "operations": "Operations & Balance Sheet",
    "fx_international": "FX & International",
    "procedural": "Procedural",
    "discourse": "Discourse Scaffolding",
    "irrelevant": "Off-Topic / Irrelevant",
}

MACRO_SHORT_LABELS: dict[str, str] = {
    "growth": "Growth",
    "gdp_activity": "GDP / Agg.",
    "labor_market": "Labor",
    "inflation": "Inflation",
    "fiscal": "Fiscal",
    "monetary_policy": "Mon. Policy",
    "monetary_aggregates": "Mon. Agg.",
    "communication": "Comms",
    "financial_conditions": "Fin. Cond.",
    "operations": "Operations",
    "fx_international": "FX / Intl",
    "procedural": "Procedural",
    "discourse": "Discourse",
    "irrelevant": "Irrelevant",
}

MACRO_DEFINITIONS: dict[str, str] = {
    "growth": (
        "Growth and real activity: GDP/GNP, output, industrial production, "
        "consumer spending, housing, business investment, productivity, and real-activity outlook."
    ),
    "labor_market": (
        "The labor market: employment, unemployment, labor force participation, "
        "wages, and labor-market slack."
    ),
    "inflation": (
        "Inflation: realized and expected price growth (CPI/PCE), wage cost pressures, "
        "and inflation expectations anchoring."
    ),
    "fiscal": (
        "Fiscal policy: taxes, government spending, federal budget, deficits, and fiscal stimulus."
    ),
    "monetary_policy": (
        "Monetary policy: policy stance, federal funds rate decisions, policy framework, "
        "dual mandate, and forward strategy."
    ),
    "monetary_aggregates": (
        "Monetary aggregates: M1/M2/M3 money supply growth, velocity, and monetary targeting."
    ),
    "communication": (
        "Communication and forward guidance: statement wording, press guidance, "
        "projections, and public messaging."
    ),
    "financial_conditions": (
        "Financial conditions and stability: asset markets, credit and funding spreads, "
        "market functioning, and banking or systemic stress."
    ),
    "operations": (
        "Operations and balance sheet: open market and SOMA operations, reserves, "
        "asset purchases, liquidity facilities, and balance-sheet normalization."
    ),
    "fx_international": (
        "Foreign exchange and international: exchange rates, FX intervention, "
        "central bank swap lines, and global financial conditions."
    ),
    "procedural": (
        "Procedural: meeting mechanics, approval of minutes, votes, elections, "
        "attendance, and document handling."
    ),
    "discourse": (
        "Discourse scaffolding: brief conversational turns managing discussion flow "
        "(acknowledgments, transitions, clarifying questions) without economic content."
    ),
    "irrelevant": (
        "Irrelevant or off-topic: small talk and personal or social remarks unrelated to policy."
    ),
}

SUBCLASS_HIERARCHY: dict[str, list[str]] = {
    "growth": [
        "gdp_output",
        "consumption",
        "business_investment",
        "housing",
        "industrial_production",
        "productivity",
    ],
    "gdp_activity": [
        "gdp_output",
        "productivity",
        "monetary_aggregates",
    ],
    "labor_market": [],
    "inflation": [
        "inflation_outlook",
        "inflation_expectations",
        "wage_inflation",
    ],
    "fiscal": [],
    "monetary_policy": [
        "policy_stance",
        "rate_decision",
        "policy_framework",
        "policy_strategy",
    ],
    "monetary_aggregates": [
        "monetary_aggregates",
    ],
    "communication": [
        "statement_wording",
        "press_guidance",
        "forward_guidance",
    ],
    "financial_conditions": [
        "market_conditions",
        "financial_stability",
        "market_functioning",
        "banking_stress",
    ],
    "operations": [
        "reserves",
        "open_market_operations",
        "balance_sheet",
        "liquidity_facilities",
    ],
    "fx_international": [],
    "procedural": [],
    "discourse": [],
    "irrelevant": [],
}

SUBCLASS_DISPLAY_NAMES: dict[str, str] = {
    "gdp_activity": "GDP & Aggregate Activity",
    "gdp_output": "GDP & Real Output",
    "consumption": "Consumption",
    "business_investment": "Business Investment",
    "housing": "Housing",
    "industrial_production": "Industrial Production",
    "productivity": "Productivity & Potential",
    "monetary_aggregates": "Monetary Aggregates",
    "inflation_outlook": "Inflation Outlook",
    "inflation_expectations": "Inflation Expectations",
    "wage_inflation": "Wage Inflation",
    "policy_stance": "Policy Stance",
    "rate_decision": "Rate Decision",
    "policy_framework": "Policy Framework",
    "policy_strategy": "Policy Strategy",
    "statement_wording": "Statement Wording",
    "press_guidance": "Press Guidance",
    "forward_guidance": "Forward Guidance",
    "market_conditions": "Market Conditions",
    "financial_stability": "Financial Stability",
    "market_functioning": "Market Functioning",
    "banking_stress": "Banking Stress",
    "reserves": "Reserves",
    "open_market_operations": "Open Market Operations",
    "balance_sheet": "Balance Sheet",
    "liquidity_facilities": "Liquidity Facilities",
}

V5_LEAF_CLASSES: list[str] = [
    "gdp_output",
    "consumption",
    "business_investment",
    "housing",
    "industrial_production",
    "productivity",
    "labor_market",
    "inflation_outlook",
    "inflation_expectations",
    "wage_inflation",
    "fiscal",
    "policy_stance",
    "rate_decision",
    "policy_framework",
    "policy_strategy",
    "monetary_aggregates",
    "statement_wording",
    "press_guidance",
    "forward_guidance",
    "market_conditions",
    "financial_stability",
    "market_functioning",
    "banking_stress",
    "reserves",
    "open_market_operations",
    "balance_sheet",
    "liquidity_facilities",
    "fx_international",
    "procedural",
    "discourse",
    "irrelevant",
]

LEAF_TO_MACRO: dict[str, str] = {}
for _macro in MACRO_CATEGORIES:
    LEAF_TO_MACRO[_macro] = _macro
    for _sub in SUBCLASS_HIERARCHY.get(_macro, []):
        LEAF_TO_MACRO[_sub] = _macro
# Legacy v2-v4 alias
LEAF_TO_MACRO["gdp_activity"] = "growth"


DOC_TYPE_LABELS: dict[str, str] = {
    "transcripts": "Transcript",
    "beige_books": "Beige Book",
    "greenbook": "Greenbook / Tealbook A",
    "bluebook": "Bluebook / Tealbook B",
    "redbooks": "Redbook",
    "agenda_items": "Meeting Agenda",
    "memos": "Staff Memo",
    "statements": "Policy Statement",
    "minutes": "Minutes",
    "minutes_of_actions": "Minutes of Actions",
    "record_policies": "Record of Policy Actions",
    "presentations": "Staff Presentation",
    "press_conferences": "Press Conference",
    "sep": "Summary of Economic Projections",
    "longer_run_goals": "Longer-Run Goals",
    "memoranda_of_discussion": "Memorandum of Discussion",
    "speeches": "Fed Speech",
    "historical_minutes": "Historical Minutes",
    "executive_committee_minutes": "Executive Committee Minutes",
}


def format_label(key: str) -> str:
    """Return a clean English display label for any macro-category or sub-class key."""
    if key in MACRO_DISPLAY_NAMES:
        return MACRO_DISPLAY_NAMES[key]
    if key in SUBCLASS_DISPLAY_NAMES:
        return SUBCLASS_DISPLAY_NAMES[key]
    return key.replace("_", " ").title()


def format_doc_type(doc_type: str) -> str:
    """Return a clean human-readable English label for a Parquet doc_type."""
    return DOC_TYPE_LABELS.get(doc_type, doc_type.replace("_", " ").title())


def get_taxonomy_payload(taxonomy_path: Path | None = None) -> dict:
    """Return the full structured taxonomy for frontend consumption.

    If a custom ``taxonomy.json`` exists on disk, its extra metadata is merged
    without breaking the canonical 13-category hierarchy.
    """
    custom: dict = {}
    if taxonomy_path and taxonomy_path.is_file():
        try:
            custom = json.loads(taxonomy_path.read_text(encoding="utf-8"))
        except Exception:
            custom = {}

    macro_items = []
    for idx, key in enumerate(MACRO_CATEGORIES):
        subclasses = [
            {
                "id": sub,
                "label": format_label(sub),
                "parent_id": key,
            }
            for sub in SUBCLASS_HIERARCHY.get(key, [])
        ]
        macro_items.append(
            {
                "index": idx,
                "id": key,
                "label": MACRO_DISPLAY_NAMES[key],
                "short_label": MACRO_SHORT_LABELS[key],
                "definition": MACRO_DEFINITIONS[key],
                "subclasses": subclasses,
                "has_subclasses": len(subclasses) > 0,
            }
        )

    return {
        "macro_categories": macro_items,
        "leaf_classes": [
            {
                "id": leaf,
                "label": format_label(leaf),
                "parent_id": LEAF_TO_MACRO.get(leaf, leaf),
            }
            for leaf in V5_LEAF_CLASSES
        ],
        "source_labels": custom.get("labels", MACRO_CATEGORIES),
    }


def resolve_column_labels(
    raw_labels: Sequence[str] | None, n_cols: int
) -> list[str]:
    """Infer column names for a similarity matrix with ``n_cols`` columns."""
    if raw_labels and len(raw_labels) == n_cols:
        return [str(lbl) for lbl in raw_labels]
    if n_cols == len(MACRO_CATEGORIES):
        return list(MACRO_CATEGORIES)
    if n_cols == len(V5_LEAF_CLASSES):
        return list(V5_LEAF_CLASSES)
    if n_cols == 12:
        return [c for c in MACRO_CATEGORIES if c != "monetary_aggregates"]
    return [f"class_{i}" for i in range(n_cols)]
