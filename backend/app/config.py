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
                    return {
                        "version": raw.get("version", "1.0.0"),
                        "tag": raw.get("tag", f"v{raw.get('version', '1.0.0')}"),
                        "fingerprint": raw.get("fingerprint", ""),
                        "generated_at": raw.get("generated_at", ""),
                        "total_indexed_chunks": raw.get("total_indexed_chunks", 0),
                        "total_human_size": raw.get("total_human_size", ""),
                        "path": str(path),
                    }
                except Exception:
                    continue
        return {
            "version": "unversioned",
            "tag": "unversioned",
            "fingerprint": "",
            "generated_at": "",
            "path": str(self.fomc_data_dir / "VERSION.json"),
        }

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
