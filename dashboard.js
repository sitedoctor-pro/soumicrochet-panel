const SUPABASE_URL = 'https://axgcycsojorwztwlfprg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1YuKU9O3wuH1Zbikx_OonQ_ayCIjmSR';
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const state = {
  orders: [],
  reviews: [],
  analytics: [],
  notifications: [],
  subscribers: [],
  currentTab: 'orders'
};

function fmtDate(value){
  if(!value) return '—';
  return new Intl.DateTimeFormat('fr-MA', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value));
}

function money(value){ return `${Number(value || 0).toFixed(0)} DH`; }

function escapeHTML(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[ch]));
}

function statusOptions(current){
  const options = ['pending','confirmed','shipped','delivered','cancelled'];
  return `<select data-status-select>${options.map(s => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
}

async function requireSession(){
  const { data } = await client.auth.getSession();
  if(!data.session){
    window.location.href = 'login.html';
    return null;
  }
  return data.session;
}

function showTab(tab){
  state.currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${tab}Panel`));
  $('sidebar')?.classList.remove('show');
}

async function loadAll(){
  await Promise.all([loadOrders(), loadReviews(), loadAnalytics(), loadNotifications(), loadSubscribers()]);
  renderStats();
}

async function loadOrders(){
  const { data, error } = await client.from('orders').select('*').order('created_at', { ascending:false }).limit(500);
  if(error){ console.error(error); return; }
  state.orders = data || [];
  renderOrders();
}

async function loadReviews(){
  const { data, error } = await client.from('reviews').select('*').order('created_at', { ascending:false }).limit(500);
  if(error){ console.error(error); return; }
  state.reviews = data || [];
  renderReviews();
}

async function loadAnalytics(){
  const { data, error } = await client.from('analytics').select('*').order('created_at', { ascending:false }).limit(1000);
  if(error){ console.error(error); return; }
  state.analytics = data || [];
  renderAnalytics();
}

async function loadNotifications(){
  const { data, error } = await client.from('notification_logs').select('*').order('sent_at', { ascending:false }).limit(200);
  if(error){ console.error(error); return; }
  state.notifications = data || [];
  renderNotifications();
}

async function loadSubscribers(){
  const { data, error } = await client.from('subscribers').select('*').order('created_at', { ascending:false }).limit(1000);
  if(error){ console.error(error); return; }
  state.subscribers = data || [];
  renderSegmentList();
}


function deviceInfoText(deviceInfo){
  if(!deviceInfo) return 'Unknown device';
  if(typeof deviceInfo === 'string') return deviceInfo;
  const platform = deviceInfo.platform || deviceInfo.device || 'web';
  const lang = deviceInfo.language ? ` · ${deviceInfo.language}` : '';
  const ua = deviceInfo.user_agent ? ` · ${String(deviceInfo.user_agent).slice(0, 70)}` : '';
  return `${platform}${lang}${ua}`;
}

function openSegmentModal(){
  renderSegmentList();
  $('segmentModal')?.classList.add('show');
  $('segmentModal')?.setAttribute('aria-hidden','false');
}

function closeSegmentModal(){
  $('segmentModal')?.classList.remove('show');
  $('segmentModal')?.setAttribute('aria-hidden','true');
}

function renderSegmentList(){
  const list = $('segmentList');
  if(!list) return;
  if(!state.subscribers.length){
    list.innerHTML = '<div class="data-card"><strong>Aucun abonné push</strong><small>Les appareils abonnés apparaîtront ici.</small></div>';
    return;
  }
  const selected = new Set(($('notifSegment')?.value || '').split(',').map(x => x.trim()).filter(Boolean));
  const allSelected = selected.has('All Subscribers');
  list.innerHTML = state.subscribers.map(sub => {
    const id = escapeHTML(sub.onesignal_player_id || '');
    const checked = allSelected || selected.has(sub.onesignal_player_id) ? 'checked' : '';
    return `<label class="segment-row data-card">
      <input type="checkbox" class="segment-checkbox" value="${id}" ${checked} />
      <span><strong>${escapeHTML(sub.city || 'Ville inconnue')}</strong><small>${escapeHTML(deviceInfoText(sub.device_info))}</small><small>${id}</small></span>
    </label>`;
  }).join('');
  const selectAll = $('segmentSelectAll');
  if(selectAll) selectAll.checked = allSelected || state.subscribers.every(s => selected.has(s.onesignal_player_id));
}

