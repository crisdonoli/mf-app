"""Centralized configuration and monorepo-aware Parquet path resolution.

Supports both:
- Monorepo local execution from ``mining-fomc/fomc-app/backend`` (automatically
  discovering sibling ``../fomc-data``, ``../fomc-clf``, and ``../fomc-labels``
  directories as well as ``./fomc-data``).
- Containerized execution where data directories are mounted at ``DATA_DIR``
  (default ``/fomc-data``) and optional sub-paths.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

LOGGER = logging.getLogger("miningfomc.config")

# Resolve fomc-app/ root relative to this file: backend/app/config.py
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_APP_ROOT = _BACKEND_DIR.parent
_MONOREPO_ROOT = _APP_ROOT.parent


def _load_monorepo_paths() -> dict[str, Path]:
    """Load shared paths from sibling fomc-db/common/paths.json if present (optional dev fallback)."""
    for candidate_cfg in (
        _MONOREPO_ROOT / "fomc-db" / "common" / "paths.json",
        _MONOREPO_ROOT / "common" / "paths.json",
    ):
        if not candidate_cfg.is_file():
            continue
        try:
            raw = json.loads(candidate_cfg.read_text())
            env = os.getenv("FOMC_PATHS_ENV", "local")
            base = Path(raw["roots"][env])
            if env == "local" and not base.is_dir():
                base = candidate_cfg.parent.parent
            return {"base": base, **{k: (base / rel).resolve() for k, rel in raw["paths"].items()}}
        except Exception as exc:
            LOGGER.warning("Could not parse %s: %s", candidate_cfg, exc)
    return {}


_SHARED_PATHS: dict[str, Path] = _load_monorepo_paths()

# Corpus temporal bounds (1976–2020)
CORPUS_MIN_DATE = "1976-01-01"
CORPUS_MAX_DATE = "2020-12-31"
CORPUS_MIN_YEAR = 1976
CORPUS_MAX_YEAR = 2020


def _split_csv(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


def _default_data_dir() -> Path:
    env_val = os.getenv("DATA_DIR") or os.getenv("FOMC_DATA_DIR")
    if env_val:
        return Path(env_val)
    candidates: list[Path] = [
        Path("/fomc-data"),
        _APP_ROOT / "fomc-data",
    ]
    if "app_db" in _SHARED_PATHS:
        candidates.append(_SHARED_PATHS["app_db"])
    if "common_data" in _SHARED_PATHS:
        candidates.append(_SHARED_PATHS["common_data"])
    candidates.extend([
        _MONOREPO_ROOT / "common" / "data",
        _MONOREPO_ROOT / "common" / "app_db",
    ])
    if "text_metadata" in _SHARED_PATHS:
        candidates.append(_SHARED_PATHS["text_metadata"].parent)
    candidates.extend([
        _MONOREPO_ROOT / "fomc-data" / "output",
        _MONOREPO_ROOT / "fomc-data" / "output" / "data-processed",
        _MONOREPO_ROOT / "fomc-data" / "data" / "output" / "data-processed",
    ])
    for candidate in candidates:
        if candidate.is_dir() and (candidate / "text_metadata").is_dir():
            return candidate
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return _APP_ROOT / "fomc-data"


@dataclass(frozen=True)
class Settings:
    """Immutable runtime settings loaded from environment variables."""

    app_name: str = "MiningFOMC API"
    app_version: str = "7.0.0"
    environment: str = field(default_factory=lambda: os.getenv("ENVIRONMENT", "development"))

    # Centralized data root (DATA_DIR preferred; FOMC_DATA_DIR honored for compatibility)
    fomc_data_dir: Path = field(default_factory=_default_data_dir)
    similarities_dir: Path | None = field(
        default_factory=lambda: (
            Path(os.environ["FOMC_SIMILARITIES_DIR"])
            if os.getenv("FOMC_SIMILARITIES_DIR")
            else None
        )
    )
    labels_dir: Path | None = field(
        default_factory=lambda: (
            Path(os.environ["FOMC_LABELS_DIR"])
            if os.getenv("FOMC_LABELS_DIR")
            else None
        )
    )
    relevance_dir: Path | None = field(
        default_factory=lambda: (
            Path(os.environ["FOMC_RELEVANCE_DIR"])
            if os.getenv("FOMC_RELEVANCE_DIR")
            else None
        )
    )
    corrections_dir: Path | None = field(
        default_factory=lambda: (
            Path(os.environ["CORRECTIONS_DIR"])
            if os.getenv("CORRECTIONS_DIR")
            else None
        )
    )
    taxonomy_path: Path | None = field(
        default_factory=lambda: (
            Path(os.environ["FOMC_TAXONOMY_PATH"])
            if os.getenv("FOMC_TAXONOMY_PATH")
            else (
                (_APP_ROOT / "fomc-data" / "taxonomy.json")
                if (_APP_ROOT / "fomc-data" / "taxonomy.json").is_file()
                else (
                    (_SHARED_PATHS["app_db"] / "taxonomy.json")
                    if "app_db" in _SHARED_PATHS and (_SHARED_PATHS["app_db"] / "taxonomy.json").is_file()
                    else _SHARED_PATHS.get("taxonomy")
                )
            )
        )
    )

    # Persistence for user accounts, notifications, studies, fix requests, favorites, history
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL", f"sqlite:///{_BACKEND_DIR / 'data' / 'miningfomc.db'}"
        )
    )

    # JWT authentication
    jwt_secret_key: str = field(
        default_factory=lambda: os.getenv(
            "JWT_SECRET_KEY", "dev-insecure-change-me-in-production-miningfomc"
        )
    )
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = field(
        default_factory=lambda: int(os.getenv("JWT_EXPIRE_MINUTES", "10080"))
    )

    # Bootstrap Administrator credentials from .env
    admin_username: str = field(
        default_factory=lambda: os.getenv("ADMIN_USERNAME", "admin")
    )
    admin_email: str = field(
        default_factory=lambda: os.getenv("ADMIN_EMAIL", "admin@miningfomc.com")
    )
    admin_password: str = field(
        default_factory=lambda: os.getenv("ADMIN_PASSWORD", "ChangeMeAdmin123!")
    )

    # CORS origins
    cors_origins: list[str] = field(
        default_factory=lambda: _split_csv(
            os.getenv(
                "CORS_ORIGINS",
                "http://localhost:5173,http://localhost:3000,https://miningfomc.com,https://www.miningfomc.com",
            )
        )
    )

    # DuckDB memory limit (keeps backend footprint strictly bounded)
    duckdb_memory_limit: str = field(
        default_factory=lambda: os.getenv("DUCKDB_MEMORY_LIMIT", "1GB")
    )
    duckdb_threads: int = field(
        default_factory=lambda: int(os.getenv("DUCKDB_THREADS", "4"))
    )

    # Concurrency gates for CPU-heavy endpoints (per-process semaphores)
    heavy_query_max_concurrency: int = field(
        default_factory=lambda: int(os.getenv("HEAVY_QUERY_MAX_CONCURRENCY", "2"))
    )
    heavy_query_wait_timeout_s: float = field(
        default_factory=lambda: float(os.getenv("HEAVY_QUERY_WAIT_TIMEOUT_S", "25.0"))
    )
    heavy_query_max_queue: int = field(
        default_factory=lambda: int(os.getenv("HEAVY_QUERY_MAX_QUEUE", "6"))
    )
    corpus_query_max_concurrency: int = field(
        default_factory=lambda: int(os.getenv("CORPUS_QUERY_MAX_CONCURRENCY", "4"))
    )
    heavy_query_grace_s: float = field(
        default_factory=lambda: float(os.getenv("HEAVY_QUERY_GRACE_S", "1.2"))
    )
    corpus_query_grace_s: float = field(
        default_factory=lambda: float(os.getenv("CORPUS_QUERY_GRACE_S", "0.6"))
    )

    # ------------------------------------------------------------------ Resolvers
    def resolve_text_metadata_dir(self) -> Path:
        candidates = [
            self.fomc_data_dir / "text_metadata",
            self.fomc_data_dir / "data-processed" / "text_metadata",
            self.fomc_data_dir / "data" / "output" / "data-processed" / "text_metadata",
            self.fomc_data_dir / "output" / "data-processed" / "text_metadata",
        ]
        if "text_metadata" in _SHARED_PATHS:
            candidates.append(_SHARED_PATHS["text_metadata"])
        candidates.extend([
            _MONOREPO_ROOT / "fomc-data" / "data" / "output" / "data-processed" / "text_metadata",
            _MONOREPO_ROOT / "fomc-data" / "output" / "data-processed" / "text_metadata",
        ])
        for path in candidates:
            if path.is_dir() and any(path.glob("doc_type=*")):
                return path
        for path in candidates:
            if path.is_dir():
                return path
        return candidates[0]

    def resolve_text_index_dir(self) -> Path:
        candidates = [
            self.fomc_data_dir / "text_index",
            self.fomc_data_dir / "data-processed" / "text_index",
            self.fomc_data_dir / "data" / "output" / "data-processed" / "text_index",
            self.fomc_data_dir / "output" / "data-processed" / "text_index",
            _MONOREPO_ROOT / "fomc-data" / "text_index",
        ]
        for path in candidates:
            if path.is_dir() and (
                any(path.glob("year=*/token_postings.parquet"))
                or (path / "token_postings.parquet").is_file()
            ):
                return path
        return candidates[0]

    def resolve_agenda_items_dir(self) -> Path:
        candidates = [
            self.fomc_data_dir / "agenda_items",
            self.fomc_data_dir / "data-processed" / "agenda_items",
            self.fomc_data_dir / "data" / "output" / "data-processed" / "agenda_items",
            self.fomc_data_dir / "output" / "data-processed" / "agenda_items",
        ]
        if "app_db" in _SHARED_PATHS:
            candidates.append(_SHARED_PATHS["app_db"] / "agenda_items")
        if "text_metadata" in _SHARED_PATHS:
            candidates.append(_SHARED_PATHS["text_metadata"].parent / "agenda_items")
        candidates.extend([
            _MONOREPO_ROOT / "common" / "data" / "agenda_items",
            _MONOREPO_ROOT / "common" / "app_db" / "agenda_items",
            _MONOREPO_ROOT / "fomc-data" / "output" / "agenda_items",
            _MONOREPO_ROOT / "fomc-data" / "data" / "output" / "data-processed" / "agenda_items",
            _MONOREPO_ROOT / "fomc-data" / "output" / "data-processed" / "agenda_items",
        ])
        for path in candidates:
            if path.is_dir():
                return path
        return candidates[0]

    def _participant_search_roots(self) -> list[Path]:
        """Candidate directories that may hold participants.parquet and participants_report.json.

        Covers both the ``data-processed`` folder itself and its parent ``output/`` folder.
        """
        roots: list[Path] = [
            self.fomc_data_dir,
            self.fomc_data_dir / "data-processed",
            self.fomc_data_dir.parent,
            self.fomc_data_dir / "output",
            self.fomc_data_dir / "data" / "output",
            self.fomc_data_dir / "data" / "output" / "data-processed",
            _MONOREPO_ROOT / "fomc-data" / "data" / "output",
            _MONOREPO_ROOT / "fomc-data" / "data" / "output" / "data-processed",
            _MONOREPO_ROOT / "fomc-data" / "output",
            _MONOREPO_ROOT / "fomc-data" / "output" / "data-processed",
        ]
        seen: set[Path] = set()
        unique: list[Path] = []
        for root in roots:
            if root not in seen:
                seen.add(root)
                unique.append(root)
        return unique

    def resolve_participants_file(self) -> Path:
        """Resolve the flat ``participants.parquet`` (or ``participant.parquet``) file."""
        filenames = ("participants.parquet", "participant.parquet")
        for root in self._participant_search_roots():
            for fname in filenames:
                candidate = root / fname
                if candidate.is_file():
                    return candidate
        return self.fomc_data_dir / "participants.parquet"

    def resolve_participants_report_json(self) -> Path:
        """Resolve ``participants_report.json`` in the same folder as ``data-processed``."""
        for root in self._participant_search_roots():
            candidate = root / "participants_report.json"
            if candidate.is_file():
                return candidate
        return self.fomc_data_dir / "participants_report.json"

    def resolve_participants_dir(self) -> Path:
        candidates = [
            self.fomc_data_dir / "participants",
            self.fomc_data_dir / "data-processed" / "participants",
            self.fomc_data_dir / "data" / "output" / "participants",
            self.fomc_data_dir / "output" / "participants",
        ]
        if "participants" in _SHARED_PATHS:
            candidates.append(_SHARED_PATHS["participants"])
        candidates.extend([
            _MONOREPO_ROOT / "fomc-data" / "data" / "output" / "participants",
            _MONOREPO_ROOT / "fomc-data" / "output" / "participants",
        ])
        for path in candidates:
            if path.is_dir():
                return path
        return candidates[0]

    def resolve_speeches_parquet(self) -> Path:
        candidates = [
            self.fomc_data_dir / "speeches.parquet",
            self.fomc_data_dir / "data-processed" / "speeches.parquet",
            self.fomc_data_dir / "data-processed" / "output" / "speeches.parquet",
        ]
        if "speeches" in _SHARED_PATHS:
            candidates.append(_SHARED_PATHS["speeches"])
        candidates.append(
            _MONOREPO_ROOT / "fomc-data" / "data-processed" / "output" / "speeches.parquet"
        )
        for path in candidates:
            if path.is_file():
                return path
        return candidates[0]

    def resolve_similarities_dir(self) -> Path:
        candidates: list[Path] = []
        if self.similarities_dir is not None:
            candidates.append(self.similarities_dir / "model=bge-m3" / "pooling=chunk")
            candidates.append(self.similarities_dir)
        candidates.extend(
            [
                self.fomc_data_dir / "similarities" / "model=bge-m3" / "pooling=chunk",
                self.fomc_data_dir / "similarities",
                self.fomc_data_dir / "output" / "similarities" / "model=bge-m3" / "pooling=chunk",
                Path("/fomc-similarities/model=bge-m3/pooling=chunk"),
                Path("/fomc-similarities"),
                _MONOREPO_ROOT / "fomc-clf" / "output" / "similarities" / "model=bge-m3" / "pooling=chunk",
            ]
        )
        for path in candidates:
            if path.is_dir() and any(path.glob("doc_type=*")):
                return path
        for path in candidates:
            if path.is_dir():
                return path
        return candidates[0]

    def resolve_labels_dir(self) -> Path:
        candidates: list[Path] = []
        if self.labels_dir is not None:
            candidates.append(self.labels_dir)
        candidates.extend(
            [
                self.fomc_data_dir / "labels" / "zero_shot",
                self.fomc_data_dir / "labels",
                self.fomc_data_dir / "zero_shot",
                Path("/fomc-labels"),
            ]
        )
        if "app_db" in _SHARED_PATHS:
            candidates.append(_SHARED_PATHS["app_db"] / "labels" / "zero_shot")
        if "topics" in _SHARED_PATHS:
            candidates.append(_SHARED_PATHS["topics"] / "zero_shot_all_subclasses")
            candidates.append(_SHARED_PATHS["topics"] / "zero_shot_all")
            candidates.append(_SHARED_PATHS["topics"] / "zero_shot")
        candidates.extend([
            _MONOREPO_ROOT / "common" / "data" / "labels" / "zero_shot",
            _MONOREPO_ROOT / "common" / "app_db" / "labels" / "zero_shot",
            _MONOREPO_ROOT / "fomc-labels" / "output" / "topics" / "zero_shot_all_subclasses",
            _MONOREPO_ROOT / "fomc-labels" / "output" / "topics" / "zero_shot_all",
            _MONOREPO_ROOT / "fomc-labels" / "output" / "topics" / "zero_shot",
        ])
        for path in candidates:
            if path.is_dir() and (any(path.glob("doc_type=*")) or any(path.glob("*.parquet"))):
                return path
        for path in candidates:
            if path.is_dir():
                return path
        return candidates[0]

    def resolve_relevance_file(self) -> Path:
        """Resolve ``model/relevance_score.parquet`` (primary) or ``relevance_scores.parquet``."""
        dirs: list[Path] = []
        if self.relevance_dir is not None:
            dirs.append(self.relevance_dir)
            dirs.append(self.relevance_dir / "model")
        dirs.extend(
            [
                self.fomc_data_dir / "model",
                self.fomc_data_dir / "relevance" / "model",
                self.fomc_data_dir / "relevance",
                Path("/fomc-relevance"),
                Path("/fomc-relevance/model"),
            ]
        )
        if "app_db" in _SHARED_PATHS:
            dirs.append(_SHARED_PATHS["app_db"] / "relevance" / "model")
            dirs.append(_SHARED_PATHS["app_db"] / "relevance")
        if "relevance_probs" in _SHARED_PATHS:
            dirs.append(_SHARED_PATHS["relevance_probs"].parent)
        dirs.extend(
            [
                _MONOREPO_ROOT / "common" / "data" / "relevance" / "model",
                _MONOREPO_ROOT / "common" / "app_db" / "relevance" / "model",
                _MONOREPO_ROOT / "fomc-labels" / "output" / "relevance" / "model",
                _MONOREPO_ROOT / "fomc-labels" / "output" / "relevance",
            ]
        )
        filenames = ("relevance_score.parquet", "relevance_scores.parquet")
        for directory in dirs:
            if not directory.is_dir():
                continue
            for fname in filenames:
                candidate = directory / fname
                if candidate.is_file():
                    return candidate
        return (dirs[0] if dirs else self.fomc_data_dir / "model") / "relevance_score.parquet"

    def resolve_relevance_dir(self) -> Path:
        """Return the directory containing the relevance score Parquet file."""
        return self.resolve_relevance_file().parent

    def resolve_corrections_parquet(self) -> Path:
        """Writable Parquet ledger path for accepted admin fix requests."""
        base = self.corrections_dir if self.corrections_dir is not None else (self.fomc_data_dir / "corrections")
        return base / "accepted_fixes.parquet"

    def resolve_db_version_info(self) -> dict[str, object]:
        """Read VERSION.json or manifest.json from the active FOMC database directory."""
        candidates = [
            self.fomc_data_dir / "VERSION.json",
            self.fomc_data_dir / "manifest.json",
            _APP_ROOT / "fomc-data" / "VERSION.json",
            _MONOREPO_ROOT / "fomc-db" / "common" / "data" / "VERSION.json",
            _MONOREPO_ROOT / "common" / "data" / "VERSION.json",
        ]
        for path in candidates:
            if path.is_file():
                try:
                    raw = json.loads(path.read_text(encoding="utf-8"))
                    ver = str(raw.get("version") or "1.0.0").lstrip("v")
                    return {
                        "version": ver,
                        "tag": str(raw.get("tag") or f"v{ver}"),
                        "fingerprint": str(raw.get("fingerprint") or ""),
                        "generated_at": str(raw.get("generated_at") or ""),
                        "total_indexed_chunks": int(raw.get("total_indexed_chunks") or 0),
                        "total_human_size": str(raw.get("total_human_size") or ""),
                        "notes": str(raw.get("notes") or ""),
                        "path": str(path),
                    }
                except Exception:
                    continue
        return {
            "version": "unversioned",
            "tag": "unversioned",
            "fingerprint": "",
            "generated_at": "",
            "notes": "",
            "path": str(self.fomc_data_dir / "VERSION.json"),
        }

    def discover_available_db_versions(self) -> list[dict[str, object]]:
        """Dynamically scan all database versions available on disk in the repository.

        Scans:
        - ``fomc_data_dir`` and its ``versions/v*`` or ``v*`` subdirectories
        - ``_APP_ROOT / 'fomc-data'`` and its ``versions/v*`` or ``v*`` subdirectories
        - sibling ``fomc-data-v*`` directories in ``_APP_ROOT``
        - ``common/data`` and ``common/data/versions/v*`` if present in local dev
        """
        search_roots: list[Path] = []
        base_candidates = [
            self.fomc_data_dir,
            self.fomc_data_dir.parent if self.fomc_data_dir.parent.name == "versions" else None,
            self.fomc_data_dir.parent.parent if self.fomc_data_dir.parent.name == "versions" else None,
            _APP_ROOT / "fomc-data",
            _MONOREPO_ROOT / "fomc-db" / "common" / "data",
            _MONOREPO_ROOT / "common" / "data",
        ]
        for b in base_candidates:
            if b is not None and b.is_dir() and b not in search_roots:
                search_roots.append(b)

        candidate_db_dirs: list[Path] = []
        for root in search_roots:
            candidate_db_dirs.append(root)
            versions_sub = root / "versions"
            if versions_sub.is_dir():
                for child in sorted(versions_sub.iterdir()):
                    if child.is_dir():
                        candidate_db_dirs.append(child)
            for child in sorted(root.glob("v*")):
                if child.is_dir():
                    candidate_db_dirs.append(child)
        for sibling in sorted(_APP_ROOT.glob("fomc-data-*")):
            if sibling.is_dir():
                candidate_db_dirs.append(sibling)

        active_resolved = self.fomc_data_dir.resolve()
        active_vinfo = self.resolve_db_version_info()
        active_ver_str = str(active_vinfo.get("version") or "")

        by_version: dict[str, dict[str, object]] = {}
        for db_dir in candidate_db_dirs:
            if not (db_dir / "text_metadata").is_dir():
                continue
            vfile = db_dir / "VERSION.json"
            if not vfile.is_file():
                vfile = db_dir / "manifest.json"

            ver = ""
            tag = ""
            fingerprint = ""
            generated_at = ""
            total_chunks = 0
            human_size = ""
            notes = ""
            if vfile.is_file():
                try:
                    raw = json.loads(vfile.read_text(encoding="utf-8"))
                    ver = str(raw.get("version") or "").lstrip("v")
                    tag = str(raw.get("tag") or (f"v{ver}" if ver else ""))
                    fingerprint = str(raw.get("fingerprint") or "")
                    generated_at = str(raw.get("generated_at") or "")
                    total_chunks = int(raw.get("total_indexed_chunks") or 0)
                    human_size = str(raw.get("total_human_size") or "")
                    notes = str(raw.get("notes") or "")
                except Exception:
                    pass
            if not ver:
                dir_name = db_dir.name
                if dir_name.startswith("v") and any(ch.isdigit() for ch in dir_name):
                    ver = dir_name.lstrip("v")
                    tag = f"v{ver}"
                elif dir_name.startswith("fomc-data-v"):
                    ver = dir_name.split("fomc-data-v", 1)[1]
                    tag = f"v{ver}"
                else:
                    ver = "default"
                    tag = "default"

            is_active = db_dir.resolve() == active_resolved or (
                ver == active_ver_str and ver not in by_version
            )
            entry = {
                "version": ver,
                "tag": tag or f"v{ver}",
                "fingerprint": fingerprint,
                "generated_at": generated_at,
                "total_indexed_chunks": total_chunks,
                "total_human_size": human_size,
                "notes": notes,
                "path": str(db_dir.resolve()),
                "active": False,
            }
            # Prefer exact active directory or versions/v* directory
            if ver not in by_version or db_dir.resolve() == active_resolved:
                by_version[ver] = entry

        def _semver_key(v_str: str) -> tuple:
            parts = []
            for p in v_str.split("."):
                parts.append(int(p) if p.isdigit() else -1)
            return tuple(parts)

        ordered = sorted(by_version.values(), key=lambda x: _semver_key(str(x["version"])), reverse=True)
        # Mark active entry
        marked = False
        for item in ordered:
            if Path(str(item["path"])).resolve() == active_resolved:
                item["active"] = True
                marked = True
                break
        if not marked:
            for item in ordered:
                if item["version"] == active_ver_str:
                    item["active"] = True
                    break
        return ordered

    def get_dataset_diagnostics(self) -> dict[str, dict[str, object]]:
        """Inspect resolved Parquet paths for startup health logging."""
        text_dir = self.resolve_text_metadata_dir()
        sim_dir = self.resolve_similarities_dir()
        lbl_dir = self.resolve_labels_dir()
        rel_file = self.resolve_relevance_file()
        ag_dir = self.resolve_agenda_items_dir()
        part_file = self.resolve_participants_file()
        part_report = self.resolve_participants_report_json()
        part_dir = self.resolve_participants_dir()
        corr_path = self.resolve_corrections_parquet()

        return {
            "data_dir": {"path": str(self.fomc_data_dir), "exists": self.fomc_data_dir.is_dir()},
            "text_metadata": {
                "path": str(text_dir),
                "exists": text_dir.is_dir(),
                "parquet_files": len(list(text_dir.glob("doc_type=*/year=*/part-*.parquet"))) if text_dir.is_dir() else 0,
            },
            "agenda_items": {
                "path": str(ag_dir),
                "exists": ag_dir.is_dir(),
                "parquet_files": len(list(ag_dir.glob("year=*/part-*.parquet"))) if ag_dir.is_dir() else 0,
            },
            "participants_parquet": {
                "path": str(part_file),
                "exists": part_file.is_file(),
            },
            "participants_report": {
                "path": str(part_report),
                "exists": part_report.is_file(),
            },
            "participants_dir": {
                "path": str(part_dir),
                "exists": part_dir.is_dir(),
                "parquet_files": len(list(part_dir.glob("year=*/part-*.parquet"))) if part_dir.is_dir() else 0,
            },
            "similarities": {
                "path": str(sim_dir),
                "exists": sim_dir.is_dir(),
                "parquet_files": len(list(sim_dir.glob("doc_type=*/year=*/part-*.parquet"))) if sim_dir.is_dir() else 0,
            },
            "zero_shot_labels": {
                "path": str(lbl_dir),
                "exists": lbl_dir.is_dir(),
                "parquet_files": (
                    len(list(lbl_dir.glob("doc_type=*/year=*/part-*.parquet")))
                    or len(list(lbl_dir.glob("*.parquet")))
                )
                if lbl_dir.is_dir()
                else 0,
            },
            "relevance_scores": {
                "path": str(rel_file),
                "exists": rel_file.is_file(),
            },
            "corrections_ledger": {
                "path": str(corr_path),
                "exists": corr_path.is_file(),
            },
        }

    def log_dataset_diagnostics(self) -> dict[str, dict[str, object]]:
        """Log detected Parquet datasets clearly on backend startup."""
        diag = self.get_dataset_diagnostics()
        vinfo = self.resolve_db_version_info()
        LOGGER.info(
            "=== MiningFOMC Dataset Discovery (DATA_DIR=%s | DB=%s %s) ===",
            self.fomc_data_dir,
            vinfo.get("tag"),
            f"[{vinfo['fingerprint']}]" if vinfo.get("fingerprint") else "",
        )
        for name, info in diag.items():
            status_tag = "FOUND" if info.get("exists") else "MISSING"
            extra = f" ({info['parquet_files']} parquet files)" if "parquet_files" in info else ""
            LOGGER.info("  [%-7s] %-20s -> %s%s", status_tag, name, info["path"], extra)
        return diag


_settings: Settings | None = None


def get_settings() -> Settings:
    """Return a cached Settings instance (can be reset in tests)."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def set_settings(settings: Settings | None) -> None:
    """Override settings for testing or custom initialization."""
    global _settings
    _settings = settings


def switch_active_db_version(version_or_tag: str) -> dict[str, object]:
    """Switch the active ``fomc_data_dir`` at runtime to a discovered database version."""
    from dataclasses import replace

    current = get_settings()
    clean_target = version_or_tag.strip().lstrip("v")
    available = current.discover_available_db_versions()
    matched = next(
        (
            item
            for item in available
            if str(item["version"]).lstrip("v") == clean_target
            or str(item["tag"]).lstrip("v") == clean_target
        ),
        None,
    )
    if matched is None:
        raise ValueError(
            f"Database version '{version_or_tag}' not found in repository. "
            f"Available: {[item['tag'] for item in available]}"
        )

    new_dir = Path(str(matched["path"]))
    tax_candidate = new_dir / "taxonomy.json"
    new_settings = replace(
        current,
        fomc_data_dir=new_dir,
        similarities_dir=None,
        labels_dir=None,
        relevance_dir=None,
        taxonomy_path=tax_candidate if tax_candidate.is_file() else current.taxonomy_path,
    )
    set_settings(new_settings)
    return new_settings.resolve_db_version_info()
