"""Custom SQL filter portfolio, community feed, and shared-reference routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.security import get_current_user, get_current_user_id
from ..db.repository import get_repository
from ..schemas import FilterCreateRequest, FilterUpdateRequest

router = APIRouter(prefix="/api/filters", tags=["Custom Filters"])


@router.post("", status_code=status.HTTP_201_CREATED)
def create_filter(body: FilterCreateRequest, user_id: int = Depends(get_current_user_id)):
    return get_repository().create_filter(
        user_id,
        body.title,
        body.description,
        body.sql_text,
        body.is_public,
    )


@router.get("/portfolio")
def list_portfolio(user_id: int = Depends(get_current_user_id)):
    return {"items": get_repository().list_user_filters(user_id)}


@router.get("/community")
def list_community(_user: dict = Depends(get_current_user)):
    return {"items": get_repository().list_community_filters()}


@router.patch("/{filter_id}")
def update_filter(
    filter_id: int,
    body: FilterUpdateRequest,
    user_id: int = Depends(get_current_user_id),
):
    updated = get_repository().update_filter(
        user_id,
        filter_id,
        title=body.title,
        description=body.description,
        is_public=body.is_public,
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Filter not found")
    return updated


@router.post("/{filter_id}/add", status_code=status.HTTP_201_CREATED)
def add_filter(filter_id: int, user_id: int = Depends(get_current_user_id)):
    added = get_repository().add_filter_to_me(user_id, filter_id)
    if not added:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Public filter not found",
        )
    return added


@router.delete("/{filter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_filter(filter_id: int, user_id: int = Depends(get_current_user_id)):
    if not get_repository().delete_filter(user_id, filter_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Filter not found")
    return None
