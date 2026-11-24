"""Collaborative Case Studies (Portfolio, Community Feed & Fork Lineage) routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.security import get_current_user, get_current_user_id
from ..db.repository import get_repository
from ..schemas import StudyCreateRequest, StudyForkRequest, StudyUpdateRequest

router = APIRouter(prefix="/api/studies", tags=["Studies & Community"])


@router.get("/portfolio")
def list_portfolio(user_id: int = Depends(get_current_user_id)):
    """List all studies created or forked by the authenticated user."""
    return {"items": get_repository().list_portfolio_studies(user_id)}


@router.get("/community")
def list_community(_user: dict = Depends(get_current_user)):
    """List all public studies with full fork lineage links."""
    return {"items": get_repository().list_community_studies()}


@router.get("/{study_id}")
def get_study(study_id: int, user_id: int = Depends(get_current_user_id)):
    """Fetch a single study if it is public or owned by the authenticated user."""
    study = get_repository().get_study(study_id)
    if not study or (not study["is_public"] and study["owner_id"] != user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Study not found")
    return study


@router.post("", status_code=status.HTTP_201_CREATED)
def create_study(body: StudyCreateRequest, user_id: int = Depends(get_current_user_id)):
    """Save a new Comparator study into the user's Portfolio."""
    return get_repository().create_study(
        owner_id=user_id,
        title=body.title,
        description=body.description,
        config=body.config,
        is_public=body.is_public,
    )


@router.patch("/{study_id}")
def update_study(
    study_id: int, body: StudyUpdateRequest, user_id: int = Depends(get_current_user_id)
):
    """Update an owned study's metadata, visibility, or Comparator snapshot."""
    updated = get_repository().update_study(
        user_id,
        study_id,
        title=body.title,
        description=body.description,
        config=body.config,
        is_public=body.is_public,
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Study not found")
    return updated


@router.delete("/{study_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_study(study_id: int, user_id: int = Depends(get_current_user_id)):
    """Delete an owned study from the user's Portfolio."""
    if not get_repository().delete_study(user_id, study_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Study not found")
    return None


@router.post("/{study_id}/fork", status_code=status.HTTP_201_CREATED)
def fork_study(
    study_id: int,
    body: StudyForkRequest,
    user_id: int = Depends(get_current_user_id),
):
    """Fork a public study into the current user's Portfolio with preserved lineage."""
    forked = get_repository().fork_study(
        user_id,
        study_id,
        title=body.title,
        description=body.description,
        config_override=body.config,
    )
    if not forked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Public parent study not found",
        )
    return forked
