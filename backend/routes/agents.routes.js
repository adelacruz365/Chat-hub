/**
 * agents.routes.js
 * GET/PATCH /api/agents
 */
const router = require('express').Router();
const { getOnlineAgents, upsertAgent } = require('../services/store');

router.get('/', (req, res) => {
  res.json(getOnlineAgents());
});

router.post('/', (req, res) => {
  const { id, name, email } = req.body;
  if (!id) return res.status(400).json({ error: 'id requerido' });
  const agent = upsertAgent({ id, name, email, status: 'online' });
  res.status(201).json(agent);
});

module.exports = router;
