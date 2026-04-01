/**
 * ================================================================
 * store.js - Almacén en memoria
 * ================================================================
 * En producción, reemplaza este módulo por llamadas a Cosmos DB.
 * La interfaz pública (funciones exportadas) no cambia,
 * así que el resto del código no necesita modificarse.
 * ================================================================
 */

const { v4: uuidv4 } = require('uuid');

// ─── Datos ────────────────────────────────────────────────────
const conversations = new Map();
const agents        = new Map();

// ─── Datos demo para arrancar el hub con contenido ────────────
function seedDemoData() {
  const demoConvs = [
    {
      id: 'conv-001',
      channel: 'whatsapp',
      status: 'pending',
      userId: 'wa-34612345678',
      userName: 'María García',
      userPhone: '+34 612 345 678',
      topic: 'Problema con facturación',
      tags: ['Facturación', 'Urgente', 'Pro Plan'],
      assignedTo: null,
      createdAt: new Date(Date.now() - 8 * 60000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 60000).toISOString(),
      messages: [
        { id: uuidv4(), role: 'bot',  text: 'Hola María, soy el asistente virtual. ¿En qué puedo ayudarte hoy?', timestamp: new Date(Date.now() - 8*60000).toISOString() },
        { id: uuidv4(), role: 'user', text: 'Hola, tengo un problema con mi facturación. Me están cobrando dos veces este mes.', timestamp: new Date(Date.now() - 7*60000).toISOString() },
        { id: uuidv4(), role: 'bot',  text: 'Entiendo tu preocupación. ¿Podrías confirmarme tu email de registro?', timestamp: new Date(Date.now() - 6*60000).toISOString() },
        { id: uuidv4(), role: 'user', text: 'Claro, es maria.garcia@ejemplo.com', timestamp: new Date(Date.now() - 5*60000).toISOString() },
        { id: uuidv4(), role: 'bot',  text: 'He revisado tu cuenta y veo una incidencia. Voy a transferirte con un agente especializado.', timestamp: new Date(Date.now() - 4*60000).toISOString() },
        { id: uuidv4(), role: 'system', text: '🤖 Bot transfirió la conversación a la cola de agentes', timestamp: new Date(Date.now() - 4*60000).toISOString() },
        { id: uuidv4(), role: 'user', text: 'Llevo esperando 2 minutos... ¿hay alguien?', timestamp: new Date(Date.now() - 2*60000).toISOString() },
      ]
    },
    {
      id: 'conv-002',
      channel: 'teams',
      status: 'active',
      userId: 'teams-carlos.lopez@empresa.com',
      userName: 'Carlos López',
      userEmail: 'carlos.lopez@empresa.com',
      topic: 'Integración API / Webhook',
      tags: ['Técnico', 'API', 'Enterprise'],
      assignedTo: 'agent-001',
      createdAt: new Date(Date.now() - 15*60000).toISOString(),
      updatedAt: new Date(Date.now() - 1*60000).toISOString(),
      messages: [
        { id: uuidv4(), role: 'bot',  text: '¡Hola Carlos! Soy el asistente de soporte técnico. ¿Cómo puedo ayudarte?', timestamp: new Date(Date.now() - 15*60000).toISOString() },
        { id: uuidv4(), role: 'user', text: 'Necesito integrar vuestro webhook en nuestro pipeline de Power Automate.', timestamp: new Date(Date.now() - 14*60000).toISOString() },
        { id: uuidv4(), role: 'bot',  text: 'Claro, ¿para qué evento quieres configurar el webhook?', timestamp: new Date(Date.now() - 13*60000).toISOString() },
        { id: uuidv4(), role: 'user', text: 'Para recibir notificación cuando una conversación sea resuelta o transferida.', timestamp: new Date(Date.now() - 12*60000).toISOString() },
        { id: uuidv4(), role: 'system', text: '🤖 Bot transfirió la conversación — solicitud técnica avanzada', timestamp: new Date(Date.now() - 11*60000).toISOString() },
        { id: uuidv4(), role: 'agent', text: 'Hola Carlos, soy Ana del equipo de integraciones. Los eventos disponibles son: conversation.resolved, conversation.transferred, conversation.created y message.received.', timestamp: new Date(Date.now() - 10*60000).toISOString() },
        { id: uuidv4(), role: 'user', text: '¿Cómo configuro la autenticación del webhook?', timestamp: new Date(Date.now() - 1*60000).toISOString() },
      ]
    },
    {
      id: 'conv-003',
      channel: 'web',
      status: 'pending',
      userId: 'web-session-abc123',
      userName: 'Laura Martínez',
      topic: 'Consulta upgrade de plan',
      tags: ['Upgrade', 'Sales', 'Pro → Enterprise'],
      assignedTo: null,
      createdAt: new Date(Date.now() - 25*60000).toISOString(),
      updatedAt: new Date(Date.now() - 5*60000).toISOString(),
      messages: [
        { id: uuidv4(), role: 'bot',  text: 'Hola, ¿en qué puedo ayudarte hoy?', timestamp: new Date(Date.now() - 25*60000).toISOString() },
        { id: uuidv4(), role: 'user', text: 'Estoy en el plan Pro y me gustaría saber qué incluye el Enterprise.', timestamp: new Date(Date.now() - 23*60000).toISOString() },
        { id: uuidv4(), role: 'bot',  text: 'El plan Enterprise incluye: usuarios ilimitados, SLA 99.9%, SSO, soporte 24/7 y on-premise. ¿Te interesa alguna característica?', timestamp: new Date(Date.now() - 22*60000).toISOString() },
        { id: uuidv4(), role: 'user', text: 'Sí, el SSO y el on-premise. Somos 150 personas. ¿Qué precio tendría?', timestamp: new Date(Date.now() - 20*60000).toISOString() },
        { id: uuidv4(), role: 'bot',  text: 'Para ese volumen el precio es personalizado. Voy a conectarte con un especialista de ventas.', timestamp: new Date(Date.now() - 19*60000).toISOString() },
        { id: uuidv4(), role: 'system', text: '🤖 Bot transfirió la conversación a Sales', timestamp: new Date(Date.now() - 18*60000).toISOString() },
      ]
    },
    {
      id: 'conv-004',
      channel: 'whatsapp',
      status: 'waiting',
      userId: 'wa-34698765432',
      userName: 'Unai Martinez',
      userPhone: '+34 698 765 432',
      topic: 'Reseteo de contraseña',
      tags: ['Contraseña', 'Acceso', 'Urgente'],
      assignedTo: null,
      createdAt: new Date(Date.now() - 40*60000).toISOString(),
      updatedAt: new Date(Date.now() - 15*60000).toISOString(),
      messages: [
        { id: uuidv4(), role: 'user', text: 'No puedo acceder a mi cuenta. Me dice contraseña incorrecta.', timestamp: new Date(Date.now() - 40*60000).toISOString() },
        { id: uuidv4(), role: 'bot',  text: '¿Has probado la opción "Olvidé mi contraseña"?', timestamp: new Date(Date.now() - 39*60000).toISOString() },
        { id: uuidv4(), role: 'user', text: 'Sí, pero no me llega el email de recuperación.', timestamp: new Date(Date.now() - 38*60000).toISOString() },
        { id: uuidv4(), role: 'bot',  text: 'Voy a escalarlo con un agente para verificar tu email y reenviar el enlace manualmente.', timestamp: new Date(Date.now() - 37*60000).toISOString() },
        { id: uuidv4(), role: 'system', text: '🤖 Bot transfirió la conversación — sin email de recuperación', timestamp: new Date(Date.now() - 37*60000).toISOString() },
        { id: uuidv4(), role: 'user', text: 'Llevaré esperando 15 minutos...', timestamp: new Date(Date.now() - 15*60000).toISOString() },
      ]
    }
  ];

  demoConvs.forEach(c => conversations.set(c.id, c));

  // Agente demo
  agents.set('agent-001', {
    id: 'agent-001',
    name: 'Ana López',
    email: 'ana.lopez@empresa.com',
    status: 'online',
    activeConversations: ['conv-002'],
    connectedAt: new Date().toISOString()
  });
}

