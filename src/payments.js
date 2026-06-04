const stripe = require('stripe');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const axios = require('axios');

class PaymentManager {
    constructor(db) {
        this.db = db;
    }

    getEnabledMethods() {
        const methods = [];
        if (this.db.getSetting('payment_bank_enabled') === '1') methods.push('bank');
        if (this.db.getSetting('payment_stripe_enabled') === '1') methods.push('stripe');
        if (this.db.getSetting('payment_mercadopago_enabled') === '1') methods.push('mercadopago');
        if (this.db.getSetting('payment_paypal_enabled') === '1') methods.push('paypal');
        return methods;
    }

    async getPaymentOptionsMessage(order, currency) {
        const methods = this.getEnabledMethods();
        if (methods.length === 0) {
            return '📋 Tu pedido ha sido registrado. Te contactaremos pronto para coordinar el pago y la entrega. 🙌';
        }

        const symbol = this.getCurrencySymbol(currency || 'MXN');
        const ownerPhone = this.db.getSetting('owner_phone');
        let optionsText = '';

        for (let i = 0; i < methods.length; i++) {
            const num = i + 1;
            switch (methods[i]) {
                case 'bank':
                    optionsText += `${num}. 💳 Transferencia bancaria\n`;
                    break;
                case 'stripe':
                    optionsText += `${num}. 💳 Tarjeta (Stripe)\n`;
                    break;
                case 'mercadopago':
                    optionsText += `${num}. 💳 Mercado Pago (tarjeta/OXXO/transferencia)\n`;
                    break;
                case 'paypal':
                    optionsText += `${num}. 💳 PayPal\n`;
                    break;
            }
        }

        optionsText += `\n💰 *Total a pagar:* ${symbol}${order.total.toFixed(2)}`;

        if (ownerPhone) {
            optionsText += `\n\n📱 *¿Dudas? Escríbenos:* ${ownerPhone}`;
        }

        const template = this.db.getSetting('payment_instructions') || '💳 *Opciones de Pago*\n\n{options}\n\nSelecciona un método de pago escribiendo el número correspondiente.';
        return template.replace('{options}', optionsText).replace('{total}', `${symbol}${order.total.toFixed(2)}`);
    }

    async processPaymentSelection(order, methodIndex, currency) {
        const methods = this.getEnabledMethods();
        const idx = parseInt(methodIndex) - 1;

        if (isNaN(idx) || idx < 0 || idx >= methods.length) {
            return {
                success: false,
                message: '❌ Opción inválida. Por favor, escribe el número del método de pago que prefieras.',
            };
        }

        const method = methods[idx];
        const symbol = this.getCurrencySymbol(currency || 'MXN');

        try {
            switch (method) {
                case 'bank':
                    return this.processBankPayment(order, symbol);
                case 'stripe':
                    return await this.processStripePayment(order, symbol);
                case 'mercadopago':
                    return await this.processMercadoPagoPayment(order, symbol);
                case 'paypal':
                    return await this.processPayPalPayment(order, symbol);
                default:
                    return { success: false, message: '❌ Método no disponible.' };
            }
        } catch (err) {
            console.error(`Payment error (${method}):`, err.message);
            return {
                success: false,
                message: `❌ Error al procesar el pago: ${err.message}\n\nPor favor, intenta con otro método o contacta al vendedor.`,
            };
        }
    }

