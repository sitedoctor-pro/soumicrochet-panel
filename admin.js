const $ = (id) => document.getElementById(id);
const SUPABASE_URL = 'https://axgcycsojorwztwlfprg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1YuKU9O3wuH1Zbikx_OonQ_ayCIjmSR';
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = { orders:[], reviews:[], analytics:[], visitors:[], subscribers:[], notifications:[] };
let visitsChart = null;
let revenueChart = null;

function escapeHTML(value){return String(value ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function money(value){return `${Number(value||0).toLocaleString('fr-MA')} DH`;}
function fmtDate(value){return value ? new Date(value).toLocaleString('fr-MA',{dateStyle:'short',timeStyle:'short'}) : '—';}
function todayISO(){return new Date().toISOString().slice(0,10);}
function isMobile(){return window.matchMedia('(max-width: 720px)').matches;}
function normalizePhone(phone){let p=String(phone||'').replace(/\s+/g,''); if(p.startsWith('0')) p='212'+p.slice(1); if(p.startsWith('+')) p=p.slice(1); return p;}
function productImageFromOrder(order){
  if(order.product_image_url) return order.product_image_url;
  const draft=state.analytics.find(a=>a.session_id&&a.session_id===order.session_id&&a.form_draft)?.form_draft;
  return draft?.selected_image || draft?.image || draft?.product_image_url || '';
}

async function requireSession(){
  const { data } = await client.auth.getSession();
  if(!data.session){ window.location.href='login.html'; return null; }
  return data.session;
}
async function loadOrders(){const {data,error}=await client.from('orders').select('*').order('created_at',{ascending:false}); if(error) throw error; state.orders=data||[]; renderOrders(); renderStats(); renderCharts();}
async function loadReviews(){const {data,error}=await client.from('reviews').select('*').order('created_at',{ascending:false}); if(error) throw error; state.reviews=data||[]; renderReviews();}
async function loadAnalytics(){const {data,error}=await client.from('analytics').select('*').order('created_at',{ascending:false}).limit(1500); if(error) throw error; state.analytics=data||[]; renderAnalytics(); renderStats(); renderCharts();}
async function loadVisitors(){
  const {data,error}=await client.from('visitors').select('*').order('last_seen',{ascending:false}).limit(1000);
  if(error){ console.warn('visitors table unavailable; falling back to analytics', error.message); state.visitors=[]; }
  else state.visitors=data||[];
  renderVisitors(); renderStats();
}
async function loadSubscribers(){const {data,error}=await client.from('subscribers').select('*').order('created_at',{ascending:false}).limit(1000); if(error) throw error; state.subscribers=data||[];}
async function loadNotifications(){const {data,error}=await client.from('notification_logs').select('*').order('sent_at',{ascending:false}).limit(500); if(error) throw error; state.notifications=data||[]; renderNotifications();}
async function loadAll(){try{await Promise.all([loadOrders(),loadReviews(),loadAnalytics(),loadVisitors(),loadSubscribers(),loadNotifications()]);}catch(err){console.error(err); alert(err.message || 'Erreur chargement dashboard');}}

function showTab(tab){
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===`${tab}Panel`));
  $('sidebar')?.classList.remove('show');
}

function statusOptions(current){
  const statuses=['pending','confirmed','processing','shipped','delivered','cancelled'];
  return `<select data-status-select>${statuses.map(s=>`<option value="${s}" ${s===current?'selected':''}>${s}</option>`).join('')}</select>`;
}

function renderStats(){
  const today=todayISO();
  const todaysVisitors = new Set([
    ...state.analytics.filter(a=>String(a.created_at||'').slice(0,10)===today && a.event_type==='visit').map(a=>a.session_id),
    ...state.visitors.filter(v=>String(v.last_seen||v.created_at||'').slice(0,10)===today).map(v=>v.session_id)
  ]).size;
  const revenue = state.orders.filter(o=>!['cancelled'].includes(o.status)).reduce((sum,o)=>sum+Number(o.price||0),0);
  const abandoned = getAbandonedCarts().length;
  if($('statTodayVisitors')) $('statTodayVisitors').textContent=todaysVisitors;
  if($('statRevenue')) $('statRevenue').textContent=money(revenue);
  if($('statOrders')) $('statOrders').textContent=state.orders.length;
  if($('statAbandoned')) $('statAbandoned').textContent=abandoned;
}