// ─── Conversations API ────────────────────────────────────────

function getAllConversations(filter = {}) {
  let result = Array.from(conversations.values());
  if (filter.channel) result = result.filter(c => c.channel === filter.channel);
  if (filter.status)  result = result.filter(c => c.status === filter.status);
  return result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getConversation(id) {
  return conversations.get(id) || null;
}

function createConversation(data) {
  const conv = {
    id: data.id || uuidv4(),
    channel: data.channel,
    status: 'pending',
    userId: data.userId,
    userName: data.userName || 'Usuario',
    userPhone: data.userPhone || null,
    userEmail: data.userEmail || null,
    topic: data.topic || 'Sin tema',
    tags: data.tags || [],
    assignedTo: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: data.messages || [],
    metadata: data.metadata || {}
  };
  conversations.set(conv.id, conv);
  return conv;
}

function addMessage(convId, message) {
  const conv = conversations.get(convId);
  if (!conv) return null;
  const msg = {
    id: uuidv4(),
    role: message.role,
    text: message.text,
    timestamp: new Date().toISOString(),
    metadata: message.metadata || {}
  };
  conv.messages.push(msg);
  conv.updatedAt = new Date().toISOString();
  return { conv, msg };
}

function updateConversationStatus(convId, status, agentId = null) {
  const conv = conversations.get(convId);
  if (!conv) return null;
  conv.status = status;
  if (agentId) conv.assignedTo = agentId;
  conv.updatedAt = new Date().toISOString();
  return conv;
}

function deleteConversation(convId) {
  return conversations.delete(convId);
}

// ─── Agents API ───────────────────────────────────────────────

function getAgent(id) {
  return agents.get(id) || null;
}

function upsertAgent(data) {
  const existing = agents.get(data.id) || {};
  const agent = { ...existing, ...data, updatedAt: new Date().toISOString() };
  agents.set(agent.id, agent);
  return agent;
}

function getOnlineAgents() {
  return Array.from(agents.values()).filter(a => a.status === 'online');
}

// ─── Stats ────────────────────────────────────────────────────

function getStats() {
  const all = Array.from(conversations.values());
  return {
    active:    all.filter(c => c.status === 'active').length,
    pending:   all.filter(c => c.status === 'pending').length,
    waiting:   all.filter(c => c.status === 'waiting').length,
    resolved:  all.filter(c => c.status === 'resolved').length,
    total:     all.length,
    agents:    getOnlineAgents().length
  };
}

seedDemoData();
function createConversation(data) {
  conversations.set(data.id, data);
  return data;
}
module.exports = {
  getAllConversations, getConversation, createConversation,
  addMessage, updateConversationStatus, deleteConversation,
  getAgent, upsertAgent, getOnlineAgents, getStats
};
