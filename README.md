# 🤖 WhatsBusiness Bot v2.0

Bot de WhatsApp para negocios con catálogo de productos, pedidos automatizados, pagos y dashboard web de administración.

---

## 📋 Tabla de Contenidos

- [Características](#-características)
- [Requisitos Previos](#-requisitos-previos)
- [Instalación](#-instalación)
- [Uso Rápido](#-uso-rápido)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Gestión de Productos](#-gestión-de-productos)
- [Configuración](#-configuración)
- [Métodos de Pago](#-métodos-de-pago)
- [Comandos del Bot en WhatsApp](#-comandos-del-bot-en-whatsapp)
- [API REST](#-api-rest)
- [Dashboard Web](#-dashboard-web)
- [Desarrollo y Modificación](#-desarrollo-y-modificación)
- [Solución de Problemas](#-solución-de-problemas)

---

## ✨ Características

- 📦 **Catálogo de productos** con imágenes, categorías y precios
- 🛒 **Carrito de compras** integrado en WhatsApp
- 💳 **Múltiples métodos de pago**: Transferencia bancaria, Stripe, MercadoPago, PayPal
- 🏷️ **Cupones de descuento** (porcentaje o monto fijo)
- 📋 **Gestión de pedidos** con estados (pendiente → confirmado → completado)
- 🚚 **Seguimiento de envíos** con números de guía
- ⭐ **Sistema de reseñas** y calificaciones
- 🌐 **Dashboard web** para administrar todo desde el navegador
- 📱 **Panel CLI** interactivo en terminal
- 🔄 **Reconexión automática** de WhatsApp
- 🔗 **Túnel Cloudflare** para acceso remoto al dashboard

---

## 🔧 Requisitos Previos

- **Node.js** v18 o superior
- **npm** o **yarn**
- Un número de **WhatsApp** para conectar el bot
- (Opcional) Cuentas en Stripe, MercadoPago o PayPal para pagos en línea

---

## 🚀 Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/whatsbusiness-bot.git
cd whatsbusiness-bot
```

### 2. Instalar dependencias

```bash
npm install
```

> **Nota sobre Cloudflared:** El proyecto usa `cloudflared` para crear túneles de acceso remoto. Se instala automáticamente con npm. Si tienes problemas en tu sistema, consulta la [documentación de Cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/).

### 3. Configurar el negocio

Edita el archivo `config.json` con la información de tu negocio:

```json
{
  "business": {
    "name": "Mi Negocio",
    "currency": "MXN",
    "owner_name": "Tu Nombre",
    "owner_email": "tu@email.com",
    "owner_phone": "+52 123 456 7890",
    "owner_number": "521234567890"
  }
}
```

### 4. Iniciar el bot

```bash
npm start
```

Esto abrirá:
- El **panel CLI** en tu terminal
- Un **servidor web** con el dashboard (URL se muestra en consola)
- Un **túnel Cloudflare** para acceso remoto (si está disponible)

---

## ⚡ Uso Rápido

```bash
# Instalar e iniciar
npm install
npm start

# Seguir las instrucciones en pantalla:
# 1. Escanear el código QR con WhatsApp
# 2. Agregar productos desde el menú o el dashboard web
# 3. ¡Listo! Los clientes pueden comprar por WhatsApp
```

---

## 📁 Estructura del Proyecto

```
whatsbusiness-bot/
├── index.js              # Bot básico de ejemplo (ping/pong)
├── server.js             # Servidor Express y API REST
├── config.json           # Configuración del negocio y mensajes
├── package.json          # Dependencias del proyecto
│
├── src/
│   ├── index.js          # Punto de entrada principal
│   ├── bot.js            # Lógica del bot de WhatsApp (Baileys)
│   ├── database.js       # Gestión de base de datos SQLite
│   ├── menu.js           # Menú CLI interactivo (Inquirer)
│   ├── messages.js       # Formateador de mensajes
│   └── payments.js       # Integración de pagos (Stripe, MP, PayPal)
│
├── public/
│   └── index.html        # Dashboard web (SPA con HTML/CSS/JS vanilla)
│
├── data/                 # (creado automáticamente)
│   └── business.db       # Base de datos SQLite
│
└── auth_info_baileys/    # (creado automáticamente)
    └── ...               # Credenciales de sesión de WhatsApp
```

### Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Bot WhatsApp | [Baileys](https://github.com/WhiskeySockets/Baileys) (WebSocket) |
| Base de datos | SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| Servidor web | [Express](https://expressjs.com/) v5 |
| Dashboard | HTML/CSS/JS vanilla (sin framework) |
| CLI | [Inquirer.js](https://github.com/SBoudrias/Inquirer.js) |
| Pagos | Stripe, MercadoPago, PayPal |
| Túnel | [Cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) |

### Descripción de archivos principales

| Archivo | Descripción |
|---------|-------------|
| `src/index.js` | Punto de entrada. Inicia el bot, servidor web y CLI |
| `src/bot.js` | Clase `WhatsAppBot`. Maneja mensajes, carrito, pedidos y respuestas |
| `src/database.js` | Clase `DatabaseManager`. CRUD completo para productos, pedidos, usuarios, etc. |
| `src/menu.js` | Clase `BusinessMenu`. Panel CLI interactivo para gestionar el negocio |
| `src/messages.js` | Clase `MessageFormatter`. Plantillas de mensajes con variables |
| `src/payments.js` | Clase `PaymentManager`. Procesamiento de pagos con múltiples proveedores |
| `server.js` | Servidor Express con API REST y dashboard web |
| `public/index.html` | Dashboard web completo (single-page application) |
| `config.json` | Configuración inicial del negocio, mensajes y métodos de pago |

---

## 📦 Gestión de Productos

### Desde el Dashboard Web

1. Abre el dashboard en tu navegador (la URL aparece al iniciar)
2. Ve a la sección **📦 Productos**
3. Haz clic en **+ Nuevo** para agregar un producto
4. Completa: nombre, descripción, precio, categoría e imagen (URL)
5. Para editar, haz clic en **Editar** junto al producto
6. Para eliminar, haz clic en **Eliminar**

### Desde el Menú CLI

1. Al iniciar `npm start`, selecciona **📦 Gestionar Productos**
2. Elige: Listar, Agregar, Editar o Eliminar
3. Sigue las instrucciones en pantalla

### Desde la API REST

```bash
# Listar todos los productos
curl http://localhost:PUERTO/api/products

# Agregar un producto
curl -X POST http://localhost:PUERTO/api/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Mi Producto","description":"Descripción","price":99.99,"category":"General","image_url":"https://ejemplo.com/imagen.jpg"}'

# Editar un producto
curl -X PUT http://localhost:PUERTO/api/products/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Producto Actualizado","price":149.99}'

# Eliminar un producto
curl -X DELETE http://localhost:PUERTO/api/products/1
```

### Campos de un Producto

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `name` | string | ✅ | Nombre del producto |
| `description` | string | ❌ | Descripción del producto |
| `price` | number | ✅ | Precio (número decimal) |
| `category` | string | ❌ | Categoría (default: "General") |
| `image_url` | string | ❌ | URL de la imagen del producto |
| `available` | number | ❌ | 1 = activo, 0 = inactivo |

---

## ⚙️ Configuración

### Archivo `config.json`

```json
{
  "business": {
    "name": "Mi Negocio",
    "currency": "MXN",
    "owner_name": "Propietario",
    "owner_email": "email@ejemplo.com",
    "owner_phone": "+52 123 456 7890",
    "owner_number": "521234567890"
  },
  "messages": {
    "welcome_message": "¡Hola {name}! 👋 Bienvenido a *{business_name}*...",
    "catalog_message": "🌟 *{business_name} — Catálogo*...",
    "order_confirmation": "✅ *¡Pedido Registrado!*...",
    "help_message": "🤖 *{business_name} — Ayuda*..."
  },
  "payments": {
    "bank_enabled": true,
    "stripe_enabled": false,
    "mercadopago_enabled": false,
    "paypal_enabled": false
  }
}
```

### Variables disponibles en mensajes

| Variable | Descripción |
|----------|-------------|
| `{name}` | Nombre del cliente |
| `{business_name}` | Nombre del negocio |
| `{currency}` | Moneda configurada |
| `{products}` | Lista formateada de productos |
| `{total}` | Total del pedido |
| `{order_details}` | Detalles del pedido |
| `{order_id}` | Número de pedido |
| `{example}` | Nombre de un producto de ejemplo |

### Configuración desde el Dashboard

1. Ve a **⚙️ Ajustes** o **📄 Config** en el dashboard
2. Modifica los campos visualmente o edita el JSON directamente
3. Haz clic en **Guardar**

---

## 💳 Métodos de Pago

### Transferencia Bancaria (activada por defecto)

1. Ve a **💳 Pagos** en el dashboard
2. Agrega cuentas bancarias con: banco, titular, CLABE y número de cuenta
3. Establece una cuenta como predeterminada

### Stripe

1. Obtén tu **Secret Key** desde [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. En el dashboard, ve a **⚙️ Ajustes** → **Stripe** → pega la key
3. O en `config.json`: `"stripe_secret_key": "sk_..."`

### MercadoPago

1. Obtén tu **Access Token** desde [MercadoPago Developers](https://www.mercadopago.com.ar/developers)
2. En el dashboard, ve a **⚙️ Ajustes** → **Mercado Pago** → pega el token
3. O en `config.json`: `"mercadopago_access_token": "..."`

### PayPal

1. Crea una app en [PayPal Developer](https://developer.paypal.com/)
2. Configura **Client ID** y **Client Secret**
3. Elige modo **sandbox** (pruebas) o **live** (producción)

---

## 💬 Comandos del Bot en WhatsApp

Los clientes pueden usar estos comandos al escribirle al bot:

| Comando | Descripción |
|---------|-------------|
| `productos` / `catálogo` | Ver lista de productos disponibles |
| `quiero [producto]` / `agrega [producto]` | Agregar producto al carrito |
| `ver [producto]` / `foto [producto]` | Ver detalle e imagen del producto |
| `carrito` / `mi carrito` | Ver contenido del carrito |
| `quitar [producto]` | Quitar producto del carrito |
| `vaciar` / `limpiar` | Vaciar el carrito |
| `terminar` / `checkout` | Finalizar pedido y elegir pago |
| `pedido` / `mi pedido` | Consultar estado del pedido |
| `cupón [código]` | Aplicar cupón de descuento |
| `calificar [pedido #] [1-5]` | Calificar un pedido completado |
| `rastrear` / `seguimiento` | Ver info de envío |
| `ayuda` / `help` | Ver comandos disponibles |
| `estadisticas` / `stats` | Ver estadísticas del negocio |
| `pagado` | Confirmar que realizó un pago |

---

## 🌐 API REST

El servidor expone una API REST en `/api`:

### Productos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/products` | Listar todos los productos |
| `GET` | `/api/products/active` | Listar productos activos |
| `POST` | `/api/products` | Crear producto |
| `PUT` | `/api/products/:id` | Actualizar producto |
| `DELETE` | `/api/products/:id` | Eliminar producto |

### Pedidos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/orders` | Listar pedidos (filtro: `?status=pending`) |
| `PUT` | `/api/orders/:id/status` | Cambiar estado del pedido |
| `POST` | `/api/orders/:id/shipment` | Registrar envío |

### Usuarios

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/users` | Listar usuarios |

### Cupones

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/coupons` | Listar cupones |
| `POST` | `/api/coupons` | Crear cupón |
| `PUT` | `/api/coupons/:id` | Actualizar cupón |
| `DELETE` | `/api/coupons/:id` | Eliminar cupón |

### Configuración

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/config` | Obtener configuración |
| `PUT` | `/api/config` | Actualizar configuración completa |
| `PUT` | `/api/config/:section` | Actualizar sección específica |
| `GET` | `/api/settings` | Obtener settings de la DB |
| `PUT` | `/api/settings` | Actualizar un setting |

### Conexión WhatsApp

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/connection/status` | Estado de la conexión |
| `POST` | `/api/connection/pairing` | Solicitar código de pairing |
| `POST` | `/api/connection/logout` | Cerrar sesión |
| `GET` | `/api/connection/qr-image` | Imagen del código QR |

### Otros

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/stats` | Estadísticas del sistema y negocio |
| `GET` | `/api/logs` | Logs del bot |
| `GET` | `/api/logs/stream` | Logs en tiempo real (SSE) |
| `GET` | `/api/bank-accounts` | Cuentas bancarias |
| `GET` | `/api/reviews` | Reseñas de clientes |
| `GET` | `/api/shipments` | Envíos registrados |

---

## 🖥️ Dashboard Web

Al iniciar el bot, se abre automáticamente un dashboard web con:

- **📊 Dashboard** — Resumen de estadísticas
- **📦 Productos** — CRUD completo de productos
- **📋 Pedidos** — Gestión de pedidos y envíos
- **👥 Usuarios** — Lista de clientes
- **🏷️ Cupones** — Crear y gestionar descuentos
- **🚚 Envíos** — Seguimiento de paquetes
- **⭐ Reseñas** — Calificaciones de clientes
- **💳 Pagos** — Configurar métodos de pago y cuentas bancarias
- **📡 Conexión** — Conectar WhatsApp (QR o pairing)
- **⚙️ Ajustes** — Configuración del negocio y mensajes
- **📄 Config** — Edición visual y JSON de configuración
- **🖥️ Terminal** — Logs en tiempo real del bot

---

## 🛠️ Desarrollo y Modificación

### Agregar un nuevo comando al bot

1. Edita `src/bot.js` en el método `handleMessage()`
2. Agrega una condición `else if` para detectar el comando
3. Implementa la lógica de respuesta
4. Ejemplo:

```javascript
// En handleMessage(), después de otros else if:
else if (input === 'mi-comando') {
    await this.sendMessage(jid, 'Respuesta de mi comando personalizado');
}
```

### Agregar una nueva tabla a la base de datos

1. Edita `src/database.js` en el método `init()`
2. Agrega la sentencia `CREATE TABLE IF NOT EXISTS`
3. Crea los métodos CRUD correspondientes
4. Ejemplo:

```javascript
// En init(), agregar después de las tablas existentes:
this.db.exec(`
    CREATE TABLE IF NOT EXISTS mi_tabla (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campo TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Agregar métodos:
addMiDato(campo) {
    return this.db.prepare('INSERT INTO mi_tabla (campo) VALUES (?)').run(campo);
}

getMiDatos() {
    return this.db.prepare('SELECT * FROM mi_tabla').all();
}
```

### Agregar un endpoint a la API

1. Edita `server.js` en el método `createRouter()`
2. Agrega la ruta correspondiente
3. Ejemplo:

```javascript
router.get('/mi-endpoint', handle(() => {
    return db.getMiDatos();
}));

router.post('/mi-endpoint', handle((req) => {
    const { campo } = req.body;
    db.addMiDato(campo);
    return { success: true };
}));
```

### Agregar una sección al dashboard web

1. Edita `public/index.html`
2. Agrega el botón en el sidebar (`<nav>`)
3. Implementa la función `showMiPagina(main)`
4. Agrega el case en `showPage()`

### Variables de entorno

El proyecto usa `config.json` para configuración. Puedes crear un `.env` si necesitas variables sensibles:

```bash
# .env (opcional, para integración futura)
STRIPE_SECRET_KEY=sk_...
MERCADOPAGO_ACCESS_TOKEN=...
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
```

---

## 🔍 Solución de Problemas

### El bot no conecta WhatsApp

- Elimina la carpeta `auth_info_baileys/` y vuelve a iniciar
- Asegúrate de que el número de teléfono sea correcto en formato internacional
- Verifica que no haya otra sesión activa de WhatsApp Web

### Error "Otra sesión está activa"

- Cierra WhatsApp Web en todos los dispositivos
- Elimina `auth_info_baileys/` y reconecta

### El dashboard no carga

- Verifica que el puerto no esté en uso
- Revisa la consola para ver la URL del servidor
- Accede directamente a `http://localhost:PUERTO`

### Los pagos no funcionan

- Verifica que las API keys estén correctas
- En modo sandbox, usa tarjetas de prueba del proveedor
- Revisa los logs en la sección Terminal del dashboard

### La base de datos está corrupta

- Elimina el archivo `data/business.db`
- Reinicia el bot (se recreará automáticamente con datos de ejemplo)

---

## 📄 Licencia

ISC

---

## 🤝 Contribuir

Las contribuciones son bienvenidas. Abre un issue o pull request en el repositorio.

---

> **WhatsBusiness Bot** — Automatiza tu negocio por WhatsApp 🚀
