# AylusMusic — Pemutar Musik PWA Modern & Hemat Penyimpanan

Aplikasi Web Progresif (PWA) pemutar musik mandiri, bersih, dan hemat penyimpanan dengan dukungan impor playlist Spotify, pemutaran offline, Web Audio API 10-band Equalizer, serta Volume Boost hingga 300%.

Dibangun murni dengan **Vanilla JavaScript (ES Modules) + HTML5 + CSS**, tanpa dependensi build step yang membatasi, sehingga dapat di-hosting secara instan di Firebase Hosting, GitHub Pages, Netlify, atau Vercel.

---

## 🎵 Fitur Utama

1. **Hemat Ruang Penyimpanan**:
   - Hanya metadata dan cover album (dikompresi ke WebP ±256px) yang disimpan secara bawaan.
   - File audio hanya disimpan ke cache perangkat untuk lagu atau playlist yang Anda tandai untuk **Offline**.
   - Dilengkapi pemantau kapasitas penyimpanan real-time (`navigator.storage.estimate`) dan pembersihan otomatis **LRU (Least Recently Used)** saat kuota terlewati.

2. **Web Audio API Engine & 300% Boost**:
   - Equalizer 10-Band (32Hz – 16kHz) dengan preset bawaan (*Jernih / Clarity*, *Flat*, *Bass Boost*, *Vokal*, *Treble*, *Akustik*) dan slider kustom.
   - Slider volume normal 0–100% dan zona **Boost 100%–300%** berwarna emas.
   - Dilengkapi **DynamicsCompressorNode** yang bertindak sebagai limiter lembut untuk mencegah distorsi atau suara pecah di zona boost.
   - Visualizer canvas dinamis beranimasi halus tosca → emas.

3. **Impor Playlist Spotify Permanen**:
   - 3 Cara Fleksibel:
     1. **Login Spotify Resmi via PKCE** (Aman di sisi klien tanpa client secret).
     2. **Tempel Link Playlist Publik** (Cepat dan tanpa login).
     3. **Unggah Cadangan CSV Exportify** (Mendukung ribuan lagu sekaligus).
   - Data tersimpan permanen di IndexedDB dan Firestore (untuk akun Google).

4. **Audio Resolver Legal & File Lokal**:
   - Menghubungkan file audio lokal di perangkat Anda (MP3, M4A, FLAC, WAV, AAC, Opus) ke metadata lagu dengan algoritma pencocokan cerdas (*fuzzy matching*).
   - Pencarian katalog musik bebas lisensi legal (Creative Commons via Jamendo API).
   - Lagu tanpa audio ditandai "Hanya Metadata".

5. **PWA & Pemutaran Latar Belakang (Background Play)**:
   - Terintegrasi penuh dengan **Media Session API** (judul, artis, album, thumbnail di lockscreen & notification drawer, tombol next/prev/seek/play/pause).
   - Layar penuh dilengkapi **Screen Wake Lock**.
   - Dapat di-install ke Home Screen HP / Laptop dengan Service Worker offline-first.

---

## 🛠️ Panduan Konfigurasi & Setup

### 1. Konfigurasi Firebase (Auth & Firestore)
Aplikasi sudah terkonfigurasi menggunakan project:
- **Project ID**: `data-pembagian-ktm`
- **Auth Domain**: `data-pembagian-ktm.firebaseapp.com`

