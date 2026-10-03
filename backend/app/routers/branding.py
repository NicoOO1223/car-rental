from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.errors import NotFoundError
from app.database import get_db
from app.services.branding import get_logo
from app.services.configuration import get_configuration
from app.services.landing_about import get_about_image, read_about_image
from app.services.landing_hero import get_hero_image, read_hero_image

# Deliberately unauthenticated: the login page needs the business name and
# logo before anyone can log in. It exposes only what is printed on the
# storefront of any business anyway: the trading name, whether a logo
# exists, and the formatting locale. Nothing else from Configuration.
router = APIRouter(prefix="/api/branding", tags=["Branding"])


class BrandingResponse(BaseModel):
    business_name: str
    has_logo: bool
    # Changes whenever the logo does, so clients can cache the image
    # forever and still pick up a new one.
    logo_version: int | None
    # The storefront landing page's hero photo — exposed here too (not just
    # to the public storefront) so the admin screen that edits it can show
    # a live preview the same way BrandMark does for the logo.
    has_hero_image: bool
    hero_image_version: int | None
    has_landing_about_image: bool
    landing_about_image_version: int | None
    locale: str
    # The interface language for anyone who has not chosen their own; the
    # sign-in page needs it before there is a signed-in person to ask.
    default_language: str


def _version(logo) -> int:
    return int(logo.updated_at.timestamp())


@router.get("", response_model=BrandingResponse)
def get_branding(db: Session = Depends(get_db)):
    configuration = get_configuration(db)
    logo = get_logo(db)
    hero = get_hero_image(db)
    about_image = get_about_image(db)

    return BrandingResponse(
        business_name=configuration.business_name,
        has_logo=logo is not None,
        logo_version=_version(logo) if logo is not None else None,
        has_hero_image=hero is not None,
        hero_image_version=_version(hero) if hero is not None else None,
        has_landing_about_image=about_image is not None,
        landing_about_image_version=_version(about_image) if about_image is not None else None,
        locale=configuration.locale,
        default_language=configuration.default_language,
    )


@router.get("/logo")
def get_branding_logo(
    request: Request,
    db: Session = Depends(get_db),
):
    logo = get_logo(db)

    if logo is None:
        raise NotFoundError("branding.no_logo", "No logo has been uploaded.")

    etag = f'"{_version(logo)}"'
    headers = {
        "ETag": etag,
        # Short, because the URL is not versioned for callers that do not
        # pass ?v=; the ETag makes revalidation cheap.
        "Cache-Control": "public, max-age=300",
    }

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)

    return Response(
        content=logo.content,
        media_type=logo.content_type,
        headers=headers,
    )


@router.get("/landing-hero")
def get_branding_landing_hero(
    request: Request,
    db: Session = Depends(get_db),
):
    hero = get_hero_image(db)

    if hero is None:
        raise NotFoundError("branding.no_landing_hero", "No hero image has been uploaded.")

    etag = f'"{_version(hero)}"'
    headers = {
        "ETag": etag,
        "Cache-Control": "public, max-age=300",
    }

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)

    return Response(
        content=read_hero_image(hero),
        media_type=hero.content_type,
        headers=headers,
    )


@router.get("/landing-about-image")
def get_branding_landing_about_image(
    request: Request,
    db: Session = Depends(get_db),
):
    about_image = get_about_image(db)

    if about_image is None:
        raise NotFoundError("branding.no_landing_about_image", "No image has been uploaded.")

    etag = f'"{_version(about_image)}"'
    headers = {
        "ETag": etag,
        "Cache-Control": "public, max-age=300",
    }

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)

    return Response(
        content=read_about_image(about_image),
        media_type=about_image.content_type,
        headers=headers,
    )
