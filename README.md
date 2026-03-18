# 🎯 Unified Response Hub

Hub centralizado de conversaciones multicanal para equipos de soporte.  
Integra **WhatsApp**, **Microsoft Teams** y **Web Widget** en un único panel de agente.

```
┌─────────────────────────────────────────────────────────────────┐
│                    UNIFIED RESPONSE HUB                         │
├───────────────┬──────────────────────────┬──────────────────────┤
│  SIDEBAR      │      CHAT (agente)        │   INFO PANEL        │
│  Cola convs   │  Historial bot + en vivo  │   Cliente / Tags    │
│  WA/Teams/Web │  Input del agente         │   Quick replies     │
└───────────────┴──────────────────────────┴──────────────────────┘
```

---

## 🏗 Arquitectura

```
  WhatsApp ─────────────────────────────────────────────┐
  (Meta Webhook)                                         │
                                                         ▼
  Teams ──→ Azure Bot Service ──→ Bot (bot/index.js)  ──→  Power Automate
  (Bot Framework)                   │                       (Webhook)
                                    │ transfer                 │
  Web Widget ──→ /api/messages/test  │                         │
                                    └─────────────────────────▼
                                                    backend/server.js
                                                    (Node + Express + WS)
                                                         │
                                              ┌──────────┴──────────┐
                                              │    Hub Frontend      │
                                              │  (Agent Dashboard)   │
                                              │  WebSocket tiempo    │
                                              │  real agente↔usuario │
                                              └──────────────────────┘
```

---

## 📁 Estructura del proyecto

```
unified-response-hub/
├── backend/                   # Servidor Node.js
│   ├── server.js              # Punto de entrada principal
│   ├── package.json
│   ├── .env.example           # Variables de entorno (copia a .env)
│   ├── routes/
│   │   ├── conversations.routes.js   # REST API de conversaciones
│   │   ├── webhook.routes.js         # Webhooks WA + Power Automate
│   │   ├── bot.routes.js             # Azure Bot Framework endpoint
│   │   └── agents.routes.js          # Gestión de agentes
│   └── services/
│       ├── store.js                   # Store en memoria (→ Cosmos DB)
│       └── websocket.service.js       # WS: agente ↔ usuario en tiempo real
│
├── frontend/                  # UI del agente (HTML/CSS/JS vanilla)
│   ├── index.html             # Dashboard principal
│   ├── widget.html            # Web widget (se embebe en webs de clientes)
│   ├── css/
│   │   └── app.css
│   └── js/
│       └── app.js
│
├── bot/                       # Bot de Azure independiente
│   ├── index.js               # Bot con lógica de transfer
│   └── package.json
│
└── flows/
    └── bot-transfer-to-hub.flow.json   # Flujo Power Automate
```

---

## 🚀 Inicio rápido (desarrollo local)

### 1. Instalar dependencias

```bash
# Backend
cd backend && npm install

# Bot (opcional en dev)
cd ../bot && npm install
```

### 2. Configurar variables de entorno

```bash
cd backend
cp .env.example .env
# Edita .env con tus valores
```

### 3. Arrancar el servidor

```bash
cd backend
npm run dev
```

Abre `http://localhost:3001` → verás el hub con datos demo.

### 4. Probar el bot (sin Azure)

El endpoint `/api/messages/test` simula el bot sin necesitar credenciales Azure:

```bash
curl -X POST http://localhost:3001/api/messages/test \
  -H "Content-Type: application/json" \
  -d '{"userId":"u1","userName":"Test","text":"quiero hablar con un agente","channel":"web"}'
```

### 5. Simular una transferencia desde bot

```bash
curl -X POST http://localhost:3001/webhook/power-automate \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: tu_secreto" \
  -d '{
    "event": "bot.transfer",
    "conversationId": "test-conv-999",
    "channel": "web",
    "userId": "user-test",
    "userName": "Pepe Prueba",
    "topic": "Consulta de prueba",
    "messages": [
      {"from":"bot","text":"Hola","timestamp":"2024-01-01T10:00:00Z"},
      {"from":"user","text":"quiero un agente","timestamp":"2024-01-01T10:01:00Z"}
    ]
  }'
```

---

## ⚙️ Configuración de canales en producción

### WhatsApp Business API

