// ============================================================
// service-worker.js — GUSERA LTD
// Bertugas menerima push event dari server backend dan menampilkan
// notifikasi sistem, WALAUPUN tab/app sudah ditutup atau layar
// terkunci. Ini bagian yang membuat alert "server-backed" beda
// dari polling biasa (yang berhenti begitu tab ditutup).
//
// Batas fisik: kalau device benar-benar mati (bukan lock/sleep),
// tidak ada push yang bisa sampai sampai device menyala lagi.
// ============================================================

const CACHE_NAME = 'gusera-shell-v1';
const SHELL_FILES = ['/', '/index.html', '/style.css', '/script.js'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Terima push dari backend ──
self.addEventListener('push', (event) => {
  let data = { title: 'GUSERA LTD', body: 'Update signal baru tersedia.' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    if (event.data) data.body = event.data.text();
  }

  const title = data.title || 'GUSERA LTD';
  const options = {
    body: data.body || '',
    icon: '/logo.png',
    badge: '/favicon.png',
    tag: 'xauusd-signal',
    renotify: true,
    requireInteraction: true, // tetap tampil sampai user sentuh, bagus untuk sinyal trading
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Klik notifikasi → fokus/buka tab app ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});

// Kalau browser meng-invalidasi subscription lama (rotasi kunci dll),
// coba re-subscribe otomatis lewat pesan ke halaman utama.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll().then((clientsArr) => {
      clientsArr.forEach((c) => c.postMessage({ type: 'RESUBSCRIBE_PUSH' }));
    })
  );
});
