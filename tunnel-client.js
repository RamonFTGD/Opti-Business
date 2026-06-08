#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════
// TUNNEL CLIENT - OptiShield
// Expón tu servidor local al mundo exterior
// ═════════════════════════════════════════════════════════════════════════
//
// Uso:
//   node tunnel-client.js --port 8080 --apikey TU_API_KEY
//   node tunnel-client.js -p 3000 -k TU_API_KEY
//
// Esto generará una URL como:
//   https://optishield.uk/web/abc123def456ghi789jklmno
//
// Cualquier persona que visite esa URL verá tu servidor local.
// El túnel se cierra automáticamente al cerrar este programa.
// ═════════════════════════════════════════════════════════════════════════

// ── Detectar WebSocket disponible ─────────────────────────────────────
let WS
try {
  // Node.js 21+ tiene WebSocket nativo global
  if (typeof globalThis.WebSocket === 'function') {
    WS = globalThis.WebSocket
  } else {
    WS = require('ws')
  }
} catch {
  console.error(`
╔══════════════════════════════════════════════════════════╗
║              ❌ WebSocket no disponible                  ║
╠══════════════════════════════════════════════════════════╣
║  Este cliente requiere el módulo 'ws' para funcionar.    ║
║                                                          ║
║  Instálalo con:                                          ║
║    npm install ws                                        ║
║                                                          ║
║  O usa Node.js 21+ que ya incluye WebSocket nativo.      ║
╚══════════════════════════════════════════════════════════╝
`)
  process.exit(1)
}

const https = require('https')
const http = require('http')

const SERVER = 'optishield.uk'

// ── Parsear argumentos ─────────────────────────────────────────────────

const args = process.argv.slice(2)
const options = {}

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' || args[i] === '-p') options.port = args[++i]
  else if (args[i] === '--apikey' || args[i] === '-k') options.apikey = args[++i]
  else if (args[i] === '--server') options.server = args[++i]
  else if (args[i] === '--help' || args[i] === '-h') options.help = true
}

// Validar argumentos
if (options.port) {
  const parsed = parseInt(options.port)
  if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
    console.error(`❌ Puerto inválido: "${options.port}". Debe ser un número entre 1 y 65535.`)
    process.exit(1)
  }
  options.port = parsed
}

if (options.help || !options.port || !options.apikey) {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║              🌐 TUNNEL CLIENT - OptiShield              ║
║              Expón tu servidor local al mundo            ║
╚══════════════════════════════════════════════════════════╝

Uso: node tunnel-client.js --port <puerto> --apikey <api_key>

Opciones:
  --port, -p     Puerto local donde corre tu servidor (ej: 8080)
  --apikey, -k   Tu API Key de OptiShield
  --server       Servidor personalizado (default: optishield.uk)
  --help, -h     Muestra esta ayuda

Ejemplos:
  node tunnel-client.js -p 8080 -k optishield_api
  node tunnel-client.js --port 3000 --apikey mi_api_key

IMPORTANTE: El túnel se cierra automáticamente al cerrar este programa.
`)
  process.exit(0)
}

// ── Configuración ──────────────────────────────────────────────────────

const LOCAL_PORT = options.port
const APIKEY = options.apikey
const API_SERVER = options.server || SERVER

let tunnelId = null
let wsToken = null
let tunnelUrl = null
let ws = null
let running = true
let reconnectTimer = null

// ── UI ─────────────────────────────────────────────────────────────────

function clearLines(n) {
  process.stdout.write(`\x1B[${n}A\x1B[J`)
}

let lastStatus = ''
const uiLines = 10

function drawUI(status = lastStatus) {
  lastStatus = status
  const time = new Date().toLocaleTimeString('es-MX')

  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════╗',
    `║              🌐 TUNNEL ACTIVO - OptiShield              ║`,
    '╠══════════════════════════════════════════════════════════╣',
    `║  🔗 ${(tunnelUrl || 'Conectando...').padEnd(48)}║`,
    `║  📡 http://localhost:${String(LOCAL_PORT).padEnd(4)} -> 🌐 externo            ║`,
    `║  ${status.padEnd(55)}║`,
    '╚══════════════════════════════════════════════════════════╝',
    `  ${time} | Ctrl+C para cerrar`,
    ''
  ]

  if (!process.stdout.isTTY) {
    console.log(lines.join('\n'))
    return
  }

  clearLines(uiLines)
  process.stdout.write(lines.join('\n'))
}

// ── API: Crear túnel ──────────────────────────────────────────────────

function createTunnel() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ apikey: APIKEY })

    const req = https.request({
      hostname: API_SERVER,
      path: '/api/tunnel/create',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'apikey': APIKEY
      }
    }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          if (result.error) reject(new Error(result.error))
          else resolve(result)
        } catch (e) {
          reject(new Error('Respuesta inválida del servidor: ' + body.slice(0, 100)))
        }
      })
    })

    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

// ── WebSocket: Conectar al túnel ──────────────────────────────────────

