
/*
 BRUSAAM - TIENDA ONLINE
 Versión completa con diseño floral aprobado.

 Cloudflare Workers + D1 + Cloudinary

 Binding D1: DB

 Secretos necesarios:
 ADMIN_PASSWORD
 SESSION_SECRET
 CLOUDINARY_API_KEY
 CLOUDINARY_API_SECRET

 WhatsApp: +56 9 6628 2007
*/

const BR = {
  cloud: "oobzcqc2",
  whatsapp: "56966282007",
  instagram:
    "https://www.instagram.com/comercializadora_brusaam/",
  tiktok:
    "https://www.tiktok.com/@com_brusaam",
  logo:
    "https://res.cloudinary.com/oobzcqc2/image/upload/IMG_20260517_093131_502.webp",
  cookie: "brusaam_session"
};

const GROUPS = [
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

const encoder = new TextEncoder();

function reply(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

function validImage(value) {
  return (
    typeof value === "string" &&
    value.length <= 1500 &&
    (
      value === "" ||
      /^https:\/\/[^\s"'<>]+$/i.test(value)
    )
  );
}

function validInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) &&
    value >= minimum;
}

function base64url(bytes) {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }

  return btoa(text)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sign(text, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const result = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(text)
  );

  return base64url(new Uint8Array(result));
}

function cookie(request) {
  const value = request.headers.get("Cookie") || "";

  const entry = value
    .split(";")
    .map(x => x.trim())
    .find(x => x.startsWith(BR.cookie + "="));

  return entry
    ? entry.slice(BR.cookie.length + 1)
    : "";
}

async function loggedIn(request, env) {
  if (!env.SESSION_SECRET) return false;

  const pieces = cookie(request).split(".");

  if (pieces.length !== 2) return false;

  const [expires, received] = pieces;

  if (
    !/^\d{13}$/.test(expires) ||
    Number(expires) <= Date.now()
  ) {
    return false;
  }

  const expected = await sign(
    expires,
    env.SESSION_SECRET
  );

  if (expected.length !== received.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < expected.length; i++) {
    difference |=
      expected.charCodeAt(i) ^
      received.charCodeAt(i);
  }

  return difference === 0;
}

function checkOrigin(request) {
  return request.headers.get("Origin") ===
    new URL(request.url).origin;
}

/* BASE DE DATOS */

