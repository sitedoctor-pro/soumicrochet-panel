const SUPABASE_URL = 'https://axgcycsojorwztwlfprg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1YuKU9O3wuH1Zbikx_OonQ_ayCIjmSR';
const ONESIGNAL_ADMIN_APP_ID = '7e6b1cf8-6a2f-44ad-ada2-f623c8046d81';

const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let state = { orders: [], reviews: [], visitors: [], analytics: [], subscribers: [], logs: [], chart: null, products: [] };

// --- HELPERS ---
function safeText(value = '') {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function normalizeActivityHistory(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }
  return [];
}

function countPageViews(analyticsRows = []) {
  return analyticsRows.reduce((total, row) => {
    const history = normalizeActivityHistory(row.activity_history);
    return total + history.filter((event) => event?.type === 'page_view').length;
  }, 0);
}

function deliveredRevenue(orders = []) {
  return orders.reduce((sum, order) => {
    const status = String(order.status || '').toLowerCase();
    if (status !== 'delivered') return sum;
    return sum + (Number(order.price) || 0);
  }, 0);
}

function visitorGroupKey(row = {}) {
  return row.onesignal_user_id || row.ip_address || row.visitor_id || row.id || 'unknown';
}

function uniqueVisitorsToday(analyticsRows = []) {
  const today = new Date().toISOString().slice(0, 10);
  const keys = new Set();
  analyticsRows.forEach((row) => {
    const date = row.last_seen || row.created_at;
    if (!date || String(date).slice(0, 10) !== today) return;
    keys.add(visitorGroupKey(row));
  });
  return keys.size;
}

function getGroupedVisitors() {
  const map = new Map();
  (state.analytics || []).forEach((row) => {
    const key = visitorGroupKey(row);
    const history = normalizeActivityHistory(row.activity_history);
    const old = map.get(key);
    if (!old) {
      map.set(key, {
        key,
        ip_address: row.ip_address || '-',
        city: row.city || '-',
        visitor_ids: row.visitor_id ? [row.visitor_id] : [],
        last_seen: row.last_seen || row.created_at,
        time_spent_seconds: Number(row.time_spent_seconds) || 0,
        activity_history: [...history],
        page_views: history.filter((ev) => ev?.type === 'page_view').length,
        raw_rows: [row]
      });
      return;
    }
    if (row.visitor_id && !old.visitor_ids.includes(row.visitor_id)) old.visitor_ids.push(row.visitor_id);
    old.activity_history.push(...history);
    old.page_views += history.filter((ev) => ev?.type === 'page_view').length;
    old.time_spent_seconds = Math.max(old.time_spent_seconds, Number(row.time_spent_seconds) || 0);
    if (new Date(row.last_seen || row.created_at || 0) > new Date(old.last_seen || 0)) {
      old.last_seen = row.last_seen || row.created_at;
      old.ip_address = row.ip_address || old.ip_address;
      old.city = row.city || old.city;
    }
    old.raw_rows.push(row);
  });
  return Array.from(map.values()).sort((a, b) => new Date(b.last_seen || 0) - new Date(a.last_seen || 0));
}

function getLatestActivityEvents(limit = 80) {
  const events = [];
  (state.analytics || []).forEach((row) => {
    const history = normalizeActivityHistory(row.activity_history);
    history.forEach((ev) => {
      events.push({
        ...ev,
        ip_address: row.ip_address || '-',
        city: row.city || '-',
        visitor_id: row.visitor_id || '-',
        last_seen: row.last_seen || row.created_at,
        time_spent_seconds: row.time_spent_seconds || 0
      });
    });
  });
  return events
    .sort((a, b) => new Date(b.at || b.timestamp || b.last_seen || 0) - new Date(a.at || a.timestamp || a.last_seen || 0))
    .slice(0, limit);
}

function formatActivityLabel(ev = {}) {
  const type = ev.type || 'event';
  if (type === 'page_view') return '👁️ Page view';
  if (type === 'product_view') return `👜 Produit: ${ev.product_name || ev.product_id || '-'}`;
  if (type === 'push_subscribe') return '🔔 Notifications activées';
  if (type === 'order_submit') return '✅ Commande envoyée';
  return safeText(type);
}