function renderOrders(){
  const wrap=$('ordersTableWrap'); if(!wrap) return;
  if(!state.orders.length){wrap.innerHTML='<div class="data-card"><strong>Aucune commande</strong><small>Les nouvelles commandes apparaîtront ici.</small></div>'; return;}
  if(isMobile()){
    wrap.innerHTML=state.orders.map(o=>`<article class="data-card mobile-order-card" data-order-id="${o.id}">
      <div class="mobile-order-summary"><strong>${escapeHTML(o.customer_name)}</strong><button class="action-btn" data-expand-order="${o.id}">Expand/View Details</button></div>
      <div class="mobile-order-details" id="mobile-order-${o.id}" hidden>
        ${renderOrderDetailsHTML(o)}
        <div class="row-actions"><button class="action-btn" data-confirm-contact="${o.id}">Confirm & Contact</button><a class="action-btn" href="tel:${escapeHTML(o.phone)}">Call</a><button class="action-btn danger" data-delete-order="${o.id}">Delete</button></div>
      </div>
    </article>`).join('');
  }else{
    wrap.innerHTML=`<table><thead><tr><th>Date</th><th>Client</th><th>Produit</th><th>Prix</th><th>Ville</th><th>Status</th><th>Actions</th></tr></thead><tbody>${state.orders.map(o=>`<tr data-order-id="${o.id}">
      <td data-label="Date">${fmtDate(o.created_at)}</td><td data-label="Client"><strong>${escapeHTML(o.customer_name)}</strong><br><small>${escapeHTML(o.phone)}</small></td>
      <td data-label="Produit">${escapeHTML(o.product_name)}<br><small>${escapeHTML(o.product_id)}</small></td><td data-label="Prix">${money(o.price)}</td><td data-label="Ville">${escapeHTML(o.city)}</td><td data-label="Status">${statusOptions(o.status)}</td>
      <td data-label="Actions"><div class="row-actions"><button class="action-btn" data-view-order="${o.id}">View Details</button><button class="action-btn" data-confirm-contact="${o.id}">Confirm & Contact</button><button class="action-btn danger" data-delete-order="${o.id}">Delete</button></div></td>
    </tr>`).join('')}</tbody></table>`;
  }
  bindOrderActions(wrap);
}

function renderOrderDetailsHTML(o){
  const img=productImageFromOrder(o);
  return `<div class="order-detail-block">${img?`<img class="order-product-thumb" src="${escapeHTML(img)}" alt="${escapeHTML(o.product_name)}" />`:''}<dl class="detail-grid">
    <dt>Phone</dt><dd><a href="tel:${escapeHTML(o.phone)}">${escapeHTML(o.phone)}</a></dd><dt>City</dt><dd>${escapeHTML(o.city)}</dd><dt>Address</dt><dd>${escapeHTML(o.address)}</dd><dt>Product</dt><dd>${escapeHTML(o.product_name)}</dd><dt>Price</dt><dd>${money(o.price)}</dd><dt>Status</dt><dd>${escapeHTML(o.status)}</dd><dt>OneSignal</dt><dd>${escapeHTML(o.onesignal_user_id||'—')}</dd></dl></div>`;
}
function bindOrderActions(scope){
  scope.querySelectorAll('[data-status-select]').forEach(s=>s.addEventListener('change',async e=>{const id=e.target.closest('[data-order-id]').dataset.orderId; const {error}=await client.from('orders').update({status:e.target.value}).eq('id',id); if(error) alert(error.message); await loadOrders();}));
  scope.querySelectorAll('[data-view-order]').forEach(b=>b.addEventListener('click',()=>viewOrder(b.dataset.viewOrder)));
  scope.querySelectorAll('[data-expand-order]').forEach(b=>b.addEventListener('click',()=>{const box=$(`mobile-order-${b.dataset.expandOrder}`); if(box) box.hidden=!box.hidden;}));
  scope.querySelectorAll('[data-delete-order]').forEach(b=>b.addEventListener('click',()=>deleteOrder(b.dataset.deleteOrder)));
  scope.querySelectorAll('[data-confirm-contact]').forEach(b=>b.addEventListener('click',()=>confirmAndContact(b.dataset.confirmContact)));
}
function viewOrder(id){const o=state.orders.find(x=>x.id===id); if(!o) return; $('detailContent').innerHTML=`<span class="eyebrow">ORDER DETAILS</span><h2>${escapeHTML(o.product_name)}</h2>${renderOrderDetailsHTML(o)}<div class="row-actions"><button class="action-btn" data-confirm-contact="${o.id}">Confirm & Contact</button><button class="action-btn danger" data-delete-order="${o.id}">Delete</button></div>`; $('detailModal').classList.add('show'); $('detailModal').setAttribute('aria-hidden','false'); bindOrderActions($('detailContent'));}
async function deleteOrder(id){if(!confirm('Supprimer cette commande ?')) return; const {error}=await client.from('orders').delete().eq('id',id); if(error){alert(error.message);return;} await loadOrders();}
async function clearOrders(){if(!confirm('Supprimer les commandes pending/cancelled de plus de 7 jours ?')) return; const cutoff=new Date(Date.now()-7*24*3600*1000).toISOString(); const {error}=await client.from('orders').delete().in('status',['pending','cancelled']).lt('created_at',cutoff); if(error){alert(error.message);return;} await loadOrders();}
async function confirmAndContact(id){
  const o=state.orders.find(x=>x.id===id); if(!o) return;
  await client.from('orders').update({status:'confirmed'}).eq('id',id);
  if(o.onesignal_user_id) await sendTargetedPush(o.onesignal_user_id,'Soumi Crochet','Votre commande a été confirmée. Nous vous contacterons pour la livraison.');
  if(o.phone){const msg=encodeURIComponent(`سلام ${o.customer_name || ''}، تم تأكيد طلبك من Soumi Crochet: ${o.product_name}. بغينا ننسقو معاك التوصيل.`); window.open(`https://wa.me/${normalizePhone(o.phone)}?text=${msg}`,'_blank','noopener');}
  await loadOrders();
}

