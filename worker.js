
/*
 BRUSAAM - TIENDA ONLINE
 Cloudflare Workers + D1 + Cloudinary

 Incluye:
 - Categorías y subcategorías con imágenes
 - Destacados, Pack Ahorro, Ofertas y Box Pyme
 - Papel higiénico por paquete o manga
 - Despacho La Serena $2.000 / Coquimbo $1.500
 - Retiro gratis
 - Despacho local gratis desde $30.000
 - WhatsApp, Instagram y TikTok
 - Diseño de Canva configurable
 - Administración privada

 Conserva el binding D1: DB
 Conserva los secretos:
 ADMIN_PASSWORD
 SESSION_SECRET
 CLOUDINARY_API_KEY
 CLOUDINARY_API_SECRET
*/

const CONFIG = {
  cloud: "oobzcqc2",
  whatsapp: "56966282007",
  instagram: "https://www.instagram.com/comercializadora_brusaam/",
  tiktok: "https://www.tiktok.com/@com_brusaam",
  logo: "https://res.cloudinary.com/oobzcqc2/image/upload/IMG_20260517_093131_502.webp",
  cookie: "brusaam_session"
};

const SECTIONS = [
  ["destacados", "Los más destacados", "⭐"],
  ["pack_ahorro", "Pack Ahorro", "📦"],
  ["ofertas", "Ofertas", "🏷️"],
  ["box_pyme", "Box Pyme", "🏪"]
];

const DEFAULT_CATEGORIES = {
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
    "Pañuelos y otros"
  ],
  "Otros productos": [
    "Insecticidas",
    "Limpieza automotriz",
    "Bolsas de basura",
    "Accesorios de limpieza",
    "Otros"
  ]
};

const enc = new TextEncoder();

function json(data, status = 200, extra = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra
    }
  });
}

function validImage(value) {
  return typeof value === "string" &&
    value.length <= 1500 &&
    (
      value === "" ||
      /^https:\/\/[^\s"'<>]+$/i.test(value)
    );
}

function integer(n, min = 0) {
  return Number.isSafeInteger(n) && n >= min;
}

function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function signature(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return b64(new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(message)
    )
  ));
}

function getCookie(request) {
  const cookies = request.headers.get("Cookie") || "";
  const item = cookies
    .split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(CONFIG.cookie + "="));

  return item ? item.slice(CONFIG.cookie.length + 1) : "";
}

async function authenticated(request, env) {
  if (!env.SESSION_SECRET) return false;

  const parts = getCookie(request).split(".");
  if (parts.length !== 2) return false;

  const [expires, received] = parts;

  if (!/^\d{13}$/.test(expires) ||
      Number(expires) <= Date.now()) {
    return false;
  }

  const expected = await signature(
    expires,
    env.SESSION_SECRET
  );

  if (expected.length !== received.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^
      received.charCodeAt(i);
  }

  return diff === 0;
}

function sameOrigin(request) {
  return request.headers.get("Origin") ===
    new URL(request.url).origin;
}

/* BASE DE DATOS */

async function setup(env) {
  if (!env.DB) throw Error("Falta el binding DB");

  const info = await env.DB.prepare(
    "PRAGMA table_info(products)"
  ).all();

  if (!info.results?.length) {
    throw Error("No existe la tabla products en D1");
  }

  const columns = new Set(
    info.results.map(x => x.name)
  );

  const additions = [
    ["subcategory", "TEXT NOT NULL DEFAULT ''"],
    ["destacados", "INTEGER NOT NULL DEFAULT 0"],
    ["pack_ahorro", "INTEGER NOT NULL DEFAULT 0"],
    ["ofertas", "INTEGER NOT NULL DEFAULT 0"],
    ["box_pyme", "INTEGER NOT NULL DEFAULT 0"],
    ["manga_price", "INTEGER NOT NULL DEFAULT 0"],
    ["packs_per_manga", "INTEGER NOT NULL DEFAULT 0"]
  ];

  for (const [name, type] of additions) {
    if (!columns.has(name)) {
      try {
        await env.DB.prepare(
          `ALTER TABLE products ADD COLUMN ${name} ${type}`
        ).run();
      } catch (e) {
        if (!String(e.message).includes(
          "duplicate column"
        )) throw e;
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
      UNIQUE(category_id, name)
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

  for (const [slug, title] of SECTIONS) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO shop_sections
      (slug,title,image) VALUES(?,?,'')
    `).bind(slug, title).run();
  }

  for (const [key, value] of [
    ["logo", CONFIG.logo],
    ["design", ""]
  ]) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO shop_settings
      (key,value) VALUES(?,?)
    `).bind(key, value).run();
  }

  let order = 0;

  for (const [name, subs] of
    Object.entries(DEFAULT_CATEGORIES)) {

    await env.DB.prepare(`
      INSERT OR IGNORE INTO shop_categories
      (name,position) VALUES(?,?)
    `).bind(name, order++).run();

    const cat = await env.DB.prepare(`
      SELECT id FROM shop_categories WHERE name=?
    `).bind(name).first();

    let subOrder = 0;

    for (const sub of subs) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO shop_subcategories
        (category_id,name,position)
        VALUES(?,?,?)
      `).bind(cat.id, sub, subOrder++).run();
    }
  }
}

async function shopData(env, admin = false) {
  const [p, c, s, sections, settings] =
    await Promise.all([
      env.DB.prepare(admin
        ? "SELECT * FROM products ORDER BY id DESC"
        : `SELECT id,name,category,subcategory,
           description,retail,wholesale,min_qty,
           stock,image,destacados,pack_ahorro,
           ofertas,box_pyme,manga_price,
           packs_per_manga
           FROM products
           WHERE active=1 ORDER BY name`
      ).all(),

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
        SELECT key,value FROM shop_settings
      `).all()
    ]);

  const options = Object.fromEntries(
    (settings.results || [])
      .map(x => [x.key, x.value])
  );

  return {
    products: p.results || [],
    categories: c.results || [],
    subcategories: s.results || [],
    sections: sections.results || [],
    logo: options.logo || CONFIG.logo,
    design: options.design || ""
  };
}

/* DISEÑO GENERAL */

