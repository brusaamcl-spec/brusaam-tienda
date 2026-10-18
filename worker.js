
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

const PACK_BRANDS = ['sedal','pantene','suavelina','familand','ballerina','ballerina_botella','elvive'];
const DEFAULT_PACK_SETTINGS = Object.fromEntries(PACK_BRANDS.map(brand => [brand, {enabled:!['ballerina_botella','elvive'].includes(brand), price:4890}]));
function safePackSettings(value) {
  let parsed = {};
  try { parsed = JSON.parse(value || '{}'); } catch {}
  return Object.fromEntries(PACK_BRANDS.map(brand => {
    const setting = parsed && typeof parsed === 'object' ? parsed[brand] : null;
    return [brand, {
      enabled: setting && typeof setting.enabled === 'boolean' ? setting.enabled : !['ballerina_botella','elvive'].includes(brand),
      price: setting && Number.isSafeInteger(setting.price) && setting.price > 0 && setting.price <= 1000000 ? setting.price : 4890
    }];
  }));
}

const GROUPS = [
  ["destacados", "LOS MAS DESTACADOS", "⭐"],
  ["ofertas", "OFERTAS", "🏷️"],
  ["nuevos_ingresos", "NUEVOS INGRESOS", "✨"],
  ["pack_ahorro", "PACK AHORRO", "📦"],
  ["box_pyme", "BOX PYME", "🏪"]
];

