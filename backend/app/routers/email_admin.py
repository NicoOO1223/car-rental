from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_permission
from app.models import User
from app.permissions import ADMINISTER
from app.schemas.email_admin import (
    EmailMessageItem,
    EmailPause,
    EmailPreview,
    EmailPreviewRequest,
    EmailStatus,
    EmailTestRequest,
    EmailTestResult,
    EmailTextSave,
    EmailTexts,
)
from app.services import email_admin

# Administrators only, like the rest of Configuration.
router = APIRouter(
    prefix="/api/email",
    tags=["Email"],
    dependencies=[Depends(require_permission(ADMINISTER))],
)


@router.get("/status", response_model=EmailStatus)
def get_status(db: Session = Depends(get_db)):
    return email_admin.status(db)


@router.put("/paused", response_model=EmailStatus)
def set_paused(
    data: EmailPause,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email_admin.set_paused(db, current_user, data.paused)

    return email_admin.status(db)


@router.get("/texts", response_model=EmailTexts)
def get_texts(db: Session = Depends(get_db)):
    return email_admin.texts_catalog(db)


@router.put("/texts", response_model=EmailTexts)
def save_text(
    data: EmailTextSave,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email_admin.save_text(db, current_user, data.language, data.key, data.text)

    return email_admin.texts_catalog(db)


@router.delete("/texts/{language}/{key}", response_model=EmailTexts)
def reset_text(
    language: str,
    key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email_admin.reset_text(db, current_user, language, key)

    return email_admin.texts_catalog(db)


@router.post("/preview", response_model=EmailPreview)
def preview(data: EmailPreviewRequest, db: Session = Depends(get_db)):
    return email_admin.preview(db, data.template, data.language, data.edits)


@router.post("/test", response_model=EmailTestResult)
def send_test(
    data: EmailTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return email_admin.send_test(db, current_user, data.to_address)


@router.get("/messages", response_model=list[EmailMessageItem])
def list_messages(
    status: Literal["PENDING", "SENT", "FAILED"] | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return email_admin.list_messages(db, limit=limit, only=status)


@router.post("/messages/{message_id}/retry", response_model=EmailMessageItem)
def retry_message(
    message_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return email_admin.retry_message(db, current_user, message_id)
