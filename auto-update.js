#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════
// AUTO-UPDATE - Opti-Business Bot
// Verifica automáticamente si hay actualizaciones en GitHub y las aplica
// ═════════════════════════════════════════════════════════════════════════
//
// Uso:
//   node auto-update.js          Inicia el bot con auto-update activado
//   AUTO_UPDATE=false node src/index.js   Inicia sin auto-update
//
// El token de GitHub se lee desde el archivo .token (gitignoreado)
// ═════════════════════════════════════════════════════════════════════════

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BRANCH = 'BotWhatsapp-MD';
const CHECK_INTERVAL = 60_000; // 1 minuto
const PROJECT_DIR = __dirname;

let isUpdating = false;
let botProcess = null;

// ── Cargar token desde .token ──
function loadToken() {
  try {
    const tokenPath = path.join(PROJECT_DIR, '.token');
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, 'utf8').trim();
    }
  } catch (e) {}
  return null;
}

// ── Obtener URL del repo con token ──
function getRepoUrl() {
  const token = loadToken();
  if (!token) return null;
  return `https://${token}@github.com/RamonFTGD/Opti-Business.git`;
}

// ── Logging ──
function log(msg) {
  const ts = new Date().toLocaleTimeString('es-MX');
  console.log(`[${ts}] [AutoUpdate] ${msg}`);
}

// ── Configurar remote si no existe ──
function ensureRemote() {
  const repoUrl = getRepoUrl();
  if (!repoUrl) {
    log('⚠️ No hay token en .token — auto-update deshabilitado');
    return false;
  }

  try {
    const remotes = execSync('git remote -v', { cwd: PROJECT_DIR, encoding: 'utf8' });
    if (!remotes.includes('origin')) {
      execSync(`git remote add origin ${repoUrl}`, { cwd: PROJECT_DIR });
      log('✅ Remote origin agregado');
    } else {
      // Asegurar que el remote tenga el token
      execSync(`git remote set-url origin ${repoUrl}`, { cwd: PROJECT_DIR });
    }
    return true;
  } catch (e) {
    log(`⚠️ Error configurando remote: ${e.message}`);
    return false;
  }
}

// ── Verificar si hay actualizaciones ──
async function checkForUpdates() {
  return new Promise((resolve) => {
    try {
      execSync(`git fetch origin ${BRANCH}`, { cwd: PROJECT_DIR, timeout: 15000, stdio: 'pipe' });
      const status = execSync(`git rev-list HEAD...origin/${BRANCH} --count`, {
        cwd: PROJECT_DIR, encoding: 'utf8', timeout: 10000
      }).trim();

      const behind = parseInt(status) || 0;
      if (behind > 0) {
        log(`📦 ${behind} nuevo(s) commit(s) detectado(s)`);
        resolve(true);
      } else {
        resolve(false);
      }
    } catch (e) {
      // Error silencioso — puede ser de red
      resolve(false);
    }
  });
}

// ── Merge profundo de objetos (para config.json) ──
function deepMerge(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = deepMerge(result[key] || {}, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

// ── Aplicar actualización ──
async function applyUpdate() {
  if (isUpdating) return;
  isUpdating = true;

  log('🔄 Aplicando actualización...');

  try {
    // Guardar config.json antes del pull
    let localConfig = null;
    const configPath = path.join(PROJECT_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    // Hacer pull
    execSync(`git pull origin ${BRANCH} --no-edit`, {
      cwd: PROJECT_DIR, timeout: 30000, stdio: 'pipe'
    });
    log('✅ Pull completado');

    // Fusionar config.json local con el nuevo (deep merge)
    if (localConfig) {
      let newConfig = {};
      if (fs.existsSync(configPath)) {
        try { newConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
      }
      const merged = deepMerge(newConfig, localConfig);
      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
      log('✅ Config.json fusionado y preservado');
    }

    // Reinstalar dependencias si es necesario
    try {
      execSync('npm install --ignore-scripts 2>/dev/null || npm install', {
        cwd: PROJECT_DIR, timeout: 60000, stdio: 'pipe'
      });
    } catch (e) {
      log(`⚠️ npm install: ${e.message}`);
    }

    log('✅ Actualización completada');
    isUpdating = false;
    return true;
  } catch (e) {
    log(`❌ Error aplicando actualización: ${e.message}`);
    isUpdating = false;
    return false;
  }
}

// ── Iniciar / reiniciar el bot ──
function startBot() {
  if (botProcess) {
    try { botProcess.kill('SIGTERM'); } catch (e) {}
    botProcess = null;
  }

  const mainScript = path.join(PROJECT_DIR, 'src', 'index.js');
  if (!fs.existsSync(mainScript)) {
    log('❌ src/index.js no encontrado');
    return;
  }

  log('🚀 Iniciando bot...');
  botProcess = spawn('node', [mainScript], {
    cwd: PROJECT_DIR,
    stdio: 'inherit',
    env: { ...process.env, AUTO_UPDATE_PARENT: '1' },
  });

  botProcess.on('close', (code) => {
    log(`⚠️ Bot cerró con código ${code}`);
    botProcess = null;
  });

  botProcess.on('error', (err) => {
    log(`❌ Error iniciando bot: ${err.message}`);
    botProcess = null;
  });
}

// ── Loop principal ──
async function main() {
  const repoUrl = getRepoUrl();
  if (!repoUrl) {
    log('⚠️ No hay token en .token — el bot iniciará sin auto-update');
    log('   Para activarlo, crea el archivo .token con tu GitHub access token');
    log('   O desactiva esta verificación con: AUTO_UPDATE=false');
    startBot();
    return;
  }

  log('🤖 Auto-Update iniciado');
  log(`🌿 Rama: ${BRANCH}`);
  log(`⏱️  Intervalo: ${CHECK_INTERVAL / 1000}s`);
  log('');

  if (ensureRemote()) {
    startBot();

    setInterval(async () => {
      const hasUpdates = await checkForUpdates();
      if (hasUpdates) {
        const updated = await applyUpdate();
        if (updated) {
          log('🔄 Reiniciando bot con nueva versión...');
          setTimeout(() => startBot(), 2000);
        }
      }
    }, CHECK_INTERVAL);
  } else {
    startBot();
  }
}

main().catch(e => log(`❌ Error fatal: ${e.message}`));
