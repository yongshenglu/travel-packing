/* Service Worker
   注意：每次改动 HTML/CSS/JS 后，必须递增下面的 VER，
   否则手机端会一直读旧缓存。
   另外 index.html 里 <meta name="app-version"> 要一起改成同一个值，
   设置页底部会显示它，用来确认手机拿到的是哪个版本。 */
const VER = 'tp-v47';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './js/main.js',
  './js/views.js',
  './js/store.js',
  './js/merge.js',
  './js/sync.js',
  './js/ui.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

const CACHE = `tp-cache-${VER}`;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  /* GitHub API 与跨域请求一律放行，交给网络 */
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
