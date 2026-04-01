require('dotenv').config();
const { WebPubSubServiceClient } = require('@azure/web-pubsub');

// 1. TU CADENA DE CONEXIÓN
const connectionString = process.env.PUB_SUB_CONNECTION_STRING;const hubName = "HubSoporte"; 

async function simularBot() {
    const serviceClient = new WebPubSubServiceClient(connectionString, hubName);

    // 2. CREAMOS UN JSON VÁLIDO PARA QUE TU APP.JS LO ENTIENDA
    const payload = JSON.stringify({
        type: "message.new",
        conversationId: "conv-002", 
        message: { 
            id: "msg-" + Date.now(),
            role: "user", 
            text: "¡Hola equipo! Soy un cliente real escribiendo a través de Azure Web PubSub." 
        }
    });

    console.log("Detectando métodos disponibles en tu versión del SDK...");
    
    try {
        // Hacemos "Duck Typing" para usar el método correcto según tu versión
        if (typeof serviceClient.sendToGroup === 'function') {
            await serviceClient.sendToGroup("Facturacion", payload);
            console.log("✅ Mensaje enviado usando sendToGroup()");
            
        } else if (typeof serviceClient.group === 'function') {
            await serviceClient.group("Facturacion").sendToAll(payload);
            console.log("✅ Mensaje enviado usando group().sendToAll()");
            
        } else {
            console.log("⚠️ Métodos reales del cliente:", Object.keys(Object.getPrototypeOf(serviceClient)));
            // Fallback de emergencia: Enviamos el mensaje a TODOS los técnicos conectados
            await serviceClient.sendToAll(payload);
            console.log("✅ Mensaje enviado a TODOS mediante sendToAll()");
        }
        
    } catch (err) {
        console.error("❌ Error interno al enviar:", err);
    }
}

simularBot();