function page(body) {
  return new Response(`<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport"
 content="width=device-width,initial-scale=1">
<title>Brusaam | La excelencia en tu hogar</title>
<style>
:root{
 --purple:#6524AD;
 --blue:#078ED5;
 --navy:#14234B;
 --bg:#F4F7FC;
 --border:#DFE5EF;
}
*{box-sizing:border-box}
body{
 margin:0;
 font-family:Arial,Helvetica,sans-serif;
 background:var(--bg);
 color:var(--navy);
}
header{
 background:white;
 text-align:center;
 padding:12px 12px 20px;
}
#topDesign,#bottomDesign{
 height:90px;
 background-position:center;
 background-size:cover;
 background-repeat:no-repeat;
}
#topDesign:empty,#bottomDesign:empty{
 display:none;
}
.logo{
 display:block;
 margin:12px auto 5px;
 max-width:190px;
 width:55%;
 height:auto;
 object-fit:contain;
}
.slogan{font-size:13px;color:#64748b}
.banner{
 max-width:650px;
 margin:17px auto 0;
 padding:16px;
 border-radius:14px;
 background:linear-gradient(110deg,#F0E7FC,#E4F3FC);
}
.banner strong{
 display:block;
 font-size:23px;
 color:var(--purple);
 margin:6px 0;
}
main{
 max-width:1150px;
 margin:auto;
 padding:14px;
}
h1,h2,h3{color:var(--navy)}
h2{font-size:21px}
section,.panel{
 background:white;
 padding:17px;
 margin:15px 0;
 border-radius:14px;
 box-shadow:0 2px 10px #14234B0d;
}
button{
 border:0;
 border-radius:9px;
 padding:10px 13px;
 background:var(--purple);
 color:white;
 font-weight:700;
 cursor:pointer;
}
button:disabled{opacity:.45;cursor:not-allowed}
button.secondary{
 background:#ECE4F7;
 color:var(--purple);
}
button.danger{background:#AE3854}
button.small{padding:6px 10px}
input,select,textarea{
 width:100%;
 padding:11px;
 border:1px solid #CBD4E2;
 border-radius:9px;
 margin:6px 0 12px;
 font:inherit;
 background:white;
}
input[type=checkbox],input[type=radio]{
 width:auto;
 margin:4px 7px 4px 0;
}
label{display:block;font-weight:600}
a{color:var(--purple)}
.muted{font-size:13px;color:#64748b}
.hidden{display:none!important}
.flex{
 display:flex;
 align-items:center;
 gap:10px;
 flex-wrap:wrap;
}
.grow{flex:1}
.tiles{
 display:grid;
 grid-template-columns:repeat(4,minmax(0,1fr));
 gap:12px;
}
.tile{
 border:1px solid var(--border);
 background:white;
 border-radius:13px;
 overflow:hidden;
 color:var(--navy);
 text-align:left;
 padding:0;
}
.tile img{
 display:block;
 width:100%;
 height:140px;
 object-fit:cover;
}
.tile .placeholder{
 display:grid;
 place-items:center;
 height:140px;
 background:linear-gradient(130deg,#EFE7FC,#E6F4FC);
 font-size:38px;
}
.tile strong{
 display:block;
 padding:12px;
}
.grid{
 display:grid;
 grid-template-columns:repeat(auto-fill,minmax(190px,1fr));
 gap:12px;
}
.product{
 border:1px solid var(--border);
 border-radius:12px;
 background:white;
 padding:12px;
 display:flex;
 flex-direction:column;
 gap:8px;
}
.product img{
 width:100%;
 height:175px;
 object-fit:contain;
}
.product h3{font-size:15px;margin:2px 0}
.price{
 font-size:20px;
 color:var(--blue);
 font-weight:800;
}
.search{position:relative}
.search input{
 padding-left:40px;
 font-size:16px;
}
.search span{
 position:absolute;
 left:13px;
 top:15px;
 font-size:22px;
 color:var(--purple);
}
.filters{
 display:grid;
 grid-template-columns:1fr 1fr;
 gap:12px;
}
.cartrow{
 display:flex;
 gap:12px;
 padding:13px 0;
 border-bottom:1px solid var(--border);
 align-items:center;
}
.cartrow img{
 width:75px;
 height:75px;
 object-fit:contain;
}
.cartinfo{flex:1;min-width:0}
.summary{
 display:flex;
 justify-content:space-between;
 gap:12px;
 padding:10px 0;
}
.summary.total{
 border-top:1px solid var(--border);
 font-size:20px;
 font-weight:bold;
}
table{width:100%;border-collapse:collapse}
th,td{
 padding:10px;
 border-bottom:1px solid var(--border);
 text-align:left;
}
th{background:#F1EBFA}
.scroll{overflow-x:auto}
.notice{
 background:#F0E9FB;
 border-radius:9px;
 padding:12px;
}
.adminTabs{
 display:flex;
 flex-wrap:wrap;
 gap:7px;
 margin:15px 0;
}
.adminTabs button{
 background:#EDE5F7;
 color:var(--purple);
}
.adminTabs button.active{
 background:var(--purple);
 color:white;
}
.adminRow{
 border-bottom:1px solid var(--border);
 padding:12px 0;
}
.adminRow img{
 width:65px;
 height:65px;
 object-fit:contain;
}
footer{
 background:white;
 margin-top:25px;
 text-align:center;
}
.footerContent{padding:22px}
.social{
 display:flex;
 justify-content:center;
 gap:10px;
 flex-wrap:wrap;
}
.social a{
 text-decoration:none;
 background:#F0E9FB;
 border-radius:10px;
 padding:12px;
 font-weight:bold;
}
@media(max-width:700px){
 main{padding:10px}
 .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
 .tile img,.tile .placeholder{height:115px}
 .grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
 .product{padding:9px}
 .product img{height:125px}
 .product h3{font-size:14px}
 .price{font-size:18px}
 .filters{grid-template-columns:1fr}
 #topDesign,#bottomDesign{height:65px}
}
</style>
</head>
<body>
<div id="topDesign"></div>
<header>
<img class="logo" id="shopLogo"
 src="${CONFIG.logo}" alt="Brusaam">
<div class="slogan">La excelencia en tu hogar</div>
<div class="banner">
 <div>🚚 BENEFICIO ESPECIAL</div>
 <strong>¡Despacho GRATIS!</strong>
 <div>Coquimbo y La Serena</div>
 <div style="margin-top:6px;color:#6524AD">
  En compras desde $30.000
 </div>
</div>
</header>
<main>${body}</main>
<footer>
<div id="bottomDesign"></div>
<div class="footerContent">
<h3>Brusaam</h3>
<p>¡Síguenos y contáctanos!</p>
<div class="social">
<a href="https://wa.me/56966282007"
 target="_blank" rel="noopener noreferrer">
 💬 WhatsApp
</a>
<a href="${CONFIG.instagram}"
 target="_blank" rel="noopener noreferrer">
 📸 Instagram
</a>
<a href="${CONFIG.tiktok}"
 target="_blank" rel="noopener noreferrer">
 🎵 TikTok
</a>
</div>
<p class="muted">
 WhatsApp +56 9 6628 2007
</p>
<p class="muted">
 Instagram @comercializadora_brusaam
 · TikTok @com_brusaam
</p>
</div>
</footer>
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

/* TIENDA */

const SHOP_HTML = String.raw`
<h2>Bienvenido a Brusaam</h2>

<div class="search">
 <span>⌕</span>
 <input id="search"
  placeholder="Buscar productos, marcas o categorías...">
</div>

<div id="home">
 <h2>Nuestras categorías</h2>
 <div id="categoryTiles" class="tiles"></div>

 <h2>Secciones especiales</h2>
 <div id="sectionTiles" class="tiles"></div>

 <div id="featuredAreas"></div>
</div>

<section id="catalogSection">
 <div class="flex">
  <h2 class="grow" id="catalogTitle">Todos los productos</h2>
  <button class="secondary" id="backHome">
   Inicio
  </button>
 </div>

 <div id="subTiles" class="tiles"
  style="margin-bottom:15px"></div>

 <div class="filters">
  <label>Categoría
   <select id="filterCategory"></select>
  </label>
  <label>Subcategoría
   <select id="filterSub"></select>
  </label>
 </div>

 <p class="muted" id="count"></p>
 <div id="products" class="grid"></div>
</section>

<section>
 <h2>🛒 Mi carrito</h2>
 <div id="cartItems"></div>

 <div class="summary">
  <span>Subtotal productos</span>
  <strong id="subtotal">$0</strong>
 </div>

 <div class="summary">
  <span>Despacho</span>
  <strong id="shipping">Despacho por calcular</strong>
 </div>

 <div class="summary total">
  <span id="totalLabel">Total productos</span>
  <span id="total">$0</span>
 </div>
</section>

<section>
 <h3>Condiciones y tarifas de despacho</h3>
 <div class="scroll">
 <table>
 <thead>
 <tr><th>Modalidad o zona</th><th>Tarifa</th></tr>
 </thead>
 <tbody>
 <tr><td>Retiro</td><td><strong>Gratis</strong></td></tr>
 <tr><td>La Serena</td><td>$2.000</td></tr>
 <tr><td>Coquimbo</td><td>$1.500</td></tr>
 <tr>
  <td>La Serena y Coquimbo, compras desde $30.000</td>
  <td><strong>Gratis</strong></td>
 </tr>
 <tr>
  <td>Otras regiones y comunas</td>
  <td>Envío por pagar</td>
 </tr>
 </tbody>
 </table>
 </div>
</section>

<section>
 <h2>Datos del solicitante</h2>

 <label>Nombre y apellido *
  <input id="customer" maxlength="120">
 </label>

 <label>Modalidad (Retiro o Entrega a Domicilio) *
  <select id="mode">
   <option value="delivery">Entrega a Domicilio</option>
   <option value="pickup">Retiro</option>
  </select>
 </label>

 <div id="deliveryFields">
  <label>Dirección *
   <input id="address" maxlength="220"
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
   <input id="commune" maxlength="100">
  </label>
 </div>

 <p id="shippingNotice" class="notice">
  Despacho por calcular.
 </p>

 <button id="checkout" style="width:100%">
  Enviar pedido por WhatsApp
 </button>

 <p class="muted">
  Los pedidos quedan sujetos a confirmación de
  disponibilidad, pago y entrega por Brusaam.
 </p>
</section>

<script>
const $=id=>document.getElementById(id);
const money=n=>'$'+Math.round(Number(n))
 .toLocaleString('es-CL');

let data={
 products:[],categories:[],
 subcategories:[],sections:[]
};

let cart={};
let activeSection='';

function norm(s) {
 return String(s||'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().trim().replace(/\s+/g,' ');
}

function el(tag,text) {
 const e=document.createElement(tag);
 if(text!==undefined)e.textContent=text;
 return e;
}

function img(url,alt) {
 const e=el('img');
 e.src=url;
 e.alt=alt;
 e.loading='lazy';
 return e;
}

function decorate(d) {
 if(d.logo) $('shopLogo').src=d.logo;

 for(const id of ['topDesign','bottomDesign']) {
  if(d.design) {
   $(id).style.backgroundImage=
    'url('+JSON.stringify(d.design)+')';
   $(id).textContent=' ';
  } else {
   $(id).style.backgroundImage='';
   $(id).textContent='';
  }
 }
}

function tile(name,image,icon,click) {
 const b=el('button');
 b.className='tile';

 if(image) {
  b.append(img(image,name));
 } else {
  const box=el('div',icon||'📦');
  box.className='placeholder';
  b.append(box);
 }

 b.append(el('strong',name));
 b.onclick=click;
 return b;
}

function isPaper(p) {
 return norm(p.category)==='papeleria' &&
  norm(p.subcategory)==='papel higienico';
}

function hasManga(p) {
 return isPaper(p) &&
  Number(p.manga_price)>0 &&
  Number(p.packs_per_manga)>0;
}

function unitPrice(p,kind,qty) {
 if(kind==='manga') return Number(p.manga_price);

 return qty>=(Number(p.min_qty)||2)
  ? Number(p.wholesale)
  : Number(p.retail);
}

function usedStock(id) {
 let total=0;

 for(const [key,qty] of Object.entries(cart)) {
  const [productId,kind]=key.split(':');
  if(String(productId)!==String(id)) continue;

  const p=data.products.find(
   x=>String(x.id)===String(id)
  );

  if(!p) continue;

  total+=qty*(kind==='manga'
   ?Number(p.packs_per_manga):1);
 }

 return total;
}

function add(id,kind,qty) {
 const p=data.products.find(
  x=>String(x.id)===String(id)
 );

 qty=Number(qty);

 if(!p||!Number.isInteger(qty)||qty<1) {
  alert('Cantidad inválida.');
  return;
 }

 if(kind==='manga'&&!hasManga(p)) {
  alert('Manga no disponible.');
  return;
 }

 const stockNeeded=qty*(kind==='manga'
  ?Number(p.packs_per_manga):1);

 if(usedStock(id)+stockNeeded>Number(p.stock)) {
  alert('Stock insuficiente.');
  return;
 }

 const key=id+':'+kind;
 cart[key]=(cart[key]||0)+qty;
 renderCart();
}

function productCard(p) {
 const card=el('div');
 card.className='product';

 if(p.image) {
  card.append(img(p.image,p.name));
 } else {
  const placeholder=el('div','📦');
  placeholder.style.cssText=
   'height:175px;display:grid;place-items:center';
  card.append(placeholder);
 }

 card.append(el('h3',p.name));

 if(p.subcategory) {
  const sub=el('div',p.subcategory);
  sub.className='muted';
  card.append(sub);
 }

 const paper=isPaper(p);

 if(paper) {
  const title=el('strong','Presentación');
  card.append(title);

  const kind=el('select');
  kind.add(new Option('Por paquete','pack'));

  if(hasManga(p)) {
   kind.add(new Option('Por manga','manga'));
  }

  const price=el('div');
  price.className='price';

  const details=el('div');
  details.className='muted';

  const update=()=>{
   if(kind.value==='manga') {
    price.textContent=money(p.manga_price)+' por manga';
    details.textContent=
     Number(p.packs_per_manga)+
     ' paquetes por manga · precio único';
   } else {
    price.textContent=
     money(p.retail)+' por paquete';

    details.textContent=
     'Desde '+(p.min_qty||2)+
     ' paquetes: '+money(p.wholesale)+' c/u';
   }
  };

  kind.onchange=update;
  card.append(kind,price,details);
  update();

  const quantity=el('input');
  quantity.type='number';
  quantity.min='1';
  quantity.value='1';

  const btn=el('button','Agregar al carrito');
  btn.disabled=Number(p.stock)<1;
  btn.onclick=()=>add(p.id,kind.value,quantity.value);

  card.append(quantity,btn);
 } else {
  const price=el('div',money(p.retail));
  price.className='price';
  card.append(price);

  const wholesale=el(
   'div',
   'Mayor desde '+(p.min_qty||2)+
   ': '+money(p.wholesale)+' c/u'
  );
  wholesale.className='muted';
  card.append(wholesale);

  const quantity=el('input');
  quantity.type='number';
  quantity.min='1';
  quantity.value='1';

  const btn=el('button','Agregar al carrito');
  btn.disabled=Number(p.stock)<1;
  btn.onclick=()=>add(p.id,'pack',quantity.value);

  card.append(quantity,btn);
 }

 const stock=el('div',
  'Stock disponible: '+p.stock+
  (paper?' paquetes':' unidades'));
 stock.className='muted';
 card.append(stock);

 return card;
}

function renderHome() {
 const categories=$('categoryTiles');
 categories.replaceChildren();

 const icons={
  'Limpieza del hogar':'🧴',
  'Cuidado personal':'🧼',
  'Papelería':'🧻',
  'Otros productos':'📦'
 };

 for(const c of data.categories) {
  categories.append(tile(
   c.name,c.image,icons[c.name]||'📁',
   ()=>openCategory(c.name)
  ));
 }

 const sections=$('sectionTiles');
 sections.replaceChildren();

 const iconsSections={
  destacados:'⭐',
  pack_ahorro:'📦',
  ofertas:'🏷️',
  box_pyme:'🏪'
 };

 for(const s of data.sections) {
  sections.append(tile(
   s.title,s.image,iconsSections[s.slug],
   ()=>openSection(s.slug)
  ));
 }

 const area=$('featuredAreas');
 area.replaceChildren();

 for(const s of data.sections) {
  const list=data.products.filter(
   p=>Number(p[s.slug])===1
  ).slice(0,4);

  if(!list.length)continue;

  const section=el('section');
  const heading=el('div');
  heading.className='flex';

  const title=el('h2',s.title);
  title.className='grow';

  const more=el('button','Ver todos');
  more.className='secondary';
  more.onclick=()=>openSection(s.slug);

  heading.append(title,more);
  section.append(heading);

  const grid=el('div');
  grid.className='grid';

  list.forEach(p=>grid.append(productCard(p)));
  section.append(grid);
  area.append(section);
 }
}

function fillFilters() {
 const category=$('filterCategory');
 const selected=category.value;

 category.replaceChildren(
  new Option('Todas las categorías','')
 );

 data.categories.forEach(c=>
  category.add(new Option(c.name,c.name))
 );

 if([...category.options].some(
  x=>x.value===selected
 ))category.value=selected;

 fillSubs();
}

function fillSubs(selected='') {
 const category=$('filterCategory').value;
 const c=data.categories.find(x=>x.name===category);

 const sub=$('filterSub');
 sub.replaceChildren(
  new Option('Todas las subcategorías','')
 );

 if(c) {
  data.subcategories
   .filter(x=>Number(x.category_id)===Number(c.id))
   .forEach(x=>sub.add(new Option(x.name,x.name)));
 }

 if([...sub.options].some(
  x=>x.value===selected
 ))sub.value=selected;
}

function showSubcategories(categoryName) {
 const root=$('subTiles');
 root.replaceChildren();

 const c=data.categories.find(
  x=>x.name===categoryName
 );

 if(!c)return;

 for(const sub of data.subcategories.filter(
  x=>Number(x.category_id)===Number(c.id)
 )) {
  root.append(tile(
   sub.name,sub.image,'📁',
   ()=>openCategory(categoryName,sub.name)
  ));
 }
}

function openCategory(name,sub='') {
 activeSection='';
 $('search').value='';
 $('home').classList.add('hidden');

 $('filterCategory').value=name;
 fillSubs(sub);

 $('catalogTitle').textContent=sub||name;
 showSubcategories(name);
 renderProducts();

 $('catalogSection').scrollIntoView({
  behavior:'smooth'
 });
}

function openSection(slug) {
 activeSection=slug;
 $('search').value='';
 $('home').classList.add('hidden');

 $('filterCategory').value='';
 fillSubs();

 $('subTiles').replaceChildren();

 const s=data.sections.find(x=>x.slug===slug);
 $('catalogTitle').textContent=s?.title||'Productos';

 renderProducts();

 $('catalogSection').scrollIntoView({
  behavior:'smooth'
 });
}

function showHome() {
 activeSection='';
 $('search').value='';
 $('filterCategory').value='';
 fillSubs();

 $('catalogTitle').textContent='Todos los productos';
 $('subTiles').replaceChildren();

 $('home').classList.remove('hidden');
 renderProducts();

 window.scrollTo({top:0,behavior:'smooth'});
}

function renderProducts() {
 const q=norm($('search').value);
 const cat=$('filterCategory').value;
 const sub=$('filterSub').value;

 const list=data.products.filter(p=>{
  if(activeSection&&Number(p[activeSection])!==1) {
   return false;
  }

  if(cat&&p.category!==cat)return false;
  if(sub&&p.subcategory!==sub)return false;

  return norm([
   p.name,p.category,p.subcategory,p.description
  ].join(' ')).includes(q);
 });

 $('count').textContent=
  list.length+' producto(s) encontrado(s)';

 const root=$('products');
 root.replaceChildren();

 list.forEach(p=>root.append(productCard(p)));
}

function subtotal() {
 let sum=0;

 for(const [key,qty] of Object.entries(cart)) {
  const [id,kind]=key.split(':');
  const p=data.products.find(
   x=>String(x.id)===id
  );

  if(p)sum+=unitPrice(p,kind,qty)*qty;
 }

 return sum;
}

function shipping() {
 if($('mode').value==='pickup') {
  return {
   type:'pickup',
   amount:0,
   label:'Retiro gratis'
  };
 }

 const region=norm($('region').value);
 const commune=norm($('commune').value);

 if(!region||!commune) {
  return {
   type:'pending',
   amount:null,
   label:'Despacho por calcular'
  };
 }

 const local=region==='coquimbo' &&
  (commune==='la serena'||commune==='coquimbo');

 if(local&&subtotal()>=30000) {
  return {
   type:'free',
   amount:0,
   label:'Despacho gratis'
  };
 }

 if(region==='coquimbo'&&commune==='la serena') {
  return {
   type:'local',
   amount:2000,
   label:money(2000)
  };
 }

 if(region==='coquimbo'&&commune==='coquimbo') {
  return {
   type:'local',
   amount:1500,
   label:money(1500)
  };
 }

 return {
  type:'external',
  amount:null,
  label:'Envío por pagar'
 };
}

function renderCart() {
 const root=$('cartItems');
 root.replaceChildren();

 if(!Object.keys(cart).length) {
  const empty=el('p','Tu carrito está vacío.');
  empty.className='muted';
  root.append(empty);
 }

 for(const [key,qty] of Object.entries(cart)) {
  const [id,kind]=key.split(':');
  const p=data.products.find(
   x=>String(x.id)===id
  );

  if(!p)continue;

  const row=el('div');
  row.className='cartrow';

  if(p.image)row.append(img(p.image,p.name));

  const info=el('div');
  info.className='cartinfo';

  info.append(el('strong',p.name));

  const presentation=kind==='manga'
   ? 'Manga ('+p.packs_per_manga+' paquetes)'
   : isPaper(p)?'Paquete':'Unidad';

  const description=el('div',presentation);
  description.className='muted';
  info.append(description);

  const price=el('div',
   'Unitario: '+money(unitPrice(p,kind,qty)));
  price.className='muted';
  info.append(price);

  const line=el('div',
   money(unitPrice(p,kind,qty)*qty));
  line.className='price';
  info.append(line);

  const controls=el('div');
  controls.className='flex';

  const minus=el('button','−');
  minus.className='small';
  minus.onclick=()=>{
   if(cart[key]<=1)delete cart[key];
   else cart[key]--;
   renderCart();
  };

  const number=el('strong',String(qty));

  const plus=el('button','+');
  plus.className='small';
  plus.disabled=usedStock(id)+
   (kind==='manga'?Number(p.packs_per_manga):1)
   >Number(p.stock);

  plus.onclick=()=>add(id,kind,1);

  const remove=el('button','Eliminar');
  remove.className='small danger';
  remove.onclick=()=>{
   delete cart[key];
   renderCart();
  };

  controls.append(minus,number,plus,remove);
  info.append(controls);
  row.append(info);
  root.append(row);
 }

 const s=subtotal();
 const delivery=shipping();

 $('subtotal').textContent=money(s);
 $('shipping').textContent=delivery.label;

 $('totalLabel').textContent=
  delivery.amount===null
   ?'Total productos':'Total';

 $('total').textContent=money(
  s+(delivery.amount||0)
 );

 const messages={
  pickup:'Retiro gratis. Brusaam confirmará lugar y horario.',
  pending:'Despacho por calcular. Completa región y comuna.',
  free:'Despacho gratis en La Serena y Coquimbo desde $30.000.',
  external:'Otras regiones y comunas: envío por pagar.',
  local:'Despacho local: '+delivery.label
 };

 $('shippingNotice').textContent=
  messages[delivery.type];
}

$('search').oninput=()=>{
 if($('search').value.trim()) {
  $('home').classList.add('hidden');
  activeSection='';
  $('filterCategory').value='';
  fillSubs();
  $('subTiles').replaceChildren();
  $('catalogTitle').textContent='Resultados de búsqueda';
 } else {
  showHome();
 }
 renderProducts();
};

$('filterCategory').onchange=()=>{
 activeSection='';
 fillSubs();
 $('subTiles').replaceChildren();
 $('catalogTitle').textContent='Productos';
 renderProducts();
};

$('filterSub').onchange=renderProducts;
$('backHome').onclick=showHome;

$('mode').onchange=()=>{
 $('deliveryFields').classList.toggle(
  'hidden',$('mode').value==='pickup'
 );
 renderCart();
};

$('region').onchange=renderCart;
$('commune').oninput=renderCart;

$('checkout').onclick=()=>{
 if(!Object.keys(cart).length) {
  alert('Agrega productos al carrito.');
  return;
 }

 const name=$('customer').value.trim();

 if(!name) {
  alert('Ingresa tu nombre.');
  return;
 }

 const pickup=$('mode').value==='pickup';
 const address=$('address').value.trim();
 const region=$('region').value;
 const commune=$('commune').value.trim();

 if(!pickup&&(!address||!region||!commune)) {
  alert('Completa dirección, región y comuna.');
  return;
 }

 const lines=[];

 for(const [key,qty] of Object.entries(cart)) {
  const [id,kind]=key.split(':');
  const p=data.products.find(
   x=>String(x.id)===id
  );

  if(!p)continue;

  const presentation=kind==='manga'
   ?'manga ('+p.packs_per_manga+' paquetes)'
   :isPaper(p)?'paquete':'unidad';

  lines.push(
   qty+' x '+p.name+' ['+presentation+']'+
   ' | Unitario: '+money(unitPrice(p,kind,qty))+
   ' | Subtotal: '+money(
    unitPrice(p,kind,qty)*qty
   )
  );
 }

 const delivery=shipping();

 const message=[
  'Hola Brusaam, quiero realizar este pedido:',
  '',
  ...lines,
  '',
  'Subtotal productos: '+money(subtotal()),
  'Despacho: '+delivery.label,
  delivery.amount===null
   ?'Total productos sin transporte: '+money(subtotal())
   :'Total: '+money(subtotal()+delivery.amount),
  '',
  'Solicitante: '+name,
  'Modalidad: '+(pickup?'Retiro':'Entrega a Domicilio'),
  ...(!pickup?[
   'Dirección: '+address,
   'Región: '+region,
   'Comuna: '+commune
  ]:[])
 ].join('\n');

 window.location.href=
  'https://wa.me/56966282007?text='+
  encodeURIComponent(message);
};

async function load() {
 try {
  const response=await fetch('/api/shop');
  if(!response.ok)throw Error();

  data=await response.json();

  decorate(data);
  fillFilters();
  renderHome();
  renderProducts();
  renderCart();
 } catch(e) {
  $('products').textContent=
   'No fue posible cargar el catálogo.';
 }
}

load();
</script>`;

/* ADMINISTRACIÓN */

const ADMIN_HTML = String.raw`
<h2>Administración privada Brusaam</h2>

<section id="loginArea">
 <form id="loginForm">
  <label>Contraseña
   <input id="password" type="password" required>
  </label>
  <button>Ingresar</button>
 </form>
 <p id="loginMessage"></p>
</section>

<div id="adminArea" class="hidden">
 <div class="flex">
  <h2 class="grow">Panel de Administración</h2>
  <button id="logout" class="danger">
   Cerrar sesión
  </button>
 </div>

 <div class="adminTabs">
  <button data-tab="products" class="active">Productos</button>
  <button data-tab="sections">Secciones</button>
  <button data-tab="categories">Categorías</button>
  <button data-tab="subs">Subcategorías</button>
  <button data-tab="design">Diseño y logo</button>
 </div>

 <div id="tab-products">
  <section>
   <h3>Agregar o editar producto</h3>

   <form id="productForm">
    <input type="hidden" id="pId">

    <label>Nombre
     <input id="pName" maxlength="160" required>
    </label>

    <label>Categoría
     <select id="pCategory" required></select>
    </label>

    <label>Subcategoría
     <select id="pSub"></select>
    </label>

    <label>Descripción
     <textarea id="pDescription"
      maxlength="1000"></textarea>
    </label>

    <label>Precio al detalle
     <input id="pRetail" type="number"
      min="0" required>
    </label>

    <label>Precio por mayor
     <input id="pWholesale" type="number"
      min="0" required>
    </label>

    <label>Precio por mayor desde cuántas unidades
     <input id="pMin" type="number"
      min="1" value="2" required>
    </label>

    <label>Stock disponible
     <input id="pStock" type="number"
      min="0" required>
    </label>

    <div id="paperFields" class="hidden">
     <h3>Venta especial de papel higiénico</h3>

     <p class="notice">
      Ingresa el stock en paquetes individuales.
      Cada manga descontará del stock la cantidad
      de paquetes que contiene.
     </p>

     <label>Precio único por manga
      <input id="pMangaPrice" type="number"
       min="0" value="0">
     </label>

     <label>Cuántos paquetes contiene una manga
      <input id="pPacksPerManga" type="number"
       min="0" value="0">
     </label>
    </div>

    <label>Fotografía del producto
     <input id="pFile" type="file"
      accept="image/png,image/jpeg,image/webp">
    </label>

    <button type="button" id="uploadProduct">
     Subir fotografía
    </button>

    <label>URL de fotografía
     <input id="pImage" type="url">
    </label>

    <h3>Mostrar en secciones especiales</h3>

    <label>
     <input id="pFeatured" type="checkbox">
     Los más destacados
    </label>

    <label>
     <input id="pSavings" type="checkbox">
     Pack Ahorro
    </label>

    <label>
     <input id="pOffers" type="checkbox">
     Ofertas
    </label>

    <label>
     <input id="pPyme" type="checkbox">
     Box Pyme
    </label>

    <label>
     <input id="pActive" type="checkbox" checked>
     Producto visible en la tienda
    </label>

    <div class="flex" style="margin-top:15px">
     <button>Guardar producto</button>
     <button type="button" id="clearProduct"
      class="secondary">Limpiar</button>
    </div>
   </form>

   <p id="productMessage"></p>
  </section>

  <section>
   <h3>Productos registrados</h3>
   <div id="productList"></div>
  </section>
 </div>

 <div id="tab-sections" class="hidden">
  <section>
   <h3>Fotografías de secciones</h3>
   <p class="muted">
    Cambia las imágenes de Destacados,
    Pack Ahorro, Ofertas y Box Pyme.
   </p>
   <div id="sectionList"></div>
  </section>
 </div>

 <div id="tab-categories" class="hidden">
  <section>
   <h3>Crear o editar categoría</h3>

   <form id="categoryForm">
    <input type="hidden" id="cId">

    <label>Nombre
     <input id="cName" maxlength="100" required>
    </label>

    <label>Fotografía
     <input id="cFile" type="file"
      accept="image/png,image/jpeg,image/webp">
    </label>

    <button type="button" id="uploadCategory">
     Subir fotografía
    </button>

    <label>URL de fotografía
     <input id="cImage" type="url">
    </label>

    <label>Orden de aparición
     <input id="cPosition" type="number" value="0">
    </label>

    <button>Guardar categoría</button>
    <button type="button" id="clearCategory"
     class="secondary">Limpiar</button>
   </form>

   <p id="categoryMessage"></p>
  </section>

  <section>
   <h3>Categorías existentes</h3>
   <div id="categoryList"></div>
  </section>
 </div>

 <div id="tab-subs" class="hidden">
  <section>
   <h3>Crear o editar subcategoría</h3>

   <form id="subForm">
    <input type="hidden" id="sId">

    <label>Categoría principal
     <select id="sCategory" required></select>
    </label>

    <label>Nombre
     <input id="sName" maxlength="100" required>
    </label>

    <label>Fotografía
     <input id="sFile" type="file"
      accept="image/png,image/jpeg,image/webp">
    </label>

    <button type="button" id="uploadSub">
     Subir fotografía
    </button>

    <label>URL de fotografía
     <input id="sImage" type="url">
    </label>

    <label>Orden de aparición
     <input id="sPosition" type="number" value="0">
    </label>

    <button>Guardar subcategoría</button>
    <button type="button" id="clearSub"
     class="secondary">Limpiar</button>
   </form>

   <p id="subMessage"></p>
  </section>

  <section>
   <h3>Subcategorías existentes</h3>
   <div id="subList"></div>
  </section>
 </div>

 <div id="tab-design" class="hidden">
  <section>
   <h3>Logo de Brusaam</h3>

   <p class="muted">
    Para eliminar el fondo negro, sube
    el logo original en PNG transparente.
   </p>

   <img id="logoPreview"
    style="max-width:180px" alt="Logo">

   <label>Archivo del logo
    <input id="logoFile" type="file"
     accept="image/png,image/jpeg,image/webp">
   </label>

   <button id="uploadLogo">Subir logo</button>

   <label>URL del logo
    <input id="logoUrl" type="url">
   </label>

   <button id="saveLogo">Guardar logo</button>
  </section>

  <section>
   <h3>Diseño gráfico de Canva</h3>

   <p class="notice">
    Exporta tu diseño desde Canva como PNG
    o JPG, sin las barras del navegador.
    Se utilizará como decoración superior
    e inferior de la página.
   </p>

   <label>Imagen del diseño
    <input id="designFile" type="file"
     accept="image/png,image/jpeg,image/webp">
   </label>

   <button id="uploadDesign">
    Subir diseño
   </button>

   <label>URL del diseño
    <input id="designUrl" type="url">
   </label>

   <button id="saveDesign">
    Guardar diseño
   </button>

   <button id="removeDesign" class="secondary">
    Quitar diseño
   </button>

   <p id="designMessage"></p>
  </section>
 </div>
</div>

<script>
const $=id=>document.getElementById(id);

let d={
 products:[],
 categories:[],
 subcategories:[],
 sections:[]
};

async function api(path,method='GET',body) {
 const options={
  method,
  credentials:'same-origin'
 };

 if(body!==undefined) {
  options.headers={'Content-Type':'application/json'};
  options.body=JSON.stringify(body);
 }

 const response=await fetch(path,options);
 const result=await response.json().catch(()=>({}));

 if(!response.ok) {
  throw Error(result.error||'Error en la operación');
 }

 return result;
}

function message(id,text) {
 $(id).textContent=text;
}

function option(select,label,value) {
 select.add(new Option(label,value));
}

function openTab(name) {
 document.querySelectorAll('[data-tab]')
  .forEach(b=>b.classList.toggle(
   'active',b.dataset.tab===name
  ));

 for(const tab of [
  'products','sections','categories','subs','design'
 ]) {
  $('tab-'+tab).classList.toggle(
   'hidden',tab!==name
  );
 }
}

document.querySelectorAll('[data-tab]').forEach(b=>{
 b.onclick=()=>openTab(b.dataset.tab);
});

async function upload(inputId) {
 const file=$(inputId).files[0];

 if(!file)throw Error('Selecciona una fotografía.');

 if(file.size===0||file.size>5*1024*1024) {
  throw Error('El archivo debe tener máximo 5 MB.');
 }

 if(![
  'image/jpeg','image/png','image/webp'
 ].includes(file.type)) {
  throw Error('Solo JPG, PNG o WebP.');
 }

 const form=new FormData();
 form.append('file',file);

 const response=await fetch('/api/admin/upload',{
  method:'POST',
  credentials:'same-origin',
  body:form
 });

 const result=await response.json().catch(()=>({}));

 if(!response.ok) {
  throw Error(result.error||'Error al subir fotografía');
 }

 return result.url;
}

function fillCategorySelects() {
 const product=$('pCategory');
 const sub=$('sCategory');

 const oldProduct=product.value;
 const oldSub=sub.value;

 product.replaceChildren();
 sub.replaceChildren();

 for(const c of d.categories) {
  option(product,c.name,c.name);
  option(sub,c.name,String(c.id));
 }

 if([...product.options].some(
  x=>x.value===oldProduct
 ))product.value=oldProduct;

 if([...sub.options].some(
  x=>x.value===oldSub
 ))sub.value=oldSub;

 fillProductSubs();
}

function fillProductSubs(selected='') {
 const category=d.categories.find(
  c=>c.name===$('pCategory').value
 );

 const select=$('pSub');
 select.replaceChildren(
  new Option('Sin subcategoría','')
 );

 if(category) {
  d.subcategories
   .filter(s=>Number(s.category_id)===Number(category.id))
   .forEach(s=>option(select,s.name,s.name));
 }

 if(selected&&!([...select.options].some(
  x=>x.value===selected
 )))option(select,selected,selected);

 select.value=selected||'';
 updatePaperFields();
}

function updatePaperFields() {
 const paper=$('pCategory').value==='Papelería' &&
  $('pSub').value==='Papel higiénico';

 $('paperFields').classList.toggle('hidden',!paper);
}

$('pCategory').onchange=()=>fillProductSubs();
$('pSub').onchange=updatePaperFields;

function adminRow(label,image,edit,remove) {
 const row=document.createElement('div');
 row.className='adminRow flex';

 if(image) {
  const photo=document.createElement('img');
  photo.src=image;
  row.append(photo);
 }

 const title=document.createElement('strong');
 title.className='grow';
 title.textContent=label;
 row.append(title);

 const editButton=document.createElement('button');
 editButton.textContent='Editar';
 editButton.onclick=edit;
 row.append(editButton);

 if(remove) {
  const deleteButton=document.createElement('button');
  deleteButton.className='danger';
  deleteButton.textContent='Eliminar';
  deleteButton.onclick=remove;
  row.append(deleteButton);
 }

 return row;
}

function clearProduct() {
 $('productForm').reset();
 $('pId').value='';
 $('pImage').value='';
 $('pMin').value='2';
 $('pMangaPrice').value='0';
 $('pPacksPerManga').value='0';
 $('pActive').checked=true;
 fillProductSubs();
}

$('clearProduct').onclick=clearProduct;

function renderProducts() {
 const root=$('productList');
 root.replaceChildren();

 for(const p of d.products) {
  const edit=()=>{
   $('pId').value=p.id;
   $('pName').value=p.name||'';
   $('pDescription').value=p.description||'';
   $('pRetail').value=p.retail;
   $('pWholesale').value=p.wholesale;
   $('pMin').value=p.min_qty||2;
   $('pStock').value=p.stock;
   $('pImage').value=p.image||'';

   if(![...$('pCategory').options].some(
    x=>x.value===p.category
   )) {
    option($('pCategory'),p.category,p.category);
   }

   $('pCategory').value=p.category;
   fillProductSubs(p.subcategory||'');

   $('pMangaPrice').value=p.manga_price||0;
   $('pPacksPerManga').value=p.packs_per_manga||0;

   $('pFeatured').checked=!!p.destacados;
   $('pSavings').checked=!!p.pack_ahorro;
   $('pOffers').checked=!!p.ofertas;
   $('pPyme').checked=!!p.box_pyme;
   $('pActive').checked=!!p.active;

   openTab('products');
   window.scrollTo({top:0,behavior:'smooth'});
  };

  const remove=async()=>{
   if(!confirm('¿Eliminar '+p.name+'?'))return;

   try {
    await api(
     '/api/admin/products/'+p.id,
     'DELETE',{}
    );
    await refresh();
   } catch(e) {
    alert(e.message);
   }
  };

  root.append(adminRow(
   p.name+' | $'+p.retail+' | Stock: '+p.stock,
   p.image,edit,remove
  ));
 }
}

$('uploadProduct').onclick=async()=>{
 try {
  $('pImage').value=await upload('pFile');
  message('productMessage',
   'Fotografía subida. Guarda el producto.');
 } catch(e) {
  message('productMessage',e.message);
 }
};

$('productForm').onsubmit=async e=>{
 e.preventDefault();

 const id=$('pId').value;

 const paper=$('pCategory').value==='Papelería' &&
  $('pSub').value==='Papel higiénico';

 const product={
  name:$('pName').value.trim(),
  category:$('pCategory').value,
  subcategory:$('pSub').value,
  description:$('pDescription').value,
  retail:Number($('pRetail').value),
  wholesale:Number($('pWholesale').value),
  min_qty:Number($('pMin').value),
  stock:Number($('pStock').value),
  image:$('pImage').value.trim(),
  manga_price:paper
   ?Number($('pMangaPrice').value):0,
  packs_per_manga:paper
   ?Number($('pPacksPerManga').value):0,
  destacados:$('pFeatured').checked,
  pack_ahorro:$('pSavings').checked,
  ofertas:$('pOffers').checked,
  box_pyme:$('pPyme').checked,
  active:$('pActive').checked
 };

 try {
  await api(
   '/api/admin/products'+(id?'/'+id:''),
   id?'PUT':'POST',
   product
  );

  clearProduct();
  await refresh();

  message('productMessage',
   'Producto guardado correctamente.');
 } catch(error) {
  message('productMessage',error.message);
 }
};

function renderSections() {
 const root=$('sectionList');
 root.replaceChildren();

 for(const section of d.sections) {
  const box=document.createElement('div');
  box.className='adminRow';

  const title=document.createElement('h3');
  title.textContent=section.title;
  box.append(title);

  if(section.image) {
   const photo=document.createElement('img');
   photo.src=section.image;
   photo.style.cssText=
    'width:180px;height:110px;object-fit:cover';
   box.append(photo);
  }

  const file=document.createElement('input');
  file.type='file';
  file.accept='image/jpeg,image/png,image/webp';

  const url=document.createElement('input');
  url.type='url';
  url.value=section.image||'';
  url.placeholder='URL de fotografía';

  const uploadButton=document.createElement('button');
  uploadButton.textContent='Subir fotografía';

  uploadButton.onclick=async()=>{
   try {
    if(!file.files[0])throw Error(
     'Selecciona una fotografía.'
    );

    const form=new FormData();
    form.append('file',file.files[0]);

    const response=await fetch('/api/admin/upload',{
     method:'POST',
     credentials:'same-origin',
     body:form
    });

    const result=await response.json();

    if(!response.ok)throw Error(result.error);

    url.value=result.url;
    alert('Fotografía subida. Ahora presiona Guardar.');
   } catch(e) {
    alert(e.message);
   }
  };

  const save=document.createElement('button');
  save.textContent='Guardar sección';

  save.onclick=async()=>{
   try {
    await api(
     '/api/admin/sections/'+section.slug,
     'PUT',
     {image:url.value.trim()}
    );

    await refresh();
    alert('Sección actualizada.');
   } catch(e) {
    alert(e.message);
   }
  };

  box.append(file,uploadButton,url,save);
  root.append(box);
 }
}

function clearCategory() {
 $('categoryForm').reset();
 $('cId').value='';
 $('cImage').value='';
 $('cPosition').value='0';
}

$('clearCategory').onclick=clearCategory;

function renderCategories() {
 const root=$('categoryList');
 root.replaceChildren();

 for(const c of d.categories) {
  root.append(adminRow(
   c.name,c.image,
   ()=>{
    $('cId').value=c.id;
    $('cName').value=c.name;
    $('cImage').value=c.image||'';
    $('cPosition').value=c.position||0;
    openTab('categories');
    window.scrollTo({top:0,behavior:'smooth'});
   },
   async()=>{
    if(!confirm('¿Eliminar categoría?'))return;

    try {
     await api(
      '/api/admin/categories/'+c.id,
      'DELETE',{}
     );
     await refresh();
    } catch(e) {
     alert(e.message);
    }
   }
  ));
 }
}

$('uploadCategory').onclick=async()=>{
 try {
  $('cImage').value=await upload('cFile');
  message('categoryMessage',
   'Fotografía subida. Guarda la categoría.');
 } catch(e) {
  message('categoryMessage',e.message);
 }
};

$('categoryForm').onsubmit=async e=>{
 e.preventDefault();

 const id=$('cId').value;

 try {
  await api(
   '/api/admin/categories'+(id?'/'+id:''),
   id?'PUT':'POST',
   {
    name:$('cName').value.trim(),
    image:$('cImage').value.trim(),
    position:Number($('cPosition').value)
   }
  );

  clearCategory();
  await refresh();
  message('categoryMessage','Categoría guardada.');
 } catch(error) {
  message('categoryMessage',error.message);
 }
};

function clearSub() {
 $('subForm').reset();
 $('sId').value='';
 $('sImage').value='';
 $('sPosition').value='0';
}

$('clearSub').onclick=clearSub;

function renderSubs() {
 const root=$('subList');
 root.replaceChildren();

 for(const s of d.subcategories) {
  const category=d.categories.find(
   c=>Number(c.id)===Number(s.category_id)
  );

  root.append(adminRow(
   (category?.name||'Categoría')+' › '+s.name,
   s.image,
   ()=>{
    $('sId').value=s.id;
    $('sCategory').value=String(s.category_id);
    $('sName').value=s.name;
    $('sImage').value=s.image||'';
    $('sPosition').value=s.position||0;
    openTab('subs');
    window.scrollTo({top:0,behavior:'smooth'});
   },
   async()=>{
    if(!confirm('¿Eliminar subcategoría?'))return;

    try {
     await api(
      '/api/admin/subcategories/'+s.id,
      'DELETE',{}
     );
     await refresh();
    } catch(e) {
     alert(e.message);
    }
   }
  ));
 }
}

$('uploadSub').onclick=async()=>{
 try {
  $('sImage').value=await upload('sFile');
  message('subMessage',
   'Fotografía subida. Guarda la subcategoría.');
 } catch(e) {
  message('subMessage',e.message);
 }
};

$('subForm').onsubmit=async e=>{
 e.preventDefault();

 const id=$('sId').value;

 try {
  await api(
   '/api/admin/subcategories'+(id?'/'+id:''),
   id?'PUT':'POST',
   {
    category_id:Number($('sCategory').value),
    name:$('sName').value.trim(),
    image:$('sImage').value.trim(),
    position:Number($('sPosition').value)
   }
  );

  clearSub();
  await refresh();
  message('subMessage','Subcategoría guardada.');
 } catch(error) {
  message('subMessage',error.message);
 }
};

$('uploadLogo').onclick=async()=>{
 try {
  const url=await upload('logoFile');
  $('logoUrl').value=url;
  $('logoPreview').src=url;
  message('designMessage',
   'Logo subido. Presiona Guardar logo.');
 } catch(e) {
  message('designMessage',e.message);
 }
};

$('saveLogo').onclick=async()=>{
 try {
  await api('/api/admin/settings/logo','PUT',{
   value:$('logoUrl').value.trim()
  });

  await refresh();
  message('designMessage','Logo guardado.');
 } catch(e) {
  message('designMessage',e.message);
 }
};

$('uploadDesign').onclick=async()=>{
 try {
  $('designUrl').value=await upload('designFile');
  message('designMessage',
   'Diseño subido. Presiona Guardar diseño.');
 } catch(e) {
  message('designMessage',e.message);
 }
};

$('saveDesign').onclick=async()=>{
 try {
  await api('/api/admin/settings/design','PUT',{
   value:$('designUrl').value.trim()
  });

  await refresh();
  message('designMessage','Diseño guardado.');
 } catch(e) {
  message('designMessage',e.message);
 }
};

$('removeDesign').onclick=async()=>{
 if(!confirm('¿Quitar el diseño decorativo?'))return;

 try {
  await api('/api/admin/settings/design','PUT',{
   value:''
  });

  await refresh();
  message('designMessage','Diseño retirado.');
 } catch(e) {
  message('designMessage',e.message);
 }
};

async function refresh() {
 d=await api('/api/admin/data');

 $('logoUrl').value=d.logo||'';
 $('logoPreview').src=d.logo||'';
 $('shopLogo').src=d.logo||'';
 $('designUrl').value=d.design||'';

 fillCategorySelects();
 renderProducts();
 renderSections();
 renderCategories();
 renderSubs();
}

$('loginForm').onsubmit=async e=>{
 e.preventDefault();

 try {
  await api('/api/admin/login','POST',{
   password:$('password').value
  });

  $('password').value='';
  message('loginMessage','');
  await start();
 } catch(error) {
  message('loginMessage',error.message);
 }
};

$('logout').onclick=async()=>{
 await api('/api/admin/logout','POST',{});
 await start();
};

async function start() {
 try {
  const session=await api('/api/admin/session');

  $('loginArea').classList.toggle(
   'hidden',session.authenticated
  );

  $('adminArea').classList.toggle(
   'hidden',!session.authenticated
  );

  if(session.authenticated)await refresh();
 } catch(e) {
  message('loginMessage',e.message);
 }
}

start();
</script>`;

/* VALIDACIONES */

function productValid(p) {
  if (!p ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 160 ||
      typeof p.category !== "string" ||
      !p.category.trim() ||
      p.category.length > 100 ||
      typeof p.subcategory !== "string" ||
      p.subcategory.length > 100 ||
      typeof p.description !== "string" ||
      p.description.length > 1000 ||
      !integer(p.retail) ||
      !integer(p.wholesale) ||
      !integer(p.min_qty, 1) ||
      !integer(p.stock) ||
      !integer(p.manga_price) ||
      !integer(p.packs_per_manga) ||
      !validImage(p.image)) {
    return false;
  }

  const paper =
    p.category === "Papelería" &&
    p.subcategory === "Papel higiénico";

  if (!paper &&
      (p.manga_price || p.packs_per_manga)) {
    return false;
  }

  if (paper) {
    const hasPrice = p.manga_price > 0;
    const hasQuantity = p.packs_per_manga > 0;

    if (hasPrice !== hasQuantity) return false;
  }

  return true;
}

function categoryValid(p) {
  return p &&
    typeof p.name === "string" &&
    !!p.name.trim() &&
    p.name.length <= 100 &&
    validImage(p.image) &&
    Number.isSafeInteger(p.position);
}

async function cloudinarySignature(params, secret) {
  const text = Object.keys(params)
    .sort()
    .map(k => k + "=" + params[k])
    .join("&") + secret;

  const digest = await crypto.subtle.digest(
    "SHA-1",
    enc.encode(text)
  );

  return [...new Uint8Array(digest)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

async function uploadImage(request, env) {
  if (!env.CLOUDINARY_API_KEY ||
      !env.CLOUDINARY_API_SECRET) {
    return json({
      error: "Falta configurar Cloudinary"
    }, 503);
  }

  const length = Number(
    request.headers.get("Content-Length") || 0
  );

  if (length > 6 * 1024 * 1024) {
    return json({
      error: "Archivo demasiado grande"
    }, 413);
  }

  const contentType =
    request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().startsWith(
    "multipart/form-data;"
  )) {
    return json({
      error: "Formato de carga no permitido"
    }, 400);
  }

  const form = await request.formData()
    .catch(() => null);

  const file = form?.get("file");

  if (!(file instanceof File) ||
      file.size === 0 ||
      file.size > 5 * 1024 * 1024 ||
      ![
        "image/png",
        "image/jpeg",
        "image/webp"
      ].includes(file.type)) {
    return json({
      error: "Usa PNG, JPG o WebP de máximo 5 MB"
    }, 400);
  }

  const bytes = new Uint8Array(
    await file.slice(0, 12).arrayBuffer()
  );

  const jpeg = bytes[0] === 255 &&
    bytes[1] === 216 && bytes[2] === 255;

  const png = bytes[0] === 137 &&
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
    (file.type === "image/jpeg" && jpeg) ||
    (file.type === "image/png" && png) ||
    (file.type === "image/webp" && webp)
  )) {
    return json({
      error: "El archivo no es una imagen válida"
    }, 400);
  }

  const params = {
    folder: "brusaam-productos",
    timestamp: String(Math.floor(Date.now() / 1000))
  };

  const signature = await cloudinarySignature(
    params,
    env.CLOUDINARY_API_SECRET
  );

  const body = new FormData();
  body.append("file", file, file.name);
  body.append("folder", params.folder);
  body.append("timestamp", params.timestamp);
  body.append("api_key", env.CLOUDINARY_API_KEY);
  body.append("signature", signature);

  const response = await fetch(
    "https://api.cloudinary.com/v1_1/" +
    CONFIG.cloud + "/image/upload",
    { method: "POST", body }
  );

  const result = await response.json()
    .catch(() => null);

  if (!response.ok ||
      !result?.secure_url ||
      !result.secure_url.startsWith(
        "https://res.cloudinary.com/" +
        CONFIG.cloud + "/"
      )) {
    return json({
      error: "No se pudo subir la fotografía"
    }, 502);
  }

  return json({ url: result.secure_url });
}

/* SERVIDOR */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === "/" && method === "GET") {
        return page(SHOP_HTML);
      }

      if (path === "/admin" && method === "GET") {
        return page(ADMIN_HTML);
      }

      if (path === "/api/admin/session" &&
          method === "GET") {
        return json({
          authenticated: await authenticated(
            request, env
          )
        });
      }

      if (path === "/api/shop" &&
          method === "GET") {
        await setup(env);
        return json(await shopData(env));
      }

      if (path === "/api/productos" &&
          method === "GET") {
        await setup(env);
        const d = await shopData(env);
        return json(d.products);
      }

      if (!path.startsWith("/api/admin/")) {
        return json({
          error: "Ruta no encontrada"
        }, 404);
      }

      if (!env.DB ||
          !env.ADMIN_PASSWORD ||
          !env.SESSION_SECRET) {
        return json({
          error: "Falta configuración del administrador"
        }, 503);
      }

      if (method !== "GET" &&
          !sameOrigin(request)) {
        return json({
          error: "Origen no permitido"
        }, 403);
      }

      if (path === "/api/admin/login" &&
          method === "POST") {
        await setup(env);

        const ip =
          request.headers.get("CF-Connecting-IP") ||
          "unknown";

        const attempts = await env.DB.prepare(`
          SELECT failures,until_ms
          FROM login_attempts WHERE ip=?
        `).bind(ip).first() || {
          failures: 0,
          until_ms: 0
        };

        if (attempts.failures >= 5 &&
            attempts.until_ms > Date.now()) {
          return json({
            error:
              "Demasiados intentos. Espera 15 minutos."
          }, 429);
        }

        const body = await request.json()
          .catch(() => ({}));

        const entered =
          typeof body.password === "string"
            ? body.password
            : "";

        const hashA = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256", enc.encode(entered)
          )
        );

        const hashB = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            enc.encode(env.ADMIN_PASSWORD)
          )
        );

        let diff = 0;
        for (let i = 0; i < hashA.length; i++) {
          diff |= hashA[i] ^ hashB[i];
        }

        if (diff !== 0) {
          const count =
            attempts.until_ms < Date.now()
              ? 1
              : attempts.failures + 1;

          await env.DB.prepare(`
            INSERT INTO login_attempts
            (ip,failures,until_ms)
            VALUES(?,?,?)
            ON CONFLICT(ip)
            DO UPDATE SET
             failures=excluded.failures,
             until_ms=excluded.until_ms
          `).bind(
            ip,
            count,
            Date.now() + 15 * 60 * 1000
          ).run();

          return json({
            error: "Contraseña incorrecta"
          }, 401);
        }

        await env.DB.prepare(`
          DELETE FROM login_attempts WHERE ip=?
        `).bind(ip).run();

        const expires = String(
          Date.now() + 8 * 60 * 60 * 1000
        );

        const sig = await signature(
          expires,
          env.SESSION_SECRET
        );

        return json({ ok: true }, 200, {
          "Set-Cookie":
            CONFIG.cookie + "=" +
            expires + "." + sig +
            "; HttpOnly; Secure; SameSite=Strict;" +
            " Path=/; Max-Age=28800"
        });
      }

      if (path === "/api/admin/logout" &&
          method === "POST") {
        return json({ ok: true }, 200, {
          "Set-Cookie":
            CONFIG.cookie +
            "=; HttpOnly; Secure; SameSite=Strict;" +
            " Path=/; Max-Age=0"
        });
      }

      if (!await authenticated(request, env)) {
        return json({
          error: "Debes iniciar sesión"
        }, 401);
      }

      if (path === "/api/admin/upload" &&
          method === "POST") {
        return uploadImage(request, env);
      }

      await setup(env);

      if (path === "/api/admin/data" &&
          method === "GET") {
        return json(await shopData(env, true));
      }

      const productId = path.match(
        /^\/api\/admin\/products\/(\d+)$/
      );

      if (path === "/api/admin/products" &&
          method === "POST") {
        const p = await request.json()
          .catch(() => null);

        if (!productValid(p)) {
          return json({
            error: "Revisa los datos del producto"
          }, 400);
        }

        const result = await env.DB.prepare(`
          INSERT INTO products
          (
           name,category,subcategory,description,
           retail,wholesale,min_qty,stock,image,
           active,destacados,pack_ahorro,ofertas,
           box_pyme,manga_price,packs_per_manga
          )
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
          p.manga_price,
          p.packs_per_manga
        ).run();

        return json({
          ok: true,
          id: result.meta.last_row_id
        });
      }

      if (productId && method === "PUT") {
        const p = await request.json()
          .catch(() => null);

        if (!productValid(p)) {
          return json({
            error: "Revisa los datos del producto"
          }, 400);
        }

        await env.DB.prepare(`
          UPDATE products SET
           name=?,category=?,subcategory=?,
           description=?,retail=?,wholesale=?,
           min_qty=?,stock=?,image=?,active=?,
           destacados=?,pack_ahorro=?,ofertas=?,
           box_pyme=?,manga_price=?,packs_per_manga=?
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
          p.manga_price,
          p.packs_per_manga,
          Number(productId[1])
        ).run();

        return json({ ok: true });
      }

      if (productId && method === "DELETE") {
        await env.DB.prepare(`
          DELETE FROM products WHERE id=?
        `).bind(Number(productId[1])).run();

        return json({ ok: true });
      }

      const section = path.match(
        /^\/api\/admin\/sections\/([a-z_]+)$/
      );

      if (section && method === "PUT") {
        const slug = section[1];

        if (!SECTIONS.some(s => s[0] === slug)) {
          return json({
            error: "Sección no válida"
          }, 400);
        }

        const body = await request.json()
          .catch(() => null);

        if (!body || !validImage(body.image)) {
          return json({
            error: "Imagen no válida"
          }, 400);
        }

        await env.DB.prepare(`
          UPDATE shop_sections
          SET image=? WHERE slug=?
        `).bind(body.image, slug).run();

        return json({ ok: true });
      }

      const setting = path.match(
        /^\/api\/admin\/settings\/(logo|design)$/
      );

      if (setting && method === "PUT") {
        const key = setting[1];
        const body = await request.json()
          .catch(() => null);

        if (!body ||
            !validImage(body.value) ||
            (key === "logo" && !body.value)) {
          return json({
            error: "URL de imagen no válida"
          }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO shop_settings(key,value)
          VALUES(?,?)
          ON CONFLICT(key)
          DO UPDATE SET value=excluded.value
        `).bind(key, body.value).run();

        return json({ ok: true });
      }

      const categoryId = path.match(
        /^\/api\/admin\/categories\/(\d+)$/
      );

      if (path === "/api/admin/categories" &&
          method === "POST") {
        const p = await request.json()
          .catch(() => null);

        if (!categoryValid(p)) {
          return json({
            error: "Datos de categoría inválidos"
          }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO shop_categories
          (name,image,position) VALUES(?,?,?)
        `).bind(
          p.name.trim(),p.image,p.position
        ).run();

        return json({ ok: true });
      }

      if (categoryId && method === "PUT") {
        const p = await request.json()
          .catch(() => null);

        if (!categoryValid(p)) {
          return json({
            error: "Datos de categoría inválidos"
          }, 400);
        }

        const id = Number(categoryId[1]);

        const old = await env.DB.prepare(`
          SELECT name FROM shop_categories WHERE id=?
        `).bind(id).first();

        if (!old) {
          return json({
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
            UPDATE products
            SET category=?
            WHERE category=?
          `).bind(p.name.trim(),old.name)
        ]);

        return json({ ok: true });
      }

      if (categoryId && method === "DELETE") {
        const id = Number(categoryId[1]);

        const old = await env.DB.prepare(`
          SELECT name FROM shop_categories WHERE id=?
        `).bind(id).first();

        if (!old) {
          return json({
            error: "Categoría no encontrada"
          }, 404);
        }

        const count = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM products WHERE category=?
        `).bind(old.name).first();

        if (count.total > 0) {
          return json({
            error:
              "La categoría tiene productos. " +
              "Cámbialos antes de eliminarla."
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

        return json({ ok: true });
      }

      const subId = path.match(
        /^\/api\/admin\/subcategories\/(\d+)$/
      );

      if (path === "/api/admin/subcategories" &&
          method === "POST") {
        const p = await request.json()
          .catch(() => null);

        if (!categoryValid(p) ||
            !integer(p.category_id, 1)) {
          return json({
            error: "Datos de subcategoría inválidos"
          }, 400);
        }

        const category = await env.DB.prepare(`
          SELECT id FROM shop_categories WHERE id=?
        `).bind(p.category_id).first();

        if (!category) {
          return json({
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

        return json({ ok: true });
      }

      if (subId && method === "PUT") {
        const p = await request.json()
          .catch(() => null);

        if (!categoryValid(p) ||
            !integer(p.category_id, 1)) {
          return json({
            error: "Datos de subcategoría inválidos"
          }, 400);
        }

        const id = Number(subId[1]);

        const old = await env.DB.prepare(`
          SELECT s.name,c.name AS category
          FROM shop_subcategories s
          JOIN shop_categories c
           ON c.id=s.category_id
          WHERE s.id=?
        `).bind(id).first();

        const nextCategory = await env.DB.prepare(`
          SELECT name FROM shop_categories WHERE id=?
        `).bind(p.category_id).first();

        if (!old || !nextCategory) {
          return json({
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
            nextCategory.name,
            p.name.trim(),
            old.category,
            old.name
          )
        ]);

        return json({ ok: true });
      }

      if (subId && method === "DELETE") {
        const id = Number(subId[1]);

        const old = await env.DB.prepare(`
          SELECT s.name,c.name AS category
          FROM shop_subcategories s
          JOIN shop_categories c
           ON c.id=s.category_id
          WHERE s.id=?
        `).bind(id).first();

        if (!old) {
          return json({
            error: "Subcategoría no encontrada"
          }, 404);
        }

        const count = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM products
          WHERE category=? AND subcategory=?
        `).bind(old.category,old.name).first();

        if (count.total > 0) {
          return json({
            error:
              "Esta subcategoría tiene productos. " +
              "Cámbialos antes de eliminarla."
          }, 409);
        }

        await env.DB.prepare(`
          DELETE FROM shop_subcategories WHERE id=?
        `).bind(id).run();

        return json({ ok: true });
      }

      return json({
        error: "Ruta no encontrada"
      }, 404);

    } catch (error) {
      console.error("BRUSAAM:", error);

      if (String(error.message).includes(
        "UNIQUE constraint failed"
      )) {
        return json({
          error: "Ya existe un registro con ese nombre"
        }, 409);
      }

      return json({
        error:
          "Error interno. Revisa los registros de Cloudflare."
      }, 500);
    }
  }
};
