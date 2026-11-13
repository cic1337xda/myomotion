# Nod Sensor Boleh Pakai ESP32 MyoMotion

> Nod pemerolehan terbenam yang menggabungkan **Dwi-Bosch BNO055 (IMU 6-DoF)** dan **Sensor Otot MyoWare 2.0** melalui kuasa USB terasing dan telemetri MQTT.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English](README.md)**
* 🇲🇾 **[Bahasa Melayu (Semasa)](README_MY.md)**

---

## 🔧 Gambaran Keseluruhan Perkakasan &amp; Senarai Bahan (BOM)

| Kuantiti | Komponen | Peranan Dalam Sistem |
| :---: | :--- | :--- |
| 1 | **ESP32 DevKit** | Mikropengawal dwi-I2C, pensampelan ADC 12-bit &amp; klien MQTT WiFi |
| 2 | **Modul Bosch BNO055** | Orientasi segmen rujukan proksimal &amp; segmen bergerak distal (`IMUPLUS`) |
| 1 | **Sensor Otot MyoWare 2.0** | Isyarat EMG permukaan tertebus &amp; bersampul (output `ENV` ke GPIO 32) |
| 3 | **Elektrod Permukaan Ag/AgCl** | Peletakan tengah otot, hujung otot, dan rujukan tulang |
| 1 | **Pengasing USB ADuM** | Pengasingan galvanik antara PC/bekalan kuasa dan elektrod kulit pesakit |

## 📐 Aliran Blok Perisian Tegar

```text
[Boot] --> [Muat Konfigurasi MQTT NVS] --> [Portal WiFiManager (tamat 20 saat)]
   |
   v
[Mulakan Bas Dwi-I2C: GPIO 21/22 & 18/19 @ IMUPLUS] --> [Mulakan ADC 12-bit GPIO 32]
   |
   v
[Sambung Broker MQTT + Tetap LWT "offline"] --> [Siar "online" + Langgan cmd/<MAC>]
   |
   v
[Mod IDLE] --("mode:elbow" / "mode:wrist")--> [Telemetri 20 Hz + Tangkapan Puncak 1 kHz]
```

## 📚 Panduan Subsistem
* [`PINOUT_AND_WIRING_MY.md`](PINOUT_AND_WIRING_MY.md) — Jadual pinout, pautan skematik dan panduan keselamatan elektrik.
* [`MQTT_SPECIFICATION_MY.md`](MQTT_SPECIFICATION_MY.md) — Topik, skema muatan JSON, LWT dan rujukan arahan jauh.
* [`FLASHING_AND_SETUP_MY.md`](FLASHING_AND_SETUP_MY.md) — Pustaka Arduino IDE, tetapan papan dan panduan portal tawan WiFiManager.