function fmtDate(value){ return value ? new Date(value).toLocaleString('fr-FR') : '-'; }
function money(value){ return `${Number(value || 0).toLocaleString('fr-FR')} DH`; }
function normalizePhone(phone = ''){
  const digits = String(phone).replace(/\D/g, '');
  if(digits.startsWith('212')) return digits;
  if(digits.startsWith('0')) return `212${digits.slice(1)}`;
  return digits;
}

function getOrderImage(order){
  if(order.image_url) return order.image_url;
  if(order.selected_product_image) return order.selected_product_image;
  const product = state.products.find(p => p.id === order.product_id);
  return product?.images?.[0] || '';
}

// --- NOTIFICATIONS & ALERTS ---
function playNewOrderSound() {
  try {
    const audio = new Audio('./notification.mp3');
    audio.volume = 0.9;
    audio.play().catch(() => {});
  } catch (_) {}
}

function notifyAdminNewOrder(order) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const body = [
    `Nom: ${order.customer_name || '-'}`,
    `Téléphone: ${order.phone || '-'}`,
    `Ville: ${order.city || '-'}`,
    `Adresse: ${order.address || '-'}`
  ].join('\n');

  new Notification('👜 Nouvelle commande Soumi Crochet', {
    body,
    icon: order.image_url || './logo.png',
    badge: './logo.png',
    tag: `order-${order.id || Date.now()}`
  });
}

async function waitForAdminOneSignalReady(timeoutMs = 12000) {
  if (!window.OneSignalDeferred) throw new Error('OneSignal SDK not loaded');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OneSignal SDK timeout')), timeoutMs);
    window.OneSignalDeferred.push(async function (OneSignal) {
      clearTimeout(timer);
      resolve(OneSignal);
    });
  });
}

async function requestAdminNotificationPermission() {
  try {
    if (!('Notification' in window)) {
      alert('Ce navigateur ne supporte pas les notifications.');
      return;
    }
    const OneSignal = await waitForAdminOneSignalReady();
    await OneSignal.Notifications.requestPermission();
    if (Notification.permission !== 'granted') {
      alert('Notifications non activées. Cliquez sur Autoriser dans le navigateur.');
      return;
    }
    try { await OneSignal.User.PushSubscription.optIn(); } catch (_) {}
    alert('✅ Alertes admin activées');
  } catch (error) {
    console.error('Admin push activation failed:', error);
    alert('Erreur activation OneSignal. Vérifiez le domain panel et OneSignalSDKWorker.js.');
  }
}
// --- LOAD DATA ---
async function requireAuth(){
  const { data } = await client.auth.getSession();
  if(!data.session) location.href = 'login.html';
}

async function loadProductsCatalog(){
  try {
    let res = await fetch('./products.json', { cache: 'no-store' });
    if (!res.ok) res = await fetch('../products.json', { cache: 'no-store' });
    if (res.ok) state.products = await res.json();
  } catch(err) {}
}

async function loadAll(){
  await Promise.all([
    (async () => { const { data } = await client.from('orders').select('*').order('created_at', { ascending:false }); state.orders = data || []; })(),
    (async () => { const { data } = await client.from('reviews').select('*').order('created_at', { ascending:false }); state.reviews = data || []; })(),
    (async () => { const { data } = await client.from('analytics').select('*').order('last_seen', { ascending:false }); state.analytics = data || []; state.visitors = data || []; })(),
    (async () => { const { data } = await client.from('subscribers').select('*').order('created_at', { ascending:false }); state.subscribers = data || []; })(),
    (async () => { const { data } = await client.from('notification_logs').select('*').order('sent_at', { ascending:false }).limit(80); state.logs = data || []; })()
  ]);
  
  renderStats();
  renderOrders();
  renderReviews();
  renderVisitors();
  renderAnalyticsTable();
  renderLogs();
  populateSegmentList();
  renderAnalyticsChart();
}

