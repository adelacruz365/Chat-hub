/**
 * ================================================================
 * websocket.service.js
 * ================================================================
 * Gestiona la comunicación en tiempo real:
 *  - Agentes conectados al hub (browser → ws)
 *  - Mensajes entrantes de usuarios (a través del store)
 *  - Broadcast de eventos a todos los agentes
 * ================================================================
 */

const { addMessage, getConversation, updateConversationStatus, upsertAgent } = require('./store');

// Map de conexiones WS activas: wsClient → { type, agentId, convId }
const connections = new Map();

function setupWebSocketServer(wss) {
  wss.on('connection', (ws, req) => {
    console.log(`[WS] Nueva conexión desde ${req.socket.remoteAddress}`);

    ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw); }
      catch { return ws.send(JSON.stringify({ type: 'error', message: 'JSON inválido' })); }

      handleMessage(ws, wss, data);
    });

    ws.on('close', () => {
      const meta = connections.get(ws);
      if (meta?.agentId) {
        upsertAgent({ id: meta.agentId, status: 'offline' });
        broadcast(wss, { type: 'agent.disconnected', agentId: meta.agentId });
        console.log(`[WS] Agente desconectado: ${meta.agentId}`);
      }
      connections.delete(ws);
    });

    ws.on('error', (err) => console.error('[WS] Error:', err.message));

    // Ping keepalive
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  // Heartbeat cada 30s
  const interval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  console.log('[WS] Servidor WebSocket inicializado');
}

function handleMessage(ws, wss, data) {
  switch (data.type) {

    // ── Agente se identifica al conectarse ──────────────────
    case 'agent.join': {
      const agent = upsertAgent({
        id: data.agentId,
        name: data.agentName || 'Agente',
        status: 'online',
        connectedAt: new Date().toISOString(),
        activeConversations: []
      });
      connections.set(ws, { type: 'agent', agentId: data.agentId });
      ws.send(JSON.stringify({ type: 'agent.joined', agent }));
      broadcast(wss, { type: 'agent.online', agent }, ws);
      console.log(`[WS] Agente conectado: ${data.agentId}`);
      break;
    }

    // ── Agente envía mensaje al usuario ─────────────────────
    case 'agent.message': {
      const { conversationId, text, agentId, agentName } = data;
      if (!conversationId || !text) break;

      const result = addMessage(conversationId, {
        role: 'agent',
        text,
        metadata: { agentId, agentName }
      });
      if (!result) break;

      // Broadcast a todos los agentes (para sincronizar el hub)
      broadcast(wss, {
        type: 'message.new',
        conversationId,
        message: result.msg
      });

      // Enviar al canal real del usuario (WA, Teams, Web)
      forwardToUserChannel(result.conv, result.msg);

      console.log(`[WS] Mensaje agente → usuario en conv ${conversationId}`);
      break;
    }

    // ── Agente abre/toma una conversación ───────────────────
    case 'agent.take': {
      const { conversationId, agentId } = data;
      const conv = updateConversationStatus(conversationId, 'active', agentId);
      if (!conv) break;

      addMessage(conversationId, {
        role: 'system',
        text: `✓ Agente ${data.agentName || agentId} se unió a la conversación`
      });

      broadcast(wss, {
        type: 'conversation.updated',
        conversationId,
        status: 'active',
        assignedTo: agentId
      });
      break;
    }

    // ── Agente resuelve una conversación ────────────────────
    case 'conversation.resolve': {
      const { conversationId, agentId } = data;
      const conv = updateConversationStatus(conversationId, 'resolved');
      if (!conv) break;

      addMessage(conversationId, {
        role: 'system',
        text: '✓ Conversación resuelta por el agente'
      });

      broadcast(wss, {
        type: 'conversation.resolved',
        conversationId
      });

      // Notificar a Power Automate
      notifyPowerAutomate('conversation.resolved', { conversationId, agentId });
      break;
    }

    // ── Agente transfiere conversación ──────────────────────
    case 'conversation.transfer': {
      const { conversationId, toAgentId } = data;
      const conv = updateConversationStatus(conversationId, 'pending', null);
      if (!conv) break;

      addMessage(conversationId, {
        role: 'system',
        text: `↔ Conversación transferida a ${toAgentId || 'la cola'}`
      });

      broadcast(wss, {
        type: 'conversation.transferred',
        conversationId,
        toAgentId
      });
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Tipo desconocido: ${data.type}` }));
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/** Envía a todos los clientes WS conectados (opcionalmente excluyendo uno) */
function broadcast(wss, payload, excludeWs = null) {
  const json = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(json);
    }
  });
}

/**
 * Reenvía el mensaje del agente al canal real del usuario.
 * Aquí es donde se llama a la WhatsApp API, Teams Bot, etc.
 */
async function forwardToUserChannel(conv, msg) {
  const axios = require('axios');
  try {
    switch (conv.channel) {
      case 'whatsapp':
        if (!conv.userPhone) break;
        await axios.post(
          `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: 'whatsapp',
            to: conv.userPhone.replace(/\D/g, ''),
            type: 'text',
            text: { body: msg.text }
          },
          { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
        );
        console.log(`[Channel] Mensaje enviado a WhatsApp: ${conv.userPhone}`);
        break;

      case 'teams':
        // Azure Bot Framework: se usa el serviceUrl + conversationId guardados
        if (conv.metadata?.serviceUrl && conv.metadata?.teamsConvId) {
          await axios.post(
            `${conv.metadata.serviceUrl}/v3/conversations/${conv.metadata.teamsConvId}/activities`,
            { type: 'message', text: msg.text },
            { headers: { Authorization: `Bearer ${await getBotToken()}` } }
          );
          console.log(`[Channel] Mensaje enviado a Teams: ${conv.metadata.teamsConvId}`);
        }
        break;

      case 'web':
        // El widget web recibe el mensaje por WS directamente desde el hub
        // (el widget también conecta a /ws con type:'widget')
        console.log(`[Channel] Mensaje para web widget conv ${conv.id} — vía WS`);
        break;
    }
  } catch (err) {
    console.error(`[Channel] Error enviando a ${conv.channel}:`, err.message);
  }
}

/** Obtiene token OAuth para Azure Bot Service */
async function getBotToken() {
  const axios = require('axios');
  const res = await axios.post(
    'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token',
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.MICROSOFT_APP_ID,
      client_secret: process.env.MICROSOFT_APP_PASSWORD,
      scope: 'https://api.botframework.com/.default'
    })
  );
  return res.data.access_token;
}

/** Llama al webhook de Power Automate con el evento */
async function notifyPowerAutomate(event, payload) {
  if (!process.env.POWER_AUTOMATE_WEBHOOK_URL) return;
  const axios = require('axios');
  try {
    await axios.post(process.env.POWER_AUTOMATE_WEBHOOK_URL, {
      event,
      timestamp: new Date().toISOString(),
      ...payload
    });
    console.log(`[PA] Notificado evento: ${event}`);
  } catch (err) {
    console.error('[PA] Error notificando Power Automate:', err.message);
  }
}

module.exports = { setupWebSocketServer, broadcast, notifyPowerAutomate };
