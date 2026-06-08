const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, isLidUser, isPnUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const QRCode = require('qrcode');
const MessageFormatter = require('./messages');
const PaymentManager = require('./payments');

const EventEmitter = require('events');
const botEvents = new EventEmitter();
botEvents.setMaxListeners(50);

const logBuffer = [];
const MAX_LOGS = 500;
const stats = { messagesReceived: 0, messagesSent: 0, reconnects: 0, startTime: Date.now() };

function addLog(type, message, extra = {}) {
    const entry = { time: new Date().toISOString(), type, message, ...extra };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    botEvents.emit('log', entry);
    const ts = new Date().toLocaleTimeString('es-ES');
    const prefix = { info: '📋', msg_in: '📩', msg_out: '📤', error: '❌', warn: '⚠️', connected: '✅', qr: '📱', reconnect: '🔄', status: '🤖' }[type] || '📌';
    console.log(`[${ts}] ${prefix} ${message}`);
}

function getLogs() { return logBuffer; }
function getStats() {
    return { ...stats, uptime: Math.floor((Date.now() - stats.startTime) / 1000) };
}
function getBotEvents() { return botEvents; }

class WhatsAppBot {
    constructor(db) {
        this.db = db;
        this.messages = new MessageFormatter(db);
        this.payments = new PaymentManager(db);
        this.sock = null;
        this.isRunning = false;
        this.reconnectTimeout = null;
        this._reconnectAttempts = 0;
        this._maxReconnectAttempts = 10;
        this._starting = false;
        this.pendingPaymentSelection = {};
        this.cartCoupon = {};
        this.carts = {};
        this._connectionStatus = 'disconnected';
        this._latestQR = null;
        this._connectedPhone = null;
        this._statusChangeCallback = null;
    }

    setStatusCallback(cb) {
        this._statusChangeCallback = cb;
    }

    getConnectionStatus() {
        return {
            connected: this.isRunning,
            qr: this._latestQR,
            phone: this._connectedPhone,
            status: this._connectionStatus,
            stats: getStats(),
        };
    }

    async requestPairingCode(phoneNumber) {
        const cleanPhone = phoneNumber.replace(/[^\d]/g, '');
        if (cleanPhone.length < 7 || cleanPhone.length > 15) {
            throw new Error('Número inválido. Usa formato internacional, ej: 521234567890');
        }

        if (this.sock && this.isRunning) {
            throw new Error('El bot ya está conectado. Cierra sesión primero.');
        }

        addLog('info', 'Solicitando código de pairing...');
        const authDir = path.join(__dirname, '..', 'auth_info_baileys');
        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        if (this.sock) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
            this._connectionStatus = 'pairing';
        }

