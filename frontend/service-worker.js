/**
 * 大六壬 PWA Service Worker
 * Network-first 策略，确保获取最新内容
 * 版本升级后自动清理旧缓存
 */
const CACHE = 'dal-liuren-v4';

// 安装时立即接管
self.addEventListener('install', e => {
  console.log('[SW] v4 installing...');
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      // 预缓存关键资源
      return cache.addAll([
        '/',
        '/static/css/style.css',
        '/static/js/app.js',
        '/static/js/pan-renderer.js',
        '/static/js/chat.js',
        '/static/js/classics.js',
        '/static/js/params.js',
        '/static/js/particles.js',
        '/static/manifest.json',
      ]).catch(() => {
        // 预缓存失败不影响安装
        console.log('[SW] precache partial — will fetch on demand');
      });
    }).then(() => self.skipWaiting())
  );
});

// 激活时清理所有旧版本缓存
self.addEventListener('activate', e => {
  console.log('[SW] v4 activated');
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => {
        console.log('[SW] deleting old cache:', k);
        return caches.delete(k);
      }))
    ).then(() => self.clients.claim())
  );
});

// 请求处理：API/WS 直通，静态资源 network-first
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // API 和 WebSocket 请求不缓存，直通网络
  if (url.includes('/api/') || url.includes('/ws')) {
    return;
  }

  // 静态资源：network-first
  e.respondWith(
    fetch(e.request).then(resp => {
      // 成功响应写入缓存
      if (resp.ok && resp.type === 'basic') {
        const clone = resp.clone();
        caches.open(CACHE).then(cache => cache.put(e.request, clone));
      }
      return resp;
    }).catch(() => {
      // 网络不可用时回退到缓存
      return caches.match(e.request);
    })
  );
});

// 监听 SW 更新消息（前端可主动触发更新检查）
self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') {
    self.skipWaiting();
  }
});
