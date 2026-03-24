/**
 * ================================================================
 * app.js — Unified Response Hub Frontend
 * ================================================================
 * Gestiona:
 *  - Carga y renderizado de conversaciones desde la API REST
 *  - Comunicación WebSocket en tiempo real con el backend
 *  - UI de chat: mensajes, respuestas rápidas, resolver, transferir
 *  - Notificaciones toast
 *  - Panel de información del cliente
 * ================================================================
 */

// ─── Config ───────────────────────────────────────────────────
const API_BASE = '';            // misma origen cuando sirve Node
const WS_URL   = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const AGENT_ID = 'agent-' + Math.random().toString(36).slice(2, 8);
const AGENT_NAME = 'Agente Hub';

const QUICK_REPLIES = [
  { label: '👋 Saludo inicial',   text: 'Hola, soy el agente. ¿En qué puedo ayudarte?' },
  { label: '🔍 Revisando caso',   text: 'Entiendo, déjame revisar tu caso un momento...' },
  { label: '📋 Solicitar datos',  text: '¿Podrías proporcionarme tu número de cuenta o pedido?' },
  { label: '⏱ Espera',           text: 'Un momento, estoy consultando con el equipo...' },
  { label: '✅ Resolver',         text: 'Gracias por tu paciencia. Hemos resuelto tu consulta. ¿Hay algo más en lo que pueda ayudarte?' },
  { label: '📞 Llamada',         text: 'Si lo prefieres, podemos hablar por teléfono. ¿Te va bien ahora?' },
];

// ─── Estado ───────────────────────────────────────────────────
let conversations   = [];
let activeConvId    = null;
let ws              = null;
let wsReconnectTimer = null;
let currentFilter   = 'all';
let resolvedCount   = 0;
let searchQuery     = '';

// ─── Elementos DOM ────────────────────────────────────────────
const $ = id => document.getElementById(id);
const convList      = $('convList');
const queueCount    = $('queueCount');
const emptyState    = $('emptyState');
const chatView      = $('chatView');
const messagesArea  = $('messagesArea');
const msgInput      = $('msgInput');
const sendBtn       = $('sendBtn');
const resolveBtn    = $('resolveBtn');
const transferBtn   = $('transferBtn');
const notesBtn      = $('notesBtn');
const rightPanel    = $('rightPanel');
const qrPanel       = $('qrPanel');
const transferModal = $('transferModal');

// ─── Inicialización ───────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadConversations();
  connectWebSocket();
  bindEvents();
  renderQuickReplies();
  initToastContainer();
  setInterval(loadStats, 10000);
  setInterval(updateElapsedTimes, 30000);
});

// ─── API ──────────────────────────────────────────────────────
async function loadConversations() {
  try {
    const res = await fetch(`${API_BASE}/api/conversations`);
    conversations = await res.json();
    renderConvList();
    loadStats();
  } catch (err) {
    convList.innerHTML = '<div class="loading-state">Error al cargar. Reintentando...</div>';
    setTimeout(loadConversations, 3000);
  }
}

async function loadStats() {
  try {
    const res = await fetch(`${API_BASE}/api/conversations/stats`);
    const stats = await res.json();
    $('stat-active').textContent  = stats.active  || 0;
    $('stat-pending').textContent = stats.pending || 0;
    $('stat-resolved').textContent = (stats.resolved || 0) + resolvedCount;
  } catch (_) {}
}

