# MQTT Telemetry & Command Specification

> Real-time transport protocol, Last Will and Testament (LWT) presence detection, JSON telemetry schemas, and command handlers.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English (Current)](MQTT_SPECIFICATION.md)**
* 🇲🇾 **[Bahasa Melayu](MQTT_SPECIFICATION_MY.md)**

---

## 📡 Broker & Client Identity

* **Transport:** MQTT v3.1.1 over TCP
* **Default Port:** `1892` (mapped externally to Mosquitto `1883`)
* **Client ID Format:** `MyoMotion-Node-<MAC>` (e.g., `MyoMotion-Node-CC7B5C284994`, uppercase hex without colons)
* **Telemetry Cadence:** Non-blocking `millis()` timer at **20 Hz (every 50 ms)**, `QoS 0`
* **Peak EMG Sampling:** Continuous `micros()` loop at **1000 Hz** during 3-second MVC calibration

---

## 🗂️ Topic Architecture

| Topic Pattern | Direction | QoS | Retain | Purpose |
| :--- | :--- | :---: | :---: | :--- |
| `myomotion/status/<MAC>` | Node $\rightarrow$ Broker | `1` | `true` | LWT presence (`"online"` on connect, `"offline"` on unexpected drop) |
| `myomotion/data/<MAC>` | Node $\rightarrow$ Broker | `0` | `false` | 20 Hz real-time kinematics &amp; MyoWare EMG JSON stream |
| `myomotion/cmd/<MAC>` | Backend $\rightarrow$ Node | `1` | `false` | Remote mode switching &amp; joint/EMG calibration commands |

---

## 📦 Telemetry JSON Payload Schemas

### 1. Standby (`IDLE` — Boot Default)
```json
{
  "mac": "CC7B5C284994",
  "mode": "idle",
  "raw": 215,
  "percent": 0.0,
  "mvc": 4095,
  "baseline": 210,
  "calibrating": false
}
```

### 2. Elbow Curl Mode (`mode:elbow`)
```json
{
  "mac": "CC7B5C284994",
  "mode": "elbow",
  "angle": 84.5,
  "elbow_min": 0.0,
  "elbow_max": 120.0,
  "raw": 2480,
  "percent": 76.2,
  "mvc": 3180,
  "baseline": 210,
  "calibrating": false
}
```

### 3. Wrist Curl Mode (`mode:wrist`)
```json
{
  "mac": "CC7B5C284994",
  "mode": "wrist",
  "pitch": 34.2,
  "bottom": -40.0,
  "top": 40.0,
  "raw": 1950,
  "percent": 58.6,
  "mvc": 3180,
  "baseline": 210,
  "calibrating": false
}
```

---

## 🎛️ Supported MQTT Commands (`myomotion/cmd/<MAC>`)

| Command Payload | Action Performed on ESP32 |
| :--- | :--- |
| `mode:elbow` | Arm Elbow Curl pipeline &amp; zero baseline |
| `mode:wrist` | Arm Wrist Curl (Sagittal 1-DoF) pipeline &amp; zero baseline |
| `mode:idle` / `stop` | Disarm kinematics pipeline back to standby `IDLE` |
| `tare` / `zero` | Re-zero current active joint quaternion offset (`0.0°`) |
| `elbow:min` | Store current smoothed elbow angle as Straight (`Min`) limit |
| `elbow:max` | Store current smoothed elbow angle as Max Flex (`Max`) limit |
| `elbow:reset` | Reset Elbow limits to `0.0°` / `120.0°` |
| `wrist:bottom` | Store current smoothed wrist pitch as Lowest (`Bottom`) limit |
| `wrist:top` | Store current smoothed wrist pitch as Highest (`Top`) limit |
| `wrist:reset` | Reset Wrist limits to `-40.0°` / `+40.0°` |
| `baseline` / `relax` | Capture current MyoWare 2.0 reading as Relax Baseline (`0%`) |
| `calibrate` / `peak` | Start 3-second 1 kHz peak capture to set Max Grip MVC (`100%`) |
| `reset` | Reset MyoWare calibration (`baseline = 0`, `mvc = 4095`) |
