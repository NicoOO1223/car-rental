from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_role
from app.models import User
from app.schemas.configuration import ConfigurationResponse, ConfigurationUpdate
from app.services.configuration import get_configuration, update_configuration

router = APIRouter(
    prefix="/api/configuration",
    tags=["Configuration"],
    dependencies=[Depends(require_role("admin"))],
)


@router.get("", response_model=ConfigurationResponse)
def get_configuration_endpoint(db: Session = Depends(get_db)):
    return get_configuration(db)


@router.patch("", response_model=ConfigurationResponse)
def update_configuration_endpoint(
    data: ConfigurationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return update_configuration(
            db,
            actor=current_user,
            **data.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
