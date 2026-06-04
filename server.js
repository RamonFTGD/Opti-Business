const express = require('express');
const path = require('path');
const net = require('net');
const fs = require('fs');
const QRCode = require('qrcode');
const DatabaseManager = require('./src/database');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

const botModule = require('./src/bot');

function createRouter(bot) {
    const db = new DatabaseManager();
    const router = express.Router();

    const handle = (fn) => async (req, res) => {
        try { res.json(await fn(req, res, db)); }
        catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
    };

    router.get('/stats', handle(() => ({
        system: db.getSystemStats(),
        business: db.getBusinessStats(),
    })));

    router.get('/products', handle(() => db.getAllProducts()));
    router.get('/products/active', handle(() => db.getProducts()));
    router.post('/products', handle((req) => {
        const { name, description, price, category, image_url } = req.body;
        db.addProduct(name, description, price, category, image_url);
        return { success: true };
    }));
    router.put('/products/:id', handle((req) => {
        const { name, description, price, category, available, image_url } = req.body;
        db.updateProduct(parseInt(req.params.id), { name, description, price, category, available, image_url });
        return { success: true };
    }));
    router.delete('/products/:id', handle((req) => {
        db.deleteProduct(parseInt(req.params.id));
        return { success: true };
    }));

    router.get('/users', handle(() => db.getAllUsers()));

    router.get('/orders', handle((req) => db.getOrders(req.query.status || null)));
    router.put('/orders/:id/status', handle((req) => {
        db.updateOrderStatus(parseInt(req.params.id), req.body.status);
        return { success: true };
    }));
    router.post('/orders/:id/shipment', handle((req) => {
        const { tracking_number, carrier, tracking_url } = req.body;
        db.addShipment(parseInt(req.params.id), tracking_number, carrier, tracking_url);
        db.updateOrderStatus(parseInt(req.params.id), 'completed');
        return { success: true };
    }));

    router.get('/coupons', handle(() => db.getCoupons()));
    router.post('/coupons', handle((req) => {
        const { code, description, discount_type, discount_value, min_purchase, max_uses, expires_at } = req.body;
        db.addCoupon(code, description, discount_type, discount_value, min_purchase, max_uses, expires_at);
        return { success: true };
    }));
    router.put('/coupons/:id', handle((req) => {
        db.updateCoupon(parseInt(req.params.id), req.body);
        return { success: true };
    }));
    router.delete('/coupons/:id', handle((req) => {
        db.deleteCoupon(parseInt(req.params.id));
        return { success: true };
    }));

    router.get('/reviews', handle(() => db.getAllReviews()));

    router.get('/shipments', handle(() => db.getShipments()));

    router.get('/settings', handle(() => db.getAllSettings()));
    router.put('/settings', handle((req) => {
        const { key, value } = req.body;
        db.setSetting(key, value);
        return { success: true };
    }));

    router.get('/bank-accounts', handle(() => db.getBankAccounts()));
    router.post('/bank-accounts', handle((req) => {
        const { bank_name, account_type, account_number, clabe, owner_name } = req.body;
        db.addBankAccount(bank_name, account_type, account_number, clabe, owner_name);
        return { success: true };
    }));
    router.put('/bank-accounts/:id', handle((req) => {
        db.updateBankAccount(parseInt(req.params.id), req.body);
        return { success: true };
    }));
    router.delete('/bank-accounts/:id', handle((req) => {
        db.deleteBankAccount(parseInt(req.params.id));
        return { success: true };
    }));
    router.put('/bank-accounts/:id/default', handle((req) => {
        db.setDefaultBankAccount(parseInt(req.params.id));
        return { success: true };
    }));

    router.get('/config', handle(() => loadConfig()));
    router.put('/config', handle((req) => {
        const current = loadConfig();
        const merged = { ...current, ...req.body };
        saveConfig(merged);
        return { success: true, config: merged };
    }));
    router.put('/config/:section', handle((req) => {
        const section = req.params.section;
        const current = loadConfig();
        if (!current[section]) current[section] = {};
        current[section] = { ...current[section], ...req.body };
        saveConfig(current);

        if (section === 'business') {
            if (req.body.name !== undefined) db.setSetting('business_name', req.body.name);
            if (req.body.currency !== undefined) db.setSetting('currency', req.body.currency);
            if (req.body.owner_name !== undefined) db.setSetting('owner_name', req.body.owner_name);
            if (req.body.owner_email !== undefined) db.setSetting('owner_email', req.body.owner_email);
            if (req.body.owner_phone !== undefined) db.setSetting('owner_phone', req.body.owner_phone);
            if (req.body.owner_number !== undefined) db.setSetting('owner_number', req.body.owner_number);
        }
        if (section === 'messages') {
            for (const [key, value] of Object.entries(req.body)) {
                db.setSetting(key, value);
            }
        }
        if (section === 'payments') {
            if (req.body.bank_enabled !== undefined) db.setSetting('payment_bank_enabled', req.body.bank_enabled ? '1' : '0');
            if (req.body.stripe_enabled !== undefined) db.setSetting('payment_stripe_enabled', req.body.stripe_enabled ? '1' : '0');
            if (req.body.mercadopago_enabled !== undefined) db.setSetting('payment_mercadopago_enabled', req.body.mercadopago_enabled ? '1' : '0');
            if (req.body.paypal_enabled !== undefined) db.setSetting('payment_paypal_enabled', req.body.paypal_enabled ? '1' : '0');
            if (req.body.stripe_secret_key !== undefined) db.setSetting('stripe_secret_key', req.body.stripe_secret_key);
            if (req.body.mercadopago_access_token !== undefined) db.setSetting('mercadopago_access_token', req.body.mercadopago_access_token);
            if (req.body.paypal_client_id !== undefined) db.setSetting('paypal_client_id', req.body.paypal_client_id);
            if (req.body.paypal_client_secret !== undefined) db.setSetting('paypal_client_secret', req.body.paypal_client_secret);
            if (req.body.paypal_mode !== undefined) db.setSetting('paypal_mode', req.body.paypal_mode);
        }

        return { success: true, config: current };
    }));

    router.get('/connection/status', handle(() => {
        if (!bot) return { connected: false, qr: null, phone: null, status: 'no_bot' };
        return bot.getConnectionStatus();
    }));

    router.post('/connection/pairing', handle(async (req) => {
        if (!bot) throw new Error('Bot no disponible');
        const { phone } = req.body;
        if (!phone) throw new Error('Número de teléfono requerido');
        const code = await bot.requestPairingCode(phone);
        return { success: true, code };
    }));

    router.post('/connection/logout', handle(async () => {
        if (!bot) throw new Error('Bot no disponible');
        await bot.logout();
        setTimeout(() => {
            bot.start().catch(err => console.error('Error reiniciando bot:', err));
        }, 2000);
        return { success: true };
    }));

    router.get('/logs', (req, res) => {
        res.json(botModule.getLogs());
    });

    router.get('/logs/stream', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        res.write('data: {"type":"connected"}\n\n');

        const onLog = (entry) => {
            res.write(`data: ${JSON.stringify(entry)}\n\n`);
        };
        botModule.getBotEvents().on('log', onLog);

        req.on('close', () => {
            botModule.getBotEvents().removeListener('log', onLog);
        });
    });

    router.get('/logs/stats', handle(() => {
        const connStatus = bot ? bot.getConnectionStatus() : {};
        return {
            logs: botModule.getLogs().slice(-100),
            stats: botModule.getStats(),
            connection: connStatus,
        };
    }));

    router.get('/connection/qr-image', async (req, res) => {
        try {
            if (!bot) return res.status(503).json({ error: 'Bot no disponible' });
            const status = bot.getConnectionStatus();
            if (!status.qr) return res.status(404).json({ error: 'No QR disponible' });
            const qrPng = await QRCode.toBuffer(status.qr, {
                width: 300,
                margin: 2,
                color: { dark: '#FFFFFF', light: '#1a1a2e' },
            });
            res.type('image/png').send(qrPng);
        } catch (err) {
            console.error('Error generating QR image:', err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

function getRandomPort() {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(0, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', () => resolve(0));
    });
}

async function startWebServer(bot) {
    const port = await getRandomPort();
    const apiRouter = createRouter(bot);
    app.use('/api', apiRouter);

    app.use((req, res) => {
        if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    return new Promise((resolve) => {
        app.listen(port, () => {
            console.log(`🌐 Dashboard web en: http://localhost:${port}`);
            resolve(port);
        });
    });
}

module.exports = { startWebServer, app };
