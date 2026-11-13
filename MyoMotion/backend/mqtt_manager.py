import os
import json
import asyncio
from typing import Dict, Any, Optional
import paho.mqtt.client as mqtt

from database import now_local
from websocket_manager import ws_manager

MQTT_BROKER_HOST = os.environ.get("MQTT_BROKER_HOST", "myomotion_mqtt")
MQTT_BROKER_PORT = int(os.environ.get("MQTT_BROKER_PORT", 1883))

# Global memory cache of live devices
# mac -> state dict
live_devices: Dict[str, Dict[str, Any]] = {}
main_event_loop: Optional[asyncio.AbstractEventLoop] = None


def set_main_event_loop(loop: asyncio.AbstractEventLoop):
    global main_event_loop
    main_event_loop = loop


def normalize_mac(mac: str) -> str:
    """Normalize MAC address: strip colons, dashes, and uppercase."""
    return mac.replace(":", "").replace("-", "").strip().upper()


def on_connect(client, userdata, flags, rc, *args, **kwargs):
    print(f"[MQTT] Connected to Mosquitto Broker at {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT} with code: {rc}", flush=True)
    # Subscribe to device status (LWT) and live telemetry stream
    client.subscribe("myomotion/status/+", qos=1)
    client.subscribe("myomotion/data/+", qos=0)
    print("[MQTT] Subscribed to myomotion/status/+ and myomotion/data/+", flush=True)


def on_message(client, userdata, msg, *args, **kwargs):
    global live_devices, main_event_loop
    topic = msg.topic
    payload_str = msg.payload.decode("utf-8", errors="ignore").strip()
    topic_parts = topic.split("/")

    if len(topic_parts) < 3:
        return

    sub_topic = topic_parts[1]
    mac = normalize_mac(topic_parts[2])

    # Ensure device entry exists in live state
    if mac not in live_devices:
        live_devices[mac] = {
            "mac": mac,
            "is_online": False,
            "last_seen": None,
            "mode": "elbow",
            "angle": 0.0,
            "elbow_min": 0.0,
            "elbow_max": 120.0,
            "pitch": 0.0,
            "bottom": -40.0,
            "top": 40.0,
            "raw": 0,
            "percent": 0.0,
            "mvc": 0.0,
            "baseline": 0,
            "calibrating": False
        }

    # 1. Handle LWT (Last Will and Testament) / Connection Status
    if sub_topic == "status":
        is_online = (payload_str.lower() == "online")
        live_devices[mac]["is_online"] = is_online
        live_devices[mac]["last_seen"] = now_local().isoformat()
        print(f"[MQTT LWT] Node {mac} is now {'ONLINE' if is_online else 'OFFLINE'}", flush=True)

        # Broadcast status update to frontend
        broadcast_data = {
            "type": "device_status",
            "mac": mac,
            "is_online": is_online,
            "timestamp": live_devices[mac]["last_seen"]
        }
        if main_event_loop and main_event_loop.is_running():
            asyncio.run_coroutine_threadsafe(ws_manager.broadcast(broadcast_data), main_event_loop)

    # 2. Handle Biomechanical & EMG Telemetry
    elif sub_topic == "data":
        try:
            if not payload_str:
                return
            # Strict LWT enforcement: ignore telemetry if device has disconnected / is offline
            if not live_devices[mac].get("is_online", False):
                return

            data = json.loads(payload_str)
            live_devices[mac]["last_seen"] = now_local().isoformat()

            if "mode" in data:
                live_devices[mac]["mode"] = str(data["mode"]).lower()
            if "angle" in data:
                live_devices[mac]["angle"] = float(data["angle"])
            if "elbow_min" in data:
                live_devices[mac]["elbow_min"] = float(data["elbow_min"])
            if "elbow_max" in data:
                live_devices[mac]["elbow_max"] = float(data["elbow_max"])
            if "pitch" in data:
                live_devices[mac]["pitch"] = float(data["pitch"])
            if "bottom" in data:
                live_devices[mac]["bottom"] = float(data["bottom"])
            if "top" in data:
                live_devices[mac]["top"] = float(data["top"])
            if "raw" in data:
                live_devices[mac]["raw"] = int(data["raw"])
            if "percent" in data:
                live_devices[mac]["percent"] = float(data["percent"]) if data["percent"] is not None else 0.0
            if "mvc" in data:
                live_devices[mac]["mvc"] = float(data["mvc"])
            if "baseline" in data:
                live_devices[mac]["baseline"] = int(data["baseline"])
            if "calibrating" in data:
                live_devices[mac]["calibrating"] = bool(data["calibrating"])

            # Real-time WebSocket forwarding to dashboard
            broadcast_data = {
                "type": "telemetry",
                "mac": mac,
                "data": live_devices[mac]
            }
            if main_event_loop and main_event_loop.is_running():
                asyncio.run_coroutine_threadsafe(ws_manager.broadcast(broadcast_data), main_event_loop)
        except Exception as e:
            # Drop malformed telemetry frame gracefully
            pass


# Initialize Paho MQTT client
try:
    mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=f"myomotion_backend_{os.getpid()}")
except AttributeError:
    mqtt_client = mqtt.Client(client_id=f"myomotion_backend_{os.getpid()}")

mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message


def start_mqtt_client():
    try:
        mqtt_client.connect_async(MQTT_BROKER_HOST, MQTT_BROKER_PORT, 60)
        mqtt_client.loop_start()
        print(f"[MQTT] Background worker loop initiated towards {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT}", flush=True)
    except Exception as e:
        print(f"[WARN] MQTT broker connection deferred: {e}", flush=True)


def stop_mqtt_client():
    try:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
        print("[MQTT] Client disconnected cleanly.", flush=True)
    except Exception:
        pass


def send_node_command(mac: str, command: str) -> bool:
    clean_mac = normalize_mac(mac)
    topic = f"myomotion/cmd/{clean_mac}"
    try:
        mqtt_client.publish(topic, command, qos=1)
        print(f"[MQTT CMD] Sent '{command}' to topic: {topic}", flush=True)
        return True
    except Exception as e:
        print(f"[ERROR] Failed to publish MQTT command: {e}", flush=True)
        return False


def get_live_device_state(mac: str) -> Dict[str, Any]:
    clean_mac = normalize_mac(mac)
    return live_devices.get(clean_mac, {
        "mac": clean_mac,
        "is_online": False,
        "last_seen": None,
        "mode": "elbow",
        "angle": 0.0,
        "elbow_min": 0.0,
        "elbow_max": 120.0,
        "pitch": 0.0,
        "bottom": -40.0,
        "top": 40.0,
        "raw": 0,
        "percent": 0.0,
        "mvc": 0.0,
        "baseline": 0,
        "calibrating": False
    })
