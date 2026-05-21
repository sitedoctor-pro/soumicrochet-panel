const SUPABASE_URL = 'https://axgcycsojorwztwlfprg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1YuKU9O3wuH1Zbikx_OonQ_ayCIjmSR';
const WEBSITE_ONESIGNAL_APP_ID = 'b0ca17c7-75cb-49bb-bfbd-936677a81519';
const ADMIN_ONESIGNAL_APP_ID = '7e6b1cf8-6a2f-44ad-ada2-f623c8046d81';
const ONESIGNAL_REST_API_KEY = 'os_v2_app_mvsrfcqu7zdmhpuhorop3efsmrqpwmgrm4xurl4b3zmllikl4drp4r7vv4ra7gpsey4iivgzaxi6arqs2ige4eaquuy3ajkwg735ioq';

const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const state = {
  orders: [],
  reviews: [],
  visitors: [],
  analytics: [],
  subscribers: [],
  logs: [],
  chart: null,
  products: [],
  realtimeReady: false,
  pollTimer: null
};

function safeText(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('fr-FR');
  } catch (_) {
    return String(value);
  }
}

function money(value) {
  return `${Number(value || 0).toLocaleString('fr-FR')} DH`;
}

function normalizePhone(phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('212')) return digits;
  if (digits.startsWith('0')) return `212${digits.slice(1)}`;
  return digits;
}

function normalizeActivityHistory(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function normalizeUrl(url = '') {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('assets/')) return `../${value}`;
  if (value.startsWith('/')) return `..${value}`;
  if (value.includes('soumicrochet.store')) return `https://${value.replace(/^\/+/, '')}`;
  return value;
}

function statusText(message, type = 'ok', timeout = 4200) {
  let el = $('statusBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'statusBanner';
    el.className = 'status-banner';
    document.body.appendChild(el);
  }

  el.className = `status-banner ${type}`;
  el.textContent = message;

  window.clearTimeout(el._timer);
  if (timeout) {
    el._timer = window.setTimeout(() => {
      el.textContent = '';
      el.className = 'status-banner';
      el.remove();
    }, timeout);
  }
}

function dbError(label, error) {
  if (!error) return;
  console.error(label, error);
  statusText(`${label}: ${error.message || 'Erreur Supabase'}`, 'error', 7000);
}

function countPageViews(rows = []) {
  return rows.reduce((total, row) => {
    const history = normalizeActivityHistory(row.activity_history);
    return total + history.filter((event) => event && event.type === 'page_view').length;
  }, 0);
}

function deliveredRevenue(orders = []) {
  return orders.reduce((sum, order) => {
    return String(order.status || '').toLowerCase() === 'delivered'
      ? sum + (Number(order.price) || 0)
      : sum;
  }, 0);
}

function getOrderImage(order) {
  const direct = normalizeUrl(order.image_url || order.selected_product_image || '');
  if (direct) return direct;

  const product = state.products.find((item) => String(item.id) === String(order.product_id));
  const image = product?.images?.[0] || product?.image || product?.mainImage || '';
  return normalizeUrl(image);
}

async function requireAuth() {
  const { data, error } = await client.auth.getSession();
  if (error) {
    dbError('Auth', error);
    return;
  }

  if (!data.session) {
    location.href = 'login.html';
  }
}

async function loadProductsCatalog() {
  const paths = ['./products.json', '../products.json', '/products.json'];
  for (const path of paths) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      state.products = Array.isArray(data) ? data : (Array.isArray(data.products) ? data.products : []);
      return;
    } catch (_) {}
  }
  state.products = [];
}

async function fetchTable(name, queryBuilder) {
  try {
    const { data, error } = await queryBuilder;
    if (error) {
      dbError(`Table ${name}`, error);
      return [];
    }
    return data || [];
  } catch (error) {
    dbError(`Table ${name}`, error);
    return [];
  }
}