// --- RENDER STATS & CHART ---
function renderStats() {
  const orders = state.orders || [];
  const reviews = state.reviews || [];
  const analytics = state.analytics || [];
  const subscribers = state.subscribers || [];
  const todayVisitors = uniqueVisitorsToday(analytics);

  const totalRevenue = deliveredRevenue(orders);
  const totalPageViews = countPageViews(analytics);
  const pendingOrders = orders.filter((order) => {
    const status = String(order.status || '').toLowerCase();
    return status === 'pending' || status === 'new';
  }).length;

  const statOrders = document.getElementById('statOrders');
  const statRevenue = document.getElementById('statRevenue');
  const statVisitors = document.getElementById('statVisitors');
  const statReviews = document.getElementById('statReviews');
  const statPageViews = document.getElementById('statPageViews');
  const statSubscribers = document.getElementById('statSubscribers');
  const statPending = document.getElementById('statPending');

  if (statOrders) statOrders.textContent = orders.length;
  if (statRevenue) statRevenue.textContent = `${totalRevenue.toLocaleString('fr-FR')} DH`;
  if (statVisitors) statVisitors.textContent = todayVisitors;
  if (statReviews) statReviews.textContent = reviews.length;
  if (statPageViews) statPageViews.textContent = totalPageViews;
  if (statSubscribers) statSubscribers.textContent = subscribers.length;
  if (statPending) statPending.textContent = pendingOrders;
}

function getDailyPageViewCounts() {
  const analytics = state.analytics || [];
  const buckets = {};
  analytics.forEach((row) => {
    const history = normalizeActivityHistory(row.activity_history);
    history.forEach((event) => {
      if (event?.type !== 'page_view') return;
      const date = String(event.at || event.timestamp || row.last_seen || row.created_at || '').slice(0, 10);
      if (!date) return;
      buckets[date] = (buckets[date] || 0) + 1;
    });
  });
  return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([date, count]) => ({ date, count }));
}

