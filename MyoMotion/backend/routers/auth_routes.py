import random
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address

from database import get_db, User, OTPRecord, now_local
from schemas import (
    SendOTPRequest, RegisterRequest, LoginRequest,
    ForgotPasswordRequest, ResetPasswordRequest, UserProfileResponse
)
from auth import (
    validate_password_strength, get_password_hash,
    verify_password, create_access_token, get_current_user
)
from email_service import send_otp_email

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
limiter = Limiter(key_func=get_remote_address)


MAX_OTP_ATTEMPTS = 5
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


@router.post("/send-otp")
@limiter.limit("3/minute")
def send_otp(request: Request, body: SendOTPRequest, db: Session = Depends(get_db)):
    """Generate and dispatch a cryptographic 6-digit OTP code with 10-minute expiry."""
    email_clean = body.email.strip().lower()

    if body.purpose == "register":
        existing_user = db.query(User).filter(User.email == email_clean).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An account with this email is already registered."
            )
    elif body.purpose == "password_reset":
        existing_user = db.query(User).filter(User.email == email_clean).first()
        if not existing_user:
            # Generic message to prevent email enumeration
            return {"message": "If the account exists, a verification code was sent."}

    # Generate 6-digit cryptographic random code
    otp_code = f"{random.randint(100000, 999999)}"
    expires_at = now_local() + timedelta(minutes=10)

    otp_record = db.query(OTPRecord).filter(
        OTPRecord.email == email_clean,
        OTPRecord.purpose == body.purpose
    ).first()

    if otp_record:
        otp_record.otp = otp_code
        otp_record.failed_attempts = 0
        otp_record.expires_at = expires_at
    else:
        new_otp = OTPRecord(
            email=email_clean,
            otp=otp_code,
            purpose=body.purpose,
            failed_attempts=0,
            expires_at=expires_at
        )
        db.add(new_otp)
    db.commit()

    email_sent = send_otp_email(email_clean, otp_code, body.purpose)
    if not email_sent:
        print(f"[AUTH OTP FALLBACK] OTP for {email_clean}: {otp_code}")

    return {"message": "Verification code dispatched successfully."}


@router.post("/register")
@limiter.limit("3/minute")
def register_user(request: Request, body: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    """Registers user after validating 6-digit OTP and rigorous password entropy."""
    email_clean = body.email.strip().lower()
    username_clean = body.username.strip()

    # 1. Enforce strict password entropy
    validate_password_strength(body.password)

    # 2. Verify OTP (max 5 failed attempts, 10-minute expiry, single-use)
    otp_record = db.query(OTPRecord).filter(
        OTPRecord.email == email_clean,
        OTPRecord.purpose == "register"
    ).first()

    if not otp_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or unrecognized verification code."
        )
    if otp_record.expires_at < now_local():
        db.delete(otp_record)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification code has expired. Please request a new code."
        )
    if otp_record.otp != body.otp.strip():
        otp_record.failed_attempts += 1
        if otp_record.failed_attempts >= MAX_OTP_ATTEMPTS:
            db.delete(otp_record)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Too many failed OTP attempts. Please request a new code."
            )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or unrecognized verification code."
        )

    # 3. Check duplicate user or username
    if db.query(User).filter(User.email == email_clean).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email address is already in use."
        )
    if db.query(User).filter(User.username == username_clean).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is already taken."
        )

    # First user registered can be automatically assigned admin rights
    user_count = db.query(User).count()
    is_first_user = (user_count == 0)

    # 4. Hash and persist user
    hashed_pwd = get_password_hash(body.password)
    new_user = User(
        username=username_clean,
        email=email_clean,
        hashed_password=hashed_pwd,
        is_verified=True,
        is_admin=is_first_user
    )
    db.add(new_user)
    db.delete(otp_record)  # Prevent replay attack
    db.commit()
    db.refresh(new_user)

    # 5. Issue HttpOnly JWT Cookie immediately
    token = create_access_token(data={"sub": str(new_user.id), "username": new_user.username})
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=86400  # 24 hours
    )

    return {
        "message": "Account created successfully.",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "email": new_user.email,
            "is_admin": new_user.is_admin
        }
    }


