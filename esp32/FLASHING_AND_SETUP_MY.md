# Panduan Muat Naik Perisian Tegar ESP32 &amp; WiFiManager

> Langkah demi langkah tetapan Arduino IDE, pustaka yang diperlukan, konfigurasi WiFi &amp; MQTT melalui portal tawan, serta pemadanan papan pemuka.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English](FLASHING_AND_SETUP.md)**
* 🇲🇾 **[Bahasa Melayu (Semasa)](FLASHING_AND_SETUP_MY.md)**

---

## 📦 Pustaka Arduino IDE Yang Diperlukan

Pasang pustaka berikut melalui **Arduino Library Manager** (`Sketch -> Include Library -> Manage Libraries`):
1. **`WiFiManager`** oleh *tzapu*
2. **`PubSubClient`** oleh *Nick O'Leary*
3. **`Adafruit BNO055`** oleh *Adafruit*
4. **`Adafruit Unified Sensor`** oleh *Adafruit*

*(Nota: `WiFi.h`, `Wire.h`, dan `Preferences.h` telah terbina di dalam ESP32 Arduino Core).*

---

## ⚙️ Tetapan Papan Arduino IDE

* **Board:** `ESP32 Dev Module`
* **Upload Speed:** `921600` (atau `115200` jika menggunakan kabel USB panjang / pengasing ADuM)
* **CPU Frequency:** `240MHz (WiFi/BT)`
* **Partition Scheme:** `Default 4MB with spiffs`
* **Kadar Baud Serial Monitor:** `115200`

---

## 📶 Penyediaan Kali Pertama (Portal Tawan WiFiManager)

1. Muat naik `MyoMotion_ESP32_Firmware/MyoMotion_ESP32_Firmware.ino` ke dalam ESP32 anda.
2. Pada boot pertama (atau apabila WiFi tersimpan tidak ditemui), ESP32 akan memancarkan Access Point **`MyoMotionAP`** selama **20 saat** (`setConfigPortalTimeout(20)`).
3. Sambungkan telefon atau komputer riba ke `MyoMotionAP` dan buka portal tawan (`http://192.168.4.1` jika tidak terbuka secara automatik).
4. Pilih **Configure WiFi** dan masukkan:
   * **SSID WiFi 2.4 GHz** serta **Kata Laluan**
   * **Hos / IP Broker MQTT** (cth: IP pelayan atau domain MQTT anda)
   * **Port Broker MQTT** (lalai `1892`)
5. Tekan **Save**. Tetapan WiFi dan MQTT akan disimpan secara kekal dalam memori flash NVS ESP32 (`Preferences`) dan digunakan terus pada boot seterusnya.

---

## 🔗 Memadankan Peranti Dengan Papan Pemuka Web

1. Buka Serial Monitor pada kadar baud `115200` dan catatkan alamat MAC yang dipaparkan:
   ```text
   [SYSTEM] Device Node MAC: CC7B5C284994
   ```
2. Log masuk ke papan pemuka web MyoMotion dan pergi ke **Device Settings** (`/settings`).
3. Masukkan 12-aksara alamat MAC tersebut dan klik **+ Link Sensor Node**.
4. Buka **Active Rehab** (`/rehab`) — status akan bertukar hijau (**Hardware Connected**). Pilih **Elbow Curl** atau **Wrist Curl** untuk mengaktifkan saluran kinematik ESP32.
