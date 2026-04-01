const { WebPubSubServiceClient } = require('@azure/web-pubsub');

// Tu cadena de conexión de Azure
const connectionString = process.env.PUB_SUB_CONNECTION_STRING;
const pubSubClient = new WebPubSubServiceClient(connectionString, "HubSoporte");

async function procesarWebhookEntrante() {
    console.log("1. Recibiendo POST webhook de WhatsApp/Web...");
    
    // Generamos un ID único para este nuevo chat
    const nuevoChatId = "conv-nueva-" + Math.floor(Math.random() * 10000);

    // --- PASO A: CREAR LA CONVERSACIÓN EN EL FRONTEND ---
    console.log("2. Avisando a los técnicos de que hay un nuevo chat...");
    const payloadConversacion = JSON.stringify({
        type: "conversation.new",
        conversation: {
            id: nuevoChatId,
            userName: "Cliente Real " + Math.floor(Math.random() * 100),
            status: "active",
            channel: "whatsapp", // O 'web', 'teams', etc.
            messages: []
        }
    });
    // Disparamos el evento al grupo Facturacion
    await pubSubClient.group("Facturacion").sendToAll(payloadConversacion);

    // --- PASO B: ENVIAR EL PRIMER MENSAJE DE ESE CHAT ---
    // Damos un pequeño respiro de 500ms para que el frontend dibuje la tarjeta primero
    setTimeout(async () => {
        console.log("3. Inyectando el mensaje del cliente en el chat...");
        const payloadMensaje = JSON.stringify({
            type: "message.new",
            conversationId: nuevoChatId,
            message: { 
                id: "msg-inicio",
                role: "user", 
                text: "¡Hola! Soy un cliente nuevo. Esta tarjeta de chat se acaba de crear mágicamente desde el backend. ¿Me ayudas con una factura?" 
            }
        });
        
        await pubSubClient.group("Facturacion").sendToAll(payloadMensaje);
        console.log("✅ Simulación completa. ¡Mira tu pantalla!");
    }, 500);
}

procesarWebhookEntrante();