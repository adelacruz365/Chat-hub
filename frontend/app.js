/**
 * ================================================================
 * app.js — Unified Response Hub Frontend
 * ================================================================
 * - Conversaciones en tiempo real (WS + REST)
 * - Columnas redimensionables (drag resize)
 * - Dropdowns: info cliente, respuestas rápidas, bot test
 * - Panel KB: asistente técnico interno
 * - Panel Search: buscador de información
 * - Alertas de nuevo mensaje con badge + toast magenta
 * ================================================================
 */

// ─── Config ───────────────────────────────────────────────────
const API_BASE = '';            // misma origen cuando sirve Node
// const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const WS_URL = "wss://pubsub-hub-tecnicos-poc.webpubsub.azure.com/client/hubs/Centro?access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJ3c3M6Ly9wdWJzdWItaHViLXRlY25pY29zLXBvYy53ZWJwdWJzdWIuYXp1cmUuY29tL2NsaWVudC9odWJzL0NlbnRybyIsImlhdCI6MTc3NDg1Mjc0NCwiZXhwIjoxNzc0ODg4NzQ0fQ.FIzGDUqWEK95PsqrVeAAPeIDgLCv8Et12czpnIRzCOM";const AGENT_ID = 'agent-' + Math.random().toString(36).slice(2, 8);
const AGENT_NAME = 'Agente Hub';

const QUICK_REPLIES = [
  { label: '👋 Saludo inicial',   text: 'Hola, soy el agente. ¿En qué puedo ayudarte?' },
  { label: '🔍 Revisando caso',   text: 'Entiendo, déjame revisar tu caso un momento...' },
  { label: '📋 Solicitar datos',  text: '¿Podrías proporcionarme tu número de cuenta o pedido?' },
  { label: '⏱ Espera',           text: 'Un momento, estoy consultando con el equipo...' },
  { label: '✅ Cierre',           text: 'Gracias por tu paciencia. Hemos resuelto tu consulta. ¿Hay algo más?' },
  { label: '📞 Llamada',          text: 'Si lo prefieres, podemos hablar por teléfono. ¿Te va bien ahora?' },
  { label: '🔁 Seguimiento',      text: 'Voy a escalar tu caso al equipo técnico. Te contactaremos en breve.' },
  { label: '📧 Email',            text: 'Te enviaremos un resumen por email con todos los detalles.' },
];

// ─── Estado ───────────────────────────────────────────────────
let conversations    = [];
let activeConvId     = null;
let ws               = null;
let wsReconnectTimer = null;
let currentFilter    = 'all';
let resolvedCount    = 0;
let searchQuery      = '';

// ─── DOM refs ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
let convList, queueCount, emptyState, chatView, messagesArea;
let msgInput, sendBtn, resolveBtn, transferBtn, notesBtn, transferModal;

// ─── Init ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  convList      = $('convList');
  queueCount    = $('queueCount');
  emptyState    = $('emptyState');
  chatView      = $('chatView');
  messagesArea  = $('messagesArea');
  msgInput      = $('msgInput');
  sendBtn       = $('sendBtn');
  resolveBtn    = $('resolveBtn');
  transferBtn   = $('transferBtn');
  notesBtn      = $('notesBtn');
  transferModal = $('transferModal');

  loadConversations();
  connectWebSocket();
  bindEvents();
  renderDropdownQR();
  initToastContainer();
  initResizeHandles();
  //initDropdowns();
  initKbPanel();
  initSearchPanel();
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
  } catch {
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
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'agent.message', conversationId: convId,
      agentId: AGENT_ID, agentName: AGENT_NAME, text
    }));
  } else {
    await fetch(`${API_BASE}/api/conversations/${convId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'agent', text })
    });
  }
}

async function resolveConversation(convId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'conversation.resolve', conversationId: convId, agentId: AGENT_ID
    }));
  } else {
    await fetch(`${API_BASE}/api/conversations/${convId}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', agentId: AGENT_ID })
    });
  }
}

async function transferConversation(convId, target, note) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'conversation.transfer', conversationId: convId,
      toAgentId: target, note
    }));
  }
}

