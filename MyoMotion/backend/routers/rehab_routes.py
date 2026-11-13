from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from database import get_db, User, RehabSession, Device, now_local
from schemas import (
    RehabSessionStartRequest, RehabSessionStopRequest, RehabSessionResponse
)
from auth import get_current_user
from mqtt_manager import send_node_command, normalize_mac

router = APIRouter(prefix="/api/rehab", tags=["Rehabilitation Sessions"])


@router.post("/session/start")
def start_rehab_session(
    body: RehabSessionStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Initiates a clinical upper-limb rehabilitation tracking session.
    Automatically configures ESP32 sensor pipeline into either Elbow or Wrist mode.
    """
    target_joint = body.target_joint.lower()
    target_muscle = "biceps" if target_joint == "elbow" else "forearm"
    clean_mac = normalize_mac(body.device_mac) if body.device_mac else None

    # Check device ownership if mac provided
    if clean_mac:
        device = db.query(Device).filter(
            Device.user_id == current_user.id,
            Device.mac_address == clean_mac
        ).first()
        if not device:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Device MAC not associated with your account."
            )
        # Notify physical sensor to switch active kinematics mode
        send_node_command(clean_mac, f"mode:{target_joint}")

    new_session = RehabSession(
        user_id=current_user.id,
        device_mac=clean_mac,
        target_joint=target_joint,
        target_muscle=target_muscle,
        patient_name=body.patient_name or current_user.username,
        start_time=now_local()
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)

    return {
        "status": "started",
        "session_id": new_session.id,
        "target_joint": target_joint,
        "target_muscle": target_muscle,
        "start_time": new_session.start_time.isoformat()
    }


@router.post("/session/stop")
def stop_rehab_session(
    body: RehabSessionStopRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Terminates session and permanently commits biomechanical ROM & sEMG parameters.
    Strictly checks that the authenticated user owns this session (IDOR safe).
    """
    session = db.query(RehabSession).filter(
        RehabSession.id == body.session_id,
        RehabSession.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rehabilitation session not found or access forbidden."
        )

    end_now = now_local()
    calculated_duration = body.duration_seconds
    if calculated_duration <= 0 and session.start_time:
        calculated_duration = int((end_now - session.start_time).total_seconds())

    session.end_time = end_now
    session.duration_seconds = max(1, calculated_duration)
    session.max_flexion_deg = round(body.max_flexion_deg, 1)
    session.max_extension_deg = round(body.max_extension_deg, 1)
    session.peak_emg_mvc = round(body.peak_emg_mvc, 1)
    session.avg_emg_mvc = round(body.avg_emg_mvc, 1)
    session.reps_count = body.reps_count
    if body.notes:
        session.notes = body.notes.strip()

    db.commit()
    db.refresh(session)

    return {
        "status": "stopped",
        "session_id": session.id,
        "duration_seconds": session.duration_seconds,
        "reps_count": session.reps_count
    }


@router.get("/history", response_model=List[RehabSessionResponse])
def get_rehab_history(
    joint: Optional[str] = Query(None, description="Filter by joint: elbow or wrist"),
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Query past rehabilitation sessions strictly scoped to the logged-in user."""
    query = db.query(RehabSession).filter(RehabSession.user_id == current_user.id)
    if joint:
        query = query.filter(RehabSession.target_joint == joint.lower())
    
    results = query.order_by(RehabSession.id.desc()).limit(limit).all()
    return results


@router.get("/session/{session_id}", response_model=RehabSessionResponse)
def get_session_details(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    session = db.query(RehabSession).filter(
        RehabSession.id == session_id,
        RehabSession.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found or belongs to another user."
        )
    return session


@router.delete("/session/{session_id}")
def delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    session = db.query(RehabSession).filter(
        RehabSession.id == session_id,
        RehabSession.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found."
        )
    db.delete(session)
    db.commit()
    return {"message": "Session record deleted successfully."}
