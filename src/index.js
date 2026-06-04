const { startWebServer } = require('../server');
const { spawn } = require('child_process');
const path = require('path');
const BusinessMenu = require('./menu');
const WhatsAppBot = require('./bot');
const DatabaseManager = require('./database');

let tunnelUrl = null;
let cloudflaredProcess = null;

async function startCloudflared(port) {
    return new Promise((resolve) => {
        console.log('🔗 Abriendo túnel Cloudflared...\n');

        const cfPath = require.resolve('cloudflared');
        const cfDir = cfPath.substring(0, cfPath.lastIndexOf('node_modules'));
        const binaryPath = require('child_process').execSync(
            `node -e "console.log(require('cloudflared').binaryPath || '')"`,
            { encoding: 'utf8', cwd: __dirname }
        ).trim();

        const cloudflaredBin = binaryPath || 'cloudflared';

        try {
            const cf = spawn(cloudflaredBin, ['tunnel', '--url', `http://localhost:${port}`], {
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: false,
            });

            const extractTunnelUrl = (output) => {
                const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
                if (urlMatch && !tunnelUrl) {
                    tunnelUrl = urlMatch[0];
                    console.log(`\n🔗 Dashboard web disponible:`);
                    console.log(`   🌐 ${tunnelUrl}\n`);
                    resolve(tunnelUrl);
                }
            };

            cf.stdout.on('data', (data) => {
                extractTunnelUrl(data.toString());
            });

            cf.stderr.on('data', (data) => {
                extractTunnelUrl(data.toString());
            });

            cf.on('close', (code) => {
                console.log(`\n⚠️  Túnel Cloudflared cerrado (código ${code})`);
                tunnelUrl = null;
                cloudflaredProcess = null;
                resolve(null);
            });

            cf.on('error', (err) => {
                console.log(`\n⚠️  No se pudo iniciar Cloudflared: ${err.message}`);
                console.log('   El dashboard sigue disponible en localhost');
                resolve(null);
            });

            cloudflaredProcess = cf;

            setTimeout(() => {
                if (!tunnelUrl) {
                    console.log('\n⚠️  Tiempo de espera del túnel agotado. El dashboard sigue en localhost.');
                    resolve(null);
                }
            }, 15000);
        } catch (err) {
            console.log(`\n⚠️  Error iniciando Cloudflared: ${err.message}`);
            console.log('   El dashboard sigue disponible en localhost');
            resolve(null);
        }
    });
}

function cleanup() {
    if (cloudflaredProcess) {
        try { cloudflaredProcess.kill(); } catch (e) {}
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