async function loadAll() {
  const [orders, reviews, analytics, subscribers, logs] = await Promise.all([
    fetchTable('orders', client.from('orders').select('*').order('created_at', { ascending: false })),
    fetchTable('reviews', client.from('reviews').select('*').order('created_at', { ascending: false })),
    fetchTable('analytics', client.from('analytics').select('*').order('last_seen', { ascending: false })),
    fetchTable('subscribers', client.from('subscribers').select('*').order('created_at', { ascending: false })),
    fetchTable('notification_logs', client.from('notification_logs').select('*').order('sent_at', { ascending: false }).limit(120))
  ]);

  state.orders = orders;
  state.reviews = reviews;
  state.analytics = analytics;
  state.visitors = analytics;
  state.subscribers = subscribers;
  state.logs = logs;

  renderStats();
  renderOrders();
  renderReviews();
  renderVisitors();
  renderAnalyticsTable();
  renderLogs();
  populateSegmentList();
  renderAnalyticsChart();
}

function renderStats() {
  const today = new Date().toISOString().slice(0, 10);

  const todayVisitors = state.analytics.filter((row) => {
    const date = row.last_seen || row.created_at;
    return date && String(date).slice(0, 10) === today;
  }).length;

  const pendingOrders = state.orders.filter((order) => {
    const status = String(order.status || '').toLowerCase();
    return status === 'pending' || status === 'new';
  }).length;

  const values = {
    statOrders: state.orders.length,
    statRevenue: money(deliveredRevenue(state.orders)),
    statVisitors: todayVisitors,
    statReviews: state.reviews.length,
    statPageViews: countPageViews(state.analytics),
    statSubscribers: state.subscribers.length,
    statPending: pendingOrders
  };

  Object.entries(values).forEach(([id, value]) => {
    const el = $(id);
    if (el) el.textContent = value;
  });
}

function getDailyPageViewCounts() {
  const buckets = {};
  state.analytics.forEach((row) => {
    normalizeActivityHistory(row.activity_history).forEach((event) => {
      if (event?.type !== 'page_view') return;
      const date = String(event.at || event.timestamp || row.last_seen || row.created_at || '').slice(0, 10);
      if (!date) return;
      buckets[date] = (buckets[date] || 0) + 1;
    });
  });

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, count]) => ({ date, count }));
}