async function initialize(env) {
  if (!env.DB) {
    throw Error("No está configurado el binding DB");
  }

  const information = await env.DB.prepare(
    "PRAGMA table_info(products)"
  ).all();

  if (!information.results?.length) {
    throw Error(
      "No existe la tabla products en D1"
    );
  }

  const existing = new Set(
    information.results.map(x => x.name)
  );

  const newColumns = [
    ["subcategory", "TEXT NOT NULL DEFAULT ''"],
    ["destacados", "INTEGER NOT NULL DEFAULT 0"],
    ["pack_ahorro", "INTEGER NOT NULL DEFAULT 0"],
    ["ofertas", "INTEGER NOT NULL DEFAULT 0"],
    ["box_pyme", "INTEGER NOT NULL DEFAULT 0"],
    ["manga_price", "INTEGER NOT NULL DEFAULT 0"],
    ["packs_per_manga", "INTEGER NOT NULL DEFAULT 0"]
  ];

  for (const [column, definition] of newColumns) {
    if (!existing.has(column)) {
      try {
        await env.DB.prepare(
          `ALTER TABLE products ADD COLUMN ${column} ${definition}`
        ).run();
      } catch (error) {
        if (
          !String(error.message).includes(
            "duplicate column"
          )
        ) {
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

  for (const [slug, title] of GROUPS) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO shop_sections
      (slug,title,image)
      VALUES(?,?,'')
    `).bind(slug, title).run();
  }

  for (const [key, value] of [
    ["logo", BR.logo],
    ["design", ""]
  ]) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO shop_settings
      (key,value) VALUES(?,?)
    `).bind(key, value).run();
  }

  const count = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM shop_categories
  `).first();

  if (Number(count.total) === 0) {
    let position = 0;

    for (const [category, subs] of
      Object.entries(DEFAULT_CATEGORIES)) {

      await env.DB.prepare(`
        INSERT OR IGNORE INTO shop_categories
        (name,position)
        VALUES(?,?)
      `).bind(category, position++).run();

      const record = await env.DB.prepare(`
        SELECT id FROM shop_categories
        WHERE name=?
      `).bind(category).first();

      let subPosition = 0;

      for (const name of subs) {
        await env.DB.prepare(`
          INSERT OR IGNORE INTO shop_subcategories
          (category_id,name,position)
          VALUES(?,?,?)
        `).bind(
          record.id,
          name,
          subPosition++
        ).run();
      }
    }
  }
}

async function getData(env, admin = false) {
  const [
    products,
    categories,
    subcategories,
    sections,
    settings
  ] = await Promise.all([
    env.DB.prepare(
      admin
        ? "SELECT * FROM products ORDER BY id DESC"
        : `SELECT * FROM products
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

  const preferences = Object.fromEntries(
    (settings.results || []).map(
      item => [item.key, item.value]
    )
  );

  return {
    products: products.results || [],
    categories: categories.results || [],
    subcategories: subcategories.results || [],
    sections: sections.results || [],
    logo: preferences.logo || BR.logo,
    design: preferences.design || ""
  };
}

/* ILUSTRACIONES FLORALES */

const FLORAL_TOP = `
<svg viewBox="0 0 1200 190"
 preserveAspectRatio="none"
 xmlns="http://www.w3.org/2000/svg"
 aria-hidden="true">
<defs>
 <linearGradient id="waveTop"
  x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#20D5E4"/>
  <stop offset=".52" stop-color="#168DEB"/>
  <stop offset="1" stop-color="#7731E8"/>
 </linearGradient>
 <linearGradient id="petalTop"
  x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#E1B6FF"/>
  <stop offset="1" stop-color="#7936DB"/>
 </linearGradient>
</defs>

<path d="M0 0H1200V80
 C1030 164 880 25 700 74
 C510 128 355 19 195 89
 C95 131 40 94 0 116Z"
 fill="url(#waveTop)"/>

<path d="M0 0H1200V58
 C1015 134 866 55 710 103
 C520 155 350 66 170 118
 C90 142 40 119 0 139Z"
 fill="#7B3AE0" opacity=".32"/>

<path d="M0 0H1200V32
 C1020 109 850 10 680 51
 C470 98 350 8 185 61
 C105 86 35 57 0 72Z"
 fill="#FFFFFF" opacity=".16"/>

<g fill="url(#petalTop)" opacity=".9">
 <path d="M90 37Q55 5 72 0Q115 6 90 37Z"/>
 <path d="M98 41Q123 4 151 13Q146 49 98 41Z"/>
 <path d="M90 48Q43 25 37 55Q67 81 90 48Z"/>
 <path d="M1090 37Q1044 3 1050 0Q1100 0 1090 37Z"/>
 <path d="M1103 43Q1145 0 1183 8Q1174 53 1103 43Z"/>
 <path d="M1089 54Q1035 40 1025 72Q1062 96 1089 54Z"/>
 <path d="M1140 83Q1170 59 1193 75Q1173 106 1140 83Z"/>
</g>

<g fill="#C5A5F5" opacity=".55">
 <path d="M225 99Q195 65 179 77Q190 113 225 99Z"/>
 <path d="M230 101Q248 71 270 79Q265 111 230 101Z"/>
 <path d="M955 93Q918 66 906 82Q920 109 955 93Z"/>
 <path d="M965 96Q987 68 1010 80Q997 108 965 96Z"/>
</g>
</svg>`;

const FLORAL_BOTTOM = `
<svg viewBox="0 0 1200 190"
 preserveAspectRatio="none"
 xmlns="http://www.w3.org/2000/svg"
 aria-hidden="true">
<defs>
 <linearGradient id="waveBottom"
  x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#25D2E4"/>
  <stop offset=".52" stop-color="#178CEB"/>
  <stop offset="1" stop-color="#7630E6"/>
 </linearGradient>
</defs>

<path d="M0 95
 C165 22 310 166 485 105
 C650 49 785 134 920 71
 C1030 21 1120 72 1200 35
 V190H0Z"
 fill="url(#waveBottom)" opacity=".84"/>

<path d="M0 132
 C175 64 305 170 480 127
 C650 84 790 169 945 110
 C1070 65 1140 106 1200 86
 V190H0Z"
 fill="#7136D9" opacity=".47"/>

<path d="M0 164
 C160 105 340 191 520 152
 C710 112 830 192 1000 143
 C1100 112 1155 148 1200 139
 V190H0Z"
 fill="#FFFFFF"/>

<g fill="#9859E8" opacity=".88">
 <path d="M105 111Q55 57 75 38Q126 52 105 111Z"/>
 <path d="M110 113Q146 55 183 68Q165 118 110 113Z"/>
 <path d="M98 121Q42 88 24 124Q61 156 98 121Z"/>
 <path d="M1090 90Q1044 38 1063 22Q1117 38 1090 90Z"/>
 <path d="M1099 97Q1144 46 1180 65Q1164 111 1099 97Z"/>
 <path d="M1082 105Q1023 79 1010 113Q1049 141 1082 105Z"/>
</g>

<g fill="#D6B8FA" opacity=".75">
 <path d="M280 136Q251 98 230 111Q246 146 280 136Z"/>
 <path d="M285 139Q308 104 335 119Q318 151 285 139Z"/>
 <path d="M870 111Q838 76 817 91Q834 125 870 111Z"/>
 <path d="M879 115Q902 82 929 96Q911 126 879 115Z"/>
</g>
</svg>`;

/* PÁGINA Y ESTILOS */

function htmlPage(content, admin = false) {
  const floralHeader = admin ? "" :
    `<div class="floralTop">${FLORAL_TOP}</div>`;

  const floralFooter = admin ? "" :
    `<div class="floralBottom">${FLORAL_BOTTOM}</div>`;

  return new Response(`<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport"
 content="width=device-width,initial-scale=1">
<title>Brusaam | La excelencia en tu hogar</title>
<style>
:root{
 --purple:#6725C7;
 --purpleDark:#5420A8;
 --blue:#078ED5;
 --navy:#142D65;
 --bg:#F7F9FE;
 --line:#E2E7F2;
}
*{box-sizing:border-box}
body{
 margin:0;
 background:var(--bg);
 color:var(--navy);
 font-family:Arial,Helvetica,sans-serif;
}
button,input,select,textarea{font:inherit}
button{
 border:0;
 border-radius:9px;
 padding:10px 13px;
 background:var(--purple);
 color:white;
 font-weight:700;
 cursor:pointer;
}
button:hover:not(:disabled){filter:brightness(.96)}
button:disabled{opacity:.45;cursor:not-allowed}
button.secondary{
 background:#F0E8FD;
 color:var(--purple);
}
button.danger{background:#B53659}
button.small{padding:6px 9px;font-size:12px}
input,select,textarea{
 width:100%;
 padding:10px;
 border:1px solid #CDD6E5;
 border-radius:9px;
 margin:6px 0 12px;
 background:white;
 color:var(--navy);
}
input[type=checkbox]{width:auto;margin-right:8px}
label{display:block;font-weight:600}
h1,h2,h3{color:var(--navy)}
a{color:var(--purple)}
.muted{font-size:12px;color:#677795;line-height:1.5}
.hidden{display:none!important}
.flex{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.grow{flex:1}
.flowerHeader{
 background:#FFFFFF;
 text-align:center;
 overflow:hidden;
 padding-bottom:20px;
}
.floralTop{
 width:100%;
 line-height:0;
}
.floralTop svg{
 width:100%;
 height:clamp(105px,14vw,190px);
 display:block;
}
.logo{
 display:block;
 width:min(210px,55%);
 max-height:125px;
 object-fit:contain;
 margin:0 auto 4px;
}
.slogan{color:#697895;font-size:13px}
.banner{
 max-width:460px;
 margin:14px auto 0;
 padding:13px 18px;
 border-radius:30px;
 background:linear-gradient(100deg,#F3EBFF,#ECF6FF);
}
.banner strong{
 display:block;
 font-size:21px;
 color:var(--purple);
 margin:4px 0;
}
main{
 max-width:1320px;
 margin:auto;
 padding:15px 20px 26px;
}
.welcome{
 text-align:center;
 margin:5px 0 17px;
 font-size:23px;
}
.search{
 max-width:1100px;
 margin:0 auto 22px;
 position:relative;
}
.search input{
 height:49px;
 border-radius:30px;
 padding-left:44px;
 font-size:15px;
 box-shadow:0 2px 8px #16295708;
}
.search span{
 position:absolute;
 left:16px;
 top:15px;
 font-size:22px;
 color:var(--purple);
}

.shopLayout{
 display:grid;
 grid-template-columns:minmax(0,1fr);
 gap:18px;
 align-items:start;
}
.shopLeft,.shopRight{min-width:0}
.shopRight{margin:0}
#customerPanel{max-width:960px;margin:20px auto 0}
.backButton{margin:0 0 12px;display:inline-flex;align-items:center;gap:5px}
.footerAddress{font-size:14px;line-height:1.7}
.shopBottom{
 display:grid;
 grid-template-columns:1fr 1fr;
 gap:18px;
 align-items:start;
 margin-top:18px;
}
.shopLeft h2{
 font-size:20px;
 margin:20px 0 12px;
}
.shopLeft #home h2:first-child{margin-top:0}
.tiles{
 display:grid;
 grid-template-columns:repeat(4,minmax(0,1fr));
 gap:12px;
}
.tile{
 padding:0;
 border:1px solid #E8ECF6;
 border-radius:13px;
 background:white;
 color:var(--navy);
 text-align:center;
 overflow:hidden;
 box-shadow:0 3px 12px #14234B09;
}
.tile img{
 display:block;
 width:100%;
 height:125px;
 object-fit:contain;
 padding:8px;
 background:linear-gradient(135deg,#EDF9FD,#F7EAFF);
}
.tile .placeholder{
 height:125px;
 display:grid;
 place-items:center;
 font-size:39px;
 background:linear-gradient(135deg,#E5F8FC,#F5E6FF);
}
.tile strong{
 display:block;
 padding:11px 7px;
 font-size:13px;
 line-height:1.35;
}
.grid{
 display:grid;
 grid-template-columns:repeat(4,minmax(0,1fr));
 gap:12px;
}
.product{
 background:white;
 border:1px solid #E3E8F3;
 border-radius:13px;
 padding:11px;
 display:flex;
 flex-direction:column;
 gap:7px;
 box-shadow:0 3px 10px #14234B09;
}
.product img{
 width:100%;
 height:145px;
 object-fit:contain;
}
.product h3{
 font-size:14px;
 line-height:1.35;
 min-height:38px;
 margin:2px 0;
}
.price{
 font-size:19px;
 font-weight:800;
 color:#086AD6;
}
.product button{
 margin-top:auto;
 background:linear-gradient(100deg,#6B29CE,#7936E0);
 font-size:12px;
}
.product input,.product select{
 font-size:13px;
 padding:8px;
 margin:3px 0;
}
.panel{
 background:white;
 border:1px solid #E9EDF6;
 border-radius:16px;
 padding:16px;
 box-shadow:0 5px 22px #1A31600A;
 margin:0;
}
.panel h2,.panel h3{
 font-size:19px;
 margin:2px 0 15px;
}
.featuredPanel{
 margin-top:16px;
}
.featuredPanel .flex{margin-bottom:12px}
.featuredPanel h2{margin:0}
.filters{
 display:grid;
 grid-template-columns:1fr 1fr;
 gap:12px;
}
.catalogPanel{margin-top:17px}
.shopRight .panel{
 position:static;
}
.cartrow{
 display:flex;
 gap:9px;
 padding:13px 0;
 border-bottom:1px solid var(--line);
 align-items:flex-start;
}
.cartrow img{
 width:55px;
 height:67px;
 object-fit:contain;
}
.cartinfo{flex:1;min-width:0}
.cartinfo strong{font-size:13px}
.cartinfo .price{font-size:16px}
.summary{
 display:flex;
 justify-content:space-between;
 gap:12px;
 padding:10px 0;
 font-size:13px;
}
.summary.total{
 border-top:1px solid var(--line);
 font-size:17px;
 font-weight:bold;
}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{
 padding:11px 9px;
 border-bottom:1px solid var(--line);
 text-align:left;
}
th{background:#F0EAFD}
.scroll{overflow-x:auto}
.notice{
 background:#F4EFFD;
 color:#553198;
 border-radius:9px;
 padding:12px;
 font-size:13px;
}
#checkout{
 width:100%;
 padding:14px 10px;
 background:linear-gradient(100deg,#6925CE,#7C35E0);
}
footer{
 background:white;
 margin-top:25px;
 text-align:center;
}
.floralBottom{line-height:0}
.floralBottom svg{
 display:block;
 width:100%;
 height:clamp(105px,14vw,180px);
}
.footerContent{padding:10px 16px 27px}
.footerContent h3{
 color:var(--purple);
 font-size:24px;
 letter-spacing:1px;
}
.social{
 display:flex;
 justify-content:center;
 flex-wrap:wrap;
 gap:10px;
}
.social a{
 background:#F2EBFC;
 border-radius:12px;
 padding:11px 16px;
 font-weight:700;
 text-decoration:none;
}
.adminTabs{
 display:flex;
 gap:8px;
 flex-wrap:wrap;
 margin:15px 0;
}
.adminTabs button{
 background:#EFE8FB;
 color:var(--purple);
}
.adminTabs button.active{
 background:var(--purple);
 color:white;
}
.adminRow{
 display:flex;
 align-items:center;
 gap:10px;
 padding:12px 0;
 border-bottom:1px solid var(--line);
 flex-wrap:wrap;
}
.adminRow img{
 width:65px;
 height:65px;
 object-fit:contain;
}
.adminRow strong{flex:1}
.adminArea{max-width:1050px;margin:auto}
.adminArea .panel{margin:15px 0}
.checkLabel{font-weight:400;margin:8px 0}
.adminPhoto{
 max-width:170px;
 max-height:120px;
 object-fit:contain;
}
@media(max-width:1120px){
 .grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media(max-width:850px){
 .shopLayout,.shopBottom{grid-template-columns:1fr}
 .shopRight .panel{position:static}
 .grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media(max-width:600px){
 main{padding:12px 10px 22px}
 .welcome{font-size:20px}
 .tiles,.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
 .tile img,.tile .placeholder{height:112px}
 .product img{height:120px}
 .product h3{font-size:13px}
 .product .price{font-size:17px}
 .shopLeft h2{font-size:19px}
 .panel{padding:13px}
 .floralTop svg{height:110px}
 .floralBottom svg{height:115px}
 .filters{grid-template-columns:1fr}
 .banner strong{font-size:19px}
}
</style>
</head>
<body>
<header class="flowerHeader">
${floralHeader}
<img id="shopLogo" class="logo"
 src="${BR.logo}" alt="Logo Brusaam">
<div class="slogan">La excelencia en tu hogar</div>
${admin ? "" : `
<div class="banner">
 <div>🚚 BENEFICIO ESPECIAL</div>
 <strong>¡DESPACHO GRATIS!</strong>
 <div>La Serena y Coquimbo desde $30.000</div>
</div>`}
</header>
<main>${content}</main>
<footer>
${floralFooter}
<div class="footerContent">
<h3>Haz tus pedidos</h3>
<p>¡Síguenos en nuestras redes sociales!</p>
<div class="social">
<a href="https://wa.me/${BR.whatsapp}"
 target="_blank" rel="noopener noreferrer">
 💬 WhatsApp
</a>
<a href="${BR.instagram}"
 target="_blank" rel="noopener noreferrer">
 📸 Instagram
</a>
<a href="${BR.tiktok}"
 target="_blank" rel="noopener noreferrer">
 🎵 TikTok
</a>
</div>
<p class="footerAddress">📍 Dirección: Nueva Vida, Pan de Azúcar, Coquimbo</p>
<p class="footerAddress">📞 Contacto: +56 9 6628 2007</p>
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

/* CONTENIDO DE LA TIENDA */

const SHOP = String.raw`
<h1 class="welcome">Bienvenido a Brusaam</h1>

<div class="search">
 <span>⌕</span>
 <input id="search"
  placeholder="Buscar productos, marcas o categorías...">
</div>

<div class="shopLayout">
 <div class="shopLeft">

  <div id="home">
   <h2>Nuestras categorías</h2>
   <div id="categoryTiles" class="tiles"></div>

   <h2>Secciones especiales</h2>
   <div id="sectionTiles" class="tiles"></div>

   <div id="featuredAreas"></div>
  </div>

  <section class="panel catalogPanel"
   id="catalogSection">
   <div class="flex">
    <h2 class="grow" id="catalogTitle">
     Todos los productos
    </h2>
    <button class="secondary backButton" id="backHome">
     ← Volver atrás
    </button>
   </div>

   <div id="subTiles" class="tiles"
    style="margin-bottom:14px"></div>

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

 </div>
</div>

<div class="shopBottom">
 <aside class="shopRight">
  <section class="panel">
   <h2>🛒 Mi carrito</h2>

   <div id="cartItems"></div>

   <div class="summary">
    <span>Subtotal productos</span>
    <strong id="subtotal">$0</strong>
   </div>

   <div class="summary">
    <span>Despacho</span>
    <strong id="shipping">
     Por calcular
    </strong>
   </div>

   <div class="summary total">
    <span id="totalLabel">Total productos</span>
    <span id="total">$0</span>
   </div>

   <button id="goCheckout" style="width:100%">
    💬 Continuar pedido
   </button>
  </section>
 </aside>

 <section class="panel">
  <h3>🚚 Condiciones y tarifas de despacho</h3>

  <div class="scroll">
   <table>
    <thead>
    <tr>
      <th>Modalidad o zona</th>
      <th>Tarifa</th>
    </tr>
    </thead>
    <tbody>
    <tr>
      <td>Retiro</td>
      <td><strong>Gratis</strong></td>
    </tr>
    <tr>
      <td>Pan de Azúcar (excluye Cruz de Caña)</td>
      <td><strong>Gratis</strong></td>
    </tr>
    <tr>
      <td>La Serena</td>
      <td>$2.000</td>
    </tr>
    <tr>
      <td>Coquimbo</td>
      <td>$1.500</td>
    </tr>
    <tr>
     <td>
       La Serena y Coquimbo,
       compras desde $30.000
     </td>
      <td><strong>Gratis</strong></td>
    </tr>
    <tr>
      <td>Otras regiones y comunas</td>
      <td>Envío por pagar</td>
    </tr>
    </tbody>
   </table>
  </div>
  <p class="muted">El despacho gratis de Pan de Azúcar se aplica también a direcciones que indiquen Nueva Vida, excepto Cruz de Caña.</p>
 </section>
</div>

<section class="panel" id="customerPanel">
 <h3>👤 Datos del solicitante</h3>

 <label>Nombre y apellido *
  <input id="customer" maxlength="120">
 </label>

 <label>
  Modalidad (Retiro o Entrega a Domicilio) *
  <select id="mode">
   <option value="delivery">
    Entrega a Domicilio
   </option>
   <option value="pickup">
    Retiro
   </option>
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

 <p class="notice" id="shippingNotice">
  Completa tus datos para calcular el despacho.
 </p>

 <button id="checkout">
  💬 Enviar pedido por WhatsApp
 </button>

 <p class="muted">
  Brusaam confirmará disponibilidad,
  pago y coordinación del pedido.
 </p>
</section>

<script>
const $ = id => document.getElementById(id);

const money = value =>
 '$' + Math.round(Number(value) || 0)
 .toLocaleString('es-CL');

let store = {
 products: [],
 categories: [],
 subcategories: [],
 sections: []
};

let cart = {};
let currentSection = '';

function normalized(text) {
 return String(text || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()
  .replace(/\s+/g, ' ');
}

function node(tag, text) {
 const element = document.createElement(tag);
 if (text !== undefined) {
  element.textContent = text;
 }
 return element;
}

function photo(url, alt) {
 const element = node('img');
 element.src = url;
 element.alt = alt;
 element.loading = 'lazy';
 return element;
}

function decorate(data) {
 if (data.logo) {
  $('shopLogo').src = data.logo;
 }

 if (data.design) {
  const banner = document.querySelector('.banner');

  if (banner) {
   banner.style.backgroundImage =
    'linear-gradient(90deg,' +
    'rgba(250,247,255,.94),' +
    'rgba(240,249,255,.92)),' +
    'url(' + JSON.stringify(data.design) + ')';

   banner.style.backgroundSize = 'cover';
   banner.style.backgroundPosition = 'center';
  }
 }
}

function makeTile(title, image, icon, action) {
 const button = node('button');
 button.className = 'tile';

 if (image) {
  button.append(photo(image, title));
 } else {
  const placeholder = node('div', icon || '📦');
  placeholder.className = 'placeholder';
  button.append(placeholder);
 }

 button.append(node('strong', title));
 button.onclick = action;

 return button;
}

function paperProduct(product) {
 return normalized(product.category) === 'papeleria' &&
  normalized(product.subcategory) === 'papel higienico';
}

function mangaAvailable(product) {
 return paperProduct(product) &&
  Number(product.manga_price) > 0 &&
  Number(product.packs_per_manga) > 0;
}

function priceFor(product, kind, quantity) {
 if (kind === 'manga') {
  return Number(product.manga_price);
 }

 const minimum = Number(product.min_qty) || 2;

 return quantity >= minimum
  ? Number(product.wholesale)
  : Number(product.retail);
}

function stockUsed(id) {
 let used = 0;

 const product = store.products.find(
  item => String(item.id) === String(id)
 );

 if (!product) return 0;

 for (const [key, quantity] of Object.entries(cart)) {
  const [productId, kind] = key.split(':');

  if (productId !== String(id)) continue;

  used += quantity * (
   kind === 'manga'
    ? Number(product.packs_per_manga)
    : 1
  );
 }

 return used;
}

function addToCart(id, kind, quantity) {
 const product = store.products.find(
  item => String(item.id) === String(id)
 );

 quantity = Number(quantity);

 if (
  !product ||
  !Number.isSafeInteger(quantity) ||
  quantity < 1
 ) {
  alert('Ingresa una cantidad válida.');
  return;
 }

 if (kind === 'manga' && !mangaAvailable(product)) {
  alert('Manga no disponible.');
  return;
 }

 const units = quantity * (
  kind === 'manga'
   ? Number(product.packs_per_manga)
   : 1
 );

 if (stockUsed(id) + units > Number(product.stock)) {
  alert('No hay stock suficiente.');
  return;
 }

 const key = id + ':' + kind;

 cart[key] = (cart[key] || 0) + quantity;

 renderCart();
}

function productCard(product) {
 const card = node('div');
 card.className = 'product';

 if (product.image) {
  card.append(photo(product.image, product.name));
 } else {
  const empty = node('div', '📦');
  empty.style.cssText =
   'height:145px;display:grid;place-items:center';
  card.append(empty);
 }

 card.append(node('h3', product.name));

 if (product.subcategory) {
  const subtitle = node(
   'div',
   product.subcategory
  );

  subtitle.className = 'muted';
  card.append(subtitle);
 }

 const quantity = node('input');
 quantity.type = 'number';
 quantity.min = '1';
 quantity.step = '1';
 quantity.value = '1';

 let presentation = null;

 if (paperProduct(product)) {
  presentation = node('select');

  presentation.add(
   new Option('Por paquete', 'pack')
  );

  if (mangaAvailable(product)) {
   presentation.add(
    new Option('Por manga', 'manga')
   );
  }

  const amount = node('div');
  amount.className = 'price';

  const details = node('div');
  details.className = 'muted';

  const update = () => {
   if (presentation.value === 'manga') {
    amount.textContent =
     money(product.manga_price) + ' por manga';

    details.textContent =
     product.packs_per_manga +
     ' paquetes por manga';
   } else {
    amount.textContent =
     money(product.retail) + ' por paquete';

    details.textContent =
     'Mayor desde ' +
     (product.min_qty || 2) +
     ': ' + money(product.wholesale) +
     ' c/u';
   }
  };

  presentation.onchange = update;

  card.append(presentation, amount, details);
  update();
 } else {
  const amount = node(
   'div',
   money(product.retail)
  );

  amount.className = 'price';
  card.append(amount);

  const wholesale = node(
   'div',
   'Mayor desde ' +
   (product.min_qty || 2) +
   ': ' + money(product.wholesale) + ' c/u'
  );

  wholesale.className = 'muted';
  card.append(wholesale);
 }

 const stock = node(
  'div',
  'Stock: ' + product.stock +
  (paperProduct(product)
   ? ' paquetes'
   : ' unidades')
 );

 stock.className = 'muted';

 const add = node('button', '🛒 Agregar');
 add.disabled = Number(product.stock) < 1;

 add.onclick = () => {
  addToCart(
   product.id,
   presentation ? presentation.value : 'pack',
   quantity.value
  );
 };

 card.append(stock, quantity, add);

 return card;
}

function renderHome() {
 const categoryRoot = $('categoryTiles');
 categoryRoot.replaceChildren();

 const icons = {
  'Limpieza del hogar': '🧴',
  'Cuidado personal': '🧼',
  'Papelería': '🧻',
  'Otros productos': '📦'
 };

 for (const category of store.categories) {
  categoryRoot.append(makeTile(
   category.name,
   category.image,
   icons[category.name] || '📁',
   () => openCategory(category.name)
  ));
 }

 const sectionRoot = $('sectionTiles');
 sectionRoot.replaceChildren();

 const sectionIcons = {
  destacados: '⭐',
  pack_ahorro: '📦',
  ofertas: '🏷️',
  box_pyme: '🏪'
 };

 for (const section of store.sections) {
  sectionRoot.append(makeTile(
   section.title,
   section.image,
   sectionIcons[section.slug] || '📦',
   () => openSection(section.slug)
  ));
 }

 const featuredRoot = $('featuredAreas');
 featuredRoot.replaceChildren();

 for (const section of store.sections) {
  const products = store.products
   .filter(product =>
    Number(product[section.slug]) === 1
   )
   .slice(0, 4);

  if (!products.length) continue;

  const panel = node('section');
  panel.className = 'panel featuredPanel';

  const heading = node('div');
  heading.className = 'flex';

  const title = node('h2', section.title);
  title.className = 'grow';

  const more = node('button', 'Ver todos →');
  more.className = 'secondary';
  more.onclick = () => openSection(section.slug);

  heading.append(title, more);
  panel.append(heading);

  const grid = node('div');
  grid.className = 'grid';

  for (const product of products) {
   grid.append(productCard(product));
  }

  panel.append(grid);
  featuredRoot.append(panel);
 }
}

function fillCategories() {
 const select = $('filterCategory');
 const previous = select.value;

 select.replaceChildren(
  new Option('Todas las categorías', '')
 );

 for (const category of store.categories) {
  select.add(
   new Option(category.name, category.name)
  );
 }

 if ([...select.options].some(
  option => option.value === previous
 )) {
  select.value = previous;
 }

 fillSubcategories();
}

function fillSubcategories(selected = '') {
 const category = store.categories.find(
  item => item.name === $('filterCategory').value
 );

 const select = $('filterSub');

 select.replaceChildren(
  new Option('Todas las subcategorías', '')
 );

 if (category) {
  for (const sub of store.subcategories.filter(
   item => Number(item.category_id) ===
    Number(category.id)
  )) {
   select.add(new Option(sub.name, sub.name));
  }
 }

 if ([...select.options].some(
  option => option.value === selected
 )) {
  select.value = selected;
 }
}

function renderSubTiles(categoryName) {
 const root = $('subTiles');
 root.replaceChildren();

 const category = store.categories.find(
  item => item.name === categoryName
 );

 if (!category) return;

 for (const sub of store.subcategories.filter(
  item => Number(item.category_id) ===
   Number(category.id)
 )) {
  root.append(makeTile(
   sub.name,
   sub.image,
   '📁',
   () => openCategory(categoryName, sub.name)
  ));
 }
}

function openCategory(category, sub = '') {
 currentSection = '';

 $('search').value = '';
 $('home').classList.add('hidden');

 $('filterCategory').value = category;
 fillSubcategories(sub);

 $('catalogTitle').textContent = sub || category;

 renderSubTiles(category);
 renderProducts();

 $('catalogSection').scrollIntoView({
  behavior: 'smooth'
 });
}

function openSection(slug) {
 currentSection = slug;

 $('search').value = '';
 $('home').classList.add('hidden');

 $('filterCategory').value = '';
 fillSubcategories();

 $('subTiles').replaceChildren();

 const section = store.sections.find(
  item => item.slug === slug
 );

 $('catalogTitle').textContent =
  section?.title || 'Productos';

 renderProducts();

 $('catalogSection').scrollIntoView({
  behavior: 'smooth'
 });
}

function home() {
 currentSection = '';

 $('search').value = '';
 $('filterCategory').value = '';

 fillSubcategories();

 $('catalogTitle').textContent =
  'Todos los productos';

 $('subTiles').replaceChildren();
 $('home').classList.remove('hidden');

 renderProducts();

 window.scrollTo({
  top: 0,
  behavior: 'smooth'
 });
}

/* BOTÓN VOLVER ATRÁS */

function goBack() {
 const category = $('filterCategory').value;
 const subcategory = $('filterSub').value;

 if (subcategory && category) {
  openCategory(category);
  return;
 }

 if (currentSection || category) {
  home();
  return;
 }

 home();
}

function renderProducts() {
 const query = normalized($('search').value);
 const category = $('filterCategory').value;
 const sub = $('filterSub').value;

 const products = store.products.filter(product => {
  if (
   currentSection &&
   Number(product[currentSection]) !== 1
  ) {
   return false;
  }

  if (
   category &&
   product.category !== category
  ) {
   return false;
  }

  if (
   sub &&
   product.subcategory !== sub
  ) {
   return false;
  }

  const searchable = normalized([
   product.name,
   product.category,
   product.subcategory,
   product.description
  ].join(' '));

  return searchable.includes(query);
 });

 $('count').textContent =
  products.length + ' producto(s) encontrado(s)';

 const root = $('products');
 root.replaceChildren();

 for (const product of products) {
  root.append(productCard(product));
 }
}

function subtotal() {
 let result = 0;

 for (const [key, quantity] of Object.entries(cart)) {
  const [id, kind] = key.split(':');

  const product = store.products.find(
   item => String(item.id) === id
  );

  if (product) {
   result += priceFor(
    product,
    kind,
    quantity
   ) * quantity;
  }
 }

 return result;
}

/* CÁLCULO DE DESPACHO */

function shipping() {
 if ($('mode').value === 'pickup') {
  return {
   type: 'pickup',
   amount: 0,
   label: 'Retiro gratis'
  };
 }

 const region = normalized($('region').value);
 const commune = normalized($('commune').value);
 const address = normalized($('address').value);

 if (!region || !commune) {
  return {
   type: 'pending',
   amount: null,
   label: 'Por calcular'
  };
 }

 const isCruzDeCana =
  address.includes('cruz de cana') ||
  commune.includes('cruz de cana');

 const isPanDeAzucar =
  address.includes('pan de azucar') ||
  address.includes('nueva vida') ||
  commune.includes('pan de azucar') ||
  commune.includes('nueva vida');

 /*
  El beneficio de Pan de Azúcar se aplica
  si la dirección indica Pan de Azúcar
  o Nueva Vida.

  Cruz de Caña queda excluido.
 */

 if (
  region === 'coquimbo' &&
  isPanDeAzucar &&
  !isCruzDeCana
 ) {
  return {
   type: 'free',
   amount: 0,
   label: 'Gratis',
   reason: 'pan_de_azucar'
  };
 }

 const local =
  region === 'coquimbo' &&
  (
   commune === 'la serena' ||
   commune === 'coquimbo'
  );

 /*
  Cruz de Caña no recibe automáticamente
  el beneficio de Pan de Azúcar.
  Se conserva la regla general de despacho
  según comuna y monto de compra.
 */

 if (local && subtotal() >= 30000) {
  return {
   type: 'free',
   amount: 0,
   label: 'Gratis',
   reason: 'compra_minima'
  };
 }

 if (
  region === 'coquimbo' &&
  commune === 'la serena'
 ) {
  return {
   type: 'local',
   amount: 2000,
   label: money(2000)
  };
 }

 if (
  region === 'coquimbo' &&
  commune === 'coquimbo'
 ) {
  return {
   type: 'local',
   amount: 1500,
   label: money(1500)
  };
 }

 return {
  type: 'external',
  amount: null,
  label: 'Envío por pagar'
 };
}

/* CARRITO DE COMPRAS */

function renderCart() {
 const root = $('cartItems');
 root.replaceChildren();

 if (!Object.keys(cart).length) {
  const empty = node(
   'p',
   'Tu carrito está vacío.'
  );

  empty.className = 'muted';
  root.append(empty);
 }

 for (const [key, quantity] of Object.entries(cart)) {
  const [id, kind] = key.split(':');

  const product = store.products.find(
   item => String(item.id) === id
  );

  if (!product) continue;

  const row = node('div');
  row.className = 'cartrow';

  if (product.image) {
   row.append(photo(product.image, product.name));
  }

  const information = node('div');
  information.className = 'cartinfo';

  information.append(
   node('strong', product.name)
  );

  const presentation =
   kind === 'manga'
    ? 'Manga (' +
      product.packs_per_manga +
      ' paquetes)'
    : paperProduct(product)
      ? 'Paquete'
      : 'Unidad';

  const description = node(
   'div',
   presentation
  );

  description.className = 'muted';
  information.append(description);

  const unit = node(
   'div',
   'Unitario: ' +
   money(priceFor(product, kind, quantity))
  );

  unit.className = 'muted';
  information.append(unit);

  const total = node(
   'div',
   money(
    priceFor(product, kind, quantity) *
    quantity
   )
  );

  total.className = 'price';
  information.append(total);

  const controls = node('div');
  controls.className = 'flex';

  const minus = node('button', '−');
  minus.className = 'small';

  minus.onclick = () => {
   if (cart[key] <= 1) {
    delete cart[key];
   } else {
    cart[key]--;
   }

   renderCart();
  };

  const number = node(
   'strong',
   String(quantity)
  );

  const plus = node('button', '+');
  plus.className = 'small';

  plus.disabled =
   stockUsed(id) +
   (
    kind === 'manga'
     ? Number(product.packs_per_manga)
     : 1
   ) > Number(product.stock);

  plus.onclick = () =>
   addToCart(id, kind, 1);

  const remove = node('button', 'Eliminar');
  remove.className = 'small danger';

  remove.onclick = () => {
   delete cart[key];
   renderCart();
  };

  controls.append(
   minus,
   number,
   plus,
   remove
  );

  information.append(controls);
  row.append(information);
  root.append(row);
 }

 const productsTotal = subtotal();
 const delivery = shipping();

 $('subtotal').textContent =
  money(productsTotal);

 $('shipping').textContent =
  delivery.label;

 $('totalLabel').textContent =
  delivery.amount === null
   ? 'Total productos'
   : 'Total';

 $('total').textContent = money(
  productsTotal + (delivery.amount || 0)
 );

 const notices = {
  pickup:
   'Retiro gratis. Brusaam confirmará el lugar y horario.',
  pending:
   'Completa región y comuna para calcular el despacho.',
  free:
   delivery.reason === 'pan_de_azucar'
    ? '¡Despacho gratis en Pan de Azúcar y Nueva Vida! Excluye Cruz de Caña.'
    : '¡Despacho gratis por compras desde $30.000 en La Serena y Coquimbo!',
  local:
   'Tarifa de despacho: ' + delivery.label,
  external:
   'El envío a otras comunas y regiones es por pagar.'
 };

 $('shippingNotice').textContent =
  notices[delivery.type];
}

/* BÚSQUEDA Y FILTROS */

$('search').oninput = () => {
 if ($('search').value.trim()) {
  $('home').classList.add('hidden');
  currentSection = '';

  $('filterCategory').value = '';
  fillSubcategories();

  $('subTiles').replaceChildren();

  $('catalogTitle').textContent =
   'Resultados de búsqueda';
 } else {
  home();
 }

 renderProducts();
};

$('filterCategory').onchange = () => {
 currentSection = '';
 fillSubcategories();

 $('subTiles').replaceChildren();
 $('catalogTitle').textContent = 'Productos';

 renderProducts();
};

$('filterSub').onchange = () => {
 const category = $('filterCategory').value;
 const subcategory = $('filterSub').value;

 $('catalogTitle').textContent =
  subcategory || category || 'Todos los productos';

 renderProducts();
};

/* VOLVER ATRÁS */

$('backHome').onclick = goBack;

/* MODALIDAD DE ENTREGA */

$('mode').onchange = () => {
 $('deliveryFields').classList.toggle(
  'hidden',
  $('mode').value === 'pickup'
 );

 renderCart();
};

$('region').onchange = renderCart;
$('commune').oninput = renderCart;
$('address').oninput = renderCart;

/* CONTINUAR PEDIDO */

$('goCheckout').onclick = () => {
 if (!Object.keys(cart).length) {
  alert('Agrega productos al carrito.');
  return;
 }

 $('customerPanel').scrollIntoView({
  behavior: 'smooth'
 });
};

/* ENVIAR PEDIDO POR WHATSAPP */

$('checkout').onclick = () => {
 if (!Object.keys(cart).length) {
  alert('Agrega productos al carrito.');
  return;
 }

 const customer = $('customer').value.trim();

 if (!customer) {
  alert('Ingresa tu nombre y apellido.');
  return;
 }

 const pickup = $('mode').value === 'pickup';

 const address = $('address').value.trim();
 const region = $('region').value;
 const commune = $('commune').value.trim();

 if (
  !pickup &&
  (!address || !region || !commune)
 ) {
  alert(
   'Completa dirección, región y comuna.'
  );
  return;
 }

 const lines = [];

 for (const [key, quantity] of Object.entries(cart)) {
  const [id, kind] = key.split(':');

  const product = store.products.find(
   item => String(item.id) === id
  );

  if (!product) continue;

  const presentation =
   kind === 'manga'
    ? 'Manga (' +
      product.packs_per_manga +
      ' paquetes)'
    : paperProduct(product)
      ? 'Paquete'
      : 'Unidad';

  const unitPrice = priceFor(
   product,
   kind,
   quantity
  );

  lines.push(
   quantity +
   ' x ' + product.name +
   ' [' + presentation + ']' +
   ' | Unitario: ' + money(unitPrice) +
   ' | Subtotal: ' +
   money(unitPrice * quantity)
  );
 }

 const delivery = shipping();

 const message = [
  'Hola Brusaam, quiero realizar este pedido:',
  '',
  ...lines,
  '',
  'Subtotal productos: ' +
   money(subtotal()),
  'Despacho: ' + delivery.label,
  delivery.amount === null
   ? 'Total productos sin transporte: ' +
     money(subtotal())
   : 'Total: ' +
     money(subtotal() + delivery.amount),
  '',
  'Solicitante: ' + customer,
  'Modalidad: ' +
   (pickup ? 'Retiro' : 'Entrega a Domicilio'),
  ...(!pickup
   ? [
     'Dirección: ' + address,
     'Región: ' + region,
     'Comuna: ' + commune
    ]
   : [])
 ].join('\n');

 window.location.href =
  'https://wa.me/56966282007?text=' +
  encodeURIComponent(message);
};

/* CARGAR CATÁLOGO */

async function loadShop() {
 try {
  const response = await fetch('/api/shop');

  if (!response.ok) {
   throw Error('No se pudo cargar el catálogo');
  }

  store = await response.json();

  decorate(store);
  fillCategories();
  renderHome();
  renderProducts();
  renderCart();
 } catch (error) {
  $('products').textContent =
   'No fue posible cargar el catálogo.';
 }
}

loadShop();
</script>`;

/* ADMINISTRACIÓN PRIVADA */

const ADMIN = String.raw`
<div class="adminArea">
<h2>Administración privada Brusaam</h2>

<section id="loginArea" class="panel">
 <form id="loginForm">
  <label>Contraseña
   <input id="password"
    type="password" required>
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
  <button data-tab="products" class="active">
   Productos
  </button>
  <button data-tab="sections">
   Secciones
  </button>
  <button data-tab="categories">
   Categorías
  </button>
  <button data-tab="subs">
   Subcategorías
  </button>
  <button data-tab="design">
   Diseño y logo
  </button>
 </div>

 <div id="tab-products">

  <section class="panel">
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

    <label>Precio mayor desde cuántas unidades
     <input id="pMin" type="number"
      min="1" value="2" required>
    </label>

    <label>Stock disponible
     <input id="pStock" type="number"
      min="0" required>
    </label>

    <div id="paperFields" class="hidden">
     <h3>Papel higiénico: paquete y manga</h3>

     <p class="notice">
      Registra el stock en paquetes individuales.
      Una manga descuenta la cantidad de paquetes
      que contiene.
     </p>

     <label>Precio único por manga
      <input id="pMangaPrice"
       type="number" min="0" value="0">
     </label>

     <label>Paquetes que contiene una manga
      <input id="pPacksPerManga"
       type="number" min="0" value="0">
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

    <h3>Secciones especiales</h3>

    <label class="checkLabel">
     <input id="pFeatured" type="checkbox">
     Los más destacados
    </label>

    <label class="checkLabel">
     <input id="pSavings" type="checkbox">
     Pack Ahorro
    </label>

    <label class="checkLabel">
     <input id="pOffers" type="checkbox">
     Ofertas
    </label>

    <label class="checkLabel">
     <input id="pPyme" type="checkbox">
     Box Pyme
    </label>

    <label class="checkLabel">
     <input id="pActive"
      type="checkbox" checked>
     Producto visible en la tienda
    </label>

    <div class="flex" style="margin-top:15px">
     <button>Guardar producto</button>

     <button type="button" id="clearProduct"
      class="secondary">
      Limpiar
     </button>
    </div>
   </form>

   <p id="productMessage"></p>
  </section>

  <section class="panel">
   <h3>Productos registrados</h3>
   <div id="productList"></div>
  </section>
 </div>

 <div id="tab-sections" class="hidden">
  <section class="panel">
   <h3>Fotografías de secciones</h3>
   <div id="sectionList"></div>
  </section>
 </div>

 <div id="tab-categories" class="hidden">
  <section class="panel">
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

    <label>Orden
     <input id="cPosition" type="number" value="0">
    </label>

    <button>Guardar categoría</button>

    <button type="button" id="clearCategory"
     class="secondary">
     Limpiar
    </button>
   </form>

   <p id="categoryMessage"></p>
  </section>

  <section class="panel">
   <h3>Categorías existentes</h3>
   <div id="categoryList"></div>
  </section>
 </div>

 <div id="tab-subs" class="hidden">
  <section class="panel">
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

    <label>Orden
     <input id="sPosition" type="number" value="0">
    </label>

    <button>Guardar subcategoría</button>

    <button type="button" id="clearSub"
     class="secondary">
     Limpiar
    </button>
   </form>

   <p id="subMessage"></p>
  </section>

  <section class="panel">
   <h3>Subcategorías existentes</h3>
   <div id="subList"></div>
  </section>
 </div>

 <div id="tab-design" class="hidden">

  <section class="panel">
   <h3>Logo de Brusaam</h3>

   <p class="muted">
    Puedes subir un logo PNG con
    fondo transparente.
   </p>

   <img id="logoPreview"
    class="adminPhoto" alt="Logo">

   <label>Archivo del logo
    <input id="logoFile" type="file"
     accept="image/png,image/jpeg,image/webp">
   </label>

   <button id="uploadLogo">
    Subir logo
   </button>

   <label>URL del logo
    <input id="logoUrl" type="url">
   </label>

   <button id="saveLogo">
    Guardar logo
   </button>
  </section>

  <section class="panel">
   <h3>Diseño de Canva</h3>

   <p class="notice">
    Las ondas y flores ya están integradas
    en el encabezado y pie de página.
    Puedes subir una imagen adicional
    para el fondo del anuncio principal.
   </p>

   <label>Archivo del diseño
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

   <button id="removeDesign"
    class="secondary">
    Quitar diseño
   </button>

   <p id="designMessage"></p>
  </section>

 </div>
</div>
</div>

<script>
const $ = id => document.getElementById(id);

let data = {
 products: [],
 categories: [],
 subcategories: [],
 sections: []
};

async function api(path, method = 'GET', body) {
 const options = {
  method,
  credentials: 'same-origin'
 };

 if (body !== undefined) {
  options.headers = {
   'Content-Type': 'application/json'
  };

  options.body = JSON.stringify(body);
 }

 const response = await fetch(path, options);

 const result = await response.json()
  .catch(() => ({}));

 if (!response.ok) {
  throw Error(
   result.error || 'Error en la operación'
  );
 }

 return result;
}

function message(id, text) {
 $(id).textContent = text;
}

function openTab(name) {
 document.querySelectorAll('[data-tab]')
  .forEach(button => {
   button.classList.toggle(
    'active',
    button.dataset.tab === name
   );
  });

 for (const tab of [
  'products',
  'sections',
  'categories',
  'subs',
  'design'
 ]) {
  $('tab-' + tab).classList.toggle(
   'hidden',
   tab !== name
  );
 }
}

document.querySelectorAll('[data-tab]')
 .forEach(button => {
  button.onclick = () =>
   openTab(button.dataset.tab);
 });

/* INICIO Y CIERRE DE SESIÓN */

async function checkSession() {
 try {
  const result = await api('/api/admin/session');

  if (result.authenticated) {
   $('loginArea').classList.add('hidden');
   $('adminArea').classList.remove('hidden');

   await loadAdmin();
  } else {
   $('loginArea').classList.remove('hidden');
   $('adminArea').classList.add('hidden');
  }
 } catch (error) {
  $('loginArea').classList.remove('hidden');
  $('adminArea').classList.add('hidden');
 }
}

$('loginForm').onsubmit = async event => {
 event.preventDefault();

 const password = $('password').value;

 try {
  await api('/api/admin/login', 'POST', {
   password
  });

  $('password').value = '';

  message('loginMessage', '');

  await checkSession();
 } catch (error) {
  message(
   'loginMessage',
   error.message
  );
 }
};

$('logout').onclick = async () => {
 try {
  await api('/api/admin/logout', 'POST');

  $('adminArea').classList.add('hidden');
  $('loginArea').classList.remove('hidden');

  $('password').value = '';
 } catch (error) {
  alert(error.message);
 }
};

/* CARGA DE INFORMACIÓN */

async function loadAdmin() {
 try {
  data = await api('/api/admin/data');

  fillAdminCategories();
  renderAdminProducts();
  renderAdminCategories();
  renderAdminSubcategories();
  renderAdminSections();
  renderAdminDesign();
 } catch (error) {
  alert(
   'No se pudieron cargar los datos: ' +
   error.message
  );
 }
}

function fillAdminCategories() {
 const productCategory = $('pCategory');
 const subCategory = $('sCategory');

 const selectedProduct = productCategory.value;
 const selectedSub = subCategory.value;

 productCategory.replaceChildren(
  new Option('Selecciona una categoría', '')
 );

 subCategory.replaceChildren(
  new Option('Selecciona una categoría', '')
 );

 for (const category of data.categories) {
  productCategory.add(
   new Option(category.name, category.name)
  );

  subCategory.add(
   new Option(category.name, category.id)
  );
 }

 productCategory.value = selectedProduct;
 subCategory.value = selectedSub;

 fillProductSubcategories();
}

function fillProductSubcategories(selected = '') {
 const category = data.categories.find(
  item => item.name === $('pCategory').value
 );

 const select = $('pSub');

 select.replaceChildren(
  new Option('Sin subcategoría', '')
 );

 if (category) {
  for (const sub of data.subcategories.filter(
   item => Number(item.category_id) ===
    Number(category.id)
  )) {
   select.add(
    new Option(sub.name, sub.name)
   );
  }
 }

 if (
  [...select.options].some(
   option => option.value === selected
  )
 ) {
  select.value = selected;
 }

 updatePaperFields();
}

function updatePaperFields() {
 const isPaper =
  $('pCategory').value === 'Papelería' &&
  $('pSub').value === 'Papel higiénico';

 $('paperFields').classList.toggle(
  'hidden',
  !isPaper
 );
}

$('pCategory').onchange = () => {
 fillProductSubcategories();
};

$('pSub').onchange = updatePaperFields;

/* SUBIR FOTOGRAFÍAS A CLOUDINARY */

async function uploadImage(fileInput, urlInput) {
 const file = $(fileInput).files[0];

 if (!file) {
  alert('Selecciona una fotografía.');
  return;
 }

 if (file.size > 8 * 1024 * 1024) {
  alert('La imagen no puede superar 8 MB.');
  return;
 }

 const form = new FormData();
 form.append('file', file);

 const response = await fetch(
  '/api/admin/upload',
  {
   method: 'POST',
   credentials: 'same-origin',
   body: form
  }
 );

 const result = await response.json()
  .catch(() => ({}));

 if (!response.ok) {
  throw Error(
   result.error ||
   'No se pudo subir la fotografía.'
  );
 }

 if (!result.url) {
  throw Error('Cloudinary no devolvió una URL.');
 }

 $(urlInput).value = result.url;

 return result.url;
}

$('uploadProduct').onclick = async () => {
 try {
  const button = $('uploadProduct');
  button.disabled = true;

  await uploadImage('pFile', 'pImage');

  message(
   'productMessage',
   'Fotografía subida correctamente.'
  );
 } catch (error) {
  message(
   'productMessage',
   error.message
  );
 } finally {
  $('uploadProduct').disabled = false;
 }
};

/* LIMPIAR FORMULARIO DE PRODUCTO */

function clearProductForm() {
 $('productForm').reset();

 $('pId').value = '';
 $('pImage').value = '';

 $('pMin').value = '2';
 $('pStock').value = '0';

 $('pMangaPrice').value = '0';
 $('pPacksPerManga').value = '0';

 $('pActive').checked = true;

 fillProductSubcategories();

 message('productMessage', '');

 window.scrollTo({
  top: 0,
  behavior: 'smooth'
 });
}

$('clearProduct').onclick = clearProductForm;

/* EDITAR PRODUCTO */

function editProduct(id) {
 const product = data.products.find(
  item => Number(item.id) === Number(id)
 );

 if (!product) {
  alert('No se encontró el producto.');
  return;
 }

 openTab('products');

 $('pId').value = product.id;
 $('pName').value = product.name || '';

 $('pCategory').value =
  product.category || '';

 fillProductSubcategories(
  product.subcategory || ''
 );

 $('pDescription').value =
  product.description || '';

 $('pRetail').value =
  Number(product.retail) || 0;

 $('pWholesale').value =
  Number(product.wholesale) || 0;

 $('pMin').value =
  Number(product.min_qty) || 2;

 $('pStock').value =
  Number(product.stock) || 0;

 $('pMangaPrice').value =
  Number(product.manga_price) || 0;

 $('pPacksPerManga').value =
  Number(product.packs_per_manga) || 0;

 $('pImage').value =
  product.image || '';

 $('pFeatured').checked =
  Number(product.destacados) === 1;

 $('pSavings').checked =
  Number(product.pack_ahorro) === 1;

 $('pOffers').checked =
  Number(product.ofertas) === 1;

 $('pPyme').checked =
  Number(product.box_pyme) === 1;

 $('pActive').checked =
  Number(product.active) === 1;

 updatePaperFields();

 message(
  'productMessage',
  'Editando: ' + product.name
 );

 $('productForm').scrollIntoView({
  behavior: 'smooth'
 });
}

/* GUARDAR PRODUCTO */

$('productForm').onsubmit = async event => {
 event.preventDefault();

 const name = $('pName').value.trim();
 const category = $('pCategory').value;

 if (!name || !category) {
  alert('Completa nombre y categoría.');
  return;
 }

 const isPaper =
  category === 'Papelería' &&
  $('pSub').value === 'Papel higiénico';

 const payload = {
  id: $('pId').value
   ? Number($('pId').value)
   : null,

  name,

  category,

  subcategory: $('pSub').value,

  description:
   $('pDescription').value.trim(),

  retail: Number($('pRetail').value),

  wholesale:
   Number($('pWholesale').value),

  min_qty: Number($('pMin').value),

  stock: Number($('pStock').value),

  image: $('pImage').value.trim(),

  manga_price: isPaper
   ? Number($('pMangaPrice').value)
   : 0,

  packs_per_manga: isPaper
   ? Number($('pPacksPerManga').value)
   : 0,

  destacados:
   $('pFeatured').checked ? 1 : 0,

  pack_ahorro:
   $('pSavings').checked ? 1 : 0,

  ofertas:
   $('pOffers').checked ? 1 : 0,

  box_pyme:
   $('pPyme').checked ? 1 : 0,

  active:
   $('pActive').checked ? 1 : 0
 };

 if (
  payload.retail < 0 ||
  payload.wholesale < 0 ||
  payload.stock < 0 ||
  payload.min_qty < 1 ||
  payload.manga_price < 0 ||
  payload.packs_per_manga < 0
 ) {
  alert('Revisa los precios y cantidades.');
  return;
 }

 try {
  await api(
   '/api/admin/product',
   'POST',
   payload
  );

  message(
   'productMessage',
   'Producto guardado correctamente.'
  );

  await loadAdmin();

  $('pId').value = '';
 } catch (error) {
  message(
   'productMessage',
   error.message
  );
 }
};

/* ELIMINAR PRODUCTO */

async function deleteProduct(id) {
 const product = data.products.find(
  item => Number(item.id) === Number(id)
 );

 if (!product) return;

 const confirmed = confirm(
  '¿Eliminar definitivamente "' +
  product.name +
  '"?'
 );

 if (!confirmed) return;

 try {
  await api(
   '/api/admin/product',
   'DELETE',
   { id }
  );

  await loadAdmin();
 } catch (error) {
  alert(error.message);
 }
}

/* LISTADO DE PRODUCTOS */

function renderAdminProducts() {
 const root = $('productList');
 root.replaceChildren();

 if (!data.products.length) {
  root.append(
   document.createTextNode(
    'Todavía no hay productos registrados.'
   )
  );

  return;
 }

 for (const product of data.products) {
  const row = document.createElement('div');
  row.className = 'adminRow';

  if (product.image) {
   const img = document.createElement('img');
   img.src = product.image;
   img.alt = product.name;
   row.append(img);
  }

  const details = document.createElement('div');
  details.style.flex = '1';

  const name = document.createElement('strong');
  name.textContent = product.name;

  const info = document.createElement('div');
  info.className = 'muted';

  info.textContent =
   product.category +
   (product.subcategory
    ? ' / ' + product.subcategory
    : '') +
   ' · Detalle: $' +
   Number(product.retail).toLocaleString('es-CL') +
   ' · Stock: ' + product.stock +
   (Number(product.active) === 1
    ? ' · Visible'
    : ' · Oculto');

  details.append(name, info);
  row.append(details);

  const edit = document.createElement('button');
  edit.textContent = 'Editar';
  edit.className = 'secondary small';

  edit.onclick = () =>
   editProduct(product.id);

  const remove = document.createElement('button');
  remove.textContent = 'Eliminar';
  remove.className = 'danger small';

  remove.onclick = () =>
   deleteProduct(product.id);

  row.append(edit, remove);
  root.append(row);
 }
}

/* ADMINISTRACIÓN DE CATEGORÍAS */

function clearCategoryForm() {
 $('categoryForm').reset();
 $('cId').value = '';
 $('cImage').value = '';
 $('cPosition').value = '0';
 message('categoryMessage', '');
}

$('clearCategory').onclick = clearCategoryForm;

$('uploadCategory').onclick = async () => {
 const button = $('uploadCategory');
 button.disabled = true;

 try {
  await uploadImage('cFile', 'cImage');
  message('categoryMessage', 'Fotografía subida correctamente.');
 } catch (error) {
  message('categoryMessage', error.message);
 } finally {
  button.disabled = false;
 }
};

$('categoryForm').onsubmit = async event => {
 event.preventDefault();

 const payload = {
  id: $('cId').value ? Number($('cId').value) : null,
  name: $('cName').value.trim(),
  image: $('cImage').value.trim(),
  position: Number($('cPosition').value)
 };

 if (!payload.name) {
  alert('Ingresa el nombre de la categoría.');
  return;
 }

 try {
  await api('/api/admin/category', 'POST', payload);
  clearCategoryForm();
  await loadAdmin();
  message('categoryMessage', 'Categoría guardada correctamente.');
 } catch (error) {
  message('categoryMessage', error.message);
 }
};

function editCategory(id) {
 const category = data.categories.find(
  item => Number(item.id) === Number(id)
 );

 if (!category) return;

 openTab('categories');

 $('cId').value = category.id;
 $('cName').value = category.name;
 $('cImage').value = category.image || '';
 $('cPosition').value = category.position || 0;

 $('categoryForm').scrollIntoView({
  behavior: 'smooth'
 });
}

async function deleteCategory(id) {
 const category = data.categories.find(
  item => Number(item.id) === Number(id)
 );

 if (!category) return;

 if (!confirm(
  '¿Eliminar la categoría "' + category.name +
  '"? Revisa primero sus productos y subcategorías.'
 )) return;

 try {
  await api('/api/admin/category', 'DELETE', { id });
  await loadAdmin();
 } catch (error) {
  alert(error.message);
 }
}

function renderAdminCategories() {
 const root = $('categoryList');
 root.replaceChildren();

 for (const category of data.categories) {
  const row = document.createElement('div');
  row.className = 'adminRow';

  if (category.image) {
   const img = document.createElement('img');
   img.src = category.image;
   img.alt = category.name;
   row.append(img);
  }

  const name = document.createElement('strong');
  name.textContent = category.name;
  row.append(name);

  const edit = document.createElement('button');
  edit.textContent = 'Editar';
  edit.className = 'secondary small';
  edit.onclick = () => editCategory(category.id);

  const remove = document.createElement('button');
  remove.textContent = 'Eliminar';
  remove.className = 'danger small';
  remove.onclick = () => deleteCategory(category.id);

  row.append(edit, remove);
  root.append(row);
 }
}

/* ADMINISTRACIÓN DE SUBCATEGORÍAS */

function clearSubForm() {
 $('subForm').reset();
 $('sId').value = '';
 $('sImage').value = '';
 $('sPosition').value = '0';
}

$('clearSub').onclick = clearSubForm;

$('uploadSub').onclick = async () => {
 const button = $('uploadSub');
 button.disabled = true;

 try {
  await uploadImage('sFile', 'sImage');
  alert('Fotografía subida correctamente.');
 } catch (error) {
  alert(error.message);
 } finally {
  button.disabled = false;
 }
};

$('subForm').onsubmit = async event => {
 event.preventDefault();

 const payload = {
  id: $('sId').value ? Number($('sId').value) : null,
  category_id: Number($('sCategory').value),
  name: $('sName').value.trim(),
  image: $('sImage').value.trim(),
  position: Number($('sPosition').value)
 };

 if (!payload.category_id || !payload.name) {
  alert('Selecciona una categoría e ingresa el nombre.');
  return;
 }

 try {
  await api('/api/admin/subcategory', 'POST', payload);
  clearSubForm();
  await loadAdmin();
  alert('Subcategoría guardada correctamente.');
 } catch (error) {
  alert(error.message);
 }
};

function editSubcategory(id) {
 const sub = data.subcategories.find(
  item => Number(item.id) === Number(id)
 );

 if (!sub) return;

 openTab('subs');

 $('sId').value = sub.id;
 $('sCategory').value = sub.category_id;
 $('sName').value = sub.name;
 $('sImage').value = sub.image || '';
 $('sPosition').value = sub.position || 0;

 $('subForm').scrollIntoView({
  behavior: 'smooth'
 });
}

async function deleteSubcategory(id) {
 const sub = data.subcategories.find(
  item => Number(item.id) === Number(id)
 );

 if (!sub) return;

 if (!confirm(
  '¿Eliminar la subcategoría "' + sub.name + '"?'
 )) return;

 try {
  await api('/api/admin/subcategory', 'DELETE', { id });
  await loadAdmin();
 } catch (error) {
  alert(error.message);
 }
}

function renderAdminSubcategories() {
 const root = $('subList');
 root.replaceChildren();

 for (const sub of data.subcategories) {
  const row = document.createElement('div');
  row.className = 'adminRow';

  if (sub.image) {
   const img = document.createElement('img');
   img.src = sub.image;
   img.alt = sub.name;
   row.append(img);
  }

  const category = data.categories.find(
   item => Number(item.id) === Number(sub.category_id)
  );

  const details = document.createElement('div');
  details.style.flex = '1';

  const name = document.createElement('strong');
  name.textContent = sub.name;

  const parent = document.createElement('div');
  parent.className = 'muted';
  parent.textContent = category
   ? 'Categoría: ' + category.name
   : 'Categoría no encontrada';

  details.append(name, parent);
  row.append(details);

  const edit = document.createElement('button');
  edit.textContent = 'Editar';
  edit.className = 'secondary small';
  edit.onclick = () => editSubcategory(sub.id);

  const remove = document.createElement('button');
  remove.textContent = 'Eliminar';
  remove.className = 'danger small';
  remove.onclick = () => deleteSubcategory(sub.id);

  row.append(edit, remove);
  root.append(row);
 }
}

/* SECCIONES PROMOCIONALES */

function renderAdminSections() {
 const root = $('sectionList');
 root.replaceChildren();

 for (const section of data.sections) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.style.marginBottom = '12px';

  const title = document.createElement('h3');
  title.textContent = section.title;
  panel.append(title);

  if (section.image) {
   const preview = document.createElement('img');
   preview.src = section.image;
   preview.alt = section.title;
   preview.className = 'adminPhoto';
   panel.append(preview);
  }

  const label = document.createElement('label');
  label.textContent = 'Nombre de la sección';

  const titleInput = document.createElement('input');
  titleInput.value = section.title;
  titleInput.maxLength = 100;
  label.append(titleInput);

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/webp';

  const imageLabel = document.createElement('label');
  imageLabel.textContent = 'URL de fotografía';

  const imageInput = document.createElement('input');
  imageInput.type = 'url';
  imageInput.value = section.image || '';
  imageLabel.append(imageInput);

  const upload = document.createElement('button');
  upload.textContent = 'Subir fotografía';
  upload.type = 'button';

  upload.onclick = async () => {
   if (!file.files[0]) {
    alert('Selecciona una fotografía.');
    return;
   }

   upload.disabled = true;

   try {
    const form = new FormData();
    form.append('file', file.files[0]);

    const response = await fetch('/api/admin/upload', {
     method: 'POST',
     credentials: 'same-origin',
     body: form
    });

    const result = await response.json();

    if (!response.ok) {
     throw Error(result.error || 'Error al subir imagen');
    }

    imageInput.value = result.url;
    alert('Fotografía subida. Presiona Guardar sección.');
   } catch (error) {
    alert(error.message);
   } finally {
    upload.disabled = false;
   }
  };

  const save = document.createElement('button');
  save.textContent = 'Guardar sección';

  save.onclick = async () => {
   try {
    await api('/api/admin/section', 'POST', {
     slug: section.slug,
     title: titleInput.value.trim(),
     image: imageInput.value.trim()
    });

    await loadAdmin();
    alert('Sección actualizada correctamente.');
   } catch (error) {
    alert(error.message);
   }
  };

  const controls = document.createElement('div');
  controls.className = 'flex';
  controls.append(upload, save);

  panel.append(label, file, imageLabel, controls);
  root.append(panel);
 }
}

/* LOGO Y DISEÑO */

function renderAdminDesign() {
 $('logoUrl').value = data.logo || '';
 $('logoPreview').src = data.logo || '';

 $('designUrl').value = data.design || '';
}

$('uploadLogo').onclick = async () => {
 const button = $('uploadLogo');
 button.disabled = true;

 try {
  const url = await uploadImage('logoFile', 'logoUrl');
  $('logoPreview').src = url;
  alert('Logo subido. Presiona Guardar logo.');
 } catch (error) {
  alert(error.message);
 } finally {
  button.disabled = false;
 }
};

$('saveLogo').onclick = async () => {
 try {
  await api('/api/admin/setting', 'POST', {
   key: 'logo',
   value: $('logoUrl').value.trim()
  });

  await loadAdmin();
  alert('Logo guardado correctamente.');
 } catch (error) {
  alert(error.message);
 }
};

$('uploadDesign').onclick = async () => {
 const button = $('uploadDesign');
 button.disabled = true;

 try {
  await uploadImage('designFile', 'designUrl');

  message(
   'designMessage',
   'Diseño subido. Presiona Guardar diseño.'
  );
 } catch (error) {
  message('designMessage', error.message);
 } finally {
  button.disabled = false;
 }
};

$('saveDesign').onclick = async () => {
 try {
  await api('/api/admin/setting', 'POST', {
   key: 'design',
   value: $('designUrl').value.trim()
  });

  await loadAdmin();

  message(
   'designMessage',
   'Diseño guardado correctamente.'
  );
 } catch (error) {
  message('designMessage', error.message);
 }
};

$('removeDesign').onclick = async () => {
 if (!confirm('¿Quitar el diseño adicional?')) return;

 try {
  await api('/api/admin/setting', 'POST', {
   key: 'design',
   value: ''
  });

  await loadAdmin();

  message(
   'designMessage',
   'Diseño adicional eliminado.'
  );
 } catch (error) {
  message('designMessage', error.message);
 }
};

/* INICIAR PANEL DE ADMINISTRACIÓN */

checkSession();
</script>`;

/* FUNCIONES DEL SERVIDOR */

/* VALIDACIÓN DE DATOS */

function cleanText(value, maximum = 200) {
 return String(value ?? '').trim().slice(0, maximum);
}

function cleanNumber(value, minimum = 0) {
 const number = Number(value);

 if (
  !Number.isSafeInteger(number) ||
  number < minimum
 ) {
  throw Error('Número inválido.');
 }

 return number;
}

function validateImage(value) {
 const url = cleanText(value, 1500);

 if (!validImage(url)) {
  throw Error('URL de imagen inválida.');
 }

 return url;
}

async function readJSON(request) {
 const contentType =
  request.headers.get('Content-Type') || '';

 if (!contentType.includes('application/json')) {
  throw Error('Se requiere contenido JSON.');
 }

 const body = await request.text();

 if (body.length > 100000) {
  throw Error('Solicitud demasiado grande.');
 }

 return JSON.parse(body);
}

/* AUTENTICACIÓN DEL ADMINISTRADOR */

async function createSession(env) {
 if (!env.SESSION_SECRET) {
  throw Error('SESSION_SECRET no configurado.');
 }

 const expires = String(
  Date.now() + 7 * 24 * 60 * 60 * 1000
 );

 const signature = await sign(
  expires,
  env.SESSION_SECRET
 );

 return expires + '.' + signature;
}

function sessionCookie(value) {
 return BR.cookie + '=' + value +
  '; Path=/; HttpOnly; Secure; SameSite=Strict' +
  '; Max-Age=604800';
}

function expiredCookie() {
 return BR.cookie + '=' +
  '; Path=/; HttpOnly; Secure; SameSite=Strict' +
  '; Max-Age=0';
}

async function requireAdmin(request, env) {
 const authenticated = await loggedIn(request, env);

 if (!authenticated) {
  return reply(
   { error: 'Sesión no autorizada.' },
   401
  );
 }

 return null;
}

function requireOrigin(request) {
 if (!checkOrigin(request)) {
  return reply(
   { error: 'Origen de solicitud no autorizado.' },
   403
  );
 }

 return null;
}

/* CONTROL DE INTENTOS DE INICIO DE SESIÓN */

function clientIP(request) {
 return (
  request.headers.get('CF-Connecting-IP') ||
  'unknown'
 ).slice(0, 100);
}

async function getLoginAttempts(env, ip) {
 return await env.DB.prepare(`
  SELECT failures, until_ms
  FROM login_attempts
  WHERE ip=?
 `).bind(ip).first();
}

async function registerLoginFailure(env, ip) {
 const current = await getLoginAttempts(env, ip);

 const failures =
  Number(current?.failures || 0) + 1;

 const until =
  failures >= 5
   ? Date.now() + 15 * 60 * 1000
   : 0;

 await env.DB.prepare(`
  INSERT INTO login_attempts
   (ip, failures, until_ms)
  VALUES (?, ?, ?)
  ON CONFLICT(ip)
  DO UPDATE SET
   failures=excluded.failures,
   until_ms=excluded.until_ms
 `).bind(ip, failures, until).run();
}

async function clearLoginFailures(env, ip) {
 await env.DB.prepare(`
  DELETE FROM login_attempts
  WHERE ip=?
 `).bind(ip).run();
}

async function handleLogin(request, env) {
 if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
  return reply(
   { error: 'Falta configurar la seguridad.' },
   500
  );
 }

 const ip = clientIP(request);
 const attempts = await getLoginAttempts(env, ip);

 if (
  attempts &&
  Number(attempts.until_ms) > Date.now()
 ) {
  return reply(
   {
    error:
     'Demasiados intentos. Intenta nuevamente en 15 minutos.'
   },
   429
  );
 }

 const body = await readJSON(request);

 const password = String(body.password || '');

 const expected = String(env.ADMIN_PASSWORD);

 const [submittedHash, expectedHash] =
  await Promise.all([
   sign(password, env.SESSION_SECRET),
   sign(expected, env.SESSION_SECRET)
  ]);

 let difference = 0;

 for (let i = 0; i < expectedHash.length; i++) {
  difference |=
   expectedHash.charCodeAt(i) ^
   submittedHash.charCodeAt(i);
 }

 if (difference !== 0) {
  await registerLoginFailure(env, ip);

  return reply(
   { error: 'Contraseña incorrecta.' },
   401
  );
 }

 await clearLoginFailures(env, ip);

 const session = await createSession(env);

 return reply(
  { ok: true },
  200,
  {
   'Set-Cookie': sessionCookie(session)
  }
 );
}

async function handleLogout() {
 return reply(
  { ok: true },
  200,
  {
   'Set-Cookie': expiredCookie()
  }
 );
}

/* SUBIDA SEGURA DE IMÁGENES A CLOUDINARY */

async function cloudinarySignature(params, secret) {
 const ordered = Object.keys(params)
  .sort()
  .map(key => key + '=' + params[key])
  .join('&');

 const digest = await crypto.subtle.digest(
  'SHA-1',
  encoder.encode(ordered + secret)
 );

 return Array.from(new Uint8Array(digest))
  .map(byte => byte.toString(16).padStart(2, '0'))
  .join('');
}

async function handleUpload(request, env) {
 if (
  !env.CLOUDINARY_API_KEY ||
  !env.CLOUDINARY_API_SECRET
 ) {
  return reply(
   {
    error:
     'Cloudinary no está configurado.'
   },
   500
  );
 }

 const form = await request.formData();
 const file = form.get('file');

 if (!(file instanceof File)) {
  return reply(
   { error: 'Selecciona una imagen válida.' },
   400
  );
 }

 const allowedTypes = [
  'image/jpeg',
  'image/png',
  'image/webp'
 ];

 if (!allowedTypes.includes(file.type)) {
  return reply(
   {
    error:
     'Solo se permiten imágenes JPG, PNG o WEBP.'
   },
   400
  );
 }

 if (file.size > 8 * 1024 * 1024) {
  return reply(
   {
    error:
     'La imagen no puede superar 8 MB.'
   },
   400
  );
 }

 const timestamp = String(
  Math.floor(Date.now() / 1000)
 );

 const parameters = {
  folder: 'brusaam',
  timestamp
 };

 const signature = await cloudinarySignature(
  parameters,
  env.CLOUDINARY_API_SECRET
 );

 const uploadForm = new FormData();

 uploadForm.append('file', file);
 uploadForm.append(
  'api_key',
  env.CLOUDINARY_API_KEY
 );
 uploadForm.append('timestamp', timestamp);
 uploadForm.append('folder', 'brusaam');
 uploadForm.append('signature', signature);

 const endpoint =
  'https://api.cloudinary.com/v1_1/' +
  BR.cloud +
  '/image/upload';

 const response = await fetch(endpoint, {
  method: 'POST',
  body: uploadForm
 });

 const result = await response.json();

 if (!response.ok || !result.secure_url) {
  return reply(
   {
    error:
     result.error?.message ||
     'No se pudo subir la fotografía.'
   },
   502
  );
 }

 return reply({
  ok: true,
  url: result.secure_url
 });
}

/* VALIDACIÓN DE PRODUCTOS */

function validateProduct(body) {
 const product = {
  id: body.id
   ? cleanNumber(body.id, 1)
   : null,

  name: cleanText(body.name, 160),

  category: cleanText(body.category, 100),

  subcategory:
   cleanText(body.subcategory, 100),

  description:
   cleanText(body.description, 1000),

  retail: cleanNumber(body.retail),

  wholesale: cleanNumber(body.wholesale),

  min_qty: cleanNumber(body.min_qty, 1),

  stock: cleanNumber(body.stock),

  image: validateImage(body.image),

  manga_price:
   cleanNumber(body.manga_price || 0),

  packs_per_manga:
   cleanNumber(body.packs_per_manga || 0),

  destacados:
   body.destacados ? 1 : 0,

  pack_ahorro:
   body.pack_ahorro ? 1 : 0,

  ofertas:
   body.ofertas ? 1 : 0,

  box_pyme:
   body.box_pyme ? 1 : 0,

  active:
   body.active ? 1 : 0
 };

 if (!product.name || !product.category) {
  throw Error(
   'Nombre y categoría son obligatorios.'
  );
 }

 return product;
}

/* OPERACIONES DE PRODUCTOS EN D1 */

async function saveProduct(env, body) {
 const product = validateProduct(body);

 const category = await env.DB.prepare(`
  SELECT id FROM shop_categories
  WHERE name=?
 `).bind(product.category).first();

 if (!category) {
  return reply({
   error: 'La categoría seleccionada no existe.'
  }, 400);
 }

 if (product.subcategory) {
  const sub = await env.DB.prepare(`
   SELECT id FROM shop_subcategories
   WHERE category_id=? AND name=?
  `).bind(
   category.id,
   product.subcategory
  ).first();

  if (!sub) {
   return reply({
    error: 'La subcategoría no pertenece a esa categoría.'
   }, 400);
  }
 }

 const values = [
  product.name,
  product.category,
  product.subcategory,
  product.description,
  product.retail,
  product.wholesale,
  product.min_qty,
  product.stock,
  product.image,
  product.active,
  product.destacados,
  product.pack_ahorro,
  product.ofertas,
  product.box_pyme,
  product.manga_price,
  product.packs_per_manga
 ];

 if (product.id) {
  const existing = await env.DB.prepare(`
   SELECT id FROM products WHERE id=?
  `).bind(product.id).first();

  if (!existing) {
   return reply({
    error: 'Producto no encontrado.'
   }, 404);
  }

  await env.DB.prepare(`
   UPDATE products SET
    name=?,
    category=?,
    subcategory=?,
    description=?,
    retail=?,
    wholesale=?,
    min_qty=?,
    stock=?,
    image=?,
    active=?,
    destacados=?,
    pack_ahorro=?,
    ofertas=?,
    box_pyme=?,
    manga_price=?,
    packs_per_manga=?
   WHERE id=?
  `).bind(
   ...values,
   product.id
  ).run();

  return reply({
   ok: true,
   id: product.id
  });
 }

 const result = await env.DB.prepare(`
  INSERT INTO products (
   name,category,subcategory,
   description,retail,wholesale,
   min_qty,stock,image,active,
   destacados,pack_ahorro,
   ofertas,box_pyme,
   manga_price,packs_per_manga
  )
  VALUES (
   ?,?,?,?,?,?,?,?,
   ?,?,?,?,?,?,?,?
  )
 `).bind(...values).run();

 return reply({
  ok: true,
  id: result.meta.last_row_id
 });
}

async function removeProduct(env, body) {
 const id = cleanNumber(body.id, 1);

 const existing = await env.DB.prepare(`
  SELECT id FROM products WHERE id=?
 `).bind(id).first();

 if (!existing) {
  return reply({
   error: 'Producto no encontrado.'
  }, 404);
 }

 await env.DB.prepare(`
  DELETE FROM products WHERE id=?
 `).bind(id).run();

 return reply({ ok: true });
}

/* OPERACIONES DE CATEGORÍAS */

async function saveCategory(env, body) {
 const id = body.id
  ? cleanNumber(body.id, 1)
  : null;

 const name = cleanText(body.name, 100);
 const image = validateImage(body.image);
 const position = Number(body.position ?? 0);

 if (
  !name ||
  !Number.isSafeInteger(position)
 ) {
  return reply({
   error: 'Datos de categoría inválidos.'
  }, 400);
 }

 if (id) {
  const old = await env.DB.prepare(`
   SELECT name FROM shop_categories WHERE id=?
  `).bind(id).first();

  if (!old) {
   return reply({
    error: 'Categoría no encontrada.'
   }, 404);
  }

  await env.DB.batch([
   env.DB.prepare(`
    UPDATE shop_categories
    SET name=?,image=?,position=?
    WHERE id=?
   `).bind(name, image, position, id),

   env.DB.prepare(`
    UPDATE products
    SET category=?
    WHERE category=?
   `).bind(name, old.name)
  ]);

  return reply({ ok: true, id });
 }

 const result = await env.DB.prepare(`
  INSERT INTO shop_categories
  (name,image,position)
  VALUES(?,?,?)
 `).bind(name, image, position).run();

 return reply({
  ok: true,
  id: result.meta.last_row_id
 });
}

async function removeCategory(env, body) {
 const id = cleanNumber(body.id, 1);

 const category = await env.DB.prepare(`
  SELECT name FROM shop_categories WHERE id=?
 `).bind(id).first();

 if (!category) {
  return reply({
   error: 'Categoría no encontrada.'
  }, 404);
 }

 const products = await env.DB.prepare(`
  SELECT COUNT(*) AS total
  FROM products WHERE category=?
 `).bind(category.name).first();

 if (Number(products.total) > 0) {
  return reply({
   error:
    'Esta categoría contiene productos. ' +
    'Debes cambiarlos de categoría antes de eliminarla.'
  }, 409);
 }

 await env.DB.batch([
  env.DB.prepare(`
   DELETE FROM shop_subcategories
   WHERE category_id=?
  `).bind(id),

  env.DB.prepare(`
   DELETE FROM shop_categories
   WHERE id=?
  `).bind(id)
 ]);

 return reply({ ok: true });
}

/* OPERACIONES DE SUBCATEGORÍAS */

async function saveSubcategory(env, body) {
 const id = body.id
  ? cleanNumber(body.id, 1)
  : null;

 const categoryId = cleanNumber(
  body.category_id, 1
 );

 const name = cleanText(body.name, 100);
 const image = validateImage(body.image);
 const position = Number(body.position ?? 0);

 if (
  !name ||
  !Number.isSafeInteger(position)
 ) {
  return reply({
   error: 'Datos de subcategoría inválidos.'
  }, 400);
 }

 const category = await env.DB.prepare(`
  SELECT name FROM shop_categories
  WHERE id=?
 `).bind(categoryId).first();

 if (!category) {
  return reply({
   error: 'La categoría principal no existe.'
  }, 400);
 }

 if (id) {
  const old = await env.DB.prepare(`
   SELECT
    s.name,
    c.name AS category
   FROM shop_subcategories s
   JOIN shop_categories c
    ON c.id=s.category_id
   WHERE s.id=?
  `).bind(id).first();

  if (!old) {
   return reply({
    error: 'Subcategoría no encontrada.'
   }, 404);
  }

  await env.DB.batch([
   env.DB.prepare(`
    UPDATE shop_subcategories
    SET category_id=?,name=?,image=?,position=?
    WHERE id=?
   `).bind(
    categoryId,
    name,
    image,
    position,
    id
   ),

   env.DB.prepare(`
    UPDATE products
    SET category=?,subcategory=?
    WHERE category=? AND subcategory=?
   `).bind(
    category.name,
    name,
    old.category,
    old.name
   )
  ]);

  return reply({ ok: true, id });
 }

 const result = await env.DB.prepare(`
  INSERT INTO shop_subcategories
  (category_id,name,image,position)
  VALUES(?,?,?,?)
 `).bind(
  categoryId,
  name,
  image,
  position
 ).run();

 return reply({
  ok: true,
  id: result.meta.last_row_id
 });
}

async function removeSubcategory(env, body) {
 const id = cleanNumber(body.id, 1);

 const sub = await env.DB.prepare(`
  SELECT
   s.name,
   c.name AS category
  FROM shop_subcategories s
  JOIN shop_categories c
   ON c.id=s.category_id
  WHERE s.id=?
 `).bind(id).first();

 if (!sub) {
  return reply({
   error: 'Subcategoría no encontrada.'
  }, 404);
 }

 const products = await env.DB.prepare(`
  SELECT COUNT(*) AS total
  FROM products
  WHERE category=? AND subcategory=?
 `).bind(
  sub.category,
  sub.name
 ).first();

 if (Number(products.total) > 0) {
  return reply({
   error:
    'Esta subcategoría contiene productos. ' +
    'Debes moverlos antes de eliminarla.'
  }, 409);
 }

 await env.DB.prepare(`
  DELETE FROM shop_subcategories
  WHERE id=?
 `).bind(id).run();

 return reply({ ok: true });
}

/* SECCIONES PROMOCIONALES */

async function saveSection(env, body) {
 const slug = cleanText(body.slug, 50);
 const title = cleanText(body.title, 100);
 const image = validateImage(body.image);

 if (
  !title ||
  !GROUPS.some(group => group[0] === slug)
 ) {
  return reply({
   error: 'Sección no válida.'
  }, 400);
 }

 await env.DB.prepare(`
  UPDATE shop_sections
  SET title=?,image=?
  WHERE slug=?
 `).bind(
  title,
  image,
  slug
 ).run();

 return reply({ ok: true });
}

/* LOGO Y DISEÑO */

async function saveSetting(env, body) {
 const key = cleanText(body.key, 30);
 const value = validateImage(body.value);

 if (
  !['logo', 'design'].includes(key) ||
  (key === 'logo' && !value)
 ) {
  return reply({
   error: 'Configuración inválida.'
  }, 400);
 }

 await env.DB.prepare(`
  INSERT INTO shop_settings
  (key,value)
  VALUES(?,?)
  ON CONFLICT(key)
  DO UPDATE SET value=excluded.value
 `).bind(key, value).run();

 return reply({ ok: true });
}

/* RUTAS PRINCIPALES DE BRUSAAM */

async function handleRequest(request, env) {
 const url = new URL(request.url);
 const path = url.pathname;
 const method = request.method.toUpperCase();

 /* PÁGINAS PÚBLICAS */

 if (path === '/' && method === 'GET') {
  return htmlPage(SHOP);
 }

 if (path === '/admin' && method === 'GET') {
  return htmlPage(ADMIN, true);
 }

 /* CATÁLOGO PÚBLICO */

 if (path === '/api/shop' && method === 'GET') {
  const data = await getData(env, false);

  return reply(data);
 }

 /* VERIFICAR SESIÓN ADMINISTRATIVA */

 if (
  path === '/api/admin/session' &&
  method === 'GET'
 ) {
  const authenticated =
   await loggedIn(request, env);

  return reply({ authenticated });
 }

 /* SEGURIDAD DE SOLICITUDES */

 if (
  path.startsWith('/api/admin/') &&
  method !== 'GET'
 ) {
  const originError = requireOrigin(request);

  if (originError) {
   return originError;
  }
 }

 /* INICIO DE SESIÓN */

 if (
  path === '/api/admin/login' &&
  method === 'POST'
 ) {
  return handleLogin(request, env);
 }

 /* PROTEGER TODAS LAS DEMÁS RUTAS ADMIN */

 if (path.startsWith('/api/admin/')) {
  const accessError =
   await requireAdmin(request, env);

  if (accessError) {
   return accessError;
  }

  /* CERRAR SESIÓN */

  if (
   path === '/api/admin/logout' &&
   method === 'POST'
  ) {
   return handleLogout();
  }

  /* CARGAR DATOS ADMINISTRATIVOS */

  if (
   path === '/api/admin/data' &&
   method === 'GET'
  ) {
   return reply(await getData(env, true));
  }

  /* SUBIR FOTOGRAFÍA */

  if (
   path === '/api/admin/upload' &&
   method === 'POST'
  ) {
   return handleUpload(request, env);
  }

  /* PRODUCTOS */

  if (path === '/api/admin/product') {
   if (method === 'POST') {
    const body = await readJSON(request);
    return saveProduct(env, body);
   }

   if (method === 'DELETE') {
    const body = await readJSON(request);
    return removeProduct(env, body);
   }
  }

  /* CATEGORÍAS */

  if (path === '/api/admin/category') {
   if (method === 'POST') {
    const body = await readJSON(request);
    return saveCategory(env, body);
   }

   if (method === 'DELETE') {
    const body = await readJSON(request);
    return removeCategory(env, body);
   }
  }

  /* SUBCATEGORÍAS */

  if (path === '/api/admin/subcategory') {
   if (method === 'POST') {
    const body = await readJSON(request);
    return saveSubcategory(env, body);
   }

   if (method === 'DELETE') {
    const body = await readJSON(request);
    return removeSubcategory(env, body);
   }
  }

  /* SECCIONES PROMOCIONALES */

  if (
   path === '/api/admin/section' &&
   method === 'POST'
  ) {
   const body = await readJSON(request);
   return saveSection(env, body);
  }

  /* LOGO Y DISEÑO */

  if (
   path === '/api/admin/setting' &&
   method === 'POST'
  ) {
   const body = await readJSON(request);
   return saveSetting(env, body);
  }
 }

 /* RUTA NO ENCONTRADA */

 return reply(
  { error: 'Ruta no encontrada.' },
  404
 );
}

/* INICIO DEL CLOUDFLARE WORKER */

export default {
 async fetch(request, env, ctx) {
  try {
   if (!env.DB) {
    return reply(
     {
      error:
       'La base de datos D1 no está configurada.'
     },
     500
    );
   }

   await initialize(env);

   return await handleRequest(request, env);

  } catch (error) {
   console.error(
    'Error en Brusaam Worker:',
    error
   );

   if (error instanceof SyntaxError) {
    return reply(
     { error: 'Formato de datos inválido.' },
     400
    );
   }

   if (
    error instanceof TypeError ||
    error instanceof RangeError
   ) {
    return reply(
     { error: 'Datos de solicitud inválidos.' },
     400
    );
   }

   return reply(
    {
     error:
      'No fue posible completar la operación.'
    },
    500
   );
  }
 }
};
