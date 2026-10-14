
const enc = new TextEncoder();
const COOKIE = "brusaam_session";
const LOGO = "https://res.cloudinary.com/oobzcqc2/image/upload/IMG_20260517_093131_502.webp";

function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

function getCookie(req) {
  const raw = req.headers.get("Cookie") || "";
  const item = raw.split(";").map(x => x.trim())
    .find(x => x.startsWith(COOKIE + "="));
  return item ? item.slice(COOKIE.length + 1) : "";
}

function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-")
    .replace(/\//g, "_").replace(/=+$/g, "");
}

async function sign(text, secret) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const result = await crypto.subtle.sign(
    "HMAC", key, enc.encode(text)
  );
  return base64url(new Uint8Array(result));
}

async function authenticated(req, env) {
  if (!env.SESSION_SECRET) return false;
  const parts = getCookie(req).split(".");
  if (parts.length !== 2) return false;
  const [expiry, signature] = parts;
  if (!/^\d{10,15}$/.test(expiry)) return false;
  if (Number(expiry) < Date.now()) return false;
  const expected = await sign(expiry, env.SESSION_SECRET);
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function sameOrigin(req) {
  return req.headers.get("Origin") === new URL(req.url).origin;
}

async function ensureSubcategory(env) {
  const result = await env.DB.prepare(
    "PRAGMA table_info(products)"
  ).all();

  if (!result.results.some(c => c.name === "subcategory")) {
    try {
      await env.DB.prepare(
        "ALTER TABLE products ADD COLUMN subcategory TEXT NOT NULL DEFAULT ''"
      ).run();
    } catch (e) {
      if (!String(e.message).includes("duplicate column")) throw e;
    }
  }
}

function page(body) {
  return new Response(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brusaam | La excelencia en tu hogar</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#F4F7FC;color:#14234B;font:15px Arial,sans-serif}
header{background:#fff;text-align:center;padding:20px 14px;box-shadow:0 2px 8px #14234B12}
.logo{width:130px;max-width:55%;height:auto}
nav{margin-top:14px}
a{color:#6524AD;text-decoration:none}
main{max-width:1120px;margin:auto;padding:18px}
h2,h3{color:#14234B}
h2{font-size:23px}
button,.btn{background:#6524AD;color:#fff;border:0;border-radius:9px;padding:11px 14px;cursor:pointer;font-weight:bold}
button:disabled{opacity:.45;cursor:not-allowed}
input,select,textarea{width:100%;padding:11px;border:1px solid #cbd3e0;border-radius:9px;background:white;font:inherit;margin:6px 0 12px}
label{font-weight:600;display:block}
section,.card{background:#fff;padding:17px;border-radius:14px;margin:14px 0;box-shadow:0 2px 8px #14234B0d}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:14px}
.grid .card{margin:0;display:flex;flex-direction:column}
.grid .card img{height:210px;width:100%;object-fit:contain}
.grid .card h3{font-size:16px;min-height:36px}
.price{font-size:22px;font-weight:800;color:#078ED5;margin:7px 0}
.muted{color:#627084;font-size:13px}
.flex{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.grow{flex:1}
.hidden{display:none!important}
.danger{background:#a43e4b}
.qty{width:70px;margin:0}
.search{position:relative}
.search input{padding-left:43px;font-size:16px}
.search svg{position:absolute;left:14px;top:17px;color:#6524AD}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.banner{background:linear-gradient(110deg,#F3EBFC,#EAF3FF);border:1px solid #DDD0F3;border-radius:14px;max-width:650px;margin:16px auto 4px;padding:17px}
.banner .big{font-size:23px;font-weight:800;color:#6524AD;margin:7px 0}
.banner .place{font-weight:700;color:#14234B}
.cart-item{display:flex;gap:12px;align-items:center;border-bottom:1px solid #e8ebf1;padding:13px 0}
.cart-item img{width:82px;height:82px;object-fit:contain;border-radius:8px;background:#f7f8fc}
.cart-info{flex:1;min-width:0}
.cart-info strong{display:block;margin-bottom:5px}
.cart-info .price{font-size:17px}
.cart-controls{display:flex;gap:7px;align-items:center;margin-top:8px}
.cart-controls button{padding:6px 10px}
.cart-controls .danger{margin-left:5px}
.summary-line{display:flex;justify-content:space-between;gap:12px;margin:12px 0}
.summary-total{font-size:20px;font-weight:800;border-top:1px solid #dce2ee;padding-top:14px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:11px;text-align:left;border-bottom:1px solid #e7e9f1}
th{background:#F3EFFA;color:#442077}
.notice{background:#F4F0FA;border-radius:9px;padding:12px;font-size:13px}
@media(max-width:540px){
  main{padding:11px}
  .filters{grid-template-columns:1fr}
  .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
  .grid .card{padding:11px}
  .grid .card img{height:145px}
  .grid .card h3{font-size:14px}
  .price{font-size:18px}
  .cart-item img{width:65px;height:65px}
  .banner .big{font-size:20px}
}
</style>
</head>
<body>
<header>
<img class="logo" src="${LOGO}" alt="Logo Brusaam">
<div class="muted">La excelencia en tu hogar</div>
<div class="banner">
  <div style="color:#6524AD;font-weight:700">🚚 BENEFICIO ESPECIAL</div>
  <div class="big">¡Despacho GRATIS!</div>
  <div class="place">Coquimbo y La Serena</div>
  <div style="margin-top:7px;color:#6524AD">En compras sobre $30.000</div>
</div>
<nav><a href="/">Tienda</a> · <a href="/admin">Administración</a></nav>
</header>
<main>${body}</main>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }
  });
}

const shop = String.raw`
<h2>Catálogo de productos</h2>

<div class="search">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="11" cy="11" r="7"></circle>
    <path d="m16 16 5 5"></path>
  </svg>
  <input id="buscar" placeholder="Buscar productos, marcas o categorías...">
</div>

<div class="filters">
  <label>Categoría
    <select id="fCategoria">
      <option value="">Todas las categorías</option>
    </select>
  </label>
  <label>Subcategoría
    <select id="fSubcategoria">
      <option value="">Todas las subcategorías</option>
    </select>
  </label>
</div>

<p id="resultados" class="muted"></p>
<div id="catalogo" class="grid"></div>

<section id="carrito">
  <h2>🛒 Resumen de mi compra</h2>
  <div id="items"></div>

  <div class="summary-line">
    <span>Subtotal de productos</span>
    <strong id="subtotal">$0</strong>
  </div>
  <div class="summary-line">
    <span>Despacho</span>
    <strong id="despacho">Despacho por calcular</strong>
  </div>
  <div class="summary-line summary-total">
    <span id="totalLabel">Total</span>
    <span id="total">$0</span>
  </div>
</section>

<section>
  <h3>Condiciones y tarifas de despacho</h3>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>Zona</th><th>Tarifa</th></tr>
      </thead>
      <tbody>
        <tr><td>La Serena</td><td>$3.000</td></tr>
        <tr><td>Coquimbo</td><td>$2.000</td></tr>
        <tr>
          <td>La Serena y Coquimbo – Compras Sobre $30.000</td>
          <td><strong>Gratis</strong></td>
        </tr>
        <tr>
          <td>Otras Regiones / Comuna</td>
          <td>Envío por pagar</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p class="muted">El beneficio de despacho gratis se calcula sobre el subtotal de productos desde $30.000, inclusive, en las comunas de La Serena y Coquimbo.</p>
</section>

<section>
  <h2>Datos del solicitante</h2>

  <label>Nombre del solicitante *
    <input id="cliente" maxlength="120" placeholder="Nombre y apellido">
  </label>

  <label>Entrega o retiro *
    <select id="modalidad">
      <option value="entrega">Entrega a domicilio</option>
      <option value="retiro">Retiro</option>
    </select>
  </label>

  <div id="datosEntrega">
    <label>Dirección *
      <input id="direccion" maxlength="220" placeholder="Calle, número y referencia">
    </label>

    <label>Región *
      <select id="region">
        <option value="">Selecciona tu región</option>
        <option>Arica y Parinacota</option>
        <option>Tarapacá</option>
        <option>Antofagasta</option>
        <option>Atacama</option>
        <option>Coquimbo</option>
        <option>Valparaíso</option>
        <option>Metropolitana de Santiago</option>
        <option>Libertador General Bernardo O'Higgins</option>
        <option>Maule</option>
        <option>Ñuble</option>
        <option>Biobío</option>
        <option>La Araucanía</option>
        <option>Los Ríos</option>
        <option>Los Lagos</option>
        <option>Aysén del General Carlos Ibáñez del Campo</option>
        <option>Magallanes y de la Antártica Chilena</option>
      </select>
    </label>

    <label>Comuna *
      <input id="comuna" maxlength="100" placeholder="Escribe tu comuna">
    </label>
  </div>

  <p id="avisoEnvio" class="notice">
    Despacho por calcular. Completa tus datos para conocer la condición de envío.
  </p>

  <button id="enviar" style="width:100%">
    Enviar pedido por WhatsApp
  </button>

  <p class="muted">
    Pedido sujeto a confirmación de disponibilidad, pago y entrega.
    Para otras regiones, el transporte se paga según las condiciones de la empresa transportista.
  </p>
</section>

<script>
const $ = id => document.getElementById(id);
const pesos = n => '$' + Number(n).toLocaleString('es-CL');
let productos = [];
let carrito = {};

function nodo(tag, text) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}

function normalizar(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function precio(p, cantidad) {
  return cantidad >= 2 ? p.wholesale : p.retail;
}

function subtotal() {
  return Object.entries(carrito).reduce((sum, [id, cantidad]) => {
    const p = productos.find(x => String(x.id) === id);
    return sum + (p ? precio(p, cantidad) * cantidad : 0);
  }, 0);
}

function envio() {
  if ($('modalidad').value === 'retiro') {
    return { tipo:'retiro', costo:0, texto:'Retiro sin costo' };
  }

  const region = normalizar($('region').value);
  const comuna = normalizar($('comuna').value);

  if (!region || !comuna) {
    return { tipo:'pendiente', costo:null, texto:'Despacho por calcular' };
  }

  const serena = region === 'coquimbo' && comuna === 'la serena';
  const coquimbo = region === 'coquimbo' && comuna === 'coquimbo';

  if (serena || coquimbo) {
    if (subtotal() >= 30000) {
      return { tipo:'gratis', costo:0, texto:'Despacho gratis' };
    }
    const costo = serena ? 3000 : 2000;
    return { tipo:'local', costo, texto:pesos(costo) };
  }

  return {
    tipo:'por_pagar',
    costo:null,
    texto:'Envío por pagar'
  };
}

function actualizarFiltros() {
  const categorias = [...new Set(
    productos.map(p => p.category || 'General')
  )].sort((a,b) => a.localeCompare(b, 'es'));

  const actual = $('fCategoria').value;
  $('fCategoria').replaceChildren(new Option('Todas las categorías',''));

  categorias.forEach(c => $('fCategoria').add(new Option(c,c)));
  if (categorias.includes(actual)) $('fCategoria').value = actual;

  const subActual = $('fSubcategoria').value;
  const subs = [...new Set(
    productos
      .filter(p => !$('fCategoria').value ||
        (p.category || 'General') === $('fCategoria').value)
      .map(p => p.subcategory || '')
      .filter(Boolean)
  )].sort((a,b) => a.localeCompare(b,'es'));

  $('fSubcategoria').replaceChildren(
    new Option('Todas las subcategorías','')
  );

  subs.forEach(s => $('fSubcategoria').add(new Option(s,s)));
  if (subs.includes(subActual)) $('fSubcategoria').value = subActual;
}

function renderCatalogo() {
  const buscar = normalizar($('buscar').value);
  const categoria = $('fCategoria').value;
  const subcategoria = $('fSubcategoria').value;

  const filtrados = productos.filter(p => {
    const texto = normalizar(
      [p.name,p.category,p.subcategory,p.description].join(' ')
    );
    return texto.includes(buscar) &&
      (!categoria || (p.category || 'General') === categoria) &&
      (!subcategoria || p.subcategory === subcategoria);
  });

  $('resultados').textContent =
    filtrados.length + ' producto(s) encontrado(s)';

  const root = $('catalogo');
  root.replaceChildren();

  for (const p of filtrados) {
    const card = nodo('div');
    card.className = 'card';

    if (p.image && p.image.startsWith('https://')) {
      const img = nodo('img');
      img.src = p.image;
      img.alt = p.name;
      img.loading = 'lazy';
      card.append(img);
    }

    card.append(nodo('h3',p.name));

    if (p.subcategory) {
      const sub = nodo('p',p.subcategory);
      sub.className = 'muted';
      card.append(sub);
    }

    const detalle = nodo('p','Detalle: '+pesos(p.retail));
    detalle.className = 'price';
    card.append(detalle);

    const mayor = nodo('p','Mayor desde 2: '+pesos(p.wholesale));
    mayor.className = 'muted';
    card.append(mayor);

    const stock = nodo('p','Stock: '+p.stock);
    stock.className = 'muted';
    card.append(stock);

    const row = nodo('div');
    row.className = 'flex';

    const cantidad = nodo('input');
    cantidad.type = 'number';
    cantidad.min = '1';
    cantidad.max = String(p.stock);
    cantidad.value = '1';
    cantidad.className = 'qty';

    const boton = nodo('button','Agregar');
    boton.disabled = p.stock < 1;

    boton.onclick = () => {
      const n = Number(cantidad.value);
      const actual = carrito[p.id] || 0;

      if (!Number.isInteger(n) || n < 1 || n + actual > p.stock) {
        alert('Cantidad inválida o stock insuficiente');
        return;
      }

      carrito[p.id] = actual + n;
      renderCarrito();
    };

    row.append(cantidad,boton);
    card.append(row);
    root.append(card);
  }
}

function renderCarrito() {
  const root = $('items');
  root.replaceChildren();

  const entradas = Object.entries(carrito);

  if (!entradas.length) {
    const vacio = nodo('p','Tu carrito está vacío.');
    vacio.className = 'muted';
    root.append(vacio);
  }

  for (const [id, cantidad] of entradas) {
    const p = productos.find(x => String(x.id) === id);
    if (!p) continue;

    const row = nodo('div');
    row.className = 'cart-item';

    if (p.image && p.image.startsWith('https://')) {
      const img = nodo('img');
      img.src = p.image;
      img.alt = p.name;
      row.append(img);
    } else {
      const placeholder = nodo('div','📦');
      placeholder.style.cssText =
        'width:82px;height:82px;display:grid;place-items:center;background:#F4F7FC;border-radius:8px';
      row.append(placeholder);
    }

    const info = nodo('div');
    info.className = 'cart-info';
    info.append(nodo('strong',p.name));

    const unitario = nodo(
      'div',
      'Precio unitario: ' + pesos(precio(p,cantidad))
    );
    unitario.className = 'muted';
    info.append(unitario);

    const monto = nodo('div',pesos(precio(p,cantidad)*cantidad));
    monto.className = 'price';
    info.append(monto);

    const controles = nodo('div');
    controles.className = 'cart-controls';

    const menos = nodo('button','−');
    menos.onclick = () => {
      if (carrito[id] <= 1) delete carrito[id];
      else carrito[id]--;
      renderCarrito();
    };

    const numero = nodo('span',String(cantidad));

    const mas = nodo('button','+');
    mas.disabled = cantidad >= p.stock;
    mas.onclick = () => {
      if (carrito[id] < p.stock) {
        carrito[id]++;
        renderCarrito();
      }
    };

    const quitar = nodo('button','Eliminar');
    quitar.className = 'danger';
    quitar.onclick = () => {
      delete carrito[id];
      renderCarrito();
    };

    controles.append(menos,numero,mas,quitar);
    info.append(controles);
    row.append(info);
    root.append(row);
  }

  const s = subtotal();
  const e = envio();

  $('subtotal').textContent = pesos(s);
  $('despacho').textContent = e.texto;

  if (e.costo === null) {
    $('totalLabel').textContent = 'Total productos';
    $('total').textContent = pesos(s);
  } else {
    $('totalLabel').textContent = 'Total';
    $('total').textContent = pesos(s + e.costo);
  }

  if (e.tipo === 'pendiente') {
    $('avisoEnvio').textContent =
      'Despacho por calcular. Completa tus datos para conocer la condición de envío.';
  } else if (e.tipo === 'por_pagar') {
    $('avisoEnvio').textContent =
      'Otras Regiones / Comuna: Envío por pagar. El transporte se paga según las condiciones de la empresa transportista.';
  } else if (e.tipo === 'gratis') {
    $('avisoEnvio').textContent =
      'La Serena y Coquimbo – Compras Sobre $30.000: Despacho Gratis.';
  } else if (e.tipo === 'retiro') {
    $('avisoEnvio').textContent =
      'Retiro sin costo. Brusaam confirmará la dirección y el horario de retiro.';
  } else {
    $('avisoEnvio').textContent =
      'Despacho local: ' + e.texto;
  }
}

$('buscar').oninput = renderCatalogo;

$('fCategoria').onchange = () => {
  $('fSubcategoria').value = '';
  actualizarFiltros();
  renderCatalogo();
};

$('fSubcategoria').onchange = renderCatalogo;

$('modalidad').onchange = () => {
  $('datosEntrega').classList.toggle(
    'hidden',
    $('modalidad').value === 'retiro'
  );
  renderCarrito();
};

$('region').onchange = renderCarrito;
$('comuna').oninput = renderCarrito;

$('enviar').onclick = () => {
  const nombre = $('cliente').value.trim();
  const modalidad = $('modalidad').value;
  const direccion = $('direccion').value.trim();
  const region = $('region').value;
  const comuna = $('comuna').value.trim();

  if (!Object.keys(carrito).length) {
    alert('Agrega productos al carrito.');
    return;
  }

  if (!nombre) {
    alert('Ingresa el nombre del solicitante.');
    $('cliente').focus();
    return;
  }

  if (modalidad === 'entrega' &&
      (!direccion || !region || !comuna)) {
    alert('Completa dirección, región y comuna.');
    return;
  }

  const lineas = [];

  for (const [id,cantidad] of Object.entries(carrito)) {
    const p = productos.find(x => String(x.id) === id);
    if (!p) continue;
    lineas.push(
      cantidad + ' x ' + p.name +
      ' — ' + pesos(precio(p,cantidad)*cantidad)
    );
  }

  const e = envio();
  const s = subtotal();

  const mensaje = [
    'Hola Brusaam, quiero solicitar el siguiente pedido:',
    '',
    ...lineas,
    '',
    'Subtotal productos: ' + pesos(s),
    'Despacho: ' + e.texto,
    e.costo === null
      ? 'Total productos (sin transporte): ' + pesos(s)
      : 'Total: ' + pesos(s + e.costo),
    '',
    'Nombre del solicitante: ' + nombre,
    'Modalidad: ' +
      (modalidad === 'retiro' ? 'Retiro' : 'Entrega a domicilio'),
    ...(modalidad === 'entrega'
      ? [
          'Dirección: ' + direccion,
          'Región: ' + region,
          'Comuna: ' + comuna
        ]
      : [])
  ].join('\n');

  location.href =
    'https://wa.me/56966282007?text=' +
    encodeURIComponent(mensaje);
};

fetch('/api/productos')
  .then(r => {
    if (!r.ok) throw Error('No se pudo cargar el catálogo');
    return r.json();
  })
  .then(data => {
    productos = data;
    actualizarFiltros();
    renderCatalogo();
    renderCarrito();
  })
  .catch(() => {
    $('catalogo').textContent =
      'No se pudo cargar el catálogo. Intenta nuevamente.';
  });
</script>`;

const admin = String.raw`
<h2>Administración Brusaam</h2>

<section id="login">
  <h3>Iniciar sesión</h3>
  <form id="loginForm">
    <label>Contraseña
      <input id="password" type="password" required>
    </label>
    <button>Ingresar</button>
  </form>
  <p id="loginMsg"></p>
</section>

<div id="panel" class="hidden">
  <section>
    <div class="flex">
      <h3 class="grow">Agregar o editar producto</h3>
      <button id="salir">Cerrar sesión</button>
    </div>

    <form id="form">
      <input type="hidden" id="id">

      <label>Nombre del producto *
        <input id="name" maxlength="160" required>
      </label>

      <label>Categoría *
        <select id="category">
          <option>Limpieza del hogar</option>
          <option>Cuidado personal</option>
          <option>Papelería</option>
          <option>Otros productos</option>
          <option>General</option>
        </select>
      </label>

      <label>Subcategoría
        <select id="subcategory"></select>
      </label>

      <label>Descripción
        <textarea id="description" maxlength="1000"></textarea>
      </label>

      <label>Precio detalle (CLP) *
        <input id="retail" type="number" min="0" step="1" required>
      </label>

      <label>Precio por mayor desde 2 unidades (CLP) *
        <input id="wholesale" type="number" min="0" step="1" required>
      </label>

      <label>Stock *
        <input id="stock" type="number" min="0" step="1" required>
      </label>

      <label>Fotografía JPG, PNG o WebP (máximo 5 MB)
        <input id="foto" type="file" accept="image/jpeg,image/png,image/webp">
      </label>

      <button id="subirFoto" type="button">
        Subir fotografía
      </button>

      <p id="fotoEstado" class="muted"></p>

      <img id="fotoVista"
        alt="Vista previa"
        style="display:none;max-width:200px;max-height:180px;object-fit:contain">

      <label>URL de fotografía
        <input id="image" type="url" placeholder="https://...">
      </label>

      <label>
        <input id="active" type="checkbox" checked style="width:auto">
        Producto visible
      </label>

      <div class="flex">
        <button>Guardar producto</button>
        <button type="button" id="limpiar">Limpiar</button>
      </div>
    </form>
    <p id="estado"></p>
  </section>

  <section>
    <h3>Productos registrados</h3>
    <div id="productosAdmin"></div>
  </section>
</div>

<script>
const $ = id => document.getElementById(id);
let lista = [];

const subcategorias = {
  'Limpieza del hogar': [
    'Detergentes y suavizantes',
    'Cloros y desinfectantes',
    'Lavalozas',
    'Limpiapisos',
    'Limpiavidrios y desengrasantes',
    'Ambientales',
    'Otros de limpieza'
  ],
  'Cuidado personal': [
    'Shampoo y acondicionador',
    'Jabones',
    'Desodorantes',
    'Cremas corporales',
    'Cuidado del bebé',
    'Otros de cuidado personal'
  ],
  'Papelería': [
    'Papel higiénico',
    'Toallas de papel',
    'Servilletas',
    'Pañuelos y otros'
  ],
  'Otros productos': [
    'Insecticidas',
    'Limpieza automotriz',
    'Bolsas de basura',
    'Accesorios de limpieza',
    'Otros'
  ],
  'General': ['General']
};

function actualizarSubcategorias(valor = '') {
  const categoria = $('category').value;
  const opciones = subcategorias[categoria] || [];

  $('subcategory').replaceChildren(
    new Option('Sin subcategoría','')
  );

  opciones.forEach(s => {
    $('subcategory').add(new Option(s,s));
  });

  if (valor && !opciones.includes(valor)) {
    $('subcategory').add(new Option(valor,valor));
  }

  $('subcategory').value = valor || '';
}

$('category').onchange = () => actualizarSubcategorias();
actualizarSubcategorias();

async function api(url, opts = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });

  const data = await response.json()
    .catch(() => ({error:'Error de conexión'}));

  if (!response.ok) {
    throw Error(data.error || 'Error');
  }

  return data;
}

async function iniciar() {
  try {
    const session = await api('/api/admin/session');

    $('login').classList.toggle(
      'hidden', session.authenticated
    );

    $('panel').classList.toggle(
      'hidden', !session.authenticated
    );

    if (session.authenticated) await cargar();
  } catch (e) {
    $('loginMsg').textContent = e.message;
  }
}

$('loginForm').onsubmit = async e => {
  e.preventDefault();

  try {
    await api('/api/admin/login', {
      method:'POST',
      body:JSON.stringify({
        password:$('password').value
      })
    });

    $('password').value = '';
    $('loginMsg').textContent = '';
    await iniciar();
  } catch (err) {
    $('loginMsg').textContent = err.message;
  }
};

$('salir').onclick = async () => {
  await api('/api/admin/logout', {
    method:'POST',
    body:'{}'
  });
  await iniciar();
};

function limpiar() {
  $('form').reset();
  $('id').value = '';
  $('category').value = 'Limpieza del hogar';
  actualizarSubcategorias();
  $('fotoVista').style.display = 'none';
  $('fotoVista').removeAttribute('src');
  $('fotoEstado').textContent = '';
  $('estado').textContent = '';
}

$('limpiar').onclick = limpiar;

async function cargar() {
  lista = await api('/api/admin/products');
  const root = $('productosAdmin');
  root.replaceChildren();

  for (const p of lista) {
    const row = document.createElement('p');

    row.textContent =
      p.name + ' — $' + p.retail +
      ' / $' + p.wholesale +
      ' — Stock: ' + p.stock + ' ';

    const editar = document.createElement('button');
    editar.textContent = 'Editar';

    editar.onclick = () => {
      for (const k of [
        'id','name','description',
        'retail','wholesale','stock','image'
      ]) {
        $(k).value = p[k] ?? '';
      }

      const categoria = p.category || 'General';

      if (![...$('category').options]
        .some(o => o.value === categoria)) {
        $('category').add(new Option(categoria,categoria));
      }

      $('category').value = categoria;
      actualizarSubcategorias(p.subcategory || '');

      $('active').checked = !!p.active;
      $('foto').value = '';
      $('fotoEstado').textContent = '';

      if (p.image) {
        $('fotoVista').src = p.image;
        $('fotoVista').style.display = 'block';
      } else {
        $('fotoVista').style.display = 'none';
      }

      window.scrollTo(0,0);
    };

    const eliminar = document.createElement('button');
    eliminar.textContent = 'Eliminar';
    eliminar.className = 'danger';

    eliminar.onclick = async () => {
      if (!confirm('¿Eliminar ' + p.name + '?')) return;

      try {
        await api('/api/admin/products/' + p.id, {
          method:'DELETE',
          body:'{}'
        });
        await cargar();
      } catch (e) {
        $('estado').textContent = e.message;
      }
    };

    row.append(editar,' ',eliminar);
    root.append(row);
  }
}

$('subirFoto').onclick = async () => {
  const file = $('foto').files[0];

  if (!file) {
    $('fotoEstado').textContent =
      'Selecciona una fotografía.';
    return;
  }

  if (!['image/jpeg','image/png','image/webp'].includes(file.type)
      || file.size === 0
      || file.size > 5*1024*1024) {
    $('fotoEstado').textContent =
      'Solo JPG, PNG o WebP de máximo 5 MB.';
    return;
  }

  $('subirFoto').disabled = true;
  $('fotoEstado').textContent = 'Subiendo fotografía...';

  try {
    const form = new FormData();
    form.append('file',file);

    const r = await fetch('/api/admin/upload', {
      method:'POST',
      credentials:'same-origin',
      body:form
    });

    const data = await r.json()
      .catch(() => ({error:'Respuesta inválida'}));

    if (!r.ok) throw Error(data.error || 'Error al subir');

    $('image').value = data.url;
    $('fotoVista').src = data.url;
    $('fotoVista').style.display = 'block';
    $('fotoEstado').textContent =
      'Fotografía subida. Presiona Guardar producto.';
  } catch (e) {
    $('fotoEstado').textContent = e.message;
  } finally {
    $('subirFoto').disabled = false;
  }
};

$('form').onsubmit = async e => {
  e.preventDefault();

  const id = $('id').value;

  const p = {
    name:$('name').value,
    category:$('category').value,
    subcategory:$('subcategory').value,
    description:$('description').value,
    retail:Number($('retail').value),
    wholesale:Number($('wholesale').value),
    stock:Number($('stock').value),
    image:$('image').value,
    active:$('active').checked
  };

  try {
    await api(
      '/api/admin/products' + (id ? '/' + id : ''),
      {
        method:id ? 'PUT' : 'POST',
        body:JSON.stringify(p)
      }
    );

    limpiar();
    $('estado').textContent = 'Producto guardado';
    await cargar();
  } catch (e) {
    $('estado').textContent = e.message;
  }
};

iniciar();
</script>`;

async function loginState(env, ip) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, failures INTEGER NOT NULL, until_ms INTEGER NOT NULL)"
  ).run();

  return await env.DB.prepare(
    "SELECT failures,until_ms FROM login_attempts WHERE ip=?"
  ).bind(ip).first() || {failures:0,until_ms:0};
}

async function loginFailure(env, ip, n) {
  await env.DB.prepare(
    "INSERT INTO login_attempts(ip,failures,until_ms) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET failures=excluded.failures,until_ms=excluded.until_ms"
  ).bind(ip,n,Date.now()+15*60*1000).run();
}

function validProduct(p) {
  return !!p &&
    typeof p.name === "string" &&
    !!p.name.trim() &&
    p.name.length <= 160 &&
    typeof p.category === "string" &&
    p.category.length <= 80 &&
    typeof p.subcategory === "string" &&
    p.subcategory.length <= 100 &&
    typeof p.description === "string" &&
    p.description.length <= 1000 &&
    Number.isSafeInteger(p.retail) &&
    p.retail >= 0 &&
    Number.isSafeInteger(p.wholesale) &&
    p.wholesale >= 0 &&
    Number.isSafeInteger(p.stock) &&
    p.stock >= 0 &&
    typeof p.image === "string" &&
    p.image.length <= 1500 &&
    (!p.image || p.image.startsWith("https://"));
}

async function cloudinarySignature(params, secret) {
  const str = Object.keys(params).sort()
    .map(k => k + "=" + params[k]).join("&") + secret;

  const digest = await crypto.subtle.digest(
    "SHA-1", enc.encode(str)
  );

  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2,"0"))
    .join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === "/" && method === "GET") {
        return page(shop);
      }

      if (path === "/admin" && method === "GET") {
        return page(admin);
      }

      if (path === "/api/productos" && method === "GET") {
        await ensureSubcategory(env);

        const r = await env.DB.prepare(
          "SELECT id,name,category,subcategory,description,retail,wholesale,stock,image FROM products WHERE active=1 ORDER BY name"
        ).all();

        return json(r.results);
      }

      if (path === "/api/admin/session" && method === "GET") {
        return json({
          authenticated:await authenticated(request,env)
        });
      }

      if (path.startsWith("/api/admin/")) {
        if (!env.DB || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
          return json({error:"Falta configuración de seguridad"},503);
        }

        if (method !== "GET" && !sameOrigin(request)) {
          return json({error:"Origen no permitido"},403);
        }

        if (path === "/api/admin/login" && method === "POST") {
          const ip = request.headers.get("CF-Connecting-IP") || "unknown";
          const state = await loginState(env,ip);

          if (state.failures >= 5 && state.until_ms > Date.now()) {
            return json({
              error:"Demasiados intentos. Espera 15 minutos."
            },429);
          }

          const body = await request.json().catch(() => ({}));
          const supplied = typeof body.password === "string"
            ? body.password : "";

          const a = new Uint8Array(
            await crypto.subtle.digest("SHA-256",enc.encode(supplied))
          );
          const b = new Uint8Array(
            await crypto.subtle.digest("SHA-256",enc.encode(env.ADMIN_PASSWORD))
          );

          let diff = 0;
          for (let i=0;i<a.length;i++) diff |= a[i]^b[i];

          if (diff !== 0) {
            await loginFailure(
              env,ip,
              state.until_ms < Date.now() ? 1 : state.failures+1
            );
            return json({error:"Contraseña incorrecta"},401);
          }

          await env.DB.prepare(
            "DELETE FROM login_attempts WHERE ip=?"
          ).bind(ip).run();

          const expiry = String(Date.now()+8*60*60*1000);
          const signature = await sign(expiry,env.SESSION_SECRET);

          return json({ok:true},200,{
            "Set-Cookie":
              COOKIE+"="+expiry+"."+signature+
              "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800"
          });
        }

        if (path === "/api/admin/logout" && method === "POST") {
          return json({ok:true},200,{
            "Set-Cookie":
              COOKIE+"=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
          });
        }

        if (!await authenticated(request,env)) {
          return json({error:"Inicia sesión"},401);
        }

        if (path === "/api/admin/upload" && method === "POST") {
          if (!env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
            return json({
              error:"Faltan las claves de Cloudinary"
            },503);
          }

          const length = Number(
            request.headers.get("Content-Length") || 0
          );

          if (length > 6*1024*1024) {
            return json({error:"Archivo demasiado grande"},413);
          }

          if (!(request.headers.get("Content-Type") || "")
            .toLowerCase().startsWith("multipart/form-data;")) {
            return json({error:"Formato de subida no válido"},400);
          }

          const form = await request.formData().catch(() => null);
          const file = form?.get("file");

          if (!(file instanceof File) ||
              file.size === 0 ||
              file.size > 5*1024*1024 ||
              !["image/jpeg","image/png","image/webp"].includes(file.type)) {
            return json({
              error:"Solo JPG, PNG o WebP de máximo 5 MB"
            },400);
          }

          const bytes = new Uint8Array(
            await file.slice(0,12).arrayBuffer()
          );

          const jpeg =
            bytes[0]===255 && bytes[1]===216 && bytes[2]===255;

          const png =
            bytes[0]===137 && bytes[1]===80 &&
            bytes[2]===78 && bytes[3]===71 &&
            bytes[4]===13 && bytes[5]===10 &&
            bytes[6]===26 && bytes[7]===10;

          const webp =
            String.fromCharCode(...bytes.slice(0,4))==="RIFF" &&
            String.fromCharCode(...bytes.slice(8,12))==="WEBP";

          if (!(
            (file.type==="image/jpeg" && jpeg) ||
            (file.type==="image/png" && png) ||
            (file.type==="image/webp" && webp)
          )) {
            return json({error:"Imagen no válida"},400);
          }

          const params = {
            folder:"brusaam-productos",
            timestamp:String(Math.floor(Date.now()/1000))
          };

          const signature = await cloudinarySignature(
            params,env.CLOUDINARY_API_SECRET
          );

          const body = new FormData();
          body.append("file",file,file.name);
          body.append("folder",params.folder);
          body.append("timestamp",params.timestamp);
          body.append("api_key",env.CLOUDINARY_API_KEY);
          body.append("signature",signature);

          const upstream = await fetch(
            "https://api.cloudinary.com/v1_1/oobzcqc2/image/upload",
            {method:"POST",body}
          );

          const result = await upstream.json().catch(() => null);

          if (!upstream.ok ||
              !result?.secure_url ||
              !result.secure_url.startsWith(
                "https://res.cloudinary.com/oobzcqc2/"
              )) {
            return json({
              error:"Cloudinary rechazó la fotografía"
            },502);
          }

          return json({url:result.secure_url});
        }

        await ensureSubcategory(env);

        if (path === "/api/admin/products" && method === "GET") {
          const r = await env.DB.prepare(
            "SELECT * FROM products ORDER BY id DESC"
          ).all();

          return json(r.results);
        }

        const match = path.match(
          /^\/api\/admin\/products\/(\d+)$/
        );

        if (path === "/api/admin/products" && method === "POST") {
          const p = await request.json().catch(() => null);

          if (!validProduct(p)) {
            return json({error:"Revisa los datos del producto"},400);
          }

          const r = await env.DB.prepare(
            "INSERT INTO products(name,category,subcategory,description,retail,wholesale,min_qty,stock,image,active) VALUES(?,?,?,?,?,?,2,?,?,?)"
          ).bind(
            p.name.trim(),p.category,p.subcategory,p.description,
            p.retail,p.wholesale,p.stock,p.image,p.active?1:0
          ).run();

          return json({ok:true,id:r.meta.last_row_id});
        }

        if (match && method === "PUT") {
          const p = await request.json().catch(() => null);

          if (!validProduct(p)) {
            return json({error:"Revisa los datos del producto"},400);
          }

          await env.DB.prepare(
            "UPDATE products SET name=?,category=?,subcategory=?,description=?,retail=?,wholesale=?,stock=?,image=?,active=? WHERE id=?"
          ).bind(
            p.name.trim(),p.category,p.subcategory,p.description,
            p.retail,p.wholesale,p.stock,p.image,p.active?1:0,
            Number(match[1])
          ).run();

          return json({ok:true});
        }

        if (match && method === "DELETE") {
          await env.DB.prepare(
            "DELETE FROM products WHERE id=?"
          ).bind(Number(match[1])).run();

          return json({ok:true});
        }

        return json({error:"Ruta no encontrada"},404);
      }

      return new Response("No encontrado",{status:404});

    } catch (e) {
      console.error("Brusaam error:",e);
      return json({error:"Error interno de la tienda"},500);
    }
  }
};