async function sendTargetedPush(playerIds,title,message){
  const target = Array.isArray(playerIds) ? playerIds.join(',') : String(playerIds||'');
  await client.from('notification_logs').insert({title,message,target_segment:target});
  try{ await client.functions.invoke('send-push', { body:{ player_ids:target.split(',').filter(Boolean), title, message } }); }catch(err){ console.warn('Push function not configured; notification log saved only.', err); }
}

function renderReviews(){
  const wrap=$('reviewsTableWrap'); if(!wrap) return;
  wrap.innerHTML=state.reviews.length?`<table><thead><tr><th>Date</th><th>Client</th><th>Rating</th><th>Avis</th><th>Publié</th><th>Actions</th></tr></thead><tbody>${state.reviews.map(r=>`<tr data-review-id="${r.id}"><td>${fmtDate(r.created_at)}</td><td><strong>${escapeHTML(r.reviewer_name)}</strong><br><small>${escapeHTML(r.phone)} · ${escapeHTML(r.city)}</small></td><td>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</td><td>${escapeHTML(r.review_text)}</td><td><span class="badge">${r.is_published?'Oui':'Non'}</span></td><td><div class="row-actions"><button class="action-btn" data-approve-review="${r.id}">${r.is_published?'Masquer':'Approuver'}</button><button class="action-btn danger" data-delete-review="${r.id}">Delete</button></div></td></tr>`).join('')}</tbody></table>`:'<div class="data-card"><strong>Aucun avis</strong></div>';
  wrap.querySelectorAll('[data-approve-review]').forEach(b=>b.addEventListener('click',async()=>{const r=state.reviews.find(x=>x.id===b.dataset.approveReview); const {error}=await client.from('reviews').update({is_published:!r.is_published}).eq('id',r.id); if(error) alert(error.message); await loadReviews();}));
  wrap.querySelectorAll('[data-delete-review]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Supprimer cet avis ?')) return; const {error}=await client.from('reviews').delete().eq('id',b.dataset.deleteReview); if(error) alert(error.message); await loadReviews();}));
}
function getAbandonedCarts(){const ordered=new Set(state.orders.map(o=>o.session_id).filter(Boolean)); const drafts=new Map(); state.analytics.filter(a=>a.form_draft&&a.session_id&&!ordered.has(a.session_id)).forEach(a=>{if(!drafts.has(a.session_id)) drafts.set(a.session_id,a);}); return [...drafts.values()];}
function renderAnalytics(){
  const activity=state.analytics.slice(0,20); const abandoned=getAbandonedCarts();
  if($('activityList')) $('activityList').innerHTML=activity.length?activity.map(a=>`<article class="data-card"><strong>${escapeHTML(a.event_type)} · ${escapeHTML(a.city||'Unknown')}</strong><small>${fmtDate(a.created_at)} · ${escapeHTML(a.session_id)}</small><small>${escapeHTML(a.page_url)}</small></article>`).join(''):'<div class="data-card"><strong>Aucune activité</strong></div>';
  if($('abandonedList')) $('abandonedList').innerHTML=abandoned.length?abandoned.map(a=>{const d=a.form_draft||{};return `<article class="data-card"><strong>${escapeHTML(d.customer_name||'Client sans nom')} · ${escapeHTML(d.phone||'phone pending')}</strong><small>${escapeHTML(d.product_name||d.product_id||'—')} · ${escapeHTML(d.price||'—')} DH</small><small>${escapeHTML(d.city||a.city||'—')} · ${fmtDate(a.created_at)}</small></article>`;}).join(''):'<div class="data-card"><strong>Aucun panier abandonné</strong></div>';
}
function renderVisitors(){
  const list=$('visitorsList'); if(!list) return;
  const source=state.visitors.length?state.visitors:state.analytics.filter(a=>a.event_type==='visit').map(a=>({session_id:a.session_id,city:a.city,ip_address:a.ip_address,page_url:a.page_url,last_seen:a.created_at,onesignal_user_id:a.onesignal_user_id,activity_history:[]}));
  list.innerHTML=source.length?source.map(v=>`<article class="data-card"><div class="mobile-order-summary"><strong>${escapeHTML(v.city||'Unknown city')} · ${escapeHTML(v.session_id)}</strong><button class="action-btn" data-notify-visitor="${escapeHTML(v.onesignal_user_id||'')}">Notify</button></div><small>IP: ${escapeHTML(v.ip_address||'—')} · Last seen: ${fmtDate(v.last_seen||v.created_at)}</small><small>Page: ${escapeHTML(v.page_url||'—')}</small><small>OneSignal: ${escapeHTML(v.onesignal_user_id||'not subscribed')}</small></article>`).join(''):'<div class="data-card"><strong>Aucun visiteur</strong></div>';
  list.querySelectorAll('[data-notify-visitor]').forEach(b=>b.addEventListener('click',async()=>{const id=b.dataset.notifyVisitor; if(!id){alert('Ce visiteur n’a pas encore activé les notifications.'); return;} await sendTargetedPush(id,'Soumi Crochet','Nouveau message de Soumi Crochet. Découvrez nos derniers modèles.'); alert('Notification log enregistrée.'); await loadNotifications();}));
}
function renderNotifications(){const wrap=$('notificationsTableWrap'); if(!wrap) return; wrap.innerHTML=state.notifications.length?`<table><thead><tr><th>Date</th><th>Titre</th><th>Message</th><th>Segment</th></tr></thead><tbody>${state.notifications.map(n=>`<tr><td>${fmtDate(n.sent_at)}</td><td>${escapeHTML(n.title)}</td><td>${escapeHTML(n.message)}</td><td>${escapeHTML(n.target_segment)}</td></tr>`).join('')}</tbody></table>`:'<div class="data-card"><strong>Aucun log notification</strong></div>';}
function renderCharts(){
  if(!window.Chart) return;
  const days=[...Array(7)].map((_,i)=>{const d=new Date(Date.now()-(6-i)*86400000); return d.toISOString().slice(0,10);});
  const visits=days.map(day=>new Set(state.analytics.filter(a=>String(a.created_at||'').slice(0,10)===day&&a.event_type==='visit').map(a=>a.session_id)).size);
  const revenue=days.map(day=>state.orders.filter(o=>String(o.created_at||'').slice(0,10)===day&&!['cancelled'].includes(o.status)).reduce((s,o)=>s+Number(o.price||0),0));
  const vc=$('visitsChart'), rc=$('revenueChart');
  if(vc){ if(visitsChart) visitsChart.destroy(); visitsChart=new Chart(vc,{type:'line',data:{labels:days,datasets:[{label:'Visits',data:visits,tension:.35}]},options:{responsive:true,plugins:{legend:{display:false}}}}); }
  if(rc){ if(revenueChart) revenueChart.destroy(); revenueChart=new Chart(rc,{type:'bar',data:{labels:days,datasets:[{label:'Revenue',data:revenue}]},options:{responsive:true,plugins:{legend:{display:false}}}}); }
}
function exportOrdersCSV(){const headers=['created_at','customer_name','phone','city','address','product_id','product_name','price','status','session_id','onesignal_user_id']; const rows=state.orders.map(o=>headers.map(h=>`"${String(o[h]??'').replace(/"/g,'""')}"`).join(',')); const blob=new Blob([[headers.join(','),...rows].join('\n')],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`soumi-orders-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(url);}
function openSegmentModal(){renderSegmentList(); $('segmentModal')?.classList.add('show'); $('segmentModal')?.setAttribute('aria-hidden','false');}
function closeSegmentModal(){ $('segmentModal')?.classList.remove('show'); $('segmentModal')?.setAttribute('aria-hidden','true');}
function renderSegmentList(){const list=$('segmentList'); if(!list) return; const selected=new Set(String($('notifSegment')?.value||'').split(',').map(x=>x.trim()).filter(Boolean)); list.innerHTML=state.subscribers.length?state.subscribers.map(s=>`<label class="segment-row"><input class="segment-checkbox" type="checkbox" value="${escapeHTML(s.onesignal_player_id)}" ${selected.has(s.onesignal_player_id)||selected.has('All Subscribers')?'checked':''}/><span><strong>${escapeHTML(s.city||'Unknown city')}</strong><small>${escapeHTML(s.onesignal_player_id)} · ${escapeHTML(JSON.stringify(s.device_info||{}).slice(0,120))}</small></span></label>`).join(''):'<div class="data-card"><strong>Aucun abonné</strong></div>';}
function confirmSegmentSelection(){const ids=[...document.querySelectorAll('.segment-checkbox:checked')].map(x=>x.value); const value=ids.length&&ids.length<state.subscribers.length?ids.join(','):'All Subscribers'; $('notifSegment').value=value; $('selectedSegmentLabel').textContent=value==='All Subscribers'?'All Subscribers':`${ids.length} destinataire(s)`; closeSegmentModal();}
function initEvents(){
  document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
  $('adminMenuToggle')?.addEventListener('click',()=>$('sidebar')?.classList.toggle('show'));
  $('refreshBtn')?.addEventListener('click',loadAll); $('exportOrders')?.addEventListener('click',exportOrdersCSV); $('clearOrders')?.addEventListener('click',clearOrders);
  $('closeDetail')?.addEventListener('click',()=>$('detailModal')?.classList.remove('show')); $('detailModal')?.addEventListener('click',e=>{if(e.target.classList.contains('modal-mask')) $('detailModal')?.classList.remove('show');});
  $('logoutBtn')?.addEventListener('click',async()=>{await client.auth.signOut(); window.location.href='login.html';});
  $('openSegmentModalBtn')?.addEventListener('click',openSegmentModal); $('closeSegmentModal')?.addEventListener('click',closeSegmentModal); $('cancelSegmentSelection')?.addEventListener('click',closeSegmentModal); $('segmentModal')?.addEventListener('click',e=>{if(e.target.classList.contains('modal-mask')) closeSegmentModal();}); $('segmentSelectAll')?.addEventListener('change',e=>document.querySelectorAll('.segment-checkbox').forEach(x=>x.checked=e.target.checked)); $('confirmSegmentSelection')?.addEventListener('click',confirmSegmentSelection);
  $('notificationLogForm')?.addEventListener('submit',async e=>{e.preventDefault(); const title=$('notifTitle').value.trim(), message=$('notifMessage').value.trim(), segment=$('notifSegment').value.trim()||'All Subscribers'; await sendTargetedPush(segment==='All Subscribers'?state.subscribers.map(s=>s.onesignal_player_id):segment.split(','),title,message); e.target.reset(); $('notifSegment').value='All Subscribers'; $('selectedSegmentLabel').textContent='All Subscribers'; await loadNotifications(); alert('Notification enregistrée.');});
  window.addEventListener('resize',()=>renderOrders());
  client.channel('soumi-admin-realtime').on('postgres_changes',{event:'*',schema:'public',table:'orders'},loadOrders).on('postgres_changes',{event:'*',schema:'public',table:'reviews'},loadReviews).on('postgres_changes',{event:'*',schema:'public',table:'analytics'},loadAnalytics).on('postgres_changes',{event:'*',schema:'public',table:'visitors'},loadVisitors).subscribe();
}
async function init(){const session=await requireSession(); if(!session) return; initEvents(); await loadAll();}
document.addEventListener('DOMContentLoaded',init);