function renderAnalyticsChart() {
  const canvas = $('analyticsChart') || $('salesChart') || $('visitorsChart');
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
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function renderOrders() {
  const root = $('ordersList');
  if (!root) return;

  if (!state.orders.length) {
    root.innerHTML = '<p class="empty-state">Aucune commande pour le moment.</p>';
    return;
  }

  root.innerHTML = state.orders.map((order) => {
    const status = String(order.status || 'pending').toLowerCase();
    const showTrack = status === 'shipped' && order.onesignal_user_id;

    return `
      <article class="order-card" data-id="${safeText(order.id)}">
        <div class="card-main">
          <div>
            <strong>${safeText(order.customer_name || '-')}</strong>
            <div class="meta">
              <span>${safeText(order.city || '-')}</span>
              <span class="status-pill ${safeText(status)}">${safeText(status)}</span>
            </div>
          </div>

          <div class="actions">
            ${showTrack ? `
              <button class="btn-success btn-sm" type="button" data-open-track-push="${safeText(order.id)}">
                🚚 إشعار التوصيل
              </button>
            ` : ''}
            <button class="toggle-details" type="button" data-view-order="${safeText(order.id)}">
              Voir les détails
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  qsa('[data-view-order]', root).forEach((btn) => {
    btn.addEventListener('click', () => openOrderModal(btn.dataset.viewOrder));
  });

  qsa('[data-open-track-push]', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const order = state.orders.find((item) => String(item.id) === String(btn.dataset.openTrackPush));
      if (order) openTrackModal(order);
    });
  });
}

function openOrderModal(orderId) {
  const order = state.orders.find((item) => String(item.id) === String(orderId));
  const modal = $('orderModal');
  const body = $('orderModalContent');
  if (!order || !modal || !body) return;

  const imageUrl = getOrderImage(order);
  const phone = normalizePhone(order.phone);
  const text = encodeURIComponent(`سلام ${order.customer_name || ''}، بغينا نأكدو الطلب ديالك من Soumi Crochet: ${order.product_name || ''} بثمن ${order.price || ''} DH.`);
  const waHref = phone ? `https://wa.me/${phone}?text=${text}` : '#';

  body.innerHTML = `
    ${imageUrl ? `<img src="${safeText(imageUrl)}" alt="Product" class="image-preview">` : ''}
    <div class="detail-grid">
      <div class="detail-item"><small>Customer</small><strong>${safeText(order.customer_name || '-')}</strong></div>
      <div class="detail-item"><small>Phone</small><strong>${safeText(order.phone || '-')}</strong></div>
      <div class="detail-item"><small>City</small><strong>${safeText(order.city || '-')}</strong></div>
      <div class="detail-item"><small>Address</small><strong>${safeText(order.address || '-')}</strong></div>
      <div class="detail-item"><small>Product</small><strong>${safeText(order.product_name || '-')}</strong></div>
      <div class="detail-item"><small>Price</small><strong>${money(order.price)}</strong></div>
      <div class="detail-item"><small>Date</small><strong>${fmtDate(order.created_at)}</strong></div>
      <div class="detail-item">
        <small>Status</small>
        <select class="status-select" id="statusSelect-${safeText(order.id)}">
          ${['pending','confirmed','processing','shipped','delivered','cancelled'].map((status) => `
            <option value="${status}" ${String(order.status || 'pending') === status ? 'selected' : ''}>${status}</option>
          `).join('')}
        </select>
      </div>
    </div>

    <div class="actions" style="margin-top:15px;">
      <a href="${waHref}" target="_blank" rel="noopener">Confirm & WhatsApp</a>
      <button type="button" class="delete" data-delete-order-modal="${safeText(order.id)}">Delete</button>
    </div>
  `;

  setModalOpen('orderModal', true);

  $(`statusSelect-${order.id}`)?.addEventListener('change', async (event) => {
    const { error } = await client
      .from('orders')
      .update({ status: event.target.value })
      .eq('id', order.id);

    if (error) dbError('Update order status', error);
    await loadAll();
  });

  body.querySelector('[data-delete-order-modal]')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cette commande ?')) return;

    const { error } = await client.from('orders').delete().eq('id', order.id);
    if (error) {
      dbError('Delete order', error);
      return;
    }

    setModalOpen('orderModal', false);
    await loadAll();
  });
}

function renderReviews() {
  const root = $('reviewsList');
  if (!root) return;

  if (!state.reviews.length) {
    root.innerHTML = '<p class="empty-state">Aucun avis pour le moment.</p>';
    return;
  }

  root.innerHTML = state.reviews.map((review) => {
    const isPublished = Boolean(review.is_published) || review.status === 'approved';
    const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));

    return `
      <article class="review-card">
        <div class="card-main">
          <div>
            <strong>${safeText(review.reviewer_name || '-')}</strong>
            <div class="meta">
              <span>${'★'.repeat(rating)}</span>
              <span>${safeText(review.city || '-')}</span>
              <span>${isPublished ? 'Publié' : 'Attente'}</span>
            </div>
          </div>
        </div>

        <p>${safeText(review.review_text || '')}</p>

        <div class="actions">
          <button class="approve" type="button" data-approve-review="${safeText(review.id)}">
            ${isPublished ? 'Masquer' : 'Approuver'}
          </button>
          <button class="delete" type="button" data-delete-review="${safeText(review.id)}">Delete</button>
        </div>
      </article>
    `;
  }).join('');

  qsa('[data-approve-review]', root).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const review = state.reviews.find((item) => String(item.id) === String(btn.dataset.approveReview));
      if (!review) return;

      const nextPublished = !(Boolean(review.is_published) || review.status === 'approved');

      const { error } = await client
        .from('reviews')
        .update({
          is_published: nextPublished,
          status: nextPublished ? 'approved' : 'pending'
        })
        .eq('id', review.id);

      if (error) dbError('Update review', error);
      await loadAll();
    });
  });

  qsa('[data-delete-review]', root).forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer cet avis ?')) return;

      const { error } = await client.from('reviews').delete().eq('id', btn.dataset.deleteReview);
      if (error) dbError('Delete review', error);
      await loadAll();
    });
  });
}

