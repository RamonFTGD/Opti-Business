const { startWebServer } = require('../server');
const fs = require('fs');
const path = require('path');
const { Tunnel } = require('cloudflared');
const BusinessMenu = require('./menu');
const WhatsAppBot = require('./bot');
const DatabaseManager = require('./database');

let tunnelUrl = null;
let cloudflaredProcess = null;

function getTunnelTimeout() {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
        return config.bot?.tunnel_timeout_ms || 15000;
    } catch (e) {
        return 15000;
    }
}

async function startCloudflared(port) {
    return new Promise((resolve) => {
        console.log('🔗 Abriendo túnel Cloudflared...\n');

        try {
            const tunnel = Tunnel.quick(`http://127.0.0.1:${port}`);

            tunnel.once('url', (url) => {
                tunnelUrl = url;
                console.log(`\n🔗 Dashboard web disponible:`);
                console.log(`   🌐 ${tunnelUrl}\n`);
                resolve(tunnelUrl);
            });

            tunnel.once('error', (err) => {
                console.log(`\n⚠️  Error en túnel Cloudflared: ${err.message}`);
                resolve(null);
            });

            tunnel.once('exit', (code) => {
                console.log(`\n⚠️  Túnel Cloudflared cerrado (código ${code})`);
                tunnelUrl = null;
                cloudflaredProcess = null;
                resolve(null);
            });

            cloudflaredProcess = tunnel;

            const timeout = getTunnelTimeout();
            setTimeout(() => {
                if (!tunnelUrl) {
                    console.log('\n⚠️  Tiempo de espera del túnel agotado. El dashboard sigue en localhost.');
                    resolve(null);
                }
            }, timeout);
        } catch (err) {
            console.log(`\n⚠️  Error iniciando Cloudflared: ${err.message}`);
            console.log('   El dashboard sigue disponible en localhost');
            resolve(null);
        }
    });
}

function cleanup() {
    if (cloudflaredProcess) {
        try { cloudflaredProcess.stop(); } catch (e) {}
        cloudflaredProcess = null;
    }
    process.exit(0);
}

async function main() {
    console.log(`\n╔══════════════════════════════════════════╗
║                                          ║
║     🤖 WHATSBUSINESS BOT v2.0           ║
║     Automatización de Negocios           ║
║     por WhatsApp + Dashboard Web         ║
║                                          ║
║     🚀 Cargando panel de control...       ║
║                                          ║
╚══════════════════════════════════════════╝
`);

    const db = await DatabaseManager.create();

    console.log('🤖 Iniciando bot de WhatsApp...');
    const bot = new WhatsAppBot(db);
    
    console.log('🌐 Iniciando servidor web...');
    const port = await startWebServer(bot, db);
    console.log(`📡 Servidor local: http://localhost:${port}`);

    bot.start((status, data) => {
        if (status === 'connected') {
            console.log('✅ WhatsApp conectado!');
        } else if (status === 'qr') {
            console.log('📱 QR generado — escanea con WhatsApp Web');
        } else if (status === 'reconnecting') {
            console.log('🔄 Reconectando WhatsApp...');
        } else if (status === 'logged_out') {
            console.log('🚪 Sesión de WhatsApp cerrada');
        }
    }).catch(err => {
        console.error('Error iniciando bot:', err.message);
        console.log('⚠️  El bot se reiniciará automáticamente. El dashboard web sigue disponible.');
    });

    startCloudflared(port);

    const menu = new BusinessMenu(db, bot);

    const origGetHeader = menu.getHeader.bind(menu);
    menu.getHeader = () => {
        const base = origGetHeader();
        const botStatus = bot.isRunning ? '✅ WhatsApp Conectado' : '📱 QR pendiente';
        const urlLine = tunnelUrl
            ? `║  🌐 ${tunnelUrl.slice(0, 45).padEnd(39)}║`
            : `║  🌐 http://localhost:${String(port).padEnd(38)}║`;
        return `${base}\n${urlLine}\n║  ${botStatus.padEnd(46)}║`;
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    menu.start().catch((err) => {
        if (err.name === 'ExitPromptError') return;
        console.error('Error fatal:', err);
        cleanup();
    });
}

main();