function renderAnalyticsChart() {
  const canvas = document.getElementById('salesChart') || document.getElementById('analyticsChart') || document.getElementById('visitorsChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const daily = getDailyPageViewCounts();

  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  state.chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: daily.map((item) => item.date),
      datasets: [{
        label: 'Page Views',
        data: daily.map((item) => item.count),
        tension: 0.35,
        fill: true,
        borderColor: '#7a1730',
        backgroundColor: 'rgba(122, 23, 48, 0.1)'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

// --- RENDER TABLES/LISTS ---
function renderOrders() {
  const root = $('ordersList');
  if(!root) return;

  root.innerHTML = state.orders.map(order => `
    <article class="order-card" data-id="${safeText(order.id)}">
      <div class="card-main">
        <div>
          <strong>${safeText(order.customer_name || '-')}</strong>
          <div class="meta"><span>${safeText(order.city || '-')}</span></div>
        </div>
        <div>
          <button class="toggle-details" data-view-order="${safeText(order.id)}">Voir les détails</button>
        </div>
      </div>
    </article>
  `).join('') || '<p>Aucune commande.</p>';

  qsa('[data-view-order]', root).forEach(btn => {
    btn.addEventListener('click', () => openOrderModal(btn.dataset.viewOrder));
  });
}

function canSendTrackingPush(order) {
  const status = String(order?.status || '').toLowerCase();
  return Boolean(order?.onesignal_user_id && (status === 'shipped' || status === 'delivered'));
}

function openOrderModal(orderId){
  const order = state.orders.find(o => String(o.id) === String(orderId));
  if(!order || !$('orderModal')) return;

  const imageUrl = getOrderImage(order);
  const phone = normalizePhone(order.phone);
  const text = encodeURIComponent(`سلام ${order.customer_name || ''}، بغينا نأكدو الطلب ديالك من Soumi Crochet: ${order.product_name || ''} بثمن ${order.price || ''} DH.`);
  const waHref = phone ? `https://wa.me/${phone}?text=${text}` : '#';
  const trackingButton = canSendTrackingPush(order)
    ? `<button type="button" class="approve" data-open-track-push-modal="${safeText(order.id)}">🚚 إشعار التوصيل</button>`
    : '';

  const body = $('orderModalContent');
  if (!body) return;

  body.innerHTML = `
    ${imageUrl ? `<img src="${safeText(imageUrl)}" alt="Product" style="max-width:100%; height:200px; object-fit:cover; border-radius:12px; margin-bottom:15px;">` : ''}
    <p><b>Customer:</b> ${safeText(order.customer_name)}</p>
    <p><b>Phone:</b> ${safeText(order.phone)}</p>
    <p><b>City:</b> ${safeText(order.city)}</p>
    <p><b>Address:</b> ${safeText(order.address)}</p>
    <p><b>Product:</b> ${safeText(order.product_name)}</p>
    <p><b>Price:</b> ${money(order.price)}</p>
    <p><b>Status:</b>
      <select id="statusSelect-${safeText(order.id)}" class="status-select">
        ${['pending','confirmed','processing','shipped','delivered','cancelled'].map(s => `<option value="${s}" ${String(order.status)===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </p>
    <p><b>Date:</b> ${fmtDate(order.created_at)}</p>
    <div class="actions" style="margin-top:15px;">
      <a href="${waHref}" target="_blank" rel="noopener">Confirm & WhatsApp</a>
      ${trackingButton}
      <button type="button" class="delete" data-delete-order-modal="${safeText(order.id)}">Delete</button>
    </div>
  `;

  setModalOpen('orderModal', true);

  $(`statusSelect-${order.id}`)?.addEventListener('change', async (e) => {
    const nextStatus = e.target.value;
    const { error } = await client.from('orders').update({ status: nextStatus }).eq('id', order.id);

    if (error) {
      alert(error.message || 'Erreur status');
      return;
    }

    order.status = nextStatus;
    const idx = state.orders.findIndex(item => String(item.id) === String(order.id));
    if (idx >= 0) state.orders[idx].status = nextStatus;

    await loadAll();
    openOrderModal(order.id);
  });

  body.querySelector('[data-open-track-push-modal]')?.addEventListener('click', () => {
    setModalOpen('orderModal', false);
    openTrackModal(order);
  });

  body.querySelector('[data-delete-order-modal]')?.addEventListener('click', async () => {
    if(confirm('Supprimer cette commande ?')){
      const { error } = await client.from('orders').delete().eq('id', order.id);
      if (error) alert(error.message || 'Erreur suppression');
      setModalOpen('orderModal', false);
      await loadAll();
    }
  });
}

// --- TRACKING PUSH MODAL ---
function openTrackModal(order) {
  const modal = document.getElementById('trackModal');
  if (!modal) return;
  const title = '🎉 طلبك راه فالطريق!';
  const message = `🚚 الصاك ديالك (${order.product_name}) خرج من عندنا وقريب يوصلك لـ ${order.city}. وجدي راسك! ✨`;
  document.getElementById('trackOneSignalUserId').value = order.onesignal_user_id || '';
  document.getElementById('trackOrderId').value = order.id || '';
  document.getElementById('trackTitle').value = title;
  document.getElementById('trackMessage').value = message;
  const status = document.getElementById('trackPushStatus');
  if (status) status.textContent = '';
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

function closeTrackModal() {
  const modal = document.getElementById('trackModal');
  if (!modal) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.toggle('no-scroll', !!document.querySelector('.modal.active'));
}

async function sendOneSignalPush({ title, message, playerIds = null, includedSegments = null, url = null, buttonText = null, targetApp = 'website', data = {} }) {
  const body = {
    targetApp,
    title,
    message,
    subscriptionIds: Array.isArray(playerIds) && playerIds.length ? playerIds : undefined,
    includedSegments: Array.isArray(playerIds) && playerIds.length ? undefined : (includedSegments || ['All']),
    url: url || (targetApp === 'website' ? 'https://soumicrochet.store/' : 'https://panel.soumicrochet.store/index.html'),
    buttonText: buttonText || (targetApp === 'website' ? 'اطلب الآن' : 'فتح الداشبورد'),
    data
  };

  const response = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify(body)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result?.error) {
    console.error('send-push failed:', response.status, result);
    throw new Error(result?.details?.errors?.[0] || result?.details?.errors || result?.error || `send-push HTTP ${response.status}`);
  }

  return result;
}

function initTrackPushModal() {
  document.querySelectorAll('[data-close-track-modal]').forEach((button) => {
    button.addEventListener('click', closeTrackModal);
  });
  document.getElementById('trackPushForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitBtn = form.querySelector('button[type="submit"]');
    const status = document.getElementById('trackPushStatus');
    const title = document.getElementById('trackTitle')?.value.trim();
    const message = document.getElementById('trackMessage')?.value.trim();
    const playerId = document.getElementById('trackOneSignalUserId')?.value.trim();

    if (!title || !message || !playerId) { if (status) status.textContent = 'Client OneSignal introuvable.'; return; }
    const originalText = submitBtn?.textContent || '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Envoi...'; }

    try {
      await sendOneSignalPush({
        title,
        message,
        playerIds: [playerId],
        targetApp: 'website',
        url: 'https://wa.me/212662711995?text=%D8%B4%D9%83%D8%B1%D8%A7%20soumicrochet%20%D8%B9%D9%84%D9%89%20%D8%A7%D9%87%D8%AA%D9%85%D8%A7%D9%85%D9%83%D9%85%20%D8%B1%D8%A7%D9%86%D9%8A%20%D9%83%D9%86%D8%AA%D8%B3%D9%86%D9%89%20%D8%A7%D9%84%D8%B7%D9%84%D8%A8%20%D8%A8%D9%81%D8%A7%D8%B1%D8%BA%20%D8%A7%D9%84%D8%B5%D8%A8%D8%B1',
        buttonText: 'تأكيد عبر واتساب',
        data: { type: 'order_shipped', order_id: document.getElementById('trackOrderId')?.value || '' }
      });
      await client.from('notification_logs').insert({ title, message, target_segment: playerId });
      if (status) status.textContent = 'Notification envoyée avec succès.';
      setTimeout(() => { closeTrackModal(); loadAll(); }, 1200);
    } catch (error) {
      console.error(error);
      if (status) status.textContent = `Erreur pendant l’envoi: ${error.message || error}`;
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
    }
  });
}

// --- VISITORS & REVIEWS ---
function renderVisitors(){
  const root = $('visitorsList');
  if(!root) return;
  const visitors = getGroupedVisitors();
  root.innerHTML = visitors.map(v => `
    <article class="visitor-card">
      <div class="card-main">
        <div>
          <strong>${safeText(v.ip_address || '-')}</strong>
          <div class="meta">
            <span>${safeText(v.city || 'Unknown')}</span>
            <span>${safeText(v.page_views || 0)} page view(s)</span>
          </div>
        </div>
        <button class="toggle-details" data-view-visitor="${safeText(v.key)}">Logs</button>
      </div>
    </article>
  `).join('') || '<p>Aucun visiteur.</p>';

  qsa('[data-view-visitor]', root).forEach(btn => btn.addEventListener('click', () => {
    const v = visitors.find(x => String(x.key) === String(btn.dataset.viewVisitor));
    if(!v) return;
    const body = $('visitorModalContent');
    if (!body) return;
    const history = (v.activity_history || []).slice(-30).reverse();
    body.innerHTML = `
      <p><b>IP:</b> ${safeText(v.ip_address || '-')}</p>
      <p><b>City:</b> ${safeText(v.city || '-')}</p>
      <p><b>Page views:</b> ${safeText(v.page_views || 0)}</p>
      <p><b>Last seen:</b> ${fmtDate(v.last_seen)}</p>
      <p><b>Time:</b> ${safeText(v.time_spent_seconds || 0)}s</p>
      ${history.length ? `<ol class="activity-list">${history.map(ev => `<li>${formatActivityLabel(ev)} <small>${safeText(ev.page_url || ev.page || ev.path || '')} · ${safeText(ev.at || ev.timestamp || '')}</small></li>`).join('')}</ol>` : '<p class="muted">Aucun historique.</p>'}
    `;
    setModalOpen('visitorModal', true);
  }));
}

function renderReviews(){
  const root = $('reviewsList');
  if(!root) return;
  root.innerHTML = state.reviews.map(r => `
    <article class="review-card">
      <div class="card-main"><div><strong>${safeText(r.reviewer_name)}</strong><div class="meta"><span>${'★'.repeat(r.rating || 5)}</span><span>${r.is_published ? 'Publié' : 'Attente'}</span></div></div></div>
      <p>${safeText(r.review_text)}</p>
      <div class="actions">
        <button class="approve" data-approve-review="${safeText(r.id)}">${r.is_published ? 'Masquer' : 'Approuver'}</button>
        <button class="delete" data-delete-review="${safeText(r.id)}">Delete</button>
      </div>
    </article>
  `).join('') || '<p>Aucun avis.</p>';
  qsa('[data-approve-review]', root).forEach(btn => btn.addEventListener('click', async () => {
    const review = state.reviews.find(x => x.id === btn.dataset.approveReview);
    if(review){ await client.from('reviews').update({ is_published: !review.is_published, status: !review.is_published ? 'approved' : 'pending' }).eq('id', review.id); await loadAll(); }
  }));
  qsa('[data-delete-review]', root).forEach(btn => btn.addEventListener('click', async () => {
    if(confirm('Supprimer cet avis ?')){ await client.from('reviews').delete().eq('id', btn.dataset.deleteReview); await loadAll(); }
  }));
}

function renderLogs(){
  const root = $('notificationLogsList') || $('notificationLogs');
  if(!root) return;
  root.innerHTML = state.logs.map(l => `<article class="log-card"><strong>${safeText(l.title)}</strong><p>${safeText(l.message)}</p><div class="meta"><span>${safeText(l.target_segment || 'All')}</span><span>${fmtDate(l.sent_at)}</span></div></article>`).join('') || '<p>Aucun log.</p>';
}

function subscriberDisplayCity(subscriber) { return subscriber.city || subscriber.device_info?.city || 'Ville inconnue'; }
function subscriberDisplayIP(subscriber) { return subscriber.ip_address || subscriber.device_info?.ip || subscriber.device_info?.ip_address || subscriber.device_info?.ipAddress || 'IP inconnue'; }
function populateSegmentList() {
  const list = document.getElementById('segmentList');
  if (!list) return;
  const subscribers = state.subscribers || [];
  if (!subscribers.length) { list.innerHTML = `<p class="muted">Aucun abonné trouvé.</p>`; return; }
  list.innerHTML = subscribers.map((subscriber) => {
    const playerId = subscriber.onesignal_player_id || '';
    const city = subscriberDisplayCity(subscriber);
    const ip = subscriberDisplayIP(subscriber);
    return `<label class="subscriber-row" style="display:flex; gap:10px; align-items:center; padding:10px; border-bottom:1px solid var(--line);">
              <input type="checkbox" value="${safeText(playerId)}">
              <span><strong>${safeText(ip)}</strong> - <small>${safeText(city)}</small></span>
            </label>`;
  }).join('');
}

// --- GLOBAL EVENTS & REALTIME ---
function setModalOpen(modalId, open) {
  const modal = $(modalId);
  if (!modal) return;
  modal.classList.toggle('active', open);
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
  document.body.classList.toggle('no-scroll', !!document.querySelector('.modal.active'));
}

function closeAnyOpenModal() {
  qsa('.modal.active').forEach((modal) => {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  });
  document.body.classList.remove('no-scroll');
}

function initTabs(){
  const buttons = qsa('.nav-tab, .tab-btn');
  const panels = qsa('.tab-panel, .tab');
  buttons.forEach(btn => btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    buttons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    panels.forEach(panel => panel.classList.remove('active'));
    $(`tab-${tab}`)?.classList.add('active');
    const title = btn.querySelector('strong')?.textContent?.trim() || btn.textContent.trim();
    if($('pageTitle')) $('pageTitle').textContent = title;
    if($('tabTitle')) $('tabTitle').textContent = title;
    $('sidebar')?.classList.remove('show');
  }));
}

function renderAnalyticsTable() {
  const root = $('analyticsTableBody');
  if (!root) return;
  const events = getLatestActivityEvents(80);
  const rows = events.map((ev) => {
    return `<tr>
      <td>${formatActivityLabel(ev)}</td>
      <td>${safeText(ev.ip_address || '-')}</td>
      <td>${safeText(ev.city || '-')}</td>
      <td>${safeText(ev.page_url || ev.page || ev.path || '-')}</td>
      <td>${fmtDate(ev.at || ev.timestamp || ev.last_seen)}</td>
      <td>${safeText(ev.time_spent_seconds || 0)}s</td>
    </tr>`;
  }).join('');
  root.innerHTML = rows || '<tr><td colspan="6">Aucun événement.</td></tr>';
}

function initEvents(){
  $('adminMenuToggle')?.addEventListener('click', () => $('sidebar')?.classList.toggle('show'));
  $('adminMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('show'));
  $('logoutBtn')?.addEventListener('click', async () => { await client.auth.signOut(); location.href = 'login.html'; });
  $('refreshBtn')?.addEventListener('click', loadAll);
  $('manualRefreshBtn')?.addEventListener('click', loadAll);
  $('requestNotificationsBtn')?.addEventListener('click', requestAdminNotificationPermission);
  
  qsa('[data-clean-table], .clean-btn').forEach(btn => btn.addEventListener('click', async () => {
    const table = btn.dataset.cleanTable || btn.dataset.clean;
    if (!table) return;
    if(confirm('⚠️ Êtes-vous sûr de vouloir tout supprimer ?')){
      const { error } = await client.from(table).delete().not('id', 'is', null);
      if (error) alert(error.message || 'Erreur pendant le nettoyage');
      await loadAll();
    }
  }));

  $('openSegmentModalBtn')?.addEventListener('click', () => { populateSegmentList(); setModalOpen('segmentModal', true); });
  qsa('[data-close-segment-modal]').forEach(el => el.addEventListener('click', () => setModalOpen('segmentModal', false)));
  qsa('[data-close-order-modal]').forEach(el => el.addEventListener('click', () => setModalOpen('orderModal', false)));
  qsa('[data-close-visitor-modal]').forEach(el => el.addEventListener('click', () => setModalOpen('visitorModal', false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAnyOpenModal(); });

  $('segmentSelectAll')?.addEventListener('change', e => qsa('#segmentList input[type="checkbox"]').forEach(cb => cb.checked = e.target.checked));
  $('selectAllSubscribers')?.addEventListener('change', e => qsa('#segmentList input[type="checkbox"]').forEach(cb => cb.checked = e.target.checked));
  
  $('confirmSegmentSelection')?.addEventListener('click', () => {
    const ids = qsa('#segmentList input[type="checkbox"]:checked').map(cb => cb.value).filter(Boolean);
    $('selectedSegmentIds').value = ids.join(',');
    setModalOpen('segmentModal', false);
    $('openSegmentModalBtn').textContent = ids.length ? `${ids.length} sélectionnés` : 'Choisir les destinataires';
    if ($('selectedSegmentLabel')) $('selectedSegmentLabel').textContent = ids.length ? `${ids.length} destinataire(s)` : 'Broadcast: All';
  });
  $('confirmSegments')?.addEventListener('click', () => $('confirmSegmentSelection')?.click());

  $('notificationForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const title = ($('notificationTitle') || $('pushTitle'))?.value.trim();
    const message = ($('notificationMessage') || $('pushMessage'))?.value.trim();
    const status = $('notificationStatus');
    const selectedTargets = document.getElementById('selectedSegmentIds')?.value.split(',').map((item) => item.trim()).filter(Boolean) || [];
    const btn = e.target.querySelector('button[type="submit"]');
    if (!title || !message) { if (status) status.textContent = 'Titre et message obligatoires.'; return; }
    const originalText = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = 'Envoi...'; }

    try {
      await sendOneSignalPush({
        title,
        message,
        playerIds: selectedTargets.length ? selectedTargets : null,
        includedSegments: selectedTargets.length ? null : ['All'],
        targetApp: 'website',
        url: document.getElementById('notificationUrl')?.value?.trim() || 'https://soumicrochet.store/',
        buttonText: document.getElementById('notificationButtonText')?.value?.trim() || 'اطلب الآن',
        data: { type: 'custom_dashboard_push' }
      });
      await client.from('notification_logs').insert({ title, message, target_segment: selectedTargets.length ? selectedTargets.join(',') : 'All' });
      if (status) status.textContent = 'Push envoyé !';
      e.target.reset();
      if ($('selectedSegmentIds')) $('selectedSegmentIds').value = '';
      if ($('openSegmentModalBtn')) $('openSegmentModalBtn').textContent = 'Choisir les destinataires';
      if ($('selectedSegmentLabel')) $('selectedSegmentLabel').textContent = 'Broadcast: All';
      await loadAll();
    } catch(err) {
      console.error(err);
      if (status) status.textContent = `Erreur Push: ${err.message || err}`;
      else alert('Erreur Push');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText || 'Envoyer notification'; }
    }
  });
}

function initRealtime() {
  if (!client) return;
  requestAdminNotificationPermission();
  client.channel('soumi-admin-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async (payload) => {
      if (payload.eventType === 'INSERT' && payload.new) { playNewOrderSound(); notifyAdminNewOrder(payload.new); }
      await loadAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'analytics' }, async () => {
      await loadAll();
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      renderAnalyticsChart();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, async () => { await loadAll(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subscribers' }, async () => { await loadAll(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_logs' }, async () => { await loadAll(); })
    .subscribe((status) => { if (status === 'CHANNEL_ERROR') console.warn('Realtime channel error. Check Supabase Realtime settings/RLS.'); });
}

function openHashTabOnLoad() {
  const hash = String(location.hash || '').replace('#', '');
  if (!hash) return;
  const btn = document.querySelector(`[data-tab="${hash}"]`);
  if (btn) btn.click();
}

async function init(){
  await requireAuth();
  await loadProductsCatalog();
  initTabs();
  initEvents();
  initTrackPushModal();
  await loadAll();
  openHashTabOnLoad();
  initRealtime();
}
document.addEventListener('DOMContentLoaded', init);