function parseActivityLog(value) {
  const history = normalizeActivityHistory(value);
  if (!history.length) return '<p class="muted">Aucune activité enregistrée.</p>';

  return `
    <ol class="activity-list">
      ${history.slice(-30).reverse().map((event) => {
        const type = event?.type || 'event';
        const at = event?.at || event?.timestamp || '';

        if (type === 'product_view') {
          return `<li>👀 A vu le produit: ${safeText(event.meta?.product_name || event.product_name || '-')} <small>${safeText(at)}</small></li>`;
        }

        if (type === 'push_subscribe') {
          return `<li>🔔 A activé les notifications <small>${safeText(at)}</small></li>`;
        }

        if (type === 'page_view') {
          return `<li>📄 Page visitée: ${safeText(event.page_url || event.path || event.page || '-')} <small>${safeText(at)}</small></li>`;
        }

        if (type === 'form_draft') {
          return `<li>📝 A commencé le formulaire <small>${safeText(at)}</small></li>`;
        }

        if (type === 'order_submit') {
          return `<li>👜 A envoyé une commande <small>${safeText(at)}</small></li>`;
        }

        return `<li>• ${safeText(type)} <small>${safeText(at)}</small></li>`;
      }).join('')}
    </ol>
  `;
}

function renderVisitors() {
  const root = $('visitorsList');
  if (!root) return;

  if (!state.visitors.length) {
    root.innerHTML = '<p class="empty-state">Aucun visiteur pour le moment.</p>';
    return;
  }

  root.innerHTML = state.visitors.map((visitor) => `
    <article class="visitor-card">
      <div class="card-main">
        <div>
          <strong>${safeText(visitor.ip_address || 'IP inconnue')}</strong>
          <div class="meta">
            <span>${safeText(visitor.city || 'Ville inconnue')}</span>
            <span>${fmtDate(visitor.last_seen || visitor.created_at)}</span>
          </div>
        </div>

        <div class="actions">
          ${visitor.onesignal_user_id ? `
            <button type="button" data-notify-visitor="${safeText(visitor.visitor_id)}">Notify</button>
          ` : ''}
          <button class="toggle-details" type="button" data-view-visitor="${safeText(visitor.visitor_id)}">Voir les détails</button>
        </div>
      </div>
    </article>
  `).join('');

  qsa('[data-view-visitor]', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const visitor = state.visitors.find((item) => String(item.visitor_id) === String(btn.dataset.viewVisitor));
      if (visitor) openVisitorModal(visitor);
    });
  });

  qsa('[data-notify-visitor]', root).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const visitor = state.visitors.find((item) => String(item.visitor_id) === String(btn.dataset.notifyVisitor));
      if (!visitor?.onesignal_user_id) return;

      try {
        await sendOneSignalPush({
          title: '✨ Soumi Crochet',
          message: '👜 كاينين موديلات جداد كيتسناوك. دخلي تشوفيهم دابا!',
          playerIds: [visitor.onesignal_user_id]
        });

        await client.from('notification_logs').insert({
          title: '✨ Soumi Crochet',
          message: 'Visitor targeted push',
          target_segment: visitor.onesignal_user_id
        });

        statusText('Notification envoyée au visiteur.', 'ok');
        await loadAll();
      } catch (error) {
        dbError('Visitor push', error);
      }
    });
  });
}

