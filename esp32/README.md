# MyoMotion ESP32 Wearable Sensor Node

> Embedded acquisition node combining **Dual Bosch BNO055 (6-DoF IMU)** and **MyoWare 2.0 Muscle Sensor** over isolated USB power and MQTT telemetry.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English (Current)](README.md)**
* 🇲🇾 **[Bahasa Melayu](README_MY.md)**

---

## 🔧 Hardware Overview & Bill of Materials (BOM)

| Qty | Component | Role in System |
| :---: | :--- | :--- |
| 1 | **ESP32 DevKit** | Dual-I2C MCU, 12-bit ADC sampling & WiFi MQTT client |
| 2 | **Bosch BNO055 Breakout** | Proximal reference & distal moving segment orientation (`IMUPLUS`) |
| 1 | **MyoWare 2.0 Muscle Sensor** | Rectified & enveloped surface EMG (`ENV` output to GPIO 32) |
| 3 | **Ag/AgCl Surface Electrodes** | Mid-muscle, end-muscle, and bony reference electrode placement |
| 1 | **ADuM USB Isolator** | Galvanic isolation between PC/power supply and patient skin electrodes |

## 📐 Firmware Block Flow

```text
[Boot] --> [Load NVS MQTT Config] --> [WiFiManager Portal (20s timeout)]
   |
   v
[Init Dual I2C Buses: GPIO 21/22 & 18/19 @ IMUPLUS] --> [Init 12-bit ADC GPIO 32]
   |
   v
[Connect MQTT Broker + Set LWT "offline"] --> [Publish "online" + Subscribe cmd/<MAC>]
   |
   v
[IDLE Mode] --("mode:elbow" / "mode:wrist")--> [20 Hz Telemetry + 1 kHz Peak Capture]
```

## 📚 Subsystem Guides
* [`PINOUT_AND_WIRING.md`](PINOUT_AND_WIRING.md) — Pinout tables, schematic link, and electrical safety guidelines.
* [`MQTT_SPECIFICATION.md`](MQTT_SPECIFICATION.md) — Topics, JSON payloads, LWT, and remote command reference.
* [`FLASHING_AND_SETUP.md`](FLASHING_AND_SETUP.md) — Arduino IDE libraries, flashing parameters, and WiFiManager portal guide.