async function testBot(text) {
  const res = await fetch(`${API_BASE}/api/messages/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'test-user', text, channel: 'web' })
  });
  const data = await res.json();
  return data.reply;
}

// ─── WebSocket ────────────────────────────────────────────────
function connectWebSocket() {
  // 1. AÑADIMOS EL SUBPROTOCOLO DE AZURE COMO SEGUNDO PARÁMETRO
  ws = new WebSocket(WS_URL, 'json.webpubsub.azure.v1');

  ws.onopen = () => {
    console.log('[WS] Conectado a Azure Web PubSub');
    setWsStatus('connected');
    clearTimeout(wsReconnectTimer);
    
    // 2. ENVIAMOS EL COMANDO OFICIAL PARA UNIRNOS AL GRUPO
    ws.send(JSON.stringify({
        type: "joinGroup",
        group: "Facturacion"
    }));
    
    console.log('Suscrito al grupo: Facturacion');
  };

ws.onmessage = (event) => {
    console.log("🔥 MENSAJE RECIBIDO DESDE AZURE:", event.data);

    try {
        let msgObj = JSON.parse(event.data);
        
        // 1. Ignoramos la basura del sistema para no ensuciar
        if (msgObj.type === 'system') return;

// ================================================================
        // 🚨 MODO FUERZA BRUTA: INYECTAR EN EL NUEVO DISEÑO HTML
        // ================================================================
        if (event.data.includes('conversation.new')) {
            let payloadReal = typeof msgObj.data === 'string' ? JSON.parse(msgObj.data) : (msgObj.data || msgObj);
            let nuevaConv = payloadReal.conversation;

            // Limpiamos la basura de Copilot
            if (nuevaConv.id) nuevaConv.id = nuevaConv.id.replace(/["\\]/g, '');
            if (nuevaConv.userId) nuevaConv.userId = nuevaConv.userId.replace(/["\\]/g, '');
            if (nuevaConv.userName) nuevaConv.userName = nuevaConv.userName.replace(/["\\]/g, '');

            // 🚀 LA MAGIA: Lo metemos directamente en tu nuevo diseño multipanel
            if (typeof DEMO_CONVS !== 'undefined') {
                
                // 1. Lo metemos en la lista de chats del HTML
                const existeDemo = DEMO_CONVS.find(c => c.id === nuevaConv.id);
                if (!existeDemo) {
                    DEMO_CONVS.unshift({
                        id: nuevaConv.id,
                        name: nuevaConv.userName,
                        av: nuevaConv.userName.substring(0, 2).toUpperCase() || 'U',
                        avClass: 'av-teams',
                        channel: nuevaConv.channel || 'teams',
                        status: 'active',
                        topic: nuevaConv.topic || 'Escalado desde Copilot',
                        derived: null
                    });
                }
                
                // 2. Metemos sus mensajes en la base de datos del HTML
                if (typeof DEMO_MESSAGES !== 'undefined') {
                    DEMO_MESSAGES[nuevaConv.id] = nuevaConv.messages.map(m => ({
                        role: m.role || 'user',
                        text: m.text || ''
                    }));
                }

                // 3. Forzamos que se redibuje la barra lateral (usando la función del HTML)
                if (typeof renderConvList === 'function') renderConvList();

                // 4. ABRIMOS EL PANEL CENTRAL NUEVO
                if (typeof openChatPanel === 'function') {
                    openChatPanel(nuevaConv.id);
                }
                
            } else {
                // Fallback a lo antiguo por si acaso
                openConv(nuevaConv.id);
            }
            
            showToast(`🚨 Chat abierto en nuevo panel: ${nuevaConv.userName}`, 'new-msg');
            console.log("✅ CHAT FORZADO Y ABIERTO CON ÉXITO EN EL NUEVO DISEÑO");
            return;
        }
        // ================================================================

        // Para el resto de mensajes normales (cuando hablas dentro del chat)
        if (msgObj.type === 'message' && msgObj.data) {
            let payloadNormal = typeof msgObj.data === 'string' ? JSON.parse(msgObj.data) : msgObj.data;
            handleWsEvent(payloadNormal);
        }

    } catch (error) {
        console.error("❌ Error en la fuerza bruta:", error);
    }
  };

  ws.onclose = (event) => {
    console.log('[WS] Desconectado de Azure — reconectando en 3s', event.code, event.reason);
    setWsStatus('error');
    wsReconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (error) => {
    console.error('[WS] Error de conexión:', error);
    setWsStatus('error');
  };
}

function handleWsEvent(data) {
  switch (data.type) {
    case 'conversation.new': {
      // 1. Verificamos que no exista ya por si acaso
      const existe = conversations.find(c => c.id === data.conversation.id);
      if (!existe) {
        // 2. Metemos la nueva conversación al principio de la lista
        conversations.unshift(data.conversation);
        // 3. Volvemos a dibujar el panel izquierdo
        renderConvList();
        // 4. Avisamos al agente
        showToast(`🔔 Nuevo chat entrante de ${data.conversation.userName}`, 'info');
      }
      break;
    }
    case 'message.new': {
      const conv = conversations.find(c => c.id === data.conversationId);
      let isDuplicate = false;

      if (conv) {
        // FIX: Buscar si el mensaje que llega es el eco de nuestro envío optimista
        const optIndex = (conv.messages || []).findIndex(m => m._optimistic && m.text === data.message.text);

        if (optIndex !== -1) {
          isDuplicate = true;
          // Le quitamos la marca y actualizamos datos con los reales del servidor
          conv.messages[optIndex]._optimistic = false;
          if (data.message.timestamp) conv.messages[optIndex].timestamp = data.message.timestamp;
        } else {
          // Si no es un duplicado nuestro, lo guardamos normal
          conv.messages = conv.messages || [];
          conv.messages.push(data.message);
        }
        conv.updatedAt = new Date().toISOString();
      }

      // Solo pintamos el mensaje en pantalla si NO es un duplicado
      if (!isDuplicate) {
        if (data.conversationId === activeConvId) {
          appendMessage(data.message);
        } else if (data.message.role === 'user') {
          const c = conversations.find(c => c.id === data.conversationId);
          if (c) {
            markConvNew(data.conversationId);
            showToast(`💬 ${c.userName}: ${data.message.text.substring(0,60)}`, 'new-msg');
          }
        }
      }
      
      renderConvList();
      break;
    }

    case 'conversation.updated': {
      const conv = conversations.find(c => c.id === data.conversationId);
      if (conv) { conv.status = data.status; conv.assignedTo = data.assignedTo; }
      renderConvList();
      if (data.conversationId === activeConvId) updateDropdownInfo();
      break;
    }

    case 'conversation.resolved': {
      const idx = conversations.findIndex(c => c.id === data.conversationId);
      if (idx !== -1) {
        conversations[idx].status = 'resolved';
        if (data.conversationId === activeConvId) appendSystemMsg('✓ Conversación resuelta');
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

    case 'conversation.new': {
      if (!conversations.find(c => c.id === data.conversation.id)) {
        conversations.unshift(data.conversation);
        renderConvList();
        loadStats();
        showToast(`🆕 Nueva conversación: ${data.conversation.userName}`, 'info');
      }
      break;
    }

    case 'agent.online':
      showToast(`🟢 ${data.agent.name} conectado`, 'info');
      break;
    case 'agent.disconnected':
      showToast('⚪ Agente desconectado', 'info');
      break;
  }
}

// ─── New message badge ────────────────────────────────────────
const newConvSet = new Set(); // convIds con mensajes nuevos

function markConvNew(convId) {
  newConvSet.add(convId);
  renderConvList();
}

function clearConvNew(convId) {
  newConvSet.delete(convId);
  // no re-render needed here, called on open
}

// ─── Render Conv List ─────────────────────────────────────────
function renderConvList() {
  let list = conversations.filter(c => c.status !== 'resolved');
  if (currentFilter !== 'all') list = list.filter(c => c.channel === currentFilter);
  if (searchQuery) list = list.filter(c =>
    c.userName.toLowerCase().includes(searchQuery) ||
    (c.topic || '').toLowerCase().includes(searchQuery)
  );

  const total = list.length;
  queueCount.textContent = total;

  if (!total) {
    convList.innerHTML = '<div class="loading-state">Sin conversaciones</div>';
    return;
  }

  convList.innerHTML = list.map(c => {
    const lastMsg = c.messages?.length ? c.messages[c.messages.length - 1] : null;
    const preview = lastMsg ? lastMsg.text.substring(0, 40) + (lastMsg.text.length > 40 ? '…' : '') : c.topic;
    const elapsed = getElapsed(c.updatedAt || c.createdAt);
    const isActive = c.id === activeConvId;
    const isNew    = newConvSet.has(c.id) && !isActive;

    return `
    <div class="conv-item${isActive ? ' active' : ''}${isNew ? ' has-new' : ''}"
         data-id="${c.id}" onclick="openConv('${c.id}')">
      <div class="conv-top">
        <div class="conv-avatar ${getAvClass(c.channel)}">${getInitials(c.userName)}</div>
        <div class="conv-info">
          <div class="conv-name">${escHtml(c.userName)}</div>
          <div class="conv-preview">${escHtml(preview)}</div>
        </div>
        <div class="conv-time">${formatTime(c.createdAt)}</div>
      </div>
      <div class="conv-footer">
        <span class="status-badge ${getBadgeClass(c.status)}">${getStatusLabel(c.status)}</span>
        <span class="ch-badge ${getChBadgeClass(c.channel)}">${getChLabel(c.channel)}</span>
        <span class="elapsed">${elapsed}</span>
      </div>
    </div>`;
  }).join('');
}

// ─── Open Conversation ────────────────────────────────────────
async function openConv(convId) {
  activeConvId = convId;
  clearConvNew(convId);

  const conv = conversations.find(c => c.id === convId);
  if (!conv) return;

  if (conv.status === 'pending' || conv.status === 'waiting') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'agent.take', conversationId: convId,
        agentId: AGENT_ID, agentName: AGENT_NAME
      }));
    }
    conv.status = 'active';
    conv.assignedTo = AGENT_ID;
  }

  emptyState.style.display = 'none';
  chatView.style.display   = 'flex';
  chatView.style.flexDirection = 'column';
  chatView.style.flex = '1';
  chatView.style.overflow = 'hidden';

  // Populate chat header
  const av = $('chatAvatar');
  av.textContent = getInitials(conv.userName);
  av.className   = 'conv-avatar ' + getAvClass(conv.channel);
  $('chatUserName').textContent = conv.userName;
  $('chatChannel').textContent  = getChLabel(conv.channel);
  $('chatTopic').textContent    = conv.topic || '';

  // Messages
  messagesArea.innerHTML = '';
  (conv.messages || []).forEach(m => appendMessage(m, false));
  setTimeout(() => { messagesArea.scrollTop = messagesArea.scrollHeight; }, 50);

  updateDropdownInfo();
  renderConvList();
  msgInput.focus();
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

function appendSystemMsg(text) { appendMessage({ role: 'system', text }); }

// ─── Dropdown: info del cliente ───────────────────────────────
function updateDropdownInfo() {
  const conv = conversations.find(c => c.id === activeConvId);
  if (!conv) return;
  $('dpName').textContent  = conv.userName;
  $('dpStatus').textContent = getStatusLabel(conv.status);
  $('dpStart').textContent  = formatTime(conv.createdAt);
  $('dpAgent').textContent  = conv.assignedTo ? AGENT_NAME : '—';

  const chEl = $('dpChannel');
  chEl.innerHTML = `<span class="ch-badge ${getChBadgeClass(conv.channel)}">${getChLabel(conv.channel)}</span>`;

  const tagsEl = $('dpTags');
  if (conv.tags?.length) {
    tagsEl.innerHTML = conv.tags.map(t => `<span class="dp-tag">${escHtml(t)}</span>`).join('');
  } else {
    tagsEl.innerHTML = '<span style="font-size:11px;color:var(--text-3)">Sin etiquetas</span>';
  }
}

// ─── Dropdown: Respuestas rápidas ─────────────────────────────
function renderDropdownQR() {
  renderQRList('');
  // Filter
  $('dpQRSearch').addEventListener('input', e => {
    renderQRList(e.target.value.toLowerCase().trim());
  });
}

function renderQRList(filter) {
  const list = filter
    ? QUICK_REPLIES.filter(q => q.label.toLowerCase().includes(filter) || q.text.toLowerCase().includes(filter))
    : QUICK_REPLIES;

  $('dpQRList').innerHTML = list.map(qr => `
    <button class="dp-qr-item" onclick="insertQR('${escAttr(qr.text)}')">
      <span class="dp-qr-label">${escHtml(qr.label)}</span>
      <span class="dp-qr-preview">${escHtml(qr.text)}</span>
    </button>`
  ).join('') || '<div style="padding:8px 10px;font-size:11px;color:var(--text-3)">Sin resultados</div>';
}

function insertQR(text) {
  msgInput.value = text;
  msgInput.focus();
  // Cerrar dropdown
  closeAllDropdowns();
}
window.insertQR = insertQR;

// ─── Dropdowns logic ──────────────────────────────────────────
function initDropdowns() {
  const dropdowns = [
    { wrap: 'clientInfoWrap',  btn: 'clientInfoBtn'  },
    { wrap: 'quickRepliesWrap', btn: 'quickRepliesBtn' },
  ];

  dropdowns.forEach(({ wrap, btn }) => {
    const wrapEl = $(wrap);
    const btnEl  = $(btn);
    btnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = wrapEl.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) wrapEl.classList.add('open');
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-wrap')) closeAllDropdowns();
  });
}

function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-wrap.open').forEach(el => el.classList.remove('open'));
}

// ─── Send Message ─────────────────────────────────────────────
async function doSend() {
  const text = msgInput.value.trim();
  if (!text || !activeConvId) return;

  const now  = new Date().toISOString();
  const msg  = { role: 'agent', text, timestamp: now, _optimistic: true };
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); doSend(); }
  });
  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
  });

  // Channel filter
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
    const idx = conversations.findIndex(c => c.id === activeConvId);
    if (idx !== -1) conversations[idx].status = 'resolved';
    activeConvId = null;
    chatView.style.display = 'none';
    emptyState.style.display = 'flex';
    renderConvList();
    showToast('✓ Conversación resuelta', 'success');
  });

  // Transfer
  if (transferBtn) transferBtn.addEventListener('click', () => { if (transferModal) transferModal.style.display = 'flex'; });
  if ($('cancelTransfer')) $('cancelTransfer').addEventListener('click', () => { if (transferModal) transferModal.style.display = 'none'; });
  $('confirmTransfer').addEventListener('click', async () => {
    if (!activeConvId) return;
    const target = $('transferTarget').value;
    const note   = $('transferNote').value;
    await transferConversation(activeConvId, target, note);
    appendSystemMsg(`↔ Transferida a: ${target}`);
    transferModal.style.display = 'none';
    showToast('↔ Conversación transferida', 'info');
    const conv = conversations.find(c => c.id === activeConvId);
    if (conv) { conv.status = 'pending'; conv.assignedTo = null; }
    activeConvId = null;
    chatView.style.display = 'none';
    emptyState.style.display = 'flex';
    renderConvList();
  });

  // Notes
  notesBtn.addEventListener('click', () => {
    const note = prompt('Añadir nota interna:');
    if (note) appendSystemMsg(`📝 Nota: ${note}`);
  });

  // Close modal on backdrop
  if (transferModal) transferModal.addEventListener('click', e => {
    if (e.target === transferModal) transferModal.style.display = 'none';
  });
}

// ══════════════════════════════════════════════════════════════
// RESIZE HANDLES
// ══════════════════════════════════════════════════════════════
function initResizeHandles() {
  const handle  = $('resizeLeft');
  const sidebar = $('sidebar');

  let dragging = false;
  let startX   = 0;
  let startW   = 0;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX   = e.clientX;
    startW   = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    const newW  = Math.max(180, Math.min(480, startW + delta));
    sidebar.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ══════════════════════════════════════════════════════════════
// KB PANEL — Asistente Técnico Interno
// ══════════════════════════════════════════════════════════════
let kbOpen    = false;
let kbWaiting = false;

function initKbPanel() {
  const kbPanel     = $('kbPanel');
  const kbToggleBtn = $('kbToggleBtn');
  const kbInput     = $('kbInput');
  const kbSendBtn   = $('kbSendBtn');
  const kbMessages  = $('kbMessages');

  // Toggle panel visibility on button click
  if (kbToggleBtn) {
    kbToggleBtn.classList.add('active');
    kbToggleBtn.addEventListener('click', () => {
      const isHidden = kbPanel.classList.toggle('kb-hidden');
      const resizeHandle = $('resizeRight');
      if (resizeHandle) resizeHandle.style.display = isHidden ? 'none' : '';
      kbToggleBtn.classList.toggle('active', !isHidden);
      if (!isHidden && kbInput) kbInput.focus();
    });
  }

  // Shortcuts
  document.querySelectorAll('.kb-shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.query;
      if (q) { kbInput.value = q; kbSendBtn.click(); }
    });
  });

  // Send
  async function kbSend() {
    const text = kbInput.value.trim();
    if (!text || kbWaiting) return;
    const welcome = kbMessages.querySelector('.kb-welcome');
    if (welcome) welcome.remove();

    kbInput.value = '';
    kbInput.style.height = 'auto';
    kbWaiting = true;
    kbSendBtn.disabled = true;

    kbAddMsg('kb-user', text, kbMessages);
    const typing = kbShowTyping(kbMessages);

    try {
      const reply = await kbCallBot(text);
      typing.remove();
      kbAddMsg('kb-assistant', reply, kbMessages);
    } catch {
      typing.remove();
      kbAddMsg('kb-assistant', '⚠️ Error al contactar con el asistente. Verifica la conexión.', kbMessages);
    }

    kbWaiting = false;
    kbSendBtn.disabled = false;
    kbInput.focus();
  }

  kbSendBtn.addEventListener('click', kbSend);
  kbInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); kbSend(); }
  });
  kbInput.addEventListener('input', () => {
    kbInput.style.height = 'auto';
    kbInput.style.height = Math.min(kbInput.scrollHeight, 90) + 'px';
  });

  // Alt+K toggles the assistant panel
  document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'k') { e.preventDefault(); kbToggleBtn && kbToggleBtn.click(); }
  });
}

// Placeholder bot — reemplazar con endpoint real
async function kbCallBot(text) {
  // TODO: await fetch('/api/kb/ask', { method:'POST', body: JSON.stringify({text}) })
  await new Promise(r => setTimeout(r, 800));
  return `[Bot pendiente] Pregunta recibida: "${text}". Conecta tu endpoint en kbCallBot() en app.js.`;
}

function kbAddMsg(role, text, container) {
  const now  = new Date();
  const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  const row  = document.createElement('div');
  row.className = `kb-msg-row ${role}`;
  row.innerHTML = `
    <div class="kb-bubble">${escHtml(text)}</div>
    <div class="kb-msg-meta">${role === 'kb-user' ? 'Tú' : 'Asistente'} · ${time}</div>`;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function kbShowTyping(container) {
  const row = document.createElement('div');
  row.className = 'kb-msg-row kb-assistant';
  row.innerHTML = `
    <div class="kb-typing">
      <div class="kb-typing-dots">
        <div class="kb-dot"></div><div class="kb-dot"></div><div class="kb-dot"></div>
      </div>
      <span class="kb-typing-label">Consultando base de conocimiento...</span>
    </div>`;
  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
  return row;
}

// ══════════════════════════════════════════════════════════════
// SEARCH PANEL — Buscador de información interna
// ══════════════════════════════════════════════════════════════

// Mock data para demo — reemplazar con API real
const MOCK_DOCS = [
  { title: 'Protocolo de escalado N1 → N2', snippet: 'Pasos para escalar una conversación al equipo de nivel 2 cuando el agente no puede resolver el caso en primer contacto.', tags: ['escalado', 'protocolo'], category: 'Soporte' },
  { title: 'WhatsApp Business API — Configuración inicial', snippet: 'Requisitos de cuenta, tokens de acceso, webhooks y plantillas aprobadas para envío de mensajes HSM.', tags: ['whatsapp', 'api', 'config'], category: 'Integración' },
  { title: 'Microsoft Teams — Graph API y permisos', snippet: 'Permisos delegados y de aplicación necesarios. Configuración de conectores y webhooks de Teams.', tags: ['teams', 'graph', 'api'], category: 'Integración' },
  { title: 'SLA y tiempos de respuesta', snippet: 'Tiempos máximos por canal: WhatsApp 2min, Teams 5min, Web 1min. Penalizaciones y escalado automático.', tags: ['sla', 'tiempos'], category: 'Política' },
  { title: 'Reset de credenciales de cliente', snippet: 'Proceso verificado para resetear contraseñas y tokens de acceso. Requiere verificación de identidad en dos pasos.', tags: ['credenciales', 'seguridad'], category: 'Soporte' },
  { title: 'GDPR — Tratamiento de datos en conversaciones', snippet: 'Política de retención, anonimización y borrado de datos de conversaciones. Tiempo máximo de almacenamiento: 90 días.', tags: ['gdpr', 'privacidad', 'legal'], category: 'Legal' },
  { title: 'Incidencias críticas — Protocolo P1', snippet: 'Definición de incidencia crítica (>500 usuarios afectados). Pasos de comunicación interna y cliente.', tags: ['incidencia', 'critica', 'p1'], category: 'Soporte' },
  { title: 'Licencias Microsoft 365 para Teams Bot', snippet: 'Se requiere licencia E3 o superior, o Teams Essentials + Azure Bot Services. Coste aprox. €12/usuario/mes.', tags: ['licencias', 'teams', 'microsoft'], category: 'Licencias' },
  { title: 'Códigos de error comunes y soluciones', snippet: 'ERR_WS_TIMEOUT: reconectar WS. ERR_API_401: renovar token. ERR_QUEUE_FULL: escalar capacidad.', tags: ['errores', 'debug'], category: 'Técnico' },
];

let searchOpen = false;

function initSearchPanel() {
  const panel        = $('searchPanel');
  const toggleBtn    = $('searchToggleBtn');
  const closeBtn     = $('searchCloseBtn');
  const spInput      = $('spInput');
  const spSearchBtn  = $('spSearchBtn');
  const spResults    = $('spResults');

  function openSearch() {
    searchOpen = true;
    panel.classList.add('open');
    toggleBtn.classList.add('active');
    spInput.focus();
  }
  function closeSearch() {
    searchOpen = false;
    panel.classList.remove('open');
    toggleBtn.classList.remove('active');
  }

  toggleBtn.addEventListener('click', () => searchOpen ? closeSearch() : openSearch());
  closeBtn.addEventListener('click', closeSearch);

  // Categories
  document.querySelectorAll('.sp-cat').forEach(btn => {
    btn.addEventListener('click', () => {
      spInput.value = btn.dataset.q;
      runSearch(btn.dataset.q);
    });
  });

  // Search
  function runSearch(query) {
    if (!query.trim()) return;
    spResults.innerHTML = renderSkeletons();
    setTimeout(() => {
      const q = query.toLowerCase();
      const results = MOCK_DOCS.filter(d =>
        d.title.toLowerCase().includes(q) ||
        d.snippet.toLowerCase().includes(q) ||
        d.tags.some(t => t.includes(q)) ||
        d.category.toLowerCase().includes(q)
      );
      renderSearchResults(results, query, spResults);
    }, 500); // simula latencia
  }

  spSearchBtn.addEventListener('click', () => runSearch(spInput.value));
  spInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') runSearch(spInput.value);
  });

  document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 's') { e.preventDefault(); searchOpen ? closeSearch() : openSearch(); }
  });
}

function renderSkeletons() {
  return `<div class="sp-loading">${[1,2,3].map(() => `
    <div class="sp-skel">
      <div class="sp-skel-line wide"></div>
      <div class="sp-skel-line full"></div>
      <div class="sp-skel-line narrow"></div>
    </div>`).join('')}</div>`;
}

function renderSearchResults(results, query, container) {
  if (!results.length) {
    container.innerHTML = `
      <div class="sp-empty-state">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1" opacity="0.2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <div class="sp-empty-text">No se encontraron resultados para "<strong>${escHtml(query)}</strong>".</div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">
      ${results.length} resultado${results.length !== 1 ? 's' : ''} para "<strong style="color:var(--text-2)">${escHtml(query)}</strong>"
    </div>
    ${results.map(r => `
      <div class="sp-result-card">
        <div class="sp-result-title">${escHtml(r.title)}</div>
        <div class="sp-result-snippet">${escHtml(r.snippet)}</div>
        <div class="sp-result-meta">
          <span class="sp-result-tag">${escHtml(r.category)}</span>
          ${r.tags.map(t => `<span style="color:var(--text-3)">#${escHtml(t)}</span>`).join(' ')}
        </div>
      </div>`).join('')}`;
}

// ── Toast Notifications ───────────────────────────────────────
function initToastContainer() {
  // ya está en el HTML
}

function showToast(msg, type = 'info') {
  const container = $('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ── Utils ─────────────────────────────────────────────────────
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
  if (diff < 3600) return Math.floor(diff/60) + 'm';
  return Math.floor(diff/3600) + 'h';
}
function updateElapsedTimes() { renderConvList(); }
function escHtml(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s = '') {
  return String(s).replace(/'/g,"\\'").replace(/\n/g,' ');
}
function setWsStatus(status) {
  const el = $('wsStatus');
  el.className = `azure-status ${status}`;
  const label = el.querySelector('.azure-status-label');
  if (label) {
    label.textContent = status === 'connected' ? 'Estado de la conexión' : 'Sin conexión Azure';
  }
  el.title = status === 'connected' ? 'Conectado a Azure · WebSocket activo' : 'Desconectado de Azure';
}

window.openConv = openConv;