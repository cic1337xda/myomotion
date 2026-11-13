#!/usr/bin/env python3
"""
==============================================================================
MyoMotion — Physical Node Hardware Simulator (simulate_node.py)
==============================================================================
Simulates an ESP32 wearable sensor node (Dual BNO055 + MyoWare 2.0 Muscle
Sensor v2 12-bit ENV) streaming live biomechanical kinematics and sEMG
biofeedback over MQTT to the MyoMotion clinical dashboard.

Modes:
  - elbow : 1-DoF Elbow Curl + Biceps MyoWare EMG
  - wrist : 1-DoF Wrist Curl (Bottom <-> Top Sagittal Pitch) + Forearm MyoWare EMG
  - idle  : Standby heartbeat

Usage:
    python3 simulate_node.py
    python3 simulate_node.py --mac CC7B5C284994 --port 1892 --mode wrist
    python3 simulate_node.py --host myomotionmqtt.flowkraft.xyz --port 1892 --mode elbow
==============================================================================
"""

import sys
import os
import time
import math
import random
import json
import argparse
import signal
import paho.mqtt.client as mqtt

# Parse CLI arguments
parser = argparse.ArgumentParser(description="MyoMotion ESP32 Hardware Simulator (MyoWare 2.0 + Wrist Curl)")
parser.add_argument("--host", default="localhost", help="MQTT Broker Host (default: localhost)")
parser.add_argument("--port", type=int, default=1892, help="MQTT Broker Port (default: 1892)")
parser.add_argument("--mac", default="CC7B5C284994", help="Node MAC Address (default: CC7B5C284994)")
parser.add_argument("--mode", choices=["elbow", "wrist", "idle"], default="elbow", help="Initial kinematics mode")
args = parser.parse_args()

MAC = args.mac.replace(":", "").replace("-", "").upper()
BROKER_HOST = args.host
BROKER_PORT = args.port

TOPIC_STATUS = f"myomotion/status/{MAC}"
TOPIC_DATA = f"myomotion/data/{MAC}"
TOPIC_CMD = f"myomotion/cmd/{MAC}"

# Simulation States (MyoWare 2.0 12-bit 0 - 4095 Model)
current_mode = args.mode
emg_baseline_raw = 220     # Simulated RELAX baseline (0%)
emg_peak_raw = 3150        # Simulated MAX GRIP / MVC peak (100%)
is_calibrating_peak = False
calibrate_start = 0.0

# Elbow & Wrist Curl ROM bounds & live tracking
elbow_min_angle = 0.0
elbow_max_angle = 120.0
wrist_bottom_pitch = -40.0
wrist_top_pitch = 45.0
current_wrist_pitch = 0.0
current_elbow_angle = 0.0

running = True


def signal_handler(sig, frame):
    global running
    print("\n\033[1;33m[!] Terminating simulation. Publishing LWT offline status...\033[0m")
    running = False


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


def on_connect(client, userdata, flags, rc, *extra):
    if rc == 0:
        print(f"\033[1;32m[✓] Connected to MyoMotion MQTT Broker ({BROKER_HOST}:{BROKER_PORT})\033[0m")
        client.publish(TOPIC_STATUS, "online", qos=1, retain=True)
        client.subscribe(TOPIC_CMD, qos=1)
        print(f"\033[1;36m[✓] Node MAC: {MAC} is now ONLINE on topic {TOPIC_STATUS}\033[0m")
        print(f"\033[1;36m[✓] Subscribed to commands on {TOPIC_CMD}\033[0m\n")
    else:
        print(f"\033[1;31m[✗] Connection failed with code {rc}\033[0m")


