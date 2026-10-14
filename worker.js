
/*
 BRUSAAM - TIENDA ONLINE
 Cloudflare Workers + D1 + Cloudinary
 Actualización: inicio, secciones, categorías,
 fotografías, carrito y administración.
*/

const LOGO_ORIGINAL =
  "https://res.cloudinary.com/oobzcqc2/image/upload/IMG_20260517_093131_502.webp";

const CLOUD_NAME = "oobzcqc2";
const WHATSAPP = "56966282007";
const COOKIE = "brusaam_session";
const encoder = new TextEncoder();

const SECCIONES = [
  ["destacados", "Los más destacados"],
  ["pack_ahorro", "Pack Ahorro"],
  ["ofertas", "Ofertas"],
  ["box_pyme", "Box Pyme"]
];

const CATEGORIAS_INICIALES = {
  "Limpieza del hogar": [
    "Detergentes y suavizantes",
    "Cloros y desinfectantes",
    "Lavalozas",
    "Limpiapisos",
    "Limpiavidrios y desengrasantes",
    "Ambientales",
    "Otros de limpieza"
  ],
  "Cuidado personal": [
    "Shampoo y acondicionador",
    "Jabones",
    "Desodorantes",
    "Cremas corporales",
    "Cuidado del bebé",
    "Otros de cuidado personal"
  ],
  "Papelería": [
    "Papel higiénico",
    "Toallas de papel",
    "Servilletas",
    "Otros de papelería"
  ],
  "Otros productos": [
    "Insecticidas",
    "Limpieza automotriz",
    "Bolsas de basura",
    "Accesorios de limpieza",
    "Otros"
  ]
};

function respuesta(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

function textoSeguro(valor, max = 200) {
  return String(valor ?? "").trim().slice(0, max);
}

function esImagen(url) {
  return !url ||
    (
      typeof url === "string" &&
      url.length <= 1500 &&
      url.startsWith("https://")
    );
}

function base64url(bytes) {
  let str = "";
  for (const b of bytes) {
    str += String.fromCharCode(b);
  }
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function firmar(valor, secreto) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secreto),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const firma = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(valor)
  );

  return base64url(new Uint8Array(firma));
}

function cookieActual(request) {
  const cookies = request.headers.get("Cookie") || "";
  const item = cookies
    .split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(COOKIE + "="));

  return item ? item.slice(COOKIE.length + 1) : "";
}

async function autorizado(request, env) {
  if (!env.SESSION_SECRET) return false;

  const partes = cookieActual(request).split(".");
  if (partes.length !== 2) return false;

  const [vence, firma] = partes;

  if (!/^\d{13}$/.test(vence)) return false;
  if (Number(vence) <= Date.now()) return false;

  const esperada = await firmar(
    vence,
    env.SESSION_SECRET
  );

  if (firma.length !== esperada.length) return false;

  let diferencia = 0;
  for (let i = 0; i < firma.length; i++) {
    diferencia |=
      firma.charCodeAt(i) ^ esperada.charCodeAt(i);
  }

  return diferencia === 0;
}

function origenValido(request) {
  return request.headers.get("Origin") ===
    new URL(request.url).origin;
}

