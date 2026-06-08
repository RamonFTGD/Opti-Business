const { startWebServer } = require('../server');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const WhatsAppBot = require('./bot');
const DatabaseManager = require('./database');

let tunnelUrl = null;
let tunnelProcess = null;

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
    catch (e) { return {}; }
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

async function askForApiKey() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question('\n🔑 Ingresa tu API Key de OptiShield: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function startOptiShieldTunnel(port) {
    const config = loadConfig();
    
    // Inicializar sección optishield si no existe
    if (!config.optishield) config.optishield = {};

    let apikey = config.optishield.apikey;

    // Si no hay API key, pedirla al usuario
    if (!apikey) {
        console.log('\n⚠️  No se encontró API Key de OptiShield en config.json');
        console.log('   Para exponer el dashboard al mundo exterior, necesitas una API Key.');
        console.log('   Obtén una en: https://optishield.uk\n');
        
        apikey = await askForApiKey();
        
        if (!apikey) {
            console.log('\n⚠️  No se ingresó API Key. El dashboard solo estará disponible en localhost.\n');
            return null;
        }

        // Guardar en config.json
        config.optishield.apikey = apikey;
        saveConfig(config);
        console.log('✅ API Key guardada en config.json\n');
    }

    console.log(`🔗 Abriendo túnel OptiShield...`);
    console.log(`   Exponiendo http://localhost:${port}\n`);

    const tunnelScript = path.join(__dirname, '..', 'tunnel-client.js');
    
    if (!fs.existsSync(tunnelScript)) {
        console.log('⚠️  tunnel-client.js no encontrado. El dashboard solo estará en localhost.');
        return null;
    }

    return new Promise((resolve) => {
        let urlResolved = false;
        let buffer = '';

        tunnelProcess = spawn('node', [tunnelScript, '--port', String(port), '--apikey', apikey], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: path.join(__dirname, '..'),
        });

        tunnelProcess.stdout.on('data', (data) => {
            const text = data.toString();
            buffer += text;
            process.stdout.write(text);

            // Buscar la URL del túnel en la salida
            const urlMatch = buffer.match(/https:\/\/[^\s]+\/web\/[a-zA-Z0-9_-]+/);
            if (urlMatch && !urlResolved) {
                urlResolved = true;
                tunnelUrl = urlMatch[0];
                resolve(urlMatch[0]);
            }
        });

        tunnelProcess.stderr.on('data', (data) => {
            process.stderr.write(data);
        });

        tunnelProcess.on('close', (code) => {
            tunnelProcess = null;
            if (!urlResolved) {
                console.log('\n⚠️  El túnel se cerró inesperadamente.');
                resolve(null);
            }
        });

        tunnelProcess.on('error', (err) => {
            tunnelProcess = null;
            console.log(`\n⚠️  Error iniciando túnel: ${err.message}`);
            resolve(null);
        });

        // Timeout por si no se obtiene URL
        setTimeout(() => {
            if (!urlResolved) {
                if (buffer) {
                    // Revisar si ya tenemos la URL en el buffer
                    const match = buffer.match(/https:\/\/[^\s]+\/web\/[a-zA-Z0-9_-]+/);
                    if (match) {
                        urlResolved = true;
                        tunnelUrl = match[0];
                        resolve(match[0]);
                        return;
                    }
                }
                console.log('\n⚠️  Tiempo de espera del túnel agotado.');
                resolve(null);
            }
        }, 20000);
    });
}

function cleanup() {
    if (tunnelProcess) {
        try { tunnelProcess.kill(); } catch (e) {}
        tunnelProcess = null;
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

    await startOptiShieldTunnel(port);

    console.log('');
    if (tunnelUrl) {
        console.log(`🌐 Dashboard público: ${tunnelUrl}`);
    } else {
        console.log(`🌐 Dashboard local: http://localhost:${port}`);
    }
    console.log('📋 Mostrando logs en tiempo real. Presiona Ctrl+C para salir.');
    console.log('');

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Mantener el proceso vivo — solo logs en la terminal
    await new Promise(() => {});
}

main();