function openVisitorModal(visitor) {
  const body = $('visitorModalContent');
  if (!body) return;

  body.innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><small>Visitor ID</small><strong>${safeText(visitor.visitor_id || '-')}</strong></div>
      <div class="detail-item"><small>IP</small><strong>${safeText(visitor.ip_address || '-')}</strong></div>
      <div class="detail-item"><small>City</small><strong>${safeText(visitor.city || '-')}</strong></div>
      <div class="detail-item"><small>Last seen</small><strong>${fmtDate(visitor.last_seen || visitor.created_at)}</strong></div>
      <div class="detail-item"><small>Time spent</small><strong>${safeText(visitor.time_spent_seconds || 0)}s</strong></div>
      <div class="detail-item"><small>OneSignal</small><strong>${visitor.onesignal_user_id ? 'Oui' : 'Non'}</strong></div>
    </div>

    <h3>Activity Log</h3>
    ${parseActivityLog(visitor.activity_history)}
  `;

  setModalOpen('visitorModal', true);
}

function renderAnalyticsTable() {
  const root = $('analyticsTableBody');
  if (!root) return;

  const rows = state.analytics.slice(0, 80).map((row) => {
    const history = normalizeActivityHistory(row.activity_history);
    const lastEvent = history[history.length - 1] || {};

    return `
      <tr>
        <td>${safeText(row.visitor_id || row.id || '-')}</td>
        <td>${safeText(row.ip_address || '-')}</td>
        <td>${safeText(row.city || '-')}</td>
        <td>${safeText(lastEvent.page_url || lastEvent.page || lastEvent.path || row.page_url || '-')}</td>
        <td>${fmtDate(row.last_seen || row.created_at)}</td>
        <td>${safeText(row.time_spent_seconds || 0)}s</td>
      </tr>
    `;
  }).join('');

  root.innerHTML = rows || '<tr><td colspan="6">Aucun événement.</td></tr>';
}

function renderLogs() {
  const root = $('notificationLogsList') || $('notificationLogs');
  if (!root) return;

  if (!state.logs.length) {
    root.innerHTML = '<p class="empty-state">Aucun log de notification.</p>';
    return;
  }

  root.innerHTML = state.logs.map((log) => `
    <article class="log-card">
      <strong>${safeText(log.title || '-')}</strong>
      <p>${safeText(log.message || '')}</p>
      <div class="meta">
        <span>${safeText(log.target_segment || 'All')}</span>
        <span>${fmtDate(log.sent_at)}</span>
      </div>
    </article>
  `).join('');
}

function subscriberDisplayCity(subscriber) {
  return subscriber.city || subscriber.device_info?.city || 'Ville inconnue';
}

function subscriberDisplayIP(subscriber) {
  return subscriber.ip_address ||
    subscriber.device_info?.ip ||
    subscriber.device_info?.ip_address ||
    subscriber.device_info?.ipAddress ||
    'IP inconnue';
}

function populateSegmentList() {
  const list = $('segmentList');
  if (!list) return;

  if (!state.subscribers.length) {
    list.innerHTML = '<p class="muted">Aucun abonné trouvé.</p>';
    return;
  }

  list.innerHTML = state.subscribers.map((subscriber) => {
    const playerId = subscriber.onesignal_player_id || '';
    return `
      <label class="subscriber-row">
        <input type="checkbox" value="${safeText(playerId)}">
        <span>
          <strong>${safeText(subscriberDisplayIP(subscriber))}</strong>
          <small>${safeText(subscriberDisplayCity(subscriber))}</small>
        </span>
      </label>
    `;
  }).join('');
}

function setModalOpen(modalId, open) {
  const modal = $(modalId);
  if (!modal) return;
  modal.classList.toggle('active', Boolean(open));
  modal.setAttribute('aria-hidden', open ? 'false' : 'true');
  document.body.classList.toggle('no-scroll', Boolean(document.querySelector('.modal.active')));
}

function closeAnyOpenModal() {
  qsa('.modal.active').forEach((modal) => {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  });
  document.body.classList.remove('no-scroll');
}

function playNewOrderSound() {
  try {
    const existing = $('newOrderAudio');
    if (existing) {
      existing.currentTime = 0;
      existing.play().catch(() => {});
      return;
    }

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
    icon: normalizeUrl(order.image_url) || './logo.png',
    badge: './logo.png',
    tag: `order-${order.id || Date.now()}`
  });
}

async function wait(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

async function requestAdminNotificationPermission() {
  if (!('Notification' in window)) return;

  try {
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    if (window.OneSignalDeferred) {
      await new Promise((resolve) => {
        window.OneSignalDeferred.push(async function(OneSignal){
          try {
            if (OneSignal?.Notifications?.isPushSupported && !OneSignal.Notifications.isPushSupported()) {
              resolve();
              return;
            }

            if (Notification.permission !== 'granted' && OneSignal?.Notifications?.requestPermission) {
              await OneSignal.Notifications.requestPermission();
            }

            if (Notification.permission === 'granted' && OneSignal?.User?.PushSubscription?.optIn) {
              await OneSignal.User.PushSubscription.optIn();
            }
          } catch (err) {
            console.warn('Admin OneSignal subscribe failed:', err);
          } finally {
            resolve();
          }
        });
      });
    }
  } catch (_) {}
}

function openTrackModal(order) {
  const modal = $('trackModal');
  if (!modal) return;

  const title = '🎉 طلبك راه فالطريق!';
  const message = `🚚 الصاك ديالك (${order.product_name}) خرج من عندنا وقريب يوصلك لـ ${order.city}. وجدي راسك! ✨`;
  const ctaText = 'شكراً Soumi Crochet';
  const ctaUrl = 'https://wa.me/212662711995?text=' + encodeURIComponent('شكرا soumicrochet على اهتمامكم راني كنتسنى الطلب بفارغ الصبر');

  $('trackOneSignalUserId').value = order.onesignal_user_id || '';
  $('trackOrderId').value = order.id || '';
  $('trackTitle').value = title;
  $('trackMessage').value = message;
  if ($('trackUrl')) $('trackUrl').value = ctaUrl;
  if ($('trackButtonText')) $('trackButtonText').value = ctaText;

  const status = $('trackPushStatus');
  if (status) status.textContent = '';

  setModalOpen('trackModal', true);
}

function closeTrackModal() {
  setModalOpen('trackModal', false);
}

async function sendOneSignalPush({ title, message, playerIds = null, includedSegments = null, url = 'https://soumicrochet.store/', buttonText = 'اطلب الآن', appId = WEBSITE_ONESIGNAL_APP_ID }) {
  const payload = {
    app_id: appId,
    headings: { en: title, fr: title, ar: title },
    contents: { en: message, fr: message, ar: message },
    url: url || 'https://soumicrochet.store/',
    web_url: url || 'https://soumicrochet.store/',
    buttons: [{ id: 'order-btn', text: buttonText || 'اطلب الآن' }],
    web_buttons: [{ id: 'order-btn', text: buttonText || 'اطلب الآن', url: url || 'https://soumicrochet.store/' }],
    chrome_web_icon: 'https://soumicrochet.store/assets/img/logo.png',
    firefox_icon: 'https://soumicrochet.store/assets/img/logo.png',
    isAnyWeb: true
  };

  if (Array.isArray(playerIds) && playerIds.length) {
    payload.include_subscription_ids = playerIds;
  } else {
    payload.included_segments = includedSegments || ['All'];
  }

  const response = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.id === '') {
    throw new Error(Array.isArray(data?.errors) ? data.errors.join(', ') : data?.errors || 'OneSignal push failed');
  }

  return data;
}

function initTrackPushModal() {
  qsa('[data-close-track-modal]').forEach((button) => {
    button.addEventListener('click', closeTrackModal);
  });

  $('trackPushForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const submitBtn = form.querySelector('button[type="submit"]');
    const status = $('trackPushStatus');

    const title = $('trackTitle')?.value.trim();
    const message = $('trackMessage')?.value.trim();
    const playerId = $('trackOneSignalUserId')?.value.trim();
    const url = $('trackUrl')?.value.trim() || 'https://soumicrochet.store/';
    const buttonText = $('trackButtonText')?.value.trim() || 'اطلب الآن';
    const originalText = submitBtn?.textContent || '';

    if (!title || !message || !playerId) {
      if (status) status.textContent = 'Client OneSignal introuvable.';
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Envoi...';
    }

    try {
      await sendOneSignalPush({ title, message, playerIds: [playerId], url, buttonText });
      const { error } = await client.from('notification_logs').insert({ title, message, target_segment: `${playerId} | CTA: ${url}` });
      if (error) dbError('Notification log', error);

      if (status) status.textContent = 'Notification envoyée avec succès.';
      setTimeout(() => {
        closeTrackModal();
        loadAll();
      }, 900);
    } catch (error) {
      dbError('OneSignal', error);
      if (status) status.textContent = 'Erreur pendant l’envoi.';
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
  });
}

function initTabs() {
  const buttons = qsa('.nav-tab, .tab-btn');
  const panels = qsa('.tab-panel, .tab');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      buttons.forEach((item) => item.classList.remove('active'));
      panels.forEach((panel) => panel.classList.remove('active'));

      btn.classList.add('active');
      $(`tab-${tab}`)?.classList.add('active');

      const title = btn.querySelector('strong')?.textContent?.trim() || btn.textContent.trim();
      if ($('pageTitle')) $('pageTitle').textContent = title;
      if ($('tabTitle')) $('tabTitle').textContent = title;

      $('sidebar')?.classList.remove('show');
    });
  });
}

function exportOrdersCSV() {
  const headers = ['created_at', 'customer_name', 'phone', 'city', 'address', 'product_name', 'price', 'status'];
  const lines = [headers.join(',')];

  state.orders.forEach((order) => {
    lines.push(headers.map((key) => `"${String(order[key] ?? '').replaceAll('"', '""')}"`).join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `soumi-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function deleteTableRows(table) {
  if (!table) return;
  if (!confirm('⚠️ Êtes-vous sûr de vouloir tout supprimer ?')) return;

  const { error } = await client.from(table).delete().not('id', 'is', null);
  if (error) {
    dbError(`Nettoyer ${table}`, error);
    return;
  }

  statusText(`Table ${table} nettoyée.`, 'ok');
  await loadAll();
}

