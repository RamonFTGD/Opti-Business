const inquirer = require('inquirer').default;
const WhatsAppBot = require('./bot');

class BusinessMenu {
    constructor(db, bot) {
        this.db = db;
        this.bot = bot || new WhatsAppBot(db);
        this.botRunning = false;
    }

    async start() {
        console.clear();
        console.log(this.getHeader());
        await this.mainMenuLoop();
    }

    getHeader() {
        const name = this.db.getSetting('business_name') || 'Mi Negocio';
        const pending = this.db.getPendingOrdersCount();
        const users = this.db.getUserCount();
        const products = this.db.getProducts().length;

        return `
╔══════════════════════════════════════════╗
║          🤖 WHATSBUSINESS BOT            ║
║        Panel de Control del Bot          ║
╠══════════════════════════════════════════╣
║  Negocio: ${name.padEnd(30)}║
║  📦 Productos: ${String(products).padEnd(3)}  👥 Usuarios: ${String(users).padEnd(3)}  📋 Pedidos: ${String(pending).padEnd(3)}  ║
╚══════════════════════════════════════════╝
        `.trim();
    }

    async mainMenuLoop() {
        let running = true;
        while (running) {
            const status = this.botRunning ? '🟢 Conectado' : '🔴 Detenido';
            const pendingOrders = this.db.getPendingOrdersCount();

            const { action } = await inquirer.prompt([
                {
                    type: 'select',
                    name: 'action',
                    message: `${this.getHeader()}\n\n📌 Bot: ${status}  |  ⏳ Pedidos pendientes: ${pendingOrders}\n\nSelecciona una opción:`,
                    pageSize: 10,
                    choices: [
                        { name: '📦  Gestionar Productos', value: 'products' },
                        { name: '🏷️   Cupones de Descuento', value: 'coupons' },
                        { name: '👥  Ver Usuarios', value: 'users' },
                        { name: '📋  Gestionar Pedidos', value: 'orders' },
                        { name: '📦  Seguimiento de Envíos', value: 'shipments' },
                        { name: '⭐  Valoraciones', value: 'reviews' },
                        { name: '💳  Configurar Pagos', value: 'payments' },
                        { name: '⚙️   Configuración del Negocio', value: 'settings' },
                        { name: '📊  Estadísticas del Sistema', value: 'stats' },
                        { name: `${this.botRunning ? '⏹️   Detener Bot' : '🚀  Iniciar Bot'} de WhatsApp`, value: 'toggle_bot' },
                        { name: '❌  Salir', value: 'exit' },
                    ],
                },
            ]);

            switch (action) {
                case 'products': await this.productsMenuLoop(); break;
                case 'coupons': await this.couponsMenu(); break;
                case 'users': await this.usersMenu(); break;
                case 'orders': await this.ordersMenuLoop(); break;
                case 'shipments': await this.shipmentsMenu(); break;
                case 'reviews': await this.reviewsMenu(); break;
                case 'payments': await this.paymentsMenu(); break;
                case 'settings': await this.settingsMenuLoop(); break;
                case 'stats': await this.showSystemStats(); break;
                case 'toggle_bot': await this.toggleBot(); break;
                case 'exit':
                    const shouldExit = await this.exit();
                    if (shouldExit !== false) running = false;
                    break;
            }
        }
    }

    async productsMenuLoop() {
        let running = true;
        while (running) {
            const { action } = await inquirer.prompt([
                {
                    type: 'select',
                    name: 'action',
                    message: '📦 GESTIÓN DE PRODUCTOS\nSelecciona una opción:',
                    choices: [
                        { name: '📋  Listar Productos', value: 'list' },
                        { name: '➕  Agregar Producto', value: 'add' },
                        { name: '✏️   Editar Producto', value: 'edit' },
                        { name: '🗑️   Eliminar Producto', value: 'delete' },
                        { name: '🔙  Volver al Menú Principal', value: 'back' },
                    ],
                },
            ]);

            switch (action) {
                case 'list': await this.listProducts(); break;
                case 'add': await this.addProduct(); break;
                case 'edit': await this.editProduct(); break;
                case 'delete': await this.deleteProduct(); break;
                case 'back': running = false; break;
            }
        }
    }

