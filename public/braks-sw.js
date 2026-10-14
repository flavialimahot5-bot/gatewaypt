// No dashboard, customer data, login response or API response is cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
const notificationPath = value => ['/topsdlsodo?section=Vendas', '/topsdlsodo?section=Gateways'].includes(value) ? value : '/topsdlsodo?section=Dashboard';
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  const title = typeof data.title === 'string' ? data.title : 'Goti Pay';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : 'Você tem uma atualização no painel.',
    icon: '/goti-pay-avatar.jpg', badge: '/goti-pay-avatar.jpg',
    tag: typeof data.tag === 'string' ? data.tag : 'braks-update',
    data: { url: notificationPath(data.url) },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = notificationPath(event.notification.data?.url);
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for (const page of pages) {
      const url = new URL(page.url);
      if (url.origin === self.location.origin && url.pathname === '/topsdlsodo') {
        await page.navigate(path);
        await page.focus();
        return;
      }
    }
    await self.clients.openWindow(path);
  })());
});