function initEvents() {
  $('adminMenuToggle')?.addEventListener('click', () => $('sidebar')?.classList.toggle('show'));
  $('adminMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('show'));

  $('logoutBtn')?.addEventListener('click', async () => {
    await client.auth.signOut();
    location.href = 'login.html';
  });

  $('refreshBtn')?.addEventListener('click', loadAll);
  $('manualRefreshBtn')?.addEventListener('click', loadAll);
  $('requestNotificationsBtn')?.addEventListener('click', requestAdminNotificationPermission);
  $('exportOrdersBtn')?.addEventListener('click', exportOrdersCSV);

  $('clearPendingOrdersBtn')?.addEventListener('click', async () => {
    if (!confirm('Supprimer toutes les commandes pending/new ?')) return;
    const { error } = await client
      .from('orders')
      .delete()
      .in('status', ['pending', 'new']);
    if (error) dbError('Clear pending orders', error);
    await loadAll();
  });

  qsa('[data-clean-table], .clean-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteTableRows(btn.dataset.cleanTable || btn.dataset.clean));
  });

  $('openSegmentModalBtn')?.addEventListener('click', () => {
    populateSegmentList();
    setModalOpen('segmentModal', true);
  });

  qsa('[data-close-segment-modal]').forEach((el) => el.addEventListener('click', () => setModalOpen('segmentModal', false)));
  qsa('[data-close-order-modal]').forEach((el) => el.addEventListener('click', () => setModalOpen('orderModal', false)));
  qsa('[data-close-visitor-modal]').forEach((el) => el.addEventListener('click', () => setModalOpen('visitorModal', false)));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAnyOpenModal();
  });

  $('segmentSelectAll')?.addEventListener('change', (event) => {
    qsa('#segmentList input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
  });

  $('confirmSegmentSelection')?.addEventListener('click', () => {
    const ids = qsa('#segmentList input[type="checkbox"]:checked')
      .map((checkbox) => checkbox.value)
      .filter(Boolean);

    if ($('selectedSegmentIds')) $('selectedSegmentIds').value = ids.join(',');
    if ($('openSegmentModalBtn')) $('openSegmentModalBtn').textContent = ids.length ? `${ids.length} sélectionnés` : 'Choisir les destinataires';
    if ($('selectedSegmentLabel')) $('selectedSegmentLabel').textContent = ids.length ? `${ids.length} destinataire(s)` : 'Broadcast: All';

    setModalOpen('segmentModal', false);
  });

  $('notificationForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const title = $('notificationTitle')?.value.trim();
    const message = $('notificationMessage')?.value.trim();
    const url = $('notificationUrl')?.value.trim() || 'https://soumicrochet.store/';
    const buttonText = $('notificationButtonText')?.value.trim() || 'اطلب الآن';
    const status = $('notificationStatus');
    const selectedTargets = $('selectedSegmentIds')?.value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean) || [];

    const submitBtn = event.currentTarget.querySelector('button[type="submit"]');
    const originalText = submitBtn?.textContent || '';

    if (!title || !message) {
      if (status) status.textContent = 'Titre et message obligatoires.';
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Envoi...';
    }

    try {
      await sendOneSignalPush({
        title,
        message,
        playerIds: selectedTargets.length ? selectedTargets : null,
        includedSegments: selectedTargets.length ? null : ['All'],
        url,
        buttonText
      });

      const { error } = await client.from('notification_logs').insert({
        title,
        message,
        target_segment: selectedTargets.length ? `${selectedTargets.join(',')} | CTA: ${url}` : `All | CTA: ${url}`
      });

      if (error) dbError('Notification log', error);

      if (status) status.textContent = 'Push envoyé !';
      event.currentTarget.reset();

      if ($('selectedSegmentIds')) $('selectedSegmentIds').value = '';
      if ($('openSegmentModalBtn')) $('openSegmentModalBtn').textContent = 'Choisir les destinataires';
      if ($('selectedSegmentLabel')) $('selectedSegmentLabel').textContent = 'Broadcast: All';

      await loadAll();
    } catch (error) {
      dbError('Push notification', error);
      if (status) status.textContent = 'Erreur Push. Vérifiez la clé OneSignal et la console.';
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText || 'Envoyer notification';
      }
    }
  });
}

function debouncedLoadAll() {
  window.clearTimeout(debouncedLoadAll.timer);
  debouncedLoadAll.timer = window.setTimeout(loadAll, 450);
}

function initRealtime() {
  requestAdminNotificationPermission();

  const channel = client
    .channel('soumi-admin-live-v2')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
      if (payload.eventType === 'INSERT' && payload.new) {
        playNewOrderSound();
        notifyAdminNewOrder(payload.new);
        statusText('Nouvelle commande reçue.', 'ok');
      }
      debouncedLoadAll();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'analytics' }, debouncedLoadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, debouncedLoadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subscribers' }, debouncedLoadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_logs' }, debouncedLoadAll)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        state.realtimeReady = true;
        statusText('Realtime connecté.', 'ok', 2200);
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        state.realtimeReady = false;
        statusText('Realtime غير متصل، خدام polling backup.', 'error', 5200);
      }
    });

  state.pollTimer = window.setInterval(() => {
    if (!state.realtimeReady) loadAll();
  }, 12000);

  return channel;
}

async function init() {
  await requireAuth();
  await loadProductsCatalog();
  initTabs();
  initEvents();
  initTrackPushModal();
  await loadAll();
  initRealtime();
}

document.addEventListener('DOMContentLoaded', init);
