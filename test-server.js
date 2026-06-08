#!/usr/bin/env node
// ═════════════════════════════════════════════════════════════════════════
// TEST SERVER - Servidor de prueba para el sistema de túneles
// ═════════════════════════════════════════════════════════════════════════
//
// Uso:
//   node test-server.js
//
// Luego en otra terminal:
//   node tunnel-client.js --port 8080 --apikey TU_API_KEY
//
// Recibirás una URL como https://optishield.uk/web/abc123... que
// apuntará a este servidor.
// ═════════════════════════════════════════════════════════════════════════

const http = require('http')
const url = require('url')

const PORT = 8080

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🚀 Tunnel Test - OptiShield</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:'Inter',system-ui,sans-serif;
      background:#0a0a0f;color:#e4e4e7;
      min-height:100vh;display:flex;flex-direction:column;
      justify-content:center;align-items:center;
      padding:20px;overflow-x:hidden;
    }
    body::before{
      content:'';position:fixed;top:-50%;left:-50%;
      width:200%;height:200%;
      background:
        radial-gradient(circle at 30% 20%,rgba(0,243,255,0.04) 0%,transparent 50%),
        radial-gradient(circle at 70% 80%,rgba(255,0,85,0.02) 0%,transparent 50%);
      pointer-events:none;
    }
    .container{width:100%;max-width:640px;position:relative;z-index:1}
    .card{
      background:#111118;border:1px solid #1c1c28;
      border-radius:16px;padding:40px 32px;
      box-shadow:0 25px 60px -12px rgba(0,0,0,0.6);
      margin-bottom:20px;
    }
    .badge{
      display:inline-flex;align-items:center;
      background:rgba(0,243,255,0.08);border:1px solid rgba(0,243,255,0.15);
      color:#00f3ff;padding:6px 14px;border-radius:999px;
      font-size:12px;font-weight:600;letter-spacing:.04em;
      margin-bottom:16px;
    }
    .badge.live{background:rgba(0,255,157,0.08);border-color:rgba(0,255,157,0.15);color:#00ff9d}
    .badge.live .dot{
      display:inline-block;width:6px;height:6px;
      background:#00ff9d;border-radius:50%;
      margin-right:6px;animation:pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    h1{
      font-size:1.8rem;font-weight:800;letter-spacing:-.03em;
      background:linear-gradient(135deg,#00f3ff,#00ff9d);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;
      background-clip:text;margin-bottom:8px;
    }
    h2{font-size:1.2rem;font-weight:700;color:#e4e4e7;margin-bottom:12px}
    p{color:#a1a1aa;line-height:1.6;font-size:14px;margin-bottom:16px}
    .info-grid{
      display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0;
    }
    .info-item{
      background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);
      border-radius:10px;padding:14px;text-align:center;
    }
    .info-item .num{
      font-size:1.4rem;font-weight:700;color:#00f3ff;
      font-variant-numeric:tabular-nums;
    }
    .info-item .label{font-size:11px;color:#6b6b80;margin-top:4px;text-transform:uppercase;letter-spacing:.05em}
    .status-row{
      display:flex;align-items:center;gap:10px;
      padding:12px 16px;border-radius:10px;
      background:rgba(0,255,157,0.04);border:1px solid rgba(0,255,157,0.1);
      margin:16px 0;
    }
    .status-row .icon{font-size:20px}
    .status-row p{color:#86efac;font-size:13px;font-weight:500;margin:0}
    .endpoints{margin-top:20px}
    .endpoint{
      display:flex;align-items:center;gap:12px;
      padding:10px 14px;border-radius:8px;
      background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);
      margin-bottom:8px;font-size:13px;
    }
    .method{
      font-weight:700;font-size:11px;padding:3px 8px;
      border-radius:4px;letter-spacing:.05em;flex-shrink:0;
    }
    .method.get{background:rgba(0,243,255,0.1);color:#00f3ff}
    .method.post{background:rgba(0,255,157,0.1);color:#00ff9d}
    .method.json{background:rgba(255,183,0,0.1);color:#ffb700}
    .path{font-family:monospace;color:#e4e4e7;flex:1}
    .desc{color:#6b6b80;font-size:12px}
    .footer{text-align:center;color:#6b6b80;font-size:12px;padding:10px 0}
    .footer a{color:#00f3ff;text-decoration:none}
    .footer a:hover{text-decoration:underline}
    .emoji-big{font-size:48px;text-align:center;margin-bottom:16px}
    .json-box{
      background:#040408;border:1px solid #1c1c28;
      border-radius:10px;padding:16px;
      font-family:monospace;font-size:13px;color:#a1a1aa;
      white-space:pre;overflow-x:auto;margin:16px 0;
    }
    .json-box .key{color:#00f3ff}
    .json-box .str{color:#00ff9d}
    .json-box .num{color:#ffb700}
    @media(max-width:500px){
      .card{padding:24px 18px}
      .info-grid{grid-template-columns:1fr}
      h1{font-size:1.4rem}
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="emoji-big">🌐</div>
      <div style="text-align:center;margin-bottom:8px">
        <span class="badge live"><span class="dot"></span> TÚNEL ACTIVO</span>
      </div>
      <h1 style="text-align:center">Servidor de Prueba</h1>
      <p style="text-align:center">
        Este servidor está siendo expuesto al mundo exterior a través del sistema de túneles de OptiShield.
        Cualquier persona con la URL del túnel puede ver esta página.
      </p>

      <div class="status-row">
        <span class="icon">✅</span>
        <p>El túnel funciona correctamente — esta página se está sirviendo desde el servidor local.</p>
      </div>

      <h2>📊 Estadísticas</h2>
      <div class="info-grid" id="statsGrid">
        <div class="info-item"><div class="num" id="uptime">0s</div><div class="label">Tiempo activo</div></div>
        <div class="info-item"><div class="num" id="requests">0</div><div class="label">Peticiones</div></div>
        <div class="info-item"><div class="num" id="memory">0 MB</div><div class="label">Memoria usada</div></div>
        <div class="info-item"><div class="num" id="nodeVer">—</div><div class="label">Node.js</div></div>
      </div>

      <h2>🔌 Endpoints de prueba</h2>
      <div class="endpoints">
        <div class="endpoint">
          <span class="method get">GET</span>
          <span class="path">/</span>
          <span class="desc">Esta página</span>
        </div>
        <div class="endpoint">
          <span class="method get">GET</span>
          <span class="path">/api/info</span>
          <span class="desc">Información del servidor (JSON)</span>
        </div>
        <div class="endpoint">
          <span class="method get">GET</span>
          <span class="path">/api/echo?msg=hola</span>
          <span class="desc">Eco de mensaje (JSON)</span>
        </div>
        <div class="endpoint">
          <span class="method get">GET</span>
          <span class="path">/api/status</span>
          <span class="desc">Estado del servidor (JSON)</span>
        </div>
        <div class="endpoint">
          <span class="method json">JSON</span>
          <span class="path">/api/time</span>
          <span class="desc">Hora actual del servidor</span>
        </div>
      </div>

      <h2>📦 Ejemplo de respuesta</h2>
      <div class="json-box" id="apiExample">
<span class="key">"GET /api/info"</span>
{
  <span class="key">"server"</span>: <span class="str">"Tunnel Test Server"</span>,
  <span class="key">"status"</span>: <span class="str">"running"</span>,
  <span class="key">"uptime"</span>: <span class="num">0</span>,
  <span class="key">"requests"</span>: <span class="num">0</span>,
  <span class="key">"node"</span>: <span class="str">"v20.x"</span>
}
      </div>

      <div class="footer">
        🛡️ <a href="https://optishield.uk">OptiShield</a> · Sistema de Túneles · Puerto ${PORT}
      </div>
    </div>
  </div>

  <script>
    const start = Date.now()
    let reqCount = 0

    setInterval(async () => {
      const elapsed = Math.floor((Date.now() - start) / 1000)
      const h = Math.floor(elapsed / 3600)
      const m = Math.floor((elapsed % 3600) / 60)
      const s = elapsed % 60
      const uptimeStr = h > 0 ? h+'h '+m+'m '+s+'s' : m > 0 ? m+'m '+s+'s' : s+'s'
      document.getElementById('uptime').textContent = uptimeStr
      document.getElementById('memory').textContent = (process.memoryUsage().heapUsed / 1048576).toFixed(1) + ' MB'
      document.getElementById('nodeVer').textContent = process.version

      try {
        const res = await fetch('/api/stats')
        const d = await res.json()
        reqCount = d.requests || 0
        document.getElementById('requests').textContent = reqCount
      } catch {}
    }, 1000)
  </script>
</body>
</html>`

// ── Servidor ───────────────────────────────────────────────────────────

let requestCount = 0
const startTime = Date.now()

const server = http.createServer((req, res) => {
  requestCount++
  const parsed = url.parse(req.url, true)
  const path = parsed.pathname
  const query = parsed.query

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(HTML)
    return
  }

  if (path === '/api/info') {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      server: 'Tunnel Test Server',
      status: 'running',
      uptime: elapsed,
      requests: requestCount,
      node: process.version,
      platform: process.platform,
      memory: (process.memoryUsage().heapUsed / 1048576).toFixed(1) + ' MB',
      timestamp: new Date().toISOString()
    }, null, 2))
    return
  }

  if (path === '/api/stats') {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      requests: requestCount,
      uptime: elapsed,
      connections: requestCount
    }))
    return
  }

  if (path === '/api/echo') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      method: req.method,
      path: path,
      message: query.msg || '(sin mensaje)',
      timestamp: new Date().toISOString(),
      request_id: requestCount
    }, null, 2))
    return
  }

  if (path === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      healthy: true,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      total_requests: requestCount,
      memory_usage: (process.memoryUsage().heapUsed / 1048576).toFixed(1) + ' MB'
    }, null, 2))
    return
  }

  if (path === '/api/time') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      iso: new Date().toISOString(),
      local: new Date().toLocaleString('es-MX'),
      timestamp: Date.now(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }, null, 2))
    return
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    error: 'Not Found',
    path: path,
    hint: 'Los endpoints disponibles son: /, /api/info, /api/echo, /api/status, /api/time'
  }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('')
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║        🚀 TEST SERVER - OptiShield Tunnels              ║')
  console.log('╠══════════════════════════════════════════════════════════╣')
  console.log(`║  Servidor local corriendo en:                            ║`)
  console.log(`║  📍 http://localhost:${PORT}                              ║`)
  console.log('║                                                          ║')
  console.log('║  Para exponerlo al mundo, abre OTRA TERMINAL y ejecuta:  ║')
  console.log('║                                                          ║')
  console.log(`║  node tunnel-client.js -p ${PORT} -k TU_API_KEY           ║`)
  console.log('║                                                          ║')
  console.log('║  Endpoints de prueba:                                    ║')
  console.log('║  • GET /           → Página HTML                         ║')
  console.log('║  • GET /api/info   → Info del servidor                   ║')
  console.log('║  • GET /api/echo   → Eco (usa ?msg=hola)                 ║')
  console.log('║  • GET /api/status → Estado                              ║')
  console.log('║  • GET /api/time   → Hora actual                         ║')
  console.log('║                                                          ║')
  console.log('║  Presiona Ctrl+C para detener el servidor.               ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('')
})
