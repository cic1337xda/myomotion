# ESP32 Flashing & WiFiManager Provisioning Guide

> Step-by-step Arduino IDE configuration, required libraries, captive portal WiFi & MQTT setup, and dashboard pairing.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English (Current)](FLASHING_AND_SETUP.md)**
* 🇲🇾 **[Bahasa Melayu](FLASHING_AND_SETUP_MY.md)**

---

## 📦 Required Arduino IDE Libraries

Install the following libraries via **Arduino Library Manager** (`Sketch -> Include Library -> Manage Libraries`):
1. **`WiFiManager`** by *tzapu*
2. **`PubSubClient`** by *Nick O'Leary*
3. **`Adafruit BNO055`** by *Adafruit*
4. **`Adafruit Unified Sensor`** by *Adafruit*

*(Note: `WiFi.h`, `Wire.h`, and `Preferences.h` are built into the ESP32 Arduino Core).*

---

## ⚙️ Arduino IDE Board Configuration

* **Board:** `ESP32 Dev Module`
* **Upload Speed:** `921600` (or `115200` if using long/isolated USB cables)
* **CPU Frequency:** `240MHz (WiFi/BT)`
* **Partition Scheme:** `Default 4MB with spiffs`
* **Serial Monitor Baud Rate:** `115200`

---

## 📶 First-Boot Provisioning (WiFiManager Captive Portal)

1. Flash `MyoMotion_ESP32_Firmware/MyoMotion_ESP32_Firmware.ino` onto your ESP32.
2. On first boot (or when saved WiFi is unavailable), the ESP32 launches a WiFi Access Point named **`MyoMotionAP`** for **20 seconds** (`setConfigPortalTimeout(20)`).
3. Connect to `MyoMotionAP` from a phone or laptop and open the captive portal (`http://192.168.4.1` if it does not open automatically).
4. Select **Configure WiFi**, enter:
   * Your **2.4 GHz WiFi SSID** and **Password**
   * **MQTT Broker Host / IP** (e.g. your server IP or public MQTT domain)
   * **MQTT Broker Port** (default `1892`)
5. Click **Save**. Credentials and MQTT settings are stored persistently in ESP32 NVS flash (`Preferences`) and reused automatically on future boots.

---

## 🔗 Pairing Device with the Web Dashboard

1. Open the Arduino Serial Monitor at `115200` baud and note the printed MAC address:
   ```text
   [SYSTEM] Device Node MAC: CC7B5C284994
   ```
2. Log into the MyoMotion web dashboard and navigate to **Device Settings** (`/settings`).
3. Enter the 12-character MAC address and click **+ Link Sensor Node**.
4. Open **Active Rehab** (`/rehab`) — the status pill turns green (**Hardware Connected**). Select **Elbow Curl** or **Wrist Curl** to arm the firmware pipeline.
