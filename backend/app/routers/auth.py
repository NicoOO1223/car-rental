from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.auth import LoginRequest, LoginResponse
from app.services.auth import authenticate_user, create_access_token

# Deliberately NOT protected by get_current_user — this is how a token
# is obtained in the first place.
router = APIRouter(
    prefix="/api/auth",
    tags=["Auth"],
)


@router.post("/login", response_model=LoginResponse)
def login(
    data: LoginRequest,
    db: Session = Depends(get_db),
):
    user = authenticate_user(db, data.email, data.password)

    if user is None:
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    return LoginResponse(access_token=create_access_token(user.id))