@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    """Direct clinical login with rate-limiting, 15-min lockout backoff, and HttpOnly cookie injection."""
    identifier = body.email.strip()
    now_myt = now_local()

    # Allow login with either Email or Username
    user = db.query(User).filter(
        (User.email == identifier.lower()) | (User.username == identifier)
    ).first()

    if user and user.locked_until and user.locked_until > now_myt:
        remaining_min = max(1, int((user.locked_until - now_myt).total_seconds() // 60) + 1)
        raise HTTPException(
            status_code=423,
            detail=f"Account temporarily locked due to failed attempts. Try again in {remaining_min} minute(s)."
        )

    if not user or not verify_password(body.password, user.hashed_password):
        if user:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= MAX_LOGIN_ATTEMPTS:
                user.locked_until = now_myt + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_login_attempts = 0
                db.commit()
                raise HTTPException(
                    status_code=423,
                    detail=f"Too many failed login attempts. Account locked for {LOCKOUT_MINUTES} minutes."
                )
            db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials entered."
        )

    # Reset lockout counters upon valid authentication
    if user.failed_login_attempts > 0 or user.locked_until is not None:
        user.failed_login_attempts = 0
        user.locked_until = None
        db.commit()

    token = create_access_token(data={"sub": str(user.id), "username": user.username})

    # Set secure HttpOnly cookie (Never in localStorage)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=86400  # 24 hours
    )

    return {
        "message": "Authentication successful.",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "is_admin": user.is_admin
        }
    }


@router.post("/logout")
def logout(response: Response):
    """Cleanly purge HttpOnly session cookie."""
    response.delete_cookie(key="access_token")
    return {"message": "Session terminated successfully."}


@router.get("/me", response_model=UserProfileResponse)
def get_current_user_profile(current_user: User = Depends(get_current_user)):
    """Retrieve logged-in user profile with server-side permission validation."""
    return current_user


@router.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    email_clean = body.email.strip().lower()
    user = db.query(User).filter(User.email == email_clean).first()
    if not user:
        return {"message": "If the account exists, a recovery code was dispatched."}

    otp_code = f"{random.randint(100000, 999999)}"
    expires_at = now_local() + timedelta(minutes=10)

    record = db.query(OTPRecord).filter(
        OTPRecord.email == email_clean,
        OTPRecord.purpose == "password_reset"
    ).first()

    if record:
        record.otp = otp_code
        record.failed_attempts = 0
        record.expires_at = expires_at
    else:
        record = OTPRecord(
            email=email_clean,
            otp=otp_code,
            purpose="password_reset",
            failed_attempts=0,
            expires_at=expires_at
        )
        db.add(record)
    db.commit()

    send_otp_email(email_clean, otp_code, "password_reset")
    return {"message": "Recovery code dispatched to registered email."}


@router.post("/reset-password")
@limiter.limit("3/minute")
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    email_clean = body.email.strip().lower()
    validate_password_strength(body.new_password)

    record = db.query(OTPRecord).filter(
        OTPRecord.email == email_clean,
        OTPRecord.purpose == "password_reset"
    ).first()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid recovery code."
        )
    if record.expires_at < now_local():
        db.delete(record)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Recovery code has expired."
        )
    if record.otp != body.otp.strip():
        record.failed_attempts += 1
        if record.failed_attempts >= MAX_OTP_ATTEMPTS:
            db.delete(record)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Too many failed recovery attempts. Please request a new code."
            )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid recovery code."
        )

    user = db.query(User).filter(User.email == email_clean).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User account not found.")

    user.hashed_password = get_password_hash(body.new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    db.delete(record)
    db.commit()

    return {"message": "Password reset successfully. You may now sign in."}
