from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
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
from app.services.branding import remove_logo, set_logo
from app.services.configuration import get_configuration, update_configuration
from app.services.landing_about import remove_about_image, set_about_image
from app.services.landing_cta import remove_cta_image, set_cta_image
from app.services.landing_hero import remove_hero_image, set_hero_image

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
    return update_configuration(
        db,
        actor=current_user,
        **data.model_dump(exclude_unset=True),
    )


class LogoUpload(BaseModel):
    # A data URL (data:image/png;base64,...). Bounded here so an oversized
    # body is rejected before it is decoded.
    data_url: str = Field(max_length=500_000)


@router.put("/logo", status_code=204)
def upload_logo_endpoint(
    data: LogoUpload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    set_logo(db, actor=current_user, data_url=data.data_url)

    return Response(status_code=204)


@router.delete("/logo", status_code=204)
def delete_logo_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    remove_logo(db, actor=current_user)

    return Response(status_code=204)


class HeroImageUpload(BaseModel):
    # A data URL (data:image/png;base64,...), bounded generously above the
    # logo's own cap since a hero photo is a real, full-size image.
    data_url: str = Field(max_length=5_000_000)


@router.put("/landing-hero", status_code=204)
def upload_landing_hero_endpoint(
    data: HeroImageUpload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    set_hero_image(db, actor=current_user, data_url=data.data_url)

    return Response(status_code=204)


@router.delete("/landing-hero", status_code=204)
def delete_landing_hero_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    remove_hero_image(db, actor=current_user)

    return Response(status_code=204)


@router.put("/landing-about-image", status_code=204)
def upload_landing_about_image_endpoint(
    data: HeroImageUpload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    set_about_image(db, actor=current_user, data_url=data.data_url)

    return Response(status_code=204)


@router.delete("/landing-about-image", status_code=204)
def delete_landing_about_image_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    remove_about_image(db, actor=current_user)

    return Response(status_code=204)


@router.put("/landing-cta-image", status_code=204)
def upload_landing_cta_image_endpoint(
    data: HeroImageUpload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    set_cta_image(db, actor=current_user, data_url=data.data_url)

    return Response(status_code=204)


@router.delete("/landing-cta-image", status_code=204)
def delete_landing_cta_image_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    remove_cta_image(db, actor=current_user)

    return Response(status_code=204)