async function sendAgentMessage(convId, text) {
  // Primero por WS (tiempo real), fallback a REST
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type:           'agent.message',
      conversationId: convId,
      agentId:        AGENT_ID,
      agentName:      AGENT_NAME,
      text
    }));
  } else {
    await fetch(`${API_BASE}/api/conversations/${convId}/messages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ role: 'agent', text })
    });
  }
}

async function resolveConversation(convId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type:           'conversation.resolve',
      conversationId: convId,
      agentId:        AGENT_ID
    }));
  } else {
    await fetch(`${API_BASE}/api/conversations/${convId}/status`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: 'resolved', agentId: AGENT_ID })
    });
  }
}

async function transferConversation(convId, target, note) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type:           'conversation.transfer',
      conversationId: convId,
      toAgentId:      target,
      note
    }));
  }
}

async function testBot(text) {
  const res = await fetch(`${API_BASE}/api/messages/test`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ userId: 'test-user', text, channel: 'web' })
  });
  const data = await res.json();
  return data.reply;
}

// ─── WebSocket ────────────────────────────────────────────────
function connectWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[WS] Conectado');
    setWsStatus('connected');
    clearTimeout(wsReconnectTimer);
    ws.send(JSON.stringify({ type: 'agent.join', agentId: AGENT_ID, agentName: AGENT_NAME }));
  };

  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    handleWsEvent(data);
  };

  ws.onclose = () => {
    console.log('[WS] Desconectado — reconectando en 3s');
    setWsStatus('error');
    wsReconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => setWsStatus('error');
}

function handleWsEvent(data) {
  switch (data.type) {

    case 'message.new': {
      // Añadir mensaje a la conversación en memoria
      const conv = conversations.find(c => c.id === data.conversationId);
      if (conv) {
        conv.messages = conv.messages || [];
        conv.messages.push(data.message);
        conv.updatedAt = new Date().toISOString();
      }
      // Si es la conv activa, renderizar mensaje
      if (data.conversationId === activeConvId) {
        appendMessage(data.message);
      } else if (data.message.role === 'user') {
        // Notificar al agente
        const c = conversations.find(c => c.id === data.conversationId);
        if (c) showToast(`💬 ${c.userName}: ${data.message.text.substring(0,50)}`, 'info');
      }
      renderConvList();
      break;
    }

    case 'conversation.updated': {
      const conv = conversations.find(c => c.id === data.conversationId);
      if (conv) {
        conv.status     = data.status;
        conv.assignedTo = data.assignedTo;
      }
      renderConvList();
      if (data.conversationId === activeConvId) updateRightPanel();
      break;
    }

    case 'conversation.resolved': {
      const idx = conversations.findIndex(c => c.id === data.conversationId);
      if (idx !== -1) {
        conversations[idx].status = 'resolved';
        if (data.conversationId === activeConvId) {
          appendSystemMsg('✓ Conversación resuelta');
        }
      }
      resolvedCount++;
      loadStats();
      renderConvList();
      break;
    }

    case 'conversation.transferred': {
      const conv = conversations.find(c => c.id === data.conversationId);
      if (conv) conv.status = 'pending';
      renderConvList();
      break;
    }

    case 'agent.online':
      showToast(`🟢 ${data.agent.name} conectado`, 'info');
      break;

    case 'agent.disconnected':
      showToast(`⚪ Agente desconectado`, 'info');
      break;
  }
}

// ─── Render Conv List ─────────────────────────────────────────
function renderConvList() {
  let list = conversations.filter(c => c.status !== 'resolved');
  if (currentFilter !== 'all') list = list.filter(c => c.channel === currentFilter);
  if (searchQuery)             list = list.filter(c =>
    c.userName.toLowerCase().includes(searchQuery) ||
    (c.topic || '').toLowerCase().includes(searchQuery)
  );

  queueCount.textContent = `${list.length} conversación${list.length !== 1 ? 'es' : ''}`;

  if (!list.length) {
    convList.innerHTML = '<div class="loading-state">Sin conversaciones</div>';
    return;
  }

  convList.innerHTML = list.map(c => {
    const lastMsg = c.messages && c.messages.length ? c.messages[c.messages.length - 1] : null;
    const preview = lastMsg ? lastMsg.text.substring(0, 45) + (lastMsg.text.length > 45 ? '...' : '') : c.topic;
    const elapsed = getElapsed(c.updatedAt || c.createdAt);
    const isActive = c.id === activeConvId;

    return `
    <div class="conv-item${isActive ? ' active' : ''}" data-id="${c.id}" onclick="openConv('${c.id}')">
      <div class="conv-top">
        <div class="conv-avatar ${getAvClass(c.channel)}">${getInitials(c.userName)}</div>
        <div class="conv-info">
          <div class="conv-name">${escHtml(c.userName)}</div>
          <div class="conv-preview">${escHtml(preview)}</div>
        </div>
        <div class="conv-time">${formatTime(c.createdAt)}</div>
      </div>
      <div class="conv-footer">
        <span class="badge ${getBadgeClass(c.status)}">${getStatusLabel(c.status)}</span>
        <span class="ch-badge ${getChBadgeClass(c.channel)}">${getChLabel(c.channel)}</span>
        <span class="elapsed">${elapsed}</span>
      </div>
    </div>`;
  }).join('');
}

// ─── Open Conversation ────────────────────────────────────────
async function openConv(convId) {
  activeConvId = convId;
  const conv   = conversations.find(c => c.id === convId);
  if (!conv) return;

  // Tomar la conversación si está pendiente
  if (conv.status === 'pending' || conv.status === 'waiting') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type:           'agent.take',
        conversationId: convId,
        agentId:        AGENT_ID,
        agentName:      AGENT_NAME
      }));
    }
    conv.status     = 'active';
    conv.assignedTo = AGENT_ID;
  }

  // Mostrar UI de chat
  emptyState.style.display = 'none';
  chatView.style.display   = 'flex';
  chatView.style.flexDirection = 'column';
  chatView.style.flex = '1';
  chatView.style.overflow = 'hidden';
  rightPanel.style.display = 'flex';

  // Poblar header
  const av = $('chatAvatar');
  av.textContent = getInitials(conv.userName);
  av.className   = 'conv-avatar ' + getAvClass(conv.channel);
  $('chatUserName').textContent = conv.userName;
  $('chatChannel').textContent  = getChLabel(conv.channel);
  $('chatTopic').textContent    = conv.topic || '';

  // Render mensajes
  messagesArea.innerHTML = '';
  (conv.messages || []).forEach(m => appendMessage(m, false));
  messagesArea.scrollTop = messagesArea.scrollHeight;

  updateRightPanel();
  renderConvList();
  msgInput.focus();

  // Scroll smooth al final
  setTimeout(() => { messagesArea.scrollTop = messagesArea.scrollHeight; }, 50);
}

// ─── Append Message ───────────────────────────────────────────
function appendMessage(msg, scroll = true) {
  if (msg.role === 'system') {
    const el = document.createElement('div');
    el.className = 'system-msg';
    el.textContent = msg.text;
    messagesArea.appendChild(el);
  } else {
    const row = document.createElement('div');
    row.className = `msg-row ${msg.role}`;

    const avClass = msg.role === 'user' ? 'av-user' : msg.role === 'bot' ? 'av-bot' : 'av-agent';
    const conv    = conversations.find(c => c.id === activeConvId);
    const avLabel = msg.role === 'user'
      ? (conv ? getInitials(conv.userName) : 'U')
      : msg.role === 'bot' ? '🤖' : 'AG';

    row.innerHTML = `
      <div class="msg-avatar ${avClass}">${avLabel}</div>
      <div>
        <div class="msg-bubble">${escHtml(msg.text)}</div>
        ${msg.timestamp ? `<div class="msg-meta">${formatTime(msg.timestamp)}</div>` : ''}
      </div>`;
    messagesArea.appendChild(row);
  }
  if (scroll) setTimeout(() => { messagesArea.scrollTop = messagesArea.scrollHeight; }, 30);
}

function appendSystemMsg(text) {
  appendMessage({ role: 'system', text });
}

// ─── Right Panel ──────────────────────────────────────────────
function updateRightPanel() {
  const conv = conversations.find(c => c.id === activeConvId);
  if (!conv) return;

  $('rpName').textContent    = conv.userName;
  $('rpStatus').textContent  = getStatusLabel(conv.status);
  $('rpStart').textContent   = formatTime(conv.createdAt);
  $('rpAgent').textContent   = conv.assignedTo ? AGENT_NAME : '—';

  const chEl = $('rpChannel');
  chEl.innerHTML = `<span class="ch-badge ${getChBadgeClass(conv.channel)}">${getChLabel(conv.channel)}</span>`;

  const tagsEl = $('rpTags');
  tagsEl.innerHTML = (conv.tags || []).map(t => `<span class="tag">${escHtml(t)}</span>`).join('');
}

// ─── Send Message ─────────────────────────────────────────────
async function doSend() {
  const text = msgInput.value.trim();
  if (!text || !activeConvId) return;

  // Optimistic UI — añadir mensaje inmediatamente
  const now = new Date().toISOString();
  const msg  = { role: 'agent', text, timestamp: now };

  const conv = conversations.find(c => c.id === activeConvId);
  if (conv) { conv.messages = conv.messages || []; conv.messages.push(msg); }

  appendMessage(msg);
  msgInput.value = '';
  msgInput.style.height = 'auto';

  await sendAgentMessage(activeConvId, text);
}

// ─── Events ───────────────────────────────────────────────────
function bindEvents() {
  sendBtn.addEventListener('click', doSend);

  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  // Auto-resize textarea
  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
  });

  // Channel filter tabs
  $('channelTabs').addEventListener('click', e => {
    const tab = e.target.closest('.ch-tab');
    if (!tab) return;
    document.querySelectorAll('.ch-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    renderConvList();
  });

  // Search
  $('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderConvList();
  });

  // Resolve
  resolveBtn.addEventListener('click', async () => {
    if (!activeConvId) return;
    await resolveConversation(activeConvId);
    appendSystemMsg('✓ Conversación resuelta');
    resolvedCount++;
    loadStats();

    // Quitar de la lista
    const idx = conversations.findIndex(c => c.id === activeConvId);
    if (idx !== -1) conversations[idx].status = 'resolved';

    // Reset UI
    activeConvId = null;
    chatView.style.display   = 'none';
    rightPanel.style.display = 'none';
    emptyState.style.display = 'flex';
    renderConvList();
    showToast('✓ Conversación resuelta correctamente', 'success');
  });

  // Transfer
  transferBtn.addEventListener('click', () => {
    transferModal.style.display = 'flex';
  });
  $('cancelTransfer').addEventListener('click', () => {
    transferModal.style.display = 'none';
  });
  $('confirmTransfer').addEventListener('click', async () => {
    if (!activeConvId) return;
    const target = $('transferTarget').value;
    const note   = $('transferNote').value;
    await transferConversation(activeConvId, target, note);
    appendSystemMsg(`↔ Conversación transferida a: ${target}`);
    transferModal.style.display = 'none';
    showToast('↔ Conversación transferida', 'info');

    const conv = conversations.find(c => c.id === activeConvId);
    if (conv) { conv.status = 'pending'; conv.assignedTo = null; }

    activeConvId = null;
    chatView.style.display   = 'none';
    rightPanel.style.display = 'none';
    emptyState.style.display = 'flex';
    renderConvList();
  });

  // Notes btn
  notesBtn.addEventListener('click', () => {
    const note = prompt('Añadir nota interna:');
    if (note) appendSystemMsg(`📝 Nota: ${note}`);
  });

  // Quick replies toggle
  document.querySelector('.qr-trigger')?.addEventListener('click', () => {
    qrPanel.style.display = qrPanel.style.display === 'none' ? 'block' : 'none';
  });

  // Bot test
  $('botTestBtn').addEventListener('click', async () => {
    const text = $('botTestInput').value.trim();
    if (!text) return;
    $('botTestResult').textContent = 'Procesando...';
    try {
      const reply = await testBot(text);
      $('botTestResult').textContent = '🤖 ' + reply;
    } catch (e) {
      $('botTestResult').textContent = 'Error: backend no disponible';
    }
    $('botTestInput').value = '';
  });
  $('botTestInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('botTestBtn').click();
  });

  // Web widget toggle
  $('widgetToggle').addEventListener('click', () => {
    const wp = $('widgetPreview');
    const visible = wp.style.display !== 'none';
    wp.style.display    = visible ? 'none' : 'block';
    $('widgetToggle').style.bottom = visible ? '20px' : '510px';
  });

  // Close modal on backdrop click
  transferModal.addEventListener('click', e => {
    if (e.target === transferModal) transferModal.style.display = 'none';
  });
}

// ─── Quick Replies ────────────────────────────────────────────
function renderQuickReplies() {
  // Sidebar
  const sidebarQR = $('sidebarQR');
  sidebarQR.innerHTML = QUICK_REPLIES.map(qr =>
    `<button class="qr-btn" onclick="insertQR('${escAttr(qr.text)}')">${escHtml(qr.label)}</button>`
  ).join('');

  // Panel flotante
  const qrPanelBody = $('qrPanelBody');
  qrPanelBody.innerHTML = QUICK_REPLIES.map(qr =>
    `<button class="qr-item" onclick="insertQR('${escAttr(qr.text)}')">${escHtml(qr.label)} — <span style="color:var(--text-3)">${escHtml(qr.text.substring(0,40))}...</span></button>`
  ).join('');
}

function insertQR(text) {
  msgInput.value = text;
  msgInput.focus();
  qrPanel.style.display = 'none';
}
window.insertQR = insertQR; // global para onclick

// ─── Toast Notifications ──────────────────────────────────────
function initToastContainer() {
  const el = document.createElement('div');
  el.id = 'toastContainer';
  document.body.appendChild(el);
}

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ─── Utils ────────────────────────────────────────────────────
function getInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}
function getAvClass(ch) {
  return ch === 'whatsapp' ? 'av-wa' : ch === 'teams' ? 'av-teams' : 'av-web';
}
function getBadgeClass(s) {
  return s === 'active' ? 'badge-active' : s === 'waiting' ? 'badge-waiting' : s === 'resolved' ? 'badge-resolved' : 'badge-pending';
}
function getStatusLabel(s) {
  return { pending: 'Pendiente', active: 'Activo', waiting: 'Esperando', resolved: 'Resuelto' }[s] || s;
}
function getChLabel(ch) {
  return { whatsapp: 'WhatsApp', teams: 'Teams', web: 'Web Chat' }[ch] || ch;
}
function getChBadgeClass(ch) {
  return ch === 'whatsapp' ? 'ch-badge-wa' : ch === 'teams' ? 'ch-badge-teams' : 'ch-badge-web';
}
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}
function getElapsed(iso) {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)   return diff + 's';
  if (diff < 3600) return Math.floor(diff/60) + 'm ' + (diff%60) + 's';
  return Math.floor(diff/3600) + 'h';
}
function updateElapsedTimes() { renderConvList(); }
function escHtml(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s = '') {
  return String(s).replace(/'/g, "\\'").replace(/\n/g, ' ');
}
function setWsStatus(status) {
  const el = $('wsStatus');
  el.className = `ws-status ${status}`;
  el.title = status === 'connected' ? 'WebSocket conectado' : 'WebSocket desconectado';
}

// Expose openConv globally (used in inline onclick)
window.openConv = openConv;

// ═══════════════════════════════════════════════════════════════
// KB PANEL — Asistente Técnico Interno
// Solo frontend: estructura lista para conectar el bot.
// Para activar: implementar kbCallBot(text) → devuelve string
// ═══════════════════════════════════════════════════════════════

const kbPanel      = $('kbPanel');
const kbToggleBtn  = $('kbToggleBtn');
const kbCloseBtn   = $('kbCloseBtn');
const kbMessages   = $('kbMessages');
const kbInput      = $('kbInput');
const kbSendBtn    = $('kbSendBtn');

let kbOpen     = false;
let kbWaiting  = false;

// ── Abrir / cerrar ────────────────────────────────────────────
function openKbPanel() {
  kbOpen = true;
  kbPanel.classList.add('open');
  kbToggleBtn.classList.add('active');
  kbInput.focus();
}

function closeKbPanel() {
  kbOpen = false;
  kbPanel.classList.remove('open');
  kbToggleBtn.classList.remove('active');
}

kbToggleBtn.addEventListener('click', () => kbOpen ? closeKbPanel() : openKbPanel());
kbCloseBtn.addEventListener('click', closeKbPanel);

// ── Shortcuts ────────────────────────────────────────────────
document.querySelectorAll('.kb-shortcut').forEach(btn => {
  btn.addEventListener('click', () => {
    const q = btn.dataset.query;
    if (q) { kbInput.value = q; kbSendBtn.click(); }
  });
});

// ── Send ──────────────────────────────────────────────────────
async function kbSend() {
  const text = kbInput.value.trim();
  if (!text || kbWaiting) return;

  // Limpiar welcome si existe
  const welcome = kbMessages.querySelector('.kb-welcome');
  if (welcome) welcome.remove();

  kbInput.value = '';
  kbInput.style.height = 'auto';
  kbWaiting = true;
  kbSendBtn.disabled = true;

  // Mensaje del agente
  kbAddMessage('kb-user', text);

  // Typing indicator
  const typing = kbShowTyping();

  try {
    // ── PUNTO DE INTEGRACIÓN ──────────────────────────────────
    // Reemplaza esta llamada con tu bot real cuando esté listo:
    //   const reply = await kbCallBot(text);
    // Por ahora simula un delay visual de carga.
    const reply = await kbCallBot(text);
    typing.remove();
    kbAddMessage('kb-assistant', reply);
  } catch (err) {
    typing.remove();
    kbAddMessage('kb-assistant', '⚠️ Error al contactar con el asistente. Verifica la conexión con el backend.');
  }

  kbWaiting = false;
  kbSendBtn.disabled = false;
  kbInput.focus();
}

// ── Placeholder del bot (reemplazar con implementación real) ──
async function kbCallBot(text) {
  // TODO: conectar con tu endpoint de bot
  // Ejemplo: const res = await fetch('/api/kb/ask', { method:'POST', body: JSON.stringify({text}) });
  // return (await res.json()).reply;
  await new Promise(r => setTimeout(r, 900)); // simula latencia
  return `[Bot pendiente de conexión] Pregunta recibida: "${text}". Conecta tu endpoint en kbCallBot() dentro de app.js.`;
}

// ── Render mensajes ───────────────────────────────────────────
function kbAddMessage(role, text) {
  const now  = new Date();
  const time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');

  const row  = document.createElement('div');
  row.className = `kb-msg-row ${role}`;

  const label = role === 'kb-user' ? 'Tú' : 'Asistente';

  row.innerHTML = `
    <div class="kb-bubble">${escHtml(text)}</div>
    <div class="kb-msg-meta">${label} · ${time}</div>`;

  kbMessages.appendChild(row);
  kbScrollBottom();
}

function kbShowTyping() {
  const row = document.createElement('div');
  row.className = 'kb-msg-row kb-assistant';
  row.innerHTML = `
    <div class="kb-typing">
      <div class="kb-typing-dots">
        <div class="kb-dot"></div>
        <div class="kb-dot"></div>
        <div class="kb-dot"></div>
      </div>
      <span class="kb-typing-label">Consultando base de conocimiento...</span>
    </div>`;
  kbMessages.appendChild(row);
  kbScrollBottom();
  return row;
}

function kbScrollBottom() {
  setTimeout(() => { kbMessages.scrollTop = kbMessages.scrollHeight; }, 30);
}

// ── Input eventos ─────────────────────────────────────────────
kbSendBtn.addEventListener('click', kbSend);

kbInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); kbSend(); }
});

kbInput.addEventListener('input', () => {
  kbInput.style.height = 'auto';
  kbInput.style.height = Math.min(kbInput.scrollHeight, 100) + 'px';
});

// ── Shortcut de teclado: Alt+K abre/cierra el panel ──────────
document.addEventListener('keydown', e => {
  if (e.altKey && e.key === 'k') {
    e.preventDefault();
    kbOpen ? closeKbPanel() : openKbPanel();
  }
});