    async listProducts() {
        const products = this.db.getAllProducts();
        if (products.length === 0) {
            console.log('\n📭 No hay productos registrados.\n');
        } else {
            console.log('\n' + '═'.repeat(60));
            console.log('📦  CATÁLOGO DE PRODUCTOS');
            console.log('═'.repeat(60));

            for (const p of products) {
                const status = p.available ? '✅' : '❌';
                const hasImg = p.image_url ? ' 📸' : '';
                console.log(`\n${status}  #${p.id} ${p.name}${hasImg}`);
                console.log(`   📂 ${p.category}  |  💵 $${p.price.toFixed(2)}`);
                if (p.description) console.log(`   📝 ${p.description}`);
                if (p.image_url) console.log(`   🔗 ${p.image_url.slice(0, 60)}...`);
            }
            console.log(`\n${'─'.repeat(60)}`);
            console.log(`Total: ${products.length} productos\n`);
        }

        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async addProduct() {
        console.log('\n--- ➕ NUEVO PRODUCTO ---\n');

        const answers = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Nombre del producto:', validate: v => v.trim() ? true : 'El nombre es obligatorio' },
            { type: 'input', name: 'description', message: 'Descripción (opcional):' },
            { type: 'number', name: 'price', message: 'Precio:', validate: v => v > 0 ? true : 'Ingresa un precio válido' },
            { type: 'input', name: 'category', message: 'Categoría:', default: 'General' },
            { type: 'input', name: 'image_url', message: 'URL de imagen (opcional):', default: '' },
        ]);

