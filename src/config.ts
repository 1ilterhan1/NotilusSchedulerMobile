// ── API base URL ──
// Mobil uygulama, NotilusSchedulerWeb.Server'daki MEVCUT API'ye bağlanır
// (yeni API yazılmaz). Telefon ile API'yi koşturan makine AYNI ağda olmalı.
//
// Buradaki IP'yi API'nin koştuğu makinenin LAN IP'siyle değiştir:
//   Windows'ta: ipconfig → "IPv4 Address" (örn. 192.168.1.34)
// Port, launchSettings.json'daki http profiliyle aynı (5240).
// Telefonda sertifika sorunu yaşamamak için https (7262) değil http kullanılır.
export const API_BASE_URL = 'http://192.168.1.122:5240';