def on_message(client, userdata, msg):
    global current_mode, is_calibrating_peak, calibrate_start
    global emg_baseline_raw, emg_peak_raw
    global elbow_min_angle, elbow_max_angle
    global wrist_bottom_pitch, wrist_top_pitch
    cmd = msg.payload.decode("utf-8").strip().lower()
    print(f"\n\033[1;35m>>> [COMMAND RECEIVED] '{cmd}' from Dashboard\033[0m")

    if cmd in ["tare", "zero"]:
        print("\033[1;32m[✓] Joint baseline reset to 0 degrees.\033[0m")
    elif cmd == "elbow:min":
        elbow_min_angle = round(current_elbow_angle, 1)
        print(f"\033[1;33m[✓] Elbow STRAIGHT (Min) position calibrated: {elbow_min_angle}°\033[0m")
    elif cmd == "elbow:max":
        elbow_max_angle = round(current_elbow_angle, 1)
        print(f"\033[1;32m[✓] Elbow MAX FLEX (Max) position calibrated: {elbow_max_angle}°\033[0m")
    elif cmd == "elbow:reset":
        elbow_min_angle = 0.0
        elbow_max_angle = 120.0
        print("\033[1;33m[!] Elbow Straight/Max limits reset to 0.0° / 120.0°.\033[0m")
    elif cmd == "wrist:bottom":
        wrist_bottom_pitch = round(current_wrist_pitch, 1)
        print(f"\033[1;33m[✓] Wrist Curl BOTTOM position calibrated: {wrist_bottom_pitch}°\033[0m")
    elif cmd == "wrist:top":
        wrist_top_pitch = round(current_wrist_pitch, 1)
        print(f"\033[1;32m[✓] Wrist Curl TOP position calibrated: {wrist_top_pitch}°\033[0m")
    elif cmd == "wrist:reset":
        wrist_bottom_pitch = -40.0
        wrist_top_pitch = 45.0
        print("\033[1;33m[!] Wrist Curl Bottom/Top limits reset to -40.0° / +45.0°.\033[0m")
    elif cmd in ["baseline", "relax"]:
        emg_baseline_raw = random.randint(190, 240)
        if emg_peak_raw <= emg_baseline_raw:
            emg_peak_raw = emg_baseline_raw + 100
        print(f"\033[1;32m[✓] MyoWare RELAX baseline set: {emg_baseline_raw} (0%)\033[0m")
    elif cmd in ["calibrate", "peak"]:
        is_calibrating_peak = True
        calibrate_start = time.time()
        print("\033[1;33m[!] 3-Second MyoWare MAX GRIP Calibration simulated! Contraction peaking...\033[0m")
    elif cmd == "reset":
        emg_baseline_raw = 0
        emg_peak_raw = 4095
        print("\033[1;33m[!] MyoWare calibration reset to full 12-bit range (0 - 4095).\033[0m")
    elif cmd == "mode:elbow":
        current_mode = "elbow"
        print("\033[1;34m[✓] Switched simulation pipeline to ELBOW CURL (1-DoF)\033[0m")
    elif cmd == "mode:wrist":
        current_mode = "wrist"
        print("\033[1;34m[✓] Switched simulation pipeline to WRIST CURL (Sagittal 1-DoF)\033[0m")
    elif cmd in ["mode:idle", "stop"]:
        current_mode = "idle"
        print("\033[1;34m[✓] Switched simulation pipeline to IDLE (standby)\033[0m")


def compute_myoware_pct(raw_val: int) -> float:
    if emg_peak_raw <= emg_baseline_raw:
        return 0.0
    pct = ((raw_val - emg_baseline_raw) / float(emg_peak_raw - emg_baseline_raw)) * 100.0
    return round(max(0.0, min(150.0, pct)), 1)


# Initialize Paho MQTT Client with unique client ID per process
sim_client_id = f"SimNode_{MAC}_{os.getpid()}_{random.randint(1000, 9999)}"
try:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=sim_client_id)
except AttributeError:
    client = mqtt.Client(client_id=sim_client_id)

client.will_set(TOPIC_STATUS, "offline", qos=1, retain=True)
client.on_connect = on_connect
client.on_message = on_message

try:
    client.connect(BROKER_HOST, BROKER_PORT, 60)
    client.loop_start()
except Exception as e:
    print(f"\033[1;31m[ERROR] Could not connect to MQTT Broker at {BROKER_HOST}:{BROKER_PORT} ({e})\033[0m")
    sys.exit(1)

