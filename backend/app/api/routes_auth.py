"""Authentication, User Profile, Favorite Lists, and Search History API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.security import (
    create_access_token,
    get_current_user,
    get_current_user_id,
    hash_password,
    verify_password,
)
from ..db.repository import get_repository
from ..schemas import (
    AuthTokenResponse,
    FavoriteItemCreate,
    FavoriteItemResponse,
    FavoriteListCreate,
    FavoriteListResponse,
    FavoriteListUpdate,
    RegistrationResponse,
    SearchHistoryCreate,
    SearchHistoryEntry,
    UserLoginRequest,
    UserPublic,
    UserRegisterRequest,
)

router = APIRouter(prefix="/api", tags=["Auth & User Profile"])


# ------------------------------------------------------------------ Auth
@router.post(
    "/auth/register",
    response_model=RegistrationResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_user(body: UserRegisterRequest):
    """Submit a new researcher account request (requires administrator approval)."""
    repo = get_repository()
    if repo.get_user_by_email(body.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address already exists",
        )
    pw_hash = hash_password(body.password)
    user = repo.create_user(
        body.email, body.username, pw_hash, role="user", status="pending"
    )
    repo.create_favorite_list(
        user["id"],
        name="Saved FOMC Meetings",
        description="Default research collection for bookmarked FOMC meetings and documents.",
    )
    return RegistrationResponse(
        message="Registration request submitted. An administrator must approve your account before you can sign in.",
        status="pending",
        user=UserPublic(**user),
    )


@router.post("/auth/login", response_model=AuthTokenResponse)
def login_user(body: UserLoginRequest):
    """Authenticate an approved account and return a JWT session token."""
    repo = get_repository()
    user = repo.get_user_by_email(body.email)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if user.get("status") == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending administrator approval.",
        )
    if user.get("status") == "disabled":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been disabled by an administrator.",
        )

    token = create_access_token(
        user["id"], extra_claims={"email": user["email"], "role": user["role"]}
    )
    return AuthTokenResponse(
        access_token=token,
        user=UserPublic(
            id=user["id"],
            email=user["email"],
            username=user["username"],
            role=user["role"],
            status=user["status"],
            created_at=user["created_at"],
        ),
    )


@router.get("/auth/me", response_model=UserPublic)
def get_me(user: dict = Depends(get_current_user)):
    """Return the authenticated active user's profile."""
    return UserPublic(**user)


# ------------------------------------------------------------------ Favorite Lists
@router.get("/favorites/lists", response_model=list[FavoriteListResponse])
def list_favorites(user_id: int = Depends(get_current_user_id)):
    """List all named Favorite Lists and their bookmarked meetings/documents."""
    return get_repository().list_favorite_lists(user_id)


@router.post(
    "/favorites/lists",
    response_model=FavoriteListResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_favorite_list(
    body: FavoriteListCreate, user_id: int = Depends(get_current_user_id)
):
    """Create a new custom named Favorite List."""
    return get_repository().create_favorite_list(user_id, body.name, body.description)


@router.patch("/favorites/lists/{list_id}", response_model=FavoriteListResponse)
def rename_favorite_list(
    list_id: int, body: FavoriteListUpdate, user_id: int = Depends(get_current_user_id)
):
    """Rename or update the description of an existing Favorite List."""
    updated = get_repository().update_favorite_list(
        user_id, list_id, name=body.name, description=body.description
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Favorite list not found"
        )
    return updated


@router.delete("/favorites/lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_favorite_list(list_id: int, user_id: int = Depends(get_current_user_id)):
    """Delete a Favorite List and all its saved items."""
    deleted = get_repository().delete_favorite_list(user_id, list_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Favorite list not found"
        )
    return None


@router.post(
    "/favorites/lists/{list_id}/items",
    response_model=FavoriteItemResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_item_to_list(
    list_id: int, body: FavoriteItemCreate, user_id: int = Depends(get_current_user_id)
):
    """Bookmark an FOMC meeting or specific document into a Favorite List."""
    item = get_repository().add_favorite_item(
        user_id, list_id, body.meeting_date, body.doc_type, body.note
    )
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Favorite list not found"
        )
    return item


@router.delete(
    "/favorites/lists/{list_id}/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_item_from_list(
    list_id: int, item_id: int, user_id: int = Depends(get_current_user_id)
):
    """Remove a bookmarked item from a Favorite List."""
    removed = get_repository().remove_favorite_item(user_id, list_id, item_id)
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Saved item not found"
        )
    return None


# ------------------------------------------------------------------ Search History
@router.get("/history", response_model=list[SearchHistoryEntry])
def list_search_history(user_id: int = Depends(get_current_user_id)):
    """Return the authenticated user's persistent search and document history."""
    return get_repository().list_history(user_id)


@router.post(
    "/history",
    response_model=SearchHistoryEntry,
    status_code=status.HTTP_201_CREATED,
)
def record_search_history(
    body: SearchHistoryCreate, user_id: int = Depends(get_current_user_id)
):
    """Persist a recent search query or opened document for instant restoration."""
    return get_repository().add_history(user_id, body.kind, body.label, body.payload)


@router.delete("/history", status_code=status.HTTP_204_NO_CONTENT)
def clear_search_history(user_id: int = Depends(get_current_user_id)):
    """Clear the authenticated user's search history."""
    get_repository().clear_history(user_id)
    return None