function connectWebSocket() {
  if (!tunnelId || !wsToken) return

  const wsUrl = `wss://${API_SERVER}/api/tunnel/ws?tunnelId=${tunnelId}&token=${wsToken}`

  ws = new WS(wsUrl)

  ws.on('open', () => {
    drawUI('🟢 Conectado y listo para recibir peticiones')
    console.log(`\n✅ TÚNEL ACTIVO: ${tunnelUrl}`)
    console.log('   Comparte esta URL con quien quieras.')
    console.log('   Presiona Ctrl+C para cerrar el túnel.\n')
  })

  ws.on('message', async (data) => {
    try {
      const raw = typeof data === 'string' ? data : data.toString()
      const msg = JSON.parse(raw)

      if (msg.type === 'request') {
        handleIncomingRequest(msg)
      }
    } catch (e) {
      console.error('❌ Error procesando mensaje:', e.message)
    }
  })

  ws.on('close', (code) => {
    drawUI(`🔴 Desconectado (código: ${code})`)
    if (running) {
      console.log('\n⚠️  Conexión perdida. Reconectando en 3 segundos...')
      reconnectTimer = setTimeout(connectWebSocket, 3000)
    }
  })

  ws.on('error', (err) => {
    drawUI('🔴 Error de conexión WebSocket')
    if (running) {
      console.log('\n⚠️  Error de WebSocket. Reconectando en 5 segundos...')
      reconnectTimer = setTimeout(connectWebSocket, 5000)
    }
  })
}

// ── Manejar request entrante ──────────────────────────────────────────

async function handleIncomingRequest(msg) {
  const { id, method, path, headers, body } = msg

  drawUI(`🔄 ${method} ${path}`)

  const options = {
    hostname: '127.0.0.1',
    port: LOCAL_PORT,
    path: path,
    method: method,
    headers: {},
    rejectUnauthorized: false,
    timeout: 25000
  }

  if (headers) {
    const skipHeaders = ['host', 'connection', 'upgrade', 'transfer-encoding',
      'content-encoding', 'content-length']
    for (const [key, value] of Object.entries(headers)) {
      if (!skipHeaders.includes(key.toLowerCase()) && typeof value === 'string') {
        options.headers[key] = value
      }
    }
  }

  try {
    const response = await makeLocalRequest(options, body)

    if (ws && ws.readyState === WS.OPEN) {
      ws.send(JSON.stringify({
        type: 'response',
        id: id,
        status: response.status,
        headers: response.headers,
        body: response.body
      }))
      drawUI(`✅ ${method} ${path} -> ${response.status}`)
    }
  } catch (e) {
    if (ws && ws.readyState === WS.OPEN) {
      ws.send(JSON.stringify({
        type: 'response',
        id: id,
        status: 502,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from('Error: ' + e.message).toString('base64')
      }))
      drawUI(`❌ ${method} ${path} -> Error: ${e.message}`)
    }
  }
}

// ── Hacer petición HTTP local ─────────────────────────────────────────

function makeLocalRequest(options, bodyBase64) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = []

      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const fullBody = Buffer.concat(chunks)
        const responseHeaders = {}

        const skipHeaders = ['connection', 'transfer-encoding', 'content-encoding']
        for (const [key, value] of Object.entries(res.headers)) {
          if (!skipHeaders.includes(key.toLowerCase())) {
            responseHeaders[key] = value
          }
        }

        resolve({
          status: res.statusCode,
          headers: responseHeaders,
          body: fullBody.toString('base64')
        })
      })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })

    if (bodyBase64) {
      const bodyBuffer = Buffer.from(bodyBase64, 'base64')
      req.write(bodyBuffer)
    }

    req.end()
  })
}

// ── Limpieza al salir ─────────────────────────────────────────────────

async function cleanup() {
  running = false

  if (reconnectTimer) clearTimeout(reconnectTimer)

  console.log('\n\n⏳ Cerrando túnel...')

  if (ws) {
    try { ws.close() } catch {}
  }

  if (tunnelId) {
    try {
      await new Promise((resolve) => {
        const req = https.request({
          hostname: API_SERVER,
          path: `/api/tunnel/${tunnelId}`,
          method: 'DELETE'
        }, (res) => {
          let body = ''
          res.on('data', chunk => body += chunk)
          res.on('end', () => resolve())
        })
        req.on('error', () => resolve())
        req.end()
      })
      console.log('✅ Túnel cerrado correctamente')
    } catch {}
  }

  process.exit(0)
}

// ── Inicio ────────────────────────────────────────────────────────────

async function main() {
  console.log('')
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║              🌐 TUNNEL CLIENT - OptiShield              ║')
  console.log('╠══════════════════════════════════════════════════════════╣')
  console.log(`║  Creando túnel para http://localhost:${LOCAL_PORT}...${' '.repeat(Math.max(0, 14 - String(LOCAL_PORT).length))}║`)
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('')

  try {
    const result = await createTunnel()
    tunnelId = result.tunnelId
    wsToken = result.wsToken
    tunnelUrl = result.url

    connectWebSocket()

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)

  } catch (e) {
    const msg = e.message
    if (msg.toLowerCase().includes('api key') || msg.toLowerCase().includes('invalida') || msg.toLowerCase().includes('invalid')) {
      console.log(`\n⚠️  El túnel OptiShield requiere una clave con permisos de túnel.`)
      console.log(`   El bot seguirá funcionando en localhost.\n`)
    } else {
      console.log(`\n⚠️  Túnel no disponible: ${msg}`)
      console.log(`   El bot seguirá funcionando en localhost.\n`)
    }
    process.exit(0)
  }
}

main()