    processBankPayment(order, symbol) {
        const account = this.db.getDefaultBankAccount();
        const ownerPhone = this.db.getSetting('owner_phone');
        const ownerName = this.db.getSetting('owner_name') || 'Propietario';

        this.db.updateOrderPaymentInfo(order.id, 'bank', null, null);

        let msg = `💳 *Transferencia Bancaria*\n\n`;
        msg += `📋 *Pedido #${order.id}*\n`;
        msg += `💰 *Total:* ${symbol}${order.total.toFixed(2)}\n\n`;

        if (account) {
            msg += `🏦 *Banco:* ${account.bank_name}\n`;
            if (account.clabe) msg += `🔢 *CLABE:* \`${account.clabe}\`\n`;
            if (account.owner_name) msg += `👤 *Titular:* ${account.owner_name}\n`;
        } else {
            msg += `_(No hay cuentas bancarias configuradas. Contacta al vendedor.)_\n`;
        }

        if (ownerPhone) {
            msg += `\n📱 *Enviar comprobante a:* ${ownerPhone}\n`;
            msg += `💬 O envía tu comprobante directamente por este chat\n`;
        }

        msg += `\n📌 *Instrucciones:*\n`;
        msg += `1. Realiza la transferencia por *${symbol}${order.total.toFixed(2)}*\n`;
        msg += `2. Envía el comprobante al propietario\n`;
        msg += `3. Escribe *"pagado"* para confirmar\n\n`;
        msg += `_El propietario ${ownerName} verificará tu pago._`;

        return { success: true, method: 'bank', message: msg, requiresConfirmation: true };
    }

    async processStripePayment(order, symbol) {
        const secretKey = this.db.getSetting('stripe_secret_key');
        const ownerPhone = this.db.getSetting('owner_phone');
        if (!secretKey) {
            return { success: false, message: '❌ Stripe no está configurado. Contacta al vendedor.' };
        }

        const stripeClient = stripe(secretKey);

        const productName = order.items.map(i => `${i.quantity}x ${i.product_name}`).join(', ');
        const priceInCents = Math.round(order.total * 100);

        const paymentLink = await stripeClient.paymentLinks.create({
            line_items: [{
                price_data: {
                    currency: this.getStripeCurrency(this.db.getSetting('currency') || 'MXN'),
                    product_data: { name: `Pedido #${order.id} - ${productName}` },
                    unit_amount: priceInCents,
                },
                quantity: 1,
            }],
            metadata: { order_id: String(order.id) },
            after_completion: { type: 'redirect', redirect: { url: 'https://wa.me/' } },
        });

        this.db.updateOrderPaymentInfo(order.id, 'stripe', paymentLink.url, paymentLink.id);

        let msg = `💳 *Pago con Tarjeta (Stripe)*\n\n`;
        msg += `📋 *Pedido #${order.id}* — *Total:* ${symbol}${order.total.toFixed(2)}\n\n`;
        msg += `🔗 *Paga aquí:*\n${paymentLink.url}\n\n`;
        if (ownerPhone) {
            msg += `📱 *¿Dudas? Contacta:* ${ownerPhone}\n\n`;
        }
        msg += `Una vez realizado el pago, escribe *"pagado"* para confirmar.`;

        return {
            success: true,
            method: 'stripe',
            message: msg,
            link: paymentLink.url,
        };
    }

    async processMercadoPagoPayment(order, symbol) {
        const accessToken = this.db.getSetting('mercadopago_access_token');
        const ownerPhone = this.db.getSetting('owner_phone');
        if (!accessToken) {
            return { success: false, message: '❌ Mercado Pago no está configurado. Contacta al vendedor.' };
        }

        const client = new MercadoPagoConfig({ accessToken });
        const preference = new Preference(client);

        const items = order.items.map(item => ({
            title: item.product_name,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            currency_id: this.getMPCurrency(this.db.getSetting('currency') || 'MXN'),
        }));

        const result = await preference.create({
            body: {
                items,
                external_reference: String(order.id),
                back_urls: {
                    success: 'https://wa.me/',
                    failure: 'https://wa.me/',
                    pending: 'https://wa.me/',
                },
                auto_return: 'approved',
                notification_url: '',
            },
        });

        const initPoint = result.init_point || result.sandbox_init_point || result.body?.init_point;
        const prefId = result.id || result.body?.id;

        this.db.updateOrderPaymentInfo(order.id, 'mercadopago', initPoint, prefId);

        let msg = `💳 *Pago con Mercado Pago*\n\n`;
        msg += `📋 *Pedido #${order.id}* — *Total:* ${symbol}${order.total.toFixed(2)}\n\n`;
        msg += `🔗 *Paga aquí:*\n${initPoint}\n\n`;
        msg += `✅ Acepta: tarjetas débito/crédito, efectivo (OXXO) y transferencia.\n\n`;
        if (ownerPhone) {
            msg += `📱 *¿Dudas? Contacta:* ${ownerPhone}\n\n`;
        }
        msg += `Una vez realizado el pago, escribe *"pagado"* para confirmar.`;

        return {
            success: true,
            method: 'mercadopago',
            message: msg,
            link: initPoint,
        };
    }

