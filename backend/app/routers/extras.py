from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.schemas.extra import ExtraResponse
from app.services.extras import list_extras


router = APIRouter(
    prefix="/api/extras",
    tags=["Extras"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=list[ExtraResponse])
def get_extras(
    db: Session = Depends(get_db),
):
    """Bookable add-ons, in display order. Retired extras are omitted."""

    return list_extras(db)
