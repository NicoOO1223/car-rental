from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_authenticated_user
from app.models import User
from app.schemas.condition_review import (
    ConditionPhotoInput,
    ConditionReviewResponse,
    TireConditionInput,
)
from app.services.condition_reviews import (
    add_photo,
    get_photo,
    get_review,
    read_photo_bytes,
    save_tire_condition,
)

router = APIRouter(
    prefix="/api/reservations/{reservation_id}/condition-reviews",
    tags=["Condition Reviews"],
    dependencies=[Depends(require_authenticated_user)],
)

# Separate, un-prefixed router: a photo's id alone is enough to look it up,
# and nesting it under the reservation-scoped prefix above would need the
# reservation_id repeated in every image <img>/fetch call for no benefit.
photos_router = APIRouter(
    prefix="/api/condition-photos",
    tags=["Condition Reviews"],
    dependencies=[Depends(require_authenticated_user)],
)


@router.get("/{kind}", response_model=ConditionReviewResponse | None)
def get_review_endpoint(
    reservation_id: UUID,
    kind: str,
    db: Session = Depends(get_db),
):
    return get_review(db, reservation_id, kind)


@router.put("/{kind}/tire-condition", response_model=ConditionReviewResponse)
def save_tire_condition_endpoint(
    reservation_id: UUID,
    kind: str,
    data: TireConditionInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    return save_tire_condition(db, reservation_id, kind, data.tire_condition, current_user)


@router.post("/{kind}/photos", response_model=ConditionReviewResponse)
def add_photo_endpoint(
    reservation_id: UUID,
    kind: str,
    data: ConditionPhotoInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
):
    return add_photo(db, reservation_id, kind, data.category, data.data_url, current_user)


@photos_router.get("/{photo_id}/content")
def get_photo_content_endpoint(
    photo_id: UUID,
    db: Session = Depends(get_db),
):
    photo = get_photo(db, photo_id)
    content = read_photo_bytes(photo)

    return Response(content=content, media_type=photo.content_type)