async function inicializar(env) {
  if (!env.DB) throw Error("Falta conexión D1");

  const columnas = await env.DB.prepare(
    "PRAGMA table_info(products)"
  ).all();

  if (!columnas.results?.length) {
    throw Error("No existe la tabla products");
  }

  const existentes = new Set(
    columnas.results.map(x => x.name)
  );

  const adicionales = [
    ["subcategory", "TEXT NOT NULL DEFAULT ''"],
    ["destacados", "INTEGER NOT NULL DEFAULT 0"],
    ["pack_ahorro", "INTEGER NOT NULL DEFAULT 0"],
    ["ofertas", "INTEGER NOT NULL DEFAULT 0"],
    ["box_pyme", "INTEGER NOT NULL DEFAULT 0"]
  ];

  for (const [nombre, tipo] of adicionales) {
    if (!existentes.has(nombre)) {
      try {
        await env.DB.prepare(
          "ALTER TABLE products ADD COLUMN " +
          nombre + " " + tipo
        ).run();
      } catch (error) {
        if (!String(error.message).includes(
          "duplicate column"
        )) {
          throw error;
        }
      }
    }
  }

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS shop_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      image TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS shop_subcategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      image TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(category_id,name)
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS shop_sections (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      image TEXT NOT NULL DEFAULT ''
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS shop_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      until_ms INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  for (const [slug, title] of SECCIONES) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO shop_sections
      (slug,title,image) VALUES(?,?,'')
    `).bind(slug, title).run();
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO shop_settings
    (key,value) VALUES('logo',?)
  `).bind(LOGO_ORIGINAL).run();

  let posicion = 0;

  for (const [categoria, subs] of
    Object.entries(CATEGORIAS_INICIALES)) {

    await env.DB.prepare(`
      INSERT OR IGNORE INTO shop_categories
      (name,position) VALUES(?,?)
    `).bind(categoria, posicion++).run();

    const fila = await env.DB.prepare(`
      SELECT id FROM shop_categories WHERE name=?
    `).bind(categoria).first();

    let orden = 0;

    for (const sub of subs) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO shop_subcategories
        (category_id,name,position)
        VALUES(?,?,?)
      `).bind(fila.id, sub, orden++).run();
    }
  }
}

async function datosTienda(env) {
  const [
    productos,
    categorias,
    subcategorias,
    secciones,
    logo
  ] = await Promise.all([
    env.DB.prepare(`
      SELECT id,name,category,subcategory,
      description,retail,wholesale,
      min_qty,stock,image,
      destacados,pack_ahorro,ofertas,box_pyme
      FROM products
      WHERE active=1
      ORDER BY name
    `).all(),

    env.DB.prepare(`
      SELECT * FROM shop_categories
      ORDER BY position,name
    `).all(),

    env.DB.prepare(`
      SELECT * FROM shop_subcategories
      ORDER BY position,name
    `).all(),

    env.DB.prepare(`
      SELECT * FROM shop_sections
    `).all(),

    env.DB.prepare(`
      SELECT value FROM shop_settings
      WHERE key='logo'
    `).first()
  ]);

  return {
    products: productos.results || [],
    categories: categorias.results || [],
    subcategories: subcategorias.results || [],
    sections: secciones.results || [],
    logo: logo?.value || LOGO_ORIGINAL
  };
}

function pagina(contenido) {
  return new Response(`<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport"
 content="width=device-width,initial-scale=1">
<title>Brusaam | La excelencia en tu hogar</title>
<style>
:root{
 --morado:#6524AD;
 --azul:#078ED5;
 --navy:#14234B;
 --fondo:#F4F7FC;
 --borde:#E1E5EE;
}
*{box-sizing:border-box}
body{
 margin:0;
 font-family:Arial,Helvetica,sans-serif;
 background:var(--fondo);
 color:var(--navy);
}
header{
 background:#fff;
 text-align:center;
 padding:20px 12px 17px;
 box-shadow:0 2px 12px #14234B12;
}
.logo{
 width:155px;
 max-width:65%;
 height:auto;
 object-fit:contain;
 background:transparent;
}
.marca{
 font-size:13px;
 color:#64748b;
 margin:5px 0 0;
}
main{
 max-width:1160px;
 margin:auto;
 padding:16px;
}
h1,h2,h3{color:var(--navy)}
h1{font-size:26px}
h2{font-size:22px}
h3{font-size:17px}
button{
 border:0;
 background:var(--morado);
 color:#fff;
 padding:11px 14px;
 border-radius:9px;
 font-weight:700;
 cursor:pointer;
}
button:disabled{opacity:.45;cursor:not-allowed}
button.secundario{background:#eae2f6;color:var(--morado)}
button.peligro{background:#a33d4b}
button.pequeno{padding:7px 10px}
input,select,textarea{
 width:100%;
 padding:11px;
 border:1px solid #cbd4e2;
 border-radius:9px;
 background:white;
 font:inherit;
 margin:6px 0 12px;
}
input[type=checkbox]{width:auto}
label{display:block;font-weight:600}
a{color:var(--morado);text-decoration:none}
.tarjeta,section{
 background:white;
 border-radius:14px;
 padding:17px;
 margin:14px 0;
 box-shadow:0 2px 9px #14234B0d;
}
.oculto{display:none!important}
.muted{color:#66758a;font-size:13px}
.flex{
 display:flex;
 align-items:center;
 gap:9px;
 flex-wrap:wrap;
}
.grow{flex:1}
.grid{
 display:grid;
 grid-template-columns:repeat(auto-fill,minmax(195px,1fr));
 gap:13px;
}
.producto{
 background:white;
 border:1px solid var(--borde);
 border-radius:13px;
 padding:12px;
 display:flex;
 flex-direction:column;
 gap:7px;
 min-width:0;
}
.producto img{
 width:100%;
 height:185px;
 object-fit:contain;
}
.producto h3{
 margin:3px 0;
 font-size:15px;
 min-height:34px;
}
.precio{
 font-size:21px;
 font-weight:800;
 color:var(--azul);
}
.producto button{margin-top:auto}
.buscador{position:relative}
.buscador input{
 padding-left:42px;
 font-size:16px;
}
.lupa{
 position:absolute;
 top:16px;
 left:13px;
 color:var(--morado);
 font-size:22px;
}
.banner{
 max-width:700px;
 margin:15px auto 0;
 padding:16px;
 background:linear-gradient(115deg,#F3ECFC,#EAF4FF);
 border:1px solid #DED2F2;
 border-radius:14px;
}
.banner strong{
 display:block;
 color:var(--morado);
 font-size:23px;
 margin:6px 0;
}
.banner small{
 color:#4c3670;
 font-weight:600;
}
.bloques{
 display:grid;
 grid-template-columns:repeat(4,minmax(0,1fr));
 gap:12px;
}
.bloque{
 border:1px solid var(--borde);
 border-radius:14px;
 background:#fff;
 overflow:hidden;
 cursor:pointer;
 text-align:left;
 padding:0;
 color:var(--navy);
}
.bloque img{
 width:100%;
 height:145px;
 object-fit:cover;
 background:#F0EAF8;
}
.bloque .nombre{
 display:block;
 padding:12px;
 font-weight:700;
}
.bloque .sin-foto{
 height:145px;
 background:linear-gradient(130deg,#EFE6FA,#E4F3FC);
 display:grid;
 place-items:center;
 font-size:36px;
}
.ruta{
 display:flex;
 flex-wrap:wrap;
 gap:8px;
 align-items:center;
 margin:10px 0 16px;
}
.ruta button{
 background:transparent;
 color:var(--morado);
 padding:5px;
}
.filtros{
 display:grid;
 grid-template-columns:1fr 1fr;
 gap:12px;
}
.fila-carrito{
 display:flex;
 align-items:center;
 gap:12px;
 border-bottom:1px solid var(--borde);
 padding:13px 0;
}
.fila-carrito img{
 width:82px;
 height:82px;
 object-fit:contain;
 border-radius:8px;
}
.info-carrito{flex:1;min-width:0}
.info-carrito strong{display:block}
.controles{
 display:flex;
 align-items:center;
 gap:8px;
 margin-top:9px;
 flex-wrap:wrap;
}
.resumen{
 display:flex;
 justify-content:space-between;
 gap:12px;
 padding:11px 0;
}
.total{
 border-top:1px solid var(--borde);
 font-size:20px;
 font-weight:800;
}
table{
 width:100%;
 border-collapse:collapse;
 font-size:14px;
}
th,td{
 padding:11px;
 border-bottom:1px solid var(--borde);
 text-align:left;
}
th{background:#F2ECFA}
.tabla{overflow-x:auto}
.aviso{
 background:#F3EDFB;
 border-radius:9px;
 padding:12px;
 font-size:13px;
}
.admin-row{
 padding:12px 0;
 border-bottom:1px solid var(--borde);
}
.admin-row img{
 width:65px;
 height:65px;
 object-fit:contain;
}
.admin-tabs{
 display:flex;
 flex-wrap:wrap;
 gap:8px;
 margin:14px 0;
}
.admin-tabs button{
 background:#EAE2F6;
 color:var(--morado);
}
.admin-tabs button.activo{
 background:var(--morado);
 color:white;
}
@media(max-width:700px){
 .bloques{grid-template-columns:repeat(2,minmax(0,1fr))}
 .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
 .producto{padding:10px}
 .producto img{height:135px}
 .producto h3{font-size:14px}
 .precio{font-size:18px}
 .filtros{grid-template-columns:1fr}
 .bloque img,.bloque .sin-foto{height:115px}
 main{padding:10px}
 .fila-carrito img{width:65px;height:65px}
}
</style>
</head>
<body>
<header>
<img id="logoTienda" class="logo"
 src="${LOGO_ORIGINAL}" alt="Brusaam">
<div class="marca">La excelencia en tu hogar</div>
<div class="banner">
 <small>🚚 BENEFICIO ESPECIAL</small>
 <strong>¡Despacho GRATIS!</strong>
 <div>Coquimbo y La Serena</div>
 <div style="margin-top:6px;color:#6524AD">
  En compras sobre $30.000
 </div>
</div>
</header>
<main>${contenido}</main>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; " +
        "script-src 'unsafe-inline'; " +
        "style-src 'unsafe-inline'; " +
        "img-src https: data:; " +
        "connect-src 'self'; " +
        "form-action 'self'; " +
        "base-uri 'none'; " +
        "frame-ancestors 'none'"
    }
  });
}

/* =========================================
   TIENDA PUBLICA
========================================= */

const tienda = String.raw`
<h2>Bienvenido a Brusaam</h2>

<div class="buscador">
 <span class="lupa">⌕</span>
 <input id="buscar"
  placeholder="Buscar productos, marcas o categorías...">
</div>

<div id="inicio">
 <h2>Explora nuestras categorías</h2>
 <div id="categoriasInicio" class="bloques"></div>

 <h2 style="margin-top:28px">Nuestras secciones</h2>
 <div id="seccionesInicio" class="bloques"></div>

 <div id="vitrinas"></div>
</div>

<div id="explorador" class="oculto">
 <div id="ruta" class="ruta"></div>
 <h2 id="tituloExplorador">Productos</h2>
 <div id="subcategoriasVista" class="bloques"></div>
</div>

<section id="zonaCatalogo">
 <h2 id="tituloCatalogo">Todos los productos</h2>
 <div class="filtros">
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
 <p id="cantidadResultados" class="muted"></p>
 <div id="catalogo" class="grid"></div>
</section>

<section id="carrito">
 <h2>🛒 Resumen de mi compra</h2>
 <div id="itemsCarrito"></div>

 <div class="resumen">
  <span>Subtotal productos</span>
  <strong id="subtotal">$0</strong>
 </div>
 <div class="resumen">
  <span>Despacho</span>
  <strong id="despacho">Despacho por calcular</strong>
 </div>
 <div class="resumen total">
  <span id="textoTotal">Total productos</span>
  <span id="total">$0</span>
 </div>
</section>

<section>
 <h3>Condiciones y tarifas de despacho</h3>
 <div class="tabla">
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
 <p class="muted">
  Despacho gratis desde $30.000 de subtotal de productos,
  inclusive, en La Serena y Coquimbo.
 </p>
</section>

<section>
 <h2>Datos del solicitante</h2>

 <label>Nombre y apellido *
  <input id="cliente" maxlength="120">
 </label>

 <label>Modalidad *
  <select id="modalidad">
   <option value="entrega">Entrega a domicilio</option>
   <option value="retiro">Retiro</option>
  </select>
 </label>

 <div id="camposEntrega">
  <label>Dirección *
   <input id="direccion" maxlength="220"
    placeholder="Calle, número y referencia">
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
   <input id="comuna" maxlength="100">
  </label>
 </div>

 <p id="avisoEnvio" class="aviso">
  Despacho por calcular.
 </p>

 <button id="enviar" style="width:100%">
  Enviar pedido por WhatsApp
 </button>

 <p class="muted">
  Brusaam confirmará disponibilidad, pago y entrega.
 </p>
</section>

<script>
const $ = id => document.getElementById(id);
const dinero = n => '$' + Number(n).toLocaleString('es-CL');

let productos = [];
let categorias = [];
let subcategorias = [];
let secciones = [];
let carrito = {};
let vista = {tipo:'todos',valor:'',sub:''};

const iconos = {
 'Limpieza del hogar':'🧴',
 'Cuidado personal':'🧼',
 'Papelería':'🧻',
 'Otros productos':'📦',
 'destacados':'⭐',
 'pack_ahorro':'📦',
 'ofertas':'🏷️',
 'box_pyme':'🏪'
};

function elemento(tag,texto) {
 const e=document.createElement(tag);
 if(texto!==undefined) e.textContent=texto;
 return e;
}

function normalizar(s) {
 return String(s||'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .trim().toLowerCase()
  .replace(/\s+/g,' ');
}

function foto(url,alt) {
 const img=elemento('img');
 img.src=url;
 img.alt=alt;
 img.loading='lazy';
 return img;
}

function tarjetaAcceso(nombre,imagen,icono,accion) {
 const boton=elemento('button');
 boton.className='bloque';

 if(imagen && imagen.startsWith('https://')) {
  boton.append(foto(imagen,nombre));
 } else {
  const sin=elemento('div',icono||'📦');
  sin.className='sin-foto';
  boton.append(sin);
 }

 const texto=elemento('span',nombre);
 texto.className='nombre';
 boton.append(texto);
 boton.onclick=accion;

 return boton;
}

function productosSeccion(slug) {
 return productos.filter(p=>Number(p[slug])===1);
}

function precioUnitario(p,cantidad) {
 const minimo=Number(p.min_qty)||2;
 return cantidad>=minimo
  ? Number(p.wholesale)
  : Number(p.retail);
}

function agregar(id,cantidad) {
 const p=productos.find(x=>String(x.id)===String(id));
 if(!p) return;

 const actual=carrito[id]||0;
 const n=Number(cantidad);

 if(!Number.isInteger(n)||n<1||
    actual+n>Number(p.stock)) {
  alert('Cantidad inválida o stock insuficiente.');
  return;
 }

 carrito[id]=actual+n;
 renderCarrito();
}

function tarjetaProducto(p) {
 const card=elemento('div');
 card.className='producto';

 if(p.image && p.image.startsWith('https://')) {
  card.append(foto(p.image,p.name));
 } else {
  const vacio=elemento('div','📦');
  vacio.style.cssText=
   'height:185px;display:grid;place-items:center;background:#F4F7FC';
  card.append(vacio);
 }

 card.append(elemento('h3',p.name));

 if(p.subcategory) {
  const sub=elemento('div',p.subcategory);
  sub.className='muted';
  card.append(sub);
 }

 const detalle=elemento('div',
  'Detalle: '+dinero(p.retail));
 detalle.className='precio';
 card.append(detalle);

 const mayor=elemento('div',
  'Mayor desde '+(p.min_qty||2)+
  ': '+dinero(p.wholesale));
 mayor.className='muted';
 card.append(mayor);

 const stock=elemento('div','Stock: '+p.stock);
 stock.className='muted';
 card.append(stock);

 const cantidad=elemento('input');
 cantidad.type='number';
 cantidad.min='1';
 cantidad.max=String(p.stock);
 cantidad.value='1';
 cantidad.style.maxWidth='75px';

 const fila=elemento('div');
 fila.className='flex';

 const boton=elemento('button','Agregar');
 boton.disabled=Number(p.stock)<1;
 boton.onclick=()=>agregar(p.id,cantidad.value);

 fila.append(cantidad,boton);
 card.append(fila);

 return card;
}

function mostrarInicio() {
 vista={tipo:'todos',valor:'',sub:''};

 $('inicio').classList.remove('oculto');
 $('explorador').classList.add('oculto');

 $('fCategoria').value='';
 actualizarFiltroSubs();
 $('fSubcategoria').value='';

 $('tituloCatalogo').textContent='Todos los productos';
 renderCatalogo();
}

function mostrarCategoria(nombre,sub='') {
 vista={tipo:'categoria',valor:nombre,sub};

 $('inicio').classList.add('oculto');
 $('explorador').classList.remove('oculto');

 $('fCategoria').value=nombre;
 actualizarFiltroSubs();
 $('fSubcategoria').value=sub;

 $('tituloExplorador').textContent=sub||nombre;
 $('tituloCatalogo').textContent=sub||nombre;

 renderRuta();
 renderSubcategorias(nombre);
 renderCatalogo();

 $('explorador').scrollIntoView({behavior:'smooth'});
}

function mostrarSeccion(slug) {
 vista={tipo:'seccion',valor:slug,sub:''};

 const sec=secciones.find(s=>s.slug===slug);

 $('inicio').classList.add('oculto');
 $('explorador').classList.remove('oculto');

 $('tituloExplorador').textContent=
  sec?.title||'Productos';

 $('tituloCatalogo').textContent=
  sec?.title||'Productos';

 $('subcategoriasVista').replaceChildren();

 $('fCategoria').value='';
 actualizarFiltroSubs();
 $('fSubcategoria').value='';

 renderRuta();
 renderCatalogo();

 $('explorador').scrollIntoView({behavior:'smooth'});
}

function renderRuta() {
 const root=$('ruta');
 root.replaceChildren();

 const inicio=elemento('button','Inicio');
 inicio.onclick=()=>{
  $('buscar').value='';
  mostrarInicio();
 };
 root.append(inicio);

 if(vista.tipo==='categoria') {
  root.append(elemento('span','›'));

  const cat=elemento('button',vista.valor);
  cat.onclick=()=>mostrarCategoria(vista.valor);
  root.append(cat);

  if(vista.sub) {
   root.append(elemento('span','›'));
   root.append(elemento('strong',vista.sub));
  }
 }

 if(vista.tipo==='seccion') {
  root.append(elemento('span','›'));
  const sec=secciones.find(s=>s.slug===vista.valor);
  root.append(elemento('strong',sec?.title||'Sección'));
 }
}

function renderSubcategorias(categoria) {
 const root=$('subcategoriasVista');
 root.replaceChildren();

 const c=categorias.find(x=>x.name===categoria);
 if(!c) return;

 const subs=subcategorias.filter(
  x=>Number(x.category_id)===Number(c.id)
 );

 for(const sub of subs) {
  root.append(tarjetaAcceso(
   sub.name,sub.image,'📁',
   ()=>mostrarCategoria(categoria,sub.name)
  ));
 }
}

function renderInicio() {
 const root=$('categoriasInicio');
 root.replaceChildren();

 for(const c of categorias) {
  root.append(tarjetaAcceso(
   c.name,c.image,iconos[c.name]||'📁',
   ()=>mostrarCategoria(c.name)
  ));
 }

 const especiales=$('seccionesInicio');
 especiales.replaceChildren();

 for(const s of secciones) {
  especiales.append(tarjetaAcceso(
   s.title,s.image,iconos[s.slug]||'⭐',
   ()=>mostrarSeccion(s.slug)
  ));
 }

 const vitrinas=$('vitrinas');
 vitrinas.replaceChildren();

 for(const s of secciones) {
  const lista=productosSeccion(s.slug).slice(0,4);
  if(!lista.length) continue;

  const bloque=elemento('section');
  const cabecera=elemento('div');
  cabecera.className='flex';

  const titulo=elemento('h2',s.title);
  titulo.className='grow';

  const ver=elemento('button','Ver todos');
  ver.className='secundario';
  ver.onclick=()=>mostrarSeccion(s.slug);

  cabecera.append(titulo,ver);
  bloque.append(cabecera);

  const grid=elemento('div');
  grid.className='grid';

  lista.forEach(p=>grid.append(tarjetaProducto(p)));
  bloque.append(grid);
  vitrinas.append(bloque);
 }
}

function actualizarFiltros() {
 const select=$('fCategoria');
 const actual=select.value;

 select.replaceChildren(
  new Option('Todas las categorías','')
 );

 for(const c of categorias) {
  select.add(new Option(c.name,c.name));
 }

 if(categorias.some(c=>c.name===actual)) {
  select.value=actual;
 }

 actualizarFiltroSubs();
}

function actualizarFiltroSubs() {
 const cat=$('fCategoria').value;
 const select=$('fSubcategoria');
 const actual=select.value;

 select.replaceChildren(
  new Option('Todas las subcategorías','')
 );

 const c=categorias.find(x=>x.name===cat);

 if(c) {
  const subs=subcategorias.filter(
   s=>Number(s.category_id)===Number(c.id)
  );

  for(const sub of subs) {
   select.add(new Option(sub.name,sub.name));
  }
 }

 if([...select.options].some(x=>x.value===actual)) {
  select.value=actual;
 }
}

function renderCatalogo() {
 const buscar=normalizar($('buscar').value);
 const categoria=$('fCategoria').value;
 const sub=$('fSubcategoria').value;

 const lista=productos.filter(p=>{
  if(vista.tipo==='seccion' &&
     Number(p[vista.valor])!==1) return false;

  if(categoria && p.category!==categoria) return false;
  if(sub && p.subcategory!==sub) return false;

  const texto=normalizar([
   p.name,p.category,p.subcategory,p.description
  ].join(' '));

  return texto.includes(buscar);
 });

 $('cantidadResultados').textContent=
  lista.length+' producto(s) encontrado(s)';

 const root=$('catalogo');
 root.replaceChildren();

 for(const p of lista) {
  root.append(tarjetaProducto(p));
 }
}

function subtotal() {
 let suma=0;

 for(const [id,cantidad] of Object.entries(carrito)) {
  const p=productos.find(x=>String(x.id)===id);
  if(p) suma+=precioUnitario(p,cantidad)*cantidad;
 }

 return suma;
}

function despacho() {
 if($('modalidad').value==='retiro') {
  return {tipo:'retiro',costo:0,texto:'Retiro sin costo'};
 }

 const region=normalizar($('region').value);
 const comuna=normalizar($('comuna').value);

 if(!region||!comuna) {
  return {
   tipo:'pendiente',
   costo:null,
   texto:'Despacho por calcular'
  };
 }

 const serena=region==='coquimbo'&&comuna==='la serena';
 const coquimbo=region==='coquimbo'&&comuna==='coquimbo';

 if(serena||coquimbo) {
  if(subtotal()>=30000) {
   return {tipo:'gratis',costo:0,texto:'Despacho gratis'};
  }

  const costo=serena?3000:2000;
  return {tipo:'local',costo,texto:dinero(costo)};
 }

 return {
  tipo:'externo',
  costo:null,
  texto:'Envío por pagar'
 };
}

function renderCarrito() {
 const root=$('itemsCarrito');
 root.replaceChildren();

 const entradas=Object.entries(carrito);

 if(!entradas.length) {
  const vacio=elemento('p','Tu carrito está vacío.');
  vacio.className='muted';
  root.append(vacio);
 }

 for(const [id,cantidad] of entradas) {
  const p=productos.find(x=>String(x.id)===id);
  if(!p) continue;

  const fila=elemento('div');
  fila.className='fila-carrito';

  if(p.image&&p.image.startsWith('https://')) {
   fila.append(foto(p.image,p.name));
  } else {
   const vacio=elemento('div','📦');
   vacio.style.cssText=
    'width:70px;height:70px;display:grid;place-items:center';
   fila.append(vacio);
  }

  const info=elemento('div');
  info.className='info-carrito';

  info.append(elemento('strong',p.name));

  const unit=elemento('div',
   'Precio unitario: '+dinero(precioUnitario(p,cantidad)));
  unit.className='muted';
  info.append(unit);

  const monto=elemento('div',
   dinero(precioUnitario(p,cantidad)*cantidad));
  monto.className='precio';
  info.append(monto);

  const controles=elemento('div');
  controles.className='controles';

  const menos=elemento('button','−');
  menos.className='pequeno';
  menos.onclick=()=>{
   if(carrito[id]<=1) delete carrito[id];
   else carrito[id]--;
   renderCarrito();
  };

  const numero=elemento('strong',String(cantidad));

  const mas=elemento('button','+');
  mas.className='pequeno';
  mas.disabled=cantidad>=p.stock;
  mas.onclick=()=>{
   if(carrito[id]<p.stock) {
    carrito[id]++;
    renderCarrito();
   }
  };

  const eliminar=elemento('button','Eliminar');
  eliminar.className='pequeno peligro';
  eliminar.onclick=()=>{
   delete carrito[id];
   renderCarrito();
  };

  controles.append(menos,numero,mas,eliminar);
  info.append(controles);
  fila.append(info);
  root.append(fila);
 }

 const s=subtotal();
 const e=despacho();

 $('subtotal').textContent=dinero(s);
 $('despacho').textContent=e.texto;

 if(e.costo===null) {
  $('textoTotal').textContent='Total productos';
  $('total').textContent=dinero(s);
 } else {
  $('textoTotal').textContent='Total';
  $('total').textContent=dinero(s+e.costo);
 }

 const avisos={
  pendiente:'Despacho por calcular. Completa los datos de entrega.',
  gratis:'La Serena y Coquimbo: despacho gratis desde $30.000.',
  externo:'Otras Regiones / Comuna: Envío por pagar.',
  retiro:'Retiro sin costo. Brusaam confirmará lugar y horario.'
 };

 $('avisoEnvio').textContent=
  avisos[e.tipo]||
  ('Despacho local: '+e.texto);
}

$('buscar').oninput=()=>{
 if($('buscar').value.trim()) {
  $('inicio').classList.add('oculto');
  $('explorador').classList.add('oculto');
  vista={tipo:'todos',valor:'',sub:''};
  $('fCategoria').value='';
  actualizarFiltroSubs();
  $('tituloCatalogo').textContent='Resultados de búsqueda';
 } else {
  mostrarInicio();
 }
 renderCatalogo();
};

$('fCategoria').onchange=()=>{
 vista={tipo:'todos',valor:'',sub:''};
 actualizarFiltroSubs();
 $('fSubcategoria').value='';
 renderCatalogo();
};

$('fSubcategoria').onchange=renderCatalogo;

$('modalidad').onchange=()=>{
 $('camposEntrega').classList.toggle(
  'oculto',$('modalidad').value==='retiro'
 );
 renderCarrito();
};

$('region').onchange=renderCarrito;
$('comuna').oninput=renderCarrito;

$('enviar').onclick=()=>{
 const nombre=$('cliente').value.trim();
 const modalidad=$('modalidad').value;
 const direccion=$('direccion').value.trim();
 const region=$('region').value;
 const comuna=$('comuna').value.trim();

 if(!Object.keys(carrito).length) {
  alert('Agrega productos al carrito.');
  return;
 }

 if(!nombre) {
  alert('Ingresa el nombre del solicitante.');
  return;
 }

 if(modalidad==='entrega'&&
    (!direccion||!region||!comuna)) {
  alert('Completa dirección, región y comuna.');
  return;
 }

 const lineas=[];

 for(const [id,cantidad] of Object.entries(carrito)) {
  const p=productos.find(x=>String(x.id)===id);
  if(!p) continue;

  lineas.push(
   cantidad+' x '+p.name+
   ' | Unitario: '+dinero(precioUnitario(p,cantidad))+
   ' | Subtotal: '+dinero(precioUnitario(p,cantidad)*cantidad)
  );
 }

 const s=subtotal();
 const e=despacho();

 const mensaje=[
  'Hola Brusaam, quiero realizar este pedido:',
  '',
  ...lineas,
  '',
  'Subtotal productos: '+dinero(s),
  'Despacho: '+e.texto,
  e.costo===null
   ? 'Total productos sin transporte: '+dinero(s)
   : 'Total: '+dinero(s+e.costo),
  '',
  'Solicitante: '+nombre,
  'Modalidad: '+(
   modalidad==='retiro'?'Retiro':'Entrega a domicilio'
  ),
  ...(modalidad==='entrega'?[
   'Dirección: '+direccion,
   'Región: '+region,
   'Comuna: '+comuna
  ]:[])
 ].join('\n');

 window.location.href=
  'https://wa.me/56966282007?text='+
  encodeURIComponent(mensaje);
};

async function cargarTienda() {
 try {
  const r=await fetch('/api/tienda');
  if(!r.ok) throw Error('No se pudo cargar la tienda');

  const d=await r.json();

  productos=d.products||[];
  categorias=d.categories||[];
  subcategorias=d.subcategories||[];
  secciones=d.sections||[];

  if(d.logo&&d.logo.startsWith('https://')) {
   $('logoTienda').src=d.logo;
  }

  actualizarFiltros();
  renderInicio();
  renderCatalogo();
  renderCarrito();
 } catch(error) {
  $('catalogo').textContent=
   'No fue posible cargar los productos. Intenta nuevamente.';
 }
}

cargarTienda();
</script>`;

/* =========================================
   ADMINISTRACION PRIVADA
========================================= */

const admin = String.raw`
<h2>Administración privada Brusaam</h2>

<section id="login">
 <form id="loginForm">
  <label>Contraseña
   <input id="password" type="password" required>
  </label>
  <button>Ingresar</button>
 </form>
 <p id="loginMensaje"></p>
</section>

<div id="panel" class="oculto">
 <div class="flex">
  <h2 class="grow">Panel de Administración</h2>
  <button id="salir" class="peligro">Cerrar sesión</button>
 </div>

 <div class="admin-tabs">
  <button data-tab="productos" class="activo">Productos</button>
  <button data-tab="secciones">Secciones especiales</button>
  <button data-tab="categorias">Categorías</button>
  <button data-tab="subcategorias">Subcategorías</button>
  <button data-tab="imagen">Logo</button>
 </div>

 <div id="tab-productos">
  <section>
   <h3>Agregar o editar producto</h3>

   <form id="formProducto">
    <input type="hidden" id="pId">

    <label>Nombre *
     <input id="pNombre" maxlength="160" required>
    </label>

    <label>Categoría *
     <select id="pCategoria" required></select>
    </label>

    <label>Subcategoría
     <select id="pSubcategoria"></select>
    </label>

    <label>Descripción
     <textarea id="pDescripcion" maxlength="1000"></textarea>
    </label>

    <label>Precio al detalle *
     <input id="pDetalle" type="number" min="0" required>
    </label>

    <label>Precio por mayor *
     <input id="pMayor" type="number" min="0" required>
    </label>

    <label>Mayor desde cuántas unidades *
     <input id="pMinimo" type="number" min="1" value="2" required>
    </label>

    <label>Stock *
     <input id="pStock" type="number" min="0" required>
    </label>

    <label>Fotografía del producto
     <input id="pFoto" type="file"
      accept="image/jpeg,image/png,image/webp">
    </label>

    <button type="button" id="subirProductoFoto">
     Subir fotografía
    </button>

    <p id="pFotoMensaje" class="muted"></p>

    <label>URL de la fotografía
     <input id="pImagen" type="url">
    </label>

    <img id="pVista"
     style="display:none;width:150px;max-height:160px;object-fit:contain"
     alt="Vista previa">

    <h3>Mostrar también en:</h3>

    <label>
     <input id="pDestacados" type="checkbox">
     Los más destacados
    </label>

    <label>
     <input id="pPack" type="checkbox">
     Pack Ahorro
    </label>

    <label>
     <input id="pOfertas" type="checkbox">
     Ofertas
    </label>

    <label>
     <input id="pBox" type="checkbox">
     Box Pyme
    </label>

    <label>
     <input id="pActivo" type="checkbox" checked>
     Producto visible en la tienda
    </label>

    <div class="flex" style="margin-top:15px">
     <button>Guardar producto</button>
     <button type="button" id="limpiarProducto"
      class="secundario">Limpiar</button>
    </div>
   </form>

   <p id="mensajeProducto"></p>
  </section>

  <section>
   <h3>Productos registrados</h3>
   <div id="listaProductos"></div>
  </section>
 </div>

 <div id="tab-secciones" class="oculto">
  <section>
   <h3>Fotografías de secciones especiales</h3>
   <p class="muted">
    Puedes cambiar la fotografía de cada sección.
    Los productos que aparecen se seleccionan
    desde la edición de cada producto.
   </p>
   <div id="listaSecciones"></div>
  </section>
 </div>

 <div id="tab-categorias" class="oculto">
  <section>
   <h3>Crear o editar categoría</h3>
   <form id="formCategoria">
    <input type="hidden" id="cId">

    <label>Nombre de categoría
     <input id="cNombre" maxlength="100" required>
    </label>

    <label>Fotografía
     <input id="cFoto" type="file"
      accept="image/jpeg,image/png,image/webp">
    </label>

    <button type="button" id="cSubir">
     Subir fotografía
    </button>

    <label>URL de fotografía
     <input id="cImagen" type="url">
    </label>

    <label>Orden de aparición
     <input id="cOrden" type="number" value="0">
    </label>

    <button>Guardar categoría</button>
    <button type="button" id="cLimpiar"
     class="secundario">Limpiar</button>
   </form>
   <p id="cMensaje"></p>
  </section>

  <section>
   <h3>Categorías existentes</h3>
   <div id="listaCategorias"></div>
  </section>
 </div>

 <div id="tab-subcategorias" class="oculto">
  <section>
   <h3>Crear o editar subcategoría</h3>
   <form id="formSubcategoria">
    <input type="hidden" id="sId">

    <label>Categoría principal
     <select id="sCategoria" required></select>
    </label>

    <label>Nombre de subcategoría
     <input id="sNombre" maxlength="100" required>
    </label>

    <label>Fotografía
     <input id="sFoto" type="file"
      accept="image/jpeg,image/png,image/webp">
    </label>

    <button type="button" id="sSubir">
     Subir fotografía
    </button>

    <label>URL de fotografía
     <input id="sImagen" type="url">
    </label>

    <label>Orden de aparición
     <input id="sOrden" type="number" value="0">
    </label>

    <button>Guardar subcategoría</button>
    <button type="button" id="sLimpiar"
     class="secundario">Limpiar</button>
   </form>
   <p id="sMensaje"></p>
  </section>

  <section>
   <h3>Subcategorías existentes</h3>
   <div id="listaSubcategorias"></div>
  </section>
 </div>

 <div id="tab-imagen" class="oculto">
  <section>
   <h3>Logo de Brusaam</h3>

   <p class="muted">
    Para evitar el fondo negro, sube aquí
    tu logo original en PNG con transparencia.
   </p>

   <img id="logoVista" style="max-width:180px"
    alt="Logo actual">

   <label>Seleccionar nuevo logo
    <input id="logoArchivo" type="file"
     accept="image/png,image/jpeg,image/webp">
   </label>

   <button id="logoSubir">Subir nuevo logo</button>

   <label>URL del logo
    <input id="logoURL" type="url">
   </label>

   <button id="logoGuardar">Guardar logo</button>
   <p id="logoMensaje"></p>
  </section>
 </div>
</div>

<script>
const $=id=>document.getElementById(id);

let datos={
 products:[],
 categories:[],
 subcategories:[],
 sections:[],
 logo:''
};

async function api(url,method='GET',body) {
 const opts={
  method,
  credentials:'same-origin'
 };

 if(body!==undefined) {
  opts.headers={'Content-Type':'application/json'};
  opts.body=JSON.stringify(body);
 }

 const r=await fetch(url,opts);
 const d=await r.json().catch(()=>({}));

 if(!r.ok) {
  throw Error(d.error||'No se pudo completar la operación');
 }

 return d;
}

function aviso(id,mensaje) {
 $(id).textContent=mensaje;
}

function opcion(select,texto,valor) {
 select.add(new Option(texto,valor));
}

function llenarCategorias() {
 const ids=['pCategoria','sCategoria'];

 for(const id of ids) {
  const sel=$(id);
  const anterior=sel.value;
  sel.replaceChildren();

  for(const c of datos.categories) {
   opcion(
    sel,c.name,
    id==='sCategoria'?String(c.id):c.name
   );
  }

  if([...sel.options].some(x=>x.value===anterior)) {
   sel.value=anterior;
  }
 }

 llenarSubcategorias();
}

function llenarSubcategorias(valor='') {
 const categoria=$('pCategoria').value;
 const c=datos.categories.find(x=>x.name===categoria);

 const sel=$('pSubcategoria');
 sel.replaceChildren(new Option('Sin subcategoría',''));

 if(c) {
  for(const sub of datos.subcategories.filter(
   s=>Number(s.category_id)===Number(c.id)
  )) {
   opcion(sel,sub.name,sub.name);
  }
 }

 if(valor&&!([...sel.options].some(x=>x.value===valor))) {
  opcion(sel,valor,valor);
 }

 sel.value=valor||'';
}

$('pCategoria').onchange=()=>llenarSubcategorias();

async function subirArchivo(inputId) {
 const file=$(inputId).files[0];

 if(!file) throw Error('Selecciona una fotografía.');

 if(file.size===0||file.size>5*1024*1024||
  !['image/jpeg','image/png','image/webp'].includes(file.type)) {
  throw Error('Usa JPG, PNG o WebP de máximo 5 MB.');
 }

 const form=new FormData();
 form.append('file',file);

 const r=await fetch('/api/admin/upload',{
  method:'POST',
  credentials:'same-origin',
  body:form
 });

 const d=await r.json().catch(()=>({}));

 if(!r.ok) throw Error(d.error||'Error al subir imagen');

 return d.url;
}

async function refrescar() {
 datos=await api('/api/admin/data');

 if(datos.logo) {
  $('logoVista').src=datos.logo;
  $('logoURL').value=datos.logo;
  $('logoTienda').src=datos.logo;
 }

 llenarCategorias();
 listarProductos();
 listarSecciones();
 listarCategorias();
 listarSubcategorias();
}

function filaAdministracion(titulo,imagen,editar,eliminar) {
 const row=document.createElement('div');
 row.className='admin-row flex';

 if(imagen&&imagen.startsWith('https://')) {
  const img=document.createElement('img');
  img.src=imagen;
  row.append(img);
 }

 const nombre=document.createElement('strong');
 nombre.className='grow';
 nombre.textContent=titulo;
 row.append(nombre);

 const boton=document.createElement('button');
 boton.textContent='Editar';
 boton.onclick=editar;
 row.append(boton);

 if(eliminar) {
  const quitar=document.createElement('button');
  quitar.className='peligro';
  quitar.textContent='Eliminar';
  quitar.onclick=eliminar;
  row.append(quitar);
 }

 return row;
}

function limpiarProducto() {
 $('formProducto').reset();
 $('pId').value='';
 $('pImagen').value='';
 $('pVista').style.display='none';
 $('pMinimo').value='2';
 $('pActivo').checked=true;
 llenarSubcategorias();
}

$('limpiarProducto').onclick=limpiarProducto;

function listarProductos() {
 const root=$('listaProductos');
 root.replaceChildren();

 for(const p of datos.products) {
  const editar=()=>{
   $('pId').value=p.id;
   $('pNombre').value=p.name||'';
   $('pDescripcion').value=p.description||'';
   $('pDetalle').value=p.retail;
   $('pMayor').value=p.wholesale;
   $('pMinimo').value=p.min_qty||2;
   $('pStock').value=p.stock;
   $('pImagen').value=p.image||'';

   const cat=$('pCategoria');

   if(![...cat.options].some(
    x=>x.value===p.category
   )) {
    opcion(cat,p.category,p.category);
   }

   cat.value=p.category;
   llenarSubcategorias(p.subcategory||'');

   $('pDestacados').checked=!!p.destacados;
   $('pPack').checked=!!p.pack_ahorro;
   $('pOfertas').checked=!!p.ofertas;
   $('pBox').checked=!!p.box_pyme;
   $('pActivo').checked=!!p.active;

   if(p.image) {
    $('pVista').src=p.image;
    $('pVista').style.display='block';
   } else {
    $('pVista').style.display='none';
   }

   document.querySelector(
    '[data-tab="productos"]'
   ).click();

   window.scrollTo({top:0,behavior:'smooth'});
  };

  const eliminar=async()=>{
   if(!confirm('¿Eliminar '+p.name+'?')) return;

   try {
    await api('/api/admin/products/'+p.id,'DELETE',{});
    await refrescar();
   } catch(e) {
    aviso('mensajeProducto',e.message);
   }
  };

  root.append(filaAdministracion(
   p.name+' | $'+p.retail+' | Stock: '+p.stock,
   p.image,editar,eliminar
  ));
 }
}

$('subirProductoFoto').onclick=async()=>{
 aviso('pFotoMensaje','Subiendo fotografía...');

 try {
  const url=await subirArchivo('pFoto');
  $('pImagen').value=url;
  $('pVista').src=url;
  $('pVista').style.display='block';
  aviso('pFotoMensaje',
   'Fotografía subida. Ahora guarda el producto.');
 } catch(e) {
  aviso('pFotoMensaje',e.message);
 }
};

$('formProducto').onsubmit=async e=>{
 e.preventDefault();

 const id=$('pId').value;

 const p={
  name:$('pNombre').value.trim(),
  category:$('pCategoria').value,
  subcategory:$('pSubcategoria').value,
  description:$('pDescripcion').value,
  retail:Number($('pDetalle').value),
  wholesale:Number($('pMayor').value),
  min_qty:Number($('pMinimo').value),
  stock:Number($('pStock').value),
  image:$('pImagen').value.trim(),
  active:$('pActivo').checked,
  destacados:$('pDestacados').checked,
  pack_ahorro:$('pPack').checked,
  ofertas:$('pOfertas').checked,
  box_pyme:$('pBox').checked
 };

 try {
  await api(
   '/api/admin/products'+(id?'/'+id:''),
   id?'PUT':'POST',
   p
  );

  limpiarProducto();
  await refrescar();
  aviso('mensajeProducto','Producto guardado correctamente.');
 } catch(error) {
  aviso('mensajeProducto',error.message);
 }
};

function listarSecciones() {
 const root=$('listaSecciones');
 root.replaceChildren();

 for(const sec of datos.sections) {
  const card=document.createElement('div');
  card.className='admin-row';

  card.append(
   Object.assign(document.createElement('h3'),{
    textContent:sec.title
   })
  );

  if(sec.image) {
   const img=document.createElement('img');
   img.src=sec.image;
   img.style.cssText=
    'width:170px;height:110px;object-fit:cover';
   card.append(img);
  }

  const input=document.createElement('input');
  input.type='file';
  input.accept='image/jpeg,image/png,image/webp';

  const url=document.createElement('input');
  url.type='url';
  url.placeholder='URL de la fotografía';
  url.value=sec.image||'';

  const subir=document.createElement('button');
  subir.textContent='Subir fotografía';

  subir.onclick=async()=>{
   try {
    if(!input.files[0]) {
     alert('Selecciona una fotografía.');
     return;
    }

    const form=new FormData();
    form.append('file',input.files[0]);

    const r=await fetch('/api/admin/upload',{
     method:'POST',body:form,
     credentials:'same-origin'
    });

    const d=await r.json();

    if(!r.ok) throw Error(d.error||'Error al subir');

    url.value=d.url;
    alert('Fotografía subida. Presiona Guardar.');
   } catch(e) {
    alert(e.message);
   }
  };

  const guardar=document.createElement('button');
  guardar.textContent='Guardar sección';

  guardar.onclick=async()=>{
   try {
    await api('/api/admin/sections/'+sec.slug,
     'PUT',{image:url.value.trim()});
    await refrescar();
    alert('Sección actualizada.');
   } catch(e) {
    alert(e.message);
   }
  };

  card.append(input,subir,url,guardar);
  root.append(card);
 }
}

function limpiarCategoria() {
 $('formCategoria').reset();
 $('cId').value='';
 $('cImagen').value='';
 $('cOrden').value='0';
}

$('cLimpiar').onclick=limpiarCategoria;

function listarCategorias() {
 const root=$('listaCategorias');
 root.replaceChildren();

 for(const c of datos.categories) {
  root.append(filaAdministracion(
   c.name,c.image,
   ()=>{
    $('cId').value=c.id;
    $('cNombre').value=c.name;
    $('cImagen').value=c.image||'';
    $('cOrden').value=c.position||0;
    window.scrollTo({top:0,behavior:'smooth'});
   },
   async()=>{
    if(!confirm(
     '¿Eliminar esta categoría y sus subcategorías?'
    )) return;

    try {
     await api('/api/admin/categories/'+c.id,
      'DELETE',{});
     await refrescar();
    } catch(e) {
     alert(e.message);
    }
   }
  ));
 }
}

$('cSubir').onclick=async()=>{
 try {
  $('cImagen').value=await subirArchivo('cFoto');
  aviso('cMensaje','Fotografía subida. Guarda la categoría.');
 } catch(e) {
  aviso('cMensaje',e.message);
 }
};

$('formCategoria').onsubmit=async e=>{
 e.preventDefault();

 const id=$('cId').value;

 try {
  await api(
   '/api/admin/categories'+(id?'/'+id:''),
   id?'PUT':'POST',
   {
    name:$('cNombre').value.trim(),
    image:$('cImagen').value.trim(),
    position:Number($('cOrden').value)
   }
  );

  limpiarCategoria();
  await refrescar();
  aviso('cMensaje','Categoría guardada.');
 } catch(error) {
  aviso('cMensaje',error.message);
 }
};

function limpiarSubcategoria() {
 $('formSubcategoria').reset();
 $('sId').value='';
 $('sImagen').value='';
 $('sOrden').value='0';
}

$('sLimpiar').onclick=limpiarSubcategoria;

function listarSubcategorias() {
 const root=$('listaSubcategorias');
 root.replaceChildren();

 for(const s of datos.subcategories) {
  const c=datos.categories.find(
   x=>Number(x.id)===Number(s.category_id)
  );

  root.append(filaAdministracion(
   (c?.name||'Categoría')+' › '+s.name,
   s.image,
   ()=>{
    $('sId').value=s.id;
    $('sCategoria').value=String(s.category_id);
    $('sNombre').value=s.name;
    $('sImagen').value=s.image||'';
    $('sOrden').value=s.position||0;
    window.scrollTo({top:0,behavior:'smooth'});
   },
   async()=>{
    if(!confirm('¿Eliminar subcategoría?')) return;

    try {
     await api('/api/admin/subcategories/'+s.id,
      'DELETE',{});
     await refrescar();
    } catch(e) {
     alert(e.message);
    }
   }
  ));
 }
}

$('sSubir').onclick=async()=>{
 try {
  $('sImagen').value=await subirArchivo('sFoto');
  aviso('sMensaje',
   'Fotografía subida. Guarda la subcategoría.');
 } catch(e) {
  aviso('sMensaje',e.message);
 }
};

$('formSubcategoria').onsubmit=async e=>{
 e.preventDefault();

 const id=$('sId').value;

 try {
  await api(
   '/api/admin/subcategories'+(id?'/'+id:''),
   id?'PUT':'POST',
   {
    category_id:Number($('sCategoria').value),
    name:$('sNombre').value.trim(),
    image:$('sImagen').value.trim(),
    position:Number($('sOrden').value)
   }
  );

  limpiarSubcategoria();
  await refrescar();
  aviso('sMensaje','Subcategoría guardada.');
 } catch(error) {
  aviso('sMensaje',error.message);
 }
};

$('logoSubir').onclick=async()=>{
 try {
  const url=await subirArchivo('logoArchivo');
  $('logoURL').value=url;
  $('logoVista').src=url;
  aviso('logoMensaje',
   'Logo subido. Presiona Guardar logo.');
 } catch(e) {
  aviso('logoMensaje',e.message);
 }
};

$('logoGuardar').onclick=async()=>{
 try {
  await api('/api/admin/logo','PUT',{
   image:$('logoURL').value.trim()
  });

  await refrescar();
  aviso('logoMensaje','Logo actualizado.');
 } catch(e) {
  aviso('logoMensaje',e.message);
 }
};

document.querySelectorAll('[data-tab]').forEach(btn=>{
 btn.onclick=()=>{
  document.querySelectorAll('[data-tab]')
   .forEach(x=>x.classList.remove('activo'));

  btn.classList.add('activo');

  for(const nombre of [
   'productos','secciones','categorias',
   'subcategorias','imagen'
  ]) {
   $('tab-'+nombre).classList.toggle(
    'oculto',nombre!==btn.dataset.tab
   );
  }
 };
});

$('loginForm').onsubmit=async e=>{
 e.preventDefault();

 try {
  await api('/api/admin/login','POST',{
   password:$('password').value
  });

  $('password').value='';
  aviso('loginMensaje','');
  await iniciar();
 } catch(error) {
  aviso('loginMensaje',error.message);
 }
};

$('salir').onclick=async()=>{
 await api('/api/admin/logout','POST',{});
 await iniciar();
};

async function iniciar() {
 try {
  const r=await api('/api/admin/session');

  $('login').classList.toggle(
   'oculto',r.authenticated
  );

  $('panel').classList.toggle(
   'oculto',!r.authenticated
  );

  if(r.authenticated) await refrescar();
 } catch(e) {
  aviso('loginMensaje',e.message);
 }
}

iniciar();
</script>`;

/* =========================================
   VALIDACIONES
========================================= */

function productoValido(p) {
  return p &&
    typeof p.name === "string" &&
    p.name.trim().length > 0 &&
    p.name.length <= 160 &&
    typeof p.category === "string" &&
    p.category.length <= 100 &&
    typeof p.subcategory === "string" &&
    p.subcategory.length <= 100 &&
    typeof p.description === "string" &&
    p.description.length <= 1000 &&
    Number.isSafeInteger(p.retail) &&
    p.retail >= 0 &&
    Number.isSafeInteger(p.wholesale) &&
    p.wholesale >= 0 &&
    Number.isSafeInteger(p.min_qty) &&
    p.min_qty >= 1 &&
    Number.isSafeInteger(p.stock) &&
    p.stock >= 0 &&
    esImagen(p.image);
}

function nombreValido(p) {
  return p &&
    typeof p.name === "string" &&
    p.name.trim().length > 0 &&
    p.name.length <= 100 &&
    esImagen(p.image) &&
    Number.isSafeInteger(p.position);
}

async function firmaCloudinary(params, secreto) {
  const cadena = Object.keys(params)
    .sort()
    .map(k => k + "=" + params[k])
    .join("&") + secreto;

  const hash = await crypto.subtle.digest(
    "SHA-1",
    encoder.encode(cadena)
  );

  return [...new Uint8Array(hash)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

async function subirImagen(request, env) {
  if (!env.CLOUDINARY_API_KEY ||
      !env.CLOUDINARY_API_SECRET) {
    return respuesta({
      error: "Faltan claves de Cloudinary"
    }, 503);
  }

  const longitud = Number(
    request.headers.get("Content-Length") || 0
  );

  if (longitud > 6 * 1024 * 1024) {
    return respuesta({
      error: "Archivo demasiado grande"
    }, 413);
  }

  const tipo = request.headers.get("Content-Type") || "";

  if (!tipo.toLowerCase().startsWith(
    "multipart/form-data;"
  )) {
    return respuesta({
      error: "Formato no permitido"
    }, 400);
  }

  const form = await request.formData().catch(() => null);
  const archivo = form?.get("file");

  if (!(archivo instanceof File) ||
      archivo.size === 0 ||
      archivo.size > 5 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"]
        .includes(archivo.type)) {
    return respuesta({
      error: "Usa JPG, PNG o WebP de máximo 5 MB"
    }, 400);
  }

  const bytes = new Uint8Array(
    await archivo.slice(0, 12).arrayBuffer()
  );

  const jpeg =
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255;

  const png =
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10;

  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";

  if (!(
    (archivo.type === "image/jpeg" && jpeg) ||
    (archivo.type === "image/png" && png) ||
    (archivo.type === "image/webp" && webp)
  )) {
    return respuesta({
      error: "El contenido no corresponde a una imagen válida"
    }, 400);
  }

  const params = {
    folder: "brusaam-productos",
    timestamp: String(Math.floor(Date.now() / 1000))
  };

  const signature = await firmaCloudinary(
    params,
    env.CLOUDINARY_API_SECRET
  );

  const body = new FormData();

  body.append("file", archivo, archivo.name);
  body.append("folder", params.folder);
  body.append("timestamp", params.timestamp);
  body.append("api_key", env.CLOUDINARY_API_KEY);
  body.append("signature", signature);

  const r = await fetch(
    "https://api.cloudinary.com/v1_1/" +
    CLOUD_NAME + "/image/upload",
    { method: "POST", body }
  );

  const data = await r.json().catch(() => null);

  if (!r.ok ||
      !data?.secure_url ||
      !data.secure_url.startsWith(
        "https://res.cloudinary.com/" + CLOUD_NAME + "/"
      )) {
    return respuesta({
      error: "Cloudinary rechazó la fotografía"
    }, 502);
  }

  return respuesta({ url: data.secure_url });
}

/* =========================================
   RUTAS DEL WORKER
========================================= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === "/" && method === "GET") {
        return pagina(tienda);
      }

      if (path === "/admin" && method === "GET") {
        return pagina(admin);
      }

      if (path === "/api/admin/session" &&
          method === "GET") {
        return respuesta({
          authenticated: await autorizado(request, env)
        });
      }

      if (path === "/api/tienda" &&
          method === "GET") {
        await inicializar(env);
        return respuesta(await datosTienda(env));
      }

      if (path === "/api/productos" &&
          method === "GET") {
        await inicializar(env);

        const r = await env.DB.prepare(`
          SELECT id,name,category,subcategory,
          description,retail,wholesale,min_qty,
          stock,image,destacados,pack_ahorro,
          ofertas,box_pyme
          FROM products
          WHERE active=1
          ORDER BY name
        `).all();

        return respuesta(r.results || []);
      }

      if (!path.startsWith("/api/admin/")) {
        return respuesta({
          error: "Ruta no encontrada"
        }, 404);
      }

      if (!env.DB ||
          !env.ADMIN_PASSWORD ||
          !env.SESSION_SECRET) {
        return respuesta({
          error: "Falta configuración del administrador"
        }, 503);
      }

      if (method !== "GET" && !origenValido(request)) {
        return respuesta({
          error: "Origen no permitido"
        }, 403);
      }

      if (path === "/api/admin/login" &&
          method === "POST") {
        await inicializar(env);

        const ip =
          request.headers.get("CF-Connecting-IP") ||
          "unknown";

        const estado = await env.DB.prepare(`
          SELECT failures,until_ms
          FROM login_attempts WHERE ip=?
        `).bind(ip).first() || {
          failures: 0,
          until_ms: 0
        };

        if (estado.failures >= 5 &&
            estado.until_ms > Date.now()) {
          return respuesta({
            error: "Demasiados intentos. Espera 15 minutos."
          }, 429);
        }

        const body = await request.json()
          .catch(() => ({}));

        const ingresada =
          typeof body.password === "string"
            ? body.password
            : "";

        const a = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256", encoder.encode(ingresada)
          )
        );

        const b = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            encoder.encode(env.ADMIN_PASSWORD)
          )
        );

        let diferencia = 0;

        for (let i = 0; i < a.length; i++) {
          diferencia |= a[i] ^ b[i];
        }

        if (diferencia !== 0) {
          const intentos =
            estado.until_ms < Date.now()
              ? 1
              : estado.failures + 1;

          await env.DB.prepare(`
            INSERT INTO login_attempts
            (ip,failures,until_ms)
            VALUES(?,?,?)
            ON CONFLICT(ip)
            DO UPDATE SET
             failures=excluded.failures,
             until_ms=excluded.until_ms
          `).bind(
            ip, intentos,
            Date.now() + 15 * 60 * 1000
          ).run();

          return respuesta({
            error: "Contraseña incorrecta"
          }, 401);
        }

        await env.DB.prepare(`
          DELETE FROM login_attempts WHERE ip=?
        `).bind(ip).run();

        const vence = String(
          Date.now() + 8 * 60 * 60 * 1000
        );

        const firma = await firmar(
          vence, env.SESSION_SECRET
        );

        return respuesta({ ok: true }, 200, {
          "Set-Cookie":
            COOKIE + "=" + vence + "." + firma +
            "; HttpOnly; Secure; SameSite=Strict;" +
            " Path=/; Max-Age=28800"
        });
      }

      if (path === "/api/admin/logout" &&
          method === "POST") {
        return respuesta({ ok: true }, 200, {
          "Set-Cookie":
            COOKIE + "=; HttpOnly; Secure;" +
            " SameSite=Strict; Path=/; Max-Age=0"
        });
      }

      if (!await autorizado(request, env)) {
        return respuesta({
          error: "Inicia sesión"
        }, 401);
      }

      if (path === "/api/admin/upload" &&
          method === "POST") {
        return subirImagen(request, env);
      }

      await inicializar(env);

      if (path === "/api/admin/data" &&
          method === "GET") {
        const publico = await datosTienda(env);

        const r = await env.DB.prepare(`
          SELECT * FROM products ORDER BY id DESC
        `).all();

        return respuesta({
          ...publico,
          products: r.results || []
        });
      }

      const productoId = path.match(
        /^\/api\/admin\/products\/(\d+)$/
      );

      if (path === "/api/admin/products" &&
          method === "POST") {
        const p = await request.json()
          .catch(() => null);

        if (!productoValido(p)) {
          return respuesta({
            error: "Revisa los datos del producto"
          }, 400);
        }

        const r = await env.DB.prepare(`
          INSERT INTO products
          (
           name,category,subcategory,description,
           retail,wholesale,min_qty,stock,image,
           active,destacados,pack_ahorro,ofertas,box_pyme
          )
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          p.name.trim(),
          p.category,
          p.subcategory,
          p.description,
          p.retail,
          p.wholesale,
          p.min_qty,
          p.stock,
          p.image,
          p.active ? 1 : 0,
          p.destacados ? 1 : 0,
          p.pack_ahorro ? 1 : 0,
          p.ofertas ? 1 : 0,
          p.box_pyme ? 1 : 0
        ).run();

        return respuesta({
          ok: true,
          id: r.meta.last_row_id
        });
      }

      if (productoId && method === "PUT") {
        const p = await request.json()
          .catch(() => null);

        if (!productoValido(p)) {
          return respuesta({
            error: "Revisa los datos del producto"
          }, 400);
        }

        await env.DB.prepare(`
          UPDATE products SET
           name=?,category=?,subcategory=?,
           description=?,retail=?,wholesale=?,
           min_qty=?,stock=?,image=?,active=?,
           destacados=?,pack_ahorro=?,ofertas=?,box_pyme=?
          WHERE id=?
        `).bind(
          p.name.trim(),
          p.category,
          p.subcategory,
          p.description,
          p.retail,
          p.wholesale,
          p.min_qty,
          p.stock,
          p.image,
          p.active ? 1 : 0,
          p.destacados ? 1 : 0,
          p.pack_ahorro ? 1 : 0,
          p.ofertas ? 1 : 0,
          p.box_pyme ? 1 : 0,
          Number(productoId[1])
        ).run();

        return respuesta({ ok: true });
      }

      if (productoId && method === "DELETE") {
        await env.DB.prepare(`
          DELETE FROM products WHERE id=?
        `).bind(Number(productoId[1])).run();

        return respuesta({ ok: true });
      }

      const seccion = path.match(
        /^\/api\/admin\/sections\/([a-z_]+)$/
      );

      if (seccion && method === "PUT") {
        const slug = seccion[1];

        if (!SECCIONES.some(s => s[0] === slug)) {
          return respuesta({
            error: "Sección no válida"
          }, 400);
        }

        const p = await request.json()
          .catch(() => null);

        if (!p ||
            typeof p.image !== "string" ||
            !esImagen(p.image)) {
          return respuesta({
            error: "Imagen no válida"
          }, 400);
        }

        await env.DB.prepare(`
          UPDATE shop_sections SET image=?
          WHERE slug=?
        `).bind(p.image, slug).run();

        return respuesta({ ok: true });
      }

      if (path === "/api/admin/logo" &&
          method === "PUT") {
        const p = await request.json()
          .catch(() => null);

        if (!p ||
            typeof p.image !== "string" ||
            !p.image.startsWith("https://") ||
            !esImagen(p.image)) {
          return respuesta({
            error: "URL del logo no válida"
          }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO shop_settings(key,value)
          VALUES('logo',?)
          ON CONFLICT(key)
          DO UPDATE SET value=excluded.value
        `).bind(p.image).run();

        return respuesta({ ok: true });
      }

      const categoriaId = path.match(
        /^\/api\/admin\/categories\/(\d+)$/
      );

      if (path === "/api/admin/categories" &&
          method === "POST") {
        const p = await request.json()
          .catch(() => null);

        if (!nombreValido(p)) {
          return respuesta({
            error: "Datos de categoría inválidos"
          }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO shop_categories
          (name,image,position)
          VALUES(?,?,?)
        `).bind(
          p.name.trim(),p.image,p.position
        ).run();

        return respuesta({ ok: true });
      }

      if (categoriaId && method === "PUT") {
        const p = await request.json()
          .catch(() => null);

        if (!nombreValido(p)) {
          return respuesta({
            error: "Datos de categoría inválidos"
          }, 400);
        }

        const id = Number(categoriaId[1]);

        const anterior = await env.DB.prepare(`
          SELECT name FROM shop_categories WHERE id=?
        `).bind(id).first();

        if (!anterior) {
          return respuesta({
            error: "Categoría no encontrada"
          }, 404);
        }

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE shop_categories
            SET name=?,image=?,position=?
            WHERE id=?
          `).bind(
            p.name.trim(),p.image,p.position,id
          ),

          env.DB.prepare(`
            UPDATE products SET category=?
            WHERE category=?
          `).bind(p.name.trim(),anterior.name)
        ]);

        return respuesta({ ok: true });
      }

      if (categoriaId && method === "DELETE") {
        const id = Number(categoriaId[1]);

        const actual = await env.DB.prepare(`
          SELECT name FROM shop_categories WHERE id=?
        `).bind(id).first();

        if (!actual) {
          return respuesta({
            error: "Categoría no encontrada"
          }, 404);
        }

        const uso = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM products WHERE category=?
        `).bind(actual.name).first();

        if (uso.total > 0) {
          return respuesta({
            error:
              "Esta categoría tiene productos. " +
              "Cámbialos de categoría antes de eliminarla."
          }, 409);
        }

        await env.DB.batch([
          env.DB.prepare(`
            DELETE FROM shop_subcategories
            WHERE category_id=?
          `).bind(id),

          env.DB.prepare(`
            DELETE FROM shop_categories WHERE id=?
          `).bind(id)
        ]);

        return respuesta({ ok: true });
      }

      const subId = path.match(
        /^\/api\/admin\/subcategories\/(\d+)$/
      );

      if (path === "/api/admin/subcategories" &&
          method === "POST") {
        const p = await request.json()
          .catch(() => null);

        if (!nombreValido(p) ||
            !Number.isSafeInteger(p.category_id) ||
            p.category_id < 1) {
          return respuesta({
            error: "Datos de subcategoría inválidos"
          }, 400);
        }

        const c = await env.DB.prepare(`
          SELECT id FROM shop_categories WHERE id=?
        `).bind(p.category_id).first();

        if (!c) {
          return respuesta({
            error: "Categoría principal no encontrada"
          }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO shop_subcategories
          (category_id,name,image,position)
          VALUES(?,?,?,?)
        `).bind(
          p.category_id,
          p.name.trim(),
          p.image,
          p.position
        ).run();

        return respuesta({ ok: true });
      }

      if (subId && method === "PUT") {
        const p = await request.json()
          .catch(() => null);

        if (!nombreValido(p) ||
            !Number.isSafeInteger(p.category_id) ||
            p.category_id < 1) {
          return respuesta({
            error: "Datos de subcategoría inválidos"
          }, 400);
        }

        const id = Number(subId[1]);

        const anterior = await env.DB.prepare(`
          SELECT s.name,c.name AS category
          FROM shop_subcategories s
          JOIN shop_categories c ON c.id=s.category_id
          WHERE s.id=?
        `).bind(id).first();

        const nuevaCategoria = await env.DB.prepare(`
          SELECT name FROM shop_categories WHERE id=?
        `).bind(p.category_id).first();

        if (!anterior || !nuevaCategoria) {
          return respuesta({
            error: "Categoría o subcategoría no encontrada"
          }, 404);
        }

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE shop_subcategories
            SET category_id=?,name=?,image=?,position=?
            WHERE id=?
          `).bind(
            p.category_id,
            p.name.trim(),
            p.image,
            p.position,
            id
          ),

          env.DB.prepare(`
            UPDATE products
            SET category=?,subcategory=?
            WHERE category=? AND subcategory=?
          `).bind(
            nuevaCategoria.name,
            p.name.trim(),
            anterior.category,
            anterior.name
          )
        ]);

        return respuesta({ ok: true });
      }

      if (subId && method === "DELETE") {
        const id = Number(subId[1]);

        const sub = await env.DB.prepare(`
          SELECT s.name,c.name AS category
          FROM shop_subcategories s
          JOIN shop_categories c ON c.id=s.category_id
          WHERE s.id=?
        `).bind(id).first();

        if (!sub) {
          return respuesta({
            error: "Subcategoría no encontrada"
          }, 404);
        }

        const uso = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM products
          WHERE category=? AND subcategory=?
        `).bind(sub.category,sub.name).first();

        if (uso.total > 0) {
          return respuesta({
            error:
              "Esta subcategoría tiene productos. " +
              "Cámbialos antes de eliminarla."
          }, 409);
        }

        await env.DB.prepare(`
          DELETE FROM shop_subcategories WHERE id=?
        `).bind(id).run();

        return respuesta({ ok: true });
      }

      return respuesta({
        error: "Ruta no encontrada"
      }, 404);

    } catch (error) {
      console.error("BRUSAAM:", error);

      if (String(error.message).includes(
        "UNIQUE constraint failed"
      )) {
        return respuesta({
          error: "Ya existe un registro con ese nombre"
        }, 409);
      }

      return respuesta({
        error: "Error interno. Revisa los registros de Cloudflare."
      }, 500);
    }
  }
};
