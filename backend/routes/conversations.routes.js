/**
 * ================================================================
 * conversations.routes.js
 * GET/POST/PATCH /api/conversations
 * ================================================================
 */

const router = require('express').Router();
const {
  getAllConversations, getConversation,
  createConversation, addMessage,
  updateConversationStatus, getStats
} = require('../services/store');

// GET /api/conversations?channel=whatsapp&status=pending
router.get('/', (req, res) => {
  const { channel, status } = req.query;
  const filter = {};
  if (channel) filter.channel = channel;
  if (status)  filter.status  = status;
  res.json(getAllConversations(filter));
});

// GET /api/conversations/stats
router.get('/stats', (req, res) => {
  res.json(getStats());
});

// GET /api/conversations/:id
router.get('/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
  res.json(conv);
});

// POST /api/conversations — crear manualmente (o desde bot)
router.post('/', (req, res) => {
  const { channel, userId, userName, topic, messages } = req.body;
  if (!channel || !userId) {
    return res.status(400).json({ error: 'channel y userId son requeridos' });
  }
  const conv = createConversation({ channel, userId, userName, topic, messages });
  res.status(201).json(conv);
});

// POST /api/conversations/:id/messages — agente añade mensaje vía REST
router.post('/:id/messages', (req, res) => {
  const { role, text } = req.body;
  if (!text) return res.status(400).json({ error: 'text es requerido' });
  const result = addMessage(req.params.id, { role: role || 'agent', text });
  if (!result) return res.status(404).json({ error: 'Conversación no encontrada' });
  res.status(201).json(result.msg);
});

// PATCH /api/conversations/:id/status
router.patch('/:id/status', (req, res) => {
  const { status, agentId } = req.body;
  const validStatuses = ['pending', 'active', 'waiting', 'resolved'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Estado inválido. Válidos: ${validStatuses.join(', ')}` });
  }
  const conv = updateConversationStatus(req.params.id, status, agentId);
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
  res.json(conv);
});

module.exports = router;
