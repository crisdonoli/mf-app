"""Persistence repository for Users, Studies (with Fork Lineage), Fix Requests,
Notifications, Favorite Lists, and Search History.

Uses SQLAlchemy 2.0 (SQLite / PostgreSQL via ``DATABASE_URL``) with a seamless
standard-library ``sqlite3`` fallback for lightweight test environments.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import Settings, get_settings
from ..core.taxonomy import format_doc_type

try:
    from sqlalchemy import (
        Boolean,
        ForeignKey,
        Integer,
        String,
        Text,
        UniqueConstraint,
        create_engine,
        or_,
        select,
    )
    from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship

    HAS_SQLALCHEMY = True
except ImportError:  # pragma: no cover
    HAS_SQLALCHEMY = False


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


if HAS_SQLALCHEMY:

    class Base(DeclarativeBase):
        pass

    class UserModel(Base):
        __tablename__ = "users"
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
        username: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
        password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
        role: Mapped[str] = mapped_column(String(32), default="user", nullable=False)
        status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), default=_utc_now_iso)
        favorite_lists: Mapped[list["FavoriteListModel"]] = relationship(
            back_populates="user", cascade="all, delete-orphan"
        )
        history_entries: Mapped[list["SearchHistoryModel"]] = relationship(
            back_populates="user", cascade="all, delete-orphan"
        )

    class FavoriteListModel(Base):
        __tablename__ = "favorite_lists"
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
        name: Mapped[str] = mapped_column(String(120), nullable=False)
        description: Mapped[str] = mapped_column(String(500), default="")
        created_at: Mapped[str] = mapped_column(String(64), default=_utc_now_iso)
        user: Mapped["UserModel"] = relationship(back_populates="favorite_lists")
        items: Mapped[list["FavoriteItemModel"]] = relationship(
            back_populates="favorite_list", cascade="all, delete-orphan"
        )

    class FavoriteItemModel(Base):
        __tablename__ = "favorite_items"
        __table_args__ = (
            UniqueConstraint("list_id", "meeting_date", "doc_type", name="uq_list_doc"),
        )
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        list_id: Mapped[int] = mapped_column(
            ForeignKey("favorite_lists.id", ondelete="CASCADE"), index=True
        )
        meeting_date: Mapped[str] = mapped_column(String(20), nullable=False)
        doc_type: Mapped[str] = mapped_column(String(80), nullable=False)
        note: Mapped[str] = mapped_column(String(400), default="")
        added_at: Mapped[str] = mapped_column(String(64), default=_utc_now_iso)
        favorite_list: Mapped["FavoriteListModel"] = relationship(back_populates="items")

    class SearchHistoryModel(Base):
        __tablename__ = "search_history"
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
        kind: Mapped[str] = mapped_column(String(32), default="search")
        label: Mapped[str] = mapped_column(String(200), nullable=False)
        payload_json: Mapped[str] = mapped_column(Text, default="{}")
        created_at: Mapped[str] = mapped_column(String(64), default=_utc_now_iso)
        user: Mapped["UserModel"] = relationship(back_populates="history_entries")

    class StudyModel(Base):
        __tablename__ = "studies"
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
        primary_author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
        parent_study_id: Mapped[int | None] = mapped_column(
            ForeignKey("studies.id", ondelete="SET NULL"), nullable=True, index=True
        )
        title: Mapped[str] = mapped_column(String(200), nullable=False)
        description: Mapped[str] = mapped_column(Text, default="")
        config_json: Mapped[str] = mapped_column(Text, nullable=False)
        is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), default=_utc_now_iso)
        last_modified: Mapped[str] = mapped_column(String(64), default=_utc_now_iso)

    class FixRequestModel(Base):
        __tablename__ = "fix_requests"
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
        kind: Mapped[str] = mapped_column(String(40), nullable=False)
        doc_type: Mapped[str] = mapped_column(String(80), default="")
        meeting_date: Mapped[str] = mapped_column(String(20), default="")
        original_table_id: Mapped[str] = mapped_column(String(200), default="")
        chunk_text: Mapped[str] = mapped_column(Text, default="")
        original_distribution_json: Mapped[str] = mapped_column(Text, default="{}")
        proposed_distribution_json: Mapped[str] = mapped_column(Text, default="{}")
        user_note: Mapped[str] = mapped_column(Text, default="")
        status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False)
        admin_comment: Mapped[str] = mapped_column(Text, default="")
        created_at: Mapped[str] = mapped_column(String(64), default=_utc_now_iso)
        resolved_at: Mapped[str | None] = mapped_column(String(64), nullable=True)

    class NotificationModel(Base):
        __tablename__ = "notifications"
        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
        title: Mapped[str] = mapped_column(String(200), nullable=False)
        message: Mapped[str] = mapped_column(Text, nullable=False)
        status_tag: Mapped[str] = mapped_column(String(32), default="info")
        is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
        created_at: Mapped[str] = mapped_column(String(64), default=_utc_now_iso)


class AppRepository:
    """Unified persistence repository for MiningFOMC V2."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.database_url = self.settings.database_url
        self._engine = None
        self._sqlite_path: Path | None = None

        if self.database_url.startswith("sqlite:///"):
            raw_path = self.database_url.replace("sqlite:///", "", 1)
            db_path = Path(raw_path)
            db_path.parent.mkdir(parents=True, exist_ok=True)
            self._sqlite_path = db_path

        if HAS_SQLALCHEMY:
            connect_args = {"check_same_thread": False} if self.database_url.startswith("sqlite") else {}
            self._engine = create_engine(self.database_url, connect_args=connect_args, future=True)
            Base.metadata.create_all(self._engine)
            self._migrate_sqlite_columns()
        else:
            if self._sqlite_path is None:
                self._sqlite_path = Path(__file__).resolve().parents[2] / "data" / "miningfomc.db"
                self._sqlite_path.parent.mkdir(parents=True, exist_ok=True)
            self._init_sqlite_schema()

    def _sqlite_conn(self) -> sqlite3.Connection:
        assert self._sqlite_path is not None
        conn = sqlite3.connect(str(self._sqlite_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _migrate_sqlite_columns(self) -> None:
        if self._sqlite_path is None or not self._sqlite_path.exists():
            return
        with self._sqlite_conn() as conn:
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
            if "role" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
            if "status" not in cols:
                conn.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
            conn.commit()

    def _init_sqlite_schema(self) -> None:
        with self._sqlite_conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    username TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS favorite_lists (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS favorite_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    list_id INTEGER NOT NULL REFERENCES favorite_lists(id) ON DELETE CASCADE,
                    meeting_date TEXT NOT NULL,
                    doc_type TEXT NOT NULL,
                    note TEXT NOT NULL DEFAULT '',
                    added_at TEXT NOT NULL,
                    UNIQUE(list_id, meeting_date, doc_type)
                );
                CREATE TABLE IF NOT EXISTS search_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL DEFAULT 'search',
                    label TEXT NOT NULL,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS studies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    primary_author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    parent_study_id INTEGER REFERENCES studies(id) ON DELETE SET NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    config_json TEXT NOT NULL,
                    is_public INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    last_modified TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS fix_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL,
                    doc_type TEXT NOT NULL DEFAULT '',
                    meeting_date TEXT NOT NULL DEFAULT '',
                    original_table_id TEXT NOT NULL DEFAULT '',
                    chunk_text TEXT NOT NULL DEFAULT '',
                    original_distribution_json TEXT NOT NULL DEFAULT '{}',
                    proposed_distribution_json TEXT NOT NULL DEFAULT '{}',
                    user_note TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    admin_comment TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    resolved_at TEXT
                );
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    message TEXT NOT NULL,
                    status_tag TEXT NOT NULL DEFAULT 'info',
                    is_read INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                """
            )
        self._migrate_sqlite_columns()

    # ------------------------------------------------------------------ Users
    def seed_admin_user(self, email: str, username: str, password_hash: str) -> dict[str, Any]:
        existing = self.get_user_by_identifier(email) or self.get_user_by_identifier(username)
        if existing:
            return self.update_user_admin(
                existing["id"],
                email=email,
                username=username,
                role="admin",
                status="active",
                password_hash=password_hash,
            ) or existing
        return self.create_user(
            email=email,
            username=username,
            password_hash=password_hash,
            role="admin",
            status="active",
        )

    def create_user(
        self,
        email: str,
        username: str,
        password_hash: str,
        *,
        role: str = "user",
        status: str = "pending",
    ) -> dict[str, Any]:
        email_norm = email.strip().lower()
        uname = username.strip()
        now = _utc_now_iso()
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                user = UserModel(
                    email=email_norm,
                    username=uname,
                    password_hash=password_hash,
                    role=role,
                    status=status,
                    created_at=now,
                )
                session.add(user)
                session.commit()
                session.refresh(user)
                return {
                    "id": user.id,
                    "email": user.email,
                    "username": user.username,
                    "role": user.role,
                    "status": user.status,
                    "created_at": user.created_at,
                }
        with self._sqlite_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO users (email, username, password_hash, role, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (email_norm, uname, password_hash, role, status, now),
            )
            conn.commit()
            return {
                "id": int(cur.lastrowid),
                "email": email_norm,
                "username": uname,
                "role": role,
                "status": status,
                "created_at": now,
            }

    def get_user_by_identifier(self, identifier: str) -> dict[str, Any] | None:
        """Look up user by email OR username (case-insensitive)."""
        ident = identifier.strip().lower()
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                user = session.scalar(
                    select(UserModel).where(
                        or_(UserModel.email == ident, UserModel.username.ilike(ident))
                    )
                )
                if not user:
                    return None
                return {
                    "id": user.id,
                    "email": user.email,
                    "username": user.username,
                    "password_hash": user.password_hash,
                    "role": user.role,
                    "status": user.status,
                    "created_at": user.created_at,
                }
        with self._sqlite_conn() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?",
                (ident, ident),
            ).fetchone()
            return dict(row) if row else None

    def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        return self.get_user_by_identifier(email)

    def get_user_by_id(self, user_id: int) -> dict[str, Any] | None:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                user = session.get(UserModel, user_id)
                if not user:
                    return None
                return {
                    "id": user.id,
                    "email": user.email,
                    "username": user.username,
                    "role": user.role,
                    "status": user.status,
                    "created_at": user.created_at,
                }
        with self._sqlite_conn() as conn:
            row = conn.execute(
                "SELECT id, email, username, role, status, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            return dict(row) if row else None

    def list_all_users(self) -> list[dict[str, Any]]:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                users = session.scalars(select(UserModel).order_by(UserModel.id.desc())).all()
                return [
                    {
                        "id": u.id,
                        "email": u.email,
                        "username": u.username,
                        "role": u.role,
                        "status": u.status,
                        "created_at": u.created_at,
                    }
                    for u in users
                ]
        with self._sqlite_conn() as conn:
            rows = conn.execute(
                "SELECT id, email, username, role, status, created_at FROM users ORDER BY id DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def update_user_admin(
        self,
        user_id: int,
        *,
        email: str | None = None,
        username: str | None = None,
        role: str | None = None,
        status: str | None = None,
        password_hash: str | None = None,
    ) -> dict[str, Any] | None:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                u = session.get(UserModel, user_id)
                if not u:
                    return None
                if email is not None:
                    u.email = email.strip().lower()
                if username is not None:
                    u.username = username.strip()
                if role is not None:
                    u.role = role
                if status is not None:
                    u.status = status
                if password_hash is not None:
                    u.password_hash = password_hash
                session.commit()
                session.refresh(u)
                return {
                    "id": u.id,
                    "email": u.email,
                    "username": u.username,
                    "role": u.role,
                    "status": u.status,
                    "created_at": u.created_at,
                }
        with self._sqlite_conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                return None
            conn.execute(
                """
                UPDATE users
                SET email = ?, username = ?, role = ?, status = ?, password_hash = ?
                WHERE id = ?
                """,
                (
                    email.strip().lower() if email is not None else row["email"],
                    username.strip() if username is not None else row["username"],
                    role if role is not None else row["role"],
                    status if status is not None else row["status"],
                    password_hash if password_hash is not None else row["password_hash"],
                    user_id,
                ),
            )
            conn.commit()
            return self.get_user_by_id(user_id)

    def delete_user(self, user_id: int) -> bool:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                u = session.get(UserModel, user_id)
                if not u:
                    return False
                session.delete(u)
                session.commit()
                return True
        with self._sqlite_conn() as conn:
            cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
            return cur.rowcount > 0

    # ------------------------------------------------------------------ Collaborative Studies
    def _hydrate_study_dict(
        self,
        raw: dict[str, Any],
        users_by_id: dict[int, dict[str, Any]],
        all_studies: list[dict[str, Any]],
    ) -> dict[str, Any]:
        owner = users_by_id.get(raw["owner_id"], {})
        primary = users_by_id.get(raw["primary_author_id"], {})
        is_fork = raw["parent_study_id"] is not None
        parent_ref = None
        if is_fork:
            parent = next((s for s in all_studies if s["id"] == raw["parent_study_id"]), None)
            if parent:
                p_owner = users_by_id.get(parent["owner_id"], {})
                parent_ref = {
                    "id": parent["id"],
                    "title": parent["title"],
                    "author_username": p_owner.get("username", "Unknown"),
                }

        forks = [
            {
                "id": s["id"],
                "title": s["title"],
                "owner_username": users_by_id.get(s["owner_id"], {}).get("username", "Unknown"),
                "is_public": bool(s["is_public"]),
            }
            for s in all_studies
            if s["parent_study_id"] == raw["id"] and bool(s["is_public"])
        ]

        return {
            "id": raw["id"],
            "owner_id": raw["owner_id"],
            "owner_username": owner.get("username", "Unknown"),
            "primary_author_id": raw["primary_author_id"],
            "primary_author": primary.get("username", "Unknown"),
            "collaborator": owner.get("username") if is_fork else None,
            "parent_study_id": raw["parent_study_id"],
            "parent_study": parent_ref,
            "forks": forks,
            "title": raw["title"],
            "description": raw["description"],
            "config": json.loads(raw["config_json"]),
            "is_public": bool(raw["is_public"]),
            "created_at": raw["created_at"],
            "last_modified": raw["last_modified"],
        }

    def _fetch_all_studies_raw(self) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]]]:
        users_by_id = {u["id"]: u for u in self.list_all_users()}
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                rows = session.scalars(select(StudyModel).order_by(StudyModel.last_modified.desc())).all()
                studies = [
                    {
                        "id": s.id,
                        "owner_id": s.owner_id,
                        "primary_author_id": s.primary_author_id,
                        "parent_study_id": s.parent_study_id,
                        "title": s.title,
                        "description": s.description,
                        "config_json": s.config_json,
                        "is_public": bool(s.is_public),
                        "created_at": s.created_at,
                        "last_modified": s.last_modified,
                    }
                    for s in rows
                ]
                return studies, users_by_id
        with self._sqlite_conn() as conn:
            rows = conn.execute("SELECT * FROM studies ORDER BY last_modified DESC").fetchall()
            return [dict(r) for r in rows], users_by_id

    def create_study(
        self,
        owner_id: int,
        title: str,
        description: str,
        config: dict[str, Any],
        is_public: bool = False,
        *,
        primary_author_id: int | None = None,
        parent_study_id: int | None = None,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        serialized = json.dumps(config, default=str)
        p_author = primary_author_id or owner_id
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                st = StudyModel(
                    owner_id=owner_id,
                    primary_author_id=p_author,
                    parent_study_id=parent_study_id,
                    title=title.strip(),
                    description=description.strip(),
                    config_json=serialized,
                    is_public=bool(is_public),
                    created_at=now,
                    last_modified=now,
                )
                session.add(st)
                session.commit()
                new_id = st.id
        else:
            with self._sqlite_conn() as conn:
                cur = conn.execute(
                    """
                    INSERT INTO studies (
                        owner_id, primary_author_id, parent_study_id,
                        title, description, config_json, is_public, created_at, last_modified
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        owner_id,
                        p_author,
                        parent_study_id,
                        title.strip(),
                        description.strip(),
                        serialized,
                        1 if is_public else 0,
                        now,
                        now,
                    ),
                )
                conn.commit()
                new_id = int(cur.lastrowid)
        return self.get_study(new_id)  # type: ignore

    def get_study(self, study_id: int) -> dict[str, Any] | None:
        all_studies, users_by_id = self._fetch_all_studies_raw()
        target = next((s for s in all_studies if s["id"] == study_id), None)
        if not target:
            return None
        return self._hydrate_study_dict(target, users_by_id, all_studies)

    def list_portfolio_studies(self, user_id: int) -> list[dict[str, Any]]:
        all_studies, users_by_id = self._fetch_all_studies_raw()
        return [
            self._hydrate_study_dict(s, users_by_id, all_studies)
            for s in all_studies
            if s["owner_id"] == user_id
        ]

    def list_community_studies(self) -> list[dict[str, Any]]:
        all_studies, users_by_id = self._fetch_all_studies_raw()
        return [
            self._hydrate_study_dict(s, users_by_id, all_studies)
            for s in all_studies
            if bool(s["is_public"])
        ]

    def update_study(
        self,
        user_id: int,
        study_id: int,
        *,
        title: str | None = None,
        description: str | None = None,
        config: dict[str, Any] | None = None,
        is_public: bool | None = None,
    ) -> dict[str, Any] | None:
        now = _utc_now_iso()
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                st = session.scalar(
                    select(StudyModel).where(StudyModel.id == study_id, StudyModel.owner_id == user_id)
                )
                if not st:
                    return None
                if title is not None:
                    st.title = title.strip()
                if description is not None:
                    st.description = description.strip()
                if config is not None:
                    st.config_json = json.dumps(config, default=str)
                if is_public is not None:
                    st.is_public = bool(is_public)
                st.last_modified = now
                session.commit()
        else:
            with self._sqlite_conn() as conn:
                row = conn.execute(
                    "SELECT * FROM studies WHERE id = ? AND owner_id = ?", (study_id, user_id)
                ).fetchone()
                if not row:
                    return None
                conn.execute(
                    """
                    UPDATE studies
                    SET title = ?, description = ?, config_json = ?, is_public = ?, last_modified = ?
                    WHERE id = ? AND owner_id = ?
                    """,
                    (
                        title.strip() if title is not None else row["title"],
                        description.strip() if description is not None else row["description"],
                        json.dumps(config, default=str) if config is not None else row["config_json"],
                        (1 if is_public else 0) if is_public is not None else row["is_public"],
                        now,
                        study_id,
                        user_id,
                    ),
                )
                conn.commit()
        return self.get_study(study_id)

    def delete_study(self, user_id: int, study_id: int) -> bool:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                st = session.scalar(
                    select(StudyModel).where(StudyModel.id == study_id, StudyModel.owner_id == user_id)
                )
                if not st:
                    return False
                session.delete(st)
                session.commit()
                return True
        with self._sqlite_conn() as conn:
            cur = conn.execute("DELETE FROM studies WHERE id = ? AND owner_id = ?", (study_id, user_id))
            conn.commit()
            return cur.rowcount > 0

    def fork_study(
        self,
        new_owner_id: int,
        parent_study_id: int,
        *,
        title: str | None = None,
        description: str | None = None,
        config_override: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        parent = self.get_study(parent_study_id)
        if not parent or (not parent["is_public"] and parent["owner_id"] != new_owner_id):
            return None
        return self.create_study(
            owner_id=new_owner_id,
            title=title or f"{parent['title']} (Fork)",
            description=description if description is not None else parent["description"],
            config=config_override if config_override is not None else parent["config"],
            is_public=False,
            primary_author_id=parent["primary_author_id"],
            parent_study_id=parent["id"],
        )

    # ------------------------------------------------------------------ Fix Requests & Notifications
    def create_fix_request(
        self,
        *,
        user_id: int,
        kind: str,
        doc_type: str,
        meeting_date: str,
        original_table_id: str,
        chunk_text: str,
        original_distribution: dict[str, Any],
        proposed_distribution: dict[str, Any],
        user_note: str,
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        orig_json = json.dumps(original_distribution, default=str)
        prop_json = json.dumps(proposed_distribution, default=str)
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                fr = FixRequestModel(
                    user_id=user_id,
                    kind=kind,
                    doc_type=doc_type,
                    meeting_date=meeting_date,
                    original_table_id=original_table_id,
                    chunk_text=chunk_text,
                    original_distribution_json=orig_json,
                    proposed_distribution_json=prop_json,
                    user_note=user_note.strip(),
                    status="pending",
                    admin_comment="",
                    created_at=now,
                )
                session.add(fr)
                session.commit()
                fid = fr.id
        else:
            with self._sqlite_conn() as conn:
                cur = conn.execute(
                    """
                    INSERT INTO fix_requests (
                        user_id, kind, doc_type, meeting_date, original_table_id, chunk_text,
                        original_distribution_json, proposed_distribution_json, user_note,
                        status, admin_comment, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?)
                    """,
                    (
                        user_id,
                        kind,
                        doc_type,
                        meeting_date,
                        original_table_id,
                        chunk_text,
                        orig_json,
                        prop_json,
                        user_note.strip(),
                        now,
                    ),
                )
                conn.commit()
                fid = int(cur.lastrowid)
        return self.get_fix_request(fid)  # type: ignore

    def _format_fix_row(self, r: dict[str, Any], users_by_id: dict[int, dict[str, Any]]) -> dict[str, Any]:
        u = users_by_id.get(r["user_id"], {})
        return {
            "id": r["id"],
            "user_id": r["user_id"],
            "username": u.get("username", "Unknown"),
            "user_email": u.get("email", ""),
            "kind": r["kind"],
            "doc_type": r["doc_type"],
            "meeting_date": r["meeting_date"],
            "original_table_id": r["original_table_id"],
            "chunk_text": r["chunk_text"],
            "original_distribution": json.loads(r["original_distribution_json"] or "{}"),
            "proposed_distribution": json.loads(r["proposed_distribution_json"] or "{}"),
            "user_note": r["user_note"],
            "status": r["status"],
            "admin_comment": r["admin_comment"],
            "created_at": r["created_at"],
            "resolved_at": r["resolved_at"],
        }

    def get_fix_request(self, fix_id: int) -> dict[str, Any] | None:
        users_by_id = {u["id"]: u for u in self.list_all_users()}
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                fr = session.get(FixRequestModel, fix_id)
                if not fr:
                    return None
                return self._format_fix_row(
                    {
                        "id": fr.id,
                        "user_id": fr.user_id,
                        "kind": fr.kind,
                        "doc_type": fr.doc_type,
                        "meeting_date": fr.meeting_date,
                        "original_table_id": fr.original_table_id,
                        "chunk_text": fr.chunk_text,
                        "original_distribution_json": fr.original_distribution_json,
                        "proposed_distribution_json": fr.proposed_distribution_json,
                        "user_note": fr.user_note,
                        "status": fr.status,
                        "admin_comment": fr.admin_comment,
                        "created_at": fr.created_at,
                        "resolved_at": fr.resolved_at,
                    },
                    users_by_id,
                )
        with self._sqlite_conn() as conn:
            row = conn.execute("SELECT * FROM fix_requests WHERE id = ?", (fix_id,)).fetchone()
            return self._format_fix_row(dict(row), users_by_id) if row else None

    def list_fix_requests(self, user_id: int | None = None) -> list[dict[str, Any]]:
        users_by_id = {u["id"]: u for u in self.list_all_users()}
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                stmt = select(FixRequestModel).order_by(FixRequestModel.id.desc())
                if user_id is not None:
                    stmt = stmt.where(FixRequestModel.user_id == user_id)
                rows = session.scalars(stmt).all()
                return [
                    self._format_fix_row(
                        {
                            "id": fr.id,
                            "user_id": fr.user_id,
                            "kind": fr.kind,
                            "doc_type": fr.doc_type,
                            "meeting_date": fr.meeting_date,
                            "original_table_id": fr.original_table_id,
                            "chunk_text": fr.chunk_text,
                            "original_distribution_json": fr.original_distribution_json,
                            "proposed_distribution_json": fr.proposed_distribution_json,
                            "user_note": fr.user_note,
                            "status": fr.status,
                            "admin_comment": fr.admin_comment,
                            "created_at": fr.created_at,
                            "resolved_at": fr.resolved_at,
                        },
                        users_by_id,
                    )
                    for fr in rows
                ]
        with self._sqlite_conn() as conn:
            if user_id is not None:
                rows = conn.execute(
                    "SELECT * FROM fix_requests WHERE user_id = ? ORDER BY id DESC", (user_id,)
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM fix_requests ORDER BY id DESC").fetchall()
            return [self._format_fix_row(dict(r), users_by_id) for r in rows]

    def resolve_fix_request(
        self, fix_id: int, decision: str, admin_comment: str = ""
    ) -> dict[str, Any] | None:
        now = _utc_now_iso()
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                fr = session.get(FixRequestModel, fix_id)
                if not fr:
                    return None
                fr.status = decision
                fr.admin_comment = admin_comment.strip()
                fr.resolved_at = now
                session.commit()
        else:
            with self._sqlite_conn() as conn:
                cur = conn.execute(
                    """
                    UPDATE fix_requests
                    SET status = ?, admin_comment = ?, resolved_at = ?
                    WHERE id = ?
                    """,
                    (decision, admin_comment.strip(), now, fix_id),
                )
                conn.commit()
                if cur.rowcount == 0:
                    return None
        return self.get_fix_request(fix_id)

    def create_notification(
        self, user_id: int, title: str, message: str, status_tag: str = "info"
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                n = NotificationModel(
                    user_id=user_id,
                    title=title,
                    message=message,
                    status_tag=status_tag,
                    is_read=False,
                    created_at=now,
                )
                session.add(n)
                session.commit()
                session.refresh(n)
                return {
                    "id": n.id,
                    "title": n.title,
                    "message": n.message,
                    "status_tag": n.status_tag,
                    "is_read": bool(n.is_read),
                    "created_at": n.created_at,
                }
        with self._sqlite_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO notifications (user_id, title, message, status_tag, is_read, created_at)
                VALUES (?, ?, ?, ?, 0, ?)
                """,
                (user_id, title, message, status_tag, now),
            )
            conn.commit()
            return {
                "id": int(cur.lastrowid),
                "title": title,
                "message": message,
                "status_tag": status_tag,
                "is_read": False,
                "created_at": now,
            }

    def list_notifications(self, user_id: int, limit: int = 40) -> list[dict[str, Any]]:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                rows = session.scalars(
                    select(NotificationModel)
                    .where(NotificationModel.user_id == user_id)
                    .order_by(NotificationModel.id.desc())
                    .limit(limit)
                ).all()
                return [
                    {
                        "id": n.id,
                        "title": n.title,
                        "message": n.message,
                        "status_tag": n.status_tag,
                        "is_read": bool(n.is_read),
                        "created_at": n.created_at,
                    }
                    for n in rows
                ]
        with self._sqlite_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "message": r["message"],
                    "status_tag": r["status_tag"],
                    "is_read": bool(r["is_read"]),
                    "created_at": r["created_at"],
                }
                for r in rows
            ]

    def mark_notification_read(self, user_id: int, notif_id: int) -> bool:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                n = session.scalar(
                    select(NotificationModel).where(
                        NotificationModel.id == notif_id, NotificationModel.user_id == user_id
                    )
                )
                if not n:
                    return False
                n.is_read = True
                session.commit()
                return True
        with self._sqlite_conn() as conn:
            cur = conn.execute(
                "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
                (notif_id, user_id),
            )
            conn.commit()
            return cur.rowcount > 0

    def mark_all_notifications_read(self, user_id: int) -> None:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                rows = session.scalars(
                    select(NotificationModel).where(
                        NotificationModel.user_id == user_id, NotificationModel.is_read == False  # noqa: E712
                    )
                ).all()
                for n in rows:
                    n.is_read = True
                session.commit()
                return
        with self._sqlite_conn() as conn:
            conn.execute("UPDATE notifications SET is_read = 1 WHERE user_id = ?", (user_id,))
            conn.commit()

    # ------------------------------------------------------------------ Admin Activity Feed
    def list_all_activity(self, limit: int = 80) -> list[dict[str, Any]]:
        """Aggregate recent searches, saved studies, and fix requests across all users."""
        users_by_id = {u["id"]: u for u in self.list_all_users()}
        events: list[dict[str, Any]] = []

        # 1. Search history
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                hist = session.scalars(
                    select(SearchHistoryModel).order_by(SearchHistoryModel.id.desc()).limit(limit)
                ).all()
                for h in hist:
                    u = users_by_id.get(h.user_id, {})
                    events.append(
                        {
                            "id": f"hist-{h.id}",
                            "user_id": h.user_id,
                            "user_email": u.get("email", ""),
                            "username": u.get("username", "Unknown"),
                            "kind": h.kind,
                            "label": h.label,
                            "created_at": h.created_at,
                        }
                    )
        else:
            with self._sqlite_conn() as conn:
                for r in conn.execute(
                    "SELECT * FROM search_history ORDER BY id DESC LIMIT ?", (limit,)
                ).fetchall():
                    u = users_by_id.get(r["user_id"], {})
                    events.append(
                        {
                            "id": f"hist-{r['id']}",
                            "user_id": r["user_id"],
                            "user_email": u.get("email", ""),
                            "username": u.get("username", "Unknown"),
                            "kind": r["kind"],
                            "label": r["label"],
                            "created_at": r["created_at"],
                        }
                    )

        # 2. Saved studies
        all_studies, _ = self._fetch_all_studies_raw()
        for s in all_studies[:limit]:
            u = users_by_id.get(s["owner_id"], {})
            events.append(
                {
                    "id": f"study-{s['id']}",
                    "user_id": s["owner_id"],
                    "user_email": u.get("email", ""),
                    "username": u.get("username", "Unknown"),
                    "kind": "study_fork" if s["parent_study_id"] else "study_saved",
                    "label": s["title"],
                    "created_at": s["last_modified"],
                }
            )

        # 3. Fix requests
        for fr in self.list_fix_requests()[:limit]:
            events.append(
                {
                    "id": f"fix-{fr['id']}",
                    "user_id": fr["user_id"],
                    "user_email": fr["user_email"],
                    "username": fr["username"],
                    "kind": fr["kind"],
                    "label": f"{fr['meeting_date']} · {fr['doc_type']} ({fr['status']})",
                    "created_at": fr["created_at"],
                }
            )

        events.sort(key=lambda e: str(e["created_at"]), reverse=True)
        return events[:limit]

    # ------------------------------------------------------------------ Favorite Lists & History
    def list_favorite_lists(self, user_id: int) -> list[dict[str, Any]]:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                lists = session.scalars(
                    select(FavoriteListModel)
                    .where(FavoriteListModel.user_id == user_id)
                    .order_by(FavoriteListModel.id.desc())
                ).all()
                return [
                    {
                        "id": fl.id,
                        "name": fl.name,
                        "description": fl.description,
                        "created_at": fl.created_at,
                        "items": [
                            {
                                "id": it.id,
                                "list_id": it.list_id,
                                "meeting_date": it.meeting_date,
                                "doc_type": it.doc_type,
                                "doc_type_label": format_doc_type(it.doc_type),
                                "note": it.note,
                                "added_at": it.added_at,
                            }
                            for it in sorted(fl.items, key=lambda x: x.id, reverse=True)
                        ],
                    }
                    for fl in lists
                ]
        with self._sqlite_conn() as conn:
            lists = conn.execute(
                "SELECT * FROM favorite_lists WHERE user_id = ? ORDER BY id DESC", (user_id,)
            ).fetchall()
            out = []
            for fl in lists:
                items = conn.execute(
                    "SELECT * FROM favorite_items WHERE list_id = ? ORDER BY id DESC", (fl["id"],)
                ).fetchall()
                out.append(
                    {
                        "id": fl["id"],
                        "name": fl["name"],
                        "description": fl["description"],
                        "created_at": fl["created_at"],
                        "items": [
                            {
                                "id": it["id"],
                                "list_id": it["list_id"],
                                "meeting_date": it["meeting_date"],
                                "doc_type": it["doc_type"],
                                "doc_type_label": format_doc_type(it["doc_type"]),
                                "note": it["note"],
                                "added_at": it["added_at"],
                            }
                            for it in items
                        ],
                    }
                )
            return out

    def create_favorite_list(self, user_id: int, name: str, description: str = "") -> dict[str, Any]:
        now = _utc_now_iso()
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                fl = FavoriteListModel(
                    user_id=user_id, name=name.strip(), description=description.strip(), created_at=now
                )
                session.add(fl)
                session.commit()
                session.refresh(fl)
                return {
                    "id": fl.id,
                    "name": fl.name,
                    "description": fl.description,
                    "created_at": fl.created_at,
                    "items": [],
                }
        with self._sqlite_conn() as conn:
            cur = conn.execute(
                "INSERT INTO favorite_lists (user_id, name, description, created_at) VALUES (?, ?, ?, ?)",
                (user_id, name.strip(), description.strip(), now),
            )
            conn.commit()
            return {
                "id": int(cur.lastrowid),
                "name": name.strip(),
                "description": description.strip(),
                "created_at": now,
                "items": [],
            }

    def update_favorite_list(
        self, user_id: int, list_id: int, *, name: str | None = None, description: str | None = None
    ) -> dict[str, Any] | None:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                fl = session.scalar(
                    select(FavoriteListModel).where(
                        FavoriteListModel.id == list_id, FavoriteListModel.user_id == user_id
                    )
                )
                if not fl:
                    return None
                if name is not None:
                    fl.name = name.strip()
                if description is not None:
                    fl.description = description.strip()
                session.commit()
                session.refresh(fl)
                return {
                    "id": fl.id,
                    "name": fl.name,
                    "description": fl.description,
                    "created_at": fl.created_at,
                    "items": [
                        {
                            "id": it.id,
                            "list_id": it.list_id,
                            "meeting_date": it.meeting_date,
                            "doc_type": it.doc_type,
                            "doc_type_label": format_doc_type(it.doc_type),
                            "note": it.note,
                            "added_at": it.added_at,
                        }
                        for it in fl.items
                    ],
                }
        with self._sqlite_conn() as conn:
            row = conn.execute(
                "SELECT * FROM favorite_lists WHERE id = ? AND user_id = ?", (list_id, user_id)
            ).fetchone()
            if not row:
                return None
            conn.execute(
                "UPDATE favorite_lists SET name = ?, description = ? WHERE id = ? AND user_id = ?",
                (
                    name.strip() if name is not None else row["name"],
                    description.strip() if description is not None else row["description"],
                    list_id,
                    user_id,
                ),
            )
            conn.commit()
        return next((fl for fl in self.list_favorite_lists(user_id) if fl["id"] == list_id), None)

    def delete_favorite_list(self, user_id: int, list_id: int) -> bool:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                fl = session.scalar(
                    select(FavoriteListModel).where(
                        FavoriteListModel.id == list_id, FavoriteListModel.user_id == user_id
                    )
                )
                if not fl:
                    return False
                session.delete(fl)
                session.commit()
                return True
        with self._sqlite_conn() as conn:
            cur = conn.execute(
                "DELETE FROM favorite_lists WHERE id = ? AND user_id = ?", (list_id, user_id)
            )
            conn.commit()
            return cur.rowcount > 0

    def add_favorite_item(
        self, user_id: int, list_id: int, meeting_date: str, doc_type: str, note: str = ""
    ) -> dict[str, Any] | None:
        now = _utc_now_iso()
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                fl = session.scalar(
                    select(FavoriteListModel).where(
                        FavoriteListModel.id == list_id, FavoriteListModel.user_id == user_id
                    )
                )
                if not fl:
                    return None
                existing = session.scalar(
                    select(FavoriteItemModel).where(
                        FavoriteItemModel.list_id == list_id,
                        FavoriteItemModel.meeting_date == meeting_date,
                        FavoriteItemModel.doc_type == doc_type,
                    )
                )
                if existing:
                    existing.note = note.strip() or existing.note
                    session.commit()
                    item = existing
                else:
                    item = FavoriteItemModel(
                        list_id=list_id,
                        meeting_date=meeting_date,
                        doc_type=doc_type,
                        note=note.strip(),
                        added_at=now,
                    )
                    session.add(item)
                    session.commit()
                    session.refresh(item)
                return {
                    "id": item.id,
                    "list_id": item.list_id,
                    "meeting_date": item.meeting_date,
                    "doc_type": item.doc_type,
                    "doc_type_label": format_doc_type(item.doc_type),
                    "note": item.note,
                    "added_at": item.added_at,
                }
        with self._sqlite_conn() as conn:
            fl = conn.execute(
                "SELECT id FROM favorite_lists WHERE id = ? AND user_id = ?", (list_id, user_id)
            ).fetchone()
            if not fl:
                return None
            existing = conn.execute(
                "SELECT * FROM favorite_items WHERE list_id = ? AND meeting_date = ? AND doc_type = ?",
                (list_id, meeting_date, doc_type),
            ).fetchone()
            if existing:
                return {
                    "id": existing["id"],
                    "list_id": existing["list_id"],
                    "meeting_date": existing["meeting_date"],
                    "doc_type": existing["doc_type"],
                    "doc_type_label": format_doc_type(existing["doc_type"]),
                    "note": existing["note"],
                    "added_at": existing["added_at"],
                }
            cur = conn.execute(
                """
                INSERT INTO favorite_items (list_id, meeting_date, doc_type, note, added_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (list_id, meeting_date, doc_type, note.strip(), now),
            )
            conn.commit()
            return {
                "id": int(cur.lastrowid),
                "list_id": list_id,
                "meeting_date": meeting_date,
                "doc_type": doc_type,
                "doc_type_label": format_doc_type(doc_type),
                "note": note.strip(),
                "added_at": now,
            }

    def remove_favorite_item(self, user_id: int, list_id: int, item_id: int) -> bool:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                item = session.scalar(
                    select(FavoriteItemModel)
                    .join(FavoriteListModel)
                    .where(
                        FavoriteItemModel.id == item_id,
                        FavoriteItemModel.list_id == list_id,
                        FavoriteListModel.user_id == user_id,
                    )
                )
                if not item:
                    return False
                session.delete(item)
                session.commit()
                return True
        with self._sqlite_conn() as conn:
            cur = conn.execute(
                """
                DELETE FROM favorite_items
                WHERE id = ? AND list_id = ?
                  AND list_id IN (SELECT id FROM favorite_lists WHERE user_id = ?)
                """,
                (item_id, list_id, user_id),
            )
            conn.commit()
            return cur.rowcount > 0

    def list_history(self, user_id: int, limit: int = 30) -> list[dict[str, Any]]:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                rows = session.scalars(
                    select(SearchHistoryModel)
                    .where(SearchHistoryModel.user_id == user_id)
                    .order_by(SearchHistoryModel.id.desc())
                    .limit(limit)
                ).all()
                return [
                    {
                        "id": r.id,
                        "kind": r.kind,
                        "label": r.label,
                        "payload": json.loads(r.payload_json or "{}"),
                        "created_at": r.created_at,
                    }
                    for r in rows
                ]
        with self._sqlite_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM search_history WHERE user_id = ? ORDER BY id DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "kind": r["kind"],
                    "label": r["label"],
                    "payload": json.loads(r["payload_json"] or "{}"),
                    "created_at": r["created_at"],
                }
                for r in rows
            ]

    def add_history(
        self, user_id: int, kind: str, label: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        now = _utc_now_iso()
        serialized = json.dumps(payload, default=str)
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                row = SearchHistoryModel(
                    user_id=user_id, kind=kind, label=label, payload_json=serialized, created_at=now
                )
                session.add(row)
                session.commit()
                session.refresh(row)
                return {
                    "id": row.id,
                    "kind": row.kind,
                    "label": row.label,
                    "payload": payload,
                    "created_at": row.created_at,
                }
        with self._sqlite_conn() as conn:
            cur = conn.execute(
                """
                INSERT INTO search_history (user_id, kind, label, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, kind, label, serialized, now),
            )
            conn.commit()
            return {
                "id": int(cur.lastrowid),
                "kind": kind,
                "label": label,
                "payload": payload,
                "created_at": now,
            }

    def clear_history(self, user_id: int) -> None:
        if HAS_SQLALCHEMY and self._engine is not None:
            with Session(self._engine) as session:
                rows = session.scalars(
                    select(SearchHistoryModel).where(SearchHistoryModel.user_id == user_id)
                ).all()
                for r in rows:
                    session.delete(r)
                session.commit()
                return
        with self._sqlite_conn() as conn:
            conn.execute("DELETE FROM search_history WHERE user_id = ?", (user_id,))
            conn.commit()


_repo: AppRepository | None = None


def get_repository() -> AppRepository:
    global _repo
    if _repo is None:
        _repo = AppRepository()
    return _repo


def reset_repository() -> None:
    global _repo
    _repo = None
