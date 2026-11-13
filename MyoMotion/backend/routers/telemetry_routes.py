import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from mqtt_manager import get_live_device_state, normalize_mac
from websocket_manager import ws_manager

router = APIRouter(tags=["Real-time Telemetry"])


@router.get("/api/telemetry/live/{mac_address}")
def get_live_telemetry_snapshot(mac_address: str):
    """Retrieve instantaneous cached sensor telemetry for polling or state hydration."""
    clean_mac = normalize_mac(mac_address)
    return get_live_device_state(clean_mac)


@router.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    """
    Sub-millisecond WebSocket data highway directly serving live biomechanics
    and EMG biofeedback stream to the interactive dashboard.
    """
    await ws_manager.connect(websocket)
    try:
        # Send initial handshake confirmation
        await websocket.send_text(json.dumps({"type": "connection", "status": "connected"}))
        while True:
            # Keep socket alive and accept client commands if transmitted via WS
            data_text = await websocket.receive_text()
            try:
                msg = json.loads(data_text)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except Exception:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)