const DEFAULT_CATEGORIES = {
  "Limpieza del Hogar": [
    "Detergentes y Suavizantes",
    "Cloros y Desinfectantes",
    "Lavalozas",
    "Limpiapisos",
    "Limpiavidrios y desengrasantes",
    "Ambientales",
    "Insecticidas",
    "Otros de limpieza"
  ],
  "Cuidado Personal": [
    "Shampoo",
    "Acondicionador",
    "Jabones",
    "Desodorantes",
    "Cremas corporales",
    "Cuidado del bebé",
    "Otros de cuidado personal"
  ],
  "Papelería": [
    "Papel higiénico",
    "Toallas de papel",
    "Otros de papelería"
  ],
  "Otros Productos": [
    "Limpieza automotriz",
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
    ["offer_price", "INTEGER NOT NULL DEFAULT 0"],
    ["offer_manga_price", "INTEGER NOT NULL DEFAULT 0"],
    ["nuevos_ingresos", "INTEGER NOT NULL DEFAULT 0"],
    ["special_only", "INTEGER NOT NULL DEFAULT 0"],
    ["box_pyme", "INTEGER NOT NULL DEFAULT 0"],
    ["manga_price", "INTEGER NOT NULL DEFAULT 0"],
    ["packs_per_manga", "INTEGER NOT NULL DEFAULT 0"],
    ["pack_eligible", "INTEGER NOT NULL DEFAULT 1"]
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
      SELECT * FROM shop_sections ORDER BY CASE slug WHEN 'destacados' THEN 1 WHEN 'ofertas' THEN 2 WHEN 'nuevos_ingresos' THEN 3 WHEN 'pack_ahorro' THEN 4 WHEN 'box_pyme' THEN 5 ELSE 6 END
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
    design: preferences.design || "",
    packSettings: safePackSettings(preferences.pack_settings),
    promoGallery: (() => { try { const a=JSON.parse(preferences.promo_gallery || "[]"); return Array.isArray(a) ? a.filter(x=>typeof x==="string" && /^https:\/\//.test(x)).slice(0,20) : []; } catch {return [];} })()
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
    `<div class="headerDesign">${FLORAL_TOP}</div>`

  const floralFooter = admin ? "" :
    `<div class="footerDesign">${FLORAL_BOTTOM}</div>`

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
 padding:14px 9px;
 font-size:17px;
 font-weight:800;
 line-height:1.4;
 color:#142D65;
 text-align:center;
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
.shopRight .panel{position:static}
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
.headerDesign,.footerDesign{width:100%;padding:0;line-height:0;overflow:hidden}
.headerDesign img,.footerDesign img{display:block;width:100%;height:auto}
.footerDesign{margin-top:20px}
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
 display:inline-flex;
 align-items:center;
 gap:8px;
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
 .tile strong{font-size:16px;padding:12px 7px}
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

/* BRUSAAM - MEJORAS VISUALES */

/* Logo más grande */
.flowerHeader .logo {
  width: min(330px, 78%) !important;
  max-height: 220px !important;
  height: auto;
  margin: 12px auto 8px;
  object-fit: contain;
}

/* Eslogan más visible */
.flowerHeader .slogan {
  font-size: 18px !important;
  font-weight: 700;
  color: #243A70;
  letter-spacing: 0.3px;
  line-height: 1.5;
  padding: 0 12px;
}

/* Banner de despacho horizontal */
.flowerHeader .banner {
  width: calc(100% - 32px);
  max-width: 1280px !important;
  box-sizing: border-box;
  margin: 20px auto 16px;
  padding: 20px 16px;
  border-radius: 16px;
  background: linear-gradient(
    100deg,
    #EDF8FF,
    #F1E8FF,
    #EDF8FF
  );
  text-align: center;
  font-size: 16px;
}

.flowerHeader .banner strong {
  font-size: clamp(23px, 4vw, 34px) !important;
  font-weight: 900;
  line-height: 1.3;
}

/* Fotografías llenan las tarjetas */
.tiles .tile img {
  display: block;
  width: 100%;
  height: 160px;
  padding: 0 !important;
  object-fit: cover !important;
  object-position: center;
}

/* Nombres grandes y en mayúsculas */
.tiles .tile strong {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 65px;
  padding: 12px 7px;
  box-sizing: border-box;
  font-size: 19px !important;
  font-weight: 900;
  line-height: 1.25;
  text-transform: uppercase;
  text-align: center;
  color: #142D65;
}

/* Ajustes para celulares */
@media (max-width: 600px) {
  .flowerHeader .logo {
    width: 78% !important;
    max-height: 190px !important;
  }

  .flowerHeader .slogan {
    font-size: 16px !important;
  }

  .flowerHeader .banner {
    width: calc(100% - 20px);
    margin: 16px auto;
    padding: 18px 10px;
    border-radius: 13px;
    font-size: 14px;
  }

  .tiles .tile img {
    height: 145px !important;
  }

  .tiles .tile strong {
    font-size: 16px !important;
    min-height: 68px;
    padding: 10px 5px;
  }
}

/* BRUSAAM: fotografías completas sin recortes, también en celulares */
.tiles .tile img, .tiles .tile img.brusaamPhoto,
.product img, .adminRow img,
.brusaamSectionPhoto {
 object-fit:contain !important;
 object-position:center !important;
 background:#fff !important;
}
.tiles .tile img {padding:6px !important;box-sizing:border-box}
.brusaamSectionPhoto {display:block;width:100%;height:160px;padding:6px;box-sizing:border-box}
@media(max-width:600px){.brusaamSectionPhoto{height:145px}}
.brusaamSectionTile {position:relative}
.brusaamSectionTile .brusaamSectionPhoto {transition:opacity .24s ease}
.brusaamSectionTile .brusaamSectionPhoto.isChanging {opacity:.25}



/* Galería publicitaria en el espacio vacío de Secciones Especiales */
#sectionTiles {display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important}
#sectionTiles .brusaamSectionTile {min-width:0}

#sectionTiles .brusaamPromoGallery {
 grid-column:2 / span 3;display:flex;align-items:center;justify-content:center;
 min-width:0;overflow:hidden;border:1px solid #e7e5f0;border-radius:13px;
 background:#fff;min-height:205px;align-self:stretch;
}
#sectionTiles .brusaamPromoPhoto {
 width:100%;height:100%;max-height:260px;object-fit:contain!important;
 object-position:center;background:#fff;display:block;
}
#sectionTiles .brusaamPromoPlaceholder {
 border:1px dashed #d5cce4;color:#7c7195;text-align:center;
 padding:18px;font-size:13px;
}
@media(max-width:650px) {
 #sectionTiles {grid-template-columns:repeat(4,minmax(0,1fr))!important}
 /* Quinta tarjeta en segunda fila, publicidad ocupando las tres columnas restantes. */
 #sectionTiles .brusaamPromoGallery {grid-column:2 / span 3;min-height:180px}
 #sectionTiles .brusaamPromoPhoto {max-height:240px}
}

/* Promoción automática de shampoo + acondicionador */
.brusaamPackPromo {display:flex;flex-direction:column;gap:5px;margin:10px 0;
 padding:11px;border:1px solid #dfc9f4;border-radius:12px;background:#f8f2fd;
 color:#49315e;font-size:12px;line-height:1.45}
.brusaamPackPromo strong:first-child {font-size:13px;color:#683c91}
.brusaamPackPromo small {color:#715e80}

/* Categorías: fotografía suave y botón visual sobre la misma imagen */
#categoryTiles .brusaamCategoryTile {position:relative;cursor:pointer}
#categoryTiles .brusaamCategoryTile img {opacity:.76;transition:opacity .2s ease;object-fit:contain!important}
#categoryTiles .brusaamCategoryTile:hover img,
#categoryTiles .brusaamCategoryTile:focus-visible img {opacity:.9}
#categoryTiles .brusaamCategoryOverlay {
 position:absolute;left:50%;top:62px;transform:translate(-50%,-50%);
 padding:9px 16px;border-radius:24px;
 background:rgba(255,255,255,.83);color:#142D65;
 border:1px solid rgba(20,45,101,.17);
 font-size:13px;font-weight:900;letter-spacing:.06em;
 box-shadow:0 3px 12px rgba(20,45,101,.12);
 pointer-events:none;white-space:nowrap;
}
@media(max-width:600px){#categoryTiles .brusaamCategoryOverlay{top:62px;padding:7px 8px;font-size:10px;letter-spacing:0}}


/* Presentaciones de papelería: opciones visibles y táctiles */
.presentationChoices{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 8px}
.presentationOption{flex:1 1 110px;display:flex!important;align-items:center;justify-content:center;gap:7px;
 padding:10px 8px!important;border:1.5px solid #d8c8eb;border-radius:12px;
 background:#fff;color:#283b67;font-size:13px;font-weight:700;cursor:pointer;margin:0!important}
.presentationOption:has(input:checked){background:#f0e6fc;border-color:#7332ca;color:#52228e}
.presentationOption input{width:16px!important;height:16px!important;accent-color:#7130c7;margin:0!important}


.presentationOptionContent{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0;text-align:center}
.presentationOnSale{border-color:#d63a6b!important;background:#fff6fa!important}
.presentationOfferBadge{font-size:11px;font-weight:900;color:#b51650;background:#ffe1ed;border-radius:15px;padding:3px 8px}
.presentationOldPrice{font-size:11px;color:#8a8190;text-decoration:line-through}
.presentationShownPrice{font-size:14px;color:#153b83;font-weight:900}
.presentationOnSale .presentationShownPrice{color:#bc1755}


.presentationWholesaleInfo{display:block;font-size:11px;font-weight:700;color:#583198;
 background:#f2eafb;padding:5px 6px;border-radius:7px;line-height:1.35;max-width:100%;
 white-space:normal;overflow-wrap:anywhere}

/* Estado agotado visible en fichas sin existencias */
.productSoldOut > button:last-child:disabled {
 background:#e7e9ee!important;color:#646b78!important;
 border-color:#d2d6de!important;opacity:1!important;cursor:not-allowed;
 font-weight:800;letter-spacing:.04em;
}
/* PRECIO MAYORISTA EN FICHAS DE PRODUCTO */
.wholesalePrice {
  display: inline-block;
  align-self: flex-start;
  background: #F0E9FB;
  color: #583198;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.45;
}

/* PRECIO MAYORISTA EN CARRITO */
.cartWholesaleLabel {
  display: inline-block;
  background: #EDE6FA;
  color: #6331A8;
  border-radius: 7px;
  padding: 6px 9px;
  font-size: 12px;
  font-weight: 800;
  margin: 7px 0;
}

/* PRECIO AL DETALLE */
.cartRetailLabel {
  display: inline-block;
  background: #F1F3F8;
  color: #53627B;
  border-radius: 7px;
  padding: 6px 9px;
  font-size: 12px;
  font-weight: 700;
  margin: 7px 0;
}

/* AHORRO GENERAL */
.cartSavingsSummary {
  background: #EAF8F0;
  color: #147746;
  padding: 11px 9px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 800;
  margin: 10px 0;
}

/* TÍTULO DEL CARRITO */
#cartTitle {
  font-size: 25px !important;
  font-weight: 900;
  color: #17366B;
}

/* MENSAJE DE CONFIRMACIÓN BRUSAAM */
.confirmationMessage {
  font-size: 17px !important;
  font-weight: 700;
  line-height: 1.6;
  color: #243B70;
  text-align: center;
  margin: 16px 0 8px;
  padding: 10px 12px;
  background: #F1EDFA;
  border-radius: 9px;
}

@media (max-width: 600px) {
  .confirmationMessage {
    font-size: 15px !important;
  }
}
/* TEXTO SECUNDARIO DESPACHO GRATIS */
.freeShippingSubtitle {
  font-size: 17px !important;
  font-weight: 700;
  line-height: 1.5;
  text-align: center;
  color: #344A75;
}

@media (max-width: 600px) {
  .freeShippingSubtitle {
    font-size: 15px !important;
  }
}
/* BRUSAAM - LETRAS DEL PIE DE PÁGINA */

/* Textos generales del pie de página */
footer p,
footer .muted,
footer small {
  font-size: 15px !important;
  line-height: 1.7 !important;
}
/* Mensaje Síguenos */
footer .socialIntro {
  font-size: 17px !important;
  font-weight: 700 !important;
  color: #243B70;
}
.panAzucarChoice{margin:12px 0 16px;padding:13px 15px;border:1px solid #d9e8ed;border-radius:12px;background:#f5fbfc}
.panAzucarCheck{display:flex!important;align-items:center;gap:10px;cursor:pointer;font-weight:600}
.panAzucarCheck input{width:19px!important;height:19px!important;flex:0 0 19px;margin:0;accent-color:#238d9c}
#panAzucarSectorWrap{margin-top:12px;display:block}
#panAzucarSectorWrap.hidden,#regionWrap.hidden,#communeWrap.hidden{display:none!important}
/* Contacto y dirección */
footer .contactInfo {
  font-size: 15px !important;
  font-weight: 600;
  color: #344A75;
}
/* Ajuste para celulares */
@media (max-width: 600px) {
  footer p,
  footer .muted,
  footer small {
    font-size: 14px !important;
    line-height: 1.6 !important;
  }

  footer .socialIntro {
    font-size: 16px !important;
  }

  footer .contactInfo {
    font-size: 14px !important;
  }
}

.sectionHeading{font-size:20px!important;letter-spacing:1.3px;text-transform:uppercase;color:#284878;background:linear-gradient(100deg,#edf9fb,#f3f0fc);border-left:4px solid #73b6d2;border-radius:10px;padding:13px 16px;margin:19px 0 14px!important}
.elegantCatalog{font-family:Georgia,"Times New Roman",serif!important;font-style:italic;font-weight:600!important;letter-spacing:.5px;text-transform:none!important}
.product .specialDescription{font-size:13px;line-height:1.5;color:#53617c;white-space:pre-wrap}


/* Carruseles de fotografías para secciones especiales */
.brusaamCarousel{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;
 scroll-behavior:smooth;padding:5px 3px 12px;scrollbar-width:thin;}
.brusaamSlide{flex:0 0 clamp(160px,32%,250px);scroll-snap-align:start;
 border:1px solid #e6e7f2;border-radius:14px;background:#fff;padding:12px;
 display:flex;flex-direction:column;align-items:center;gap:10px;cursor:pointer;
 color:#293348;text-align:center;min-width:0;}
.brusaamSlide img{display:block;width:100%;height:175px;object-fit:contain;}
.brusaamSlide strong{font-size:14px;line-height:1.35;}
.brusaamSlide:hover{border-color:#8ccdd7;box-shadow:0 3px 12px #00000012;}
@media(max-width:600px){.brusaamSlide{flex-basis:65%;}.brusaamSlide img{height:160px;}}
@media(prefers-reduced-motion:reduce){.brusaamCarousel{scroll-behavior:auto;}}

/* BRUSAAM: carrusel principal con dos promociones */
.brusaamHero{position:relative;width:calc(100% - 32px);max-width:1280px;margin:20px auto 16px;overflow:hidden;border-radius:16px;background:#f3edff;min-height:158px}
.flowerHeader .brusaamHeroSlide.banner{display:none!important;position:relative;width:100%!important;max-width:none!important;margin:0!important;min-height:158px;padding:22px 54px 42px!important;border-radius:16px;text-align:center;animation:brusaamFade .35s ease both}
.flowerHeader .brusaamHeroSlide.banner.active{display:block!important}
.brusaamHeroSlide p{margin:9px auto 0;max-width:850px;line-height:1.45}
.brusaamHeroArrow{position:absolute;top:48%;transform:translateY(-50%);width:35px;height:43px;padding:0!important;border-radius:10px;background:#6a2bc6cc;color:white;font-size:30px;z-index:2}
.brusaamHeroArrow.prev{left:8px}.brusaamHeroArrow.next{right:8px}
.brusaamHeroDots{position:absolute;bottom:10px;left:0;right:0;display:flex;gap:9px;justify-content:center;z-index:2}
.brusaamHeroDots button{width:10px;height:10px;min-width:10px;border-radius:50%;padding:0;background:#b5a4d0;border:0}
.brusaamHeroDots button.active{background:#6725c7;width:25px;border-radius:8px}
@keyframes brusaamFade{from{opacity:.35}to{opacity:1}}
@media(max-width:600px){
 .brusaamHero{width:calc(100% - 20px);margin:16px auto;min-height:170px}
 .flowerHeader .brusaamHeroSlide.banner{min-height:170px;padding:16px 39px 36px!important;font-size:12px!important}
 .flowerHeader .brusaamHeroSlide.banner strong{font-size:clamp(17px,5vw,23px)!important;line-height:1.2;overflow-wrap:anywhere}
 .brusaamHeroSlide p{font-size:12px!important;line-height:1.4}
 .brusaamHeroArrow{width:27px;height:35px;font-size:23px}
 .sectionHeading{font-size:clamp(13px,4vw,17px)!important;letter-spacing:0!important;line-height:1.35!important;padding:11px 9px!important;white-space:normal!important;overflow-wrap:anywhere!important;max-width:100%;}
 #sectionTiles .tile strong,#sectionTiles .brusaamSectionTile strong{font-size:clamp(9px,2.6vw,13px)!important;line-height:1.25!important;overflow-wrap:anywhere!important;word-break:normal!important;padding:8px 3px!important;min-width:0}
 #sectionTiles .brusaamSectionTile{min-width:0;overflow:hidden}
 #sectionTiles .brusaamSectionPhoto{height:105px!important}
 #sectionTiles{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
 #sectionTiles .brusaamPromoGallery{grid-column:1 / -1!important}
 #sectionTiles .tile strong,#sectionTiles .brusaamSectionTile strong{font-size:clamp(12px,3.5vw,15px)!important;min-height:52px;white-space:normal!important;overflow:visible!important}
 #sectionTiles .brusaamSectionPhoto{height:125px!important}
 .featuredPanel h2,.shopLeft h2{overflow-wrap:anywhere}
}
@media(prefers-reduced-motion:reduce){.flowerHeader .brusaamHeroSlide.banner{animation:none}}
</style>
</head>
<body>
<header class="flowerHeader">
${floralHeader}
<img id="shopLogo" class="logo"
 alt="Logo Brusaam" decoding="async"
 style="visibility:hidden;background:transparent">
<div class="slogan">Articulos de Limpieza y Cuidado Personal</div>
<strong>Al POR MAYOR Y DETALLE</strong>
${admin ? "" : `
 <div class="brusaamHero" aria-label="Promociones BRUSAAM">
  <div class="brusaamHeroSlide banner active" aria-hidden="false">
   <div>🚚 BENEFICIO ESPECIAL</div>
   <strong>¡DESPACHO GRATIS!</strong>
   <p class="freeShippingSubtitle">✨La Serena y Coquimbo · Compras sobre $30.000✨</p>
  </div>
  <div class="brusaamHeroSlide banner" aria-hidden="true">
   <div>💜 BENEFICIO PARA TUS COMPRAS</div>
   <strong>¡PRECIO POR MAYOR DESDE 2 UNIDADES!</strong>
   <p class="freeShippingSubtitle">✨ ¡Combina tus aromas favoritos! ✨</p>
   <p>Compra 2 o más unidades del mismo producto y formato, iguales o de distintos aromas participantes.</p>
  </div>
  <button type="button" class="brusaamHeroArrow prev" aria-label="Promoción anterior" onclick="brusaamHeroMove(-1)">‹</button>
  <button type="button" class="brusaamHeroArrow next" aria-label="Promoción siguiente" onclick="brusaamHeroMove(1)">›</button>
  <div class="brusaamHeroDots"><button type="button" class="active" aria-label="Ver despacho gratis" onclick="brusaamHeroShow(0)"></button><button type="button" aria-label="Ver precio por mayor" onclick="brusaamHeroShow(1)"></button></div>
 </div>`}
</header>
 <script>
let brusaamHeroIndex=0;
function brusaamHeroShow(index){
 const slides=[...document.querySelectorAll('.brusaamHeroSlide')];
 const dots=[...document.querySelectorAll('.brusaamHeroDots button')];
 if(!slides.length)return;
 brusaamHeroIndex=(index+slides.length)%slides.length;
 slides.forEach((slide,i)=>{slide.classList.toggle('active',i===brusaamHeroIndex);slide.setAttribute('aria-hidden',String(i!==brusaamHeroIndex));});
 dots.forEach((dot,i)=>dot.classList.toggle('active',i===brusaamHeroIndex));
}
function brusaamHeroMove(step){brusaamHeroShow(brusaamHeroIndex+step)}
setInterval(()=>{if(!document.hidden)brusaamHeroMove(1)},5000);
</script>
 <main>${content}</main>
<footer>
<div class="footerContent">
<h3>HAZ CLICK AQUI</h3>
<p class="socialIntro">✨Síguenos en nuestras Redes Sociales y Contáctanos✨</p>
<div class="social">
 <a href="https://wa.me/${BR.whatsapp}"
  target="_blank" rel="noopener noreferrer">
  <img src="https://cdn.simpleicons.org/whatsapp/25D366"
   alt="" width="23" height="23">
  WhatsApp
 </a>

 <a href="${BR.instagram}"
  target="_blank" rel="noopener noreferrer">
  <img src="https://cdn.simpleicons.org/instagram/E4405F"
   alt="" width="23" height="23">
  Instagram
 </a>

 <a href="${BR.tiktok}"
  target="_blank" rel="noopener noreferrer">
  <img src="https://cdn.simpleicons.org/tiktok/000000"
   alt="" width="23" height="23">
  TikTok
 </a>
</div>
<p class="muted">
 CONTACTO: +56 9 6628 2007
</p>
<p class="footerAddress contactInfo">📍 Dirección: Nueva Vida, Pan de Azúcar, Coquimbo</p>
<p class="muted">
 Instagram @comercializadora_brusaam
 · TikTok @com_brusaam
</p>
</div>
${floralFooter}
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
<h1 class="welcome elegantCatalog">BIENVENIDOS A BRUSAAM</h1>

<div class="search">
 <span>⌕</span>
 <input id="search"
  placeholder="Buscar productos, marcas o categorías...">
</div>

<div class="shopLayout">
 <div class="shopLeft">

  <div id="home">
   <h2 class="sectionHeading">NUESTRAS CATEGORÍAS</h2>
   <div id="categoryTiles" class="tiles"></div>

   <h2 class="sectionHeading">SECCIONES ESPECIALES</h2>
   <div id="sectionTiles" class="tiles"><div id="promoGallerySlot" class="brusaamPromoGallery brusaamPromoPlaceholder" aria-label="Espacio publicitario">📷 Espacio publicitario Brusaam</div></div>

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
   
<h2 id="cartTitle">🛒 MI CARRITO</h2>

   <div id="cartItems"></div>

   <div class="summary">
    <span>Subtotal productos</span>
    <strong id="subtotal">$0</strong>
   </div>
<div class="summary cartSavingsSummary"
 id="savingsRow" style="display:none">
 <span>💚 Descuentos Aplicados</span>
 <strong id="savingsTotal">$0</strong>
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
  <h3>🚚 CONDICIONES Y TARIFAS DE DESPACHO</h3>

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
      <td>Pan de Azúcar (Excluye Cruz de Caña)</td>
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
       La Serena/Coquimbo
       Sobre $30.000
      </td>
      <td><strong>Gratis</strong></td>
     </tr>
     <tr>
      <td>Otras regiones/comunas</td>
      <td>Envío por pagar</td>
     </tr>
    </tbody>
   </table>
  </div>
 </section>

 </div>

  <section class="panel" id="customerPanel">
  <h3>👤 Datos del Solicitante</h3>

  <label>Nombre y Apellido *
   <input id="customer" maxlength="120">
  </label>
  <label>
   Modalidad (Retiro o Entrega a Domicilio) *
   <select id="mode">
    <option value="">Selecciona tu entrega</option>
    <option>Entrega a Domicilio</option>
    <option value="pickup">Retiro</option>
   </select>
  </label>

  <div id="deliveryFields">
   <label>Dirección *
    <input id="address" maxlength="220"
     placeholder="Calle, número y referencia">
   </label>

   <div class="panAzucarChoice">
    <label class="panAzucarCheck" for="panAzucarConfirm">
     <input type="checkbox" id="panAzucarConfirm">
     <span>Mi dirección corresponde a Pan de Azúcar</span>
    </label>
    <label id="panAzucarSectorWrap" class="hidden">Indica tu sector de Pan de Azúcar *
     <input id="panAzucarSector" maxlength="120" placeholder="Nombre del sector o referencia">
    </label>
   </div>

   <label id="regionWrap">Región *
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

   <label id="communeWrap">Comuna *
    <input id="commune" maxlength="100">
   </label>
  </div>

  <label>Observaciones del pedido (opcional)
   <textarea id="orderNotes" maxlength="450" rows="2"
    placeholder="Indicaciones para la entrega o comentarios"></textarea>
  </label>

  <p class="notice" id="shippingNotice">
   Completa tus datos para calcular el despacho.
  </p>

  <button id="checkout">
   💬 Enviar pedido por WhatsApp
  </button>

  <p class="confirmationMessage">
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
 sections: [],
 packSettings: {}
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
 element.decoding = 'async';
 return element;
}

function decorate(data) {

 const logo = $('shopLogo');
 if (logo && data.logo) {
  // No mostrar el logo predeterminado mientras se consulta D1.
  // Precargar el logo real antes de hacerlo visible.
  const image = new Image();
  image.onload = () => {
   logo.src = image.src;
   logo.style.visibility = 'visible';
  };
  image.onerror = () => {
   logo.style.visibility = 'hidden';
   console.warn('No se pudo cargar el logo configurado en Brusaam.');
  };
  image.src = data.logo;
 }

 /*
  Las ondas florales son SVG incorporados
  en el encabezado y pie de página.

  El diseño subido en Administración se
  utiliza como imagen de apoyo en las
  secciones, sin tapar las ondas.
 */
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

function makeTile(title, image, icon, action, categoryOverlay = false) {
 const button = node('button');
 button.className = 'tile' + (categoryOverlay ? ' brusaamCategoryTile' : '');
 button.type = 'button';
 if (categoryOverlay) button.setAttribute('aria-label', 'Ver categoría ' + title);

 if (image) {
  button.append(photo(image, title));
 } else {
  const placeholder = node('div', icon || '📦');
  placeholder.className = 'placeholder';
  button.append(placeholder);
 }

 if (categoryOverlay) {
  const overlay = node('span', 'VER AQUÍ');
  overlay.className = 'brusaamCategoryOverlay';
  button.append(overlay);
 }
 button.append(node('strong', title));
 button.onclick = action;

 return button;
}

function paperProduct(product) {
 return normalized(product.category) === 'papeleria';
}

function mangaAvailable(product) {
 return paperProduct(product) &&
  Number(product.manga_price) > 0 &&
  Number(product.packs_per_manga) > 0;
}

function priceFor(product, kind, quantity) {
 if (kind === 'manga') {
  return Number(product.ofertas) === 1 && Number(product.offer_manga_price) > 0
   ? Number(product.offer_manga_price) : Number(product.manga_price);
 }
 if (Number(product.ofertas) === 1 && Number(product.offer_price) > 0) {
  return Number(product.offer_price);
 }

 const minimum = Number(product.min_qty) || 2;

 return quantity >= minimum
  ? Number(product.wholesale)
  : Number(product.retail);
}

// Agrupación conservadora por familia y formato; no mezclar categorías, tamaños ni precios.
const brusaamAromas = new Set(['original','lavanda','menta','limon','vinagre','vainilla','berries','berry','bebe','floral','flores','jazmin','coco','manzana','primavera','fresco','fresca','tradicional','citrus','citrico','frutal','frutales','marina','marino','rosas','rosa','azul','verde','morado','lila','rosado','blanco','blanca','manzanilla','palta','almendra','aloe','durazno','tropical','naranja','frutilla']);
function brusaamWholesaleKey(product){
 if(!product || Number(product.special_only)===1 || Number(product.ofertas)===1 || paperProduct(product))return '';
 if(!(Number(product.wholesale)>0) || !(Number(product.wholesale)<Number(product.retail)))return '';
 const name=normalized(product.name||'').replace(/(\d)\s+(ml|cc|lt|lts|l|kg|gr|g|un|und|unidades|rollos|mts|mt)\b/g,'$1$2');
 const sizeMatch=name.match(/\b(\d+(?:[.,]\d+)?)(ml|cc|lt|lts|l|kg|gr|g|un|und|unidades|rollos|mts|mt)\b/);
 if(!sizeMatch)return '';
 let size=sizeMatch[1].replace(',','.')+sizeMatch[2];
 const type=/\b(acond|acondicionador|balsamo)\b/.test(name)?'acondicionador':/\b(sh|shampoo|champu)\b/.test(name)?'shampoo':/\b(jabon|jabones)\b/.test(name)?'jabon':/\b(detergente)\b/.test(name)?'detergente':/\b(suavizante)\b/.test(name)?'suavizante':/\b(cloro\s*gel)\b/.test(name)?'cloro gel':/\b(lavaloza|lavalozas)\b/.test(name)?'lavalozas':/\b(limpiapiso|limpiapisos|limpia piso|limpia pisos)\b/.test(name)?'limpiapisos':/\b(desodorante|ambiental|aromatizante)\b/.test(name)?'ambiental':'otro';
 const brands=['head & shoulders','head and shoulders','h&s','pantene','sedal','poett','ballerina','suavelina','familand','elvive','lux','le sancy','dove','nivea','igenix','ais matic','ais','ro','quix','fuzol','jj','teddy','de osol','deosol','etiquet','bio','confort','elite','swan','abolengo'];
 const brand=brands.find(b=>(' '+name+' ').includes(' '+b+' '));
 // Si no conocemos la marca, exigimos la misma denominación base para evitar descuentos incorrectos.
 const tokens=name.replace(/[^a-z0-9&]+/g,' ').trim().split(/\s+/);
 const core=tokens.filter(t=>!brusaamAromas.has(t) && !/^(\d+(?:[.,]\d+)?(?:ml|cc|lt|lts|l|kg|gr|g|un|und|unidades|rollos|mts|mt))$/.test(t)).join(' ');
 const family=brand ? brand : core;
 if(!family)return '';
 return [normalized(product.category),type,family,size,Number(product.retail),Number(product.wholesale),Number(product.min_qty)||2].join('|');
}
function brusaamWholesaleCounts(allocation){
 const groups={};
 for(const [key,qty] of Object.entries(cart)){
  const [id,kind]=key.split(':');if(kind==='manga')continue;
  const product=store.products.find(p=>String(p.id)===id);
  const group=brusaamWholesaleKey(product);if(!group)continue;
  const unpaired=Math.max(0,Number(qty)-(allocation[key]||0));
  groups[group]=(groups[group]||0)+unpaired;
 }
 return groups;
}
function brusaamQualifies(product,kind,remaining,allocation){
 if(kind==='manga'||Number(product.special_only)===1||Number(product.ofertas)===1)return false;
 const group=brusaamWholesaleKey(product);
 return group ? (brusaamWholesaleCounts(allocation)[group]||0)>=(Number(product.min_qty)||2) : remaining>=(Number(product.min_qty)||2);
}

// Pack automático: un shampoo y un acondicionador de la misma marca.
// Ballerina participa únicamente en formato bolsa Doypack.
function packIdentity(product) {
 if (!product || Number(product.special_only) === 1 || Number(product.pack_eligible) === 0 || paperProduct(product)) return null;
 // Convención del catálogo: SH o Acond siempre al comienzo del nombre.
 const name = normalized(product.name || '').trim();
 // Sedal: únicamente la presentación 340 ml participa en Arma tu Pack.
 if (/\bsedal\b/.test(name) && !/\b340\s*(?:ml|cc)\b/.test(name)) return null;
 const isShampoo = name === 'sh' || name.startsWith('sh ') || name.startsWith('sh.') || name.startsWith('sh-');
 const isConditioner = name === 'acond' || name.startsWith('acond ') || name.startsWith('acond.') || name.startsWith('acond-');
 if (isShampoo === isConditioner) return null;
 const brands = ['sedal','pantene','suavelina','familand','ballerina','elvive'];
 let brand = brands.find(item => (' ' + name + ' ').includes(' ' + item + ' '));
 if (!brand) return null;
 // Las dos presentaciones Ballerina tienen promociones independientes.
 if (brand === 'ballerina') {
  if (/\bdoy\s*pack\b/.test(name)) brand = 'ballerina';
  else if (/\bbotella\b/.test(name)) brand = 'ballerina_botella';
  else return null;
 }
 const setting = store.packSettings && store.packSettings[brand];
 if (setting && setting.enabled === false) return null;
 return {brand, type:isShampoo ? 'shampoo' : 'acondicionador'};
}

// Distribuir parejas por marca entre líneas del carrito, sin mezclar marcas.
// Las unidades restantes conservan sus precios normales o mayoristas.
function packAllocation() {
 const groups = {};
 const assigned = {};
 for (const [key, qty] of Object.entries(cart)) {
  const [id, kind] = key.split(':');
  if (kind !== 'pack') continue;
  const product = store.products.find(p => String(p.id) === id);
  const identity = packIdentity(product);
  if (!identity || qty <= 0) continue;
  if (!groups[identity.brand]) groups[identity.brand] = {shampoo:[], acondicionador:[]};
  groups[identity.brand][identity.type].push({key, qty:Number(qty)});
 }
 for (const group of Object.values(groups)) {
  const shampooCount = group.shampoo.reduce((sum,item)=>sum+item.qty,0);
  const conditionerCount = group.acondicionador.reduce((sum,item)=>sum+item.qty,0);
  let pairs = Math.min(shampooCount,conditionerCount);
  for (const type of ['shampoo','acondicionador']) {
   let remaining = pairs;
   for (const item of group[type]) {
    const applied = Math.min(item.qty,remaining);
    assigned[item.key] = applied;
    remaining -= applied;
   }
  }
 }
 return assigned;
}

function packUnitPrice(brand, type) {
 const settings = store.packSettings && store.packSettings[brand];
 const price = settings && Number(settings.price) > 0 ? Number(settings.price) : 4890;
 // Si el precio del pack es impar, el peso restante se asigna al acondicionador.
 // De esta forma ambas líneas siempre suman exactamente el precio del pack.
 return type === 'acondicionador' ? Math.ceil(price / 2) : Math.floor(price / 2);
}

function packLineLabel(product, paired) {
 const identity = packIdentity(product);
 if (!identity || !paired) return '';
 return '💜 Arma tu Pack: ' + paired + ' unidad(es) a ' + money(packUnitPrice(identity.brand, identity.type)) + ' c/u';
}

function cartLinePrice(product, kind, quantity, key, allocation) {
 const paired = allocation[key] || 0;
 const remaining = quantity - paired;
 const identity = packIdentity(product);
 return paired * packUnitPrice(identity && identity.brand, identity && identity.type) + remaining * (brusaamQualifies(product,kind,remaining,allocation) ? Number(product.wholesale) : priceFor(product,kind,remaining));
}

function cartLineDiscount(product, kind, quantity, key, allocation) {
 const paid = cartLinePrice(product,kind,quantity,key,allocation);
 const base = kind === 'manga' ? Number(product.manga_price) : Number(product.retail);
 return Math.max(0,base * quantity - paid);
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
 if (Number(product.special_only) === 1 && product.description) {
  const desc = node('p', product.description);
  desc.className = 'specialDescription';
  card.append(desc);
 }

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
 quantity.style.cssText = 'width:65px;text-align:center;margin:0';
 const qtyControls = node('div');
 qtyControls.className = 'flex';
 qtyControls.style.cssText = 'align-items:center;gap:8px;justify-content:center;margin:9px 0';
 const qtyMinus = node('button', '−');
 const qtyPlus = node('button', '+');
 qtyMinus.type = qtyPlus.type = 'button';
 qtyMinus.className = qtyPlus.className = 'small';
 const maxQty = () => {
  const packSize = presentation && presentation.value === 'manga'
   ? Math.max(1, Number(product.packs_per_manga)) : 1;
  return Math.max(0, Math.floor((Number(product.stock) - stockUsed(product.id)) / packSize));
 };
 const clampQty = value => {
  const max = maxQty();
  quantity.value = String(max ? Math.min(max, Math.max(1, Math.trunc(Number(value) || 1))) : 0);
  qtyMinus.disabled = Number(quantity.value) <= 1;
  qtyPlus.disabled = Number(quantity.value) >= max;
  if (typeof updateAvailability === 'function') updateAvailability();
 };
 qtyMinus.onclick = () => clampQty(Number(quantity.value) - 1);
 qtyPlus.onclick = () => clampQty(Number(quantity.value) + 1);
 quantity.onchange = () => clampQty(quantity.value);
 qtyControls.append(qtyMinus, quantity, qtyPlus);

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

  // Mostrar ambas alternativas directamente, sin abrir un desplegable.
  const presentationChoices = node('div');
  presentationChoices.className = 'presentationChoices';
  const packOffer = Number(product.ofertas) === 1 &&
   Number(product.offer_price) > 0 &&
   Number(product.offer_price) < Number(product.retail);
  const mangaOffer = mangaAvailable(product) &&
   Number(product.ofertas) === 1 &&
   Number(product.offer_manga_price) > 0 &&
   Number(product.offer_manga_price) < Number(product.manga_price);
  // Cuando solo la manga está en oferta, mostrarla seleccionada desde el inicio.
  const initialKind = mangaOffer && !packOffer ? 'manga' : 'pack';
  presentation.value = initialKind;
  const radioName = 'presentation-' + product.id + '-' + Math.random().toString(36).slice(2);
  for (const [value, label] of [['pack','Por paquete'],['manga','Por manga']]) {
   if (value === 'manga' && !mangaAvailable(product)) continue;
   const isOffer = value === 'manga' ? mangaOffer : packOffer;
   const base = value === 'manga' ? Number(product.manga_price) : Number(product.retail);
   const finalPrice = value === 'manga'
    ? (mangaOffer ? Number(product.offer_manga_price) : base)
    : (packOffer ? Number(product.offer_price) : base);
   const option = node('label');
   option.className = 'presentationOption' + (isOffer ? ' presentationOnSale' : '');
   const radio = document.createElement('input');
   radio.type = 'radio';
   radio.name = radioName;
   radio.value = value;
   radio.checked = value === initialKind;
   const content = node('span');
   content.className = 'presentationOptionContent';
   content.append(node('strong', label));
   if (isOffer) {
    const badge = node('span', '🏷️ OFERTA');
    badge.className = 'presentationOfferBadge';
    content.append(badge);
    const old = node('span', 'Antes: ' + money(base));
    old.className = 'presentationOldPrice';
    content.append(old);
   }
   const price = node('span', money(finalPrice));
   price.className = 'presentationShownPrice';
   content.append(price);
   // Mostrar el precio por mayor directamente dentro de la opción paquete.
   // Las ofertas no acumulan descuentos mayoristas.
   if (value === 'pack' && !packOffer && Number(product.special_only) !== 1 &&
       Number(product.wholesale) > 0 && Number(product.wholesale) < Number(product.retail)) {
    const wholesaleInfo = node('span',
     'Mayor: ' + money(product.wholesale) + ' c/u desde ' + (product.min_qty || 2) + ' un.');
    wholesaleInfo.className = 'presentationWholesaleInfo';
    content.append(wholesaleInfo);
   }
   option.append(radio, content);
   radio.onchange = () => {
    if (!radio.checked) return;
    presentation.value = value;
    presentation.dispatchEvent(new Event('change'));
   };
   presentationChoices.append(option);
  }
  presentation.style.display = 'none';
  presentation.setAttribute('aria-hidden', 'true');

  const amount = node('div');
  amount.className = 'price';

  const details = node('div');
  details.className = 'muted';

  const update = () => {
   if (presentation.value !== 'manga' && Number(product.ofertas) === 1 && Number(product.offer_price) > 0) {
    amount.textContent = money(product.offer_price) + ' · OFERTA';
    details.textContent = 'Antes: ' + money(product.retail) + ' por paquete';
   } else if (presentation.value === 'manga') {
    amount.textContent =
     money(priceFor(product, 'manga', 1)) + (Number(product.ofertas) === 1 && Number(product.offer_manga_price) > 0 ? ' · OFERTA por manga' : ' por manga');

    details.textContent =
     product.packs_per_manga + ' paquetes por manga' + (Number(product.ofertas) === 1 && Number(product.offer_manga_price) > 0 ? ' · Antes: ' + money(product.manga_price) : '');
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

  details.className =
   presentation.value === 'manga'
    ? 'muted'
    : 'wholesalePrice';

   presentation.onchange = () => {
    clampQty(quantity.value);
    update();
    details.className = presentation.value === 'manga'
     ? 'muted' : 'wholesalePrice';
   };

  // Los precios y las etiquetas OFERTA ya aparecen dentro de cada opción.
  // Evitar duplicarlos debajo en texto azul.
  card.append(presentationChoices, presentation);
  update();
 } else {
  const isOffer = Number(product.ofertas) === 1 && Number(product.offer_price) > 0;
  const amount = node(
   'div',
   money(isOffer ? product.offer_price : product.retail)
  );

  amount.className = 'price';
  card.append(amount);
  if (isOffer) {
   const before = node('div', 'Antes: ' + money(product.retail));
   before.style.textDecoration = 'line-through';
   before.className = 'muted';
   card.append(before);
   const tag = node('strong', 'OFERTA · Ahorras ' + money(Math.max(0, Number(product.retail) - Number(product.offer_price))));
   tag.style.color = '#c62828';
   card.append(tag);
  }

  const wholesale = node(
   'div',
   money(product.wholesale) + ' c/u desde ' + (product.min_qty || 2) + 'un'
  );

  wholesale.className = 'wholesalePrice';
  if (!isOffer && Number(product.special_only) !== 1) card.append(wholesale);
 }

 const pack = packIdentity(product);
 if (pack) {
  const promo = node('div');
  promo.className = 'brusaamPackPromo';
  const heading = node('strong', '💜 ARMA TU PACK');
  const packPrice = (store.packSettings && store.packSettings[pack.brand] && Number(store.packSettings[pack.brand].price)) || 4890;
  const price = node('strong', 'A elección 1 Shampoo + 1 Acondicionador misma marca: ' + money(packPrice) + (packPrice % 2 === 0 ? ' (' + money(packPrice/2) + ' c/u)' : ' por ambos'));
  const note = node('small', 'Promoción automática al completar la pareja en el carrito.');
  promo.append(heading,price,note);
  card.append(promo);
 }

 const stock = node(
  'div',
  'Stock: ' + product.stock +
  (Number(product.special_only) === 1 ? ' unidades' : paperProduct(product)
   ? ' paquetes'
   : ' unidades')
 );

 stock.className = 'muted';

 const add = node('button', '🛒 Agregar');
 const updateAvailability = () => {
  const available = maxQty();
  add.disabled = available < 1;
  add.textContent = available < 1 ? 'AGOTADO' : '🛒 Agregar';
  qtyMinus.disabled = available < 1 || Number(quantity.value) <= 1;
  qtyPlus.disabled = available < 1 || Number(quantity.value) >= available;
  quantity.disabled = available < 1;
  card.classList.toggle('productSoldOut', available < 1);
 };


 add.onclick = () => {
  clampQty(quantity.value);
  if (Number(quantity.value) < 1) return;
  addToCart(
   product.id,
   presentation ? presentation.value : 'pack',
   quantity.value
  );
 };

 card.append(stock, qtyControls, add);
 clampQty(1);
 updateAvailability();

 return card;
}

let sectionTimers = [];
function stopSectionTimers() {
 for (const timer of sectionTimers) clearInterval(timer);
 sectionTimers = [];
}
function renderHome() {
 stopSectionTimers();
 const categoryRoot = $('categoryTiles');
 categoryRoot.replaceChildren();
 const icons = {'Limpieza del hogar':'🧴','Cuidado personal':'🧼','Papelería':'🧻','Otros productos':'📦'};
 for (const category of store.categories) {
  categoryRoot.append(makeTile(category.name,category.image,icons[category.name]||'📁',
   () => openCategory(category.name), true));
 }
 const root = $('sectionTiles');
 root.replaceChildren();
 root.style.display = '';
 $('featuredAreas').replaceChildren();
 const order = ['destacados','ofertas','nuevos_ingresos','pack_ahorro','box_pyme'];
 for (const slug of order) {
  const section = store.sections.find(item => item.slug === slug);
  if (!section) continue;
  const products = store.products.filter(product =>
   Number(product[slug]) === 1 && Number(product.active) !== 0 && product.image);
  const tile = node('button');
  tile.type = 'button';
  tile.className = 'tile brusaamSectionTile';
  tile.setAttribute('aria-label','Ver todos los productos de '+section.title);
  tile.onclick = () => openSection(slug);
  const img = photo(products[0]?.image || section.image || '',section.title);
  img.className = 'brusaamSectionPhoto';
  if (!img.src || (!products.length && !section.image)) {
   img.removeAttribute('src');
   img.alt = 'Sin fotografía disponible';
  }
  tile.append(img,node('strong',section.title));
  root.append(tile);
  if (products.length > 1) {
   let index = 0;
   const timer = setInterval(() => {
    if (!tile.isConnected || document.hidden) return;
    index = (index+1)%products.length;
    img.src = products[index].image;
    img.alt = products[index].name;
   },3800);
   sectionTimers.push(timer);
   // Deslizar horizontalmente la fotografía sin abrir la sección.
   let touchX = null;
   tile.addEventListener('touchstart',event => {
    touchX = event.touches[0]?.clientX ?? null;
   },{passive:true});
   tile.addEventListener('touchend',event => {
    if (touchX === null) return;
    const distance = (event.changedTouches[0]?.clientX ?? touchX)-touchX;
    touchX = null;
    if (Math.abs(distance)<35) return;
    index = (index+(distance<0?1:products.length-1))%products.length;
    img.src = products[index].image;
    img.alt = products[index].name;
    tile.dataset.swiped = '1';
    setTimeout(()=>delete tile.dataset.swiped,350);
   },{passive:true});
   tile.onclick = () => {if (!tile.dataset.swiped) openSection(slug)};
  }
 }

 // Espacio publicitario: ocupa los tres lugares libres junto a Box Pyme.
 const gallery = Array.isArray(store.promoGallery) ? store.promoGallery : [];
 if (gallery.length) {
  const banner = node('div');
  banner.className = 'brusaamPromoGallery';
  banner.dataset.role = 'promo-carousel';
  banner.setAttribute('aria-label','Publicidad Brusaam');
  const pic = photo(gallery[0], 'Publicidad Brusaam');
  pic.className = 'brusaamPromoPhoto';
  pic.loading = 'lazy';
  banner.append(pic);
  root.append(banner);
  if (gallery.length > 1) {
   let pos=0;
   sectionTimers.push(setInterval(()=>{
    if (!banner.isConnected || document.hidden) return;
    pos=(pos+1)%gallery.length;
    pic.src=gallery[pos];
   },4000));
   let x=null;
   banner.addEventListener('touchstart',e=>{x=e.touches[0]?.clientX ?? null},{passive:true});
   banner.addEventListener('touchend',e=>{
    if(x===null)return;
    const dx=(e.changedTouches[0]?.clientX ?? x)-x;x=null;
    if(Math.abs(dx)>35){pos=(pos+(dx<0?1:gallery.length-1))%gallery.length;pic.src=gallery[pos];}
   },{passive:true});
  }
 } else {
  const placeholder=node('div','📷 Espacio publicitario · Sube tus fotografías en Administración → Secciones');
  placeholder.className='brusaamPromoGallery brusaamPromoPlaceholder';
  root.append(placeholder);
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

function setRoute(route, push = true) {
 if (push) history.pushState({brusaamRoute:route},'',route === 'home' ? '/' : '#'+encodeURIComponent(route));
}
function openCategory(category, sub = '', push = true) {
 currentSection = '';
 $('search').value = '';
 $('home').classList.add('hidden');
 $('filterCategory').value = category;
 fillSubcategories(sub);
 $('catalogTitle').textContent = sub || category;
 $('backHome').textContent = sub ? '← Volver a la categoría' : '← Volver al inicio';
 if (sub) $('subTiles').replaceChildren();
 else renderSubTiles(category);
 const filters = document.querySelector('.filters');
 if (filters) filters.classList.toggle('hidden',!sub);
 setRoute('category:'+category+(sub?'|'+sub:''),push);
 renderProducts();
 $('catalogSection').scrollIntoView({behavior:'smooth'});
}
function openSection(slug,push=true) {
 currentSection = slug;
 $('search').value = '';
 $('home').classList.add('hidden');
 $('filterCategory').value = '';
 fillSubcategories();
 $('subTiles').replaceChildren();
 const filters = document.querySelector('.filters');
 if (filters) filters.classList.add('hidden');
 const section = store.sections.find(item=>item.slug===slug);
 $('catalogTitle').textContent = section?.title || 'Productos';
 $('backHome').textContent = '← Volver al inicio';
 setRoute('section:'+slug,push);
 renderProducts();
 $('catalogSection').scrollIntoView({behavior:'smooth'});
}
function home(push=true) {
 currentSection = '';
 $('search').value = '';
 $('filterCategory').value = '';
 fillSubcategories();
 $('catalogTitle').textContent = 'Todos los productos';
 $('backHome').textContent = '← Volver al inicio';
 $('subTiles').replaceChildren();
 $('home').classList.remove('hidden');
 const filters = document.querySelector('.filters');
 if (filters) filters.classList.add('hidden');
 setRoute('home',push);
 renderProducts();
 window.scrollTo({top:0,behavior:'smooth'});
}
window.addEventListener('popstate',event => {
 const route = event.state?.brusaamRoute || decodeURIComponent(location.hash.slice(1)) || 'home';
 if (route.startsWith('category:')) {
  const [category,sub=''] = route.slice(9).split('|');
  openCategory(category,sub,false);
 } else if (route.startsWith('section:')) {
  openSection(route.slice(8),false);
 } else home(false);
});

function renderProducts() {
 const query = normalized($('search').value);
 const category = $('filterCategory').value;
 const sub = $('filterSub').value;

 const folderOnly = !!category && !sub && !currentSection && !query;
 const products = store.products.filter(product => {
  if (folderOnly) return false;
  if (!currentSection && Number(product.special_only) === 1) return false;
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
 let shown = 0;
 const more = node('button', 'Ver más');
 more.type = 'button';
 more.style.margin = '20px auto';
 more.style.display = 'block';
 const homePreview = !$('home').classList.contains('hidden') &&
  !query && !category && !sub && !currentSection;
 const addPage = () => {
  const size = homePreview && shown === 0 ? 3 : 24;
  const next = products.slice(shown, shown + size);
  for (const product of next) root.append(productCard(product));
  shown += next.length;
  if (shown < products.length) root.append(more);
  else more.remove();
 };
 more.onclick = () => { more.remove(); addPage(); };
 addPage();
}

function subtotal() {
 const allocation = packAllocation();
 let result = 0;

 for (const [key, quantity] of Object.entries(cart)) {
  const [id, kind] = key.split(':');

  const product = store.products.find(
   item => String(item.id) === id
  );

  if (product) {
   result += cartLinePrice(product,kind,quantity,key,allocation);
  }
 }

 return result;
}

function isPanDeAzucarFree(address) {
 const value = normalized(address);
 const excluded = /\bcruz\s+de\s+cana\b/.test(value);
 return !excluded && (
  /\bpan\s+de\s+azucar\b/.test(value) ||
  /\bnueva\s+vida\b/.test(value)
 );
}

function confirmedPanDeAzucar() {
 if (!$('panAzucarConfirm').checked) return false;
 const sector = $('panAzucarSector').value.trim();
 const address = $('address').value.trim();
 return Boolean(sector) && isPanDeAzucarFree('Pan de Azúcar ' + sector) &&
  !/\bcruz\s+de\s+cana\b/.test(normalized(address));
}

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
 const address = $('address').value;
 const panSelected = $('panAzucarConfirm').checked;

 if (panSelected && address.trim() && confirmedPanDeAzucar()) {
  return {type:'pan_free', amount:0, label:'Gratis (Pan de Azúcar)'};
 }

 if (panSelected) {
  return {type:'pending', amount:null, label:'Por calcular'};
 }

 if (!region || !commune || !address.trim()) {
  return {
   type: 'pending',
   amount: null,
   label: 'Por calcular'
  };
 }

 if (region === 'coquimbo' && commune === 'coquimbo' && (confirmedPanDeAzucar() || (! $('panAzucarConfirm').checked && isPanDeAzucarFree(address)))) {
  return {type:'pan_free', amount:0, label:'Gratis (Pan de Azúcar)'};
 }

 const local =
  region === 'coquimbo' &&
  (
   commune === 'la serena' ||
   commune === 'coquimbo'
  );

 if (local && subtotal() >= 30000) {
  return {
   type: 'free',
   amount: 0,
   label: 'Gratis'
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

function discountFor(product, kind, quantity) {
 const paid = priceFor(product, kind, quantity);
 const offer = Number(product.ofertas) === 1 &&
  Number(kind === 'manga' ? product.offer_manga_price : product.offer_price) > 0;
 const base = kind === 'manga' ? Number(product.manga_price) : Number(product.retail);
 if (offer) return Math.max(0, (base - paid) * quantity);
 if (kind !== 'manga' && Number(product.special_only) !== 1 &&
  quantity >= (Number(product.min_qty) || 2)) {
  return Math.max(0, (base - paid) * quantity);
 }
 return 0;
}

function renderCart() {
 const root = $('cartItems');
 root.replaceChildren();
 const allocation = packAllocation();

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

  
  const paired = allocation[key] || 0;
  const linePrice = cartLinePrice(product,kind,quantity,key,allocation);

  const isWholesale =
   Number(product.special_only) !== 1 && !(Number(product.ofertas) === 1 && Number(product.offer_price) > 0) &&
   kind !== 'manga' &&
   (quantity-paired)>0 && brusaamQualifies(product,kind,quantity-paired,allocation);

  const priceType = node(
   'div',
   paired > 0
    ? packLineLabel(product, paired)
    : Number(product.ofertas) === 1 && (kind === 'manga' ? Number(product.offer_manga_price) > 0 : Number(product.offer_price) > 0)
    ? 'Precio de oferta aplicado'
    : kind === 'manga'
    ? 'Precio por manga aplicado'
    : isWholesale
      ? 'Precio por mayor'
      : 'Precio al detalle'
  );

  priceType.className = isWholesale
   ? 'cartWholesaleLabel'
   : 'cartRetailLabel';

  information.append(priceType);

  const total = node(
   'div',
   'Total: ' + money(linePrice)
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
 
 let totalSavings = 0;
 for (const [key, quantity] of Object.entries(cart)) {
  const [id, kind] = key.split(':');
  const product = store.products.find(item => String(item.id) === id);
  if (product) totalSavings += cartLineDiscount(product,kind,quantity,key,allocation);
 }

 $('savingsTotal').textContent =
  money(totalSavings);

 $('savingsRow').style.display =
  totalSavings > 0 ? 'flex' : 'none';


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
   '¡Despacho gratis en La Serena y Coquimbo!',
  pan_free:
   '¡Tu pedido tiene despacho gratis!',
  local:
   'Tarifa de despacho: ' + delivery.label,
  external:
   'El envío a otras comunas y regiones es por pagar.'
 };

 $('shippingNotice').textContent =
  notices[delivery.type];
}

$('search').oninput = () => {
 if ($('search').value.trim()) {
  $('home').classList.add('hidden');
  currentSection = '';

  $('filterCategory').value = '';
  fillSubcategories();

  $('subTiles').replaceChildren();

  $('catalogTitle').textContent =

   'Resultados de búsqueda';
  document.querySelector('.filters')?.classList.remove('hidden');
  $('backHome').textContent = '← Volver al inicio';
 } else {
  home();
 }

 renderProducts();
};

$('filterCategory').onchange = () => {
 const category = $('filterCategory').value;
 if (category) openCategory(category);
 else home();
};

$('filterSub').onchange = () => {
 const category = $('filterCategory').value;
 if (category) openCategory(category,$('filterSub').value);
 else renderProducts();
};
$('backHome').onclick = () => {
 if ($('filterSub').value && $('filterCategory').value && !currentSection) {
  openCategory($('filterCategory').value);
 } else {
  home();
 }
};

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
$('panAzucarConfirm').onchange = () => {
 const selected = $('panAzucarConfirm').checked;
 $('panAzucarSectorWrap').classList.toggle('hidden', !selected);
 $('regionWrap').classList.toggle('hidden', selected);
 $('communeWrap').classList.toggle('hidden', selected);
 $('panAzucarSector').required = selected;
 $('region').required = !selected;
 $('commune').required = !selected;
 if (!selected) $('panAzucarSector').value = '';
 renderCart();
};
$('panAzucarSector').oninput = renderCart;

$('goCheckout').onclick = () => {
 if (!Object.keys(cart).length) {
  alert('Agrega productos al carrito.');
  return;
 }

 $('customerPanel').scrollIntoView({
  behavior: 'smooth'
 });
};

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

 if (!$('mode').value) {
  alert('Selecciona retiro o entrega a domicilio.');
  return;
 }

 const pickup = $('mode').value === 'pickup';

 const address = $('address').value.trim();
 const region = $('region').value;
 const commune = $('commune').value.trim();

 if (!pickup && (!address || (!$('panAzucarConfirm').checked && (!region || !commune)))) {
  alert($('panAzucarConfirm').checked
   ? 'Completa la dirección.'
   : 'Completa dirección, región y comuna.');
  return;
 }

 if (!pickup && $('panAzucarConfirm').checked && !$('panAzucarSector').value.trim()) {
  alert('Indica el sector de Pan de Azúcar para confirmar tu dirección.');
  $('panAzucarSector').focus();
  return;
 }

 const lines = [];
 let savings = 0;
 const allocation = packAllocation();

 for (const [key, quantity] of Object.entries(cart)) {
  const [id, kind] = key.split(':');
  const product = store.products.find(item => String(item.id) === id);
  if (!product) continue;
  const lineTotal = cartLinePrice(product,kind,quantity,key,allocation);
  savings += cartLineDiscount(product,kind,quantity,key,allocation);
  const presentation = kind === 'manga'
   ? 'manga(s) (' + product.packs_per_manga + ' paquetes por manga)'
   : paperProduct(product) ? 'paquete(s)' : 'unidad(es)';
  lines.push(
   '📝 *' + product.name + '*',
   'Cantidad: ' + quantity + ' ' + presentation,
   ...(allocation[key] ? [packLineLabel(product, allocation[key])] : []),
   'Total: ' + money(lineTotal),
   ''
  );
 }

 const delivery = shipping();
 const productsTotal = subtotal();
 const originalSubtotal = productsTotal + savings;
 const finalTotal = delivery.amount === null
  ? null : productsTotal + delivery.amount;
 const notes = $('orderNotes').value.trim();
 const pan = $('panAzucarConfirm').checked && !pickup;

 const message = [
  '🛍️ *BRUSAAM*',
  '✨ La excelencia en tu hogar ✨',
  '',
  '━━━━━━━━━━━━━━',
  '💜 *NUEVA SOLICITUD DE PEDIDO*',
  '━━━━━━━━━━━━━━',
  '',
  '🛒 *RESUMEN DE COMPRA*',
  '',
  ...lines,
  '━━━━━━━━━━━━━━',
  '🧾 *RESUMEN DE PAGO*',
  '',
  'Subtotal: ' + money(originalSubtotal),
  ...(savings > 0 ? ['💚 Descuentos aplicados: -' + money(savings)] : []),
  '🚚 Despacho: ' + delivery.label,
  '',
  finalTotal === null
   ? '💰 *TOTAL PRODUCTOS: ' + money(productsTotal) + '*'
   : '💰 *TOTAL A PAGAR: ' + money(finalTotal) + '*',
  ...(finalTotal === null ? [
   'El valor del despacho está pendiente de confirmación.',
   'El total final se confirmará al coordinar el envío.'
  ] : []),
  '━━━━━━━━━━━━━━',
  '',
  '👤 *DATOS DEL SOLICITANTE*',
  '',
  'Nombre: ' + customer,
  '',
  '📍 *DATOS DE ENTREGA*',
  '',
  'Modalidad: ' + (pickup ? 'Retiro en tienda' : 'Despacho a domicilio'),
  ...(!pickup ? [
   'Dirección: ' + address,
   ...(pan ? ['Sector de Pan de Azúcar: ' + $('panAzucarSector').value.trim()]
          : ['Comuna: ' + commune, 'Región: ' + region])
  ] : []),
  ...(notes ? ['', '📝 *OBSERVACIONES*', notes] : []),
  '',
  '━━━━━━━━━━━━━━',
  '💜 *¡Gracias por preferir BRUSAAM!*',
  '',
  '📲 Brusaam confirmará disponibilidad, pago y coordinación del pedido.'
 ].join('\n');

 window.location.href =
  'https://wa.me/56966282007?text=' +
  encodeURIComponent(message);
};

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
  const route = decodeURIComponent(location.hash.slice(1));
  history.replaceState({brusaamRoute:route||'home'},'',location.href);
  if (route.startsWith('category:')) {
   const [category,sub=''] = route.slice(9).split('|');
   openCategory(category,sub,false);
  } else if (route.startsWith('section:')) openSection(route.slice(8),false);
  else home(false);
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
  <button data-tab="packs">
   Arma tu Pack
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

 <div id="tab-packs" class="hidden">
  <section class="panel">
   <h3>💜 Arma tu Pack — precios por marca</h3>
   <p class="muted">Activa o desactiva cada marca y establece el precio total de 1 SH + 1 Acond. de la misma marca. Ballerina Doypack y Ballerina Botella se configuran por separado; Elvive también tiene su propia configuración. Ballerina Botella y Elvive comienzan deshabilitados. Los cambios se aplican al catálogo y al carrito.</p>
   <form id="packSettingsForm">
    <div id="packSettingsFields"></div>
    <button type="submit">Guardar precios y disponibilidad</button>
   </form>
   <p id="packSettingsMessage"></p>
  </section>
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

    <label class="checkLabel" style="background:#f5efff;padding:12px;border-radius:10px">
     <input id="pPackEligible" type="checkbox" checked>
     💜 Participa en Arma tu Pack
    </label>
    <p class="muted">Solo aplica si el producto también cumple las condiciones de marca y presentación del pack.</p>

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
     <h3>Papelería: paquete y manga</h3>

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

    <label>Precio de oferta (CLP)
     <input id="pOfferPrice" type="number" min="0" value="0">
    </label>
    <label>Precio de oferta por manga (solo papelería, CLP)
     <input id="pOfferMangaPrice" type="number" min="0" value="0">
    </label>
    <p class="notice">Al activar Ofertas, el paquete y la manga pueden tener precios rebajados independientes. No se aplica un descuento mayorista adicional a la presentación rebajada.</p>

    <h3>Secciones especiales</h3>

    <label class="checkLabel">
     <input id="pFeatured" type="checkbox">
     Los más destacados
    </label>


    <label class="checkLabel">
     <input id="pOffers" type="checkbox">
     Ofertas
    </label>


    <label class="checkLabel">
     <input id="pNew" type="checkbox">
     Nuevos Ingresos
    </label>

    <input id="pSpecialOnly" type="hidden" value="0">
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
   <h3>Carruseles automáticos de secciones</h3>
   <p class="notice">Las fotografías de portada ya no son necesarias: cada tarjeta muestra las fotos de sus productos. Los más destacados, Ofertas y Nuevos ingresos se asignan desde Productos; Pack Ahorro y Box Pyme se crean de manera independiente aquí.</p>
   <div id="sectionList"></div>
  </section>
  <section class="panel">
   <h3>Agregar producto independiente a una sección especial</h3>
   <p class="notice">Crea productos independientes exclusivamente para Pack Ahorro y Box Pyme. No se vinculan mediante casillas en el catálogo normal.</p>
   <form id="specialForm">
    <input type="hidden" id="specialId">
    <label>Sección especial <select id="specialSection" required></select></label>
    <label>Nombre del producto <input id="specialName" maxlength="160" required></label>
    <label>Descripción <textarea id="specialDescription" maxlength="1000"></textarea></label>
    <label>Precio único (CLP) <input id="specialPrice" type="number" min="0" required></label>
    <label>Stock disponible <input id="specialStock" type="number" min="0" required></label>
    <label>Fotografía <input id="specialFile" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <button type="button" id="uploadSpecial">Subir fotografía</button>
    <label>URL de fotografía <input id="specialImage" type="url"></label>
    <button type="submit">Guardar producto independiente</button>
    <button type="button" class="secondary" id="clearSpecial">Nuevo producto</button>
   </form>
   <h3>Productos independientes registrados</h3>
   <div id="specialProducts"></div>
   <p id="specialMessage"></p>
  </section>

  <section class="panel">
   <h3>Fotografías publicitarias de la portada</h3>
   <p class="notice">Las imágenes aparecerán en el espacio junto a Box Pyme, dentro de Secciones Especiales. Cambian automáticamente cada 4 segundos, sin precios ni enlaces de compra. Puedes agregar hasta 20 fotografías y quitarlas cuando quieras.</p>
   <label>Seleccionar fotografía
    <input type="file" id="promoFile" accept="image/jpeg,image/png,image/webp">
   </label>
   <button type="button" id="promoUpload">Subir fotografía publicitaria</button>
   <div id="promoList"></div>
   <p id="promoMessage"></p>
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
  'packs',
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

async function uploadFile(inputId) {
 const file = $(inputId).files[0];

 if (!file) {
  throw Error('Selecciona una fotografía.');
 }

 if (
  file.size === 0 ||
  file.size > 5 * 1024 * 1024
 ) {
  throw Error('Máximo 5 MB por fotografía.');
 }

 if (![

  'image/jpeg',
  'image/png',
  'image/webp'
 ].includes(file.type)) {
  throw Error('Solo JPG, PNG o WebP.');
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
   result.error || 'Error al subir imagen'
  );
 }

 return result.url;
}

function fillCategorySelects() {
 const product = $('pCategory');
 const sub = $('sCategory');

 const previousProduct = product.value;
 const previousSub = sub.value;

 product.replaceChildren();
 sub.replaceChildren();

 for (const category of data.categories) {
  product.add(
   new Option(category.name, category.name)
  );

  sub.add(
   new Option(category.name, String(category.id))
  );
 }

 if ([...product.options].some(
  option => option.value === previousProduct
 )) {
  product.value = previousProduct;
 }

 if ([...sub.options].some(
  option => option.value === previousSub
 )) {
  sub.value = previousSub;
 }

 fillProductSubs();
}

function fillProductSubs(selected = '') {
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
   select.add(new Option(sub.name, sub.name));
  }
 }

 if (
  selected &&
  ![...select.options].some(
   option => option.value === selected
  )
 ) {
  select.add(new Option(selected, selected));
 }

 select.value = selected || '';
 updatePaperFields();
}

function updatePaperFields() {
 const paper =
  $('pCategory').value === 'Papelería';

 $('paperFields').classList.toggle(
  'hidden',
  !paper
 );
}

$('pCategory').onchange = () =>
 fillProductSubs();

$('pSub').onchange = updatePaperFields;

function adminRow(label, image, edit, remove) {
 const row = document.createElement('div');
 row.className = 'adminRow';

 if (image) {
  const photo = document.createElement('img');
  photo.src = image;
  photo.alt = '';
  row.append(photo);
 }

 const title = document.createElement('strong');
 title.textContent = label;
 row.append(title);

 const editButton = document.createElement('button');
 editButton.textContent = 'Editar';
 editButton.onclick = edit;
 row.append(editButton);

 if (remove) {
  const removeButton =
   document.createElement('button');

  removeButton.textContent = 'Eliminar';
  removeButton.className = 'danger';
  removeButton.onclick = remove;

  row.append(removeButton);
 }

 return row;
}

function clearProduct() {
 $('productForm').reset();

 $('pId').value = '';
 $('pImage').value = '';
 $('pMin').value = '2';
 $('pMangaPrice').value = '0';
 $('pOfferPrice').value = '0';
 $('pOfferMangaPrice').value = '0';
 $('pSpecialOnly').value = '0';
 $('pPacksPerManga').value = '0';
 $('pActive').checked = true;
 $('pPackEligible').checked = true;

 fillProductSubs();
}

$('clearProduct').onclick = clearProduct;

function renderProducts() {
 const root = $('productList');
 root.replaceChildren();

 for (const product of data.products.filter(p=>Number(p.special_only)!==1 ||
  (Number(p.pack_ahorro)!==1 && Number(p.box_pyme)!==1))) {
  const edit = () => {
   $('pId').value = product.id;
   $('pName').value = product.name || '';
   $('pDescription').value =
    product.description || '';

   $('pRetail').value = product.retail;
   $('pWholesale').value = product.wholesale;
   $('pOfferPrice').value = product.offer_price || 0;
   $('pOfferMangaPrice').value = product.offer_manga_price || 0;
   $('pSpecialOnly').value = product.special_only || 0;
   $('pMin').value = product.min_qty || 2;
   $('pStock').value = product.stock;
   $('pImage').value = product.image || '';

   if (![...$('pCategory').options].some(
    option => option.value === product.category
   )) {
    $('pCategory').add(
     new Option(
      product.category,
      product.category
     )
    );
   }

   $('pCategory').value = product.category;

   fillProductSubs(
    product.subcategory || ''
   );

   $('pMangaPrice').value =
    product.manga_price || 0;

   $('pPacksPerManga').value =
    product.packs_per_manga || 0;

   $('pFeatured').checked =
    !!product.destacados;


   $('pOffers').checked =
    !!product.ofertas;

   $('pNew').checked = !!product.nuevos_ingresos;

   $('pActive').checked =
    !!product.active;
   $('pPackEligible').checked = Number(product.pack_eligible) !== 0;

   openTab('products');

   window.scrollTo({
    top: 0,
    behavior: 'smooth'
   });
  };

  const remove = async () => {
   if (!confirm(
    '¿Eliminar ' + product.name + '?'
   )) {
    return;
   }

   try {
    await api(
     '/api/admin/products/' + product.id,
     'DELETE',
     {}
    );

    await refresh();
   } catch (error) {
    alert(error.message);
   }
  };

  root.append(adminRow(
   product.name +
    ' | $' + product.retail +
    ' | Stock: ' + product.stock,
   product.image,
   edit,
   remove
  ));
 }
}

$('uploadProduct').onclick = async () => {
 try {
  $('pImage').value =
   await uploadFile('pFile');

  message(
   'productMessage',
   'Fotografía subida. Guarda el producto.'
  );
 } catch (error) {
  message('productMessage', error.message);
 }
};

$('productForm').onsubmit = async event => {
 event.preventDefault();

 const id = $('pId').value;

 const paper =
  $('pCategory').value === 'Papelería';

 const product = {
  name: $('pName').value.trim(),
  pack_eligible: $('pPackEligible').checked,
  category: $('pCategory').value,
  subcategory: $('pSub').value,
  description: $('pDescription').value,
  retail: Number($('pRetail').value),
  wholesale: Number($('pWholesale').value),
  offer_price: Number($('pOfferPrice').value),
  offer_manga_price: paper ? Number($('pOfferMangaPrice').value) : 0,
  special_only: Number($('pSpecialOnly').value),
  min_qty: Number($('pMin').value),
  stock: Number($('pStock').value),
  image: $('pImage').value.trim(),

  manga_price: paper
   ? Number($('pMangaPrice').value)
   : 0,

  packs_per_manga: paper
   ? Number($('pPacksPerManga').value)
   : 0,

  destacados: $('pFeatured').checked,
  pack_ahorro: Boolean(data.products.find(x=>String(x.id)===$('pId').value)?.pack_ahorro),
  ofertas: $('pOffers').checked,
  box_pyme: Boolean(data.products.find(x=>String(x.id)===$('pId').value)?.box_pyme),
  nuevos_ingresos: $('pNew').checked,
  active: $('pActive').checked
 };

 try {
  await api(
   '/api/admin/products' +
    (id ? '/' + id : ''),
   id ? 'PUT' : 'POST',
   product
  );

  clearProduct();
  await refresh();

  message(
   'productMessage',
   'Producto guardado correctamente.'
  );
 } catch (error) {
  message('productMessage', error.message);
 }
};

$('uploadSpecial').onclick = async () => {
 try {
  const file = $('specialFile').files[0];
  if (!file) throw Error('Selecciona una fotografía.');
  const form = new FormData(); form.append('file', file);
  const response = await fetch('/api/admin/upload', {method:'POST', credentials:'same-origin', body:form});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'No se pudo subir la fotografía');
  $('specialImage').value = result.url;
  message('specialMessage', 'Fotografía subida correctamente. Guarda el producto.');
 } catch(error) { message('specialMessage', error.message); }
};
$('clearSpecial').onclick = () => {
 $('specialForm').reset();
 $('specialId').value = '';
 $('specialImage').value = '';
};
$('specialForm').onsubmit = async event => {
 event.preventDefault();
 const slug = $('specialSection').value;
 if (!['pack_ahorro','box_pyme'].includes(slug)) {message('specialMessage','Selecciona Pack Ahorro o Box Pyme.');return;}
 const flags = {destacados:false,pack_ahorro:false,ofertas:false,box_pyme:false,nuevos_ingresos:false};
 flags[slug] = true;
 const price = Number($('specialPrice').value);
 const product = {
  name:$('specialName').value.trim(), category:'Secciones especiales', subcategory:'',
  description:$('specialDescription').value.trim(), retail:price, wholesale:price,
  offer_price:0, offer_manga_price:0, min_qty:999999, stock:Number($('specialStock').value),
  image:$('specialImage').value.trim(), manga_price:0, packs_per_manga:0,
  active:true, special_only:1, ...flags
 };
 try {
  const id = $('specialId').value;
  await api('/api/admin/products'+(id?'/'+id:''),id?'PUT':'POST',product);
  $('clearSpecial').click();
  message('specialMessage','Producto independiente guardado correctamente.');
  await refresh();
 } catch(error) { message('specialMessage',error.message); }
};

function renderSections() {
 const sectionSelect = $('specialSection');
 sectionSelect.replaceChildren();
 for (const section of data.sections.filter(x=>['pack_ahorro','box_pyme'].includes(x.slug)))
  sectionSelect.add(new Option(section.title,section.slug));
 const root = $('sectionList');
 root.replaceChildren();
 for (const section of data.sections) {
  const count = data.products.filter(product=>Number(product[section.slug])===1 && Number(product.active)!==0).length;
  const row = document.createElement('p');
  row.textContent = section.title+': '+count+' producto(s) en su carrusel automático.';
  root.append(row);
 }
 const specialRoot = $('specialProducts');
 specialRoot.replaceChildren();
 for (const product of data.products.filter(p =>
  Number(p.special_only) === 1 && (Number(p.pack_ahorro)===1 || Number(p.box_pyme)===1))) {
  const edit = () => {
   $('specialId').value = product.id;
   $('specialSection').value = Number(product.pack_ahorro)===1 ? 'pack_ahorro':'box_pyme';
   $('specialName').value = product.name || '';
   $('specialDescription').value = product.description || '';
   $('specialPrice').value = product.retail;
   $('specialStock').value = product.stock;
   $('specialImage').value = product.image || '';
   $('specialForm').scrollIntoView({behavior:'smooth'});
  };
  const remove = async () => {
   if (!confirm('¿Eliminar '+product.name+'?')) return;
   try {await api('/api/admin/products/'+product.id,'DELETE',{});await refresh();}
   catch(error){alert(error.message)}
  };
  specialRoot.append(adminRow(product.name+' | $'+product.retail+' | Stock: '+product.stock,
   product.image,edit,remove));
 }
}


async function savePromoGallery(items) {
 await api('/api/admin/promo-gallery','PUT',{images:items});
 await refresh();
}
function renderPromoGallery() {
 const root=$('promoList');root.replaceChildren();
 for (const [i,url] of (data.promoGallery||[]).entries()) {
  const row=document.createElement('div');
  row.className='adminRow';
  const img=document.createElement('img');img.src=url;img.alt='Publicidad '+(i+1);
  const remove=document.createElement('button');remove.type='button';remove.textContent='Eliminar';
  remove.onclick=async()=>{if(!confirm('¿Eliminar esta fotografía publicitaria?'))return;
   try {await savePromoGallery(data.promoGallery.filter((_,j)=>j!==i));message('promoMessage','Fotografía eliminada.');}
   catch(e){message('promoMessage',e.message);}
  };
  row.append(img,remove);root.append(row);
 }
}
$('promoUpload').onclick=async()=>{
 try {
  if((data.promoGallery||[]).length>=20)throw Error('Máximo 20 fotografías.');
  const url=await uploadFile('promoFile');
  await savePromoGallery([...(data.promoGallery||[]),url]);
  $('promoFile').value='';
  message('promoMessage','Fotografía publicada en el carrusel.');
 } catch(e){message('promoMessage',e.message);}
};

function renderCategories() {
 const root = $('categoryList');
 root.replaceChildren();

 for (const category of data.categories) {
  root.append(adminRow(
   category.name,
   category.image,

   () => {
    $('cId').value = category.id;
    $('cName').value = category.name;
    $('cImage').value = category.image || '';
    $('cPosition').value =
     category.position || 0;

    openTab('categories');

    window.scrollTo({
     top: 0,
     behavior: 'smooth'
    });
   },

   async () => {
    if (!confirm('¿Eliminar categoría?')) {
     return;
    }

    try {
     await api(
      '/api/admin/categories/' + category.id,
      'DELETE',
      {}
     );

     await refresh();
    } catch (error) {
     alert(error.message);
    }
   }
  ));
 }
}

$('uploadCategory').onclick = async () => {
 try {
  $('cImage').value =
   await uploadFile('cFile');

  message(
   'categoryMessage',
   'Fotografía subida. Guarda la categoría.'
  );
 } catch (error) {
  message('categoryMessage', error.message);
 }
};

$('categoryForm').onsubmit = async event => {
 event.preventDefault();

 const id = $('cId').value;

 try {
  await api(
   '/api/admin/categories' +
    (id ? '/' + id : ''),
   id ? 'PUT' : 'POST',
   {
    name: $('cName').value.trim(),
    image: $('cImage').value.trim(),
    position: Number($('cPosition').value)
   }
  );

  clearCategory();
  await refresh();

  message(
   'categoryMessage',
   'Categoría guardada.'
  );
 } catch (error) {
  message('categoryMessage', error.message);
 }
};

function clearSub() {
 $('subForm').reset();

 $('sId').value = '';
 $('sImage').value = '';
 $('sPosition').value = '0';
}

$('clearSub').onclick = clearSub;

function renderSubs() {
 const root = $('subList');
 root.replaceChildren();

 for (const sub of data.subcategories) {
  const category = data.categories.find(
   item => Number(item.id) ===
    Number(sub.category_id)
  );

  root.append(adminRow(
   (category?.name || 'Categoría') +
    ' › ' + sub.name,
   sub.image,

   () => {
    $('sId').value = sub.id;
    $('sCategory').value =
     String(sub.category_id);

    $('sName').value = sub.name;
    $('sImage').value = sub.image || '';
    $('sPosition').value =
     sub.position || 0;

    openTab('subs');

    window.scrollTo({
     top: 0,
     behavior: 'smooth'
    });
   },

   async () => {
    if (!confirm(
     '¿Eliminar subcategoría?'
    )) {
     return;
    }

    try {
     await api(
      '/api/admin/subcategories/' + sub.id,
      'DELETE',
      {}
     );

     await refresh();
    } catch (error) {
     alert(error.message);
    }
   }
  ));
 }
}

$('uploadSub').onclick = async () => {
 try {
  $('sImage').value =
   await uploadFile('sFile');

  message(
   'subMessage',
   'Fotografía subida. Guarda la subcategoría.'
  );
 } catch (error) {
  message('subMessage', error.message);
 }

};

$('subForm').onsubmit = async event => {
 event.preventDefault();

 const id = $('sId').value;

 try {
  await api(
   '/api/admin/subcategories' +
    (id ? '/' + id : ''),
   id ? 'PUT' : 'POST',
   {
    category_id:
     Number($('sCategory').value),

    name: $('sName').value.trim(),
    image: $('sImage').value.trim(),
    position: Number($('sPosition').value)
   }
  );

  clearSub();
  await refresh();

  message(
   'subMessage',
   'Subcategoría guardada.'
  );
 } catch (error) {
  message('subMessage', error.message);
 }
};

$('uploadLogo').onclick = async () => {
 try {
  const url = await uploadFile('logoFile');

  $('logoUrl').value = url;
  $('logoPreview').src = url;

  message(
   'designMessage',
   'Logo subido. Presiona Guardar logo.'
  );
 } catch (error) {
  message('designMessage', error.message);
 }
};

$('saveLogo').onclick = async () => {
 try {
  await api(
   '/api/admin/settings/logo',
   'PUT',
   {
    value: $('logoUrl').value.trim()
   }
  );

  await refresh();

  message(
   'designMessage',
   'Logo guardado.'
  );
 } catch (error) {
  message('designMessage', error.message);
 }
};

$('uploadDesign').onclick = async () => {
 try {
  $('designUrl').value =
   await uploadFile('designFile');

  message(
   'designMessage',
   'Diseño subido. Presiona Guardar diseño.'
  );
 } catch (error) {
  message('designMessage', error.message);
 }
};

$('saveDesign').onclick = async () => {
 try {
  await api(
   '/api/admin/settings/design',
   'PUT',
   {
    value: $('designUrl').value.trim()
   }
  );

  await refresh();

  message(
   'designMessage',
   'Diseño guardado.'
  );
 } catch (error) {
  message('designMessage', error.message);
 }
};

$('removeDesign').onclick = async () => {
 if (!confirm(
  '¿Quitar la imagen adicional?'
 )) {
  return;
 }

 try {
  await api(
   '/api/admin/settings/design',
   'PUT',
   { value: '' }
  );

  await refresh();

  message(
   'designMessage',
   'Imagen adicional retirada.'
  );
 } catch (error) {
  message('designMessage', error.message);
 }
};

const packBrandLabels = {
 sedal:'Sedal', pantene:'Pantene', suavelina:'Suavelina',
 familand:'Familand', ballerina:'Ballerina Doypack',
 ballerina_botella:'Ballerina Botella', elvive:'Elvive'
};
function renderPackSettings() {
 const root = $('packSettingsFields');
 root.replaceChildren();
 for (const [brand,label] of Object.entries(packBrandLabels)) {
  const setting = data.packSettings && data.packSettings[brand] || {enabled:!['ballerina_botella','elvive'].includes(brand),price:4890};
  const row = document.createElement('div');
  row.className = 'panel';
  const heading = document.createElement('strong');
  heading.textContent = label;
  const toggleLabel = document.createElement('label');
  const toggle = document.createElement('input');
  toggle.type = 'checkbox'; toggle.checked = setting.enabled !== false;
  toggle.id = 'packEnabled_' + brand;
  toggleLabel.append(toggle, document.createTextNode(' Promoción habilitada'));
  const priceLabel = document.createElement('label');
  priceLabel.textContent = 'Precio total del pack (2 productos)';
  const price = document.createElement('input');
  price.type = 'number'; price.min = '1'; price.max = '1000000';
  price.step = '1'; price.required = true;
  price.value = String(setting.price || 4890);
  price.id = 'packPrice_' + brand;
  priceLabel.append(price);
  row.append(heading,toggleLabel,priceLabel);
  root.append(row);
 }
}
$('packSettingsForm').onsubmit = async event => {
 event.preventDefault();
 const settings = {};
 for (const brand of Object.keys(packBrandLabels)) {
  settings[brand] = {
   enabled: $('packEnabled_' + brand).checked,
   price: Number($('packPrice_' + brand).value)
  };
 }
 try {
  await api('/api/admin/pack-settings','PUT',{settings});
  await refresh();
  message('packSettingsMessage','Precios y estados guardados correctamente.');
 } catch (error) {
  message('packSettingsMessage',error.message);
 }
};

async function refresh() {
 data = await api('/api/admin/data');

 $('logoUrl').value = data.logo || '';
 $('logoPreview').src = data.logo || '';
 $('shopLogo').src = data.logo || '';
 $('shopLogo').style.visibility = data.logo ? 'visible' : 'hidden';
 $('designUrl').value = data.design || '';

 fillCategorySelects();

 renderProducts();
 renderPackSettings();
 renderSections();
 renderPromoGallery();
 renderCategories();
 renderSubs();
}

$('loginForm').onsubmit = async event => {
 event.preventDefault();

 try {
  await api(
   '/api/admin/login',
   'POST',
   {
    password: $('password').value
   }
  );

  $('password').value = '';
  message('loginMessage', '');

  await startAdmin();
 } catch (error) {
  message('loginMessage', error.message);
 }
};

$('logout').onclick = async () => {
 await api(
  '/api/admin/logout',
  'POST',
  {}
 );

 await startAdmin();
};

async function startAdmin() {
 try {
  const session = await api(
   '/api/admin/session'
  );

  $('loginArea').classList.toggle(
   'hidden',
   session.authenticated
  );

  $('adminArea').classList.toggle(
   'hidden',
   !session.authenticated
  );

  if (session.authenticated) {
   await refresh();
  }
 } catch (error) {
  message('loginMessage', error.message);
 }

}

startAdmin();
</script>`;

/* VALIDACIÓN DE DATOS */

function validProduct(product) {
  if (
    !product ||
    typeof product.name !== "string" ||
    !product.name.trim() ||
    product.name.length > 160 ||
    typeof product.category !== "string" ||
    !product.category.trim() ||
    product.category.length > 100 ||
    typeof product.subcategory !== "string" ||
    product.subcategory.length > 100 ||
    typeof product.description !== "string" ||
    product.description.length > 1000 ||
    !validInteger(product.retail) ||
    !validInteger(product.wholesale) ||
    !validInteger(product.offer_price) ||
    !validInteger(product.offer_manga_price || 0) ||
    !validInteger(product.special_only || 0) ||
    (product.ofertas && !product.special_only && product.offer_price > 0 && product.offer_price >= product.retail) ||
    (product.ofertas && !product.special_only && product.offer_manga_price > 0 && product.offer_manga_price >= product.manga_price) ||
    !validInteger(product.min_qty, 1) ||
    !validInteger(product.stock) ||
    !validInteger(product.manga_price) ||
    !validInteger(product.packs_per_manga) ||
    !validImage(product.image)
  ) {
    return false;
  }

  const paper =
    product.category === "Papelería";

  if (
    !paper &&
    (
      product.manga_price ||
      product.packs_per_manga
    )
  ) {
    return false;
  }

  if (paper) {
    const price = product.manga_price > 0;
    const quantity = product.packs_per_manga > 0;

    if (price !== quantity) {
      return false;
    }
  }

  return true;
}

function validCategory(value) {
  return (
    value &&
    typeof value.name === "string" &&
    !!value.name.trim() &&
    value.name.length <= 100 &&
    validImage(value.image) &&
    Number.isSafeInteger(value.position)
  );
}

/* SUBIDA DE IMÁGENES CLOUDINARY */

async function cloudSignature(parameters, secret) {
  const content = Object.keys(parameters)
    .sort()
    .map(key => key + "=" + parameters[key])
    .join("&") + secret;

  const hash = await crypto.subtle.digest(
    "SHA-1",
    encoder.encode(content)
  );

  return [...new Uint8Array(hash)]
    .map(byte =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

async function uploadImage(request, env) {
  if (
    !env.CLOUDINARY_API_KEY ||
    !env.CLOUDINARY_API_SECRET
  ) {
    return reply({
      error: "Falta configurar Cloudinary"
    }, 503);
  }

  const length = Number(
    request.headers.get("Content-Length") || 0
  );

  if (length > 6 * 1024 * 1024) {
    return reply({
      error: "Archivo demasiado grande"
    }, 413);
  }

  const contentType =
    request.headers.get("Content-Type") || "";

  if (
    !contentType.toLowerCase().startsWith(
      "multipart/form-data;"
    )
  ) {
    return reply({
      error: "Formato no permitido"
    }, 400);
  }

  const form = await request.formData()
    .catch(() => null);

  const file = form?.get("file");

  if (
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > 5 * 1024 * 1024 ||
    ![
      "image/jpeg",
      "image/png",
      "image/webp"
    ].includes(file.type)
  ) {
    return reply({
      error: "Usa JPG, PNG o WebP de máximo 5 MB"
    }, 400);
  }

  const bytes = new Uint8Array(
    await file.slice(0, 12).arrayBuffer()
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
    String.fromCharCode(
      ...bytes.slice(0, 4)
    ) === "RIFF" &&
    String.fromCharCode(
      ...bytes.slice(8, 12)
    ) === "WEBP";

  if (
    !(
      (file.type === "image/jpeg" && jpeg) ||
      (file.type === "image/png" && png) ||
      (file.type === "image/webp" && webp)
    )
  ) {
    return reply({
      error: "El archivo no es una imagen válida"
    }, 400);
  }

  const parameters = {
    folder: "brusaam-productos",
    timestamp: String(
      Math.floor(Date.now() / 1000)
    )
  };

  const signature = await cloudSignature(
    parameters,
    env.CLOUDINARY_API_SECRET
  );

  const body = new FormData();

  body.append("file", file, file.name);
  body.append("folder", parameters.folder);
  body.append("timestamp", parameters.timestamp);
  body.append("api_key", env.CLOUDINARY_API_KEY);
  body.append("signature", signature);

  const response = await fetch(
    "https://api.cloudinary.com/v1_1/" +
    BR.cloud + "/image/upload",
    {
      method: "POST",
      body
    }
  );

  const result = await response.json()
    .catch(() => null);

  if (
    !response.ok ||
    !result?.secure_url ||
    !result.secure_url.startsWith(
      "https://res.cloudinary.com/" +
      BR.cloud + "/"
    )
  ) {
    return reply({
      error: "No se pudo subir la fotografía"
    }, 502);
  }

  return reply({
    url: result.secure_url
  });
}

/* SERVIDOR CLOUDFLARE WORKERS */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === "/" && method === "GET") {
        return htmlPage(SHOP);
      }

      if (
        path === "/admin" &&
        method === "GET"
      ) {
        return htmlPage(ADMIN, true);
      }

      if (
        path === "/api/admin/session" &&
        method === "GET"
      ) {
        return reply({
          authenticated:
            await loggedIn(request, env)
        });
      }

      if (
        path === "/api/shop" &&
        method === "GET"
      ) {
        await initialize(env);

        return reply(
          await getData(env)
        );
      }

      if (
        path === "/api/productos" &&
        method === "GET"
      ) {
        await initialize(env);

        const data = await getData(env);

        return reply(data.products);
      }

      if (!path.startsWith("/api/admin/")) {
        return reply({
          error: "Ruta no encontrada"
        }, 404);
      }

      if (
        !env.DB ||
        !env.ADMIN_PASSWORD ||
        !env.SESSION_SECRET
      ) {
        return reply({
          error:
            "Falta configuración del administrador"
        }, 503);
      }

      if (
        method !== "GET" &&
        !checkOrigin(request)
      ) {
        return reply({
          error: "Origen no permitido"
        }, 403);
      }

      /* INICIAR SESIÓN */

      if (
        path === "/api/admin/login" &&
        method === "POST"
      ) {
        await initialize(env);

        const ip =
          request.headers.get("CF-Connecting-IP") ||
          "unknown";

        const attempts =
          await env.DB.prepare(`
            SELECT failures,until_ms
            FROM login_attempts
            WHERE ip=?
          `).bind(ip).first() || {
            failures: 0,
            until_ms: 0
          };

        if (
          attempts.failures >= 5 &&
          attempts.until_ms > Date.now()
        ) {
          return reply({
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

        const hashEntered = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            encoder.encode(entered)
          )
        );

        const hashExpected = new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            encoder.encode(env.ADMIN_PASSWORD)
          )
        );

        let difference = 0;

        for (
          let i = 0;
          i < hashEntered.length;
          i++
        ) {
          difference |=
            hashEntered[i] ^ hashExpected[i];
        }

        if (difference !== 0) {
          const failures =
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
            failures,
            Date.now() + 15 * 60 * 1000
          ).run();

          return reply({
            error: "Contraseña incorrecta"
          }, 401);
        }

        await env.DB.prepare(`
          DELETE FROM login_attempts

          WHERE ip=?
        `).bind(ip).run();

        const expires = String(
          Date.now() + 8 * 60 * 60 * 1000
        );

        const signature = await sign(
          expires,
          env.SESSION_SECRET
        );

        return reply(
          { ok: true },
          200,
          {
            "Set-Cookie":
              BR.cookie + "=" +
              expires + "." + signature +
              "; HttpOnly; Secure; SameSite=Strict;" +
              " Path=/; Max-Age=28800"
          }
        );
      }

      /* CERRAR SESIÓN */

      if (
        path === "/api/admin/logout" &&
        method === "POST"
      ) {
        return reply(
          { ok: true },
          200,
          {
            "Set-Cookie":
              BR.cookie +
              "=; HttpOnly; Secure; SameSite=Strict;" +
              " Path=/; Max-Age=0"
          }
        );
      }

      if (!await loggedIn(request, env)) {
        return reply({
          error: "Debes iniciar sesión"
        }, 401);
      }

      /* SUBIR IMÁGENES */

      if (
        path === "/api/admin/upload" &&
        method === "POST"
      ) {
        return uploadImage(request, env);
      }

      await initialize(env);

      /* DATOS DE ADMINISTRACIÓN */

      if (
        path === "/api/admin/data" &&
        method === "GET"
      ) {
        return reply(
          await getData(env, true)
        );
      }

      /* CONFIGURACIÓN DE ARMA TU PACK POR MARCA */
      if (path === '/api/admin/pack-settings' && method === 'PUT') {
        const body = await request.json().catch(() => null);
        const settings = body && body.settings;
        if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
            Object.keys(settings).length !== PACK_BRANDS.length ||
            !PACK_BRANDS.every(brand => {
              const item = settings[brand];
              return item && typeof item.enabled === 'boolean' &&
                Number.isSafeInteger(item.price) && item.price > 0 && item.price <= 1000000;
            })) {
          return reply({error:'Revisa los precios (montos enteros mayores que cero) y los estados de las siete opciones.'},400);
        }
        await env.DB.prepare(`
          INSERT INTO shop_settings (key,value) VALUES ('pack_settings',?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value
        `).bind(JSON.stringify(settings)).run();
        return reply({ok:true});
      }

      /* PRODUCTOS */

      const productId = path.match(
        /^\/api\/admin\/products\/(\d+)$/
      );

      if (
        path === "/api/admin/products" &&
        method === "POST"
      ) {
        const product = await request.json()
          .catch(() => null);

        if (!validProduct(product)) {
          return reply({
            error: "Revisa los datos del producto"
          }, 400);
        }

        const result = await env.DB.prepare(`
          INSERT INTO products
          (
           name,category,subcategory,
           description,retail,wholesale,
           min_qty,stock,image,active,
           destacados,pack_ahorro,
           ofertas,box_pyme,
           manga_price,packs_per_manga,offer_price,offer_manga_price,nuevos_ingresos,special_only,pack_eligible
          )
          VALUES(
           ?,?,?,?,?,?,?,?,?,?,
           ?,?,?,?,?,?,?,?,?,?,?
          )
        `).bind(
          product.name.trim(),
          product.category,
          product.subcategory,
          product.description,
          product.retail,
          product.wholesale,
          product.min_qty,
          product.stock,
          product.image,
          product.active ? 1 : 0,
          product.destacados ? 1 : 0,
          product.pack_ahorro ? 1 : 0,
          product.ofertas ? 1 : 0,
          product.box_pyme ? 1 : 0,
          product.manga_price,
          product.packs_per_manga,
          product.offer_price,
          product.offer_manga_price || 0,
          product.nuevos_ingresos ? 1 : 0,
          product.special_only ? 1 : 0,
          product.pack_eligible === false ? 0 : 1
        ).run();

        return reply({
          ok: true,
          id: result.meta.last_row_id
        });
      }

      if (
        productId &&
        method === "PUT"
      ) {
        const product = await request.json()
          .catch(() => null);

        if (!validProduct(product)) {
          return reply({
            error: "Revisa los datos del producto"
          }, 400);
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
           packs_per_manga=?,
           offer_price=?,
           offer_manga_price=?,
           nuevos_ingresos=?,
           special_only=?,
           pack_eligible=?
          WHERE id=?
        `).bind(
          product.name.trim(),
          product.category,
          product.subcategory,
          product.description,
          product.retail,
          product.wholesale,
          product.min_qty,
          product.stock,
          product.image,
          product.active ? 1 : 0,
          product.destacados ? 1 : 0,
          product.pack_ahorro ? 1 : 0,
          product.ofertas ? 1 : 0,
          product.box_pyme ? 1 : 0,
          product.manga_price,
          product.packs_per_manga,
          product.offer_price,
          product.offer_manga_price || 0,
          product.nuevos_ingresos ? 1 : 0,
          product.special_only ? 1 : 0,
          product.pack_eligible === false ? 0 : 1,
          Number(productId[1])
        ).run();

        return reply({ ok: true });
      }

      if (
        productId &&
        method === "DELETE"
      ) {
        await env.DB.prepare(`
          DELETE FROM products
          WHERE id=?
        `).bind(
          Number(productId[1])
        ).run();

        return reply({ ok: true });
      }

      /* SECCIONES */


      const section = path.match(
        /^\/api\/admin\/sections\/([a-z_]+)$/
      );

      if (
        section &&
        method === "PUT"
      ) {
        const slug = section[1];

        if (
          !GROUPS.some(
            group => group[0] === slug
          )
        ) {
          return reply({
            error: "Sección no válida"
          }, 400);
        }

        const body = await request.json()
          .catch(() => null);

        if (
          !body ||
          !validImage(body.image)
        ) {
          return reply({
            error: "Imagen no válida"
          }, 400);
        }

        await env.DB.prepare(`
          UPDATE shop_sections
          SET image=?
          WHERE slug=?
        `).bind(
          body.image,
          slug
        ).run();

        return reply({ ok: true });
      }


      if (path === '/api/admin/promo-gallery' && method === 'PUT') {
        const body=await request.json().catch(()=>null);
        if (!body || !Array.isArray(body.images) || body.images.length>20 ||
            !body.images.every(url=>typeof url==='string' && /^https:\/\//.test(url) && validImage(url))) {
          return reply({error:'Fotografías no válidas (máximo 20).'},400);
        }
        await env.DB.prepare(`
          INSERT INTO shop_settings (key,value) VALUES ('promo_gallery',?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value
        `).bind(JSON.stringify(body.images)).run();
        return reply({ok:true});
      }

      /* LOGO Y DISEÑO */

      const setting = path.match(
        /^\/api\/admin\/settings\/(logo|design)$/
      );

      if (
        setting &&
        method === "PUT"
      ) {
        const key = setting[1];

        const body = await request.json()
          .catch(() => null);

        if (
          !body ||
          !validImage(body.value) ||
          (
            key === "logo" &&
            !body.value
          )
        ) {
          return reply({
            error: "URL de imagen no válida"
          }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO shop_settings
          (key,value)
          VALUES(?,?)
          ON CONFLICT(key)
          DO UPDATE SET
           value=excluded.value
        `).bind(
          key,
          body.value
        ).run();

        return reply({ ok: true });
      }

      /* CATEGORÍAS */

      const categoryId = path.match(
        /^\/api\/admin\/categories\/(\d+)$/
      );

      if (
        path === "/api/admin/categories" &&
        method === "POST"
      ) {
        const category = await request.json()
          .catch(() => null);

        if (!validCategory(category)) {
          return reply({
            error: "Datos de categoría inválidos"
          }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO shop_categories
          (name,image,position)
          VALUES(?,?,?)
        `).bind(
          category.name.trim(),
          category.image,
          category.position
        ).run();

        return reply({ ok: true });
      }

      if (
        categoryId &&
        method === "PUT"
      ) {
        const category = await request.json()
          .catch(() => null);

        if (!validCategory(category)) {
          return reply({
            error: "Datos de categoría inválidos"
          }, 400);
        }

        const id = Number(categoryId[1]);

        const old = await env.DB.prepare(`
          SELECT name
          FROM shop_categories
          WHERE id=?
        `).bind(id).first();

        if (!old) {
          return reply({
            error: "Categoría no encontrada"
          }, 404);
        }

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE shop_categories
            SET name=?,image=?,position=?
            WHERE id=?
          `).bind(
            category.name.trim(),
            category.image,
            category.position,
            id
          ),

          env.DB.prepare(`
            UPDATE products
            SET category=?
            WHERE category=?
          `).bind(
            category.name.trim(),
            old.name
          )
        ]);

        return reply({ ok: true });
      }

      if (
        categoryId &&
        method === "DELETE"
      ) {
        const id = Number(categoryId[1]);

        const old = await env.DB.prepare(`
          SELECT name
          FROM shop_categories
          WHERE id=?
        `).bind(id).first();

        if (!old) {
          return reply({
            error: "Categoría no encontrada"
          }, 404);
        }

        const count = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM products
          WHERE category=?
        `).bind(old.name).first();

        if (count.total > 0) {
          return reply({
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
            DELETE FROM shop_categories
            WHERE id=?
          `).bind(id)
        ]);

        return reply({ ok: true });
      }

      /* SUBCATEGORÍAS */

      const subId = path.match(
        /^\/api\/admin\/subcategories\/(\d+)$/
      );

      if (
        path === "/api/admin/subcategories" &&
        method === "POST"
      ) {
        const sub = await request.json()
          .catch(() => null);

        if (
          !validCategory(sub) ||
          !validInteger(sub.category_id, 1)
        ) {
          return reply({
            error: "Datos de subcategoría inválidos"
          }, 400);
        }

        const category = await env.DB.prepare(`
          SELECT id
          FROM shop_categories
          WHERE id=?
        `).bind(
          sub.category_id
        ).first();

        if (!category) {
          return reply({
            error: "Categoría principal no encontrada"
          }, 400);
        }

        await env.DB.prepare(`
          INSERT INTO shop_subcategories
          (category_id,name,image,position)
          VALUES(?,?,?,?)
        `).bind(
          sub.category_id,
          sub.name.trim(),
          sub.image,
          sub.position
        ).run();

        return reply({ ok: true });
      }

      if (
        subId &&
        method === "PUT"
      ) {
        const sub = await request.json()
          .catch(() => null);

        if (
          !validCategory(sub) ||
          !validInteger(sub.category_id, 1)
        ) {
          return reply({
            error: "Datos de subcategoría inválidos"
          }, 400);
        }

        const id = Number(subId[1]);

        const old = await env.DB.prepare(`
          SELECT
           s.name,
           c.name AS category
          FROM shop_subcategories s
          JOIN shop_categories c
           ON c.id=s.category_id
          WHERE s.id=?
        `).bind(id).first();

        const nextCategory =
          await env.DB.prepare(`
            SELECT name
            FROM shop_categories
            WHERE id=?
          `).bind(
            sub.category_id
          ).first();

        if (!old || !nextCategory) {
          return reply({
            error:
              "Categoría o subcategoría no encontrada"
          }, 404);
        }

        await env.DB.batch([
          env.DB.prepare(`
            UPDATE shop_subcategories
            SET
             category_id=?,
             name=?,
             image=?,
             position=?
            WHERE id=?
          `).bind(
            sub.category_id,
            sub.name.trim(),
            sub.image,
            sub.position,
            id
          ),

          env.DB.prepare(`
            UPDATE products
            SET category=?,subcategory=?
            WHERE category=? AND subcategory=?
          `).bind(
            nextCategory.name,
            sub.name.trim(),
            old.category,
            old.name
          )
        ]);

        return reply({ ok: true });
      }

      if (
        subId &&
        method === "DELETE"
      ) {
        const id = Number(subId[1]);

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
            error: "Subcategoría no encontrada"
          }, 404);
        }

        const count = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM products
          WHERE category=? AND subcategory=?
        `).bind(
          old.category,
          old.name
        ).first();

        if (count.total > 0) {
          return reply({
            error:
              "Esta subcategoría tiene productos. " +
              "Cámbialos antes de eliminarla."
          }, 409);
        }

        await env.DB.prepare(`
          DELETE FROM shop_subcategories
          WHERE id=?
        `).bind(id).run();

        return reply({ ok: true });
      }

      return reply({
        error: "Ruta no encontrada"
      }, 404);

    } catch (error) {
      console.error(
        "BRUSAAM ERROR:",
        error
      );

      if (
        String(error.message).includes(
          "UNIQUE constraint failed"
        )
      ) {
        return reply({
          error:
            "Ya existe un registro con ese nombre"
        }, 409);
      }

      return reply({
        error:
          "Error interno. Revisa los registros de Cloudflare."
      }, 500);
    }
  }
};
