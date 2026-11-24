"""Administrator management endpoints: Users, Activity Feed, and Fix Request Review Queue."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.security import hash_password, require_admin
from ..core.corrections_ledger import append_accepted_fix
from ..db.repository import get_repository
from ..schemas import AdminResolveFixRequest, AdminUserUpdateRequest, UserPublic

router = APIRouter(prefix="/api/admin", tags=["Admin"])


@router.get("/users", response_model=list[UserPublic])
def admin_list_users(_admin: dict = Depends(require_admin)):
    return get_repository().list_all_users()


@router.patch("/users/{user_id}", response_model=UserPublic)
def admin_update_user(
    user_id: int,
    body: AdminUserUpdateRequest,
    _admin: dict = Depends(require_admin),
):
    pw_hash = hash_password(body.new_password) if body.new_password else None
    updated = get_repository().update_user_admin(
        user_id,
        email=body.email,
        username=body.username,
        role=body.role,
        status=body.status,
        password_hash=pw_hash,
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserPublic(**updated)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_user(user_id: int, admin: dict = Depends(require_admin)):
    if int(admin["id"]) == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own active administrator account",
        )
    if not get_repository().delete_user(user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return None


@router.get("/activity")
def admin_user_activity(_admin: dict = Depends(require_admin)):
    return {"items": get_repository().list_all_activity(limit=100)}


@router.get("/fix-requests")
def admin_list_fix_requests(_admin: dict = Depends(require_admin)):
    """List all user-submitted error feedback and label fix requests."""
    return {"items": get_repository().list_fix_requests()}


@router.post("/fix-requests/{fix_id}/resolve")
def admin_resolve_fix_request(
    fix_id: int,
    body: AdminResolveFixRequest,
    _admin: dict = Depends(require_admin),
):
    """Accept or reject a fix request, trigger user notification, and append to Parquet ledger."""
    repo = get_repository()
    existing = repo.get_fix_request(fix_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fix request not found")

    resolved = repo.resolve_fix_request(fix_id, body.decision, body.admin_comment)
    assert resolved is not None

    ledger_path_str: str | None = None
    if body.decision == "accepted":
        ledger_path = append_accepted_fix(
            username=resolved["username"],
            doc_type=resolved["doc_type"] or "unknown",
            original_table_id=resolved["original_table_id"] or f"{resolved['meeting_date']}::{resolved['doc_type']}",
            corrected_value={
                "kind": resolved["kind"],
                "proposed_distribution": resolved["proposed_distribution"],
                "user_note": resolved["user_note"],
                "admin_comment": body.admin_comment,
            },
            timestamp=resolved["resolved_at"],
        )
        ledger_path_str = str(ledger_path)

    # Trigger automatic in-app notification for the submitting user
    status_label = "Accepted" if body.decision == "accepted" else "Rejected"
    target_ref = resolved["original_table_id"] or f"{resolved['meeting_date']} ({resolved['doc_type']})"
    comment_suffix = f" — Admin note: {body.admin_comment}" if body.admin_comment.strip() else ""
    repo.create_notification(
        user_id=resolved["user_id"],
        title=f"Fix Request {status_label}: {target_ref}",
        message=f"Your {resolved['kind'].replace('_', ' ')} submission was {status_label.lower()}.{comment_suffix}",
        status_tag=body.decision,
    )

    return {"fix_request": resolved, "ledger_path": ledger_path_str}
