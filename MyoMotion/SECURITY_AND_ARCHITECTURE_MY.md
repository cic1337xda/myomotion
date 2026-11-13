# Kawalan Keselamatan &amp; Seni Bina Biomekanik

> Perincian pertahanan keselamatan web/API, aliran pengesahan, serta algoritma ulangan hibrid ROM + sEMG.

## 📑 Language Options / Pilihan Bahasa
* 🇬🇧 **[English](SECURITY_AND_ARCHITECTURE.md)**
* 🇲🇾 **[Bahasa Melayu (Semasa)](SECURITY_AND_ARCHITECTURE_MY.md)**

---

## 🛡️ 1. Seni Bina Keselamatan Web &amp; API

1. **Kuki Sesi Kalis-XSS:** Token JWT hanya dikeluarkan di dalam kuki `HttpOnly`, `Secure`, `SameSite=Lax` (`access_token`)—tidak pernah disimpan dalam `localStorage` atau `sessionStorage`.
2. **Pengesahan Asal CSRF:** `SecurityAndTracingMiddleware` menyemak pengepala `Origin` dan `Referer` bagi semua permintaan `POST`, `PUT`, `DELETE`, dan `PATCH` untuk menyekat mutasi rentas-tapak (`403 Forbidden`).
3. **Pengepala Keselamatan HTTP &amp; Penjejakan Permintaan:** Setiap respons menyuntik `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, serta UUID unik `X-Request-ID`.
4. **Perlindungan Daya Kasar (Had Kadar + Sekatan Akaun):**
   * `SlowAPI` mengehadkan `5/minit` pada `/login` dan `3/minit` pada `/send-otp`, `/register`, `/forgot-password`, serta `/reset-password`.
   * Akaun dikunci automatik selama **15 minit** (`423 Locked`) selepas **5 cubaan log masuk gagal berturut-turut**.
5. **Pengesahan OTP Kriptografi:** Kod 6-digit sekali guna tamat tempoh dalam **10 minit** dan terbatal secara automatik selepas **5 cubaan salah**.
6. **Kekuatan Kata Laluan &amp; Pencincangan:** Mewajibkan $\ge 8$ aksara (maks 70 bait), huruf besar, huruf kecil, nombor, dan simbol khas sebelum dicincang dengan Bcrypt (`passlib`).
7. **Penguatkuasaan Pemilikan Ketat (Pencegahan BOLA/IDOR):** Setiap pertanyaan peranti dan sesi rehabilitasi ditapis dengan `user_id == current_user.id`. Semakan admin hanya berlaku di pelayan (`get_current_admin`).
8. **Kekebalan Suntikan SQL &amp; Kontena Bukan-Root:** 100% pertanyaan berparameter melalui SQLAlchemy ORM; kontena FastAPI dijalankan sebagai pengguna terhad `appuser`.

---

## 🧠 2. Kinematik Biomekanik &amp; Algoritma Kiraan Ulangan

### A. Elbow Curl (Biceps — Sesaran Kuaternion 1-DoF)
* Orientasi relatif: $q_{\text{rel}} = q_{\text{prox}}^* \otimes q_{\text{dist}}$, disifarkan melalui $q_{\text{joint}} = q_{\text{rel}} \otimes q_{\text{offset}}^*$.
* Sudut fleksi: $\theta = 2 \arccos(|w|)$ yang dilicinkan dengan penapis EMA ($\alpha = 0.20$).
* Penormalan ROM terkalibrasi antara **Lurus (`elbow_min`)** dan **Fleksi Maksimum (`elbow_max`)**:
  $$\text{progress} = \frac{\theta - \theta_{\min}}{\theta_{\max} - \theta_{\min}}$$

### B. Wrist Curl (Forearm — Pic Sagital 1-DoF)
* Mengunjurkan paksi membujur $[1, 0, 0]^T$ melalui putaran kuaternion analitikal untuk mendapatkan pic sagital $\phi = \text{atan2}(-v_z, v_x)$ tanpa kekunci gimbal.
* Penormalan ROM terkalibrasi antara **Bawah (`bottom`)** dan **Atas (`top`)**:
  $$\text{progress} = \frac{\phi - \phi_{\text{bottom}}}{\phi_{\text{top}} - \phi_{\text{bottom}}}$$

### C. Mesin Keadaan Ulangan Hibrid Disahkan EMG
Bagi memastikan ayunan tangan pasif tanpa pengaktifan otot tidak dikira sebagai ulangan terapi:
1. Pengguna bermula di zon rehat (`progress <= 0.25`).
2. Semasa pergerakan naik ke atas, `peakEmgInRep` merakam puncak `%MVC` MyoWare 2.0.
3. Apabila `progress >= 0.75` **DAN** `peakEmgInRep >= 20% MVC`, **+1 ulangan sah** direkodkan dan dikunci sehingga anggota kembali ke `<= 0.25`.
