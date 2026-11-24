"""User Feedback, Label Fix Requests, and In-App Notifications API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.security import get_current_user_id
from ..db.repository import get_repository
from ..schemas import FixRequestCreate

router = APIRouter(prefix="/api", tags=["Feedback & Notifications"])


@router.post("/feedback/requests", status_code=status.HTTP_201_CREATED)
def submit_fix_request(
    body: FixRequestCreate, user_id: int = Depends(get_current_user_id)
):
    """Submit a chunk/matrix error report or interactive probability fix request."""
    return get_repository().create_fix_request(
        user_id=user_id,
        kind=body.kind,
        doc_type=body.doc_type,
        meeting_date=body.meeting_date,
        original_table_id=body.original_table_id,
        chunk_text=body.chunk_text,
        original_distribution=body.original_distribution,
        proposed_distribution=body.proposed_distribution,
        user_note=body.user_note,
    )


@router.get("/feedback/my-requests")
def list_my_fix_requests(user_id: int = Depends(get_current_user_id)):
    """Return fix requests submitted by the authenticated user."""
    return {"items": get_repository().list_fix_requests(user_id=user_id)}


@router.get("/notifications")
def list_notifications(user_id: int = Depends(get_current_user_id)):
    """Return in-app notifications for the authenticated user."""
    items = get_repository().list_notifications(user_id)
    unread = sum(1 for n in items if not n["is_read"])
    return {"items": items, "unread_count": unread}


@router.patch("/notifications/{notif_id}/read")
def mark_notification_read(
    notif_id: int, user_id: int = Depends(get_current_user_id)
):
    """Mark a single notification as read."""
    if not get_repository().mark_notification_read(user_id, notif_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found"
        )
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(user_id: int = Depends(get_current_user_id)):
    """Mark all notifications for the current user as read."""
    get_repository().mark_all_notifications_read(user_id)
    return {"ok": True}
