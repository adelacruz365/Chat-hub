/**
 * ================================================================
 * bot/index.js — Bot de Azure independiente
 * ================================================================
 * Este bot corre como servicio separado (o en el mismo proceso).
 * Se registra en Azure Bot Service y recibe mensajes de:
 *  - Microsoft Teams (canal Teams)
 *  - Web Chat (Direct Line)
 *  - WhatsApp (a través de canal de terceros o webhook directo)
 * 
 * Cuando decide transferir al agente, llama al webhook de Power
 * Automate, que a su vez notifica al hub.
 * ================================================================
 * 
 * Despliegue:
 *   1. npm install en esta carpeta
 *   2. Configurar .env con tus credenciales Azure
 *   3. node index.js  (puerto 3978 por defecto)
 *   4. Exponer con ngrok: ngrok http 3978
 *   5. Registrar la URL en Azure Bot Service > Messaging endpoint:
 *      https://TU_NGROK.ngrok.io/api/messages
 * ================================================================
 */

require('dotenv').config({ path: '../backend/.env' });

const restify  = require('restify');
const botbuilder = require('botbuilder');
const axios    = require('axios');

// ─── Azure Bot Framework setup ────────────────────────────────
const adapter = new botbuilder.CloudAdapter(
  new botbuilder.ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId:       process.env.MICROSOFT_APP_ID,
    MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD,
  })
);

adapter.onTurnError = async (context, error) => {
  console.error('[Bot] Error:', error);
  await context.sendActivity('Lo siento, algo salió mal. Inténtalo de nuevo.');
};

// ─── Estado de conversaciones del bot ─────────────────────────
// Guarda si ya se pidió transfer para no repetir
const transferredConvs = new Set();

// Historial simple en memoria por conversationId
const histories = new Map();

// ─── Lógica del bot ───────────────────────────────────────────
const TRANSFER_PHRASES = [
  'hablar con', 'quiero un agente', 'hablar con humano', 'persona real',
  'soporte humano', 'operador', 'no entiendes', 'no me ayuda',
  'escalar', 'supervisor', 'responsable'
];

const bot = {
  async onTurn(context) {
    if (context.activity.type !== botbuilder.ActivityTypes.Message) return;

    const convId  = context.activity.conversation.id;
    const userId  = context.activity.from.id;
    const name    = context.activity.from.name || 'Usuario';
    const text    = context.activity.text?.trim() || '';
    const channel = context.activity.channelId;

    // Inicializar historial
    if (!histories.has(convId)) {
      histories.set(convId, []);
      await context.sendActivity(`¡Hola ${name}! Soy el asistente virtual. ¿En qué puedo ayudarte?`);
      return;
    }

    const history = histories.get(convId);
    history.push({ from: 'user', text, timestamp: new Date().toISOString() });

    // Si ya fue transferido, informar que hay un agente
    if (transferredConvs.has(convId)) {
      await context.sendActivity('Estás conectado con nuestro equipo. Un agente revisará tu consulta en breve.');
      return;
    }

    // Detectar intención de hablar con humano
    const wantsHuman = TRANSFER_PHRASES.some(p => text.toLowerCase().includes(p));
    const manyMessages = history.filter(m => m.from === 'user').length >= 4;

    if (wantsHuman || manyMessages) {
      await transferToHub(context, convId, userId, name, channel, history);
      transferredConvs.add(convId);
      return;
    }

    // Respuestas básicas del bot
    const reply = generateReply(text, name);
    history.push({ from: 'bot', text: reply, timestamp: new Date().toISOString() });
    await context.sendActivity(reply);
  }
};

function generateReply(text, name) {
  const t = text.toLowerCase();
  if (/hola|buenos|buenas/.test(t))      return `¡Hola ${name}! ¿En qué puedo ayudarte?`;
  if (/precio|plan|coste/.test(t))        return 'Tenemos planes Free, Pro (29€/mes) y Enterprise. ¿Cuál necesitas?';
  if (/contraseña|password|acceso/.test(t)) return 'Puedes resetear tu contraseña desde la pantalla de login → "¿Olvidaste tu contraseña?". ¿Funciona?';
  if (/factura|cobro|cargo/.test(t))      return 'Revisa Cuenta > Facturación. Si hay un error, cuéntame los detalles.';
  if (/api|webhook|integrac/.test(t))     return 'Nuestra documentación técnica está en https://docs.tu-empresa.com. ¿Qué integración necesitas?';
  if (/gracias/.test(t))                  return '¡De nada! ¿Hay algo más en lo que pueda ayudarte?';
  return '¿Podrías darme más detalles? También puedo conectarte con un agente si lo prefieres.';
}

async function transferToHub(context, convId, userId, userName, channel, history) {
  const pa_url = process.env.POWER_AUTOMATE_WEBHOOK_URL;

  // Aviso al usuario
  await context.sendActivity('Entendido, voy a conectarte con uno de nuestros agentes humanos. Un momento...');

  if (pa_url) {
    // Llamar a Power Automate con el historial completo
    try {
      await axios.post(pa_url, {
        event:          'bot.transfer',
        conversationId: convId,
        channel:        channel === 'msteams' ? 'teams' : channel,
        userId,
        userName,
        topic:          'Transferido desde bot',
        messages:       history,
        metadata: {
          serviceUrl:   context.activity.serviceUrl,
          teamsConvId:  convId
        }
      });
      console.log(`[Bot] Conversación transferida al hub: ${convId}`);
    } catch (err) {
      console.error('[Bot] Error llamando a Power Automate:', err.message);
      // Fallback: llamar directamente al hub
      try {
        await axios.post(`${process.env.FRONTEND_URL || 'http://localhost:3001'}/webhook/power-automate`, {
          event: 'bot.transfer',
          conversationId: convId,
          channel: channel === 'msteams' ? 'teams' : channel,
          userId, userName,
          topic: 'Transferido desde bot',
          messages: history,
          metadata: { serviceUrl: context.activity.serviceUrl, teamsConvId: convId }
        }, { headers: { 'x-webhook-secret': process.env.WEBHOOK_SECRET || '' } });
      } catch (e2) {
        console.error('[Bot] Fallback también falló:', e2.message);
      }
    }
  } else {
    // Dev: llamar directamente al backend
    console.warn('[Bot] POWER_AUTOMATE_WEBHOOK_URL no configurado. Llamando al backend directamente.');
  }
}

// ─── Servidor HTTP ────────────────────────────────────────────
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

server.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, (context) => bot.onTurn(context));
});

server.get('/health', (req, res) => {
  res.send({ status: 'ok', bot: 'running' });
});

const PORT = process.env.BOT_PORT || 3978;
server.listen(PORT, () => {
  console.log(`\n🤖 Bot de Azure corriendo en http://localhost:${PORT}`);
  console.log(`📡 Endpoint: http://localhost:${PORT}/api/messages`);
  console.log(`🌐 Registra en Azure Bot Service con ngrok: ngrok http ${PORT}\n`);
});
