# Workstel — acuan desain

Detailed inspection evidence and route coverage: [Sentec UI audit](SENTEC_UI_AUDIT.md).
Mobile EMS reference and combined recommendations: [EMS mobile audit](EMS_MOBILE_UI_AUDIT.md).

Acuan disetujui pengguna: dashboard Sentec PMS https://apse1.pms.sentec.io/dashboard (pemeriksaan DOM/computed styles, 1 November 2026).
Tidak menyimpan data akun, reservasi, token, atau aset privat Sentec.

## Hasil pengukuran

- Framework teridentifikasi: Vuetify (stylesheet vuetify dan kelas v-application/v-card/v-btn). Versi belum terverifikasi.
- Font UI Quicksand, 15px, bobot dasar 500.
- Font tabel Noto Sans; sel dense 13.125px, bobot 400, tinggi 32px, padding horizontal 16px.
- Background #F2F5F8, surface #FFFFFF; warna teks rgba(0,0,0,.87).
- Primary #0096C7; ikon Material Design Icons (MDI).
- Radius kartu/tombol 6px; header 64px.
- Input pencarian 40px, radius 28px, background rgba(0,0,0,.06).
- Shadow kartu: 0 3px 10px -2px rgba(85,85,85,.08), 0 2px 20px rgba(85,85,85,.06), 0 1px 30px rgba(85,85,85,.03).
- Shadow header: 0 2px 30px -1px rgba(85,85,85,.08), 0 4px 30px rgba(85,85,85,.06), 0 1px 30px rgba(85,85,85,.03).
- Tombol default 36px, small 28px; target sentuh mobile harus diperbesar bila perlu.

## Implementasi Workstel

Vue + TypeScript + Vite + Vuetify. Font open-source dibundel lokal menggunakan Fontsource; ikon dari @mdi/font.
Gunakan versi paket yang dicatat package-lock.json, bukan klaim versi sama dengan Sentec.
Workstel mempertahankan login SSO, dashboard compact kartu modul, header tanpa sidebar, tugas dan favorit.
Warna primary, font, radius, background dan shadow mengikuti pengukuran. Tata letak mengikuti kebutuhan Workstel.
Jangan tambahkan animasi dekoratif atau statistik fiktif.
Belum diklaim pixel-identical; dashboard referensi memiliki jenis isi dan ukuran komponen yang berbeda.

## Baseline disetujui pengguna — 1 November 2026

Pengguna menyetujui tampilan mockup desktop dan mobile saat ini sebagai baseline desain Workstel.

- Brand Workstel. dengan titik aksen cyan.
- Vue + TypeScript + Vite + Vuetify; font Quicksand, Noto Sans untuk tabel, ikon MDI.
- Material mengikuti token Sentec yang dicatat di atas; antarmuka kerja ringkas tanpa gimmick.
- Desktop tanpa sidebar, header tipis, dashboard kartu modul compact.
- Mobile: kartu satu kolom, pencarian lebar penuh, kategori di bawah pencarian, navigasi Dashboard/Tugas saya/Favorit di bawah baris utama header (bukan bottom navigation).
- Login SSO tetap menjadi halaman pertama. Akses demo terpisah selama prototipe.
- Preview mobile telah diperiksa pada viewport 390 x 844; lebar dokumen 390px, tanpa overflow horizontal.
  Modul berikutnya wajib mengikuti baseline ini. Perubahan besar pada navigasi atau bahasa visual harus dibahas dengan pengguna terlebih dahulu.

## Responsive implementation — 5 November 2026

Workstel keeps the PMS material tokens and uses the EMS vertical-flow principles on narrow screens. Shared page gutters and headings scale with viewport width. Module toolbar and record layouts also respond to their available container width, rather than relying exclusively on device breakpoints. Narrow filters stack before their labels become cramped. Mobile and coarse-pointer controls have at least 44px touch targets, and input text uses 16px. Dialogs retain viewport margins and bounded height; explicit fullscreen dialogs retain their own layout.

The dashboard category filter opens from an icon next to search on mobile, superseding the earlier always-visible category row. Module cards remain one column on mobile. These are frontend layout changes; no server/API behavior changes.

Validation: the local browser preview could not be reached through localhost or the LAN URL in the ChatGPT browser. Desktop, tablet and mobile visual acceptance remains open; do not claim a perfect fit on every device from source/build checks alone.

## Language baseline

English is the default interface and coding language. Bahasa Indonesia is an optional user-selectable locale; visual structure remains the same across locales.
