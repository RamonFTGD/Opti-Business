class MessageFormatter {
    constructor(db) {
        this.db = db;
    }

    get(key, vars = {}) {
        let template = this.db.getSetting(key);
        if (!template) return '';

        const businessName = this.db.getSetting('business_name') || 'Mi Negocio';
        const currency = this.db.getSetting('currency') || 'USD';

        const defaults = {
            business_name: businessName,
            currency,
            name: '',
            products: '',
            total: '',
            order_details: '',
            order_id: '',
            example: 'Producto Ejemplo',
        };

        const allVars = { ...defaults, ...vars };

        for (const [key, value] of Object.entries(allVars)) {
            template = template.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }

        return template;
    }

    formatProductList(products, currency = 'USD') {
        if (!products || products.length === 0) {
            return '_No hay productos disponibles._';
        }

        const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '$';
        const grouped = {};

        for (const p of products) {
            if (!grouped[p.category]) grouped[p.category] = [];
            grouped[p.category].push(p);
        }

        let result = '';
        for (const [category, items] of Object.entries(grouped)) {
            result += `\n*📂 ${category}*\n`;
            for (const p of items) {
                const imgEmoji = p.image_url ? ' 📸' : '';
                result += `  ${p.id}. *${p.name}*${imgEmoji} — ${symbol}${p.price.toFixed(2)}\n`;
                if (p.description) {
                    result += `     _${p.description}_\n`;
                }
            }
        }

        result += `\n📌 Para ver detalle con foto: *ver [nombre o #]*`;
        result += `\n📌 Para comprar: *agrega [nombre]* o *quiero [nombre]*`;

        return result.trim();
    }

    formatOrderDetails(order) {
        if (!order) return '';

        let details = '';
        for (const item of order.items) {
            const subtotal = (item.quantity * item.unit_price).toFixed(2);
            details += `• ${item.quantity}x ${item.product_name} — $${subtotal}\n`;
        }
        return details.trim();
    }

    formatOrderForWhatsApp(order) {
        const currency = this.db.getSetting('currency') || 'USD';
        const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '$';

        const statusEmojis = {
            pending: '🕐',
            confirmed: '📦',
            completed: '✅',
            cancelled: '❌',
        };

        const statusTexts = {
            pending: 'Pendiente',
            confirmed: 'Confirmado',
            completed: 'Completado',
            cancelled: 'Cancelado',
        };

        let text = `*🧾 Pedido #${order.id}*\n`;
        text += `${statusEmojis[order.status] || '📋'} *Estado:* ${statusTexts[order.status] || order.status}\n\n`;
        text += `*Productos:*\n`;

        for (const item of order.items) {
            const subtotal = (item.quantity * item.unit_price).toFixed(2);
            text += `  ${item.quantity}x ${item.product_name} — ${symbol}${subtotal}\n`;
        }

        text += `\n*Total:* ${symbol}${order.total.toFixed(2)}`;
        text += `\n*Fecha:* ${new Date(order.created_at).toLocaleDateString('es-ES', {
            day: 'numeric', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        })}`;

        return text;
    }
}

module.exports = MessageFormatter;
