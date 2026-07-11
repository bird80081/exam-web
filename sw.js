/* 離線快取：安裝時抓核心檔與題庫，之後網路優先、失敗用快取（公車斷網也能考） */
const CACHE = "examweb-v2";
const CORE = ["./", "index.html", "style.css", "app.js", "manifest.json", "exams/index.json"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await c.addAll(CORE);
      try {
        const idx = await (await fetch("exams/index.json")).json();
        await c.addAll(idx.map(x => "exams/" + x.file));
      } catch {}
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
