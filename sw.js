const CACHE_NAME = 'provex-one-v52';

const STATIC_ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/auth.js',
  './js/auth-config.js',
  './js/search.js',
  './js/acronis.js',
  './js/kaspersky.js',
  './js/tables.js',
  './js/trm.js',
  './js/admin-pricing.js',
  './manifest.json',
  './icons/icono-provexpress.png',
  './icons/logo.webp',
  './catalogs/catalog_manifest.json',
  './catalogs/acronis_products.json',
  './catalogs/kaspersky_products.json',
  './icons/provex_icon_16.png',
  './icons/provex_icon_32.png',
  './icons/provex_icon_64.png',
  './icons/provex_icon_128.png',
  './icons/provex_icon_180.png',
  './icons/provex_icon_192.png',
  './icons/provex_icon_256.png',
  './icons/provex_icon_512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  if (
    event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    url.pathname.endsWith('.html')
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // products.json → Network First (precios siempre frescos)
  if (url.pathname.endsWith('products.json') || url.pathname.includes('/catalogs/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // TRM API → Network Only
  if (url.hostname.includes('datos.gov.co')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  // Tailwind CDN y Google Fonts → Network First
  if (
    url.hostname.includes('cdn.tailwindcss.com') ||
    url.hostname.includes('alcdn.msauth.net') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Todo lo demás → Cache First
  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Sin conexión', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Sin conexión', { status: 503 });
  }
}
