from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field


class SendOTPRequest(BaseModel):
    email: EmailStr
    purpose: str = Field(default="register", pattern="^(register|password_reset)$")


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=8, max_length=70)
    otp: str = Field(min_length=6, max_length=6)


class LoginRequest(BaseModel):
    email: str
    password: str = Field(max_length=70)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=6, max_length=6)
    new_password: str = Field(min_length=8, max_length=70)


class UserProfileResponse(BaseModel):
    id: int
    username: str
    email: str
    is_admin: bool
    created_at: datetime

    class Config:
        from_attributes = True


class DeviceAddRequest(BaseModel):
    mac_address: str = Field(min_length=8, max_length=32)
    device_name: Optional[str] = "MyoMotion Sensor Node"


class DeviceResponse(BaseModel):
    id: int
    mac_address: str
    device_name: str
    is_active: bool
    is_online: bool
    created_at: datetime

    class Config:
        from_attributes = True


class DeviceCommandRequest(BaseModel):
    mac_address: str
    command: str = Field(
        description="Command to dispatch to ESP32: tare, baseline, calibrate, reset, elbow:min, elbow:max, elbow:reset, wrist:bottom, wrist:top, wrist:reset, mode:elbow, mode:wrist, mode:idle"
    )


class RehabSessionStartRequest(BaseModel):
    target_joint: str = Field(pattern="^(elbow|wrist)$")
    patient_name: Optional[str] = "Patient"
    device_mac: Optional[str] = None


class RehabSessionStopRequest(BaseModel):
    session_id: int
    duration_seconds: int = 0
    max_flexion_deg: float = 0.0
    max_extension_deg: float = 0.0
    peak_emg_mvc: float = 0.0
    avg_emg_mvc: float = 0.0
    reps_count: int = 0
    notes: Optional[str] = None


class RehabSessionResponse(BaseModel):
    id: int
    user_id: int
    device_mac: Optional[str]
    target_joint: str
    target_muscle: str
    patient_name: str
    start_time: datetime
    end_time: Optional[datetime]
    duration_seconds: int
    max_flexion_deg: float
    max_extension_deg: float
    peak_emg_mvc: float
    avg_emg_mvc: float
    reps_count: int
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
