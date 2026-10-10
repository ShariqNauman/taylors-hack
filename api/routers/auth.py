"""
EarlyEye API — Authentication & Role-Based Access Control Router (CUT List #7)

Provides JWT authentication for control-room operators, wardens, site managers, and admins.
Pre-configures demo accounts for rapid testing during hackathon presentations.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
import jwt

from api.config import JWT_ALGORITHM, JWT_EXPIRE_HOURS, JWT_SECRET
from api.models import LoginRequest, TokenResponse, UserProfile, UserRole

router = APIRouter(prefix="", tags=["auth"])

# Demo accounts for hackathon judges & team
DEMO_USERS = {
    "operator": {
        "password": "password123",
        "profile": UserProfile(
            username="operator",
            full_name="Hakim (Desk Operator)",
            role=UserRole.operator,
            site_id="TAYLORS-LK",
        ),
    },
    "warden_b": {
        "password": "password123",
        "profile": UserProfile(
            username="warden_b",
            full_name="Warden B (Block C Sector)",
            role=UserRole.warden,
            site_id="TAYLORS-LK",
        ),
    },
    "manager": {
        "password": "password123",
        "profile": UserProfile(
            username="manager",
            full_name="Major (R) Razak (Head of Security)",
            role=UserRole.security_manager,
            site_id="TAYLORS-LK",
        ),
    },
    "admin": {
        "password": "adminpassword",
        "profile": UserProfile(
            username="admin",
            full_name="EarlyEye System Administrator",
            role=UserRole.admin,
            site_id=None,
        ),
    },
}


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(hours=JWT_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(authorization: Optional[str] = Header(default=None)) -> Optional[UserProfile]:
    """Optional dependency: extract user from Bearer token if supplied."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username: str = payload.get("sub")
        if username in DEMO_USERS:
            return DEMO_USERS[username]["profile"]
    except Exception:
        pass
    return None


@router.post("/auth/login", response_model=TokenResponse)
def login(credentials: LoginRequest):
    """
    Authenticate control-room staff or security managers.
    Default credentials for demo:
    - `operator` / `password123`
    - `warden_b` / `password123`
    - `manager` / `password123`
    - `admin` / `adminpassword`
    """
    user_record = DEMO_USERS.get(credentials.username)
    if not user_record or user_record["password"] != credentials.password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password. Use demo account (e.g. operator / password123)",
            headers={"WWW-Authenticate": "Bearer"},
        )

    profile = user_record["profile"]
    token = create_access_token(data={"sub": profile.username, "role": profile.role.value})
    return TokenResponse(access_token=token, token_type="bearer", user=profile)


@router.get("/auth/me", response_model=UserProfile)
def get_me(user: Optional[UserProfile] = Depends(get_current_user)):
    """Retrieve profile of authenticated operator or warden."""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token required for this endpoint",
        )
    return user