function confirmSegmentSelection(){
  const boxes = Array.from(document.querySelectorAll('.segment-checkbox'));
  const ids = boxes.filter(b => b.checked).map(b => b.value).filter(Boolean);
  const value = ids.length && ids.length < state.subscribers.length ? ids.join(',') : 'All Subscribers';
  if($('notifSegment')) $('notifSegment').value = value;
  if($('selectedSegmentLabel')) $('selectedSegmentLabel').textContent = value === 'All Subscribers' ? 'All Subscribers' : `${ids.length} destinataire(s) sélectionné(s)`;
  closeSegmentModal();
}

function renderStats(){
  const pending = state.orders.filter(o => o.status === 'pending').length;
  const visits = state.analytics.filter(a => a.event_type === 'visit').length;
  const abandoned = getAbandonedCarts().length;
  $('statOrders').textContent = state.orders.length;
  $('statPending').textContent = pending;
  $('statVisits').textContent = visits;
  $('statAbandoned').textContent = abandoned;
}

function renderOrders(){
  const wrap = $('ordersTableWrap');
  if(!wrap) return;
  if(!state.orders.length){
    wrap.innerHTML = '<div class="data-card"><strong>Aucune commande</strong><small>Les nouvelles commandes apparaîtront ici.</small></div>';
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr><th>Date</th><th>Client</th><th>Produit</th><th>Prix</th><th>Ville</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${state.orders.map(order => `<tr data-order-id="${order.id}">
      <td data-label="Date">${fmtDate(order.created_at)}</td>
      <td data-label="Client"><strong>${escapeHTML(order.customer_name)}</strong><br><small>${escapeHTML(order.phone)}</small></td>
      <td data-label="Produit">${escapeHTML(order.product_name)}<br><small>${escapeHTML(order.product_id)}</small></td>
      <td data-label="Prix">${money(order.price)}</td>
      <td data-label="Ville">${escapeHTML(order.city)}</td>
      <td data-label="Status">${statusOptions(order.status)}</td>
      <td data-label="Actions">
        <div class="row-actions">
          <button class="action-btn" data-view-order="${order.id}">Details</button>
          <a class="action-btn" href="tel:${escapeHTML(order.phone)}">Call Customer</a>
        </div>
      </td>
    </tr>`).join('')}</tbody>
  </table>`;

  wrap.querySelectorAll('[data-status-select]').forEach(select => {
    select.addEventListener('change', async (e) => {
      const id = e.target.closest('tr').dataset.orderId;
      const { error } = await client.from('orders').update({ status:e.target.value }).eq('id', id);
      if(error){ alert(error.message); }
      await loadOrders();
    });
  });
  wrap.querySelectorAll('[data-view-order]').forEach(btn => btn.addEventListener('click', () => viewOrder(btn.dataset.viewOrder)));
}

function viewOrder(id){
  const order = state.orders.find(o => o.id === id);
  if(!order) return;
  $('detailContent').innerHTML = `<span class="eyebrow">ORDER DETAILS</span><h2>${escapeHTML(order.product_name)}</h2>
    <dl class="detail-grid">
      <dt>Client</dt><dd>${escapeHTML(order.customer_name)}</dd>
      <dt>Phone</dt><dd><a href="tel:${escapeHTML(order.phone)}">${escapeHTML(order.phone)}</a></dd>
      <dt>City</dt><dd>${escapeHTML(order.city)}</dd>
      <dt>Address</dt><dd>${escapeHTML(order.address)}</dd>
      <dt>Price</dt><dd>${money(order.price)}</dd>
      <dt>Status</dt><dd>${escapeHTML(order.status)}</dd>
      <dt>Session ID</dt><dd>${escapeHTML(order.session_id)}</dd>
      <dt>OneSignal ID</dt><dd>${escapeHTML(order.onesignal_user_id)}</dd>
      <dt>Created</dt><dd>${fmtDate(order.created_at)}</dd>
    </dl>`;
  $('detailModal').classList.add('show');
  $('detailModal').setAttribute('aria-hidden','false');
}

function renderReviews(){
  const wrap = $('reviewsTableWrap');
  if(!wrap) return;
  if(!state.reviews.length){
    wrap.innerHTML = '<div class="data-card"><strong>Aucun avis</strong><small>Les avis clients apparaîtront ici.</small></div>';
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr><th>Date</th><th>Client</th><th>Rating</th><th>Avis</th><th>Publié</th><th>Actions</th></tr></thead>
    <tbody>${state.reviews.map(review => `<tr data-review-id="${review.id}">
      <td data-label="Date">${fmtDate(review.created_at)}</td>
      <td data-label="Client"><strong>${escapeHTML(review.reviewer_name)}</strong><br><small>${escapeHTML(review.phone)} · ${escapeHTML(review.city)}</small></td>
      <td data-label="Rating">${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)}</td>
      <td data-label="Avis">${escapeHTML(review.review_text)}</td>
      <td data-label="Publié"><span class="badge">${review.is_published ? 'Oui' : 'Non'}</span></td>
      <td data-label="Actions"><div class="row-actions">
        <button class="action-btn" data-approve-review="${review.id}">${review.is_published ? 'Masquer' : 'Approuver'}</button>
        <button class="action-btn danger" data-delete-review="${review.id}">Delete</button>
      </div></td>
    </tr>`).join('')}</tbody>
  </table>`;

  wrap.querySelectorAll('[data-approve-review]').forEach(btn => btn.addEventListener('click', async () => {
    const review = state.reviews.find(r => r.id === btn.dataset.approveReview);
    const { error } = await client.from('reviews').update({ is_published: !review.is_published }).eq('id', review.id);
    if(error) alert(error.message);
    await loadReviews();
  }));
  wrap.querySelectorAll('[data-delete-review]').forEach(btn => btn.addEventListener('click', async () => {
    if(!confirm('Supprimer cet avis ?')) return;
    const { error } = await client.from('reviews').delete().eq('id', btn.dataset.deleteReview);
    if(error) alert(error.message);
    await loadReviews();
  }));
}

