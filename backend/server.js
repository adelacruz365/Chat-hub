/**
 * ================================================================
 * UNIFIED RESPONSE HUB - server.js
 * Punto de entrada principal del backend
 * ================================================================
 * 
 * Arquitectura:
 *  - Express HTTP para REST API + webhooks
 *  - WebSocket (ws) para comunicación en tiempo real agente <-> usuario
 *  - In-memory store (reemplazable por Cosmos DB)
 * ================================================================
 */

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const path       = require('path');

const { setupWebSocketServer } = require('./services/websocket.service');
const conversationRouter       = require('./routes/conversations.routes');
const webhookRouter            = require('./routes/webhook.routes');
const agentRouter              = require('./routes/agents.routes');
const botRouter                = require('./routes/bot.routes');

const app    = express();
const server = http.createServer(app);

// ─── Middleware ───────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP desactivado para servir el frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Servir frontend estático ─────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── API Routes ───────────────────────────────────────────────
app.use('/api/conversations', conversationRouter);
app.use('/api/agents',        agentRouter);
app.use('/webhook',           webhookRouter);   // WhatsApp + Power Automate
app.use('/api/messages',      botRouter);       // Azure Bot Framework endpoint

// ─── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── SPA fallback ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── WebSocket Server ─────────────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws' });
setupWebSocketServer(wss);

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n✅ Unified Response Hub corriendo en http://localhost:${PORT}`);
  console.log(`🔌 WebSocket disponible en ws://localhost:${PORT}/ws`);
  console.log(`📡 Webhook WhatsApp: http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`⚡ Webhook Power Automate: http://localhost:${PORT}/webhook/power-automate\n`);
});

module.exports = { app, server };
