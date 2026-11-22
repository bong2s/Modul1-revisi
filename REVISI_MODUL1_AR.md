# Revisi AR GARML Modul 1 (mengikuti pola implementasi Modul 8)

Framework tetap React + Vite + Three.js. Materi, data, dan model asli Modul 1 tidak diubah.

## Perubahan utama
- `src/components/ar/ARScene.tsx` — ditulis ulang: top bar, label hotspot, Info Message dari bawah, panel Alur, kamera.
- `src/components/ar/ARCameraHUD.tsx` — filter kategori (scroll horizontal), Reset View, Mulai AR, status kamera jujur.
- `src/components/ar/ARObjectInfoPanel.tsx` — bottom sheet (selalu ter-render, geser dari bawah), tombol X, bagian terstruktur, tab Komponen/Generasi.
- `src/components/ar/ARFlowPanel.tsx` (baru) — ALUR URUTAN KOMPONEN (chip bisa diklik).
- `src/components/ar/CameraPermission.tsx` — kini banner non-blokir (scene 3D tidak lagi ter-unmount saat izin ditolak).
- `src/three/ARSceneManager.ts` — ditulis ulang: susunan 2x4, pivot per model, framing otomatis (view insets), highlight/dim, Reset View/Reset objek.
- `src/three/HotspotLayer.ts` (baru) — label aksen + garis putus-putus, tanpa tumpang tindih.
- `src/three/ModelLoader.ts` — normalisasi sisi terpanjang, pivot, deteksi file pendukung glTF yang hilang.
- `src/data/learningFlow.ts`, `src/data/arLayout.ts` (baru); `types.ts`, `arObjects.ts` (path model + targetSize).
- `public/models/**` — model dipindah dari `src/assets/models` (import ?url merusak referensi relatif .bin/tekstur).

## Generasi II & III
Penyebab: kategori memakai daftar objek kosong sehingga tombol mati. Sekarang membuka materi generasi
(dari `generations.ts`) tanpa memalsukan model; ada navigasi ke generasi sebelumnya/berikutnya.

## PENTING: file model yang hilang
Lihat `public/models/README-MODEL.txt`. ZIP yang diterima tidak berisi `scene.bin`/`textures` untuk
5 model glTF (4004, semikonduktor, floppy, IBM PC, Power Mac G3), dan tidak ada tekstur untuk 8086 & Mac Classic.
Salin file aslinya ke folder model masing-masing; aplikasi memberi peringatan di layar selama file belum ada.

## Tambahan: VIEW AR (orbit kamera)
Tombol "VIEW AR" di bar atas masuk mode inspeksi: kamera mengorbit objek terpilih (atau seluruh susunan) memakai
OrbitControls bawaan three; objek tidak disentuh. Drag = orbit (sudut vertikal dibatasi), pinch/scroll = zoom,
tombol KEMBALI memulihkan kamera, seleksi, panel info, dan transformasi sebelumnya.

## Tambahan: AR View sungguhan (port dari Modul 8)
Tombol **Mulai AR** kini memulai sesi AR yang sama dengan Modul 8 (`src/three/ARSession.ts`, port langsung):
- WebXR `immersive-ar` (Android + Chrome + ARCore, HTTPS): susunan muncul di depan kamera, dikunci ke XRAnchor
  (tidak bergerak saat HP bergerak), DOM overlay untuk UI, estimasi cahaya bila tersedia.
- Jika WebXR tidak tersedia: mode cadangan kamera belakang + gyro (DeviceOrientation). Ini BUKAN tracking AR:
  hanya putaran HP yang terlacak, langkah/posisi tidak. HUD menyatakan hal ini.
- Tanpa izin kamera: sesi ditolak dengan pesan jelas, pratinjau 3D tetap aktif.
- Selama AR: gesture jari tidak menggerakkan model; seleksi, panel info, dan alur tetap bisa dipakai.
  HUD: Tempatkan ulang / Reset / Keluar AR. Keluar AR memulihkan susunan, seleksi, dan transformasi objek.
- **VIEW AR** tetap ada sebagai inspeksi orbit virtual (berfungsi juga di desktop tanpa kamera/gyro).

## Tambahan: tampilan AR disamakan dengan Modul 8
CSS/DOM AR diadaptasi dari `style.css`, `main.ts`, dan `hotspots.ts` Modul 8 (selector berprefix `.ar8-`):
bar atas rata tengah (filter persegi 6px, Reset View amber, Mulai AR biru, badge status), label berisi warna aksen +
titik + garis putus-putus yang didorong keluar dari kotak model (port `hotspots.ts`), petunjuk PUTAR/PINDAH/ZOOM,
panel ALUR URUTAN KOMPONEN berbentuk kartu bawah, Info Message sebagai bottom sheet (side sheet di landscape ≥700px),
framing model memakai pengukuran area bebas yang sama dengan `measureInsets` Modul 8.
Navigasi, materi, VIEW AR (orbit), dan Mulai AR (sesi AR) Modul 1 tetap.
Catatan: ARMenu (menu layar lain) sudah tidak ada pada ZIP yang diterima (dihapus di Bolt) dan tidak saya kembalikan.