1. Crear cuenta en [Meta for Developers](https://developers.facebook.com)
2. Crear app de tipo Business
3. Añadir producto WhatsApp
4. Configurar webhook URL: `https://TU_DOMINIO/webhook/whatsapp`
5. Suscribirse al evento `messages`
6. Copiar `Phone Number ID` y `Access Token` al `.env`

### Microsoft Teams (Azure Bot Service)

1. Crear recurso **Azure Bot** en portal.azure.com
2. En el bot, ir a Canales → Microsoft Teams → Habilitar
3. Configurar Messaging Endpoint: `https://TU_DOMINIO/api/messages`
4. Copiar App ID y App Password al `.env`
5. Arrancar `bot/index.js` (o apuntar el endpoint al backend directamente)

### Power Automate

1. Importar `flows/bot-transfer-to-hub.flow.json`
2. Reemplazar las variables indicadas en el JSON
3. Copiar la URL del trigger HTTP al `.env` como `POWER_AUTOMATE_WEBHOOK_URL`

### Web Widget (embeber en cualquier web)

```html
<!-- Añadir al final del <body> de cualquier página -->
<script>
  const iframe = document.createElement('iframe');
  iframe.src    = 'https://TU_DOMINIO/widget.html';
  iframe.style  = 'position:fixed;bottom:20px;right:20px;width:340px;height:480px;border:none;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.3);z-index:9999';
  document.body.appendChild(iframe);
</script>
```

---

## 🔌 API REST

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/conversations` | Lista conversaciones (filtros: `?channel=whatsapp&status=pending`) |
| GET | `/api/conversations/stats` | Estadísticas del hub |
| GET | `/api/conversations/:id` | Detalle de una conversación |
| POST | `/api/conversations` | Crear conversación manualmente |
| POST | `/api/conversations/:id/messages` | Añadir mensaje |
| PATCH | `/api/conversations/:id/status` | Cambiar estado |
| POST | `/webhook/whatsapp` | Webhook de Meta (verificación GET incluida) |
| POST | `/webhook/power-automate` | Webhook de Power Automate / bot |
| POST | `/api/messages` | Endpoint Azure Bot Framework |
| POST | `/api/messages/test` | Probar bot sin Azure |
| GET | `/health` | Health check |

### WebSocket events (ws://host/ws)

**Desde el agente al servidor:**
| Tipo | Descripción |
|------|-------------|
| `agent.join` | Identificarse como agente |
| `agent.message` | Enviar mensaje al usuario |
| `agent.take` | Tomar una conversación pendiente |
| `conversation.resolve` | Resolver conversación |
| `conversation.transfer` | Transferir a otro agente/cola |

**Desde el servidor al agente:**
| Tipo | Descripción |
|------|-------------|
| `message.new` | Nuevo mensaje en cualquier conversación |
| `conversation.updated` | Cambio de estado/agente |
| `conversation.resolved` | Conversación resuelta |
| `conversation.transferred` | Conversación transferida |
| `agent.online/disconnected` | Cambios de presencia de agentes |

---

## 💰 Estimación de costes (producción)

| Servicio | Tier recomendado | Coste/mes |
|----------|-----------------|-----------|
| Azure App Service | B2 (2 vCPU, 3.5GB) | ~55 € |
| Azure Bot Service | S1 (10k msg incluidos) | ~0 € |
| WhatsApp Business | Pay-per-conversation | ~0.05 €/conv |
| Power Automate | Premium per user | ~15 €/usuario |
| Azure Cosmos DB (opcional) | Serverless | ~10-30 € |
| **Total estimado** | **5-10 agentes** | **~100-150 €/mes** |

---

## 🗓 Timeline de implementación

| Fase | Descripción | Semanas |
|------|-------------|---------|
| 1 | Setup Azure + backend + hub básico | 1-2 |
| 2 | Canal WhatsApp + bot básico | 2-3 |
| 3 | Canal Teams + transferencia bot→hub | 1-2 |
| 4 | Web widget + Power Automate flows | 1 |
| 5 | Cosmos DB + autenticación agentes | 1-2 |
| 6 | Testing, staging, go-live | 1-2 |
| **Total** | | **7-12 semanas** |

---

## 🔧 Próximos pasos para producción

- [ ] Añadir autenticación de agentes (Azure AD / JWT)
- [ ] Reemplazar store.js por Azure Cosmos DB
- [ ] Añadir cola de prioridades (SLA timers)
- [ ] Métricas y dashboard de KPIs
- [ ] Notificaciones push para agentes (Service Worker)
- [ ] Grabación de sesiones y transcripciones
- [ ] Integración con CRM (Dynamics 365 / Salesforce)
- [ ] Multi-idioma (i18n)
- [ ] Tests automatizados (Jest + Playwright)
