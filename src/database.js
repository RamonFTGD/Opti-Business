const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'business.db');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
    } catch (e) {}
    return {};
}

class DatabaseManager {
    static async create() {
        const SQL = await initSqlJs();
        return new DatabaseManager(SQL);
    }

    constructor(SQL) {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        let data = null;
        if (fs.existsSync(DB_PATH)) {
            data = fs.readFileSync(DB_PATH);
        }

        this._rawDb = data
            ? new SQL.Database(new Uint8Array(data))
            : new SQL.Database();

        try { this._rawDb.run('PRAGMA foreign_keys = ON'); } catch (e) {}

        this._batching = true;
        this.db = this._createDbProxy();
        this.init();
        this._batching = false;
        this._save();
    }

    _createDbProxy() {
        const rawDb = this._rawDb;
        const self = this;

        return {
            prepare(sql) {
                return {
                    get(...params) {
                        const stmt = rawDb.prepare(sql);
                        try {
                            if (params.length > 0) stmt.bind(params);
                            if (stmt.step()) {
                                return stmt.getAsObject();
                            }
                            return null;
                        } finally {
                            stmt.free();
                        }
                    },
                    all(...params) {
                        const stmt = rawDb.prepare(sql);
                        try {
                            if (params.length > 0) stmt.bind(params);
                            const results = [];
                            while (stmt.step()) {
                                results.push(stmt.getAsObject());
                            }
                            return results;
                        } finally {
                            stmt.free();
                        }
                    },
                    run(...params) {
                        if (params.length > 0) {
                            rawDb.run(sql, params);
                        } else {
                            rawDb.run(sql);
                        }
                        const changes = rawDb.getRowsModified();
                        let lastInsertRowid = 0;
                        const res = rawDb.exec('SELECT last_insert_rowid() as id');
                        if (res.length > 0 && res[0].values.length > 0) {
                            lastInsertRowid = res[0].values[0][0];
                        }
                        if (!self._batching) self._save();
                        return { changes, lastInsertRowid };
                    },
                };
            },
            exec(sql) {
                rawDb.exec(sql);
                if (!self._batching) self._save();
            },
            close() {
                self._save();
                rawDb.close();
            },
        };
    }

    _save() {
        try {
            const data = this._rawDb.export();
            fs.writeFileSync(DB_PATH, Buffer.from(data));
        } catch (e) {
            console.error('Error saving database:', e.message);
        }
    }

    init() {
        const config = loadConfig();
        const biz = config.business || {};
        const msgs = config.messages || {};
        const pays = config.payments || {};

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                price REAL NOT NULL,
                category TEXT DEFAULT 'General',
                available INTEGER DEFAULT 1,
                image_url TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                whatsapp_id TEXT UNIQUE NOT NULL,
                name TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_interaction DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                total REAL NOT NULL,
                status TEXT DEFAULT 'pending',
                payment_method TEXT DEFAULT NULL,
                payment_status TEXT DEFAULT 'unpaid',
                payment_link TEXT DEFAULT NULL,
                payment_id TEXT DEFAULT NULL,
                notes TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                product_name TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                unit_price REAL NOT NULL,
                FOREIGN KEY (order_id) REFERENCES orders(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );

            CREATE TABLE IF NOT EXISTS bank_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bank_name TEXT NOT NULL,
                account_type TEXT DEFAULT 'checking',
                account_number TEXT DEFAULT '',
                clabe TEXT DEFAULT '',
                owner_name TEXT DEFAULT '',
                is_default INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS shipments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                tracking_number TEXT NOT NULL,
                carrier TEXT DEFAULT '',
                tracking_url TEXT DEFAULT '',
                status TEXT DEFAULT 'shipped',
                notes TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(id)
            );