        this.db.addProduct(answers.name, answers.description, answers.price, answers.category, answers.image_url);
        console.log(`\n✅ Producto "${answers.name}" agregado exitosamente.\n`);

        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async editProduct() {
        const products = this.db.getAllProducts();
        if (products.length === 0) {
            console.log('\n📭 No hay productos para editar.\n');
            await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
            return;
        }

        const { productId } = await inquirer.prompt([
            {
                type: 'select',
                name: 'productId',
                message: '✏️  Selecciona el producto a editar:',
                choices: products.map(p => ({
                    name: `#${p.id} ${p.name} — $${p.price.toFixed(2)} [${p.category}]`,
                    value: p.id,
                })),
            },
        ]);

        const product = this.db.getProduct(productId);
        console.log(`\nEditando: ${product.name}\n`);

        const answers = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Nombre:', default: product.name },
            { type: 'input', name: 'description', message: 'Descripción:', default: product.description },
            { type: 'number', name: 'price', message: 'Precio:', default: product.price },
            { type: 'input', name: 'category', message: 'Categoría:', default: product.category },
            { type: 'input', name: 'image_url', message: 'URL de imagen:', default: product.image_url || '' },
            {
                type: 'select', name: 'available', message: 'Disponible:',
                choices: [
                    { name: '✅ Sí', value: 1 },
                    { name: '❌ No', value: 0 },
                ],
                default: product.available === 1 ? 1 : 0,
            },
        ]);

        this.db.updateProduct(productId, {
            name: answers.name,
            description: answers.description,
            price: parseFloat(answers.price),
            category: answers.category,
            available: answers.available,
        });

        console.log(`\n✅ Producto actualizado exitosamente.\n`);
        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async deleteProduct() {
        const products = this.db.getAllProducts();
        if (products.length === 0) {
            console.log('\n📭 No hay productos para eliminar.\n');
            await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
            return;
        }

        const { productId } = await inquirer.prompt([
            {
                type: 'select',
                name: 'productId',
                message: '🗑️  Selecciona el producto a eliminar:',
                choices: products.map(p => ({
                    name: `#${p.id} ${p.name} — $${p.price.toFixed(2)}`,
                    value: p.id,
                })),
            },
        ]);

        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: '¿Estás seguro de eliminar este producto?',
                default: false,
            },
        ]);

        if (confirm) {
            this.db.deleteProduct(productId);
            console.log('\n✅ Producto eliminado.\n');
        } else {
            console.log('\nOperación cancelada.\n');
        }

        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async usersMenu() {
        const users = this.db.getAllUsers();
        console.log('\n' + '═'.repeat(55));
        console.log('👥  USUARIOS REGISTRADOS');
        console.log('═'.repeat(55));

        if (users.length === 0) {
            console.log('\n📭 No hay usuarios registrados aún.\n');
        } else {
            console.log(`\nTotal: ${users.length} usuarios\n`);
            for (const u of users) {
                console.log(`  👤 ${u.name || 'Sin nombre'} (${u.phone || 'Sin teléfono'})`);
                console.log(`     🛒 ${u.total_orders || 0} pedidos  |  💵 $${(u.total_spent || 0).toFixed(2)} gastados`);
                console.log(`     🕐 Última interacción: ${new Date(u.last_interaction).toLocaleString('es-ES')}`);
                console.log('');
            }
        }

        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async ordersMenuLoop() {
        let running = true;
        while (running) {
            const { action } = await inquirer.prompt([
                {
                    type: 'select',
                    name: 'action',
                    message: '📋 GESTIÓN DE PEDIDOS',
                    choices: [
                        { name: '🕐  Pedidos Pendientes', value: 'pending' },
                        { name: '📋  Todos los Pedidos', value: 'all' },
                        { name: '✅  Marcar como Completado', value: 'complete' },
                        { name: '❌  Cancelar Pedido', value: 'cancel' },
                        { name: '🔙  Volver al Menú Principal', value: 'back' },
                    ],
                },
            ]);

            switch (action) {
                case 'pending': await this.listOrders('pending', '🕐 PEDIDOS PENDIENTES'); break;
                case 'all': await this.listOrders(null, '📋 TODOS LOS PEDIDOS'); break;
                case 'complete': await this.changeOrderStatus('completed', '✅ Completado'); break;
                case 'cancel': await this.changeOrderStatus('cancelled', '❌ Cancelado'); break;
                case 'back': running = false; break;
            }
        }
    }

    async listOrders(status, title) {
        const orders = this.db.getOrders(status);
        console.log('\n' + '═'.repeat(55));
        console.log(title);
        console.log('═'.repeat(55));

        if (orders.length === 0) {
            console.log('\n📭 No hay pedidos.\n');
        } else {
            for (const o of orders) {
                const statusEmoji = o.status === 'pending' ? '🕐' : o.status === 'confirmed' ? '📦' : o.status === 'completed' ? '✅' : '❌';
                console.log(`\n${statusEmoji}  Pedido #${o.id}  |  ${o.user_name || 'Usuario'}`);
                console.log(`     💵 $${o.total.toFixed(2)}  |  📅 ${new Date(o.created_at).toLocaleString('es-ES')}`);
                console.log(`     📝 ${o.notes || 'Sin notas'}`);
            }
            console.log(`\nTotal: ${orders.length} pedidos\n`);
        }

        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async changeOrderStatus(newStatus, statusLabel) {
        const pending = this.db.getOrders('pending');
        if (pending.length === 0) {
            console.log('\n📭 No hay pedidos pendientes.\n');
            await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
            return;
        }

        const { orderId } = await inquirer.prompt([
            {
                type: 'select',
                name: 'orderId',
                message: `Selecciona el pedido para marcar como ${statusLabel}:`,
                choices: pending.map(o => ({
                    name: `#${o.id} — ${o.user_name || 'Usuario'} — $${o.total.toFixed(2)}`,
                    value: o.id,
                })),
            },
        ]);

        this.db.updateOrderStatus(orderId, newStatus);
        console.log(`\n✅ Pedido #${orderId} marcado como ${statusLabel}.\n`);
        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async couponsMenu() {
        let running = true;
        while (running) {
            const coupons = this.db.getCoupons();
            console.log('\n' + '═'.repeat(55));
            console.log('🏷️  CUPONES DE DESCUENTO');
            console.log('═'.repeat(55));
            if (coupons.length === 0) {
                console.log('\n📭 No hay cupones registrados.\n');
            } else {
                for (const c of coupons) {
                    const active = c.active ? '✅' : '❌';
                    const uses = c.max_uses > 0 ? `${c.used_count}/${c.max_uses}` : `${c.used_count} usos`;
                    console.log(`\n${active} *${c.code}* — ${c.discount_type === 'percentage' ? c.discount_value + '%' : '$' + c.discount_value}`);
                    if (c.description) console.log(`   📝 ${c.description}`);
                    if (c.min_purchase > 0) console.log(`   💰 Mín: $${c.min_purchase.toFixed(2)}`);
                    console.log(`   📊 ${uses}`);
                    if (c.expires_at) console.log(`   ⏳ Expira: ${new Date(c.expires_at).toLocaleDateString()}`);
                }
                console.log('');
            }
            const { action } = await inquirer.prompt([
                { type: 'select', name: 'action', message: 'Selecciona:', choices: [
                    { name: '➕  Agregar Cupón', value: 'add' },
                    ...(coupons.length > 0 ? [
                        { name: '✏️  Editar Cupón', value: 'edit' },
                        { name: '🗑️  Eliminar Cupón', value: 'delete' },
                        { name: '🔄  Activar/Desactivar', value: 'toggle' },
                    ] : []),
                    { name: '🔙  Volver', value: 'back' },
                ]},
            ]);
            switch (action) {
                case 'add':
                    const a = await inquirer.prompt([
                        { type: 'input', name: 'code', message: 'Código:', validate: v => v.trim() ? true : 'Obligatorio' },
                        { type: 'input', name: 'description', message: 'Descripción:' },
                        { type: 'select', name: 'discount_type', message: 'Tipo:', choices: [{ name: 'Porcentaje (%)', value: 'percentage' }, { name: 'Monto fijo ($)', value: 'fixed' }] },
                        { type: 'number', name: 'discount_value', message: 'Valor del descuento:', validate: v => v > 0 || 'Debe ser > 0' },
                        { type: 'number', name: 'min_purchase', message: 'Compra mínima (0 = sin mínimo):', default: 0 },
                        { type: 'number', name: 'max_uses', message: 'Usos máximos (0 = ilimitado):', default: 0 },
                        { type: 'input', name: 'expires', message: 'Fecha expiración (YYYY-MM-DD, opcional):', default: '' },
                    ]);
                    this.db.addCoupon(a.code, a.description, a.discount_type, a.discount_value, a.min_purchase, a.max_uses, a.expires || null);
                    console.log('\n✅ Cupón creado.\n');
                    await inquirer.prompt([{ type: 'input', name: 'c', message: 'Enter...' }]);
                    break;
                case 'edit': {
                    const { id } = await inquirer.prompt([{ type: 'select', name: 'id', message: 'Selecciona:', choices: coupons.map(c => ({ name: `${c.code}`, value: c.id })) }]);
                    const c = coupons.find(c => c.id === id);
                    const up = await inquirer.prompt([
                        { type: 'input', name: 'description', message: 'Descripción:', default: c.description },
                        { type: 'number', name: 'discount_value', message: 'Valor:', default: c.discount_value },
                        { type: 'number', name: 'min_purchase', message: 'Compra mínima:', default: c.min_purchase },
                        { type: 'number', name: 'max_uses', message: 'Usos máximos:', default: c.max_uses },
                    ]);
                    this.db.updateCoupon(id, up);
                    console.log('\n✅ Cupón actualizado.\n');
                    await inquirer.prompt([{ type: 'input', name: 'c', message: 'Enter...' }]);
                    break;
                }
                case 'delete': {
                    const { id } = await inquirer.prompt([{ type: 'select', name: 'id', message: 'Eliminar:', choices: coupons.map(c => ({ name: `${c.code} - ${c.discount_value}${c.discount_type === 'percentage' ? '%' : '$'}`, value: c.id })) }]);
                    this.db.deleteCoupon(id);
                    console.log('\n✅ Eliminado.\n');
                    await inquirer.prompt([{ type: 'input', name: 'c', message: 'Enter...' }]);
                    break;
                }
                case 'toggle': {
                    const { id } = await inquirer.prompt([{ type: 'select', name: 'id', message: 'Activar/Desactivar:', choices: coupons.map(c => ({ name: `${c.active ? '✅' : '❌'} ${c.code}`, value: c.id })) }]);
                    const c = coupons.find(c => c.id === id);
                    this.db.updateCoupon(id, { active: c.active ? 0 : 1 });
                    console.log(`\n✅ ${c.code} ${c.active ? 'desactivado' : 'activado'}.\n`);
                    await inquirer.prompt([{ type: 'input', name: 'c', message: 'Enter...' }]);
                    break;
                }
                case 'back': running = false; break;
            }
        }
    }

    async shipmentsMenu() {
        const shipments = this.db.getShipments();
        console.log('\n' + '═'.repeat(55));
        console.log('📦  SEGUIMIENTO DE ENVÍOS');
        console.log('═'.repeat(55));

        if (shipments.length === 0) {
            console.log('\n📭 No hay envíos registrados.\n');
        } else {
            for (const s of shipments) {
                console.log(`\n🧾 Pedido #${s.order_id}  |  👤 ${s.user_name || 'N/A'}`);
                console.log(`   🔢 Guía: ${s.tracking_number}`);
                if (s.carrier) console.log(`   🚚 ${s.carrier}`);
                if (s.tracking_url) console.log(`   🔗 ${s.tracking_url}`);
                console.log(`   📅 ${new Date(s.created_at).toLocaleString('es-ES')}`);
            }
            console.log('');
        }

        const pending = this.db.getOrders('confirmed');
        if (pending.length > 0) {
            const { add } = await inquirer.prompt([{ type: 'confirm', name: 'add', message: '¿Agregar seguimiento a un pedido?', default: false }]);
            if (add) {
                const { orderId } = await inquirer.prompt([
                    { type: 'select', name: 'orderId', message: 'Selecciona pedido:', choices: pending.map(o => ({ name: `#${o.id} — ${o.user_name || 'Usuario'} — $${o.total.toFixed(2)}`, value: o.id })) },
                ]);
                const a = await inquirer.prompt([
                    { type: 'input', name: 'tracking', message: 'Número de guía:', validate: v => v.trim() ? true : 'Obligatorio' },
                    { type: 'input', name: 'carrier', message: 'Transportista (ej: FedEx, DHL, Correos):' },
                    { type: 'input', name: 'url', message: 'URL de rastreo (opcional):' },
                ]);
                this.db.addShipment(orderId, a.tracking, a.carrier, a.url);
                this.db.updateOrderStatus(orderId, 'completed');
                console.log('\n✅ Envío registrado y pedido marcado como completado.\n');
            }
        } else {
            console.log('📭 No hay pedidos confirmados para agregar envío.\n');
        }

        await inquirer.prompt([{ type: 'input', name: 'c', message: 'Enter para volver...' }]);
    }

    async reviewsMenu() {
        const reviews = this.db.getAllReviews();
        console.log('\n' + '═'.repeat(55));
        console.log('⭐  VALORACIONES DE CLIENTES');
        console.log('═'.repeat(55));

        if (reviews.length === 0) {
            console.log('\n📭 No hay valoraciones aún.\n');
        } else {
            for (const r of reviews) {
                const stars = '⭐'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
                console.log(`\n${stars} (${r.rating}/5) — ${r.user_name || 'Anónimo'}`);
                if (r.comment) console.log(`   💬 "${r.comment}"`);
                console.log(`   🧾 Pedido #${r.order_id}  |  📅 ${new Date(r.created_at).toLocaleDateString('es-ES')}`);
            }
            console.log(`\nTotal: ${reviews.length} valoraciones\n`);
        }

        await inquirer.prompt([{ type: 'input', name: 'c', message: 'Enter para volver...' }]);
    }

    async showSystemStats() {
        const sys = this.db.getSystemStats();
        const biz = this.db.getBusinessStats();

        const fmt = (b) => { const s = ['B','KB','MB','GB']; const i = Math.floor(Math.log(b)/Math.log(1024)); return (b/Math.pow(1024,i)).toFixed(1)+' '+s[i]; };
        const fmtTime = (s) => { const d = Math.floor(s/86400); s%=86400; const h=Math.floor(s/3600); s%=3600; const m=Math.floor(s/60); return `${d}d ${h}h ${m}m`; };

        console.log('\n' + '═'.repeat(50));
        console.log('📊  ESTADÍSTICAS DEL SISTEMA');
        console.log('═'.repeat(50));
        console.log(`\n📈 *NEGOCIO*`);
        console.log(`  👥 Usuarios: ${biz.total_users}`);
        console.log(`  📦 Productos: ${biz.total_products}`);
        console.log(`  🧾 Pedidos totales: ${biz.total_orders} (${biz.pending_orders} pendientes)`);
        console.log(`  💰 Ingresos: $${Number(biz.total_revenue).toFixed(2)}`);
        if (biz.top_product) console.log(`  🏆 Más vendido: ${biz.top_product.product_name} (${biz.top_product.qty})`);
        console.log(`  🏷️ Cupones: ${biz.total_coupons}`);
        console.log(`  ⭐ Valoraciones: ${biz.total_reviews}`);
        console.log(`  📦 Envíos: ${biz.total_shipments}`);

        console.log(`\n💻 *SISTEMA*`);
        console.log(`  🖥️  ${sys.platform} | ${sys.cpu_cores} núcleos`);
        console.log(`  💾 RAM: ${fmt(sys.ram_used)} / ${fmt(sys.ram_total)} (${Math.round(sys.ram_used/sys.ram_total*100)}%)`);
        console.log(`  🕐 Activo: ${fmtTime(sys.uptime)}`);
        console.log(`  📡 Node: ${sys.node_version}\n`);

        await inquirer.prompt([{ type: 'input', name: 'c', message: 'Enter para volver...' }]);
    }

    async paymentsMenu() {
        let running = true;
        while (running) {
            const bankEnabled = this.db.getSetting('payment_bank_enabled') === '1' ? '✅' : '❌';
            const stripeEnabled = this.db.getSetting('payment_stripe_enabled') === '1' ? '✅' : '❌';
            const mpEnabled = this.db.getSetting('payment_mercadopago_enabled') === '1' ? '✅' : '❌';
            const paypalEnabled = this.db.getSetting('payment_paypal_enabled') === '1' ? '✅' : '❌';
            const bankCount = this.db.getBankAccounts().length;

            console.log('\n' + '═'.repeat(50));
            console.log('💳  CONFIGURACIÓN DE PAGOS');
            console.log('═'.repeat(50));
            console.log(`\n  Transferencia bancaria: ${bankEnabled} (${bankCount} cuentas)`);
            console.log(`  Stripe (tarjeta):      ${stripeEnabled}`);
            console.log(`  Mercado Pago:          ${mpEnabled}`);
            console.log(`  PayPal:                ${paypalEnabled}\n`);

            const { action } = await inquirer.prompt([
                {
                    type: 'select',
                    name: 'action',
                    message: 'Selecciona una opción:',
                    choices: [
                        { name: '🏦  Gestionar Cuentas Bancarias', value: 'bank_accounts' },
                        { name: '💳  Activar/Desactivar Transferencia Bancaria', value: 'toggle_bank' },
                        { name: '💳  Configurar Stripe', value: 'configure_stripe' },
                        { name: '💳  Configurar Mercado Pago', value: 'configure_mercadopago' },
                        { name: '💳  Configurar PayPal', value: 'configure_paypal' },
                        { name: '📝  Personalizar Mensaje de Pago', value: 'payment_message' },
                        { name: '🔙  Volver al Menú Principal', value: 'back' },
                    ],
                },
            ]);

            switch (action) {
                case 'bank_accounts': await this.bankAccountsMenu(); break;
                case 'toggle_bank':
                    const current = this.db.getSetting('payment_bank_enabled') === '1';
                    this.db.setSetting('payment_bank_enabled', current ? '0' : '1');
                    console.log(`\n✅ Transferencia bancaria ${current ? 'desactivada' : 'activada'}.\n`);
                    await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
                    break;
                case 'configure_stripe': await this.configurePayment('stripe_secret_key', 'Stripe Secret Key (sk_...)'); break;
                case 'configure_mercadopago': await this.configurePayment('mercadopago_access_token', 'Mercado Pago Access Token'); break;
                case 'configure_paypal': await this.configurePayPal(); break;
                case 'payment_message':
                    const currentMsg = this.db.getSetting('payment_instructions');
                    const { newMsg } = await inquirer.prompt([
                        { type: 'editor', name: 'newMsg', message: 'Edita el mensaje de opciones de pago:', default: currentMsg },
                    ]);
                    if (newMsg && newMsg.trim()) {
                        this.db.setSetting('payment_instructions', newMsg.trim());
                        console.log('\n✅ Mensaje de pago actualizado.\n');
                    }
                    await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
                    break;
                case 'back': running = false; break;
            }
        }
    }

    async bankAccountsMenu() {
        let running = true;
        while (running) {
            const accounts = this.db.getBankAccounts();
            console.log('\n' + '═'.repeat(50));
            console.log('🏦  CUENTAS BANCARIAS');
            console.log('═'.repeat(50));

            if (accounts.length === 0) {
                console.log('\n📭 No hay cuentas registradas.\n');
            } else {
                for (const a of accounts) {
                    const def = a.is_default ? ' ⭐ (predeterminada)' : '';
                    console.log(`\n  #${a.id} ${a.bank_name}${def}`);
                    console.log(`     👤 ${a.owner_name || 'Sin titular'}`);
                    if (a.clabe) console.log(`     🔢 CLABE: ${a.clabe}`);
                    if (a.account_number) console.log(`     💳 No.: ${a.account_number}`);
                    console.log(`     📂 ${a.account_type === 'checking' ? 'Cheques' : 'Ahorros'}`);
                }
                console.log('');
            }

            const { action } = await inquirer.prompt([
                {
                    type: 'select',
                    name: 'action',
                    message: 'Selecciona una opción:',
                    choices: [
                        { name: '➕  Agregar Cuenta Bancaria', value: 'add' },
                        ...(accounts.length > 0 ? [
                            { name: '✏️   Editar Cuenta', value: 'edit' },
                            { name: '🗑️   Eliminar Cuenta', value: 'delete' },
                            { name: '⭐  Establecer como Predeterminada', value: 'default' },
                        ] : []),
                        { name: '🔙  Volver a Pagos', value: 'back' },
                    ],
                },
            ]);

            switch (action) {
                case 'add': await this.addBankAccount(); break;
                case 'edit': await this.editBankAccount(accounts); break;
                case 'delete': await this.deleteBankAccount(accounts); break;
                case 'default': await this.setDefaultBankAccount(accounts); break;
                case 'back': running = false; break;
            }
        }
    }

    async addBankAccount() {
        console.log('\n--- ➕ NUEVA CUENTA BANCARIA ---\n');
        const answers = await inquirer.prompt([
            { type: 'input', name: 'bank_name', message: 'Nombre del banco:', validate: v => v.trim() ? true : 'Obligatorio' },
            { type: 'input', name: 'owner_name', message: 'Nombre del titular:' },
            {
                type: 'select', name: 'account_type', message: 'Tipo de cuenta:',
                choices: [{ name: 'Cheques', value: 'checking' }, { name: 'Ahorros', value: 'savings' }],
            },
            { type: 'input', name: 'clabe', message: 'CLABE (18 dígitos):' },
            { type: 'input', name: 'account_number', message: 'Número de cuenta:' },
        ]);

        this.db.addBankAccount(answers.bank_name, answers.account_type, answers.account_number, answers.clabe, answers.owner_name);
        console.log(`\n✅ Cuenta de ${answers.bank_name} agregada exitosamente.\n`);

        if (this.db.getBankAccounts().length === 1) {
            const first = this.db.getBankAccounts()[0];
            this.db.setDefaultBankAccount(first.id);
            console.log('⭐ Establecida como cuenta predeterminada.\n');
        }

        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async editBankAccount(accounts) {
        if (accounts.length === 0) return;
        const { accountId } = await inquirer.prompt([
            { type: 'select', name: 'accountId', message: 'Selecciona la cuenta a editar:', choices: accounts.map(a => ({ name: `#${a.id} ${a.bank_name}`, value: a.id })) },
        ]);
        const acc = accounts.find(a => a.id === accountId);
        const answers = await inquirer.prompt([
            { type: 'input', name: 'bank_name', message: 'Banco:', default: acc.bank_name },
            { type: 'input', name: 'owner_name', message: 'Titular:', default: acc.owner_name },
            { type: 'input', name: 'clabe', message: 'CLABE:', default: acc.clabe },
            { type: 'input', name: 'account_number', message: 'No. Cuenta:', default: acc.account_number },
        ]);
        this.db.updateBankAccount(accountId, answers);
        console.log('\n✅ Cuenta actualizada.\n');
        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async deleteBankAccount(accounts) {
        if (accounts.length === 0) return;
        const { accountId } = await inquirer.prompt([
            { type: 'select', name: 'accountId', message: 'Selecciona la cuenta a eliminar:', choices: accounts.map(a => ({ name: `#${a.id} ${a.bank_name}${a.is_default ? ' ⭐' : ''}`, value: a.id })) },
        ]);
        const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: '¿Eliminar esta cuenta?', default: false }]);
        if (confirm) {
            this.db.deleteBankAccount(accountId);
            const remaining = this.db.getBankAccounts();
            if (remaining.length > 0 && !remaining.some(a => a.is_default)) {
                this.db.setDefaultBankAccount(remaining[0].id);
                console.log(`⭐ Nueva cuenta predeterminada: ${remaining[0].bank_name}`);
            }
            console.log('\n✅ Cuenta eliminada.\n');
        }
        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async setDefaultBankAccount(accounts) {
        if (accounts.length <= 1) {
            console.log('\n📭 Solo hay una cuenta, ya es la predeterminada.\n');
            await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
            return;
        }
        const { accountId } = await inquirer.prompt([
            { type: 'select', name: 'accountId', message: 'Selecciona la cuenta predeterminada:', choices: accounts.map(a => ({ name: `${a.is_default ? '⭐ ' : '  '} #${a.id} ${a.bank_name}`, value: a.id })) },
        ]);
        this.db.setDefaultBankAccount(accountId);
        console.log('\n⭐ Cuenta predeterminada actualizada.\n');
        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async configurePayment(settingKey, label) {
        const currentValue = this.db.getSetting(settingKey) || '';
        const hidden = currentValue.length > 8 ? currentValue.slice(0, 8) + '...' : '(vacio)';
        const { newValue } = await inquirer.prompt([
            { type: 'input', name: 'newValue', message: `${label}:\n(Actual: ${hidden})\n\nNuevo valor (deja vacío para borrar):`, default: currentValue },
        ]);
        this.db.setSetting(settingKey, newValue.trim());
        console.log('\n✅ Configuración guardada.\n');

        if (settingKey === 'stripe_secret_key' && newValue.trim()) {
            this.db.setSetting('payment_stripe_enabled', '1');
            console.log('✅ Stripe activado automáticamente.\n');
        }
        if (settingKey === 'mercadopago_access_token' && newValue.trim()) {
            this.db.setSetting('payment_mercadopago_enabled', '1');
            console.log('✅ Mercado Pago activado automáticamente.\n');
        }

        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async configurePayPal() {
        const clientId = this.db.getSetting('paypal_client_id') || '';
        const clientSecret = this.db.getSetting('paypal_client_secret') || '';
        const mode = this.db.getSetting('paypal_mode') || 'sandbox';

        const answers = await inquirer.prompt([
            { type: 'input', name: 'client_id', message: 'PayPal Client ID:', default: clientId },
            { type: 'input', name: 'client_secret', message: 'PayPal Client Secret:', default: clientSecret },
            { type: 'select', name: 'mode', message: 'Modo:', choices: [{ name: '🔧 Sandbox (pruebas)', value: 'sandbox' }, { name: '🌐 Live (producción)', value: 'live' }], default: mode === 'live' ? 'live' : 'sandbox' },
        ]);

        this.db.setSetting('paypal_client_id', answers.client_id.trim());
        this.db.setSetting('paypal_client_secret', answers.client_secret.trim());
        this.db.setSetting('paypal_mode', answers.mode);

        if (answers.client_id.trim() && answers.client_secret.trim()) {
            this.db.setSetting('payment_paypal_enabled', '1');
            console.log('\n✅ PayPal configurado y activado.\n');
        } else {
            console.log('\n✅ Configuración guardada. PayPal no se activará hasta que tengas ambas llaves.\n');
        }

        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async settingsMenuLoop() {
        let running = true;
        while (running) {
            console.log('\n' + '═'.repeat(50));
            console.log('⚙️  CONFIGURACIÓN DEL NEGOCIO');
            console.log('═'.repeat(50));

            const settings = this.db.getAllSettings();
            console.log('\nConfiguración actual:\n');
            for (const s of settings) {
                const display = s.value.length > 60 ? s.value.slice(0, 60) + '...' : s.value;
                console.log(`  • ${s.key}: ${display}`);
            }

            const { action } = await inquirer.prompt([
                {
                    type: 'select',
                    name: 'action',
                    message: '\n¿Qué deseas configurar?',
                    choices: [
                        { name: '🏪  Nombre del Negocio', value: 'business_name' },
                        { name: '💵  Moneda (USD, EUR, MXN, etc.)', value: 'currency' },
                        { name: '📝  Mensaje de Bienvenida', value: 'welcome_message' },
                        { name: '📦  Mensaje del Catálogo', value: 'catalog_message' },
                        { name: '✅  Mensaje de Confirmación de Pedido', value: 'order_confirmation' },
                        { name: '📋  Mensaje de Ayuda', value: 'help_message' },
                        { name: '👤  Número del Dueño (para notificaciones)', value: 'owner_number' },
                        { name: '--- Configuración del Propietario ---', value: '__sep__' },
                        { name: '👤  Nombre del Propietario', value: 'owner_name' },
                        { name: '📧  Email del Propietario', value: 'owner_email' },
                        { name: '📱  Teléfono del Propietario', value: 'owner_phone' },
                        { name: '🔙  Volver al Menú Principal', value: 'back' },
                    ],
                },
            ]);

            if (action === 'back') {
                running = false;
                continue;
            }

            const currentValue = this.db.getSetting(action) || '';
            const isLong = ['welcome_message', 'catalog_message', 'order_confirmation', 'help_message'].includes(action);
            const { newValue } = await inquirer.prompt([
                {
                    type: isLong ? 'editor' : 'input',
                    name: 'newValue',
                    message: `Nuevo valor para "${action}"\n(Actual: ${currentValue.slice(0, 80)}${currentValue.length > 80 ? '...' : ''})\n\nEscribe el nuevo valor:`,
                    default: currentValue,
                    ...(isLong ? {} : { validate: v => v.trim() ? true : 'El valor no puede estar vacío' }),
                },
            ]);

            if (newValue && newValue.trim()) {
                this.db.setSetting(action, newValue.trim());
                console.log('\n✅ Configuración actualizada.\n');
            }

            await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
        }
    }

    async toggleBot() {
        if (this.botRunning) {
            await this.bot.stop();
            this.botRunning = false;
            console.log('\n⏹️  Bot detenido.\n');
        } else {
            console.log('\n🚀 Iniciando bot de WhatsApp...');
            console.log('Escanea el código QR con WhatsApp para conectar.\n');

            this.botRunning = true;
            try {
                await this.bot.start((status) => {
                    if (status === 'connected') {
                        console.log('\n✅ Bot conectado exitosamente!');
                    } else if (status === 'reconnecting') {
                        console.log('🔄 Reconectando...');
                    } else if (status === 'logged_out') {
                        console.log('\n❌ Sesión cerrada. Elimina la carpeta auth_info_baileys y vuelve a iniciar.');
                    }
                });

                console.log('📌 El bot se está ejecutando en segundo plano.');
                console.log('Puedes volver al menú principal mientras el bot sigue activo.\n');
            } catch (err) {
                this.botRunning = false;
                console.log(`\n❌ Error al iniciar el bot: ${err.message}\n`);
            }
        }

        await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Presiona Enter para continuar...' }]);
    }

    async exit() {
        if (this.botRunning) {
            const { confirm } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: 'El bot está funcionando. ¿Deseas detenerlo y salir?',
                    default: false,
                },
            ]);
            if (!confirm) return false;
            await this.bot.stop();
        }

        this.db.close();
        console.log('\n👋 ¡Hasta luego! Gracias por usar WhatsBusiness Bot.\n');
        process.exit(0);
    }
}

module.exports = BusinessMenu;
