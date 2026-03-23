self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/') || e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request));
});