        const tempSock = makeWASocket({
            logger: pino({ level: 'silent' }),
            auth: state,
            printQRInTerminal: false,
            browser: ['WhatsBusiness', 'Chrome', '1.0.0'],
            markOnlineOnConnect: true,
            syncFullHistory: false,
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        const code = await tempSock.requestPairingCode(cleanPhone);
        addLog('info', `Código de pairing: ${code.match(/.{1,4}/g).join('-')}`);

        if (this.sock) {
            try { this.sock.end(new Error('Reemplazado por pairing')); } catch (e) {}
        }
        this.sock = tempSock;
        this._pairingCode = code;

        tempSock.ev.on('creds.update', saveCreds);

        tempSock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'open') {
                this.isRunning = true;
                this._connectionStatus = 'connected';
                try {
                    this._connectedPhone = this.extractPhone(tempSock.user?.id || '');
                } catch (e) {}
                addLog('connected', `WhatsApp conectado como +${this._connectedPhone}`);
            } else if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect && this._connectionStatus !== 'logged_out') {
                    this._connectionStatus = 'reconnecting';
                    this.isRunning = false;
                    stats.reconnects++;
                    addLog('reconnect', `Conexión cerrada, reconectando... (#${stats.reconnects})`);
                } else {
                    this.isRunning = false;
                    this._connectionStatus = 'disconnected';
                    addLog('warn', 'Sesión cerrada permanentemente');
                }
            }
        });

        tempSock.ev.on('messages.upsert', async (m) => {
            try {
                for (const msg of m.messages) {
                    await this.handleMessage(msg);
                }
            } catch (err) {
                addLog('error', `Error procesando mensaje: ${err.message}`);
            }
        });

        // Mostrar el código de pairing como QR en la terminal
        this._printQRToTerminal(code);

        const formatted = `${code}`.match(/.{1,4}/g).join('-');
        return formatted;
    }

    async logout() {
        addLog('info', 'Cerrando sesión de WhatsApp...');
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
        this._destroySocket();
        this.isRunning = false;
        this._connectionStatus = 'disconnected';
        this._latestQR = null;
        this._connectedPhone = null;
        const fs = require('fs');
        const authDir = path.join(__dirname, '..', 'auth_info_baileys');
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
        }
        addLog('status', 'Sesión cerrada y credenciales eliminadas');
    }

    _destroySocket() {
        if (this.sock) {
            try { this.sock.end(new Error('Reemplazado por nueva conexión')); } catch (e) {}
            this.sock = null;
        }
    }

    _getReconnectDelay() {
        const delay = Math.min(30000, 2000 * Math.pow(2, this._reconnectAttempts));
        this._reconnectAttempts++;
        return delay;
    }

    async start(onStatusChange) {
        if (this._starting) {
            addLog('warn', 'start() ya está en ejecución, ignorando llamada duplicada');
            return;
        }
        this._starting = true;

        try {
            this._destroySocket();
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;

            addLog('info', 'Iniciando bot de WhatsApp...');
            const authDir = path.join(__dirname, '..', 'auth_info_baileys');
            const { state, saveCreds } = await useMultiFileAuthState(authDir);

            this.sock = makeWASocket({
                logger: pino({ level: 'silent' }),
                auth: state,
                printQRInTerminal: false,
                browser: ['WhatsBusiness', 'Chrome', '1.0.0'],
                markOnlineOnConnect: true,
                syncFullHistory: false,
            });

            const socketRef = this.sock;

            this.sock.ev.on('creds.update', (creds) => {
                if (this.sock !== socketRef) return;
                saveCreds(creds);
            });

            this.sock.ev.on('connection.update', (update) => {
                if (this.sock !== socketRef) return;
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    this._latestQR = qr;
                    this._connectionStatus = 'qr';
                    addLog('qr', 'Código QR generado — escanea con WhatsApp Web');
                    if (onStatusChange) onStatusChange('qr', qr);
                    if (this._statusChangeCallback) this._statusChangeCallback('qr', qr);
                    // Mostrar QR como ASCII art en la terminal
                    this._printQRToTerminal(qr);
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    addLog('warn', `Conexión cerrada (código: ${statusCode ?? 'desconocido'})`);

                    const fatalReasons = [
                        DisconnectReason.loggedOut,
                        DisconnectReason.badSession,
                        DisconnectReason.connectionReplaced,
                    ];
                    const isFatal = fatalReasons.includes(statusCode);
                    const shouldReconnect = !isFatal && this._connectionStatus !== 'pairing';

                    if (!shouldReconnect && statusCode === DisconnectReason.connectionReplaced) {
                        addLog('error', 'Otra sesión de WhatsApp está activa en este número. Cierra WhatsApp Web en todos los dispositivos y vuelve a conectar.');
                    }

                    if (shouldReconnect) {
                        if (statusCode === DisconnectReason.restartRequired) {
                            this._reconnectAttempts = 0;
                        }

                        if (this._reconnectAttempts >= this._maxReconnectAttempts) {
                            this.isRunning = false;
                            this._connectionStatus = 'disconnected';
                            addLog('error', `Máximo de reconexiones alcanzado (${this._maxReconnectAttempts}). Sesión posiblemente corrupta.`);
                            if (onStatusChange) onStatusChange('disconnected', null);
                            if (this._statusChangeCallback) this._statusChangeCallback('disconnected', null);
                            return;
                        }

                        this._connectionStatus = 'reconnecting';
                        stats.reconnects++;
                        const delay = this._getReconnectDelay();
                        addLog('reconnect', `Reconectando WhatsApp en ${Math.round(delay / 1000)}s... (#${stats.reconnects})`);
                        if (onStatusChange) onStatusChange('reconnecting', null);
                        if (this._statusChangeCallback) this._statusChangeCallback('reconnecting', null);
                        this.isRunning = false;
                        this.reconnectTimeout = setTimeout(() => this.start(onStatusChange), delay);
                    } else {
                        this.isRunning = false;
                        this._connectionStatus = 'logged_out';
                        this._latestQR = null;
                        addLog('warn', 'Sesión cerrada permanentemente. Elimina auth_info_baileys y vuelve a iniciar.');
                        if (onStatusChange) onStatusChange('logged_out', null);
                        if (this._statusChangeCallback) this._statusChangeCallback('logged_out', null);
                    }
                } else if (connection === 'open') {
                    this._reconnectAttempts = 0;
                    this.isRunning = true;
                    this._connectionStatus = 'connected';
                    try {
                        this._connectedPhone = this.extractPhone(this.sock.user?.id || '');
                    } catch (e) {}
                    addLog('connected', `WhatsApp conectado exitosamente como +${this._connectedPhone || 'desconocido'} — Bot ONLINE`);
                    if (onStatusChange) onStatusChange('connected', null);
                    if (this._statusChangeCallback) this._statusChangeCallback('connected', null);
                }
            });

            this.sock.ev.on('messages.upsert', async (m) => {
                if (this.sock !== socketRef) return;
                try {
                    for (const msg of m.messages) {
                        await this.handleMessage(msg);
                    }
                } catch (err) {
                    addLog('error', `Error procesando mensaje: ${err.message}`);
                }
            });

            addLog('info', 'Eventos del bot registrados correctamente');
        } catch (err) {
            addLog('error', `Error en start(): ${err.message}`);
        } finally {
            this._starting = false;
        }
    }

    async stop() {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
        this._destroySocket();
        this.isRunning = false;
        addLog('status', 'Bot detenido manualmente');
    }

    _printQRToTerminal(qrText) {
        // Renderiza el QR como ASCII art en la terminal
        QRCode.toString(qrText, { type: 'terminal', small: false }, (err, qrAscii) => {
            if (!err) {
                console.log('');
                console.log('╔══════════════════════════════════════════╗');
                console.log('║   📱 ESCANEA ESTE QR CON WHATSAPP WEB    ║');
                console.log('╚══════════════════════════════════════════╝');
                console.log(qrAscii);
                console.log('');
            }
        });
    }

    extractPhone(jid) {
        return jid.split(':')[0].replace(/@s\.whatsapp\.net$/, '').replace(/@lid$/, '');
    }

    async resolvePhoneFromJid(jid) {
        if (isPnUser(jid)) {
            return this.extractPhone(jid);
        }
        if (isLidUser(jid) && this.sock?.signalRepository?.lidMapping) {
            try {
                const pn = await this.sock.signalRepository.lidMapping.getPNForLID(jid);
                if (pn && isPnUser(pn)) {
                    return this.extractPhone(pn);
                }
            } catch (e) {
                addLog('warn', `No se pudo resolver LID a teléfono: ${e.message}`);
            }
        }
        return this.extractPhone(jid);
    }

    async handleMessage(msg) {
        if (!msg || !msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;

        if (remoteJid.endsWith('@g.us')) {
            addLog('msg_in', `Mensaje ignorado (grupo): ${remoteJid}`);
            return;
        }

        if (!isPnUser(remoteJid) && !isLidUser(remoteJid)) {
            addLog('msg_in', `Mensaje ignorado (chat no soportado): ${remoteJid}`);
            return;
        }

        const senderName = msg.pushName || 'Usuario';
        const phone = await this.resolvePhoneFromJid(remoteJid);
        const text = msg.message.conversation
            || msg.message.extendedTextMessage?.text
            || msg.message.imageMessage?.caption
            || '';

        stats.messagesReceived++;
        addLog('msg_in', `De: ${senderName} (${phone}) — "${text || '(sin texto)'}"`, { from: phone, senderName });

        const user = this.db.createUser(remoteJid, senderName, phone);
        this.db.updateUserInteraction(remoteJid);

        const input = text.trim().toLowerCase();

        if (!input) {
            await this.sendWelcome(remoteJid, user);
            return;
        }

        if (this.pendingPaymentSelection[remoteJid]) {
            const orderData = this.pendingPaymentSelection[remoteJid];
            if (input === 'pagado') {
                await this.handlePaidConfirmation(remoteJid, user, orderData);
                return;
            }
            const result = await this.payments.processPaymentSelection(orderData.order, input, this.db.getSetting('currency') || 'MXN');
            if (result.success) {
                delete this.pendingPaymentSelection[remoteJid];
                await this.sendMessage(remoteJid, result.message);
                await this.notifyOwnerOrder(orderData.order, user, result);
            } else {
                await this.sendMessage(remoteJid, result.message);
            }
            return;
        }

        if (input === 'hola' || input === 'menu' || input === 'menú' || input === 'ayuda' || input === 'help' || input === 'buenas' || input === 'inicio') {
            await this.sendHelp(remoteJid, senderName);
        } else if (input === 'productos' || input === 'catalogo' || input === 'catálogo' || input === 'lista') {
            await this.sendCatalog(remoteJid);
        } else if (input === 'pedido' || input === 'mi pedido' || input === 'estado' || input === 'pedidos') {
            await this.sendOrderStatus(remoteJid, user);
        } else if (input === 'pagado') {
            await this.handlePaidConfirmation(remoteJid, user, null);
        } else if (input === 'terminar' || input === 'finalizar' || input === 'checkout' || input === 'comprar') {
            await this.checkout(remoteJid, user);
        } else if (input === 'carrito' || input === 'mi carrito') {
            await this.showCart(remoteJid);
        } else if (input === 'vaciar' || input === 'limpiar') {
            await this.clearCart(remoteJid);
        } else if (input.startsWith('agrega ') || input.startsWith('agregar ') || input.startsWith('añade ') || input.startsWith('añadir ')) {
            await this.addToCart(remoteJid, user, input);
        } else if (input.startsWith('quiero ') || input.startsWith('quisiera ') || input.startsWith('necesito ')) {
            await this.addToCart(remoteJid, user, input);
        } else if (input.startsWith('ver ') || input.startsWith('foto ') || input.startsWith('imagen ') || input.startsWith('mostrar ')) {
            await this.showProductDetail(remoteJid, input);
        } else if (input.startsWith('quitar ') || input.startsWith('quita ') || input.startsWith('elimina ')) {
            await this.removeFromCart(remoteJid, input);
        } else if (input.startsWith('rastrear') || input.startsWith('seguimiento') || input.startsWith('tracking')) {
            await this.sendTrackingInfo(remoteJid, user);
        } else if (input.startsWith('cupon ') || input.startsWith('cupón ') || input.startsWith('codigo ')) {
            await this.applyCoupon(remoteJid, user, input);
        } else if (input.startsWith('calificar ') || input.startsWith('puntuar ') || input.startsWith('valorar ')) {
            await this.addReview(remoteJid, user, input);
        } else if (input === 'estadisticas' || input === 'stats' || input === 'estado' || input === 'info') {
            await this.sendSystemStats(remoteJid);
        } else if (input === 'gracias' || input === 'thanks') {
            await this.sendMessage(remoteJid, '¡De nada! 😊 Estoy aquí para ayudarte. Si necesitas algo más, solo escríbeme.');
        } else if (!isNaN(input) && input.length <= 2) {
            const lastOrders = this.db.getUserOrders(user.id);
            if (lastOrders.length > 0 && lastOrders[0].payment_status === 'unpaid') {
                const result = await this.payments.processPaymentSelection(lastOrders[0], input, this.db.getSetting('currency') || 'MXN');
                if (result.success) {
                    await this.sendMessage(remoteJid, result.message);
                    await this.notifyOwnerOrder(lastOrders[0], user, result);
                } else {
                    await this.sendMessage(remoteJid, result.message);
                }
            } else {
                await this.sendMessage(remoteJid,
                    `Hola *${senderName}* 👋\n\nNo entendí tu mensaje. Escribe *"ayuda"* para ver los comandos disponibles.`
                );
            }
        } else {
            const product = this.db.searchProduct(input);
            if (product) {
                await this.addToCart(remoteJid, user, `agrega ${product.name}`);
            } else {
                await this.sendMessage(remoteJid,
                    `Hola *${senderName}* 👋\n\nNo entendí tu mensaje. Escribe *"ayuda"* para ver los comandos disponibles.\n\n💡 *Tip:* Escribe *"productos"* para ver el catálogo o *"agrega [producto]"* para añadir al carrito.`
                );
            }
        }
    }

    async sendWelcome(jid, user) {
        const productsCount = this.db.getProducts().length;
        if (productsCount === 0) {
            const msg = this.messages.get('greeting_no_products', { name: user.name || 'Usuario' });
            await this.sendMessage(jid, msg);
        } else {
            const msg = this.messages.get('welcome_message', { name: user.name || 'Usuario' });
            await this.sendMessage(jid, msg);
        }
    }

    async sendHelp(jid, name) {
        const msg = this.messages.get('help_message', { name });
        await this.sendMessage(jid, msg);
        await this.sendMessage(jid,
            `🛒 *Comandos del Carrito:*\n` +
            `• *agrega [producto]* — Añadir al carrito\n` +
            `• *ver [producto]* — Ver detalle con foto 📸\n` +
            `• *foto [producto]* — Ver imagen del producto\n` +
            `• *carrito* — Ver mi carrito\n` +
            `• *quitar [producto]* — Quitar del carrito\n` +
            `• *vaciar* — Vaciar carrito\n` +
            `• *terminar* — Finalizar pedido 💳`
        );
    }

    async sendCatalog(jid) {
        const products = this.db.getProducts();
        if (products.length === 0) {
            await this.sendMessage(jid, '📭 *No hay productos disponibles* en este momento. ¡Vuelve pronto!');
            return;
        }

        const currency = this.db.getSetting('currency') || 'MXN';
        const symbol = this.payments.getCurrencySymbol(currency);
        const productList = this.messages.formatProductList(products, currency);

        const msg = this.messages.get('catalog_message', {
            products: productList,
            example: products[0]?.name || 'Producto',
        });

        if (msg.length > 4000) {
            const parts = this.splitMessage(msg);
            for (const part of parts) {
                await this.sendMessage(jid, part);
            }
        } else {
            await this.sendMessage(jid, msg);
        }

        for (const product of products) {
            if (product.image_url) {
                let caption = `📸 *${product.name}*\n`;
                if (product.description) caption += `${product.description}\n`;
                caption += `\n💰 *Precio:* ${symbol}${product.price.toFixed(2)}`;
                caption += `\n📂 *Categoría:* ${product.category}`;
                caption += `\n\n📌 Para ver más detalles, escribe *ver ${product.name}*`;
                caption += `\n📌 Para agregar al carrito, escribe *agrega ${product.name}*`;
                await this.sendImage(jid, product.image_url, caption);
            }
        }
    }

    async showProductDetail(jid, input) {
        const query = input.replace(/^(ver|foto|imagen|mostrar)\s+/i, '').trim();
        let product;
        if (!isNaN(query)) {
            product = this.db.getProduct(parseInt(query));
        } else {
            product = this.db.searchProduct(query);
        }

        if (!product) {
            await this.sendMessage(jid, `❌ Producto "${query}" no encontrado. Escribe *"productos"* para ver el catálogo.`);
            return;
        }

        const currency = this.db.getSetting('currency') || 'MXN';
        const symbol = this.payments.getCurrencySymbol(currency);

        let text = `*${product.name}*\n\n`;
        if (product.description) text += `${product.description}\n\n`;
        text += `💰 *Precio:* ${symbol}${product.price.toFixed(2)}\n`;
        text += `📂 *Categoría:* ${product.category}\n\n`;
        text += `📌 Para agregarlo a tu carrito, escribe:\n*"agrega ${product.name}"* o *"quiero ${product.name}"*`;

        if (product.image_url) {
            await this.sendImage(jid, product.image_url, text);
        } else {
            await this.sendMessage(jid, text);
        }
    }

    getCart(jid) {
        return this.carts[jid] || [];
    }

    async addToCart(jid, user, input) {
        const prefixes = ['agrega ', 'agregar ', 'añade ', 'añadir ', 'quiero ', 'quisiera ', 'necesito '];
        let query = input;
        for (const prefix of prefixes) {
            if (query.startsWith(prefix)) {
                query = query.slice(prefix.length);
                break;
            }
        }

        let quantity = 1;
        const qtyMatch = query.match(/^(\d+)\s+(.+)/) || query.match(/(.+)\s+(\d+)$/);
        if (qtyMatch) {
            if (!isNaN(qtyMatch[1])) {
                quantity = parseInt(qtyMatch[1]);
                query = qtyMatch[2];
            } else if (!isNaN(qtyMatch[2])) {
                quantity = parseInt(qtyMatch[2]);
                query = qtyMatch[1];
            }
        }

        const product = this.db.searchProduct(query.trim());
        if (!product) {
            await this.sendMessage(jid,
                `❌ *Producto no encontrado*\n\nNo encontré "${query.trim()}".\n\nEscribe *"productos"* para ver los disponibles.`
            );
            return;
        }

        quantity = Math.max(1, Math.min(quantity, 999));

        if (!this.carts[jid]) this.carts[jid] = [];
        const cart = this.carts[jid];
        const existing = cart.find(i => i.productId === product.id);

        if (existing) {
            existing.quantity += quantity;
        } else {
            cart.push({
                productId: product.id,
                name: product.name,
                price: product.price,
                quantity,
                description: product.description,
                image_url: product.image_url,
            });
        }

        const currency = this.db.getSetting('currency') || 'MXN';
        const symbol = this.payments.getCurrencySymbol(currency);
        const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

        await this.sendMessage(jid,
            `✅ *Agregado al carrito:* ${quantity}x ${product.name} — ${symbol}${(product.price * quantity).toFixed(2)}\n\n` +
            `🛒 *Total del carrito:* ${symbol}${cartTotal.toFixed(2)}\n\n` +
            `📌 Escribe *"terminar"* para finalizar tu pedido.\n` +
            `📌 Escribe *"carrito"* para ver tu carrito.\n` +
            `📌 Escribe *"productos"* para seguir viendo el catálogo.`
        );
    }

    async showCart(jid) {
        const cart = this.getCart(jid);
        if (cart.length === 0) {
            await this.sendMessage(jid, '🛒 *Tu carrito está vacío*\n\nEscribe *"productos"* para ver el catálogo y empezar a comprar.');
            return;
        }

        const currency = this.db.getSetting('currency') || 'MXN';
        const symbol = this.payments.getCurrencySymbol(currency);

        let text = `🛒 *Tu Carrito de Compras*\n\n`;
        let total = 0;
        for (const item of cart) {
            const subtotal = item.price * item.quantity;
            total += subtotal;
            text += `• ${item.quantity}x *${item.name}* — ${symbol}${subtotal.toFixed(2)}\n`;
        }
        text += `\n*Total:* ${symbol}${total.toFixed(2)}\n\n`;
        text += `📌 Escribe *"terminar"* para finalizar el pedido.\n`;
        text += `📌 Escribe *"vaciar"* para limpiar el carrito.`;

        await this.sendMessage(jid, text);
    }

    async removeFromCart(jid, input) {
        const query = input.replace(/^(quitar|quita|elimina|eliminar)\s+/i, '').trim();
        const cart = this.getCart(jid);

        const product = this.db.searchProduct(query);
        if (!product) {
            await this.sendMessage(jid, `❌ No encontré "${query}" en tu carrito.`);
            return;
        }

        const idx = cart.findIndex(i => i.productId === product.id);
        if (idx === -1) {
            await this.sendMessage(jid, `❌ *${product.name}* no está en tu carrito.`);
            return;
        }

        cart.splice(idx, 1);
        if (cart.length === 0) delete this.carts[jid];

        await this.sendMessage(jid, `🗑️ *${product.name}* eliminado del carrito.`);
    }

    async clearCart(jid) {
        delete this.carts[jid];
        await this.sendMessage(jid, '🗑️ *Carrito vaciado.*\n\nEscribe *"productos"* para ver el catálogo.');
    }

    async checkout(jid, user) {
        const cart = this.getCart(jid);
        if (cart.length === 0) {
            await this.sendMessage(jid, '🛒 *Tu carrito está vacío*\n\nAgrega productos con *"agrega [producto]"* o escribe *"productos"* para ver el catálogo.');
            return;
        }

        const currency = this.db.getSetting('currency') || 'MXN';
        const symbol = this.payments.getCurrencySymbol(currency);
        let total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
        let discountApplied = 0;
        let couponMsg = '';

        if (this.cartCoupon[jid]) {
            const { coupon, discount } = this.cartCoupon[jid];
            discountApplied = discount;
            total -= discount;
            this.db.useCoupon(coupon.id);
            couponMsg = `\n🏷️ *Cupón:* ${coupon.code} (-${symbol}${discount.toFixed(2)})`;
            delete this.cartCoupon[jid];
        }

        const items = cart.map(i => ({
            productId: i.productId,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
        }));

        const order = this.db.createOrder(user.id, items);

        if (discountApplied > 0) {
            this.db.updateOrderTotal(order.id, total);
        }

        delete this.carts[jid];

        let details = '';
        for (const item of order.items) {
            details += `• ${item.quantity}x *${item.product_name}* — ${symbol}${(item.quantity * item.unit_price).toFixed(2)}\n`;
        }

        const msg = this.messages.get('order_confirmation', {
            order_details: details.trim() + couponMsg,
            total: `${symbol}${total.toFixed(2)}${discountApplied > 0 ? ' (descuento incluido)' : ''}`,
            name: user.name || 'Usuario',
        });

        await this.sendMessage(jid, msg);

        const enabledMethods = this.payments.getEnabledMethods();
        if (enabledMethods.length > 0) {
            const paymentMsg = await this.payments.getPaymentOptionsMessage(order, currency);
            await this.sendMessage(jid, paymentMsg);
            this.pendingPaymentSelection[jid] = { order };
        } else {
            await this.notifyOwnerOrder(order, user, null);
        }
    }

    async handlePaidConfirmation(jid, user, orderData) {
        const order = orderData?.order
            || this.db.getUserOrders(user.id).find(o => o.payment_status === 'unpaid')
            || null;

        if (!order) {
            await this.sendMessage(jid, '📭 No tienes pedidos pendientes de pago.');
            return;
        }

        if (order.payment_status === 'paid') {
            await this.sendMessage(jid, `✅ Tu pago del Pedido #${order.id} ya fue registrado. Gracias. 🙌`);
            return;
        }

        this.db.updateOrderStatus(order.id, 'confirmed');
        this.db.updateOrderPaymentStatus(order.id, 'paid');

        const currency = this.db.getSetting('currency') || 'MXN';
        const symbol = this.payments.getCurrencySymbol(currency);

        await this.sendMessage(jid,
            `✅ *¡Gracias por confirmar tu pago!* 🙌\n\n` +
            `Hemos notificado al vendedor sobre tu pago del Pedido #${order.id}.\n` +
            `En breve recibirás la confirmación.\n\n` +
            `Si tienes dudas, contacta al vendedor.`
        );

        const ownerNumber = this.db.getSetting('owner_number');
        if (ownerNumber) {
            const amount = order.total.toFixed(2);
            await this.sendMessage(`${ownerNumber}@s.whatsapp.net`,
                `💰 *Pago Confirmado por el Cliente* 🎉\n\n` +
                `👤 *Cliente:* ${user.name || 'Anónimo'} (${user.phone})\n` +
                `📋 *Pedido #${order.id}*\n` +
                `💵 *Monto:* ${symbol}${amount}\n` +
                `💳 *Método:* ${order.payment_method || 'No especificado'}\n` +
                `🔗 *Link de pago:* ${order.payment_link || 'N/A'}\n\n` +
                `📌 Revisa y confirma el pago desde el panel de control.`
            );
        }
    }

    async notifyOwnerOrder(order, user, paymentResult) {
        const ownerNumber = this.db.getSetting('owner_number');
        if (!ownerNumber) return;

        const currency = this.db.getSetting('currency') || 'MXN';
        const symbol = this.payments.getCurrencySymbol(currency);
        let msg = `🛒 *Nuevo Pedido #${order.id}*\n\n`;
        msg += `👤 *Cliente:* ${user.name || 'Anónimo'} (${user.phone})\n`;

        for (const item of order.items) {
            msg += `📦 *${item.quantity}x ${item.product_name}* — ${symbol}${(item.quantity * item.unit_price).toFixed(2)}\n`;
        }
        msg += `\n💵 *Total:* ${symbol}${order.total.toFixed(2)}\n`;

        if (paymentResult) {
            msg += `💳 *Método de pago:* ${this.getPaymentMethodName(paymentResult.method)}\n`;
            if (paymentResult.link) {
                msg += `🔗 *Link:* ${paymentResult.link}\n`;
            }
            msg += `✅ *Estado:* Esperando pago\n`;
        } else {
            msg += `📋 *Estado:* Pendiente\n`;
        }

        await this.sendMessage(`${ownerNumber}@s.whatsapp.net`, msg);
    }

    getPaymentMethodName(method) {
        const names = {
            bank: 'Transferencia bancaria',
            stripe: 'Tarjeta (Stripe)',
            mercadopago: 'Mercado Pago',
            paypal: 'PayPal',
        };
        return names[method] || method;
    }

    async sendOrderStatus(jid, user) {
        const orders = this.db.getUserOrders(user.id);

        if (orders.length === 0) {
            await this.sendMessage(jid, '📭 *No tienes pedidos registrados.*\n\nPara comprar, escribe: *quiero [nombre del producto]*');
            return;
        }

        const lastOrder = orders[0];
        const orderText = this.messages.formatOrderForWhatsApp(lastOrder);
        await this.sendMessage(jid, orderText);

        const shipment = this.db.getShipmentByOrder(lastOrder.id);
        if (shipment) {
            let trackMsg = `📦 *Seguimiento de Envío*\n\nNúmero de guía: *${shipment.tracking_number}*\n`;
            if (shipment.carrier) trackMsg += `Transportista: ${shipment.carrier}\n`;
            if (shipment.tracking_url) trackMsg += `🔗 Rastrear: ${shipment.tracking_url}\n`;
            await this.sendMessage(jid, trackMsg);
        }
    }

    async sendTrackingInfo(jid, user) {
        const orders = this.db.getUserOrders(user.id);
        const shipped = orders.filter(o => o.status === 'completed');
        if (shipped.length === 0) {
            await this.sendMessage(jid, '📭 No tienes pedidos enviados aún.');
            return;
        }

        const lastShipped = shipped[0];
        const shipment = this.db.getShipmentByOrder(lastShipped.id);
        if (!shipment) {
            await this.sendMessage(jid, '📭 Tu último pedido aún no tiene número de seguimiento. Pronto lo recibirás.');
            return;
        }

        let msg = `📦 *Seguimiento de Envío*\n\n`;
        msg += `🧾 *Pedido #${lastShipped.id}*\n`;
        msg += `🔢 *Guía:* ${shipment.tracking_number}\n`;
        if (shipment.carrier) msg += `🚚 *Transportista:* ${shipment.carrier}\n`;
        if (shipment.tracking_url) msg += `🔗 *Rastrear:* ${shipment.tracking_url}\n`;
        msg += `📅 *Fecha:* ${new Date(shipment.created_at).toLocaleDateString('es-ES')}`;
        if (shipment.notes) msg += `\n📝 ${shipment.notes}`;
        await this.sendMessage(jid, msg);
    }

    async applyCoupon(jid, user, input) {
        const code = input.replace(/^(cupon|cupón|codigo|código)\s+/i, '').trim().toUpperCase();
        if (!code) {
            await this.sendMessage(jid, '❌ Escribe un código de cupón. Ej: *cupon DESCUENTO10*');
            return;
        }

        const coupon = this.db.getCoupon(code);
        if (!coupon) {
            await this.sendMessage(jid, `❌ Cupón "${code}" no válido o ha expirado.`);
            return;
        }

        if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
            await this.sendMessage(jid, `❌ El cupón "${code}" ha expirado.`);
            return;
        }

        if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) {
            await this.sendMessage(jid, `❌ El cupón "${code}" ya no tiene usos disponibles.`);
            return;
        }

        const cart = this.getCart(jid);
        if (cart.length === 0) {
            await this.sendMessage(jid, '🛒 Primero agrega productos al carrito y aplica el cupón antes de finalizar.');
            return;
        }

        const currency = this.db.getSetting('currency') || 'MXN';
        const symbol = this.payments.getCurrencySymbol(currency);
        const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

        if (subtotal < coupon.min_purchase) {
            await this.sendMessage(jid, `❌ Mínimo de compra: ${symbol}${coupon.min_purchase.toFixed(2)}. Tu carrito es ${symbol}${subtotal.toFixed(2)}.`);
            return;
        }

        let discount = 0;
        if (coupon.discount_type === 'percentage') {
            discount = subtotal * (coupon.discount_value / 100);
        } else {
            discount = coupon.discount_value;
        }
        discount = Math.min(discount, subtotal);

        this.cartCoupon[jid] = { coupon, discount };

        await this.sendMessage(jid,
            `🎉 *Cupón Aplicado: ${coupon.code}*\n\n` +
            `${coupon.description ? `📝 ${coupon.description}\n\n` : ''}` +
            `💰 *Subtotal:* ${symbol}${subtotal.toFixed(2)}\n` +
            `💵 *Descuento:* -${symbol}${discount.toFixed(2)} (${coupon.discount_type === 'percentage' ? coupon.discount_value + '%' : '$' + coupon.discount_value})\n` +
            `✅ *Total con descuento:* ${symbol}${(subtotal - discount).toFixed(2)}\n\n` +
            `📌 Escribe *"terminar"* para finalizar tu pedido.`
        );
    }

    async addReview(jid, user, input) {
        const parts = input.replace(/^(calificar|puntuar|valorar)\s+/i, '').trim().split(/\s+/);
        if (parts.length < 2) {
            await this.sendMessage(jid, '❌ Uso: *calificar [pedido #] [1-5]* (opcional: comentario)\n\nEj: *calificar 3 5 Excelente servicio*');
            return;
        }

        const orderNum = parseInt(parts[0]);
        const rating = parseInt(parts[1]);

        if (isNaN(orderNum) || orderNum <= 0) {
            await this.sendMessage(jid, '❌ Número de pedido inválido.');
            return;
        }
        if (isNaN(rating) || rating < 1 || rating > 5) {
            await this.sendMessage(jid, '❌ La calificación debe ser del 1 al 5.');
            return;
        }

        const comment = parts.slice(2).join(' ');

        const orders = this.db.getUserOrders(user.id);
        const order = orders.find(o => o.id === orderNum);
        if (!order) {
            await this.sendMessage(jid, `❌ Pedido #${orderNum} no encontrado.`);
            return;
        }
        if (order.status !== 'completed') {
            await this.sendMessage(jid, '❌ Solo puedes calificar pedidos completados.');
            return;
        }

        const result = this.db.addReview(order.id, user.id, null, rating, comment);
        if (!result) {
            await this.sendMessage(jid, '❌ Ya calificaste este pedido anteriormente. ¡Gracias! 🙌');
            return;
        }

        const stars = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);
        await this.sendMessage(jid,
            `✅ *¡Gracias por tu calificación!* 🙌\n\n` +
            `🧾 *Pedido #${order.id}*\n` +
            `${stars} *${rating}/5*\n` +
            `${comment ? `📝 "${comment}"` : ''}\n\n` +
            `Tu opinión nos ayuda a mejorar. ¡Gracias! 🚀`
        );
    }

    async sendSystemStats(jid) {
        const sysStats = this.db.getSystemStats();
        const bizStats = this.db.getBusinessStats();

        const formatBytes = (bytes) => {
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            if (bytes === 0) return '0 Byte';
            const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
        };

        const formatTime = (seconds) => {
            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            return `${days}d ${hours}h ${mins}m`;
        };

        const currency = this.db.getSetting('currency') || 'MXN';
        const symbol = this.payments.getCurrencySymbol(currency);

        let msg = `🤖 *${this.db.getSetting('business_name')} — Estadísticas*\n\n`;

        msg += `══ *📊 NEGOCIO* ══\n`;
        msg += `👥 Usuarios: ${bizStats.total_users}\n`;
        msg += `📦 Productos: ${bizStats.total_products}\n`;
        msg += `🧾 Pedidos: ${bizStats.total_orders} (${bizStats.pending_orders} pendientes)\n`;
        msg += `💰 Ingresos: ${symbol}${Number(bizStats.total_revenue).toFixed(2)}\n`;
        if (bizStats.top_product) msg += `🏆 Más vendido: ${bizStats.top_product.product_name} (${bizStats.top_product.qty} uds)\n`;
        msg += `🏷️ Cupones: ${bizStats.total_coupons}\n`;
        msg += `⭐ Valoraciones: ${bizStats.total_reviews}\n`;
        msg += `📦 Envíos: ${bizStats.total_shipments}\n\n`;

        msg += `══ *💻 SISTEMA* ══\n`;
        msg += `🖥️  ${sysStats.platform} | ${sysStats.cpu_cores} núcleos\n`;
        msg += `💾 RAM: ${formatBytes(sysStats.ram_used)} / ${formatBytes(sysStats.ram_total)} (${Math.round(sysStats.ram_used / sysStats.ram_total * 100)}%)\n`;
        msg += `🕐 Activo: ${formatTime(sysStats.uptime)}\n`;
        msg += `📡 Node: ${sysStats.node_version}\n`;

        await this.sendMessage(jid, msg);
    }

    async sendMessage(jid, text) {
        if (!this.sock || !this.isRunning) return;
        try {
            await this.sock.sendMessage(jid, { text });
            stats.messagesSent++;
        } catch (err) {
            addLog('error', `Error enviando mensaje a ${jid}: ${err.message}`);
        }
    }

    async sendImage(jid, imageUrl, caption) {
        if (!this.sock || !this.isRunning) return;
        try {
            if (!imageUrl || !imageUrl.startsWith('http')) return;
            await this.sock.sendMessage(jid, {
                image: { url: imageUrl },
                caption: caption || '',
            });
            stats.messagesSent++;
        } catch (err) {
            addLog('error', `Error enviando imagen a ${jid}: ${err.message}`);
            if (caption) {
                await this.sendMessage(jid, caption);
            }
        }
    }

    splitMessage(text, maxLength = 4096) {
        const parts = [];
        while (text.length > 0) {
            if (text.length <= maxLength) {
                parts.push(text);
                break;
            }
            let cut = text.lastIndexOf('\n', maxLength);
            if (cut === -1) cut = maxLength;
            parts.push(text.slice(0, cut));
            text = text.slice(cut);
        }
        return parts;
    }
}

module.exports = WhatsAppBot;
module.exports.botEvents = botEvents;
module.exports.getLogs = getLogs;
module.exports.getStats = getStats;
module.exports.getBotEvents = getBotEvents;