    async processPayPalPayment(order, symbol) {
        const clientId = this.db.getSetting('paypal_client_id');
        const clientSecret = this.db.getSetting('paypal_client_secret');
        const ownerPhone = this.db.getSetting('owner_phone');
        if (!clientId || !clientSecret) {
            return { success: false, message: '❌ PayPal no está configurado. Contacta al vendedor.' };
        }

        const mode = this.db.getSetting('paypal_mode') || 'sandbox';
        const baseUrl = mode === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';

        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const tokenRes = await axios.post(
            `${baseUrl}/v1/oauth2/token`,
            'grant_type=client_credentials',
            {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );
        const accessToken = tokenRes.data.access_token;

        const currencyCode = this.getPayPalCurrency(this.db.getSetting('currency') || 'MXN');
        const orderRes = await axios.post(
            `${baseUrl}/v2/checkout/orders`,
            {
                intent: 'CAPTURE',
                purchase_units: [{
                    reference_id: String(order.id),
                    description: `Pedido #${order.id}`,
                    amount: {
                        currency_code: currencyCode,
                        value: order.total.toFixed(2),
                        breakdown: {
                            item_total: {
                                currency_code: currencyCode,
                                value: order.total.toFixed(2),
                            },
                        },
                    },
                    items: order.items.map(item => ({
                        name: item.product_name,
                        unit_amount: { currency_code: currencyCode, value: item.unit_price.toFixed(2) },
                        quantity: String(item.quantity),
                        category: 'PHYSICAL_GOODS',
                    })),
                }],
                application_context: {
                    brand_name: this.db.getSetting('business_name') || 'Mi Negocio',
                    landing_page: 'LOGIN',
                    user_action: 'PAY_NOW',
                    shipping_preference: 'NO_SHIPPING',
                },
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const approveLink = orderRes.data.links.find(l => l.rel === 'approve');
        const paypalOrderId = orderRes.data.id;

        this.db.updateOrderPaymentInfo(order.id, 'paypal', approveLink?.href, paypalOrderId);

        let msg = `💳 *Pago con PayPal*\n\n`;
        msg += `📋 *Pedido #${order.id}* — *Total:* ${symbol}${order.total.toFixed(2)}\n\n`;
        msg += `🔗 *Paga aquí:*\n${approveLink?.href || 'https://paypal.com'}\n\n`;
        if (ownerPhone) {
            msg += `📱 *¿Dudas? Contacta:* ${ownerPhone}\n\n`;
        }
        msg += `Una vez realizado el pago, escribe *"pagado"* para confirmar.`;

        return {
            success: true,
            method: 'paypal',
            message: msg,
            link: approveLink?.href,
        };
    }

    getCurrencySymbol(currency) {
        const symbols = { USD: '$', MXN: '$', EUR: '€', ARS: '$', COP: '$', CLP: '$', BRL: 'R$', PEN: 'S/' };
        return symbols[currency.toUpperCase()] || '$';
    }

    getStripeCurrency(currency) {
        const map = { MXN: 'mxn', USD: 'usd', EUR: 'eur', ARS: 'ars', COP: 'cop', BRL: 'brl' };
        return map[currency.toUpperCase()] || 'mxn';
    }

    getMPCurrency(currency) {
        const map = { MXN: 'MXN', USD: 'USD', ARS: 'ARS', COP: 'COP', CLP: 'CLP', BRL: 'BRL' };
        return map[currency.toUpperCase()] || 'MXN';
    }

    getPayPalCurrency(currency) {
        const map = { MXN: 'MXN', USD: 'USD', EUR: 'EUR', ARS: 'ARS', COP: 'COP', BRL: 'BRL' };
        return map[currency.toUpperCase()] || 'MXN';
    }
}

module.exports = PaymentManager;
