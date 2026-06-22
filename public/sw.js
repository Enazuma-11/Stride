// ─── STRIDE SERVICE WORKER ────────────────────────────────────────────────────
// SporTech Innovation Lab — Full offline PWA support

const CACHE_NAME = 'stride-v3'
const STATIC_CACHE = 'stride-static-v3'
const API_CACHE = 'stride-api-v1'

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/',
  '/dashboard',
  '/leaves',
  '/attendance',
  '/profile',
  '/manifest.json',
  '/logo.png',
  '/offline.html',
]

// ── Install: pre-cache shell ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
        console.warn('[SW] Pre-cache partial failure:', err)
      })
    }).then(() => self.skipWaiting())
  )
})

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== API_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

// ── Fetch: smart caching strategy ────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET, chrome-extension, and Supabase auth requests
  if (request.method !== 'GET') return
  if (url.protocol === 'chrome-extension:') return
  if (url.hostname.includes('supabase.co') && url.pathname.includes('/auth/')) return

  // Supabase API calls — network first, fall back to cache
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(networkFirstWithCache(request, API_CACHE, 60))
    return
  }

  // Google Fonts — cache first (they never change)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // App shell & static assets — stale while revalidate
  if (url.hostname === self.location.hostname) {
    event.respondWith(staleWhileRevalidate(request))
    return
  }

  // Everything else — network first
  event.respondWith(networkFirst(request))
})

// ── Caching strategies ────────────────────────────────────────────────────────

// Cache first — serve from cache, update in background
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

// Network first — try network, fall back to cache
async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return cached || offlinePage()
  }
}

// Network first with short cache TTL (for API data)
async function networkFirstWithCache(request, cacheName, ttlSeconds) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      const responseToCache = response.clone()
      const headers = new Headers(responseToCache.headers)
      headers.append('sw-cached-at', Date.now().toString())
      const cachedResponse = new Response(await responseToCache.blob(), {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers,
      })
      cache.put(request, cachedResponse)
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// Stale while revalidate — serve cache instantly, update in background
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request)
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) {
      caches.open(STATIC_CACHE).then(cache => cache.put(request, response.clone()))
    }
    return response
  }).catch(() => null)

  return cached || fetchPromise || offlinePage()
}

// Offline fallback page
async function offlinePage() {
  const cached = await caches.match('/offline.html')
  return cached || new Response('<h1>You are offline</h1>', {
    headers: { 'Content-Type': 'text/html' }
  })
}

// ── Background sync: queue failed requests ────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-attendance') {
    event.waitUntil(syncQueuedData())
  }
})

async function syncQueuedData() {
  // Future: sync queued attendance check-ins when back online
  console.log('[SW] Background sync triggered')
}

// ── Push notifications (future) ───────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(
    self.registration.showNotification(data.title || 'Stride', {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      data: { url: data.url || '/dashboard' },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/dashboard')
  )
})
