# Spesifikasi Telemetri &amp; Arahan MQTT

> Protokol penghantaran masa nyata, pengesanan kehadiran *Last Will and Testament* (LWT), skema muatan JSON, dan pengendali arahan jauh.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English](MQTT_SPECIFICATION.md)**
* 🇲🇾 **[Bahasa Melayu (Semasa)](MQTT_SPECIFICATION_MY.md)**

---

## 📡 Identiti Broker &amp; Klien

* **Protokol:** MQTT v3.1.1 melalui TCP
* **Port Lalai:** `1892` (dipetakan secara luaran ke port Mosquitto `1883`)
* **Format ID Klien:** `MyoMotion-Node-<MAC>` (cth: `MyoMotion-Node-CC7B5C284994`, heksadesimal huruf besar tanpa titik bertindih)
* **Kadar Telemetri:** Pemasa `millis()` tidak menyekat pada **20 Hz (setiap 50 ms)**, `QoS 0`
* **Pensampelan Puncak EMG:** Gelung `micros()` berterusan pada **1000 Hz** semasa kalibrasi MVC 3-saat

---

## 🗂️ Seni Bina Topik

| Corak Topik | Arah | QoS | Retain | Tujuan |
| :--- | :--- | :---: | :---: | :--- |
| `myomotion/status/<MAC>` | Nod $\rightarrow$ Broker | `1` | `true` | Kehadiran LWT (`"online"` bila sambung, `"offline"` bila terputus) |
| `myomotion/data/<MAC>` | Nod $\rightarrow$ Broker | `0` | `false` | Aliran JSON kinematik &amp; EMG MyoWare 20 Hz masa nyata |
| `myomotion/cmd/<MAC>` | Backend $\rightarrow$ Nod | `1` | `false` | Arahan tukar mod &amp; kalibrasi sendi/EMG dari papan pemuka |

---

## 📦 Skema Muatan JSON Telemetri

### 1. Sedia (`IDLE` — Lalai Semasa Boot)
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

### 2. Mod Elbow Curl (`mode:elbow`)
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

### 3. Mod Wrist Curl (`mode:wrist`)
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

## 🎛️ Arahan MQTT Disokong (`myomotion/cmd/<MAC>`)

| Muatan Arahan | Tindakan Pada ESP32 |
| :--- | :--- |
| `mode:elbow` | Aktifkan mod Elbow Curl &amp; sifarkan rujukan sudut |
| `mode:wrist` | Aktifkan mod Wrist Curl (Sagital 1-DoF) &amp; sifarkan rujukan sudut |
| `mode:idle` / `stop` | Nyahaktifkan saluran kinematik kembali ke mod `IDLE` |
| `tare` / `zero` | Sifarkan semula ofset kuaternion sendi aktif (`0.0°`) |
| `elbow:min` | Simpan sudut siku semasa sebagai had Lurus (`Min`) |
| `elbow:max` | Simpan sudut siku semasa sebagai had Fleksi Maksimum (`Max`) |
| `elbow:reset` | Tetap semula had Siku kepada `0.0°` / `120.0°` |
| `wrist:bottom` | Simpan pic pergelangan tangan semasa sebagai had Bawah (`Bottom`) |
| `wrist:top` | Simpan pic pergelangan tangan semasa sebagai had Atas (`Top`) |
| `wrist:reset` | Tetap semula had Wrist kepada `-40.0°` / `+40.0°` |
| `baseline` / `relax` | Tangkap bacaan MyoWare 2.0 semasa sebagai Baseline Rehat (`0%`) |
| `calibrate` / `peak` | Mulakan tangkapan puncak 1 kHz selama 3 saat untuk set MVC (`100%`) |
| `reset` | Tetap semula kalibrasi MyoWare (`baseline = 0`, `mvc = 4095`) |
