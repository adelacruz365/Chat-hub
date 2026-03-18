/**
 * ================================================================
 * bot.routes.js
 * Azure Bot Framework — procesa mensajes de Teams y Web Chat
 * ================================================================
 * 
 * POST /api/messages — endpoint estándar de Azure Bot Service
 * 
 * El bot tiene lógica simple: responde preguntas frecuentes
 * y cuando detecta intención de hablar con humano, hace transfer.
 * ================================================================
 */

const router = require('express').Router();

// Nota: botbuilder requiere credenciales reales de Azure para funcionar.
// En desarrollo local, el bot responde sin validación de tokens.

let adapter, ActivityHandler;
try {
  const botbuilder = require('botbuilder');
  ActivityHandler  = botbuilder.ActivityHandler;

  adapter = new botbuilder.CloudAdapter(
    new botbuilder.ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId:       process.env.MICROSOFT_APP_ID || '',
      MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD || '',
      MicrosoftAppType:     'SingleTenant'
    })
  );
} catch (e) {
  console.warn('[Bot] botbuilder no disponible — instala dependencias con npm install');
}

const { createConversation, getConversation, addMessage } = require('../services/store');
const { notifyPowerAutomate } = require('../services/websocket.service');

// ─── Lógica del bot ───────────────────────────────────────────

const TRANSFER_KEYWORDS = [
  'hablar con', 'agente', 'humano', 'persona', 'operador',
  'soporte', 'ayuda real', 'no entiendes', 'no funciona'
];

async function processMessage(userId, userName, channel, text, serviceUrl, teamsConvId) {
  const convId = `${channel}-${userId}`;
  let conv = getConversation(convId);

  if (!conv) {
    conv = createConversation({
      id:       convId,
      channel,
      userId,
      userName,
      topic:    'Nueva consulta',
      tags:     [channel.charAt(0).toUpperCase() + channel.slice(1)],
      metadata: { serviceUrl, teamsConvId }
    });
  }

  addMessage(convId, { role: 'user', text });

  // Detectar intención de transfer
  const wantsHuman = TRANSFER_KEYWORDS.some(kw =>
    text.toLowerCase().includes(kw)
  );

  if (wantsHuman || conv.messages.filter(m => m.role === 'user').length > 5) {
    // Transferir al hub
    addMessage(convId, {
      role: 'bot',
      text: 'Entendido, voy a conectarte con uno de nuestros agentes. Un momento por favor...'
    });
    addMessage(convId, {
      role: 'system',
      text: '🤖 Bot transfirió la conversación al hub de agentes'
    });

    notifyPowerAutomate('bot.transfer', {
      conversationId: convId,
      channel,
      userId,
      userName
    });

    return 'Entendido, voy a conectarte con uno de nuestros agentes. Un momento por favor...';
  }

  // Respuestas automáticas básicas
  const lowerText = text.toLowerCase();
  let response = '¿Podrías darme más detalles sobre tu consulta?';

  if (lowerText.includes('hola') || lowerText.includes('buenos') || lowerText.includes('buenas')) {
    response = `¡Hola ${userName}! Soy el asistente virtual. ¿En qué puedo ayudarte hoy?`;
  } else if (lowerText.includes('precio') || lowerText.includes('coste') || lowerText.includes('plan')) {
    response = 'Tenemos varios planes: Free (gratis), Pro (29€/mes) y Enterprise (precio personalizado). ¿Cuál se adapta mejor a tus necesidades?';
  } else if (lowerText.includes('contraseña') || lowerText.includes('acceso')) {
    response = 'Para resetear tu contraseña, ve a la página de login y haz clic en "¿Olvidaste tu contraseña?". ¿Has probado ese paso?';
  } else if (lowerText.includes('factura') || lowerText.includes('cobro') || lowerText.includes('pago')) {
    response = 'Para gestionar tu facturación, accede a Mi Cuenta > Facturación. Si hay algún error en el cobro, cuéntame los detalles y lo revisamos.';
  } else if (lowerText.includes('api') || lowerText.includes('integrac')) {
    response = 'Tenemos documentación completa de API en https://docs.ejemplo.com. ¿Qué tipo de integración necesitas?';
  }

  addMessage(convId, { role: 'bot', text: response });
  return response;
}

// ─── Azure Bot Framework endpoint ────────────────────────────

router.post('/', async (req, res) => {
  if (!adapter) {
    // Modo dev sin Azure — responder simulado
    return res.status(200).json({ reply: 'Bot en modo dev (sin Azure credentials)' });
  }

  await adapter.process(req, res, async (context) => {
    if (context.activity.type !== 'message') return;

    const userId    = context.activity.from.id;
    const userName  = context.activity.from.name || 'Usuario';
    const text      = context.activity.text || '';
    const channel   = context.activity.channelId || 'unknown';
    const serviceUrl = context.activity.serviceUrl;
    const teamsConvId = context.activity.conversation?.id;

    const reply = await processMessage(
      userId, userName, channel, text, serviceUrl, teamsConvId
    );

    await context.sendActivity(reply);
  });
});

// ─── Endpoint de prueba para desarrollo ───────────────────────

// POST /api/messages/test — simular mensaje sin Azure
router.post('/test', async (req, res) => {
  const { userId, userName, channel, text } = req.body;
  if (!userId || !text) {
    return res.status(400).json({ error: 'userId y text requeridos' });
  }
  const reply = await processMessage(
    userId,
    userName || 'Test User',
    channel || 'web',
    text,
    null,
    null
  );
  res.json({ reply, userId, channel: channel || 'web' });
});

module.exports = router;
