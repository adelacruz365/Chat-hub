const express = require('express');
const router  = express.Router();
const { WebPubSubServiceClient } = require('@azure/web-pubsub');
// 1. CAMBIO: Importamos la función createConversation
const { addMessage, getConversation, createConversation } = require('../services/store');

const connectionString = process.env.PUB_SUB_CONNECTION_STRING;
const serviceClient = new WebPubSubServiceClient(connectionString, "Centro");

router.post('/copilot-escalate', async (req, res) => {
    const { userId, userName, lastIssue, channel } = req.body;
    const customerId = 'copilot-' + (userId || Math.floor(Math.random() * 10000));
    const finalUserName = userName || "Usuario de Teams";
    const finalIssue = lastIssue || "Solicita hablar con un agente";

    try {
        let conversation = getConversation(customerId);
        
        // 2. CAMBIO: Si no existe, usamos la función oficial del store para GUARDARLA de verdad
        if (!conversation) {
            conversation = createConversation({
                id: customerId,
                userId: customerId,
                userName: finalUserName,
                channel: channel || 'teams',
                topic: finalIssue,
                messages: []
            });
        }

        // 3. CAMBIO: Usamos la función oficial para añadir el mensaje
        addMessage(customerId, {
            role: "user",
            text: finalIssue
        });

        // 4. Recuperamos el chat actualizado con el mensaje para enviarlo a la web
        const chatActualizado = getConversation(customerId);

        console.log(`🚀 Enviando nuevo chat a la web (Hub: Centro): ${chatActualizado.id}`);

        const payload = JSON.stringify({
            type: "conversation.new",
            conversation: chatActualizado
        });

        await serviceClient.sendToAll(payload);        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("❌ Error en el Webhook:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;