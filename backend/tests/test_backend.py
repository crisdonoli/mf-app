"""Comprehensive V4 unit and integration tests for MiningFOMC backend.

Validates:
1. Matrix transforms (cosine/softmax/log) & Topic/Slice normalization
2. Auth gate & .env Admin bootstrap
3. model/relevance_score.parquet discovery + Explorer Relevance Probabilities tab
4. Flat participants.parquet & participants_report.json -> /api/speakers/autocomplete
5. Unified Date Range (date_from only -> exact single-date match, <= 2020-12-31 cap)
6. V4 Hierarchical Grouping Tree (/tree-preview), node visibility toggles, <=20 leaf validation,
   chronologically ordered intra-subgroup S-slice time-series, and /inspect-slice drill-down
7. Collaborative Studies & Fix Request -> Admin Accept -> Notification + Parquet Ledger
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import Settings, set_settings
from app.core.fomc_service import _participant_group_key
from app.core.matrix_math import (
    partition_and_aggregate_chunks,
    project_matrix_granularity,
    transform_matrix,
)
from app.core.query_engine import (
    ParquetQueryEngine,
    _normalize_gender,
    _speaker_surname_key,
    clear_speaker_catalog_cache,
)
from app.core.taxonomy import MACRO_CATEGORIES, V5_LEAF_CLASSES
from app.db.repository import reset_repository
from app.main import create_app


TEXT_META_SCHEMA = pa.schema(
    [
        ("chunk_id", pa.string()),
        ("meeting_date", pa.string()),
        ("doc_type", pa.string()),
        ("year", pa.int16()),
        ("source_file", pa.string()),
        ("sequence_num", pa.int32()),
        ("section", pa.string()),
        ("speaker", pa.string()),
        ("speaker_role", pa.string()),
        ("district", pa.string()),
        ("dialogue_id", pa.int32()),
        ("chunk_sub_id", pa.int32()),
        ("text_content", pa.string()),
        ("char_count", pa.int32()),
        ("extraction_method", pa.string()),
    ]
)

PARTICIPANTS_SCHEMA = pa.schema(
    [
        ("participant_id", pa.int32()),
        ("board_member_name", pa.string()),
        ("institution", pa.string()),
        ("match_score", pa.float64()),
        ("name_raw", pa.string()),
        ("name_norm", pa.string()),
        ("gender", pa.string()),
        ("role", pa.string()),
        ("role_category", pa.string()),
        ("affiliation", pa.string()),
        ("source", pa.string()),
        ("n_turns", pa.int32()),
        ("speaker_ids", pa.string()),
        ("roster_match", pa.bool_()),
    ]
)


def build_synthetic_fomc_corpus(root: Path) -> None:
    rng = np.random.default_rng(42)

    pq.write_table(
        pa.Table.from_pylist(
            [
                {
                    "participant_id": 1,
                    "board_member_name": "Ben Bernanke",
                    "institution": "Board of Governors",
                    "match_score": 100.0,
                    "name_raw": "CHAIRMAN BERNANKE",
                    "name_norm": "chairman bernanke",
                    "gender": "M",
                    "role": "Chair",
                    "role_category": "Chair",
                    "affiliation": "Board",
                    "source": "transcript",
                    "n_turns": 420,
                    "speaker_ids": "CHAIRMAN BERNANKE",
                    "roster_match": False,
                },
                {
                    "participant_id": 2,
                    "board_member_name": "Janet Yellen",
                    "institution": "Federal Reserve Bank of San Francisco",
                    "match_score": 98.5,
                    "name_raw": "MS. YELLEN",
                    "name_norm": "ms yellen",
                    "gender": "F",
                    "role": "President",
                    "role_category": "Reserve Bank President",
                    "affiliation": "San Francisco",
                    "source": "transcript",
                    "n_turns": 310,
                    "speaker_ids": "MS. YELLEN",
                    "roster_match": False,
                },
            ],
            schema=PARTICIPANTS_SCHEMA,
        ),
        root / "participants.parquet",
    )

    (root / "participants_report.json").write_text(
        json.dumps(
            {
                "board_members": {
                    "matched_names": ["Ben Bernanke", "Janet Yellen", "Paul Volcker"],
                },
                "roster": {
                    "rescued_names": ["Henry Wallich"],
                },
            }
        ),
        encoding="utf-8",
    )

    meetings = [
        (
            "2008-09-16",
            2008,
            [
                ("CHAIRMAN BERNANKE", "Financial conditions and short-term funding markets remain under severe systemic stress following Lehman."),
                ("MS. YELLEN", "Labor market slack is rising and unemployment is likely to climb further as credit tightens."),
                ("CHAIRMAN BERNANKE", "We will hold the federal funds target rate steady while monitoring financial stability risks."),
                ("MS. YELLEN", "Inflation expectations must remain anchored despite energy price volatility and banking stress."),
            ],
        ),
        (
            "2009-03-18",
            2009,
            [
                ("CHAIRMAN BERNANKE", "We are expanding agency mortgage-backed securities purchases to support credit markets."),
                ("MS. YELLEN", "Economic activity continues to contract and disinflation risks warrant sustained accommodation."),
            ],
        ),
        (
            "1981-07-07",
            1981,
            [
                ("CHAIRMAN VOLCKER", "Bringing down core inflation and keeping M1 monetary aggregates on target remains our primary objective."),
                ("MR. WALLICH", "Tight monetary policy stance has pushed real interest rates higher and slowed housing starts."),
                ("MR. CORRIGAN", "Industrial production and business investment show signs of restraint under elevated rates."),
                ("CHAIRMAN VOLCKER", "We must preserve credibility on price stability and resist premature easing."),
            ],
        ),
    ]

    zs_rows = []
    rel_rows = []
    for m_date, yr, turns in meetings:
        t_rows = []
        cids = []
        for idx, (sp, txt) in enumerate(turns, start=1):
            cid = f"transcripts_{m_date}_{idx:04d}"
            cids.append(cid)
            t_rows.append(
                {
                    "chunk_id": cid,
                    "meeting_date": m_date,
                    "doc_type": "transcripts",
                    "year": yr,
                    "source_file": f"transcripts/{m_date}.pdf",
                    "sequence_num": idx,
                    "section": "Economic & Policy Discussion",
                    "speaker": sp,
                    "speaker_role": "Chair" if "CHAIRMAN" in sp else "Member",
                    "district": "Board",
                    "dialogue_id": idx,
                    "chunk_sub_id": 0,
                    "text_content": txt,
                    "char_count": len(txt),
                    "extraction_method": "deterministic",
                }
            )
            leaf_scores = rng.uniform(0.01, 0.35, size=len(V5_LEAF_CLASSES))
            top_label = "financial_stability" if yr >= 2008 else "inflation_outlook"
            leaf_scores[V5_LEAF_CLASSES.index(top_label)] = 0.88
            z_row = {
                "chunk_id": cid,
                "label": V5_LEAF_CLASSES.index(top_label),
                "label_name": top_label,
                "p_relevant": 0.92 if idx % 2 == 1 else 0.35,
            }
            for cls_name, val in zip(V5_LEAF_CLASSES, leaf_scores):
                z_row[cls_name] = float(val)
            zs_rows.append(z_row)
            rel_rows.append({"chunk_id": cid, "p_relevant": float(z_row["p_relevant"])})

        t_dir = root / "text_metadata" / "doc_type=transcripts" / f"year={yr}"
        t_dir.mkdir(parents=True, exist_ok=True)
        pq.write_table(pa.Table.from_pylist(t_rows, schema=TEXT_META_SCHEMA), t_dir / "part-000.parquet")

        sim_mat = rng.uniform(-0.15, 0.65, size=(len(cids), len(V5_LEAF_CLASSES))).astype(np.float32)
        if yr >= 2008:
            sim_mat[:, V5_LEAF_CLASSES.index("financial_stability")] = 0.85
        else:
            sim_mat[:, V5_LEAF_CLASSES.index("inflation_outlook")] = 0.89

        sim_arr = pa.FixedSizeListArray.from_arrays(
            pa.array(sim_mat.reshape(-1), type=pa.float32()), len(V5_LEAF_CLASSES)
        )
        sim_tbl = pa.table({"chunk_id": pa.array(cids, type=pa.string()), "similarity": sim_arr})
        sim_tbl = sim_tbl.replace_schema_metadata(
            {b"similarity": json.dumps({"labels": V5_LEAF_CLASSES, "n_classes": len(V5_LEAF_CLASSES)}).encode("utf-8")}
        )
        s_dir = root / "similarities" / "model=bge-m3" / "pooling=chunk" / "doc_type=transcripts" / f"year={yr}"
        s_dir.mkdir(parents=True, exist_ok=True)
        pq.write_table(sim_tbl, s_dir / "part-000.parquet")

    zs_dir = root / "labels" / "zero_shot"
    zs_dir.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(zs_rows), zs_dir / "labels-v5.parquet")

    rel_dir = root / "model"
    rel_dir.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rel_rows), rel_dir / "relevance_score.parquet")


class TestMatrixMath(unittest.TestCase):
    def test_topic_and_slice_normalizations(self):
        raw = np.array([[-0.2, 0.1, 0.8], [0.3, 0.5, 0.9]], dtype=np.float32)
        slice_norm = transform_matrix(raw, metric="cosine", normalization="slice")
        np.testing.assert_allclose(slice_norm.min(axis=1), np.zeros(2), atol=1e-5)
        np.testing.assert_allclose(slice_norm.max(axis=1), np.ones(2), atol=1e-5)

        topic_norm = transform_matrix(raw, metric="cosine", normalization="topic")
        np.testing.assert_allclose(topic_norm.min(axis=0), np.zeros(3), atol=1e-5)
        np.testing.assert_allclose(topic_norm.max(axis=0), np.ones(3), atol=1e-5)

        p3 = partition_and_aggregate_chunks(np.arange(20, dtype=np.float32).reshape(10, 2), 3)
        self.assertEqual(p3.n_actual, 3)

        macro_mat, macro_labels = project_matrix_granularity(
            np.ones((4, len(V5_LEAF_CLASSES)), dtype=np.float32), V5_LEAF_CLASSES, "macro"
        )
        self.assertEqual(macro_labels, MACRO_CATEGORIES)
        self.assertEqual(macro_mat.shape, (4, 13))


class TestMiningFOMCV4(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.TemporaryDirectory(prefix="fomc_v4_test_")
        cls.root = Path(cls._tmpdir.name)
        build_synthetic_fomc_corpus(cls.root)
        db_file = cls.root / "test_v4.db"
        clear_speaker_catalog_cache()
        set_settings(
            Settings(
                fomc_data_dir=cls.root,
                database_url=f"sqlite:///{db_file}",
                jwt_secret_key="test-secret-key-v4",
                admin_username="rootadmin",
                admin_email="admin@miningfomc.com",
                admin_password="AdminPassword123!",
            )
        )
        reset_repository()
        cls.client = TestClient(create_app())

    @classmethod
    def tearDownClass(cls):
        set_settings(None)
        clear_speaker_catalog_cache()
        reset_repository()
        cls._tmpdir.cleanup()

    def _login(self, ident: str, password: str) -> dict[str, str]:
        r = self.client.post("/api/auth/login", json={"email": ident, "password": password})
        self.assertEqual(r.status_code, 200, r.text)
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    def test_health_diagnostics_and_auth_gate(self):
        h = self.client.get("/api/health")
        self.assertEqual(h.status_code, 200)
        ds_info = h.json()["datasets"]
        self.assertTrue(ds_info["relevance_scores"]["exists"])
        self.assertTrue(ds_info["participants_parquet"]["exists"])
        self.assertEqual(self.client.get("/api/explorer/search").status_code, 401)

    def test_speaker_autocomplete_and_unified_date_filter(self):
        hdrs = self._login("rootadmin", "AdminPassword123!")
        ac = self.client.get("/api/speakers/autocomplete", params={"q": "yell"}, headers=hdrs)
        self.assertEqual(ac.status_code, 200)
        self.assertIn("Janet Yellen", [item["name"] for item in ac.json()["items"]])

        exact = self.client.get(
            "/api/explorer/search", params={"date_from": "2008-09-16"}, headers=hdrs
        )
        self.assertEqual(exact.status_code, 200)
        self.assertEqual(exact.json()["total"], 1)

    def test_v4_grouping_tree_ordered_timeseries_and_slice_inspector(self):
        hdrs = self._login("rootadmin", "AdminPassword123!")
        docs = [
            {"doc_type": "transcripts", "meeting_date": "2008-09-16"},
            {"doc_type": "transcripts", "meeting_date": "2009-03-18"},
        ]

        # 1. Tree preview: Speaker -> Semester
        prev = self.client.post(
            "/api/comparator/tree-preview",
            json={
                "documents": docs,
                "split_levels": [
                    {"criterion": "speaker"},
                    {"criterion": "semester"},
                ],
                "hidden_node_ids": [],
            },
            headers=hdrs,
        )
        self.assertEqual(prev.status_code, 200, prev.text)
        pdata = prev.json()
        self.assertEqual(pdata["root"]["doc_count"], 2)
        self.assertEqual(pdata["visible_leaf_count"], 4)  # 2 speakers x 2 semesters
        self.assertTrue(pdata["valid_for_compare"])

        # Hide 1 speaker branch -> visible leaves drops to 2
        bernanke_id = "root/speaker:CHAIRMAN BERNANKE"
        prev_hidden = self.client.post(
            "/api/comparator/tree-preview",
            json={
                "documents": docs,
                "split_levels": [
                    {"criterion": "speaker"},
                    {"criterion": "semester"},
                ],
                "hidden_node_ids": [bernanke_id],
            },
            headers=hdrs,
        )
        self.assertEqual(prev_hidden.status_code, 200)
        self.assertEqual(prev_hidden.json()["visible_leaf_count"], 2)

        # 2. Compare with Grouping Tree: S = 2 intra-subgroup slices per period
        cmp_res = self.client.post(
            "/api/comparator/compare",
            json={
                "documents": docs,
                "n_partitions": 2,
                "combine_by": "tree",
                "grouping_tree": {
                    "split_levels": [
                        {"criterion": "speaker"},
                        {"criterion": "semester"},
                    ],
                    "hidden_node_ids": [],
                },
            },
            headers=hdrs,
        )
        self.assertEqual(cmp_res.status_code, 200, cmp_res.text)
        cdata = cmp_res.json()
        self.assertEqual(cdata["combine_by"], "tree")
        # 2 chronological periods (2008-H2, 2009-H1) x 2 slices = 4 ordered ticks
        ticks = cdata["time_ticks"]
        self.assertEqual(len(ticks), 4)
        self.assertEqual(ticks[0]["period_key"], "2008-H2")
        self.assertEqual(ticks[0]["slice_index"], 1)
        self.assertEqual(ticks[2]["period_key"], "2009-H1")
        self.assertEqual(ticks[3]["slice_index"], 2)
        # 2 speaker cohort series
        ordered = cdata["ordered_series"]
        self.assertEqual(len(ordered), 2)
        self.assertEqual(len(ordered[0]["values_by_topic"]), 13)
        self.assertEqual(len(ordered[0]["values_by_topic"][0]), 4)

        # 3. Drill-down slice inspection for CHAIRMAN BERNANKE in 2008-H2 Slice 1/2
        insp = self.client.post(
            "/api/comparator/inspect-slice",
            json={
                "documents": docs,
                "path_filters": [
                    {"criterion": "speaker", "value": "CHAIRMAN BERNANKE"},
                    {"criterion": "semester", "value": "2008-H2"},
                ],
                "period_key": "2008-H2",
                "slice_index": 1,
                "n_partitions": 2,
            },
            headers=hdrs,
        )
        self.assertEqual(insp.status_code, 200, insp.text)
        idata = insp.json()
        self.assertEqual(idata["doc_count"], 1)
        self.assertGreaterEqual(idata["total_chunks_matched"], 1)
        self.assertEqual(idata["chunks"][0]["speaker"], "CHAIRMAN BERNANKE")
        self.assertTrue(len(idata["top_categories"]) > 0)

    def test_explorer_relevance_and_heatmap_axes(self):
        hdrs = self._login("rootadmin", "AdminPassword123!")
        rel = self.client.get(
            "/api/explorer/documents/transcripts/2008-09-16/relevance", headers=hdrs
        )
        self.assertEqual(rel.status_code, 200)
        self.assertTrue(rel.json()["available"])

        sim = self.client.get(
            "/api/explorer/documents/transcripts/2008-09-16/similarity",
            params={"metric": "cosine", "normalization": "topic", "granularity": "macro"},
            headers=hdrs,
        )
        self.assertEqual(sim.status_code, 200)
        self.assertEqual(len(sim.json()["matrix"]), 13)
        self.assertEqual(len(sim.json()["matrix"][0]), 4)

    def test_studies_and_fix_ledger(self):
        admin_hdrs = self._login("admin@miningfomc.com", "AdminPassword123!")
        reg = self.client.post(
            "/api/auth/register",
            json={"email": "alice@fed.org", "username": "Alice", "password": "password123"},
        )
        alice_id = reg.json()["user"]["id"]
        self.client.patch(f"/api/admin/users/{alice_id}", json={"status": "active"}, headers=admin_hdrs)
        alice_hdrs = self._login("alice@fed.org", "password123")

        fr = self.client.post(
            "/api/feedback/requests",
            json={
                "kind": "fix_relevance",
                "doc_type": "transcripts",
                "meeting_date": "2008-09-16",
                "original_table_id": "transcripts_2008-09-16_0001",
                "chunk_text": "Financial conditions remain under stress.",
                "original_distribution": {"relevant": 0.35, "irrelevant": 0.65},
                "proposed_distribution": {"relevant": 1.0, "irrelevant": 0.0},
                "user_note": "Relevant macro discussion.",
            },
            headers=alice_hdrs,
        )
        self.assertEqual(fr.status_code, 201)
        res = self.client.post(
            f"/api/admin/fix-requests/{fr.json()['id']}/resolve",
            json={"decision": "accepted", "admin_comment": "Approved."},
            headers=admin_hdrs,
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue((self.root / "corrections" / "accepted_fixes.parquet").is_file())


    def test_v5_ungrouped_and_temporal_chronological_flattening(self):
        hdrs = self._login("rootadmin", "AdminPassword123!")
        docs = [
            {"doc_type": "transcripts", "meeting_date": "2009-03-18"},
            {"doc_type": "transcripts", "meeting_date": "1981-07-07"},
            {"doc_type": "transcripts", "meeting_date": "2008-09-16"},
        ]
        # 1. Ungrouped: 3 meetings x S=2 slices -> 1 continuous curve of 6 chronological points
        res = self.client.post(
            "/api/comparator/compare",
            json={"documents": docs, "n_partitions": 2, "combine_by": "none"},
            headers=hdrs,
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        ticks = data["time_ticks"]
        self.assertEqual(len(ticks), 6)
        self.assertEqual([t["meeting_date"] for t in ticks], [
            "1981-07-07", "1981-07-07",
            "2008-09-16", "2008-09-16",
            "2009-03-18", "2009-03-18",
        ])
        self.assertEqual([t["slice_num"] for t in ticks], [1, 2, 1, 2, 1, 2])
        self.assertEqual(len(data["ordered_series"]), 1)
        self.assertEqual(len(data["ordered_series"][0]["values_by_topic"][0]), 6)

        # 2. Purely temporal tree (Year -> Month) -> merges into 1 continuous chronological curve
        res_t = self.client.post(
            "/api/comparator/compare",
            json={
                "documents": docs,
                "n_partitions": 2,
                "combine_by": "tree",
                "grouping_tree": {
                    "split_levels": [{"criterion": "year"}, {"criterion": "month"}],
                    "hidden_node_ids": [],
                },
            },
            headers=hdrs,
        )
        self.assertEqual(res_t.status_code, 200, res_t.text)
        tdata = res_t.json()
        self.assertEqual(len(tdata["ordered_series"]), 1)
        self.assertEqual(len(tdata["time_ticks"]), 6)


    def test_v6_full_chronological_csv_export(self):
        import csv as _csv, io as _io
        hdrs = self._login("rootadmin", "AdminPassword123!")
        docs = [
            {"doc_type": "transcripts", "meeting_date": "2009-03-18"},
            {"doc_type": "transcripts", "meeting_date": "1981-07-07"},
            {"doc_type": "transcripts", "meeting_date": "2008-09-16"},
        ]

        # 1. Ungrouped full chronological CSV (3 meetings x S=2 slices -> 6 rows sorted chronologically)
        r = self.client.post(
            "/api/comparator/export-csv",
            json={"documents": docs, "n_partitions": 2, "metric": "cosine", "normalization": "slice"},
            headers=hdrs,
        )
        self.assertEqual(r.status_code, 200, r.text)
        rows = list(_csv.DictReader(_io.StringIO(r.text)))
        self.assertEqual(len(rows), 6)
        self.assertEqual([row["period_or_date"] for row in rows], [
            "1981-07-07", "1981-07-07",
            "2008-09-16", "2008-09-16",
            "2009-03-18", "2009-03-18",
        ])
        self.assertEqual([int(row["slice_index"]) for row in rows], [1, 2, 1, 2, 1, 2])
        self.assertTrue(all(row["metric_transform"] == "cosine" and row["normalization"] == "slice" for row in rows))
        self.assertTrue(all(int(row["doc_count"]) == 1 and int(row["chunk_count"]) >= 1 for row in rows))
        for cat in MACRO_CATEGORIES:
            self.assertIn(cat, rows[0])

        # 2. Grouped by Speaker -> Semester (2 speakers x 2 semesters x 2 slices = 8 rows)
        r2 = self.client.post(
            "/api/comparator/export-csv",
            json={
                "documents": docs[:1] + docs[2:],
                "n_partitions": 2,
                "combine_by": "tree",
                "grouping_tree": {
                    "split_levels": [{"criterion": "speaker"}, {"criterion": "semester"}],
                    "hidden_node_ids": [],
                },
            },
            headers=hdrs,
        )
        self.assertEqual(r2.status_code, 200, r2.text)
        rows2 = list(_csv.DictReader(_io.StringIO(r2.text)))
        self.assertGreaterEqual(len(rows2), 4)
        self.assertEqual(rows2[0]["cohort"], "CHAIRMAN BERNANKE")
        self.assertEqual(rows2[0]["period_or_date"], "2008-H2")


class TestCompactCommonAppDBIntegration(unittest.TestCase):
    """End-to-end verification against the real compiled database in common/app_db."""

    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.TemporaryDirectory(prefix="fomc_app_db_live_")
        db_file = Path(cls._tmpdir.name) / "live_test.db"
        clear_speaker_catalog_cache()
        set_settings(
            Settings(
                database_url=f"sqlite:///{db_file}",
                jwt_secret_key="test-secret-live-app-db",
                admin_username="rootadmin",
                admin_email="admin@miningfomc.com",
                admin_password="AdminPassword123!",
            )
        )
        reset_repository()
        cls.client = TestClient(create_app())

    @classmethod
    def tearDownClass(cls):
        set_settings(None)
        clear_speaker_catalog_cache()
        reset_repository()
        cls._tmpdir.cleanup()

    def test_real_common_app_db_discovery_and_queries(self):
        h = self.client.get("/api/health")
        self.assertEqual(h.status_code, 200)
        h_json = h.json()
        self.assertIn("db_version", h_json)
        self.assertIn(h_json["db_version"]["version"], ("1.0.0", "1.1.0", "1.2.0", "1.3.0"))
        diag = h_json["datasets"]
        for key in (
            "data_dir",
            "text_metadata",
            "agenda_items",
            "participants_parquet",
            "participants_report",
            "participants_dir",
            "similarities",
            "zero_shot_labels",
            "relevance_scores",
        ):
            self.assertTrue(diag[key]["exists"], f"Dataset {key} should exist: {diag[key]}")
            self.assertTrue(
                "fomc-app/fomc-data" in diag[key]["path"] or "common/data" in diag[key]["path"],
                f"Unexpected dataset path: {diag[key]['path']}",
            )

        r_login = self.client.post(
            "/api/auth/login", json={"email": "rootadmin", "password": "AdminPassword123!"}
        )
        self.assertEqual(r_login.status_code, 200)
        hdrs = {"Authorization": f"Bearer {r_login.json()['access_token']}"}

        # Verify sub-chunk pooled similarity matrices work for greenbook, beige_books, agenda_items, speeches, transcripts
        for dt, mdate in (
            ("transcripts", "1997-02-04"),
            ("greenbook", "1997-02-04"),
            ("beige_books", "1997-02-04"),
            ("agenda_items", "1997-02-04"),
            ("speeches", "1995-08-10"),
        ):
            sim = self.client.get(
                f"/api/explorer/documents/{dt}/{mdate}/similarity",
                params={"metric": "cosine", "normalization": "none", "granularity": "macro"},
                headers=hdrs,
            )
            self.assertEqual(sim.status_code, 200)
            self.assertTrue(sim.json()["available"], f"Similarity missing for {dt} {mdate}")
            self.assertEqual(len(sim.json()["matrix"]), 13)

        # Verify zero-shot macro + subclass & relevance on real transcript
        zs = self.client.get("/api/explorer/documents/transcripts/1997-02-04/zero-shot", headers=hdrs)
        self.assertEqual(zs.status_code, 200)
        self.assertTrue(zs.json()["available"])
        self.assertGreater(zs.json()["total_classified"], 100)
        self.assertGreater(len(zs.json()["subclass_summary"]), 0)

        rel = self.client.get("/api/explorer/documents/transcripts/1997-02-04/relevance", headers=hdrs)
        self.assertEqual(rel.status_code, 200)
        self.assertTrue(rel.json()["available"])
        self.assertGreater(rel.json()["total_classified"], 100)

        # Verify speeches are split into individual sentence chunks (e.g. Atlanta_0002_s0000, _s0001...)
        sp_chunks = self.client.get("/api/explorer/documents/speeches/1995-08-10/chunks", headers=hdrs)
        self.assertEqual(sp_chunks.status_code, 200)
        sp_data = sp_chunks.json()
        self.assertGreater(sp_data["total"], 20, "Speech should be split into multiple sentence chunks")
        self.assertRegex(sp_data["chunks"][0]["chunk_id"], r"_s\d{4}$")

        sp_sim = self.client.get(
            "/api/explorer/documents/speeches/1995-08-10/similarity",
            params={"metric": "cosine", "normalization": "none", "granularity": "macro"},
            headers=hdrs,
        )
        self.assertEqual(sp_sim.status_code, 200)
        self.assertTrue(sp_sim.json()["available"])
        self.assertGreater(sp_sim.json()["total_chunks"], 20)

        sp_zs = self.client.get("/api/explorer/documents/speeches/1995-08-10/zero-shot", headers=hdrs)
        self.assertEqual(sp_zs.status_code, 200)
        # Since speeches zero-shot has not been re-computed at sentence level (_s0000) in Colab yet,
        # exact chunk_id matching returns available=False (no similarity patch or parent duplication).
        self.assertFalse(sp_zs.json()["available"])
        self.assertEqual(sp_zs.json()["total_classified"], 0)

        # Verify dynamic database version discovery & switching endpoints
        v_list = self.client.get("/api/db-versions")
        self.assertEqual(v_list.status_code, 200)
        v_data = v_list.json()
        self.assertIn("active", v_data)
        self.assertGreaterEqual(len(v_data["versions"]), 1)

        active_ver = v_data["active"]["version"]
        v_sel = self.client.post("/api/db-versions/select", json={"version": active_ver})
        self.assertEqual(v_sel.status_code, 200)
        self.assertEqual(v_sel.json()["active"]["version"], active_ver)

        # Verify canonical chunking rules across document types:
        # 1) books (greenbook) -> sentence-level (_s0000)
        gb_chunks = self.client.get("/api/explorer/documents/greenbook/1997-02-04/chunks", headers=hdrs).json()
        self.assertGreater(gb_chunks["total"], 100)
        self.assertRegex(gb_chunks["chunks"][0]["chunk_id"], r"_s\d{4}$")

        # 2) minutes -> sentence-level (_s0000)
        min_chunks = self.client.get("/api/explorer/documents/minutes/1997-02-04/chunks", headers=hdrs).json()
        self.assertGreater(min_chunks["total"], 50)
        self.assertRegex(min_chunks["chunks"][0]["chunk_id"], r"_s\d{4}$")

        # 3) presentations -> sentence-level with [FIG] and [TABLE] token normalization
        pres_chunks = self.client.get(
            "/api/explorer/documents/presentations/1998-02-03/chunks",
            params={"limit": 300},
            headers=hdrs,
        ).json()
        self.assertGreater(pres_chunks["total"], 20)
        has_fig_or_table_token = any(
            c["text_content"].startswith("[FIG]") or c["text_content"].startswith("[TABLE]")
            for c in pres_chunks["chunks"]
        )
        self.assertTrue(has_fig_or_table_token, "Presentations should normalize charts/tables with [FIG] and [TABLE] tokens")

        # Verify relevance scores are now available across all doc_types (speeches, greenbook, beige_books, agenda_items)
        for dt, mdate in (
            ("speeches", "1995-08-10"),
            ("greenbook", "1997-02-04"),
            ("beige_books", "1997-02-04"),
            ("agenda_items", "1997-02-04"),
        ):
            r_rel = self.client.get(f"/api/explorer/documents/{dt}/{mdate}/relevance", headers=hdrs)
            self.assertEqual(r_rel.status_code, 200)
            self.assertTrue(r_rel.json()["available"], f"Relevance should be available for {dt} {mdate}")
            self.assertGreater(r_rel.json()["total_classified"], 0)


class TestParticipantGenderResolution(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmpdir = tempfile.TemporaryDirectory(prefix="fomc_gender_test_")
        root = Path(cls._tmpdir.name)
        rows = [
            {
                "participant_id": 1,
                "board_member_name": "Janet Yellen",
                "name_raw": "MS. YELLEN",
                "name_norm": "yellen",
                "gender": "Female",
                "role_category": "Chair",
            },
            {
                "participant_id": 2,
                "board_member_name": "Ben Bernanke",
                "name_raw": "CHAIRMAN BERNANKE",
                "name_norm": "bernanke",
                "gender": "m",
                "role_category": "Chair",
            },
            {
                "participant_id": 3,
                "board_member_name": "Henry Wallich",
                "name_raw": "Mr. Wallich",
                "name_norm": "wallich",
                "gender": "M",
                "role_category": "Governor",
            },
            {
                "participant_id": 4,
                "board_member_name": "Jane Smith",
                "name_raw": "Ms. Smith",
                "name_norm": "smith",
                "gender": "Female",
                "role_category": "Economist",
            },
            {
                "participant_id": 5,
                "board_member_name": "John Smith",
                "name_raw": "Mr. Smith",
                "name_norm": "smith",
                "gender": "Male",
                "role_category": "Economist",
            },
        ]
        pq.write_table(
            pa.Table.from_pylist(rows, schema=PARTICIPANTS_SCHEMA),
            root / "participants.parquet",
        )
        cls.roster = ParquetQueryEngine(Settings(fomc_data_dir=root)).load_participants_roster()

    @classmethod
    def tearDownClass(cls):
        cls._tmpdir.cleanup()

    def _gender(self, speaker: str) -> str:
        return _participant_group_key({"speaker": speaker}, "gender", self.roster)

    def test_surname_key_and_gender_normalization(self):
        self.assertEqual(_speaker_surname_key("Janet L. Yellen"), "yellen")
        self.assertEqual(_speaker_surname_key("chair_bernanke"), "bernanke")
        self.assertEqual(_speaker_surname_key("CHAIRMAN BERNANKE"), "bernanke")
        self.assertEqual(
            _speaker_surname_key("Eric S. Rosengren, President & Chief Executive Officer"),
            "rosengren",
        )
        self.assertEqual(_normalize_gender("m"), "Male")
        self.assertEqual(_normalize_gender(" male "), "Male")
        self.assertEqual(_normalize_gender("F"), "Female")
        self.assertEqual(_normalize_gender(""), "")

    def test_gender_resolution_by_full_name_surname_and_title(self):
        self.assertEqual(self._gender("Janet L. Yellen"), "Female")
        self.assertEqual(self._gender("MS. YELLEN"), "Female")
        self.assertEqual(self._gender("chair_bernanke"), "Male")
        self.assertEqual(self._gender("CHAIRMAN BERNANKE"), "Male")
        self.assertEqual(self._gender("Mr. Wallich"), "Male")

    def test_ambiguous_surname_is_not_guessed(self):
        self.assertEqual(self._gender("Smith"), "Unknown Gender")

    def test_role_lookup_falls_back_to_surname(self):
        role = _participant_group_key({"speaker": "Mr. Wallich"}, "speaker_role", self.roster)
        self.assertEqual(role, "Governor")


if __name__ == "__main__":
    unittest.main(verbosity=2)
