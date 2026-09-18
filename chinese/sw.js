/**
 * 서비스 워커 — 陈老师 중국어 학당
 *
 * 캐시 전략을 고른 이유:
 *   이 앱은 하루에도 몇 번씩 배포됩니다. 캐시 우선으로 두면 옛 화면에 갇혀서
 *   "고쳤는데 그대로예요"가 됩니다. 그건 PWA가 주는 속도보다 훨씬 비쌉니다.
 *   그래서 화면 파일은 **네트워크 우선, 실패하면 캐시**로 둡니다.
 *   온라인이면 항상 최신이고, 끊겨도 마지막으로 열었던 화면은 뜹니다.
 *
 *   폰트처럼 변하지 않는 것만 캐시 우선입니다.
 *   API(/api/*)는 절대 캐시하지 않습니다. 진도·채점은 늘 진짜 값이어야 합니다.
 */
const VERSION = '2026-09-18a';
const SHELL = `shell-chinese-${VERSION}`;
const ASSET = `asset-chinese-${VERSION}`;

const SHELL_FILES = [
  '/chinese/',
  '/chinese/index.html',
  '/chinese/chinese.css',
  '/chinese/chinese.js',
];

self.addEventListener('install', (e) => {
  // 새 워커를 기다리게 두지 않습니다 — 배포가 잦아서 바로 갈아타는 게 낫습니다
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.endsWith('-chinese-' + VERSION) === false && k.includes('-chinese-'))
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isApi = (url) => url.pathname.startsWith('/api/');
const isFont = (url) =>
  url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // POST(채점·제출)는 건드리지 않습니다
  const url = new URL(req.url);

  // 진도·채점은 늘 진짜 값이어야 합니다. 캐시하지도, 캐시에서 주지도 않습니다
  if (isApi(url)) return;

  // 폰트는 변하지 않으니 캐시 우선 — 두 번째 실행부터 눈에 띄게 빨라집니다
  if (isFont(url)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') {
          const c = await caches.open(ASSET);
          c.put(req, res.clone());
        }
        return res;
      } catch { return hit || Response.error(); }
    })());
    return;
  }

  // 아이콘·이미지도 캐시 우선
  if (/\.(png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(ASSET)).put(req, res.clone());
        return res;
      } catch { return hit || Response.error(); }
    })());
    return;
  }

  // 나머지(화면 파일) — 네트워크 우선, 끊기면 캐시
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
      return res;
    } catch {
      const hit = await caches.match(req);
      if (hit) return hit;
      // 문서 요청이면 첫 화면이라도 돌려줍니다
      if (req.mode === 'navigate') {
        const shell = await caches.match('/chinese/index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