#### Langkah di Firebase Console:
1. Buka [Firebase Console](https://console.firebase.google.com/) dan pilih project Anda.
2. Masuk ke menu **Build > Authentication > Sign-in method**:
   - Aktifkan provider **Google**.
   - Simpan.
3. Masuk ke tab **Settings > Authorized domains**:
   - Tambahkan domain hosting Anda (misalnya `localhost`, `domain-anda.web.app`, `domain-anda.firebaseapp.com`).
4. Masuk ke menu **Build > Firestore Database > Rules**:
   Gunakan aturan keamanan (Security Rules) berikut untuk memastikan setiap pengguna hanya dapat membaca dan menulis data miliknya:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Aturan pengguna AylusMusic
    match /aylusmusic_users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // Subkoleksi: playlists, favorites, history, folders
      match /{allSubcollections=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

---

### 2. Konfigurasi Spotify Developer Dashboard (Opsional untuk Login PKCE)
1. Buka [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) dan login.
2. Buat App baru:
   - **App Name**: `AylusMusic`
   - **App Description**: `PWA Music Player`
   - **Redirect URIs**: Masukkan URL aplikasi Anda, contoh:
     - `http://localhost:3000/` (untuk pengetesan lokal)
     - `https://domain-anda.web.app/` (untuk produksi)
   - Beri centang pada **Web API**.
3. Salin **Client ID** yang Anda dapatkan, lalu buka halaman **Pengaturan** di aplikasi AylusMusic dan tempelkan pada kolom **Spotify Client ID**.

---

### 3. Deploy ke Hosting Statis

#### Firebase Hosting:
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# Pilih public directory: . (atau dist jika melalui vite build)
# Configure as single-page app: Yes
firebase deploy
```

#### GitHub Pages / Netlify:
Unggah seluruh berkas proyek ke repositori GitHub. Pada pengaturan GitHub Pages, pilih branch `main` dan folder `/ (root)`.

---

## ⚖️ Batasan Teknis & Hukum yang Jujur

1. **Spotify Audio Terms of Service**:
   Spotify **tidak mengizinkan** pengunduhan atau pemutaran berkas audio resminya di luar aplikasi pemutar Spotify. Oleh karena itu, fitur impor Spotify di AylusMusic berfungsi mengimpor **struktur playlist, daftar lagu, judul, artis, album, dan thumbnail cover berukuran hemat**. Pemutaran audio dilakukan dengan menautkan file MP3/M4A lokal milik Anda atau mencari lagu Creative Commons yang berlisensi bebas.
2. **Background Play pada iOS Safari**:
   Browser Safari pada iOS memiliki kebijakan penghematan daya yang sangat ketat terhadap Web Audio API saat layar mati. Untuk pengalaman terbaik di perangkat iPhone/iPad:
   - Pasang aplikasi ke Layar Utama (*Add to Home Screen*).
   - Izinkan audio terus diputar melalui Media Session lockscreen control.

---

## ✅ Checklist Pengujian Manual

- [x] **Layar Loading Screen**: Tampil logo AylusMusic dengan animasi pulse dan loading bar tipis emas berdurasi minimal 1,8 detik.
- [x] **Layar Onboarding**:
  - Pertanyaan "Biasa dipanggil apa?" dengan validasi input 2–24 karakter.
  - Pilihan sumber tahu aplikasi (tepat 12 pilihan chip, dengan input teks jika memilih "Lainnya").
  - Pilihan masuk Google vs Tamu dengan tabel perbandingan fitur dan status gembok emas.
  - Dialog tawaran impor Spotify langsung setelah masuk.
- [x] **Akun Google vs Mode Tamu**:
  - Akun Google: Backup otomatis metadata ke Firestore, EQ kustom 10 band, boost volume penuh hingga 300%, kuota offline penuh, statistik mendengarkan.
  - Mode Tamu: Fitur terkunci menampilkan ikon gembok emas; jika diketuk, muncul bottom-sheet modern untuk upgrade ke akun Google tanpa kehilangan data lokal.
- [x] **Pemutar Musik & Web Audio Engine**:
  - Slider volume 0–100% normal dan zona Boost 101%–300% emas.
  - Peringatan keamanan pendengaran muncul 1 kali per sesi saat slider melewati 100%.
  - Limiter aktif menjaga audio tidak clipping/pecah saat berada di zona boost.
  - Visualizer canvas bergerak dinamis mengikuti irama frekuensi audio.
  - Tombol pintasan keyboard (Spasi = Play/Pause, Panah Kiri/Kanan = Seek, M = Mute, S = Shuffle, R = Repeat).
- [x] **Media Session API**:
  - Notifikasi kontrol media muncul di lockscreen HP dan panel kontrol laptop (Play, Pause, Next, Prev, Seek).
- [x] **Impor Spotify & Audio Sources**:
  - Mendukung link publik Spotify, impor CSV Exportify, dan OAuth PKCE.
  - Algoritma pencocokan file audio lokal (*fuzzy match*) mencocokkan MP3 lokal dengan judul lagu.
  - Lagu tanpa audio diberi badge "Hanya Metadata" dan dapat dicarikan sumber legal via Jamendo.
- [x] **Offline & PWA**:
  - Deteksi status online / offline dengan indikator visual.
  - Lagu yang diunduh dapat diputar tanpa jaringan internet.
  - Tombol install PWA berfungsi dan menyajikan panduan khusus iOS Safari.