            CREATE TABLE IF NOT EXISTS coupons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                description TEXT DEFAULT '',
                discount_type TEXT DEFAULT 'percentage',
                discount_value REAL NOT NULL,
                min_purchase REAL DEFAULT 0,
                max_uses INTEGER DEFAULT 0,
                used_count INTEGER DEFAULT 0,
                expires_at TEXT,
                active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                product_id INTEGER,
                rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
                comment TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        `);

        this.migrateTables();

        const insertSetting = this.db.prepare(
            'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
        );

        insertSetting.run('business_name', biz.name || 'Mi Negocio');
        insertSetting.run('currency', biz.currency || 'MXN');
        insertSetting.run('welcome_message', msgs.welcome_message || '¡Hola {name}! 👋\n\nBienvenido a *{business_name}*. Somos un negocio dedicado a ofrecerte los mejores productos.\n\n*Comandos disponibles:*\n📦 *productos* — Ver nuestro catálogo\n🛒 *quiero [producto]* — Hacer un pedido\n📋 *pedido* — Consultar tu pedido\n❓ *ayuda* — Ver este mensaje');
        insertSetting.run('catalog_message', msgs.catalog_message || '🌟 *{business_name} — Catálogo de Productos*\n\n{products}\n\nPara comprar, escribe: *quiero [nombre del producto]*\nEjemplo: `quiero {example}`');
        insertSetting.run('order_confirmation', msgs.order_confirmation || '✅ *¡Pedido Registrado!*\n\n{order_details}\n\n📌 *Total:* {total}\n\n📋 *Estado:* Pendiente\n\nTe contactaremos pronto para confirmar tu pedido. ¡Gracias por tu compra! 🙌');
        insertSetting.run('order_status_pending', msgs.order_status_pending || '📋 *Estado de tu Pedido #{order_id}*\n\n🕐 *Pendiente*\n\nTu pedido está siendo procesado. Te contactaremos pronto.');
        insertSetting.run('order_status_confirmed', msgs.order_status_confirmed || '✅ *Estado de tu Pedido #{order_id}*\n\n📦 *Confirmado*\n\nTu pedido ha sido confirmado. Pronto recibirás más información.');
        insertSetting.run('order_status_completed', msgs.order_status_completed || '🎉 *Estado de tu Pedido #{order_id}*\n\n✅ *Completado*\n\n¡Tu pedido ha sido entregado con éxito! Gracias por confiar en nosotros.');
        insertSetting.run('order_status_cancelled', msgs.order_status_cancelled || '❌ *Estado de tu Pedido #{order_id}*\n\n*Cancelado*\n\nTu pedido ha sido cancelado. Si tienes dudas, contáctanos.');
        insertSetting.run('help_message', msgs.help_message || '🤖 *{business_name} — Ayuda*\n\n*Comandos disponibles:*\n📦 *productos* — Ver catálogo\n🛒 *quiero [producto]* — Comprar (ej: quiero producto, 2)\n📋 *pedido* — Estado de mi pedido\n❓ *ayuda* — Mostrar este mensaje');
        insertSetting.run('greeting_no_products', msgs.greeting_no_products || 'Hola {name} 👋\n\nActualmente no tenemos productos disponibles. ¡Vuelve pronto!');

        insertSetting.run('payment_bank_enabled', pays.bank_enabled ? '1' : '0');
        insertSetting.run('payment_stripe_enabled', pays.stripe_enabled ? '1' : '0');
        insertSetting.run('payment_mercadopago_enabled', pays.mercadopago_enabled ? '1' : '0');
        insertSetting.run('payment_paypal_enabled', pays.paypal_enabled ? '1' : '0');
        insertSetting.run('stripe_secret_key', pays.stripe_secret_key || '');
        insertSetting.run('mercadopago_access_token', pays.mercadopago_access_token || '');
        insertSetting.run('paypal_client_id', pays.paypal_client_id || '');
        insertSetting.run('paypal_client_secret', pays.paypal_client_secret || '');
        insertSetting.run('paypal_mode', pays.paypal_mode || 'sandbox');
        insertSetting.run('payment_instructions', msgs.payment_instructions || '💳 *Opciones de Pago*\n\n{options}\n\nSelecciona un método de pago escribiendo el número correspondiente.');

        insertSetting.run('owner_name', biz.owner_name || 'Propietario');
        insertSetting.run('owner_email', biz.owner_email || '');
        insertSetting.run('owner_phone', biz.owner_phone || '');
        insertSetting.run('owner_number', biz.owner_number || '');

        // ⚠️ IMPORTANTE: Los INSERT OR IGNORE no sobrescriben valores existentes.
        // Para que config.json siempre prevalezca, hacemos UPDATE después.
        const updateSetting = this.db.prepare('UPDATE settings SET value = ? WHERE key = ?');

        const configOverrides = {
            'business_name': biz.name,
            'currency': biz.currency,
            'welcome_message': msgs.welcome_message,
            'catalog_message': msgs.catalog_message,
            'order_confirmation': msgs.order_confirmation,
            'order_status_pending': msgs.order_status_pending,
            'order_status_confirmed': msgs.order_status_confirmed,
            'order_status_completed': msgs.order_status_completed,
            'order_status_cancelled': msgs.order_status_cancelled,
            'help_message': msgs.help_message,
            'greeting_no_products': msgs.greeting_no_products,
            'payment_instructions': msgs.payment_instructions,
            'owner_name': biz.owner_name,
            'owner_email': biz.owner_email,
            'owner_phone': biz.owner_phone,
            'owner_number': biz.owner_number,
        };

        for (const [key, value] of Object.entries(configOverrides)) {
            if (value) {
                updateSetting.run(value, key);
            }
        }

        const count = this.db.prepare('SELECT COUNT(*) as count FROM products').get();
        if (count.count === 0) {
            const insertProduct = this.db.prepare(
                'INSERT INTO products (name, description, price, category) VALUES (?, ?, ?, ?)'
            );
            insertProduct.run('Producto Ejemplo 1', 'Descripción del primer producto', 99.99, 'General');
            insertProduct.run('Producto Ejemplo 2', 'Descripción del segundo producto', 149.99, 'General');
            insertProduct.run('Servicio Premium', 'Servicio profesional con atención personalizada', 299.99, 'Servicios');
        }

        const bankCount = this.db.prepare('SELECT COUNT(*) as count FROM bank_accounts').get();
        if (bankCount.count === 0) {
            const insertBank = this.db.prepare(
                'INSERT INTO bank_accounts (bank_name, account_type, account_number, clabe, owner_name, is_default) VALUES (?, ?, ?, ?, ?, ?)'
            );
            insertBank.run('Banco Ejemplo', 'checking', '1234-5678-90', '012345678901234567', 'Titular de la Cuenta', 1);
        }
    }

    migrateTables() {
        const addColumns = (table, additions) => {
            const columns = this.db.prepare(`PRAGMA table_info('${table}')`).all().map(c => c.name);
            for (const [col, def] of Object.entries(additions)) {
                if (!columns.includes(col)) {
                    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
                }
            }
        };
        addColumns('orders', {
            payment_method: 'TEXT DEFAULT NULL',
            payment_status: "TEXT DEFAULT 'unpaid'",
            payment_link: 'TEXT DEFAULT NULL',
            payment_id: 'TEXT DEFAULT NULL',
        });
        addColumns('products', {
            image_url: "TEXT DEFAULT ''",
        });
    }

    getSetting(key) {
        const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? row.value : null;
    }

    setSetting(key, value) {
        this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    }

    getAllSettings() {
        return this.db.prepare('SELECT * FROM settings ORDER BY key').all();
    }

    getProducts() {
        return this.db.prepare('SELECT * FROM products WHERE available = 1 ORDER BY category, name').all();
    }

    getAllProducts() {
        return this.db.prepare('SELECT * FROM products ORDER BY category, name').all();
    }

    getProduct(id) {
        return this.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    }

    searchProduct(name) {
        return this.db.prepare(
            'SELECT * FROM products WHERE available = 1 AND LOWER(name) LIKE ? LIMIT 1'
        ).get(`%${name.toLowerCase()}%`);
    }

    addProduct(name, description, price, category, imageUrl) {
        const stmt = this.db.prepare(
            'INSERT INTO products (name, description, price, category, image_url) VALUES (?, ?, ?, ?, ?)'
        );
        return stmt.run(name, description || '', parseFloat(price), category || 'General', imageUrl || '');
    }

    updateProduct(id, data) {
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(data)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
        values.push(id);
        this.db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    deleteProduct(id) {
        this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
    }

    getCategories() {
        return this.db.prepare(
            'SELECT DISTINCT category FROM products WHERE available = 1 ORDER BY category'
        ).all().map(r => r.category);
    }

    getUser(whatsappId) {
        return this.db.prepare('SELECT * FROM users WHERE whatsapp_id = ?').get(whatsappId);
    }

    createUser(whatsappId, name, phone) {
        const existing = this.getUser(whatsappId);
        if (existing) return existing;

        const stmt = this.db.prepare(
            'INSERT INTO users (whatsapp_id, name, phone) VALUES (?, ?, ?)'
        );
        stmt.run(whatsappId, name || '', phone || '');
        return this.getUser(whatsappId);
    }

    updateUserInteraction(whatsappId) {
        this.db.prepare(
            "UPDATE users SET last_interaction = CURRENT_TIMESTAMP WHERE whatsapp_id = ?"
        ).run(whatsappId);
    }

    getAllUsers() {
        return this.db.prepare(`
            SELECT u.*, 
                   (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as total_orders,
                   (SELECT COALESCE(SUM(total), 0) FROM orders WHERE user_id = u.id) as total_spent
            FROM users u 
            ORDER BY last_interaction DESC
        `).all();
    }

    getUserCount() {
        return this.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    }

    createOrder(userId, items, notes) {
        const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const orderStmt = this.db.prepare(
            'INSERT INTO orders (user_id, total, notes) VALUES (?, ?, ?)'
        );
        const result = orderStmt.run(userId, total, notes || '');

        const itemStmt = this.db.prepare(
            'INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)'
        );
        for (const item of items) {
            itemStmt.run(result.lastInsertRowid, item.productId, item.name, item.quantity, item.price);
        }

        return this.getOrder(result.lastInsertRowid);
    }

    getOrder(orderId) {
        const order = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
        if (order) {
            order.items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
        }
        return order;
    }

    getOrders(status) {
        let query = 'SELECT o.*, u.name as user_name, u.whatsapp_id FROM orders o LEFT JOIN users u ON o.user_id = u.id';
        const params = [];
        if (status) {
            query += ' WHERE o.status = ?';
            params.push(status);
        }
        query += ' ORDER BY o.created_at DESC';
        return this.db.prepare(query).all(...params);
    }

    getUserOrders(userId) {
        const orders = this.db.prepare(
            'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC'
        ).all(userId);
        for (const order of orders) {
            order.items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
        }
        return orders;
    }

    updateOrderStatus(orderId, status) {
        return this.db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, orderId);
    }

    getPendingOrdersCount() {
        return this.db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get().count;
    }

    updateOrderPaymentInfo(orderId, paymentMethod, paymentLink, paymentId) {
        this.db.prepare(
            'UPDATE orders SET payment_method = ?, payment_link = ?, payment_id = ? WHERE id = ?'
        ).run(paymentMethod, paymentLink || null, paymentId || null, orderId);
    }

    updateOrderPaymentStatus(orderId, status) {
        this.db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(status, orderId);
    }

    updateOrderTotal(orderId, total) {
        this.db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(parseFloat(total.toFixed(2)), orderId);
    }

    getBankAccounts() {
        return this.db.prepare('SELECT * FROM bank_accounts ORDER BY is_default DESC, bank_name').all();
    }

    getDefaultBankAccount() {
        return this.db.prepare('SELECT * FROM bank_accounts WHERE is_default = 1 LIMIT 1').get()
            || this.db.prepare('SELECT * FROM bank_accounts LIMIT 1').get();
    }

    addBankAccount(bankName, accountType, accountNumber, clabe, ownerName) {
        const stmt = this.db.prepare(
            'INSERT INTO bank_accounts (bank_name, account_type, account_number, clabe, owner_name) VALUES (?, ?, ?, ?, ?)'
        );
        return stmt.run(bankName, accountType, accountNumber, clabe, ownerName);
    }

    updateBankAccount(id, data) {
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(data)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
        values.push(id);
        this.db.prepare(`UPDATE bank_accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    deleteBankAccount(id) {
        this.db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(id);
    }

    setDefaultBankAccount(id) {
        this.db.prepare('UPDATE bank_accounts SET is_default = 0').run();
        this.db.prepare('UPDATE bank_accounts SET is_default = 1 WHERE id = ?').run(id);
    }

    addShipment(orderId, trackingNumber, carrier, trackingUrl) {
        const stmt = this.db.prepare(
            'INSERT INTO shipments (order_id, tracking_number, carrier, tracking_url) VALUES (?, ?, ?, ?)'
        );
        return stmt.run(orderId, trackingNumber, carrier || '', trackingUrl || '');
    }

    getShipmentByOrder(orderId) {
        return this.db.prepare('SELECT * FROM shipments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(orderId);
    }

    getShipments() {
        return this.db.prepare(`
            SELECT s.*, o.user_id, u.whatsapp_id, u.name as user_name
            FROM shipments s
            JOIN orders o ON s.order_id = o.id
            JOIN users u ON o.user_id = u.id
            ORDER BY s.created_at DESC
        `).all();
    }

    getCoupons() {
        return this.db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
    }

    getCoupon(code) {
        return this.db.prepare('SELECT * FROM coupons WHERE LOWER(code) = LOWER(?) AND active = 1').get(code);
    }

    addCoupon(code, description, discountType, discountValue, minPurchase, maxUses, expiresAt) {
        const stmt = this.db.prepare(
            'INSERT INTO coupons (code, description, discount_type, discount_value, min_purchase, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        return stmt.run(code.toUpperCase(), description, discountType, discountValue, minPurchase || 0, maxUses || 0, expiresAt || null);
    }

    updateCoupon(id, data) {
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(data)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
        values.push(id);
        this.db.prepare(`UPDATE coupons SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    deleteCoupon(id) {
        this.db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
    }

    useCoupon(id) {
        this.db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(id);
    }

    addReview(orderId, userId, productId, rating, comment) {
        const existing = this.db.prepare('SELECT id FROM reviews WHERE order_id = ? AND user_id = ?').get(orderId, userId);
        if (existing) return null;
        const stmt = this.db.prepare(
            'INSERT INTO reviews (order_id, user_id, product_id, rating, comment) VALUES (?, ?, ?, ?, ?)'
        );
        return stmt.run(orderId, userId, productId || null, Math.max(1, Math.min(5, rating)), comment || '');
    }

    getReviewsByProduct(productId) {
        return this.db.prepare(`
            SELECT r.*, u.name as user_name FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.product_id = ? ORDER BY r.created_at DESC
        `).all(productId);
    }

    getAllReviews() {
        return this.db.prepare(`
            SELECT r.*, u.name as user_name, u.whatsapp_id FROM reviews r
            JOIN users u ON r.user_id = u.id
            ORDER BY r.created_at DESC
        `).all();
    }

    getProductRating(productId) {
        const row = this.db.prepare(
            'SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE product_id = ?'
        ).get(productId);
        return row ? { average: row.avg || 0, count: row.count || 0 } : { average: 0, count: 0 };
    }

    getSystemStats() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        return {
            platform: os.platform(),
            hostname: os.hostname(),
            cpu_cores: os.cpus().length,
            cpu_model: os.cpus()[0]?.model || 'Unknown',
            ram_total: totalMem,
            ram_used: usedMem,
            ram_free: freeMem,
            uptime: os.uptime(),
            load_avg: os.loadavg(),
            node_version: process.version,
        };
    }

    getBusinessStats() {
        const totalUsers = this.getUserCount();
        const totalProducts = this.db.prepare('SELECT COUNT(*) as count FROM products').get().count;
        const totalOrders = this.db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
        const pendingOrders = this.getPendingOrdersCount();
        const totalRevenue = this.db.prepare("SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE status = 'completed'").get().total;
        const totalCoupons = this.db.prepare('SELECT COUNT(*) as count FROM coupons').get().count;
        const totalReviews = this.db.prepare('SELECT COUNT(*) as count FROM reviews').get().count;
        const totalShipments = this.db.prepare('SELECT COUNT(*) as count FROM shipments').get().count;
        const topProduct = this.db.prepare(`
            SELECT oi.product_name, SUM(oi.quantity) as qty
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE o.status = 'completed'
            GROUP BY oi.product_name
            ORDER BY qty DESC LIMIT 1
        `).get();

        return {
            total_users: totalUsers,
            total_products: totalProducts,
            total_orders: totalOrders,
            pending_orders: pendingOrders,
            total_revenue: totalRevenue,
            total_coupons: totalCoupons,
            total_reviews: totalReviews,
            total_shipments: totalShipments,
            top_product: topProduct,
        };
    }

    close() {
        this.db.close();
    }
}

module.exports = DatabaseManager;
