from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db, User, Device
from schemas import DeviceAddRequest, DeviceResponse, DeviceCommandRequest
from auth import get_current_user
from mqtt_manager import (
    normalize_mac, get_live_device_state, send_node_command
)

router = APIRouter(prefix="/api/devices", tags=["Device Management"])


@router.get("", response_model=List[DeviceResponse])
def get_user_devices(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List devices exclusively registered to the authenticated user (Zero IDOR risk)."""
    devices = db.query(Device).filter(Device.user_id == current_user.id).all()
    results = []
    for d in devices:
        live = get_live_device_state(d.mac_address)
        results.append(DeviceResponse(
            id=d.id,
            mac_address=d.mac_address,
            device_name=d.device_name,
            is_active=d.is_active,
            is_online=live.get("is_online", False),
            created_at=d.created_at
        ))
    return results


@router.post("", response_model=DeviceResponse)
def add_device(body: DeviceAddRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Register a new physical ESP32 MAC address to the user account."""
    clean_mac = normalize_mac(body.mac_address)
    if len(clean_mac) < 8 or len(clean_mac) > 17:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid MAC address length. Expecting 12 hexadecimal characters (e.g. CC7B5C284994)."
        )

    # Check if already added by this user
    existing = db.query(Device).filter(
        Device.user_id == current_user.id,
        Device.mac_address == clean_mac
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Device with MAC {clean_mac} is already in your account."
        )

    new_device = Device(
        user_id=current_user.id,
        mac_address=clean_mac,
        device_name=body.device_name or "MyoMotion Node",
        is_active=True
    )
    db.add(new_device)
    db.commit()
    db.refresh(new_device)

    live = get_live_device_state(clean_mac)
    return DeviceResponse(
        id=new_device.id,
        mac_address=new_device.mac_address,
        device_name=new_device.device_name,
        is_active=new_device.is_active,
        is_online=live.get("is_online", False),
        created_at=new_device.created_at
    )


@router.delete("/{device_id}")
def delete_device(device_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Delete a registered device with strict ownership enforcement."""
    device = db.query(Device).filter(
        Device.id == device_id,
        Device.user_id == current_user.id
    ).first()

    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found or not owned by your account."
        )

    db.delete(device)
    db.commit()
    return {"message": "Device removed successfully."}


@router.get("/{mac_address}/status")
def check_device_live_status(mac_address: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Check whether the hardware device is actively connected via MQTT Last Will and Testament."""
    clean_mac = normalize_mac(mac_address)
    
    # Ownership verification
    registered = db.query(Device).filter(
        Device.user_id == current_user.id,
        Device.mac_address == clean_mac
    ).first()

    live = get_live_device_state(clean_mac)
    is_online = live.get("is_online", False)

    return {
        "mac": clean_mac,
        "is_registered": registered is not None,
        "is_online": is_online,
        "last_seen": live.get("last_seen"),
        "mode": live.get("mode", "elbow")
    }


@router.post("/command")
def dispatch_calibration_command(body: DeviceCommandRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Transmit calibration and runtime configuration commands directly to ESP32:
    - 'tare'         : Reset IMU joint baseline to 0 degrees
    - 'elbow:min'    : Capture current elbow angle as Straightest Position (Min)
    - 'elbow:max'    : Capture current elbow angle as Max Flexed Position (Max)
    - 'elbow:reset'  : Reset Elbow Min/Max bounds to defaults
    - 'wrist:bottom' : Capture current wrist pitch as Lowest Position (Bottom)
    - 'wrist:top'    : Capture current wrist pitch as Highest Position (Top)
    - 'wrist:reset'  : Reset Wrist Curl Bottom/Top bounds to defaults
    - 'baseline'     : Capture MyoWare RELAX baseline (0%)
    - 'calibrate'    : Initiate 3-second MyoWare MAX GRIP capture (100%)
    - 'reset'        : Clear stored MyoWare calibration
    - 'mode:elbow'   : Switch node pipeline to Biceps / Elbow Curl
    - 'mode:wrist'   : Switch node pipeline to Forearm / Wrist Curl (1-DoF Sagittal)
    """
    clean_mac = normalize_mac(body.mac_address)
    
    # Verify user owns the device
    device = db.query(Device).filter(
        Device.user_id == current_user.id,
        Device.mac_address == clean_mac
    ).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthorized. You do not own this device."
        )

    success = send_node_command(clean_mac, body.command)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to forward command to MQTT broker."
        )

    return {
        "status": "dispatched",
        "command": body.command,
        "mac": clean_mac
    }