function getAbandonedCarts(){
  const orderedSessions = new Set(state.orders.map(o => o.session_id).filter(Boolean));
  const draftsBySession = new Map();
  state.analytics
    .filter(a => a.form_draft && a.session_id && !orderedSessions.has(a.session_id))
    .forEach(a => {
      if(!draftsBySession.has(a.session_id)) draftsBySession.set(a.session_id, a);
    });
  return Array.from(draftsBySession.values());
}

function renderAnalytics(){
  const visitors = state.analytics.filter(a => a.event_type === 'visit').slice(0, 25);
  const abandoned = getAbandonedCarts();

  $('visitorsList').innerHTML = visitors.length ? visitors.map(v => `<article class="data-card">
    <strong>${escapeHTML(v.city || 'Unknown city')} · ${escapeHTML(v.session_id)}</strong>
    <small>${fmtDate(v.created_at)} · ${escapeHTML(v.page_url)}</small>
    <small>Time spent: ${Number(v.time_spent_seconds || 0)}s · OneSignal: ${escapeHTML(v.onesignal_user_id)}</small>
  </article>`).join('') : '<div class="data-card"><strong>Aucune visite</strong></div>';

  $('abandonedList').innerHTML = abandoned.length ? abandoned.map(a => {
    const d = a.form_draft || {};
    return `<article class="data-card">
      <strong>${escapeHTML(d.customer_name || 'Client sans nom')} · ${escapeHTML(d.phone || 'phone pending')}</strong>
      <small>Produit: ${escapeHTML(d.product_name || d.product_id || '—')} · Prix: ${escapeHTML(d.price || '—')} DH</small>
      <small>Ville: ${escapeHTML(d.city || '—')} · Adresse: ${escapeHTML(d.address || '—')}</small>
      <small>Session: ${escapeHTML(a.session_id)} · ${fmtDate(a.created_at)}</small>
    </article>`;
  }).join('') : '<div class="data-card"><strong>Aucun panier abandonné</strong></div>';
  renderStats();
}

