/**
 * ================================================================
 * webhook.routes.js
 * Maneja webhooks entrantes de:
 *  - WhatsApp Business API (Meta)
 *  - Power Automate (desde los bots de Azure)
 *  - Azure Bot Framework direct line (opcional)
 * ================================================================
 */

const router  = require('express').Router();
const crypto  = require('crypto');
const { createConversation, getConversation, addMessage } = require('../services/store');
const { notifyPowerAutomate } = require('../services/websocket.service');

// ─── WhatsApp Business API ────────────────────────────────────

// Verificación del webhook (GET — Meta lo llama para verificar)
router.get('/whatsapp', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_TOKEN) {
    console.log('[WhatsApp] Webhook verificado correctamente');
    return res.status(200).send(challenge);
  }
  res.status(403).send('Verificación fallida');
});

// Mensajes entrantes de WhatsApp (POST)
router.post('/whatsapp', (req, res) => {
  // Responder 200 rápido para que Meta no reintente
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages) return;

    const waMsg  = value.messages[0];
    const from   = waMsg.from; // número de teléfono del usuario
    const text   = waMsg.text?.body || '[Mensaje no textual]';
    const convId = `wa-${from}`;

    // Buscar conversación existente o crear una nueva
    let conv = getConversation(convId);
    if (!conv) {
      const contact = value.contacts?.[0];
      conv = createConversation({
        id:       convId,
        channel:  'whatsapp',
        userId:   from,
        userName: contact?.profile?.name || `WA ${from}`,
        userPhone: `+${from}`,
        topic:    'Nueva consulta WhatsApp',
        tags:     ['WhatsApp']
      });
      console.log(`[WhatsApp] Nueva conversación creada: ${convId}`);
    }

    // Añadir el mensaje del usuario
    addMessage(convId, { role: 'user', text });

    // Si no tiene agente asignado, notificar a Power Automate para enrutar al bot
    if (!conv.assignedTo) {
      notifyPowerAutomate('message.received', {
        conversationId: convId,
        channel: 'whatsapp',
        userId: from,
        text
      });
    }

  } catch (err) {
    console.error('[WhatsApp] Error procesando webhook:', err.message);
  }
});

// ─── Power Automate / Azure Bot ───────────────────────────────

/**
 * Power Automate llama a este endpoint cuando el bot
 * decide transferir la conversación al hub de agentes.
 * 
 * Payload esperado:
 * {
 *   event: "bot.transfer",
 *   conversationId: "...",
 *   channel: "whatsapp|teams|web",
 *   userId: "...",
 *   userName: "...",
 *   topic: "...",
 *   tags: [...],
 *   messages: [...],  // historial del bot
 *   metadata: {}      // datos extra del canal
 * }
 */
router.post('/power-automate', (req, res) => {
  // Validar secreto de webhook
  const secret    = req.headers['x-webhook-secret'];
  const expected  = process.env.WEBHOOK_SECRET;
  if (expected && secret !== expected) {
    return res.status(401).json({ error: 'Secreto inválido' });
  }

  res.sendStatus(200); // Responder rápido

  const { event, conversationId, channel, userId, userName, topic, tags, messages, metadata } = req.body;

  console.log(`[PA] Evento recibido: ${event} — conv: ${conversationId}`);

  if (event === 'bot.transfer') {
    // Crear la conversación en el hub con todo el historial del bot
    const existing = getConversation(conversationId);
    if (!existing) {
      createConversation({
        id:       conversationId,
        channel:  channel || 'web',
        userId:   userId || conversationId,
        userName: userName || 'Usuario',
        topic:    topic || 'Transferido desde bot',
        tags:     tags || [],
        messages: (messages || []).map(m => ({
          role:      m.from === 'bot' ? 'bot' : m.from === 'agent' ? 'agent' : 'user',
          text:      m.text || m.content,
          timestamp: m.timestamp || new Date().toISOString()
        })),
        metadata: metadata || {}
      });
      console.log(`[PA] Conversación creada en hub: ${conversationId}`);
    } else {
      // Añadir mensaje de sistema indicando la transferencia
      addMessage(conversationId, {
        role: 'system',
        text: '🤖 Bot transfirió la conversación al hub de agentes'
      });
    }
  }

  if (event === 'message.from_bot') {
    // El bot añade un mensaje a una conversación existente
    if (conversationId && req.body.text) {
      addMessage(conversationId, { role: 'bot', text: req.body.text });
    }
  }
});

// ─── Webhook genérico para Teams (Azure Bot Service) ──────────
/**
 * Azure Bot Service redirige las actividades de Teams a este endpoint.
 * El bot (bot.routes.js) las procesa y puede hacer transfer al hub.
 */
router.post('/teams', (req, res) => {
  // Se delega a bot.routes.js que usa botbuilder
  res.sendStatus(200);
});

module.exports = router;
