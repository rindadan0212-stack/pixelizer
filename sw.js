// Pixelizer のサービスワーカー。
// 目的は 1 つだけ ―― 一度開いたら、通信が無くても開けるようにすること。
//
// 方針:
//   自分のファイル … インストール時に丸ごと入れておき、まずキャッシュから返す。
//                     裏で取り直して次回に備える (stale-while-revalidate)。
//   外部 (フォント) … 取れたら入れておく。取れなければ黙って諦める。
//
// 中身を変えたら CACHE の版を上げる。古い版は activate で捨てる。
const CACHE = 'pixelizer-v2';
const SHELL = [
  './',
  './index.html',
  './gif.js',
  './gif.worker.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 1 つでも欠けると全部入らない addAll は避ける。個別に入れて、失敗は流す。
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 入口の URL は ?v=... のような付け足しを無視して 1 つの記録にまとめる。
  // そうしないと、開き方が違うだけで別物として溜まっていく。
  const matchOpts = { ignoreSearch: req.mode === 'navigate' };

  e.respondWith(
    caches.match(req, matchOpts).then(hit => {
      const net = fetch(req).then(res => {
        // 不透明応答 (フォント CDN) も含めて、返ってきたものは入れておく。
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => null);
        }
        return res;
      }).catch(() => null);

      // キャッシュがあれば即返す。無ければ回線を待つ。
      // どちらも無いときだけ、入口の index.html で受け止める。
      return hit || net.then(r => r || caches.match('./index.html'));
    })
  );
});