function renderNotifications(){
  const wrap = $('notificationsTableWrap');
  if(!wrap) return;
  wrap.innerHTML = state.notifications.length ? `<table>
    <thead><tr><th>Date</th><th>Titre</th><th>Message</th><th>Segment</th></tr></thead>
    <tbody>${state.notifications.map(n => `<tr>
      <td data-label="Date">${fmtDate(n.sent_at)}</td>
      <td data-label="Titre">${escapeHTML(n.title)}</td>
      <td data-label="Message">${escapeHTML(n.message)}</td>
      <td data-label="Segment">${escapeHTML(n.target_segment)}</td>
    </tr>`).join('')}</tbody>
  </table>` : '<div class="data-card"><strong>Aucun log notification</strong></div>';
}

function exportOrdersCSV(){
  const headers = ['created_at','customer_name','phone','city','address','product_id','product_name','price','status','session_id','onesignal_user_id'];
  const rows = state.orders.map(o => headers.map(h => `"${String(o[h] ?? '').replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `soumi-orders-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function initEvents(){
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  $('adminMenuToggle')?.addEventListener('click', () => $('sidebar')?.classList.toggle('show'));
  $('refreshBtn')?.addEventListener('click', loadAll);
  $('exportOrders')?.addEventListener('click', exportOrdersCSV);
  $('closeDetail')?.addEventListener('click', () => $('detailModal')?.classList.remove('show'));
  $('detailModal')?.addEventListener('click', (e) => { if(e.target.classList.contains('modal-mask')) $('detailModal')?.classList.remove('show'); });
  $('logoutBtn')?.addEventListener('click', async () => {
    await client.auth.signOut();
    window.location.href = 'login.html';
  });

  $('openSegmentModalBtn')?.addEventListener('click', openSegmentModal);
  $('closeSegmentModal')?.addEventListener('click', closeSegmentModal);
  $('cancelSegmentSelection')?.addEventListener('click', closeSegmentModal);
  $('segmentModal')?.addEventListener('click', (e) => { if(e.target.classList.contains('modal-mask')) closeSegmentModal(); });
  $('segmentSelectAll')?.addEventListener('change', (e) => {
    document.querySelectorAll('.segment-checkbox').forEach(box => { box.checked = e.target.checked; });
  });
  $('confirmSegmentSelection')?.addEventListener('click', confirmSegmentSelection);

  $('notificationLogForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await client.from('notification_logs').insert({
      title: $('notifTitle').value.trim(),
      message: $('notifMessage').value.trim(),
      target_segment: $('notifSegment').value.trim() || 'All Subscribers'
    });
    if(error){ alert(error.message); return; }
    e.target.reset();
    $('notifSegment').value = 'All Subscribers';
    if($('selectedSegmentLabel')) $('selectedSegmentLabel').textContent = 'All Subscribers';
    await loadNotifications();
  });

  const channel = client
    .channel('soumi-admin-realtime')
    .on('postgres_changes', { event:'*', schema:'public', table:'orders' }, loadOrders)
    .on('postgres_changes', { event:'*', schema:'public', table:'reviews' }, loadReviews)
    .on('postgres_changes', { event:'*', schema:'public', table:'analytics' }, loadAnalytics)
    .subscribe();
}

async function init(){
  const session = await requireSession();
  if(!session) return;
  initEvents();
  await loadAll();
}
document.addEventListener('DOMContentLoaded', init);