print("\033[1;34m" + "=" * 72)
print("  MYOMOTION MEDICAL — ESP32 HARDWARE SIMULATOR (MyoWare 2.0 + Wrist Curl)")
print(f"  Node MAC:  \033[1;37m{MAC}\033[1;34m")
print(f"  Broker:    \033[1;37m{BROKER_HOST}:{BROKER_PORT}\033[1;34m")
print(f"  Cadence:   \033[1;37m20 Hz (50ms interval)\033[1;34m")
print(f"  Mode:      \033[1;37m{current_mode.upper()}\033[1;34m | Baseline: \033[1;37m{emg_baseline_raw}\033[1;34m | Peak: \033[1;37m{emg_peak_raw}\033[1;34m")
print("=" * 72 + "\033[0m\n")

start_time = time.time()
elbow_reps = 0
elbow_state = "waiting_straight"
elbow_peak_emg = 0.0

wrist_reps = 0
wrist_state = "waiting_bottom"
wrist_peak_emg = 0.0

while running:
    t = time.time() - start_time

    # 1. Handle 3-second MAX GRIP / MVC calibration window
    if is_calibrating_peak and (time.time() - calibrate_start > 3.0):
        is_calibrating_peak = False
        emg_peak_raw = random.randint(3100, 3450)
        print(f"\n\033[1;32m[✓] MyoWare MAX GRIP calibrated: {emg_peak_raw} (100%)\033[0m")

    # 2. Generate Biomechanical Kinematics & MyoWare 2.0 12-bit ADC
    if current_mode == "idle":
        raw_adc = max(0, emg_baseline_raw + random.randint(-12, 18))
        percent_mvc = compute_myoware_pct(raw_adc)

        payload = {
            "mac": MAC,
            "mode": "idle",
            "raw": raw_adc,
            "percent": percent_mvc,
            "mvc": emg_peak_raw,
            "baseline": emg_baseline_raw,
            "calibrating": is_calibrating_peak
        }

        sys.stdout.write(
            f"\r\033[K\033[1;33m[IDLE]\033[0m MyoWare Raw: \033[1;37m{raw_adc:4d}\033[0m | "
            f"Activation: \033[1;33m{percent_mvc:5.1f}%\033[0m (Base: {emg_baseline_raw}, Peak: {emg_peak_raw})"
        )
        sys.stdout.flush()

    elif current_mode == "elbow":
        cycle_progress = (math.sin(t * (2 * math.pi / 3.5) - math.pi / 2) + 1) / 2
        sim_min = elbow_min_angle if abs(elbow_max_angle - elbow_min_angle) >= 10 else 0.0
        sim_max = elbow_max_angle if abs(elbow_max_angle - elbow_min_angle) >= 10 else 125.0
        angle = sim_min + cycle_progress * (sim_max - sim_min) + random.uniform(-0.4, 0.4)
        current_elbow_angle = angle

        effort_ratio = (cycle_progress ** 1.8) * 0.92 + random.uniform(0.02, 0.06)
        if is_calibrating_peak:
            effort_ratio = 1.0 + random.uniform(0.0, 0.04)

        span = max(100, emg_peak_raw - emg_baseline_raw)
        raw_adc = int(min(4095, max(0, emg_baseline_raw + effort_ratio * span + random.randint(-20, 20))))
        percent_mvc = compute_myoware_pct(raw_adc)

        # Normalized Elbow Rep Counter: Straight (<= 25% ROM) -> Max Flex (>= 75% ROM + EMG >= 20%)
        elbow_rom_span = sim_max - sim_min
        norm_progress = (angle - sim_min) / (elbow_rom_span if abs(elbow_rom_span) >= 10.0 else 120.0)

        if elbow_state in ["waiting_straight", "at_max"]:
            if norm_progress <= 0.25:
                elbow_state = "at_straight"
                elbow_peak_emg = percent_mvc
        elif elbow_state == "at_straight":
            elbow_peak_emg = max(elbow_peak_emg, percent_mvc)
            if norm_progress >= 0.75 and elbow_peak_emg >= 20.0:
                elbow_reps += 1
                elbow_state = "at_max"

        payload = {
            "mac": MAC,
            "mode": "elbow",
            "angle": round(angle, 1),
            "elbow_min": round(elbow_min_angle, 1),
            "elbow_max": round(elbow_max_angle, 1),
            "raw": raw_adc,
            "percent": percent_mvc,
            "mvc": emg_peak_raw,
            "baseline": emg_baseline_raw,
            "calibrating": is_calibrating_peak
        }

        sys.stdout.write(
            f"\r\033[K\033[1;36m[ELBOW]\033[0m Angle: \033[1;32m{angle:5.1f}°\033[0m "
            f"[{elbow_min_angle:.0f}°..{elbow_max_angle:.0f}°] | "
            f"Biceps MyoWare: \033[1;33m{percent_mvc:5.1f}%\033[0m | Reps: \033[1;37m{elbow_reps}\033[0m"
        )
        sys.stdout.flush()

    else:
        # Wrist Curl simulation: Smoothly curls from Bottom (-40°) -> Top (+45°) -> Bottom (-40°)
        cycle_progress = (math.sin(t * (2 * math.pi / 3.2) - math.pi / 2) + 1) / 2  # 0.0 (Bottom) -> 1.0 (Top)
        sim_bottom = min(wrist_bottom_pitch, -40.0) if abs(wrist_top_pitch - wrist_bottom_pitch) < 10 else wrist_bottom_pitch
        sim_top = max(wrist_top_pitch, 45.0) if abs(wrist_top_pitch - wrist_bottom_pitch) < 10 else wrist_top_pitch

        pitch = sim_bottom + cycle_progress * (sim_top - sim_bottom) + random.uniform(-0.4, 0.4)
        current_wrist_pitch = pitch

        # Forearm EMG spikes during curl up to Top position
        effort_ratio = (cycle_progress ** 1.6) * 0.85 + random.uniform(0.03, 0.07)
        if is_calibrating_peak:
            effort_ratio = 1.0 + random.uniform(0.0, 0.04)

        span = max(100, emg_peak_raw - emg_baseline_raw)
        raw_adc = int(min(4095, max(0, emg_baseline_raw + effort_ratio * span + random.randint(-20, 20))))
        percent_mvc = compute_myoware_pct(raw_adc)

        # Wrist Curl Rep Counter: Bottom (<= 25%) -> Top (>= 75% + EMG >= 20%)
        rom_span = sim_top - sim_bottom
        norm_progress = (pitch - sim_bottom) / (rom_span if abs(rom_span) >= 10.0 else 85.0)

        if wrist_state in ["waiting_bottom", "at_top"]:
            if norm_progress <= 0.25:
                wrist_state = "at_bottom"
                wrist_peak_emg = percent_mvc
        elif wrist_state == "at_bottom":
            wrist_peak_emg = max(wrist_peak_emg, percent_mvc)
            if norm_progress >= 0.75 and wrist_peak_emg >= 20.0:
                wrist_reps += 1
                wrist_state = "at_top"

        payload = {
            "mac": MAC,
            "mode": "wrist",
            "pitch": round(pitch, 1),
            "bottom": round(wrist_bottom_pitch, 1),
            "top": round(wrist_top_pitch, 1),
            "raw": raw_adc,
            "percent": percent_mvc,
            "mvc": emg_peak_raw,
            "baseline": emg_baseline_raw,
            "calibrating": is_calibrating_peak
        }

        sys.stdout.write(
            f"\r\033[K\033[1;35m[WRIST CURL]\033[0m Pitch: \033[1;32m{pitch:+6.1f}°\033[0m "
            f"[{wrist_bottom_pitch:.0f}°..{wrist_top_pitch:+.0f}°] | "
            f"Forearm MyoWare: \033[1;33m{percent_mvc:5.1f}%\033[0m | Reps: \033[1;37m{wrist_reps}\033[0m"
        )
        sys.stdout.flush()

    client.publish(TOPIC_DATA, json.dumps(payload), qos=0)
    time.sleep(0.05)

# Graceful Exit
client.publish(TOPIC_STATUS, "offline", qos=1, retain=True)
client.loop_stop()
client.disconnect()
print("\n\033[1;32m[✓] Simulator disconnected cleanly. Node marked OFFLINE.\033[0m")
