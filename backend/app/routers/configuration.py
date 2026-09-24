from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import (
    get_current_user,
    require_authenticated_user,
    require_role,
)
from app.models import User
from app.schemas.configuration import (
    ConfigurationResponse,
    ConfigurationUpdate,
    PublicConfigurationResponse,
)
from app.services.configuration import get_configuration, update_configuration

router = APIRouter(
    prefix="/api/configuration",
    tags=["Configuration"],
    dependencies=[Depends(require_role("admin"))],
)

# Separate router: the rest of the configuration is admin-only, but every
# screen that shows a price needs the currency to show it in.
public_router = APIRouter(
    prefix="/api/configuration/public",
    tags=["Configuration"],
    dependencies=[Depends(require_authenticated_user)],
)


@public_router.get("", response_model=PublicConfigurationResponse)
def get_public_configuration_endpoint(db: Session = Depends(get_db)):
    return get_configuration(db)


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
