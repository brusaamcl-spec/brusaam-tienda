/* BRUSAAM V32 - ETAPA PUBLICA 1: tarifas y progreso de despacho. NO PUBLICAR SIN PRUEBAS. */

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
    "https://res.cloudinary.com/oobzcqc2/image/upload/v1793010231/196d1a40-196d-4a38-b864-95954c6584e7.png",
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


function safeCustomPacks(raw) {
 let items=[];try{items=JSON.parse(raw||'[]');}catch{}
 return Array.isArray(items)?items.filter(x=>x&&typeof x==='object'&&typeof x.id==='string'&&typeof x.name==='string'&&typeof x.brand==='string'&&typeof x.format==='string'&&typeof x.presentation==='string'&&Number.isSafeInteger(x.price)&&x.price>0&&typeof x.enabled==='boolean').slice(0,60):[];
}

const SHIPPING_DEFAULTS={freeThreshold:30000,rates:{serena_general:2000,companias:2500,caleta:2500,coquimbo_general:1500,panul:2000,pan_azucar:0,cruz_cana:1500}};
const SHIPPING_LABELS={serena_general:'La Serena – sector general',companias:'Las Compañías y alrededores',caleta:'Caleta San Pedro / Islón / Lambert / Romeral',coquimbo_general:'Coquimbo – sector general',panul:'El Panul / La Rinconada',pan_azucar:'Pan de Azúcar (excepto Cruz de Caña)',cruz_cana:'Cruz de Caña'};
function safeShippingSettings(raw){
 let obj={};try{obj=typeof raw==='string'?JSON.parse(raw||'{}'):raw||{};}catch{}
 const threshold=Number(obj.freeThreshold);
 const rates={};for(const key of Object.keys(SHIPPING_DEFAULTS.rates)){
  const val=Number(obj.rates?.[key]);rates[key]=Number.isSafeInteger(val)&&val>=0&&val<=100000?val:SHIPPING_DEFAULTS.rates[key];
 }
 const customSectors=Array.isArray(obj.customSectors)?obj.customSectors.filter(x=>x&&/^sector_[a-z0-9_]{4,50}$/.test(String(x.id))&&['la serena','coquimbo'].includes(x.commune)&&typeof x.name==='string'&&x.name.trim().length>=2&&x.name.length<=90&&Number.isSafeInteger(x.price)&&x.price>=0&&x.price<=100000&&typeof x.enabled==='boolean').slice(0,60):[];
 return {freeThreshold:Number.isSafeInteger(threshold)&&threshold>=0&&threshold<=10000000?threshold:SHIPPING_DEFAULTS.freeThreshold,rates,customSectors};
}
async function readShippingSettings(env){const row=await env.DB.prepare("SELECT value FROM shop_settings WHERE key='shipping_settings'").first();return safeShippingSettings(row?.value);}

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

// Optimización V32: comprobar y migrar el esquema una sola vez por instancia
// del Worker, en vez de repetir decenas de consultas D1 por cada petición.
// Las promesas simultáneas comparten la misma inicialización. Si falla,
// se elimina la caché para permitir reintentos sin bloquear la tienda.
let brusaamSchemaInitialization = null;
async function initialize(env) {
  if (!brusaamSchemaInitialization) {
    brusaamSchemaInitialization = initializeSchema(env).catch(error => {
      brusaamSchemaInitialization = null;
      throw error;
    });
  }
  return brusaamSchemaInitialization;
}
async function initializeSchema(env) {
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
    ["pack_eligible", "INTEGER NOT NULL DEFAULT 0"],
    ["new_image", "INTEGER NOT NULL DEFAULT 0"],
    ["wholesale_group", "TEXT NOT NULL DEFAULT ''"]
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

  // V32 Finanzas: tabla privada, separada del catálogo público.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS shop_product_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL,
    changed_at INTEGER NOT NULL, field TEXT NOT NULL,
    old_value REAL NOT NULL, new_value REAL NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_brusaam_price_history_product ON shop_product_price_history(product_id,changed_at DESC)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS shop_order_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(amount>0), paid_at INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_brusaam_order_payments_order ON shop_order_payments(order_id,paid_at)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS shop_product_finances (
    product_id INTEGER PRIMARY KEY,
    cost_with_vat INTEGER NOT NULL DEFAULT 0,
    operating_percent REAL NOT NULL DEFAULT 20
  )`).run();

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
    CREATE TABLE IF NOT EXISTS shop_orders (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled','expired')),
      customer TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      delivery_method TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      commune TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT ''
    )
  `).run();
  const orderColumns = await env.DB.prepare("PRAGMA table_info(shop_orders)").all();
  if (!(orderColumns.results || []).some(c => c.name === 'stock_reserved')) {
    try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN stock_reserved INTEGER NOT NULL DEFAULT 1").run(); }
    catch(e) { if(!String(e.message).includes('duplicate column')) throw e; }
  }
  for (const [column,definition] of [['proposed_total','INTEGER'],['revision_note',"TEXT NOT NULL DEFAULT ''"],['review_state',"TEXT NOT NULL DEFAULT 'none'"]]) {
    if (!(orderColumns.results||[]).some(c=>c.name===column)) {
      try { await env.DB.prepare('ALTER TABLE shop_orders ADD COLUMN '+column+' '+definition).run(); }
      catch(e){if(!String(e.message).includes('duplicate column'))throw e;}
    }
  }
  try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN delivery_sector TEXT NOT NULL DEFAULT ''").run(); }
  catch(e) { if(!/duplicate column/i.test(String(e))) throw e; }
  // V32: WhatsApp verificado manualmente desde el chat entrante, no del checkout.
  for(const [col,def] of [['parent_order_id',"TEXT NOT NULL DEFAULT ''"],['merge_state',"TEXT NOT NULL DEFAULT 'none'"]]){
   try{await env.DB.prepare('ALTER TABLE shop_orders ADD COLUMN '+col+' '+def).run();}catch(e){if(!/duplicate column/i.test(String(e)))throw e;}
  }
  try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN order_channel TEXT NOT NULL DEFAULT 'whatsapp'").run(); }catch(e){if(!/duplicate column/i.test(String(e)))throw e;}
  try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN delivered_at INTEGER NOT NULL DEFAULT 0").run(); }catch(e){if(!/duplicate column/i.test(String(e)))throw e;}
  try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN dispatched_at INTEGER NOT NULL DEFAULT 0").run(); }catch(e){if(!/duplicate column/i.test(String(e)))throw e;}
  try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN pickup_ready_at INTEGER NOT NULL DEFAULT 0").run(); }catch(e){if(!/duplicate column/i.test(String(e)))throw e;}
  // Código público: números antiguos de cinco dígitos y nuevos códigos de cinco cifras más letra; UUID interno intacto.
  try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN public_code TEXT NOT NULL DEFAULT ''").run(); } catch(e) { if(!/duplicate column/i.test(String(e))) throw e; }
  await env.DB.prepare("UPDATE shop_orders SET public_code=printf('%05d',10000+rowid) WHERE public_code='' AND rowid BETWEEN 1 AND 89999").run();
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_orders_public_code ON shop_orders(public_code) WHERE public_code<>''").run();
   // Guardar vínculo histórico aunque el adicional se convierta en orden independiente.
   try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN separated_from_order_id TEXT NOT NULL DEFAULT ''").run(); } catch(e) { if(!/duplicate column/i.test(String(e)))throw e; }
   try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN exceptional_wholesale_note TEXT NOT NULL DEFAULT ''").run(); } catch(e) { if(!/duplicate column/i.test(String(e)))throw e; }
  // V32: permiso individual de adicionales para pedidos confirmados aún no entregados.
  try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN allow_confirmed_additional INTEGER NOT NULL DEFAULT 0").run(); }catch(e){if(!/duplicate column/i.test(String(e)))throw e;}
  try { await env.DB.prepare("ALTER TABLE shop_orders ADD COLUMN customer_whatsapp TEXT NOT NULL DEFAULT ''").run(); }
  catch(e) { if(!/duplicate column/i.test(String(e)))throw e; }
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS shop_bundle_components (bundle_id INTEGER NOT NULL, component_id INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), PRIMARY KEY(bundle_id,component_id))`).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS shop_order_items (
      order_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      stock_units INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      PRIMARY KEY(order_id, product_id, kind)
    )
  `).run();
  // V32: conservar la presentacion comercial original sin mezclarla con el stock.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS shop_order_commercial_lines (
    order_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('unidad','manga','pack')),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    product_name TEXT NOT NULL,
    PRIMARY KEY(order_id,product_id,kind)
  )`).run();
  // V32: columnas de auditoría de precios. NULL significa aún no validado por servidor.
  const commercialCols=(await env.DB.prepare('PRAGMA table_info(shop_order_commercial_lines)').all()).results||[];
  const existingCommercial=new Set(commercialCols.map(c=>c.name));
  for(const [column,definition] of [
    ['retail_snapshot','INTEGER'],['wholesale_snapshot','INTEGER'],
    ['offer_snapshot','INTEGER'],['manga_snapshot','INTEGER'],
    ['min_qty_snapshot','INTEGER'],['price_rule','TEXT'],
    ['validated_unit_price','INTEGER'],['validated_line_total','INTEGER']
  ]){
    if(!existingCommercial.has(column))await env.DB.prepare('ALTER TABLE shop_order_commercial_lines ADD COLUMN '+column+' '+definition).run();
  }
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS shop_order_pricing (order_id TEXT PRIMARY KEY, product_subtotal INTEGER NOT NULL, validated_at INTEGER NOT NULL, pricing_version TEXT NOT NULL)`).run();
  for(const [col,type] of [['delivery_amount','INTEGER'],['expected_total','INTEGER'],['shipping_kind','TEXT']]){try{await env.DB.prepare('ALTER TABLE shop_order_pricing ADD COLUMN '+col+' '+type).run();}catch(e){if(!/duplicate column/i.test(String(e)))throw e;}}
  // V11: registro contable separado de las reservas de inventario.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS shop_sales (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE,
      created_at INTEGER NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('online','presencial')),
      customer TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL,
      total INTEGER NOT NULL CHECK(total>=0),
      notes TEXT NOT NULL DEFAULT ''
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS shop_sale_items (
      sale_id TEXT NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity>0),
      unit_price INTEGER,
      line_total INTEGER,
      FOREIGN KEY(sale_id) REFERENCES shop_sales(id)
    )
  `).run();
  // Rentabilidad histórica: los costos se congelan en cada venta, nunca se recalculan con precios actuales.
  const financeSaleCols=new Set(((await env.DB.prepare('PRAGMA table_info(shop_sale_items)').all()).results||[]).map(x=>x.name));
  for(const [col,definition] of [['cost_snapshot','INTEGER'],['operating_percent_snapshot','REAL'],['estimated_expense_snapshot','INTEGER']]){
    if(!financeSaleCols.has(col))await env.DB.prepare('ALTER TABLE shop_sale_items ADD COLUMN '+col+' '+definition).run();
  }
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_shop_sales_created ON shop_sales(created_at)`).run();
  // Inventario V32: historial de mermas y existencias recuperables independientes del stock vendible.
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS shop_inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('loss','recoverable','restore','discard','sold_recoverable')),
    quantity INTEGER NOT NULL CHECK(quantity>0),
    cost_snapshot INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON shop_inventory_movements(product_id,created_at DESC)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS shop_inventory_recoverable (
    product_id INTEGER PRIMARY KEY,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0)
  )`).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS shop_stock_guard (
      value INTEGER NOT NULL CHECK(value=1)
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_shop_orders_expiry ON shop_orders(status,expires_at)
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

  const bundleRows=(await env.DB.prepare('SELECT bundle_id,component_id,quantity FROM shop_bundle_components').all()).results||[];
  const catalog=products.results||[];
  const allStock=(await env.DB.prepare('SELECT id,stock,active FROM products').all()).results||[];
  const stockMap=new Map(allStock.map(p=>[Number(p.id),p]));
  const bundleMap=new Map();
  for(const r of bundleRows){if(!bundleMap.has(r.bundle_id))bundleMap.set(r.bundle_id,[]);bundleMap.get(r.bundle_id).push({id:r.component_id,quantity:r.quantity});}
  for(const p of catalog){
   p.components=bundleMap.get(p.id)||[];
   if(p.components.length){
    const availability=Math.min(...p.components.map(c=>{const part=stockMap.get(Number(c.id));return part&&Number(part.active)===1?Math.floor(Number(part.stock)/Number(c.quantity)):0;}));
    p.stock=Math.max(0,Math.min(Number(p.stock),availability));
   }
  }
   if(admin){
    const financeRows=(await env.DB.prepare('SELECT product_id,cost_with_vat,operating_percent FROM shop_product_finances').all()).results||[];
    const financeMap=new Map(financeRows.map(r=>[Number(r.product_id),r]));
    for(const p of catalog){const f=financeMap.get(Number(p.id));p.cost_with_vat=f?Number(f.cost_with_vat):0;p.operating_percent=f?Number(f.operating_percent):20;}
   }
   return {
    products: catalog,
    categories: categories.results || [],
    subcategories: subcategories.results || [],
    sections: sections.results || [],
    logo: preferences.logo || BR.logo,
    design: preferences.design || "",
    packSettings: safePackSettings(preferences.pack_settings),
    customPacks: safeCustomPacks(preferences.custom_packs),
    shippingSettings: safeShippingSettings(preferences.shipping_settings),
    promoGallery: (() => { try { const a=JSON.parse(preferences.promo_gallery || "[]"); return Array.isArray(a) ? a.filter(x=>typeof x==="string" && /^https:\/\//.test(x)).slice(0,20) : []; } catch {return [];} })()
  };
}

/* RESERVAS V10: transacciones D1 y liberación de stock */
async function releaseOrder(env, orderId, nextStatus) {
 const order=await env.DB.prepare("SELECT * FROM shop_orders WHERE id=?").bind(orderId).first();
 if(!order||order.status!=='pending')return false;
 const items=(await env.DB.prepare("SELECT * FROM shop_order_items WHERE order_id=?").bind(orderId).all()).results||[];
 const batch=[
  env.DB.prepare("UPDATE shop_orders SET status=? WHERE id=? AND status='pending'").bind(nextStatus,orderId),
  env.DB.prepare("INSERT INTO shop_stock_guard(value) SELECT changes()"),
  env.DB.prepare("DELETE FROM shop_stock_guard")
 ];
 // Compatibilidad con pedidos de V12 anteriores: ya tenían stock reservado.
 if(Number(order.stock_reserved)===1)
  for(const item of items)batch.push(env.DB.prepare("UPDATE products SET stock=stock+? WHERE id=?").bind(item.stock_units,item.product_id));
 try{await env.DB.batch(batch);return true;}catch(e){console.error('Error al cancelar pedido',e);return false;}
}
function cleanOrderText(value,max=250) {
 return typeof value === 'string' ? value.trim().slice(0,max) : '';
}

// V32: el servidor utiliza las MISMAS reglas puras de precio del carrito público.
function calculateServerOrderPricing(products, commercialLines, packSettings, customPacks=[]){
 const store={products,packSettings,customPacks};
 const cart=Object.fromEntries(commercialLines.map(l=>[l.id+':'+l.kind,l.quantity]));
function normalized(text) {
 return String(text || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()
  .replace(/\s+/g, ' ');
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
 const brands=['rexona','head & shoulders','head and shoulders','h&s','pantene','sedal','poett','ballerina','suavelina','familand','elvive','lux','le sancy','dove','nivea','igenix','ais matic','ais','ro','quix','fuzol','jj','teddy','de osol','deosol','etiquet','bio','confort','elite','swan','abolengo'];
 const brand=brands.find(b=>(' '+name+' ').includes(' '+b+' '));
 // Si no conocemos la marca, exigimos la misma denominación base para evitar descuentos incorrectos.
 const tokens=name.replace(/[^a-z0-9&]+/g,' ').trim().split(/\s+/);
 const core=tokens.filter(t=>!brusaamAromas.has(t) && !/^(\d+(?:[.,]\d+)?(?:ml|cc|lt|lts|l|kg|gr|g|un|und|unidades|rollos|mts|mt))$/.test(t)).join(' ');
 // Grupo independiente: permite nuevas marcas sin alterar Arma tu Pack.
 const manualGroup=normalized(product.wholesale_group||'').trim();
 const family=brand ? brand : (manualGroup ? 'manual:'+manualGroup : core);
 if(!family)return '';
 // Separar presentaciones para no mezclar spray, roll-on, barra, doypack o botella.
 const presentation=/\b(spray|aerosol)\b/.test(name)?'spray':/\b(roll[ -]?on)\b/.test(name)?'roll-on':/\b(doypack|doy pack|bolsa|repuesto)\b/.test(name)?'doypack':/\b(botella|frasco)\b/.test(name)?'botella':/\b(barra)\b/.test(name)?'barra':'estandar';
 return [normalized(product.category),type,family,presentation,size,Number(product.retail),Number(product.wholesale),Number(product.min_qty)||2].join('|');
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

function customPackIdentity(product) {
 if (!product || Number(product.special_only)===1 || Number(product.pack_eligible)===0 || paperProduct(product))return null;
 const name=normalized(product.name||'');
 const type=/^(?:sh|shampoo|champu)(?:\s|\.|-)/.test(name)?'shampoo':/^(?:acond|acondicionador|balsamo)(?:\s|\.|-)/.test(name)?'acondicionador':null;
 if(!type)return null;
 for(const cfg of (store.customPacks||[])){
  if(!cfg.enabled)continue;
  const brand=normalized(cfg.brand), format=normalized(cfg.format).replace(/\s+/g,''), presentation=normalized(cfg.presentation);
  if(!brand||!format||!presentation)continue;
  if(!(' '+name+' ').includes(' '+brand+' '))continue;
  if(!name.replace(/\s+/g,'').includes(format))continue;
  // Estándar: sin indicación de envase; Botella/Doypack se identifican expresamente.
  if(presentation==='doypack'&&!/\b(doy\s*pack|doypack|bolsa)\b/.test(name))continue;
  if(presentation==='botella'&&!/\b(botella|frasco)\b/.test(name))continue;
  if(presentation==='estandar'&&/\b(doy\s*pack|doypack|bolsa|botella|frasco)\b/.test(name))continue;
  return {brand:cfg.id,type,customPrice:cfg.price};
 }
 return null;
}

function packIdentity(product) {
 const custom=customPackIdentity(product);if(custom)return custom;
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
 const custom=(store.customPacks||[]).find(x=>x.id===brand);
 const price = custom ? Number(custom.price) : settings && Number(settings.price) > 0 ? Number(settings.price) : 4890;
 // Si el precio del pack es impar, el peso restante se asigna al acondicionador.
 // De esta forma ambas líneas siempre suman exactamente el precio del pack.
 return type === 'acondicionador' ? Math.ceil(price / 2) : Math.floor(price / 2);
}

function packLineLabel(product, paired) {
 const identity = packIdentity(product);
 if (!identity || !paired) return '';
 return '💜 Arma tu Pack: ' + paired + ' unidad(es) a ' + String(packUnitPrice(identity.brand, identity.type)) + ' c/u';
}
function cartLinePrice(product, kind, quantity, key, allocation) {
 const paired = allocation[key] || 0;
 const remaining = quantity - paired;
 const identity = packIdentity(product);
 return paired * packUnitPrice(identity && identity.brand, identity && identity.type) + remaining * (brusaamQualifies(product,kind,remaining,allocation) ? Number(product.wholesale) : priceFor(product,kind,remaining));
}

 const allocation=packAllocation();
 let subtotal=0;
 const lines=commercialLines.map(l=>{
  const p=products.find(x=>Number(x.id)===Number(l.id));
  if(!p)throw Error('Producto no disponible para calcular precio');
  const key=l.id+':'+l.kind;
  const total=cartLinePrice(p,l.kind,l.quantity,key,allocation);
  if(!Number.isSafeInteger(total)||total<0||total>1000000000)throw Error('Total de línea inválido');
  subtotal+=total;
  const paired=allocation[key]||0;
  const remaining=l.quantity-paired;
  const rule=paired?'arma_tu_pack':l.kind==='manga'?'manga':Number(p.ofertas)===1&&Number(p.offer_price)>0?'oferta':brusaamQualifies(p,l.kind,remaining,allocation)?'mayorista':'detalle';
  return {...l,paired,line_total:total,discount:Math.max(0,(l.kind==='manga'?Number(p.manga_price):Number(p.retail))*l.quantity-total),price_rule:rule};
 });
 if(!Number.isSafeInteger(subtotal)||subtotal>1000000000)throw Error('Subtotal inválido');
 return {subtotal,lines};
}


// V32: tarifa calculada en servidor, nunca recibida del navegador.
/** @param {any} order @param {number} productSubtotal @param {{freeThreshold:number,rates:object,customSectors?:any}} shippingSettings */
function serverShippingQuote(order, productSubtotal, shippingSettings=SHIPPING_DEFAULTS) {
 const config=safeShippingSettings(shippingSettings);
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 if(order.delivery_method==='pickup')return {amount:0,kind:'pickup'};
 if(order.delivery_method!=='delivery')throw Error('Modalidad inválida');
 const region=norm(order.region), commune=norm(order.commune), address=norm(order.address);
 const sector=String(order.delivery_sector||'');
 if(!region||!commune||!address)throw Error('Completa la dirección');
 if(region!=='coquimbo'||!['la serena','coquimbo'].includes(commune))return {amount:0,kind:'collect'};
 if(!Number.isSafeInteger(productSubtotal)||productSubtotal<0)throw Error('Subtotal inválido');
 const options=commune==='la serena'?['serena_general','companias','caleta']
   :['coquimbo_general','panul','pan_azucar','cruz_cana'];
 // Los pedidos antiguos conservan su cálculo por dirección; los nuevos exigen sector explícito.
 if(!sector){
  const cruz=/\bcruz\s+de\s+cana\b/.test(address);
  const pan=/\bpan\s+de\s+azucar\b|\bnueva\s+vida\b/.test(address);
  if(commune==='coquimbo'&&pan&&!cruz)return {amount:0,kind:'pan_free'};
  if(productSubtotal>=config.freeThreshold)return {amount:0,kind:'free'};
  if(commune==='coquimbo')return {amount:config.rates.coquimbo_general,kind:'local'};
  return {amount:/\b(?:las\s+companias|caleta\s+san\s+pedro|pueblos?\s+islon|islon|lambert|romeral)\b/.test(address)?config.rates.companias:config.rates.serena_general,kind:'local'};
 }
 const custom=config.customSectors.find(x=>x.id===sector&&x.commune===commune&&x.enabled);
 if(!options.includes(sector)&&!custom)throw Error('Sector no corresponde a la comuna seleccionada o está deshabilitado');
 if(custom){
  if(productSubtotal>=config.freeThreshold)return {amount:0,kind:'free'};
  return {amount:custom.price,kind:'local'};
 }
 if(sector==='pan_azucar' && /\bcruz\s+de\s+cana\b/.test(address))throw Error('Cruz de Caña debe seleccionarse como sector independiente');
 if(sector==='pan_azucar')return {amount:config.rates.pan_azucar,kind:config.rates.pan_azucar===0?'pan_free':'local'};
 if(productSubtotal>=config.freeThreshold)return {amount:0,kind:'free'};
 return {amount:config.rates[sector],kind:'local'};
}

// Pedidos adicionales: fecha y hora siempre en America/Santiago.
function chileClock(ms=Date.now()) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return {date:parts.year+'-'+parts.month+'-'+parts.day,minute:Number(parts.hour)*60+Number(parts.minute),weekend:['Sat','Sun'].includes(parts.weekday)};
}
async function additionalDeadline(env,ms=Date.now()){
 const t=chileClock(ms);
 const row=await env.DB.prepare("SELECT value FROM shop_settings WHERE key='holiday_dates'").first();
 let holidays=[];try{holidays=JSON.parse(row?.value||'[]');}catch{}
 return {date:t.date,cutoff:t.weekend||holidays.includes(t.date)?14*60:19*60};
}
// El ciclo de despacho depende de la hora de ingreso del pedido original.
// Si se solicitó después del cierre, admite adicionales hasta el cierre del día siguiente.
function nextChileCalendarDate(date){
 const [y,m,d]=date.split('-').map(Number);
 return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10);
}
async function additionalWindowValid(env,parentMs,additionalMs=Date.now()){
 const original=await additionalDeadline(env,parentMs);
 const first=chileClock(parentMs),second=chileClock(additionalMs);
 const finalDate=first.minute>=original.cutoff?nextChileCalendarDate(first.date):first.date;
 if(second.date<first.date||second.date>finalDate)return false;
 if(second.date===finalDate){
  const deadline=await additionalDeadline(env,additionalMs);
  if(second.minute>=deadline.cutoff)return false;
 }
 return true;
}
function sameDeliveryText(a,b){return String(a||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()===String(b||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();}
async function additionalAccessToken(env,orderId){
 if(!env.SESSION_SECRET)throw Error('Falta SESSION_SECRET para validar pedidos adicionales.');
 return sign('brusaam-additional-v32:'+orderId,env.SESSION_SECRET);
}
async function findAdditionalParent(env,code,body){
 const prefix=String(code||'').trim().replace(/^#/,'').toUpperCase();
 if(!/^[0-9]{5}[A-Z]?$/.test(prefix))throw Error('Ingresa un código de pedido válido.');
 const matches=(await env.DB.prepare('SELECT * FROM shop_orders WHERE public_code=? LIMIT 2').bind(prefix).all()).results||[];
 if(matches.length!==1)throw Error('No se encontró un pedido anterior único.');
 const parent=matches[0];
 if(Number(parent.delivered_at)>0)throw Error('El pedido original ya fue entregado.');
 const authorizedConfirmed=parent.status==='confirmed'&&Number(parent.allow_confirmed_additional)===1;
 if(parent.status!=='pending'&&!authorizedConfirmed)throw Error('El pedido anterior no permite adicionales. Consulta con BRUSAAM.');
 if(parent.status==='pending'&&Number(parent.allow_confirmed_additional)!==1&&!await additionalWindowValid(env,Number(parent.created_at)))throw Error('El plazo para agregar productos al pedido anterior ya terminó. Realiza una compra nueva para el siguiente despacho.');
 if(parent.parent_order_id)throw Error('Ingresa el número del pedido original, no de un adicional.');
 // El código corto solo identifica el pedido; la unión requiere aprobación manual del administrador.
 return parent;
}

async function registerOrder(env, body) {
 const id=cleanOrderText(body?.id,80);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return reply({error:'Identificador de pedido inválido.'},400);
 const existing=await env.DB.prepare("SELECT id,status,public_code FROM shop_orders WHERE id=?").bind(id).first();
 if(existing){
  if(!/^\d{5}[A-Z]?$/.test(String(existing.public_code||'')))return reply({error:'Este pedido ya existe, pero su código de pedido aún no está disponible. No envíes una compra nueva; contacta a BRUSAAM para verificarlo.'},409);
  return reply({ok:true,id,status:existing.status,public_code:existing.public_code});
 }
  if(body?.order_mode==='additional')return reply({error:'Los pedidos adicionales ya no están disponibles. Realiza un pedido nuevo e independiente.'},409);
  // V32: cada compra es independiente; el flujo de adicionales fue retirado.
  const customer=cleanOrderText(body?.customer,160);
  const payment=cleanOrderText(body?.payment_method,50);
  const delivery=cleanOrderText(body?.delivery_method,50);
  if(!customer||!['Efectivo','Transferencia','Tarjeta Débito/Crédito'].includes(payment)||!['pickup','delivery'].includes(delivery))return reply({error:'Completa los datos del pedido.'},400);
  const orderChannel=body?.order_channel==='direct'?'direct':'whatsapp';
  const directPhone=String(body?.contact_phone||'').replace(/[^0-9]/g,'');
  if(directPhone.length<9||directPhone.length>12)return reply({error:'Ingresa un teléfono de contacto válido.'},400);
  const address=cleanOrderText(body?.address);
  const region=cleanOrderText(body?.region,100);
  const commune=cleanOrderText(body?.commune,100);
  const notes=cleanOrderText(body?.notes,1000);
  const deliverySector=cleanOrderText(body?.delivery_sector,50);
 if(delivery==='delivery'&&(!address||!commune))return reply({error:'Completa dirección y comuna.'},400);
 if(!Array.isArray(body?.items)||!body.items.length||body.items.length>100)return reply({error:'Carrito vacío o demasiado grande.'},400);
 const quantities=new Map(),items=[];
 for(const line of body.items){
  const pid=Number(line.id),qty=Number(line.quantity),kind=line.kind;
  if(!Number.isSafeInteger(pid)||pid<=0||!Number.isSafeInteger(qty)||qty<=0||qty>10000||!['unidad','manga','pack'].includes(kind))return reply({error:'Cantidad o presentación inválida.'},400);
  const key=pid+':'+kind;
  if(quantities.has(key))return reply({error:'Producto duplicado.'},400);
  quantities.set(key,qty);
 }
 const ids=[...new Set([...quantities.keys()].map(k=>Number(k.split(':')[0])))];
 const found=await env.DB.prepare("SELECT id,name,category,stock,active,packs_per_manga,retail,wholesale,min_qty,ofertas,offer_price,manga_price,offer_manga_price,special_only,pack_eligible,wholesale_group FROM products WHERE id IN ("+ids.map(()=>'?').join(',')+")").bind(...ids).all();
 const products=new Map((found.results||[]).map(p=>[p.id,p])),required=new Map(),snapshots=new Map();
 const componentRows=(await env.DB.prepare('SELECT bundle_id,component_id,quantity FROM shop_bundle_components WHERE bundle_id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all()).results||[];
 const components=new Map();for(const r of componentRows){if(!components.has(r.bundle_id))components.set(r.bundle_id,[]);components.get(r.bundle_id).push(r);}
 const componentIds=[...new Set(componentRows.map(r=>r.component_id))];
 if(componentIds.length){const rows=(await env.DB.prepare('SELECT id,name,stock,active FROM products WHERE id IN ('+componentIds.map(()=>'?').join(',')+')').bind(...componentIds).all()).results||[];for(const p of rows)products.set(p.id,p);}
 for(const [key,quantity] of quantities){
  const [idText,kind]=key.split(':'),pid=Number(idText),product=products.get(pid);
  if(!product||Number(product.active)!==1)return reply({error:'Producto no disponible; actualiza el catálogo.'},409);
  const parts=components.get(pid)||[];
  if(parts.length){
   if(kind==='manga')return reply({error:'Los packs compuestos se venden por unidad.'},400);
   if(quantity>Number(product.stock))return reply({error:'Se alcanzó el límite de packs disponibles.'},409);
   for(const part of parts){
    const item=products.get(part.component_id),units=quantity*Number(part.quantity);
    if(!item||Number(item.active)!==1||!Number.isSafeInteger(units)||units<=0)return reply({error:'Un componente del pack no está disponible.'},409);
    required.set(item.id,(required.get(item.id)||0)+units);
    const snapshotKey=item.id+':unidad';
    const snapshot=snapshots.get(snapshotKey)||{id:item.id,kind:'unidad',quantity:0,units:0,name:item.name};
    snapshot.quantity+=units;snapshot.units+=units;snapshots.set(snapshotKey,snapshot);
   }
  }else{
   const per=kind==='manga'?Number(product.packs_per_manga):1;
   if(!Number.isSafeInteger(per)||per<=0||(kind==='manga'&&per<2))return reply({error:'Presentación inválida.'},409);
   const units=quantity*per;
   if(!Number.isSafeInteger(units))return reply({error:'Cantidad excesiva.'},400);
   required.set(pid,(required.get(pid)||0)+units);
   const snapshotKey=pid+':'+(kind==='pack'?'unidad':kind);
   const snapshot=snapshots.get(snapshotKey)||{id:pid,kind:kind==='pack'?'unidad':kind,quantity:0,units:0,name:product.name};
   snapshot.quantity+=quantity;snapshot.units+=units;snapshots.set(snapshotKey,snapshot);
  }
 }
 for(const [pid,units] of required)if(Number(products.get(pid).stock)<units)return reply({error:'Stock insuficiente en '+products.get(pid).name+'; revisa tu carrito.'},409);
 items.push(...snapshots.values());
 // Precios calculados con productos reales y configuración vigente, nunca con precios del cliente.
 const settingRow=await env.DB.prepare("SELECT value FROM shop_settings WHERE key='pack_settings'").first();
 const packSettings=safePackSettings(settingRow?.value);
 const commercialInput=[...quantities].map(([key,quantity])=>{const [id,kind]=key.split(':');return {id:Number(id),kind,quantity};});
 let priced;
 try{priced=calculateServerOrderPricing([...products.values()],commercialInput,packSettings,safeCustomPacks((await env.DB.prepare("SELECT value FROM shop_settings WHERE key='custom_packs'").first())?.value));}
 catch(e){console.error('Error calculando pedido',e);return reply({error:'No fue posible validar los precios de este carrito.'},409);}
 // Cinco cifras y letra: 10098A ... 10098Z, 10099A ... 99999Z.
 // Los códigos anteriores permanecen intactos.
 const lastPublicRow=await env.DB.prepare('SELECT COALESCE(MAX(rowid),0) AS last_row FROM shop_orders').first();
 if(Number(lastPublicRow?.last_row||0)>=2337452){
  return reply({error:'No es posible asignar otro código de pedido. Contacta a BRUSAAM; tu carrito se conserva y no se registró esta solicitud.'},503);
 }
 const now=Date.now();
  const batch=[env.DB.prepare("INSERT INTO shop_orders(id,created_at,expires_at,status,customer,payment_method,delivery_method,address,region,commune,notes,stock_reserved,delivery_sector) VALUES(?,?,0,'pending',?,?,?,?,?,?,?,0,?)").bind(id,now,customer,payment,delivery,address,region,commune,notes,deliverySector)];
  batch.push(env.DB.prepare('UPDATE shop_orders SET customer_whatsapp=? WHERE id=?').bind(directPhone,id));
  batch.push(env.DB.prepare('UPDATE shop_orders SET order_channel=? WHERE id=?').bind(orderChannel,id));
  batch.push(env.DB.prepare("UPDATE shop_orders SET public_code=printf('%05d',10098+CAST((rowid-1)/26 AS INTEGER))||char(65+((rowid-1)%26)) WHERE id=? AND rowid BETWEEN 1 AND 2337452").bind(id));
  for(const item of items)batch.push(env.DB.prepare("INSERT INTO shop_order_items(order_id,product_id,kind,quantity,stock_units,product_name) VALUES(?,?,?,?,?,?)").bind(id,item.id,item.kind,item.quantity,item.units,item.name));
 // Guardar lineas comerciales originales; shop_order_items sigue siendo el detalle de inventario.
 for(const pricedLine of priced.lines){
  const {id:pid,kind,quantity}=pricedLine,p=products.get(pid);
  // Instantánea de tarifas para auditoría; NO se declara total validado hasta replicar
  // en servidor las reglas de agrupación mayorista y Arma tu Pack.
  const safePrice=v=>Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
  batch.push(env.DB.prepare(`INSERT INTO shop_order_commercial_lines
   (order_id,product_id,kind,quantity,product_name,retail_snapshot,wholesale_snapshot,offer_snapshot,manga_snapshot,min_qty_snapshot,price_rule,validated_unit_price,validated_line_total)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id,pid,kind,quantity,p.name,safePrice(p.retail),safePrice(p.wholesale),
    safePrice(p.ofertas)===1?safePrice(p.offer_price):null,
    safePrice(p.ofertas)===1&&safePrice(p.offer_manga_price)>0?safePrice(p.offer_manga_price):safePrice(p.manga_price),
    safePrice(p.min_qty)||2,pricedLine.price_rule,pricedLine.paired===0?pricedLine.line_total/quantity===Math.floor(pricedLine.line_total/quantity)?pricedLine.line_total/quantity:null:null,pricedLine.line_total));
 }
 let quote;try{quote=serverShippingQuote({delivery_method:delivery,address,region,commune,delivery_sector:deliverySector},priced.subtotal,await readShippingSettings(env));}catch(e){return reply({error:e.message},400);}
 batch.push(env.DB.prepare('INSERT INTO shop_order_pricing(order_id,product_subtotal,delivery_amount,expected_total,shipping_kind,validated_at,pricing_version) VALUES(?,?,?,?,?,?,?)').bind(id,priced.subtotal,quote.amount,priced.subtotal+quote.amount,quote.kind,now,'v32-public-shipping-2'));
 try{await env.DB.batch(batch);}catch(e){
  const duplicate=await env.DB.prepare("SELECT id,status,public_code FROM shop_orders WHERE id=?").bind(id).first();
  if(duplicate){
   if(!/^\d{5}[A-Z]?$/.test(String(duplicate.public_code||'')))return reply({error:'El pedido quedó registrado, pero su código de pedido no está disponible. Conserva el carrito y contacta a BRUSAAM antes de volver a comprar.'},409);
   return reply({ok:true,id,status:duplicate.status,public_code:duplicate.public_code});
  }
  console.error('Error registrando pedido',e);
  return reply({error:'No se pudo registrar el pedido.'},409);
 }
  const registered=await env.DB.prepare('SELECT public_code FROM shop_orders WHERE id=?').bind(id).first();
  if(!/^\d{5}[A-Z]?$/.test(String(registered?.public_code||''))) {
   console.error('Pedido registrado sin código público válido',id);
   return reply({error:'Pedido registrado, pero aún no se pudo verificar su número. Conserva el carrito y reintenta la misma solicitud.'},503);
  }
  return reply({ok:true,id,public_code:registered.public_code,status:'pending'});
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
 .brusaamOrderTabs{display:flex;gap:6px;margin:12px 0;flex-wrap:wrap}
 .brusaamOrderTabs button{flex:1;min-width:130px;background:#eee9f7;color:#56239c;font-size:13px}
 .brusaamOrderTabs button.active{background:#6725C7;color:#fff}
 #customerPanel.brusaamAdditionalCheckout > :not(#checkout):not(.confirmationMessage){display:none!important}
 #customerPanel.brusaamAdditionalCheckout .confirmationMessage{display:none!important}
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

 .brusaamProductDetails{font-size:12px;border-top:1px solid #eee;padding-top:7px;color:#34466d}
 .brusaamProductDetails summary{cursor:pointer;font-weight:800;color:#6725c7}
 .brusaamProductDetails p{line-height:1.5;overflow-wrap:anywhere}
 .brusaamMapLocation{border:1px solid #e5d8f5;background:#fcfaff;border-radius:12px;padding:12px;margin:10px 0}
 .brusaamMapLocation a{display:inline-block;margin:0 0 8px;font-size:13px}
 .paymentMethod{border:1px solid #dfc9f4;border-radius:12px;background:#faf7ff;padding:12px 14px;margin:10px 0 16px;min-width:0}
 .paymentMethod legend{font-weight:800;color:#583198;padding:0 5px}
 .paymentOption{display:flex;align-items:center;gap:9px;padding:10px 6px;font-size:15px;cursor:pointer;line-height:1.4}
 .paymentOption input[type=radio]{width:18px;height:18px;flex:0 0 18px;margin:0;accent-color:#6725C7}
 @media(max-width:600px){.paymentOption{font-size:14px}}


.brusaamLogoHomeLink{display:block;width:max-content;max-width:100%;margin:0 auto;cursor:pointer;text-decoration:none;border-radius:12px}
.brusaamLogoHomeLink:focus-visible{outline:3px solid #6725c7;outline-offset:5px}
.brusaamLogoHomeLink .logo{cursor:pointer}
.bundleEditor{border:1px solid #d9c7ef;border-radius:12px;padding:13px;margin:14px 0;background:#fbf8ff}
.bundleEditor legend{font-weight:800;color:#583198}
.bundleComponentRow{display:grid;grid-template-columns:minmax(0,1fr) 90px auto;gap:8px;align-items:center;margin:7px 0}
.bundleComponentRow select,.bundleComponentRow input{margin:0}
.bundlePartPicker{position:relative;min-width:0}
.bundlePartPicker .bundlePartSearch{width:100%;margin:0}
.bundleSuggestions{position:absolute;z-index:90;left:0;right:0;top:100%;max-height:235px;overflow-y:auto;background:white;border:1px solid #cbb8e8;border-radius:9px;box-shadow:0 8px 22px #20133b30}
.bundleSuggestions[hidden]{display:none}
.bundleSuggestions .bundleSuggestion{display:block;width:100%;text-align:left;background:white;color:#21335c;border-radius:0;padding:10px;border-bottom:1px solid #eee;font-weight:500;white-space:normal}
.bundleSuggestions .bundleSuggestion:hover,.bundleSuggestions .bundleSuggestion:focus{background:#f0e8fb;color:#53229a}
@media(max-width:600px){.bundleComponentRow{grid-template-columns:minmax(0,1fr) 72px auto}.bundleComponentRow button{padding:9px 6px}}
.orderFilterBar{display:flex;gap:9px;flex-wrap:wrap;margin:13px 0 17px}
.orderFilterButton{background:#f3effa;color:#54358d;border:1px solid #e4d9f3;padding:10px 13px;font-size:13px}
.orderFilterButton.active{background:#6725c7;color:#fff;border-color:#6725c7}
.orderFilterButton span{display:inline-block;min-width:22px;border-radius:20px;background:#ffffff35;padding:2px 5px;margin-left:4px}
.orderFilterButton:not(.active) span{background:#e4daf2}
@media(max-width:600px){.orderFilterButton{flex:1 1 44%}}
.brusaamChannelTabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0 12px}
.brusaamChannelTabs .orderFilterButton{display:flex;align-items:center;justify-content:center;gap:5px;min-height:54px;text-align:center;white-space:normal}
#customerPanel.brusaamOrderCompleted > :not(#brusaamCheckoutSuccess){display:none!important}
.brusaamCheckoutChoice{border:1px solid #ded6e9;border-radius:14px;padding:14px;margin:12px 0;background:#faf8ff;box-shadow:0 2px 6px #2815400b}
.brusaamCheckoutChoice button{width:100%;margin:0}
.brusaamCheckoutChoiceHelp{text-align:center;font-size:13px;color:#596579;margin:10px 3px 1px;line-height:1.45}
.brusaamCheckoutChoice:has(button:disabled){opacity:.6}

.brusaamOrderSearchBar{display:grid;grid-template-columns:minmax(0,2fr) minmax(180px,1fr);gap:12px;background:#faf8ff;padding:12px;border:1px solid #e8def5;border-radius:12px}
.brusaamOrderSearchBar label{font-size:13px;font-weight:700}
.brusaamOrderSearchBar input,.brusaamOrderSearchBar select{margin:6px 0 0;width:100%;min-width:0}
@media(max-width:700px){.brusaamChannelTabs{grid-template-columns:repeat(2,minmax(0,1fr))}.brusaamOrderSearchBar{grid-template-columns:1fr}}
.orderDateFilters{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:10px 0 18px;padding:12px;border-radius:12px;background:#f6f3fc}
.orderDateFilters label{font-size:13px;flex:1 1 160px}
.orderDateFilters input{margin:6px 0 0;min-width:0}
.orderDateFilters button{margin-bottom:0}
@media(max-width:600px){.orderDateFilters label{flex:1 1 100%}.orderDateFilters button{width:100%}}
/* V14 · Visibilidad de pedidos pendientes, sin alterar el inventario */
.pendingOrdersBadge{display:inline-flex;align-items:center;justify-content:center;min-width:23px;height:23px;padding:0 7px;border-radius:99px;background:#d63b68;color:#fff;font-size:12px;font-weight:900;margin-left:5px}
.orderToolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:15px 0}
.ordersSummary{font-size:15px;font-weight:800;color:#193c78;background:#eef5ff;padding:12px 15px;border-radius:12px;border:1px solid #dbe7fa}
.brusaamOrdersScroll{max-height:min(76vh,1100px);overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:3px 8px 3px 3px;border-radius:10px}
.orderPendingCard{border:2px solid #c0a0ee!important;background:linear-gradient(130deg,#fff,#faf5ff)!important;box-shadow:0 5px 18px #6630b91b!important}
/* V32: tarjetas de pedidos claras, acciones accesibles y lectura adaptable */
.brusaamInvoiceTitle{font-size:17px;font-weight:800;color:#38217e;margin-bottom:6px}
.brusaamInvoiceScroll{width:100%;overflow-x:auto;margin:12px 0}
.brusaamInvoiceTable{width:100%;border-collapse:collapse;min-width:390px;font-size:14px}
.brusaamInvoiceTable th{background:#f0eafb;color:#38217e;text-align:left;padding:11px 10px}
.brusaamInvoiceTable td{border-bottom:1px solid #ebe9f3;padding:11px 10px;vertical-align:top}
.brusaamInvoiceTable th:last-child,.brusaamInvoiceTable td:last-child{text-align:right;white-space:nowrap}
.brusaamInvoiceTable td:nth-child(2){white-space:nowrap}
.brusaamAdditionalRow{background:#faf7ff}
.brusaamAdditionalTag{color:#6835b3;font-size:12px;font-weight:700}
.brusaamMergedLabel{padding:9px;background:#f1eafb;border-radius:9px;color:#6228b3;font-weight:700}
.brusaamInvoiceTotals{margin:12px 0 0 auto;max-width:370px}
.brusaamInvoiceTotals>div{display:flex;justify-content:space-between;gap:15px;padding:7px 4px}
.brusaamInvoiceGrand{border-top:2px solid #d9c7f6;color:#5420a4;font-size:18px;font-weight:800}
.brusaamInvoiceActions{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0}
.brusaamInvoiceActions button{min-height:44px}
@media(max-width:650px){.brusaamInvoiceActions button{flex:1 1 180px}}
.brusaamOrderCard{border:1px solid #e5e7f3;border-radius:18px;padding:17px;margin:14px 0;background:#fff;box-shadow:0 4px 16px rgba(32,29,85,.045)}
.brusaamOrderCard.orderPendingCard{border-left:5px solid #8051d9}
.brusaamOrderCard .orderCardHeader h4{font-size:19px;letter-spacing:-.2px}
.brusaamOrderMeta{display:flex;flex-wrap:wrap;gap:8px;margin:11px 0}
/* Datos esenciales visibles sin abrir el detalle */
.brusaamOrderMeta{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}
.brusaamOrderMeta span{overflow-wrap:anywhere;line-height:1.4}
.brusaamOrderMeta span:nth-child(n+4){grid-column:1/-1}
@media(max-width:650px){.brusaamOrderMeta{grid-template-columns:1fr}.brusaamOrderMeta span:nth-child(n+4){grid-column:auto}}

.brusaamOrderMeta span{background:#f3f4fa;color:#344166;border-radius:9px;padding:7px 10px;font-size:13px}
.brusaamOrderQuick{display:flex;gap:9px;flex-wrap:wrap;margin:12px 0 4px}
.brusaamOrderQuick button{min-height:40px;padding:9px 14px;border-radius:10px}
.brusaamOrderExpanded{display:grid;gap:13px;margin-top:14px}
.brusaamOrderExpanded[hidden]{display:none}
.brusaamOrderSection{padding:15px;border:1px solid #e9eaf3;border-radius:13px;background:#fff}

/* V32: resaltar exclusivamente la orden abierta para revisión, sin alterar estados ni acciones. */
.brusaamOrderCard.brusaamOrderReviewing{border-color:#8050d7!important;box-shadow:0 0 0 3px rgba(115,55,212,.16),0 10px 26px rgba(75,35,150,.10)!important}
.brusaamOrderCard.brusaamOrderReviewing .brusaamOrderSection{background:#e6dcfa!important;border:2px solid #aa83eb!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.65)}
.brusaamOrderCard.brusaamOrderReviewing .orderProductList{background:#e6dcfa!important;color:#192b62!important}
.brusaamOrderCard.brusaamOrderReviewing .brusaamInvoiceTable th{background:#d0b9f4!important;color:#351777!important}
.brusaamOrderCard.brusaamOrderReviewing .brusaamInvoiceTable td{border-color:#c9b7e6!important}
.brusaamOrderCard.brusaamOrderReviewing .brusaamInvoiceTotals{background:#f3ecff;border:1px solid #c8abea;border-radius:12px;padding:8px 12px}
@media(max-width:650px){.brusaamOrderCard.brusaamOrderReviewing .brusaamOrderSection{padding:10px}}
.brusaamOrderSection h5{font-size:15px;margin:0 0 11px;color:#342b70}
.brusaamOrderSection .orderProductList{margin:0}
.brusaamOrderCard .orderActions{display:flex;gap:10px;flex-wrap:wrap}
.brusaamOrderCard .orderActions button{min-height:44px}
.brusaamOrderCard .brusaamOrderExpanded>.notice{margin:0!important}
@media(max-width:650px){.brusaamOrderCard{padding:12px}.brusaamOrderQuick button{flex:1 1 135px}.brusaamOrderCard .orderActions button{flex:1 1 150px}.brusaamOrderMeta span{flex:1 1 125px}}
.orderCardHeader{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.orderCardHeader h4{margin:0;font-size:17px}
.orderStatusPill{border-radius:99px;padding:6px 11px;font-size:12px;font-weight:900}
.orderStatusPill.pending{color:#8a3a00;background:#fff0ce}
.orderStatusPill.confirmed{color:#136d45;background:#dff6e9}
.orderStatusPill.cancelled,.orderStatusPill.expired{color:#8a354c;background:#fbe6ec}
.orderProductList{margin:10px 0;padding:10px 12px;background:#f6f8fe;border-radius:10px}
.orderProductList p{margin:5px 0;font-size:13px}
.orderActions{display:flex;flex-wrap:wrap;gap:10px;margin-top:13px}
.orderActions button{flex:1 1 170px}
.orderActions button.orderReject{background:#fff0f3;color:#9c2851;border:1px solid #e5b9c9}
.orderStockNotice{font-size:12px;color:#62468b;font-weight:700}
@media(max-width:600px){.ordersSummary{width:100%}.orderToolbar button{width:100%}}

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

/* V12 · PREMIUM BRUSAAM: exclusivamente presentación de Secciones Especiales */
#sectionTiles{
 display:grid!important;
 grid-template-columns:repeat(5,minmax(0,1fr))!important;
 gap:15px!important;
 align-items:stretch;
}
#sectionTiles .brusaamSectionTile{
 display:flex;flex-direction:column;align-items:stretch;
 position:relative;isolation:isolate;
 min-width:0;overflow:hidden;
 border:1px solid #e3e9f4;border-radius:19px;
 background:#fff;
 box-shadow:0 5px 20px rgba(23,47,99,.065);
 padding:10px 10px 0!important;
 transition:transform .22s ease,box-shadow .22s ease,border-color .22s ease;
}
#sectionTiles .brusaamSectionTile:hover{
 transform:translateY(-4px);border-color:#c7b8eb;
 box-shadow:0 12px 26px rgba(45,38,104,.13);
}
#sectionTiles .brusaamSectionTile:focus-visible{
 outline:3px solid #8048d9;outline-offset:3px;
}
#sectionTiles .brusaamSectionPhoto{
 display:block;width:100%;height:185px!important;
 padding:12px!important;border-radius:13px;
 object-fit:contain!important;object-position:center!important;
 background:linear-gradient(140deg,#f5faff,#fbf6ff)!important;
}
#sectionTiles .brusaamSectionTile strong{
 display:flex!important;flex:1;align-items:center;justify-content:center;
 min-height:72px;margin:10px -10px 0;
 padding:13px 8px 17px!important;
 background:linear-gradient(105deg,#e9f7ff 0%,#f0edff 100%);
 border-top:1px solid #e9e7f7;
 color:#173669!important;
 font-size:clamp(12px,1.12vw,16px)!important;
 font-weight:850!important;line-height:1.32!important;
 letter-spacing:.02em;text-align:center;text-transform:uppercase;
 white-space:normal!important;overflow-wrap:break-word!important;
}
#sectionTiles .brusaamSectionTile strong::after{
 content:'  →';color:#7132c9;font-weight:900;white-space:pre;
}
/* La galería de avisos/horarios se muestra debajo de las secciones comerciales. */
#sectionTiles .brusaamPromoGallery{
 grid-column:1 / -1!important;
 width:100%;min-height:180px;
 padding:10px;border:1px solid #e6e7f3;border-radius:18px;
 background:linear-gradient(105deg,#f5fbff,#f9f5ff);
 box-shadow:0 5px 20px rgba(23,47,99,.055);
}
#sectionTiles .brusaamPromoPhoto{
 width:100%;height:auto;max-height:320px;
 object-fit:contain!important;border-radius:12px;background:transparent!important;
}
@media(max-width:1050px){
 #sectionTiles{grid-template-columns:repeat(3,minmax(0,1fr))!important}
 #sectionTiles .brusaamSectionPhoto{height:160px!important}
}
@media(max-width:650px){
 #sectionTiles{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
 #sectionTiles .brusaamSectionTile{border-radius:15px;padding:7px 7px 0!important}
 #sectionTiles .brusaamSectionPhoto{height:128px!important;padding:7px!important}
 #sectionTiles .brusaamSectionTile strong{
  min-height:66px;margin:7px -7px 0;padding:10px 5px 12px!important;
  font-size:clamp(11px,3.2vw,14px)!important;line-height:1.3!important;
 }
 #sectionTiles .brusaamPromoGallery{grid-column:1 / -1!important;min-height:140px;padding:7px}
 #sectionTiles .brusaamPromoPhoto{max-height:230px}
}
@media(prefers-reduced-motion:reduce){
 #sectionTiles .brusaamSectionTile{transition:none!important}
 #sectionTiles .brusaamSectionTile:hover{transform:none}
}

.brusaamTopGallery{width:100%;max-width:none!important;margin:12px 0 22px!important;padding:0!important;min-height:110px}
.brusaamTopGallery .brusaamPromoGallery{width:100%!important;max-width:none!important;grid-column:auto!important;min-height:110px!important;padding:0!important;overflow:hidden;border-radius:16px}
.brusaamTopGallery .brusaamPromoPhoto{display:block;width:100%!important;height:auto!important;max-height:350px!important;object-fit:contain!important;border-radius:16px}
.brusaamAddedToast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:9999;background:#fff;color:#372157;box-shadow:0 6px 30px #0003;border:1px solid #dcc5f6;border-radius:16px;padding:12px 16px;display:flex;gap:14px;align-items:center;justify-content:center;max-width:calc(100vw - 24px);width:max-content}
.brusaamAddedToast.hidden{display:none!important}
.brusaamAddedToast button{white-space:nowrap;background:#7828d8;color:white;padding:10px;border-radius:10px}
.brusaamCartActions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.brusaamCartActions button{width:100%;font-size:clamp(12px,3vw,15px);padding:12px 7px}
#keepShopping{background:#f3e9ff;color:#6524a9;border:1px solid #d9c3f6}
.brusaamProductImageFrame{position:relative;width:100%}
.brusaamProductImageFrame img{width:100%}
.brusaamPackCornerBadge{position:absolute;top:7px;right:5px;max-width:80px;font-size:10px;font-weight:800;line-height:1.15;text-align:center;padding:6px 5px;border-radius:8px;background:#722bdc;color:white;box-shadow:0 2px 8px #0002}
.brusaamDiscountBadge{display:inline-block;align-self:flex-start;font-size:12px;font-weight:800;background:#d62828;color:#fff;border-radius:10px;padding:5px 9px;margin:4px 0}
@media(max-width:600px){.brusaamTopGallery .brusaamPromoPhoto{max-height:230px!important}.brusaamPackCornerBadge{font-size:9px;max-width:65px}}

/* BRUSAAM V30: etiqueta de oferta en esquina y vista inicial de 2 productos en móvil */
/* Cinta diagonal compacta: anclada al borde superior izquierdo, sin cubrir el centro de la fotografía. */
.brusaamOfferCorner{position:absolute;top:0;left:0;z-index:2;width:77px;height:77px;overflow:hidden;pointer-events:none;background:transparent!important;clip-path:none!important;filter:none!important;padding:0!important;min-width:0!important;min-height:0!important;display:block!important}
.brusaamOfferCorner strong{position:absolute;top:15px;left:-23px;width:105px;padding:3px 0;transform:rotate(-45deg);background:#e02028;color:#fff!important;font-size:10px!important;font-weight:900;letter-spacing:.5px;text-align:center;line-height:1.1;box-shadow:0 2px 4px #0002}
/* Cinta azul en esquina superior derecha, independiente de OFERTA. */
.brusaamNewImageCorner{position:absolute;top:0;right:0;z-index:3;width:105px;height:105px;overflow:hidden;pointer-events:none}
.brusaamNewImageCorner strong{position:absolute;top:23px;right:-31px;width:146px;padding:5px 0;transform:rotate(45deg);background:#1689c8;color:#fff;font-size:10px;font-weight:900;letter-spacing:.2px;text-align:center;box-shadow:0 2px 6px #0003}
@media(max-width:600px){.brusaamNewImageCorner{width:84px;height:84px}.brusaamNewImageCorner strong{top:18px;right:-34px;width:130px;font-size:9px;padding:4px 0}}
.brusaamPriceOfferRow{display:flex;align-items:center;justify-content:flex-start;gap:8px;flex-wrap:wrap}
.brusaamPriceOfferRow .price{margin:0}
.brusaamPriceOfferRow .brusaamDiscountBadge{margin:0;white-space:nowrap}
.presentationPriceOfferRow{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.presentationPriceOfferRow .brusaamDiscountBadge{margin:0}
.brusaamSeeMore{grid-column:1/-1;justify-self:stretch;width:100%;border-radius:12px;background:#782bd5;color:#fff;font-weight:700;min-height:42px;margin:8px 0 18px!important}
@media(max-width:600px){.brusaamOfferCorner{width:65px;height:65px}.brusaamOfferCorner strong{top:13px;left:-25px;width:100px;font-size:9px!important}.brusaamSeeMore{margin-top:8px!important}}

/* V32: administración de pantalla amplia con navegación lateral. */
.adminArea{max-width:none!important;width:100%!important;margin:0!important;padding:10px 18px!important;box-sizing:border-box}
#adminArea{display:grid;grid-template-columns:230px minmax(0,1fr);gap:12px 22px;align-items:start}
#adminArea.hidden{display:none!important}
#adminArea>.flex:first-child{grid-column:1/-1}
#adminArea>.adminTabs{grid-column:1;grid-row:2 / span 20;display:flex!important;flex-direction:column;align-items:stretch;position:sticky;top:10px;max-height:calc(100vh - 20px);overflow-y:auto;padding:12px!important;border:1px solid #e6d8f7;border-radius:16px;background:#faf7ff!important}
#adminArea>.adminTabs button{width:100%;text-align:left;white-space:normal;padding:12px 10px}
#adminArea>[id^="tab-"]{grid-column:2;min-width:0;width:100%}
#adminArea>[id^="tab-"].hidden{display:none!important}
#adminArea>[id^="tab-"]>.panel{max-width:none;width:100%;box-sizing:border-box}
@media(max-width:760px){#adminArea{grid-template-columns:minmax(0,1fr)}#adminArea>.flex:first-child,#adminArea>.adminTabs,#adminArea>[id^="tab-"]{grid-column:1}#adminArea>.adminTabs{grid-row:auto;position:static;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;max-height:none}#adminArea>.adminTabs button{min-width:145px;width:auto;flex-shrink:0;text-align:center} .adminArea{padding:8px!important}}

/* V32: catálogo administrativo visual; no afecta a la tienda pública */
.adminArea .adminTabs{display:flex;gap:8px;flex-wrap:wrap;position:sticky;top:0;z-index:10;background:#f7f9fe;padding:12px 0;border-bottom:1px solid #e5dafa}
.adminArea .adminTabs button{white-space:normal}
.catalogTools{display:grid;grid-template-columns:2fr repeat(3,minmax(130px,1fr));gap:9px;align-items:center}
.catalogTools input,.catalogTools select{margin:0}
.adminProductGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:13px}
.adminProductCard{border:1px solid #e2d9f3;border-radius:14px;padding:12px;background:white;display:flex;flex-direction:column;gap:8px;min-width:0}
.adminProductCard img{width:100%;height:140px;object-fit:contain;border-radius:9px;background:#f8f7fb}
.adminProductCard .cardName{font-weight:750;min-height:36px;overflow-wrap:anywhere}
.adminProductCard .cardFields{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.adminProductCard label{font-size:12px}
.adminProductCard input{margin:3px 0 0;padding:8px}
.adminProductCard .cardActions{display:flex;gap:6px;flex-wrap:wrap}
.adminProductCard .cardActions button{flex:1;font-size:12px;padding:8px 6px}
.adminProductCard .cardStatus{font-size:12px;color:#56647c}
@media(max-width:750px){.catalogTools{grid-template-columns:1fr 1fr}.catalogTools input{grid-column:1/-1}.adminProductGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.adminProductCard{padding:8px}.adminProductCard img{height:115px}}
@media(max-width:400px){.adminProductGrid{grid-template-columns:1fr}}

/* V32 carrito lateral */
.brusaamCartFloat{position:fixed;right:18px;bottom:20px;z-index:850;padding:15px 19px;border-radius:32px;box-shadow:0 8px 28px #21104a55;font-size:15px}
.brusaamCartFloat span{display:inline-flex;align-items:center;justify-content:center;background:white;color:#6725c7;min-width:24px;height:24px;border-radius:50%;margin-left:7px;padding:0 5px}
.brusaamCartShade{position:fixed;inset:0;background:#0d173b80;z-index:890}
.brusaamCartDock{position:fixed!important;top:0;right:0;bottom:0;z-index:900;width:min(475px,100vw);max-width:100vw;display:block!important;overflow-y:auto;overscroll-behavior:contain;background:#f7f9fe;padding:14px;box-shadow:-8px 0 30px #101c3550;transform:translateX(105%);visibility:hidden;transition:transform .23s ease,visibility .23s;scrollbar-gutter:stable}
.brusaamCartDock.brusaamCartOpen{transform:translateX(0);visibility:visible}
.brusaamCartDock .shopRight,.brusaamCartDock>.panel{width:100%;margin:0 0 12px}
.brusaamCartHead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.brusaamCartHead h2{margin:4px 0 12px}
.brusaamCartHead button{padding:8px 12px}
body.brusaamCartLocked{overflow:hidden}
@media(max-width:520px){.brusaamCartFloat{right:12px;bottom:12px}.brusaamCartDock{padding:9px}.brusaamCartDock .panel{padding:12px}}
</style>
</head>
<body>
<header class="flowerHeader">
${floralHeader}
<a id="brusaamLogoHomeLink" href="/" aria-label="Volver a la página principal de BRUSAAM" title="Volver al inicio" class="brusaamLogoHomeLink">
<img id="shopLogo" class="logo"
 src="${BR.logo}"
 alt="Logo Brusaam — volver al inicio" decoding="async"
 style="visibility:visible;background:transparent">
</a>
<div class="slogan">Articulos de Limpieza y Cuidado Personal</div>
<strong>Al POR MAYOR Y DETALLE</strong>
${admin ? "" : `
 <div class="brusaamHero" aria-label="Promociones BRUSAAM">
  <div class="brusaamHeroSlide banner active" aria-hidden="false">
   <div>🚚 BENEFICIO ESPECIAL</div>
   <strong>¡DESPACHO GRATIS!</strong>
   <p class="freeShippingSubtitle">✨Despacho gratis desde $30.000 en Coquimbo y La Serena✨</p>
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
setInterval(()=>{if(!document.hidden)brusaamHeroMove(1)},6000);
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
<div id="promoGallerySlot" class="brusaamPromoGallery brusaamPromoPlaceholder brusaamTopGallery" aria-label="Espacio publicitario BRUSAAM">📷 Espacio publicitario Brusaam</div>

<div class="search">
 <span>⌕</span>
 <input id="search"
  placeholder="Buscar productos, marcas o categorías...">
</div>

<div id="addedToast" class="brusaamAddedToast hidden" role="status" aria-live="polite"><strong>✓ Producto agregado</strong><button type="button" id="toastViewCart">Ver Carrito 🛒</button></div>
<div id="gpsReceivedToast" class="brusaamAddedToast hidden" role="status" aria-live="polite"><strong>📍 Ubicación recibida</strong></div>
<div class="shopLayout">
 <div class="shopLeft">

  <div id="home">
   <h2 class="sectionHeading">NUESTRAS CATEGORÍAS</h2>
   <div id="categoryTiles" class="tiles"></div>

   <h2 class="sectionHeading">SECCIONES ESPECIALES</h2>
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

<button type="button" id="brusaamCartFloat" class="brusaamCartFloat" aria-controls="brusaamCartDock" aria-expanded="false">🛒 Mi carrito <span id="brusaamCartCount">0</span></button>
<div id="brusaamCartShade" class="brusaamCartShade hidden"></div>
<div class="shopBottom brusaamCartDock" id="brusaamCartDock" role="dialog" aria-modal="true" aria-label="Mi carrito" aria-hidden="true">
 <aside class="shopRight">
  <section class="panel">
   
<div class="brusaamCartHead"><h2 id="cartTitle">🛒 MI CARRITO</h2><button type="button" id="closeCartDrawer" class="secondary" aria-label="Cerrar carrito">✕</button></div>

   <!-- Compatibilidad interna con pedidos históricos; no se muestran opciones de pedidos adicionales. -->
   <button type="button" id="normalOrderTab" hidden></button>
   <button type="button" id="additionalOrderTab" hidden></button>
   <div id="additionalOrderInfo" class="hidden" hidden>
    <input id="previousOrderCode" type="text" hidden>
    <input id="additionalApplicant" type="text" hidden>
   </div>
   <div id="cartItems"></div>
   <div style="display:flex;justify-content:flex-end;margin:8px 0 14px">
    <button id="emptyCartButton" type="button" class="secondary" style="font-size:14px">🗑️ Vaciar carrito</button>
   </div>

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

   <div id="v32FreeDeliveryProgress" class="notice" aria-live="polite" style="margin:12px 0"></div>
   <div class="brusaamCartActions"><button type="button" id="keepShopping">← Seguir comprando</button>
   <button id="goCheckout" type="button">
    💬 Solicitar Pedido
   </button></div>
  </section>
 </aside>

 <section class="panel brusaamShippingTerms">
  <h3>🚚 CONDICIONES Y TARIFAS DE DESPACHO</h3>

  <div class="scroll">
   <table>
    <thead>
     <tr>
      <th>Modalidad o zona</th>
      <th>Tarifa</th>
     </tr>
    </thead>
    <tbody id="brusaamShippingRatesBody"><tr><td colspan="2">Cargando tarifas vigentes…</td></tr></tbody>
   </table>
  </div>
 </section>

 </div>

  <section class="panel hidden" id="customerPanel">
  <h3>👤 Datos del Solicitante</h3>

  <label>Nombre y Apellido *
   <input id="customer" maxlength="120">
  </label>
  <label>Teléfono de contacto *
   <input id="customerPhone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="Ej.: +56 9 1234 5678">
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
     placeholder="Calle y número">
   </label>

   <div class="brusaamMapLocation">
    <button type="button" class="secondary" id="useCustomerGps">📍 Usar mi ubicación GPS</button>
    <p class="muted" id="gpsStatus">Opcional. Se solicitará tu permiso y podrás corregir la dirección manualmente.</p>
    <input type="hidden" id="customerMapsLink" value="">
   </div>
   <div class="panAzucarChoice hidden">
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

   <div id="communeWrap">
    <label for="communeChoice">Comuna *</label>
    <select id="communeChoice" style="width:100%;margin-top:6px" aria-label="Comunas disponibles"><option value="">Selecciona primero tu región</option></select>
    <label id="otherCommuneWrap" class="hidden" for="otherCommune">Otra Comuna — escribe su nombre *
     <input id="otherCommune" maxlength="100" placeholder="Escribe tu comuna">
    </label>
    <input type="hidden" id="commune" value="">
    <p class="muted" id="communeSelectionHelp">Selecciona una comuna de la lista. «Otra Comuna» siempre será envío por pagar.</p>
   </div>
   <label id="deliverySectorWrap" class="hidden">Sector de despacho *
    <select id="deliverySector"><option value="">Selecciona primero la comuna</option></select>
   </label>
   <p id="deliverySectorHelp" class="muted hidden">Selecciona el sector real de entrega. Si no encuentras el sector, consúltanos antes de solicitar el pedido.</p>
  </div>

  <fieldset class="paymentMethod" aria-labelledby="paymentLegend">
   <legend id="paymentLegend">💳 Método de Pago *</legend>
   <label class="paymentOption"><input type="radio" name="paymentMethod" value="Efectivo"> 💵 Efectivo</label>
   <label class="paymentOption"><input type="radio" name="paymentMethod" value="Transferencia"> 🏦 Transferencia</label>
   <label class="paymentOption"><input type="radio" name="paymentMethod" value="Tarjeta Débito/Crédito"> 💳 Tarjeta Débito/Crédito</label>
  </fieldset>

  <label>Observaciones del pedido (opcional)
   <textarea id="orderNotes" maxlength="450" rows="2"
    placeholder="Indicaciones para la entrega o comentarios"></textarea>
  </label>

  <p class="notice" id="shippingNotice">
   Completa tus datos para calcular el despacho.
  </p>

  <p class="notice" style="background:#f7f1ff;border:1px solid #e5d5fb;border-radius:12px;font-size:15px;line-height:1.55;padding:13px 15px">💜 <strong>¿Olvidaste agregar algún producto?</strong> Puedes volver a nuestra tienda y realizar un nuevo pedido. 🚚 BRUSAAM revisará si es posible compartir el despacho y te confirmará por WhatsApp.</p>
  <div class="brusaamCheckoutChoice" id="brusaamWhatsappChoice">
   <button type="button" id="checkout" style="width:100%;padding:15px;font-size:18px">💜 Finalizar compra</button>
   <p id="brusaamWhatsappHelp" class="brusaamCheckoutChoiceHelp">Tu pedido quedará registrado antes de ofrecerte WhatsApp.</p>
  </div>
  <div id="brusaamCheckoutSuccess" class="notice hidden" aria-live="polite" style="background:#f7f1ff;border:1px solid #e5d5fb;border-radius:14px;padding:16px;margin-top:14px;text-align:center">
   <h3>💜 ¡Tu solicitud fue enviada correctamente!</h3>
   <p><strong id="brusaamSuccessOrderCode"></strong></p>
   <p>📲 ¿Quieres recibir el resumen detallado de tu compra por WhatsApp?</p>
   <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
    <button type="button" id="brusaamSummaryYes">💚 Sí, enviar por WhatsApp</button>
    <button type="button" class="secondary" id="brusaamSummaryNo">🤍 No, gracias</button>
   </div>
   <p id="brusaamSummaryResponse" class="muted" aria-live="polite"></p>
  </div>
  <div id="brusaamDirectChoice" class="hidden"><button type="button" id="brusaamDirectStart">Pedido directo anterior</button><span id="brusaamDirectHelp"></span></div>
  <div id="brusaamDirectPanel" class="hidden"><span id="brusaamDirectCode"></span><button type="button" id="brusaamDirectCopy">Copiar</button><button type="button" id="brusaamDirectConfirm">Confirmar</button></div>

  <p class="confirmationMessage">
   Brusaam confirmará disponibilidad,
   pago y coordinación del pedido.
  </p>
  </section>
  <div id="brusaamEmptyOverlay" class="hidden" role="dialog" aria-modal="true" aria-labelledby="brusaamEmptyTitle" style="position:fixed;inset:0;z-index:99999;background:#10152a99;display:flex;align-items:center;justify-content:center;padding:18px">
   <div style="background:white;border-radius:16px;padding:24px;max-width:430px;width:100%;text-align:center">
    <h2 id="brusaamEmptyTitle">🗑️ ¿Deseas vaciar tu carrito?</h2>
    <p>Se eliminarán todos los productos agregados.</p>
    <button type="button" id="brusaamEmptyYes" class="danger" style="display:block;width:100%;font-size:18px;padding:15px;margin:12px 0">Sí, vaciar carrito</button>
    <button type="button" id="brusaamEmptyNo" class="secondary" style="display:block;width:100%;font-size:18px;padding:15px">No, conservar productos</button>
   </div>
  </div>

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
 packSettings: {},
 customPacks: [],
 shippingSettings: null
};

function renderPublicShippingRates(){
 const cfg=store.shippingSettings||{};
 const threshold=Number.isFinite(Number(cfg.freeThreshold))?Number(cfg.freeThreshold):30000;
 const rates=cfg.rates||{};
 const labels={serena_general:'La Serena – sector general',companias:'Las Compañías y alrededores (La Serena)',caleta:'Caleta San Pedro / Islón / Lambert / Romeral',coquimbo_general:'Coquimbo – sector general',panul:'El Panul / La Rinconada (Coquimbo)',pan_azucar:'Pan de Azúcar (excluye Cruz de Caña)',cruz_cana:'Cruz de Caña (Coquimbo)'};
 const defaults={serena_general:2000,companias:2500,caleta:2500,coquimbo_general:1500,panul:2000,pan_azucar:0,cruz_cana:1500};
 const tbody=$('brusaamShippingRatesBody');if(!tbody)return;
 tbody.replaceChildren();
 const add=(name,price,emphasis=false)=>{
  const tr=document.createElement('tr');const td=document.createElement('td'),cost=document.createElement('td');
  td.textContent=name;cost.textContent=price===null?'Envío por pagar':price===0?'Gratis':money(price);
  if(emphasis){td.style.fontWeight='700';cost.style.fontWeight='700';}
  tr.append(td,cost);tbody.append(tr);
 };
 const effectiveRate=id=>{
  const value=rates[id];
  return value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0
   ?Number(value):defaults[id];
 };
 const custom=(cfg.customSectors||[]).filter(sector=>sector.enabled===true);
 const isCoquimbo=sector=>String(sector.commune||'').trim().toLowerCase()==='coquimbo';
 const customRate=sector=>Number(sector.price)||0;
 const freeCustom=custom.filter(sector=>customRate(sector)===0);
 const paidCustom=custom.filter(sector=>customRate(sector)!==0);
 // 1. Modalidades y sectores con despacho gratis.
 add('Compras desde '+money(threshold)+' en sectores de reparto local de La Serena y Coquimbo',0,true);
 add('Retiro',0,true);
 for(const id of ['coquimbo_general','panul','pan_azucar','cruz_cana','serena_general','companias','caleta']){
  if(effectiveRate(id)===0)add(labels[id],0);
 }
 for(const sector of freeCustom)add(sector.name+' ('+(isCoquimbo(sector)?'Coquimbo':'La Serena')+')',0);
 // 2. Coquimbo y sus sectores.
 for(const id of ['coquimbo_general','panul','pan_azucar','cruz_cana']){
  if(effectiveRate(id)!==0)add(labels[id],effectiveRate(id));
 }
 for(const sector of paidCustom.filter(isCoquimbo))add(sector.name+' (Coquimbo)',customRate(sector));
 // 3. La Serena y sus sectores.
 for(const id of ['serena_general','companias','caleta']){
  if(effectiveRate(id)!==0)add(labels[id],effectiveRate(id));
 }
 for(const sector of paidCustom.filter(sector=>!isCoquimbo(sector)))add(sector.name+' (La Serena)',customRate(sector));
 // 4. Destinos fuera de las comunas de reparto local.
 add('Otras regiones/comunas',null);
 const banner=document.querySelector('.brusaamHero .freeShippingSubtitle');
 if(banner)banner.textContent='✨Despacho gratis desde '+money(threshold)+' en Coquimbo y La Serena✨';
}

let cart = {};
let brusaamOrderMode='normal';
function setBrusaamOrderMode(mode){
 brusaamOrderMode=mode;
 $('normalOrderTab').classList.toggle('active',mode==='normal');
 $('additionalOrderTab').classList.toggle('active',mode==='additional');
 $('normalOrderTab').setAttribute('aria-selected',String(mode==='normal'));
 $('additionalOrderTab').setAttribute('aria-selected',String(mode==='additional'));
 $('additionalOrderInfo').classList.toggle('hidden',mode!=='additional');
 $('checkout').textContent='💜 Finalizar compra';
 $('goCheckout').textContent='💜 Continuar compra';
 $('customerPanel').classList.toggle('brusaamAdditionalCheckout',mode==='additional');
 $('brusaamWhatsappHelp').classList.toggle('hidden',mode==='additional');
 $('brusaamDirectStart').classList.toggle('hidden',mode==='additional');
 $('brusaamDirectHelp').classList.toggle('hidden',mode==='additional');
 if(mode==='additional')$('brusaamDirectPanel').classList.add('hidden');
}
$('normalOrderTab').onclick=()=>setBrusaamOrderMode('normal');
$('additionalOrderTab').onclick=()=>setBrusaamOrderMode('normal'); // Compatibilidad con interfaz histórica oculta
$('previousOrderCode').addEventListener('input',function(){this.value=this.value.toUpperCase().replace(/[^0-9A-Z]/g,'').slice(0,6);});

const BRUSAAM_CART_KEY = 'brusaam_carrito_v1';
function resetBrusaamCheckout(){
 cart={};saveBrusaamCart();renderCart();setBrusaamOrderMode('normal');
 for(const id of ['customer','address','commune','otherCommune','orderNotes','customerMapsLink','panAzucarSector','previousOrderCode','additionalApplicant','customerPhone']){const el=$(id);if(el)el.value='';}
 for(const id of ['mode','region','deliverySector']){const el=$(id);if(el)el.value='';}
 document.querySelectorAll('input[name="paymentMethod"]').forEach(el=>el.checked=false);
 $('panAzucarConfirm').checked=false;
 $('panAzucarSectorWrap').classList.add('hidden');
 $('regionWrap').classList.remove('hidden');$('communeWrap').classList.remove('hidden');
 $('deliveryFields').classList.remove('hidden');
 $('otherCommuneWrap').classList.add('hidden');$('communeChoice').value='';brusaamUpdateCommuneOptions();
 $('customerPanel').classList.add('hidden');$('brusaamDirectPanel').classList.add('hidden');brusaamDirectId=null;
 $('gpsStatus').textContent='';$('gpsReceivedToast').classList.add('hidden');
 refreshDeliverySector();brusaamCloseCart();
 try{localStorage.removeItem(BRUSAAM_PENDING_ORDER_KEY);}catch(e){}
}
// V32: el pedido se registra en el servidor antes de ofrecer el resumen por WhatsApp.
// No solicitar confirmaciones manuales de envío ni vaciar el carrito al volver de WhatsApp.
$('emptyCartButton').onclick=()=>{if(Object.keys(cart).length){$('brusaamEmptyOverlay').classList.remove('hidden');$('brusaamEmptyNo').focus();}};
$('brusaamEmptyNo').onclick=()=>$('brusaamEmptyOverlay').classList.add('hidden');
$('brusaamEmptyYes').onclick=()=>{resetBrusaamCheckout();$('brusaamEmptyOverlay').classList.add('hidden');};


// V32: carrito persistente con respaldos independientes y recuperación sin sobrescritura.
// Nunca se guarda un carrito vacío desde el renderizado o durante el inicio.
const BRUSAAM_CART_BACKUP_KEY='brusaam_carrito_v32_respaldo';
const BRUSAAM_CART_STATE_KEY='brusaam_carrito_v32_estado';
let brusaamCartReady=false;
function brusaamSafeStorage(type){
 try{return window[type];}catch(e){return null;}
}
function brusaamCartEntries(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const clean={};
 for(const [key,raw] of Object.entries(value)){
  if(!/^[0-9]+:(unidad|manga|pack)$/.test(key))continue;
  const n=Number(raw);
  if(Number.isSafeInteger(n)&&n>0&&n<=10000)clean[key]=n;
 }
 return clean;
}
function brusaamReadCart(storage,key){
 if(!storage)return null;
 try{
  const raw=storage.getItem(key);
  if(raw===null)return null;
  const data=JSON.parse(raw);
  if(key===BRUSAAM_CART_STATE_KEY&&data&&typeof data==='object'){
   const items=brusaamCartEntries(data.items);
   return items===null?null:{items,updated:Number(data.updated)||0};
  }
  const items=brusaamCartEntries(data);
  return items===null?null:{items,updated:0};
 }catch(e){console.warn('No se pudo leer el carrito guardado',e);return null;}
}
function saveBrusaamCart(){
 if(!brusaamCartReady)return;
 const items=brusaamCartEntries(cart)||{};
 const serialized=JSON.stringify(items);
 const state=JSON.stringify({items,updated:Date.now()});
 let successful=false;
 for(const storage of [brusaamSafeStorage('localStorage'),brusaamSafeStorage('sessionStorage')]){
  if(!storage)continue;
  try{
   storage.setItem(BRUSAAM_CART_STATE_KEY,state);
   storage.setItem(BRUSAAM_CART_KEY,serialized);
   storage.setItem(BRUSAAM_CART_BACKUP_KEY,serialized);
   successful=true;
  }catch(e){console.warn('No se pudo guardar respaldo del carrito',e);}
 }
 if(!successful)console.warn('El navegador no permite guardar el carrito de forma persistente');
}
function restoreBrusaamCart(){
 const sources=[];
 for(const storage of [brusaamSafeStorage('localStorage'),brusaamSafeStorage('sessionStorage')]){
  for(const key of [BRUSAAM_CART_STATE_KEY,BRUSAAM_CART_KEY,BRUSAAM_CART_BACKUP_KEY]){
   const candidate=brusaamReadCart(storage,key);
   if(candidate)sources.push(candidate);
  }
 }
 // El estado versionado reciente distingue un vaciado intencional de un respaldo antiguo.
 const versioned=sources.filter(x=>x.updated>0).sort((a,b)=>b.updated-a.updated);
 if(versioned.length){
  cart=versioned[0].items;
 }else{
  // Migración de versiones anteriores: priorizar el respaldo que sí tenga productos.
  const nonempty=sources.find(x=>Object.keys(x.items).length>0);
  cart=nonempty?nonempty.items:(sources[0]?.items||{});
 }
 brusaamCartReady=true;
 // Sincronizar respaldos solamente después de terminar de recuperar los datos.
 saveBrusaamCart();
}
window.addEventListener('pagehide',()=>{if(brusaamCartReady)saveBrusaamCart();});
window.addEventListener('beforeunload',()=>{if(brusaamCartReady)saveBrusaamCart();});

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
   // Conservar el logo original si el logo guardado en D1 no está disponible.
   logo.style.visibility = 'visible';
   console.warn('No se pudo cargar el logo configurado en Brusaam; se conserva el logo original.');
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
 const brands=['rexona','head & shoulders','head and shoulders','h&s','pantene','sedal','poett','ballerina','suavelina','familand','elvive','lux','le sancy','dove','nivea','igenix','ais matic','ais','ro','quix','fuzol','jj','teddy','de osol','deosol','etiquet','bio','confort','elite','swan','abolengo'];
 const brand=brands.find(b=>(' '+name+' ').includes(' '+b+' '));
 // Si no conocemos la marca, exigimos la misma denominación base para evitar descuentos incorrectos.
 const tokens=name.replace(/[^a-z0-9&]+/g,' ').trim().split(/\s+/);
 const core=tokens.filter(t=>!brusaamAromas.has(t) && !/^(\d+(?:[.,]\d+)?(?:ml|cc|lt|lts|l|kg|gr|g|un|und|unidades|rollos|mts|mt))$/.test(t)).join(' ');
 // Grupo independiente: permite nuevas marcas sin alterar Arma tu Pack.
 const manualGroup=normalized(product.wholesale_group||'').trim();
 const family=brand ? brand : (manualGroup ? 'manual:'+manualGroup : core);
 if(!family)return '';
 // Separar presentaciones para no mezclar spray, roll-on, barra, doypack o botella.
 const presentation=/\b(spray|aerosol)\b/.test(name)?'spray':/\b(roll[ -]?on)\b/.test(name)?'roll-on':/\b(doypack|doy pack|bolsa|repuesto)\b/.test(name)?'doypack':/\b(botella|frasco)\b/.test(name)?'botella':/\b(barra)\b/.test(name)?'barra':'estandar';
 return [normalized(product.category),type,family,presentation,size,Number(product.retail),Number(product.wholesale),Number(product.min_qty)||2].join('|');
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

function customPackIdentity(product) {
 if (!product || Number(product.special_only)===1 || Number(product.pack_eligible)===0 || paperProduct(product))return null;
 const name=normalized(product.name||'');
 const type=/^(?:sh|shampoo|champu)(?:\s|\.|-)/.test(name)?'shampoo':/^(?:acond|acondicionador|balsamo)(?:\s|\.|-)/.test(name)?'acondicionador':null;
 if(!type)return null;
 for(const cfg of (store.customPacks||[])){
  if(!cfg.enabled)continue;
  const brand=normalized(cfg.brand), format=normalized(cfg.format).replace(/\s+/g,''), presentation=normalized(cfg.presentation);
  if(!brand||!format||!presentation)continue;
  if(!(' '+name+' ').includes(' '+brand+' '))continue;
  if(!name.replace(/\s+/g,'').includes(format))continue;
  // Estándar: sin indicación de envase; Botella/Doypack se identifican expresamente.
  if(presentation==='doypack'&&!/\b(doy\s*pack|doypack|bolsa)\b/.test(name))continue;
  if(presentation==='botella'&&!/\b(botella|frasco)\b/.test(name))continue;
  if(presentation==='estandar'&&/\b(doy\s*pack|doypack|bolsa|botella|frasco)\b/.test(name))continue;
  return {brand:cfg.id,type,customPrice:cfg.price};
 }
 return null;
}

function packIdentity(product) {
 const custom=customPackIdentity(product);if(custom)return custom;
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
 const custom=(store.customPacks||[]).find(x=>x.id===brand);
 const price = custom ? Number(custom.price) : settings && Number(settings.price) > 0 ? Number(settings.price) : 4890;
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

 if (!['pack','manga'].includes(kind)) {
  alert('Presentación no válida.');
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
 saveBrusaamCart(); // Guardar inmediatamente al agregar, antes de actualizar la interfaz.
 renderCart();
 const toast=$('addedToast');
 toast.classList.remove('hidden');
 clearTimeout(window.brusaamToastTimer);
 window.brusaamToastTimer=setTimeout(()=>toast.classList.add('hidden'),5000);
}

$('toastViewCart').onclick=()=>{
 $('addedToast').classList.add('hidden');
 brusaamOpenCart();
};

function offerPercentage(oldPrice,newPrice){
 const original=Number(oldPrice),discount=Number(newPrice);
 if(!(original>0&&discount>=0&&discount<original))return 0;
 return Math.round((original-discount)/original*100);
}
function offerBadge(oldPrice,newPrice){
 const badge=node('span','−'+offerPercentage(oldPrice,newPrice)+'%');
 badge.className='brusaamDiscountBadge';
 return badge;
}
function productCard(product) {
 const card = node('div');
 card.className = 'product';

 if (product.image) {
  const frame=node('div');frame.className='brusaamProductImageFrame';
  frame.append(photo(product.image, product.name));
  if(packIdentity(product)){
   const mark=node('span','💜 ARMA TU PACK');
   mark.className='brusaamPackCornerBadge';
   frame.append(mark);
  }
  if(Number(product.ofertas)===1){
   const original=Number(product.retail),sale=Number(product.offer_price);
   const mangaOriginal=Number(product.manga_price),mangaSale=Number(product.offer_manga_price);
   const discount=(original>0&&sale>0&&sale<original) ? offerPercentage(original,sale) :
     (mangaOriginal>0&&mangaSale>0&&mangaSale<mangaOriginal ? offerPercentage(mangaOriginal,mangaSale) : 0);
   if(discount>0){
    const corner=node('span');corner.className='brusaamOfferCorner';
    const title=node('strong','OFERTA');
    corner.append(title);
    frame.append(corner);
   }
  }
  if(Number(product.new_image)===1){
   const label=node("span");label.className="brusaamNewImageCorner";
   label.append(node("strong","NUEVA IMAGEN"));frame.append(label);
  }
  card.append(frame);
 } else {
  const empty = node('div', '📦');
  empty.style.cssText =
   'height:145px;display:grid;place-items:center';
  card.append(empty);
 }

 card.append(node('h3', product.name));
 if (product.description && Number(product.special_only)!==1) {
  const summary=node('p',String(product.description).slice(0,105)+(String(product.description).length>105?'…':''));
  summary.className='muted';summary.style.margin='2px 0';card.append(summary);
  const detail=node('details');detail.className='brusaamProductDetails';
  detail.append(node('summary','Ver detalles'));
  const full=node('p',product.description);full.style.whiteSpace='pre-wrap';detail.append(full);
  card.append(detail);
 }
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
    const old = node('span', 'Antes: ' + money(base));
    old.className = 'presentationOldPrice';
    content.append(old);
   }
   const price = node('span', money(finalPrice));
   price.className = 'presentationShownPrice';
   const priceRow=node('span');priceRow.className='presentationPriceOfferRow';
   priceRow.append(price);
   if(isOffer)priceRow.append(offerBadge(base,finalPrice));
   content.append(priceRow);
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
    amount.textContent = money(product.offer_price);
    details.textContent = 'Antes: ' + money(product.retail) + ' por paquete';
   } else if (presentation.value === 'manga') {
    amount.textContent =
     money(priceFor(product, 'manga', 1)) + ' por manga';

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
  const priceRow=node('div');priceRow.className='brusaamPriceOfferRow';
  priceRow.append(amount);
  if(isOffer && Number(product.offer_price)<Number(product.retail))priceRow.append(offerBadge(product.retail,product.offer_price));
  card.append(priceRow);
  if (isOffer) {
   const before = node('div', 'Antes: ' + money(product.retail));
   before.style.textDecoration = 'line-through';
   before.className = 'muted';
   card.append(before);
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
  const custom=(store.customPacks||[]).find(x=>x.id===pack.brand);
  const packPrice = custom ? Number(custom.price) : (store.packSettings && store.packSettings[pack.brand] && Number(store.packSettings[pack.brand].price)) || 4890;
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

 // Espacio publicitario de ancho completo entre bienvenida y buscador.
 const promoRoot=$('promoGallerySlot');
 promoRoot.replaceChildren();
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
  promoRoot.append(banner);
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
  promoRoot.append(placeholder);
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
 if (filters) filters.classList.remove('hidden');
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

 const folderOnly = false; // Mostrar productos al elegir categoría; subcategoría es filtro opcional.
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
 more.className='brusaamSeeMore';
 const homePreview = !$('home').classList.contains('hidden') &&
  !query && !category && !sub && !currentSection;
 const addPage = () => {
  const size = homePreview && shown === 0 ? (window.matchMedia('(max-width: 600px)').matches ? 2 : 3) : 24;
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
  !/\bcruz\s+de\s+cana\b/.test(normalized(address+' '+sector));
}

function shipping() {
 if($('mode').value==='pickup')return {type:'pickup',amount:0,label:'Retiro gratis'};
 const region=normalized($('region').value),commune=normalized($('commune').value),address=$('address').value.trim();
 if(!region||!commune||!address)return {type:'pending',amount:null,label:'Por calcular'};
 if(region!=='coquimbo'||!['la serena','coquimbo'].includes(commune))return {type:'external',amount:null,label:'Envío por pagar'};
 const sector=$('deliverySector').value;
 const allowed=commune==='la serena'?['serena_general','companias','caleta']:['coquimbo_general','panul','pan_azucar','cruz_cana'];
 const cfg=store.shippingSettings||{freeThreshold:30000,rates:{serena_general:2000,companias:2500,caleta:2500,coquimbo_general:1500,panul:2000,pan_azucar:0,cruz_cana:1500}};
 const custom=(cfg.customSectors||[]).find(x=>x.id===sector&&x.commune===commune&&x.enabled);
 if(!allowed.includes(sector)&&!custom)return {type:'pending',amount:null,label:'Selecciona tu sector'};
 if(custom)return subtotal()>=cfg.freeThreshold?{type:'free',amount:0,label:'Gratis'}:{type:'local',amount:custom.price,label:money(custom.price)};
 if(sector==='pan_azucar' && /\bcruz\s+de\s+cana\b/.test(normalized(address)))return {type:'pending',amount:null,label:'Selecciona Cruz de Caña'};

 if(sector==='pan_azucar')return {type:cfg.rates.pan_azucar===0?'pan_free':'local',amount:cfg.rates.pan_azucar,label:cfg.rates.pan_azucar===0?'Gratis (Pan de Azúcar)':money(cfg.rates.pan_azucar)};
 if(subtotal()>=cfg.freeThreshold)return {type:'free',amount:0,label:'Gratis'};
 return {type:'local',amount:cfg.rates[sector],label:money(cfg.rates[sector])};
}
function refreshDeliverySector(){
 const region=normalized($('region').value),commune=normalized($('commune').value);
 const options=region==='coquimbo'&&commune==='la serena'?
  [['serena_general','La Serena – sector general'],['companias','Las Compañías y alrededores'],['caleta','Caleta San Pedro / Islón / Lambert / Romeral']]:
  region==='coquimbo'&&commune==='coquimbo'?
  [['coquimbo_general','Coquimbo – sector general'],['panul','El Panul / La Rinconada'],['pan_azucar','Pan de Azúcar (excepto Cruz de Caña)'],['cruz_cana','Cruz de Caña']]:[];
 const select=$('deliverySector'),old=select.value;
 select.replaceChildren(new Option(options.length?'Selecciona tu sector':'Sector no requerido',''));
 const cfg=store.shippingSettings||{};
 for(const item of cfg.customSectors||[])if(item.enabled&&item.commune===commune&&region==='coquimbo')options.push([item.id,item.name]);
 for(const [value,label] of options)select.add(new Option(label,value));
 if(options.some(x=>x[0]===old))select.value=old;
 $('deliverySectorWrap').classList.toggle('hidden',!options.length);
 $('deliverySectorHelp').classList.toggle('hidden',!options.length);
 select.required=options.length>0&&$('mode').value!=='pickup';
 renderCart();
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
 const countBadge=$('brusaamCartCount');
 if(countBadge)countBadge.textContent=String(Object.values(cart).reduce((sum,q)=>sum+Number(q||0),0));
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

  // Mostrar la imagen del catálogo en el carrito; si falta, indicar que el producto no tiene foto.
  const cartImageUrl=String(product.image||product.image_url||'').trim();
  if(cartImageUrl && /^https:\/\//i.test(cartImageUrl)){
   const img=photo(cartImageUrl,product.name);
   img.onerror=()=>{img.remove();};
   row.append(img);
  }

  const information = node('div');
  information.className = 'cartinfo';

  information.append(
   node('strong', product.name)
  );
  if((product.components||[]).length&&product.description){const detail=node('div',product.description);detail.className='muted';information.append(detail);}

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

   saveBrusaamCart();
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
   saveBrusaamCart();
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
 const v32Progress = $('v32FreeDeliveryProgress');
 if (v32Progress) {
  const freeThreshold=Number(store.shippingSettings?.freeThreshold ?? 30000);
  const remaining = Math.max(0,freeThreshold-productsTotal);
  v32Progress.textContent = remaining > 0
   ? '🚚 Te faltan ' + money(remaining) + ' en productos para obtener despacho gratis en La Serena y Coquimbo.'
   : '💜 ¡Alcanzaste el mínimo de '+money(freeThreshold)+'! Despacho gratis en todas las zonas de reparto local de La Serena y Coquimbo.';
 }
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
$('brusaamLogoHomeLink').addEventListener('click',event => {
 event.preventDefault();
 home();
});
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

 refreshDeliverySector();
};

// Catálogo local de las 346 comunas de Chile: disponible incluso sin conexión a servicios externos.
const BRUSAAM_CHILE_COMUNAS = {"Arica y Parinacota":["Arica","Camarones","General Lagos","Putre"],"Tarapacá":["Alto Hospicio","Camiña","Colchane","Huara","Iquique","Pica","Pozo Almonte"],"Antofagasta":["Antofagasta","Calama","María Elena","Mejillones","Ollagüe","San Pedro de Atacama","Sierra Gorda","Taltal","Tocopilla"],"Atacama":["Alto del Carmen","Caldera","Chañaral","Copiapó","Diego de Almagro","Freirina","Huasco","Tierra Amarilla","Vallenar"],"Coquimbo":["Andacollo","Canela","Combarbalá","Coquimbo","Illapel","La Higuera","La Serena","Los Vilos","Monte Patria","Ovalle","Paiguano","Punitaqui","Río Hurtado","Salamanca","Vicuña"],"Valparaíso":["Algarrobo","Cabildo","Calera","Calle Larga","Cartagena","Casablanca","Catemu","Concón","El Quisco","El Tabo","Hijuelas","Isla de Pascua","Juan Fernández","La Cruz","La Ligua","Limache","Llaillay","Los Andes","Nogales","Olmué","Panquehue","Papudo","Petorca","Puchuncaví","Putaendo","Quillota","Quilpué","Quintero","Rinconada","San Antonio","San Esteban","San Felipe","Santa María","Santo Domingo","Valparaíso","Villa Alemana","Viña del Mar","Zapallar"],"Libertador General Bernardo O'Higgins":["Chimbarongo","Chépica","Codegua","Coinco","Coltauco","Doñihue","Graneros","La Estrella","Las Cabras","Litueche","Lolol","Machalí","Malloa","Marchihue","Mostazal","Nancagua","Navidad","Olivar","Palmilla","Paredones","Peralillo","Peumo","Pichidegua","Pichilemu","Placilla","Pumanque","Quinta de Tilcoco","Rancagua","Rengo","Requínoa","San Fernando","San Vicente","Santa Cruz"],"Maule":["Cauquenes","Chanco","Colbún","Constitución","Curepto","Curicó","Empedrado","Hualañé","Licantén","Linares","Longaví","Maule","Molina","Parral","Pelarco","Pelluhue","Pencahue","Rauco","Retiro","Romeral","Río Claro","Sagrada Familia","San Clemente","San Javier","San Rafael","Talca","Teno","Vichuquén","Villa Alegre","Yerbas Buenas"],"Ñuble":["Bulnes","Chillán","Chillán Viejo","Cobquecura","Coelemu","Coihueco","El Carmen","Ninhue","Pemuco","Pinto","Portezuelo","Quillón","Quirihue","Ránquil","San Carlos","San Fabián","San Ignacio","San Nicolás","Treguaco","Yungay","Ñiquén"],"Biobío":["Alto Biobío","Antuco","Arauco","Cabrero","Cañete","Chiguayante","Concepción","Contulmo","Coronel","Curanilahue","Florida","Hualpén","Hualqui","Laja","Lebu","Los Álamos","Los Ángeles","Lota","Mulchén","Nacimiento","Negrete","Penco","Quilaco","Quilleco","San Pedro de la Paz","San Rosendo","Santa Bárbara","Santa Juana","Talcahuano","Tirúa","Tomé","Tucapel","Yumbel"],"La Araucanía":["Angol","Carahue","Cholchol","Collipulli","Cunco","Curacautín","Curarrehue","Ercilla","Freire","Galvarino","Gorbea","Lautaro","Loncoche","Lonquimay","Los Sauces","Lumaco","Melipeuco","Nueva Imperial","Padre las Casas","Perquenco","Pitrufquén","Pucón","Purén","Renaico","Saavedra","Temuco","Teodoro Schmidt","Toltén","Traiguén","Victoria","Vilcún","Villarrica"],"Los Ríos":["Corral","Futrono","La Unión","Lago Ranco","Lanco","Los Lagos","Mariquina","Máfil","Paillaco","Panguipulli","Río Bueno","Valdivia"],"Los Lagos":["Ancud","Calbuco","Castro","Chaitén","Chonchi","Cochamó","Curaco de Vélez","Dalcahue","Fresia","Frutillar","Futaleufú","Hualaihué","Llanquihue","Los Muermos","Maullín","Osorno","Palena","Puerto Montt","Puerto Octay","Puerto Varas","Puqueldón","Purranque","Puyehue","Queilén","Quellón","Quemchi","Quinchao","Río Negro","San Juan de la Costa","San Pablo"],"Aysén del General Carlos Ibáñez del Campo":["Aysén","Chile Chico","Cisnes","Cochrane","Coyhaique","Guaitecas","Lago Verde","O’Higgins","Río Ibáñez","Tortel"],"Magallanes y de la Antártica Chilena":["Antártica","Cabo de Hornos","Laguna Blanca","Natales","Porvenir","Primavera","Punta Arenas","Río Verde","San Gregorio","Timaukel","Torres del Paine"],"Metropolitana de Santiago":["Alhué","Buin","Calera de Tango","Cerrillos","Cerro Navia","Colina","Conchalí","Curacaví","El Bosque","El Monte","Estación Central","Huechuraba","Independencia","Isla de Maipo","La Cisterna","La Florida","La Granja","La Pintana","La Reina","Lampa","Las Condes","Lo Barnechea","Lo Espejo","Lo Prado","Macul","Maipú","María Pinto","Melipilla","Padre Hurtado","Paine","Pedro Aguirre Cerda","Peñaflor","Peñalolén","Pirque","Providencia","Pudahuel","Puente Alto","Quilicura","Quinta Normal","Recoleta","Renca","San Bernardo","San Joaquín","San José de Maipo","San Miguel","San Pedro","San Ramón","Santiago","Talagante","Tiltil","Vitacura","Ñuñoa"]};
function brusaamUpdateCommuneOptions(){
 const region=$('region').value;
 const list=$('communeChoice'),current=list.value;
 const names=BRUSAAM_CHILE_COMUNAS[region]||[];
 list.replaceChildren(new Option(region?'Selecciona tu comuna':'Selecciona primero tu región',''));
 for(const name of names)list.add(new Option(name,name));
 list.add(new Option('Otra Comuna (envío por pagar)','__other__'));
 if(Array.from(list.options).some(option=>option.value===current))list.value=current;
}
function brusaamApplyCommuneSelection(){
 const choice=$('communeChoice').value,isOther=choice==='__other__';
 $('otherCommuneWrap').classList.toggle('hidden',!isOther);
 $('otherCommune').required=isOther&&$('mode').value!=='pickup';
 $('commune').value=isOther?$('otherCommune').value.trim():choice;
 $('communeSelectionHelp').textContent=isOther?'🚚 Otra Comuna: envío por pagar. Escribe el nombre obligatorio.':choice?'Comuna seleccionada: '+choice:'Selecciona una comuna de la lista.';
 refreshDeliverySector();
}
$('region').onchange=()=>{$('communeChoice').value='';$('otherCommune').value='';$('commune').value='';brusaamUpdateCommuneOptions();brusaamApplyCommuneSelection();};
$('communeChoice').onchange=brusaamApplyCommuneSelection;
$('otherCommune').oninput=brusaamApplyCommuneSelection;
brusaamUpdateCommuneOptions();
$('deliverySector').onchange = renderCart;
refreshDeliverySector();
$('address').oninput = renderCart;
$('useCustomerGps').onclick = () => {
 const status=$('gpsStatus');
 if(!navigator.geolocation){status.textContent='Tu navegador no permite obtener GPS. Escribe la dirección manualmente.';return;}
 status.textContent='Solicitando permiso de ubicación…';
 navigator.geolocation.getCurrentPosition(position=>{
  const lat=position.coords.latitude, lng=position.coords.longitude;
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
  const link='https://www.google.com/maps?q='+lat.toFixed(6)+','+lng.toFixed(6);
  $('customerMapsLink').value=link;
  status.textContent='Ubicación GPS recibida. El enlace se agregará al mensaje de WhatsApp cuando solicites el pedido. Completa o corrige la dirección, comuna y sector manualmente.';
  const gpsToast=$('gpsReceivedToast');
  gpsToast.classList.remove('hidden');
  clearTimeout(window.brusaamGpsToastTimer);
  window.brusaamGpsToastTimer=setTimeout(()=>gpsToast.classList.add('hidden'),5000);
 },error=>{status.textContent=error.code===1?'Permiso denegado. Puedes escribir tu dirección manualmente.':'No se pudo obtener la ubicación. Revisa el GPS o escribe tu dirección.';},{enableHighAccuracy:true,timeout:12000,maximumAge:0});
};
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

function brusaamOpenCart(){
 const dock=$('brusaamCartDock');
 dock.classList.add('brusaamCartOpen');dock.setAttribute('aria-hidden','false');
 $('brusaamCartShade').classList.remove('hidden');
 $('brusaamCartFloat').setAttribute('aria-expanded','true');
 document.body.classList.add('brusaamCartLocked');
 $('closeCartDrawer').focus();
}
function brusaamCloseCart(){
 $('brusaamCartDock').classList.remove('brusaamCartOpen');
 $('brusaamCartDock').setAttribute('aria-hidden','true');
 $('brusaamCartShade').classList.add('hidden');
 $('brusaamCartFloat').setAttribute('aria-expanded','false');
 document.body.classList.remove('brusaamCartLocked');
}
$('brusaamCartFloat').onclick=brusaamOpenCart;
$('closeCartDrawer').onclick=brusaamCloseCart;
$('brusaamCartShade').onclick=brusaamCloseCart;
document.addEventListener('keydown',event=>{if(event.key==='Escape')brusaamCloseCart();});
$('keepShopping').onclick = () => {
 $('customerPanel').classList.add('hidden');
 brusaamCloseCart();
 home();
};
$('goCheckout').onclick = () => {
 if (!Object.keys(cart).length) {
  alert('Agrega productos al carrito.');
  return;
 }

 brusaamCloseCart();
 $('customerPanel').classList.remove('brusaamOrderCompleted');$('brusaamCheckoutSuccess').classList.add('hidden');$('checkout').disabled=false;$('checkout').textContent='💜 Finalizar compra';$('checkout').style.background='';
 $('customerPanel').classList.remove('hidden');
 $('customerPanel').scrollIntoView({
  behavior: 'smooth'
 });
};

let brusaamDirectId=null;
let brusaamCheckoutDirect=false;
let brusaamSending=false;
$('brusaamDirectStart').onclick=()=>{
 if(!Object.keys(cart).length){alert('Agrega productos al carrito.');return;}
 if(!brusaamDirectId)brusaamDirectId=crypto.randomUUID();
 $('brusaamDirectCode').textContent='Se asignará al confirmar';
 $('brusaamDirectPanel').classList.remove('hidden');
};
$('brusaamDirectCopy').onclick=async()=>{const code=$('brusaamDirectCode').textContent;try{await navigator.clipboard.writeText(code);alert('N° de pedido copiado: '+code);}catch(e){prompt('Copia tu número de pedido:',code);}};
$('brusaamDirectConfirm').onclick=()=>{const phone=$('customerPhone').value.replace(/[^0-9]/g,'');if(phone.length<9||phone.length>12){alert('Ingresa un teléfono válido en Datos del Solicitante.');$('customerPhone').focus();return;}brusaamCheckoutDirect=true;$('checkout').click();brusaamCheckoutDirect=false;};
$('checkout').onclick = async () => {
 if(brusaamSending||!$('brusaamCheckoutSuccess').classList.contains('hidden'))return;
 $('brusaamDirectPanel').classList.add('hidden');
 const direct=true;
 if (!Object.keys(cart).length) {
  alert('Agrega productos al carrito.');
  return;
 }

 // Todos los pedidos nuevos se registran de forma independiente.
 brusaamOrderMode='normal';
 const customer = $('customer').value.trim();
 const customerPhone = $('customerPhone').value.replace(/[^0-9]/g,'');
 if(customerPhone.length<9||customerPhone.length>12){alert('Ingresa un teléfono de contacto válido en Datos del Solicitante.');$('customerPhone').focus();return;}

 if (!customer) {
  alert('Ingresa tu nombre y apellido.');
  return;
 }

 if (!$('mode').value) {
  alert('Selecciona retiro o entrega a domicilio.');
  return;
 }

 const paymentSelection = document.querySelector('input[name="paymentMethod"]:checked');
 if (!paymentSelection) {
  alert('Selecciona un método de pago.');
  document.querySelector('.paymentMethod').scrollIntoView({behavior:'smooth',block:'center'});
  return;
 }
 const paymentMethod = paymentSelection.value;

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

 if(!pickup && !$('panAzucarConfirm').checked && $('communeChoice').value==='__other__' && !$('otherCommune').value.trim()){alert('Escribe tu comuna para envío por pagar.');$('otherCommune').focus();return;}

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
 if(!pickup && shipping().type==='pending'){alert('Selecciona un sector de despacho válido antes de solicitar el pedido.');return;}
 const notes = $('orderNotes').value.trim();
 const pan = $('panAzucarConfirm').checked && !pickup;

 const message = [
  '🛍️ *BRUSAAM*',
  '✨ La excelencia en tu hogar ✨',
  '',
  '━━━━━━━━━━━━━━',
  '💜 *NUEVA SOLICITUD DE PEDIDO N°__BRUSAAM_PEDIDO_CODIGO__*',
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
  'Teléfono: ' + $('customerPhone').value.trim(),
  '',
  '💳 *MÉTODO DE PAGO*',
  paymentMethod,
  '',
  '📍 *DATOS DE ENTREGA*',
  '',
  'Modalidad: ' + (pickup ? 'Retiro en tienda' : 'Despacho a domicilio'),
  ...(!pickup ? [
   'Dirección: ' + address,
   ...($('deliverySector').value?['Sector: '+$('deliverySector').selectedOptions[0].textContent]:[]),
   ...(/^https:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps(?:[/?#]|$)|maps\.app\.goo\.gl\/)/i.test($('customerMapsLink').value.trim())?['📍 Google Maps: '+$('customerMapsLink').value.trim()]:[]),
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


 const button=$('checkout');
 button.disabled=true;brusaamSending=true;button.textContent='⏳ Enviando solicitud...';
 // Identificador estable para reintentos del mismo carrito: evita duplicar pedidos
 // cuando el servidor guarda la solicitud pero se pierde la respuesta de red.
 const checkoutFingerprint=JSON.stringify({
  items:Object.entries(cart).sort(),customer,paymentMethod,
  delivery:pickup?'pickup':'delivery',address,region,commune,
  sector:pickup?'':$('deliverySector').value,notes,phone:customerPhone
 });
 let retry=null;
 // Conservar el identificador incluso si se cierra la pestaña durante un corte de red.
 // Leer primero el respaldo persistente y, por compatibilidad, el de sesión anterior.
 try{retry=JSON.parse(localStorage.getItem('brusaam_checkout_retry')||sessionStorage.getItem('brusaam_checkout_retry')||'null');}catch(e){}
 const reservationId=retry&&retry.fingerprint===checkoutFingerprint&&/^[a-f0-9-]{36}$/i.test(retry.id)
  ?retry.id:crypto.randomUUID();
 try{localStorage.setItem('brusaam_checkout_retry',JSON.stringify({fingerprint:checkoutFingerprint,id:reservationId}));}catch(e){
  try{sessionStorage.setItem('brusaam_checkout_retry',JSON.stringify({fingerprint:checkoutFingerprint,id:reservationId}));}catch(_){}
 }
 try {
  const items=Object.entries(cart).map(([key,quantity])=>{
   const [id,kind]=key.split(':');
   return {id:Number(id),kind:kind==='pack'?'unidad':kind,quantity};
  });
  const result=await fetch('/api/orders/reserve',{
   method:'POST',headers:{'Content-Type':'application/json'},
   credentials:'same-origin',
   body:JSON.stringify({id:reservationId,items,customer,payment_method:paymentMethod,
    delivery_method:pickup?'pickup':'delivery',address,
    region,commune,delivery_sector:pickup?'':$('deliverySector').value,notes,order_mode:'normal',order_channel:'direct',contact_phone:customerPhone})
  });
  const saved=await result.json();
  if (!result.ok || !saved.ok || saved.id!==reservationId || !['pending','confirmed'].includes(saved.status)) throw Error(saved.error||'No se pudo verificar el registro del pedido.');
  if(!/^\d{5}[A-Z]?$/.test(String(saved.public_code||''))) throw Error('El servidor no confirmó un código de pedido válido. El carrito se conserva para verificar el registro.');
  {
   const code=String(saved.public_code);
   const finalMessage=message.replace('__BRUSAAM_PEDIDO_CODIGO__',code);
   $('brusaamSuccessOrderCode').textContent='Pedido N.º '+code;
   $('brusaamCheckoutSuccess').classList.remove('hidden');
   $('customerPanel').classList.add('brusaamOrderCompleted');
   $('brusaamSummaryResponse').textContent='';
   $('brusaamSummaryYes').disabled=false;$('brusaamSummaryNo').disabled=false;
   $('brusaamSummaryYes').onclick=()=>{
    // El pedido ya fue guardado: el cliente decide si envía o deja el texto como borrador.
    // Codificar UTF-8 de forma segura para conservar emojis en el enlace de WhatsApp.
    const whatsappText=finalMessage.normalize('NFC');
    const whatsappUrl='https://api.whatsapp.com/send?phone=56966282007&text='+encodeURIComponent(whatsappText);
    const popup=window.open(whatsappUrl,'_blank','noopener');
    $('brusaamCheckoutSuccess').classList.add('hidden');
    $('customerPanel').classList.remove('brusaamOrderCompleted');
    $('customerPanel').classList.add('hidden');
    $('checkout').disabled=false;
    $('checkout').textContent='💜 Finalizar compra';
    $('checkout').style.background='';
    home();
   };
   $('brusaamSummaryNo').onclick=()=>{$('customerPanel').classList.remove('brusaamOrderCompleted');$('brusaamCheckoutSuccess').classList.add('hidden');$('customerPanel').classList.add('hidden');$('checkout').disabled=false;$('checkout').textContent='💜 Finalizar compra';$('checkout').style.background='';home();};
   try{localStorage.setItem('brusaam_last_checkout',JSON.stringify({id:reservationId,code}));}catch(e){}
   try{localStorage.removeItem('brusaam_checkout_retry');sessionStorage.removeItem('brusaam_checkout_retry');}catch(e){}
   cart={};saveBrusaamCart();renderCart();
   $('brusaamCheckoutSuccess').scrollIntoView({behavior:'smooth',block:'center'});
   return;
  }

 } catch(error) {
  alert('❌ No se pudo confirmar la respuesta del servidor: '+error.message+' Tu carrito se conserva. Si hubo un problema de conexión, intenta nuevamente sin modificarlo para recuperar la misma solicitud.');
 } finally {brusaamSending=false;if($('brusaamCheckoutSuccess').classList.contains('hidden')){button.disabled=false;button.textContent='💜 Finalizar compra';}else{button.disabled=true;button.textContent='✓ Solicitud enviada';button.style.background='#8b8b8b';}}

};

async function loadShop() {
 // El carrito ya fue restaurado antes de iniciar la carga del catálogo.
 try {
  const response = await fetch('/api/shop');

  if (!response.ok) {
   throw Error('No se pudo cargar el catálogo');
  }

  store = await response.json();

  decorate(store);
  renderPublicShippingRates();
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
   'No fue posible cargar el catálogo. Revisa tu conexión e inténtalo nuevamente.';
  // El catálogo no está disponible: no ejecutar renderCart() ni alterar cantidades.
  // Informar al cliente que sus artículos siguen guardados localmente.
  const savedCount=Object.values(cart).reduce((sum,qty)=>sum+(Number(qty)||0),0);
  const badge=$('brusaamCartCount');
  if(badge)badge.textContent=String(savedCount);
  const cartRoot=$('cartItems');
  if(cartRoot){
   cartRoot.replaceChildren();
   const notice=node('p',savedCount
    ? '💜 Tus '+savedCount+' artículo(s) siguen guardados en este navegador. No pudimos cargar sus detalles por un problema de conexión. Vuelve a actualizar cuando tengas internet.'
    : 'No pudimos cargar el catálogo. Actualiza la página cuando tengas conexión.');
   notice.className='notice';
   cartRoot.append(notice);
  }
 }
}

restoreBrusaamCart();
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
  <button data-tab="products" class="active">🛍️ Catálogo visual</button>
  <button data-tab="orders" id="ordersTabButton">📦 Pedidos <span id="pendingOrdersBadge" class="pendingOrdersBadge hidden" aria-label="Pedidos pendientes">0</span></button>
  <button data-tab="sales">📊 Finanzas y ventas</button>
  <button data-tab="inventory">📦 Inventario y mermas</button>
  <button data-tab="packs">💜 Arma tu Pack</button>
  <button data-tab="sections">🏷️ Ofertas y Pack Ahorro</button>
  <button data-tab="categories">📁 Categorías</button>
  <button data-tab="subs">📂 Subcategorías</button>
  <button data-tab="shipping">🚚 Despachos y tarifas</button>
  <button data-tab="design">🎨 Diseño y logo</button>
 </div>

 <div id="tab-inventory" class="hidden">
  <section class="panel">
   <h3>📦 Inventario actualizado y control de mermas</h3>
   <p class="muted">Stock normal y stock recuperable separados. Actualiza para consultar los datos actuales. Los movimientos se conservan como historial.</p>
   <div class="flex"><button type="button" id="inventoryRefresh">↻ Actualizar inventario</button><button type="button" id="inventoryExport">⬇ Descargar inventario (Excel/CSV)</button><button type="button" id="inventoryMovementsExport">⬇ Descargar mermas (Excel/CSV)</button></div>
   <p id="inventoryMessage" role="status"></p><div id="inventorySummary"></div>
   <label>🔎 Buscar producto <input id="inventorySearch" type="search" placeholder="Nombre o categoría"></label>
   <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Producto</th><th>Normal</th><th>Recuperable</th><th>Total físico</th><th>Costo unitario</th><th>Valor disponible</th></tr></thead><tbody id="inventoryRows"></tbody></table></div>
  </section>
  <section class="panel">
   <h3>⚠️ Registrar merma</h3>
   <form id="inventoryWasteForm">
    <label>Producto<select id="inventoryProduct" required></select></label>
    <label>Tipo<select id="inventoryKind"><option value="loss">🔴 Merma definitiva</option><option value="recoverable">🟡 Merma recuperable (separar del stock normal)</option></select></label>
    <label>Cantidad<input id="inventoryQty" type="number" min="1" step="1" required value="1"></label>
    <label>Motivo<input id="inventoryReason" maxlength="120" required placeholder="Abollado, derramado, vencido..."></label>
    <label>Observaciones<input id="inventoryNotes" maxlength="500"></label>
    <button type="submit">Guardar movimiento</button>
   </form>
  </section>
  <section class="panel">
   <h3>🟡 Gestionar unidades recuperables</h3>
   <p class="muted">Para vender una unidad recuperable, primero devuélvela al stock normal y luego registra su venta con el precio real. No se descuenta dos veces.</p>
   <form id="inventoryRecoverForm">
    <label>Producto<select id="inventoryRecoverProduct" required></select></label>
    <label>Acción<select id="inventoryRecoverAction"><option value="restore">Devolver al stock normal para venta</option><option value="discard">Descartar como merma definitiva</option></select></label>
    <label>Cantidad<input id="inventoryRecoverQty" type="number" min="1" step="1" value="1" required></label>
    <label>Motivo<input id="inventoryRecoverReason" maxlength="120" required placeholder="Venta con descuento / no recuperable"></label>
    <button type="submit">Guardar movimiento</button>
   </form>
  </section>
  <section class="panel"><h3>🧾 Historial de mermas y movimientos</h3><div id="inventoryHistory" style="overflow-x:auto"></div></section>
 </div>
 <div id="tab-shipping" class="hidden">
  <section class="panel"><h3>🚚 Tarifas de despacho</h3>
   <p class="muted">Modifica tarifas por sector y monto mínimo para despacho gratis. Se aplican a pedidos nuevos, tanto en el carrito como en el servidor. Los pedidos anteriores conservan su tarifa registrada.</p>
   <form id="shippingSettingsForm"><label>Monto mínimo de productos para despacho gratis ($)<input id="shippingFreeThreshold" type="number" min="0" max="10000000" step="1" required></label>
    <div id="shippingRateFields"></div><button type="submit">Guardar tarifas de despacho</button>
   </form><h4>➕ Agregar sector de despacho</h4>
   <p class="muted">Los sectores desactivados dejan de aparecer en nuevos pedidos, pero se conservan en el historial.</p>
   <form id="customSectorForm"><label>Comuna<select id="customSectorCommune"><option value="la serena">La Serena</option><option value="coquimbo">Coquimbo</option></select></label>
   <label>Nombre del sector<input id="customSectorName" maxlength="90" required></label>
   <label>Tarifa ($)<input id="customSectorPrice" type="number" min="0" max="100000" step="1" required></label>
   <button type="submit">➕ Agregar sector de despacho</button></form>
   <div id="customSectorsList"></div><p id="shippingSettingsMessage" role="status"></p>
  </section>
 </div>
 <div id="tab-orders" class="hidden">
  <section class="panel">
   <h3>📦 Pedidos recibidos</h3>
   <p class="muted">El pedido se registra sin descontar stock. Confirma aquí los pedidos recibidos para descontar inventario y registrar la venta. Los pedidos pendientes no vencen automáticamente.</p>
   <div class="orderToolbar"><div id="ordersSummary" class="ordersSummary" role="status" aria-live="polite">Consultando pedidos...</div><button type="button" id="refreshOrders">↻ Actualizar pedidos</button></div>
   <style>.brusaamManagementGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:16px 0}.brusaamManagementButton{min-height:65px;padding:10px 8px!important;background:#f5f2f8!important;color:#49345c!important;border:1px solid #e4dce9!important;border-radius:12px!important;font-size:14px!important;white-space:normal!important}.brusaamManagementCount{display:inline-flex;align-items:center;justify-content:center;min-width:25px;height:25px;margin-left:7px;padding:0 6px;border-radius:999px;background:#6b24c8;color:#fff;font-size:12px;font-weight:800;vertical-align:middle}.brusaamManagementButton.active{background:#e8d8f5!important;border:2px solid #8e5caf!important;font-weight:800!important}@media(min-width:900px){.brusaamManagementGrid{grid-template-columns:repeat(3,minmax(0,1fr))}}</style>
   <div class="brusaamManagementGrid" role="group" aria-label="Gestión de pedidos">
    <button type="button" class="brusaamManagementButton active" data-management="pending">🆕 Nuevos</button>
    <button type="button" class="brusaamManagementButton" data-management="confirmed">💜 Confirmados</button>
    <button type="button" class="brusaamManagementButton" data-management="pickup">📦 Para Retiro</button>
    <button type="button" class="brusaamManagementButton" data-management="dispatched">🚚 Despachados</button>
    <button type="button" class="brusaamManagementButton" data-management="delivered">✅ Entregados</button>
    <button type="button" class="brusaamManagementButton" data-management="cancelled">❌ Rechazados / Cancelados</button>
   </div>
   <div class="brusaamOrderSearchBar">
    <label>🔎 Buscar pedido <input id="ordersSearch" type="search" placeholder="N° pedido, nombre o teléfono" autocomplete="off"></label>
    <label>Orden <select id="ordersSort"><option value="oldest">Más antiguo al más reciente</option><option value="newest">Más reciente al más antiguo</option></select></label>
    <label style="display:none">Estado <select id="ordersStatusFilter"><option value="pending">Pendientes</option><option value="all">Todos los estados</option><option value="confirmed">Confirmados</option><option value="pickup">Para retiro</option><option value="dispatched">Despachados</option><option value="delivered">Entregados</option><option value="cancelled">Cancelados / vencidos</option></select></label>
   </div>
   <div class="orderDateFilters">
    <label>📅 Desde <input type="date" id="ordersDateFrom" aria-label="Fecha inicial de pedidos"></label>
    <label>📅 Hasta <input type="date" id="ordersDateTo" aria-label="Fecha final de pedidos"></label>
    <button type="button" class="secondary" id="ordersClearDates">Limpiar fechas</button>
   </div>
   <p id="ordersMessage"></p>
   <div id="ordersList"></div>
  </section>
 </div>
 <div id="tab-sales" class="hidden">
  <section class="panel">
   <h3>📊 Informes de ventas BRUSAAM</h3>
   <p class="muted">Solo se contabilizan ventas confirmadas y ventas presenciales registradas. Los pedidos pendientes no son ventas. Horario de Chile.</p>
   <div class="flex">
    <label>Período <select id="salesPeriod"><option value="day">Diario</option><option value="week">Semanal</option><option value="month">Mensual</option><option value="custom">Rango personalizado</option></select></label>
    <label id="salesDateWrap">Fecha de referencia <input type="date" id="salesDate"></label>
    <label id="salesRangeWrap" class="hidden">Desde <input type="date" id="salesFrom"> Hasta <input type="date" id="salesTo"></label>
    <label id="salesMonthWrap" class="hidden">Mes <select id="salesMonth"></select></label>
    <label id="salesYearWrap" class="hidden">Año <select id="salesYear"></select></label>
    <button type="button" id="salesRefresh">Ver informe</button>
    <button type="button" id="salesExcel">Descargar Excel (.xlsx)</button>
    <button type="button" id="salesPDF">Guardar como PDF</button>
   </div>
   <p id="salesMessage"></p>
   <div id="salesReport"></div>
  </section>
  <section class="panel">
   <h3>➕ Registrar venta presencial</h3>
   <p class="muted">Registra los productos y su precio de venta real. El stock se descuenta al guardar. Para ventas sin productos identificados usa la opción de venta sin detalle.</p>
   <form id="manualSaleForm">
    <label>Cliente (opcional) <input id="manualCustomer" maxlength="160"></label>
    <label>Método de pago <select id="manualPayment" required><option>Efectivo</option><option>Transferencia</option><option>Tarjeta Débito/Crédito</option></select></label>
    <label>Producto <select id="manualProduct"><option value="">Venta sin detalle de productos</option></select></label>
    <label>Cantidad <input id="manualQuantity" type="number" min="1" step="1" value="1"></label>
    <label>Precio unitario cobrado ($) <input id="manualPrice" type="number" min="0" step="1" value="0"></label>
    <label>Total cobrado ($) <input id="manualTotal" type="number" min="0" step="1" value="0" required></label>
    <label>Observaciones <input id="manualNotes" maxlength="500"></label>
    <button type="submit">Registrar venta presencial</button>
   </form>
   <p id="manualSaleMessage"></p>
  </section>
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
   <hr><h3>➕ Agregar Pack — Shampoo + Acondicionador</h3>
   <p class="muted">Combina aromas distintos siempre que coincidan marca, formato y presentación. Para botella o doypack, el nombre de cada producto debe indicar esa presentación. Usa «Estándar» cuando el nombre no indica envase.</p>
   <form id="customPackForm">
    <input type="hidden" id="customPackId">
    <label>Nombre del pack<input id="customPackName" maxlength="90" required placeholder="Ej. Pack Sedal 340 ml"></label>
    <label>Marca<input id="customPackBrand" maxlength="55" required placeholder="Ej. Sedal"></label>
    <label>Formato<input id="customPackFormat" maxlength="30" required placeholder="Ej. 340ml"></label>
    <label>Presentación<select id="customPackPresentation" required><option value="estandar">Estándar (sin envase indicado)</option><option value="botella">Botella</option><option value="doypack">Doypack / Bolsa</option></select></label>
    <label>Precio total del pack ($)<input id="customPackPrice" type="number" min="1" max="1000000" step="1" required></label>
    <label><input id="customPackEnabled" type="checkbox" checked> Pack activo</label>
    <div class="flex"><button type="submit">Guardar pack</button><button type="button" class="secondary" id="customPackReset">Nuevo pack</button></div>
   </form>
   <p id="customPackMessage"></p>
   <div id="customPacksList"></div>
  </section>
 </div>

 <div id="tab-products">

  <section class="panel">
   <div class="flex"><h3 class="grow" id="productFormTitle">➕ Agregar producto</h3><button type="button" class="secondary" id="showProductForm">+ Nuevo producto</button><button type="button" class="secondary" id="hideProductForm">Ocultar formulario</button></div>

   <form id="productForm" class="hidden">
    <input type="hidden" id="pId">
    <div id="brusaamHistoryBox" class="hidden" style="padding:12px;border:1px solid #ddd;border-radius:12px;margin:10px 0">
      <button type="button" id="brusaamViewHistory" class="secondary">📊 Ver historial de precios y costos</button>
      <div id="brusaamHistoryResult" style="margin-top:10px;max-height:280px;overflow:auto"></div>
    </div>

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
     <input id="pPackEligible" type="checkbox">
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

    <details id="financeDetails" style="border:1px solid #ddd5f2;border-radius:12px;padding:14px;margin:14px 0;background:#faf7ff">
     <summary style="cursor:pointer;font-weight:800;color:#6725C7">💜 Finanzas del producto (privado)</summary>
     <p class="muted">Ingresa el costo de compra con IVA incluido. El IVA se desglosa, no se suma otra vez. Cálculo comercial estimado: considera IVA de compra como costo; no reemplaza la utilidad tributaria.</p>
     <label>Costo de compra con IVA incluido ($)
      <input id="pCostVat" type="number" min="0" step="1" value="0" required>
     </label>
     <label>Gastos operacionales (%)
      <input id="pOperating" type="number" min="0" max="100" step="0.01" value="20" required>
     </label>
     <div id="financePreview" class="notice" aria-live="polite"></div>
    </details>

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
    <label class="checkLabel"><input id="pNewImage" type="checkbox"> Nueva Imagen (etiqueta azul en fotografía)</label>

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
   <h3>🛍️ Catálogo visual de productos</h3>
   <p class="muted">Busca, filtra y edita precios y stock directamente desde las fichas. Edición completa incluye fotografías, descripciones, secciones y finanzas.</p>
   <div class="catalogTools">
    <input type="search" id="adminProductSearch" placeholder="🔎 Buscar nombre, marca o código" aria-label="Buscar productos">
    <select id="adminProductCategory" aria-label="Filtrar categoría"><option value="">Todas las categorías</option></select>
    <select id="adminProductSub" aria-label="Filtrar subcategoría"><option value="">Todas las subcategorías</option></select>
    <select id="adminProductStatus" aria-label="Filtrar estado"><option value="">Todos los estados</option><option value="1">Habilitados</option><option value="0">Deshabilitados</option></select>
   </div>
   <p id="adminProductCount" class="muted"></p>
   <div id="productList" class="adminProductGrid"></div>
  </section>
 </div>

 <div id="tab-sections" class="hidden">
  <section class="panel">
   <h3>Carruseles automáticos de secciones</h3>
   <p class="notice">Las fotografías de portada ya no son necesarias: cada tarjeta muestra las fotos de sus productos. Los más destacados, Ofertas y Nuevos ingresos se asignan desde Productos; Pack Ahorro y Box Pyme se crean de manera independiente aquí.</p>
   <div id="sectionList"></div>
  </section>
  <section class="panel">
   <h3>Crear o editar promoción / pack compuesto</h3>
   <p class="notice">Crea promociones en Pack Ahorro, Ofertas y Box Pyme. Opcionalmente selecciona los productos del inventario que componen cada pack.</p>
   <form id="specialForm">
    <input type="hidden" id="specialId">
    <label>Sección especial <select id="specialSection" required></select></label>
    <label>Nombre del producto <input id="specialName" maxlength="160" required></label>
    <label>Descripción <textarea id="specialDescription" maxlength="1000"></textarea></label>
    <label>Precio único (CLP) <input id="specialPrice" type="number" min="0" required></label>
    <label>Stock máximo del pack (límite opcional, el stock real dependerá de los componentes) <input id="specialStock" type="number" min="0" required></label>
    <fieldset class="bundleEditor"><legend>📦 Composición interna del pack (opcional)</legend>
     <p class="muted">Selecciona productos existentes y cuántas unidades se descuentan por cada pack. Deja vacío para mantenerlo como producto normal.</p>
     <div id="specialComponents"></div><button type="button" class="secondary" id="addSpecialComponent">+ Añadir componente</button>
    </fieldset>
    <label>Fotografía <input id="specialFile" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <button type="button" id="uploadSpecial">Subir fotografía</button>
    <label>URL de fotografía <input id="specialImage" type="url"></label>
    <button type="submit">Guardar promoción</button>
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
// Formato monetario disponible en todo el panel administrativo.
const money = value => '$' + Math.round(Number(value) || 0).toLocaleString('es-CL');

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

function renderShippingSettings(){
 const cfg=data.shippingSettings||{freeThreshold:30000,rates:{serena_general:2000,companias:2500,caleta:2500,coquimbo_general:1500,panul:2000,pan_azucar:0,cruz_cana:1500}};
 $('shippingFreeThreshold').value=cfg.freeThreshold;
 const labels={serena_general:'La Serena – sector general',companias:'Las Compañías',caleta:'Caleta San Pedro / Islón / Lambert / Romeral',coquimbo_general:'Coquimbo – sector general',panul:'El Panul / La Rinconada',pan_azucar:'Pan de Azúcar',cruz_cana:'Cruz de Caña'};
 const root=$('shippingRateFields');root.replaceChildren();
 for(const [key,label] of Object.entries(labels)){
  const field=document.createElement('label');field.textContent=label+' ($)';
  const input=document.createElement('input');input.type='number';input.min='0';input.max='100000';input.step='1';input.required=true;input.dataset.shippingRate=key;input.value=cfg.rates[key];field.append(input);root.append(field);
 }
 const customRoot=$('customSectorsList');customRoot.replaceChildren();
 for(const sector of cfg.customSectors||[]){
  const row=document.createElement('div');row.style.cssText='padding:10px;margin:8px 0;border:1px solid #e3d5eb;border-radius:10px';
  const title=document.createElement('strong');title.textContent=sector.name+' · '+sector.commune;
  const price=document.createElement('input');price.type='number';price.min='0';price.max='100000';price.value=sector.price;
  const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=sector.enabled;
  const label=document.createElement('label');label.textContent='Activo ';label.append(enabled);
  const save=document.createElement('button');save.type='button';save.textContent='Guardar sector';
  save.onclick=async()=>{save.disabled=true;try{const payload={...sector,price:Number(price.value),enabled:enabled.checked};const result=await api('/api/admin/shipping-sector','PUT',payload);data.shippingSettings=result.shippingSettings;renderShippingSettings();$('shippingSettingsMessage').textContent='✓ Sector actualizado.';}catch(e){alert(e.message);save.disabled=false;}};
  row.append(title,price,label,save);customRoot.append(row);
 }
}
$('shippingSettingsForm').onsubmit=async e=>{
 e.preventDefault();const msg=$('shippingSettingsMessage');msg.textContent='Guardando...';
 try{
  const rates={};for(const el of document.querySelectorAll('[data-shipping-rate]'))rates[el.dataset.shippingRate]=Number(el.value);
  const payload={freeThreshold:Number($('shippingFreeThreshold').value),rates,customSectors:(data.shippingSettings||{}).customSectors||[]};
  const result=await api('/api/admin/shipping-settings','PUT',payload);
  data.shippingSettings=result.shippingSettings;renderShippingSettings();msg.textContent='✓ Tarifas guardadas. Los nuevos pedidos utilizarán estos valores.';
 }catch(err){msg.textContent='Error: '+err.message;}
};

$('customSectorForm').onsubmit=async e=>{
 e.preventDefault();const name=$('customSectorName').value.trim(),price=Number($('customSectorPrice').value),commune=$('customSectorCommune').value;
 try{const result=await api('/api/admin/shipping-sector','POST',{name,price,commune});data.shippingSettings=result.shippingSettings;renderShippingSettings();$('customSectorForm').reset();$('shippingSettingsMessage').textContent='✓ Nuevo sector agregado.';}catch(err){$('shippingSettingsMessage').textContent='Error: '+err.message;}
};
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
  'orders',
  'sales',
  'inventory',
  'packs',
  'sections',
  'categories',
  'subs',
  'shipping',
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
  button.onclick = () => {
   openTab(button.dataset.tab);
   if(button.dataset.tab==='inventory')loadInventory();
  };
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

function bundleOptions(selected){
 return (data.products||[]).filter(p=>Number(p.special_only)!==1&&!(p.components||[]).length).map(p=>({id:Number(p.id),name:p.name})).filter(p=>String(p.id)!==String(selected));
}
function addBundleEditorRow(containerId,selectedId='',qty=1){
 const root=$(containerId),row=document.createElement('div');row.className='bundleComponentRow';
 const current=containerId==='specialComponents'?$('specialId').value:$('pId').value;
 const choices=bundleOptions(current);
 const picker=document.createElement('div');picker.className='bundlePartPicker';
 const search=document.createElement('input');search.type='search';search.className='bundlePartSearch';
 search.placeholder='Escribe nombre o código del producto';search.autocomplete='off';
 search.setAttribute('aria-label','Buscar componente del pack');
 const hidden=document.createElement('input');hidden.type='hidden';hidden.className='bundlePartId';
 const list=document.createElement('div');list.className='bundleSuggestions';list.hidden=true;
 function choose(p){hidden.value=String(p.id);search.value=p.name+' (#'+p.id+')';list.hidden=true;list.replaceChildren();search.setCustomValidity('');}
 function results(){
  const query=search.value.trim().toLocaleLowerCase('es');
  list.replaceChildren();hidden.value='';
  if(!query){list.hidden=true;return;}
  const matches=choices.filter(p=>(p.name+' '+p.id).toLocaleLowerCase('es').includes(query)).slice(0,12);
  for(const p of matches){const option=document.createElement('button');option.type='button';option.className='bundleSuggestion';option.textContent=p.name+' (#'+p.id+')';option.addEventListener('pointerdown',e=>e.preventDefault());option.onclick=()=>choose(p);list.append(option);}
  list.hidden=!matches.length;
 }
 search.addEventListener('input',results);
 search.addEventListener('focus',()=>{if(!hidden.value&&search.value.trim())results();});
 search.addEventListener('keydown',e=>{if(e.key==='Escape')list.hidden=true;else if(e.key==='Enter'&&!list.hidden){const first=list.querySelector('button');if(first){e.preventDefault();first.click();}}});
 search.addEventListener('blur',()=>{setTimeout(()=>{list.hidden=true;},150);});
 if(selectedId){const existing=choices.find(p=>String(p.id)===String(selectedId));if(existing)choose(existing);}
 const input=document.createElement('input');input.type='number';input.min='1';input.max='10000';input.value=String(qty);input.className='bundlePartQty';input.title='Cantidad por pack';
 const remove=document.createElement('button');remove.type='button';remove.className='danger small';remove.textContent='Quitar';remove.onclick=()=>{row.remove();recalculate();};
 picker.append(search,hidden,list);row.append(picker,input,remove);root.append(row);
}
function readBundleEditor(containerId){return [...$(containerId).querySelectorAll('.bundleComponentRow')].map(row=>{
 const id=Number(row.querySelector('.bundlePartId').value);
 const search=row.querySelector('.bundlePartSearch');
 if(!id){search.setCustomValidity('Selecciona un producto de las sugerencias.');search.reportValidity();throw Error('Selecciona un producto válido de la lista de sugerencias.');}
 return {id,quantity:Number(row.querySelector('.bundlePartQty').value)};
});}
function fillBundleEditor(containerId,product){$(containerId).replaceChildren();for(const p of product?.components||[])addBundleEditorRow(containerId,p.id,p.quantity);}
$('addSpecialComponent').onclick=()=>addBundleEditorRow('specialComponents');

function clearProduct() {
 $('productForm').reset();

 $('pId').value = '';
 $('brusaamHistoryBox').classList.add('hidden');
 $('brusaamHistoryResult').replaceChildren();
 $('pImage').value = '';
 $('pMin').value = '2';
 $('pMangaPrice').value = '0';
 $('pOfferPrice').value = '0';
 $('pOfferMangaPrice').value = '0';
 $('pSpecialOnly').value = '0';
 $('pPacksPerManga').value = '0';
 $('pActive').checked = true;
 $('pNewImage').checked = false;
 $('pPackEligible').checked = false;

 $('pCostVat').value = '0';
 $('pOperating').value = '20';
 updateFinancePreview();


 fillProductSubs();
}

$('clearProduct').onclick = clearProduct;

function fillProductForm(product) {
 $('productForm').classList.remove('hidden');
 $('productFormTitle').textContent='✏️ Edición completa: '+product.name;
 $('pId').value=product.id;
 $('brusaamHistoryBox').classList.remove('hidden');
 $('brusaamHistoryResult').replaceChildren();
 $('pName').value=product.name||'';
 $('pDescription').value=product.description||'';
 $('pRetail').value=product.retail;
 $('pWholesale').value=product.wholesale;
 $('pCostVat').value=product.cost_with_vat||0;
 $('pOperating').value=product.operating_percent??20;
 $('pOfferPrice').value=product.offer_price||0;
 $('pOfferMangaPrice').value=product.offer_manga_price||0;
 $('pSpecialOnly').value=product.special_only||0;
 $('pMin').value=product.min_qty||2;
 $('pStock').value=product.stock;
 $('pImage').value=product.image||'';
 if (![...$('pCategory').options].some(o=>o.value===product.category)) $('pCategory').add(new Option(product.category,product.category));
 $('pCategory').value=product.category;
 fillProductSubs(product.subcategory||'');
 $('pMangaPrice').value=product.manga_price||0;
 $('pPacksPerManga').value=product.packs_per_manga||0;
 $('pFeatured').checked=!!product.destacados;
 $('pOffers').checked=!!product.ofertas;
 $('pNew').checked=!!product.nuevos_ingresos;
 $('pNewImage').checked=Number(product.new_image)===1;
 $('pActive').checked=!!product.active;
 $('pPackEligible').checked=Number(product.pack_eligible)!==0;
 updateFinancePreview();
 openTab('products');
 $('productFormTitle').scrollIntoView({behavior:'smooth',block:'start'});
}
$('brusaamViewHistory').onclick=async()=>{
 const id=Number($('pId').value),root=$('brusaamHistoryResult');root.replaceChildren();
 if(!id)return;
 try{
  const result=await api('/api/admin/products/'+id+'/history');
  if(!result.history.length){root.textContent='Todavía no hay cambios registrados desde esta actualización.';return;}
  const names={retail:'Precio detalle',wholesale:'Precio mayorista',cost_with_vat:'Costo de compra',offer_price:'Precio oferta',offer_manga_price:'Oferta manga',manga_price:'Precio manga',operating_percent:'Gastos operativos (%)'};
  const table=document.createElement('table');table.style.width='100%';
  const head=document.createElement('tr');for(const t of ['Fecha','Campo','Anterior','Nuevo']){const th=document.createElement('th');th.textContent=t;head.append(th);}table.append(head);
  for(const row of result.history){const tr=document.createElement('tr');for(const val of [new Date(row.changed_at).toLocaleString('es-CL',{timeZone:'America/Santiago'}),names[row.field]||row.field,row.field==='operating_percent'?row.old_value+'%':salesMoney(row.old_value),row.field==='operating_percent'?row.new_value+'%':salesMoney(row.new_value)]){const td=document.createElement('td');td.textContent=val;tr.append(td);}table.append(tr);}root.append(table);
 }catch(e){root.textContent=e.message;}
};
$('showProductForm').onclick=()=>{clearProduct();$('productFormTitle').textContent='➕ Agregar producto';$('productForm').classList.remove('hidden');$('productFormTitle').scrollIntoView({behavior:'smooth',block:'start'});};
$('hideProductForm').onclick=()=>{$('productForm').classList.add('hidden');};
for(const id of ['adminProductSearch','adminProductCategory','adminProductSub','adminProductStatus']) $(id).addEventListener(id==='adminProductSearch'?'input':'change',()=>{
 if(id==='adminProductCategory')updateAdminSubFilter();
 renderProducts();
});
function updateAdminSubFilter(){
 const category=$('adminProductCategory').value,previous=$('adminProductSub').value;
 const sel=$('adminProductSub');sel.replaceChildren(new Option('Todas las subcategorías',''));
 const names=[...new Set(data.products.filter(p=>!category||p.category===category).map(p=>p.subcategory).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
 for(const name of names)sel.add(new Option(name,name));
 sel.value=names.includes(previous)?previous:'';
}
function renderProducts() {
 const root=$('productList');root.replaceChildren();
 const cat=$('adminProductCategory'),previous=cat.value;
 const categories=[...new Set(data.products.map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
 cat.replaceChildren(new Option('Todas las categorías',''));
 for(const name of categories)cat.add(new Option(name,name));
 cat.value=categories.includes(previous)?previous:'';
 updateAdminSubFilter();
 const q=$('adminProductSearch').value.trim().toLocaleLowerCase('es');
 const status=$('adminProductStatus').value;
 const visible=data.products.filter(p=>Number(p.special_only)!==1||(Number(p.pack_ahorro)!==1&&Number(p.box_pyme)!==1)).filter(p=>(!q||(p.name+' '+p.id+' '+(p.description||'')).toLocaleLowerCase('es').includes(q))&&(!cat.value||p.category===cat.value)&&(!$('adminProductSub').value||p.subcategory===$('adminProductSub').value)&&(!status||String(Number(p.active))===status));
 $('adminProductCount').textContent=visible.length+' producto(s) encontrados';
 for(const product of visible){
  const card=document.createElement('article');card.className='adminProductCard';
  if(product.image){const img=document.createElement('img');img.src=product.image;img.alt=product.name;img.loading='lazy';img.decoding='async';card.append(img);}else{const placeholder=document.createElement('div');placeholder.style.cssText='height:140px;display:grid;place-items:center;background:#f8f7fb;border-radius:9px';placeholder.textContent='📷 Sin fotografía';card.append(placeholder);}
  const title=document.createElement('div');title.className='cardName';title.textContent=product.name;card.append(title);
  const sub=document.createElement('div');sub.className='cardStatus';sub.textContent=[product.category,product.subcategory].filter(Boolean).join(' · ');card.append(sub);
  const fields=document.createElement('div');fields.className='cardFields';
  function numberField(label,value){const wrap=document.createElement('label');wrap.textContent=label;const input=document.createElement('input');input.type='number';input.min='0';input.step='1';input.value=String(value||0);wrap.append(input);fields.append(wrap);return input;}
  const retail=numberField('Detalle ($)',product.retail),wholesale=numberField('Mayor ($)',product.wholesale),stock=numberField('Stock',product.stock);
  card.append(fields);
  const statusText=document.createElement('div');statusText.className='cardStatus';statusText.textContent=product.active?'🟢 Habilitado':'⚪ Deshabilitado';card.append(statusText);
  const actions=document.createElement('div');actions.className='cardActions';
  const save=document.createElement('button');save.textContent='💾 Guardar';save.onclick=async()=>{
   const a=Number(retail.value),b=Number(wholesale.value),c=Number(stock.value);
   if(![a,b,c].every(x=>Number.isSafeInteger(x)&&x>=0)){alert('Precios y stock deben ser números enteros positivos o cero.');return;}
   save.disabled=true;save.textContent='Guardando...';
   try{await api('/api/admin/products/'+product.id,'PUT',{...product,retail:a,wholesale:b,stock:c,cost_with_vat:product.cost_with_vat||0,operating_percent:product.operating_percent??20,components:undefined});
    product.retail=a;product.wholesale=b;product.stock=c;save.textContent='✓ Guardado';setTimeout(()=>{save.textContent='💾 Guardar';save.disabled=false;},1500);
   }catch(e){save.disabled=false;save.textContent='💾 Guardar';alert(e.message);}
  };
  const edit=document.createElement('button');edit.className='secondary';edit.textContent='✏️ Completa';edit.onclick=()=>fillProductForm(product);
  const toggle=document.createElement('button');toggle.className='secondary';toggle.textContent=product.active?'Deshabilitar':'Habilitar';toggle.onclick=async()=>{
   if(!confirm((product.active?'¿Deshabilitar ':'¿Habilitar ')+product.name+'?'))return;
   toggle.disabled=true;
   try{await api('/api/admin/products/'+product.id,'PUT',{...product,active:!product.active,cost_with_vat:product.cost_with_vat||0,operating_percent:product.operating_percent??20,components:undefined});await refresh();}catch(e){alert(e.message);toggle.disabled=false;}
  };
  actions.append(save,edit,toggle);card.append(actions);root.append(card);
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

function updateFinancePreview(){
 const cost=Math.max(0,Number($('pCostVat').value)||0);
 const pct=Math.max(0,Number($('pOperating').value)||0);
 const full=cost*(1+pct/100);
 const money=n=>'$'+Math.round(n).toLocaleString('es-CL');
 $('financePreview').textContent='Costo neto: '+money(cost/1.19)+' | IVA incluido: '+money(cost-cost/1.19)+' | Gastos: '+money(cost*pct/100)+' | Costo total estimado: '+money(full)+' | Ganancia detalle: '+money((Number($('pRetail').value)||0)-full)+' | Ganancia mayor: '+money((Number($('pWholesale').value)||0)-full);
}
for(const id of ['pCostVat','pOperating','pRetail','pWholesale'])$(id).addEventListener('input',updateFinancePreview);
updateFinancePreview();

$('productForm').onsubmit = async event => {
 event.preventDefault();

 const id = $('pId').value;

 const paper =
  $('pCategory').value === 'Papelería';

 const product = {
  name: $('pName').value.trim(),
  pack_eligible: $('pPackEligible').checked,
  wholesale_group: data.products.find(x=>String(x.id)===id)?.wholesale_group || '',
  category: $('pCategory').value,
  subcategory: $('pSub').value,
  description: $('pDescription').value,
  retail: Number($('pRetail').value),
  wholesale: Number($('pWholesale').value),
  cost_with_vat: Number($('pCostVat').value),
  operating_percent: Number($('pOperating').value),
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
  new_image: $('pNewImage').checked,
  active: $('pActive').checked
 };

 try {
  const result=await api(
   '/api/admin/products' +
    (id ? '/' + id : ''),
   id ? 'PUT' : 'POST',
   product
  );

  const editedId=id || String(result.id || '');
  await refresh();
  if (editedId) {
   const updated=data.products.find(x=>String(x.id)===String(editedId));
   if (updated) fillProductForm(updated);
  }
  message('productMessage','Producto guardado correctamente. Puedes seguir editando aquí.');
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
 fillBundleEditor('specialComponents',null);
};
$('specialForm').onsubmit = async event => {
 event.preventDefault();
 const slug = $('specialSection').value;
 if (!['pack_ahorro','box_pyme','ofertas'].includes(slug)) {message('specialMessage','Selecciona Pack Ahorro, Ofertas o Box Pyme.');return;}
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
  const saved=await api('/api/admin/products'+(id?'/'+id:''),id?'PUT':'POST',product);
  await api('/api/admin/bundles/'+(id||saved.id),'PUT',{components:readBundleEditor('specialComponents')});
  $('clearSpecial').click();
  message('specialMessage','Promoción y componentes guardados correctamente.');
  await refresh();
 } catch(error) { message('specialMessage',error.message); }
};

function renderSections() {
 const sectionSelect = $('specialSection');
 sectionSelect.replaceChildren();
 for (const section of data.sections.filter(x=>['pack_ahorro','box_pyme','ofertas'].includes(x.slug)))
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
  Number(p.special_only) === 1 && (Number(p.pack_ahorro)===1 || Number(p.box_pyme)===1 || Number(p.ofertas)===1))) {
  const edit = () => {
   $('specialId').value = product.id;
   $('specialSection').value = Number(product.pack_ahorro)===1 ? 'pack_ahorro':Number(product.box_pyme)===1?'box_pyme':'ofertas';
   $('specialName').value = product.name || '';
   $('specialDescription').value = product.description || '';
   $('specialPrice').value = product.retail;
   $('specialStock').value = product.stock;
   $('specialImage').value = product.image || '';
   fillBundleEditor('specialComponents',product);
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
  const img=document.createElement('img');img.src=url;img.alt='Publicidad '+(i+1);img.loading='lazy';img.decoding='async';
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


function resetCustomPackForm(){
 $('customPackForm').reset();$('customPackId').value='';$('customPackEnabled').checked=true;
}
$('customPackReset').onclick=resetCustomPackForm;
function renderCustomPacks(){
 const root=$('customPacksList');root.replaceChildren();
 for(const cfg of (data.customPacks||[])){
  const row=document.createElement('div');row.className='panel';row.style.marginTop='10px';
  const title=document.createElement('strong');title.textContent=cfg.name+' — '+cfg.brand+' · '+cfg.format+' · '+cfg.presentation+' · '+money(cfg.price)+(cfg.enabled?' · Activo':' · Desactivado');
  const controls=document.createElement('div');controls.className='flex';
  const edit=document.createElement('button');edit.type='button';edit.className='small secondary';edit.textContent='Editar';
  edit.onclick=()=>{$('customPackId').value=cfg.id;$('customPackName').value=cfg.name;$('customPackBrand').value=cfg.brand;$('customPackFormat').value=cfg.format;$('customPackPresentation').value=cfg.presentation;$('customPackPrice').value=cfg.price;$('customPackEnabled').checked=cfg.enabled;$('customPackName').focus();};
  const toggle=document.createElement('button');toggle.type='button';toggle.className='small secondary';toggle.textContent=cfg.enabled?'Desactivar':'Activar';
  toggle.onclick=async()=>{try{await saveCustomPacks((data.customPacks||[]).map(x=>x.id===cfg.id?{...x,enabled:!x.enabled}:x));message('customPackMessage','Estado actualizado.');}catch(e){message('customPackMessage',e.message);}};
  const del=document.createElement('button');del.type='button';del.className='small danger';del.textContent='Eliminar';
  del.onclick=async()=>{if(!confirm('¿Eliminar este pack?'))return;try{await saveCustomPacks((data.customPacks||[]).filter(x=>x.id!==cfg.id));resetCustomPackForm();message('customPackMessage','Pack eliminado.');}catch(e){message('customPackMessage',e.message);}};
  controls.append(edit,toggle,del);row.append(title,controls);root.append(row);
 }
}
async function saveCustomPacks(packs){await api('/api/admin/custom-packs','PUT',{packs});await refresh();}
$('customPackForm').onsubmit=async event=>{
 event.preventDefault();
 const id=$('customPackId').value||('custom_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8));
 const cfg={id,name:$('customPackName').value.trim(),brand:$('customPackBrand').value.trim(),format:$('customPackFormat').value.trim(),presentation:$('customPackPresentation').value,price:Number($('customPackPrice').value),enabled:$('customPackEnabled').checked};
 const packs=(data.customPacks||[]).filter(x=>x.id!==id).concat(cfg);
 try{await saveCustomPacks(packs);resetCustomPackForm();message('customPackMessage','Pack guardado correctamente.');}
 catch(e){message('customPackMessage',e.message);}
};

let lastSalesReport=null;
function salesMoney(value){return '$'+Number(value||0).toLocaleString('es-CL');}
function chileDateValue(date=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const get=k=>parts.find(p=>p.type===k)?.value;
 return get('year')+'-'+get('month')+'-'+get('day');
}
function populateManualProducts() {
 const select=$('manualProduct');
 const old=select.value;select.replaceChildren(new Option('Venta sin detalle de productos',''));
 for(const p of data.products||[]) select.add(new Option(p.name+' · Stock: '+p.stock,p.id));
 select.value=old;
}
function renderSalesTable(rows,headers) {
 const table=document.createElement('table');table.style.width='100%';
 const head=document.createElement('tr');for(const h of headers){const th=document.createElement('th');th.textContent=h;head.append(th);}table.append(head);
 for(const cells of rows){const tr=document.createElement('tr');for(const cell of cells){const td=document.createElement('td');td.textContent=String(cell);tr.append(td);}table.append(tr);}return table;
}
async function renderSales() {
 const root=$('salesReport');root.replaceChildren();
 try {
  const period=$('salesPeriod').value,date=period==='month'?($('salesYear').value+'-'+$('salesMonth').value+'-01'):($('salesDate').value||chileDateValue());
  const extra=period==='custom'?'&from='+encodeURIComponent($('salesFrom').value)+'&to='+encodeURIComponent($('salesTo').value):'';
  const result=await api('/api/admin/sales/report?period='+encodeURIComponent(period)+'&date='+encodeURIComponent(date)+extra);
  lastSalesReport=result;
  const heading=document.createElement('h4');heading.textContent='Ventas '+result.from+' a '+result.to;root.append(heading);
  const p=document.createElement('p');p.textContent='Total vendido: '+salesMoney(result.total)+' · Ventas: '+result.count+' · Productos: '+result.units+' · Ticket promedio: '+salesMoney(result.average);root.append(p);
  const f=result.finance;
  const financeHeading=document.createElement('h4');financeHeading.textContent='💙 Resumen de Rentabilidad';root.append(financeHeading);
  const financeCards=document.createElement('div');financeCards.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:12px 0 16px';
  const financeItems=[
   ['Ventas cobradas',salesMoney(result.total)],
   ['Ingreso por productos',f.product_revenue===null?'No determinado':salesMoney(f.product_revenue)],
   ['Despachos cobrados',salesMoney(f.shipping_collected)],
   ['Costo conocido',salesMoney(f.cost)],
   ['Gastos operacionales estimados',salesMoney(f.expenses)],
   ['Ganancia estimada',f.profit===null?'Pendiente de datos':salesMoney(f.profit)],
   ['Margen de ganancia',f.margin===null?'No disponible':f.margin+'%']
  ];
  for(const [label,value] of financeItems){
   const card=document.createElement('div');card.style.cssText='border:1px solid #c9dff4;border-radius:12px;background:#f3f9ff;padding:15px;min-width:0';
   const caption=document.createElement('div');caption.textContent=label;caption.style.cssText='font-size:13px;color:#315c87;font-weight:600';
   const number=document.createElement('div');number.textContent=value;number.style.cssText='font-size:clamp(19px,3vw,28px);font-weight:800;color:#205d99;overflow-wrap:anywhere;margin-top:6px';
   card.append(caption,number);financeCards.append(card);
  }
  root.append(financeCards);
  const financeNote=document.createElement('p');financeNote.className='muted';financeNote.textContent=(f.missing_cost_lines?'Faltan costos históricos en '+f.missing_cost_lines+' líneas de venta. ':'')+(f.shipping_unknown?'Faltan datos de despacho en '+f.shipping_unknown+' pedidos. ':'')+(f.unknown_revenue_lines?'Hay '+f.unknown_revenue_lines+' productos sin importe individual desglosado. ':'')+'Los costos y gastos se congelan al confirmar ventas nuevas. El costo real de reparto, comisiones, impuestos y otros gastos no registrados no están descontados. Las ventas anteriores no se recalculan con costos actuales.';root.append(financeNote);
  const byPayment={};const bySource={};for(const x of result.sales){byPayment[x.payment_method]=(byPayment[x.payment_method]||0)+x.total;bySource[x.source]=(bySource[x.source]||0)+x.total;}
  const payHeading=document.createElement('h4');payHeading.textContent='💜 Resumen por método de pago';root.append(payHeading);
  const paymentCards=document.createElement('div');paymentCards.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:12px 0 20px';
  const paymentGroups={Efectivo:0,Transferencia:0,Tarjeta:0,Otros:0};
  for(const [method,amount] of Object.entries(byPayment)){
   const key=/efectivo/i.test(method)?'Efectivo':/transfer/i.test(method)?'Transferencia':/tarjeta|d[eé]bito|cr[eé]dito/i.test(method)?'Tarjeta':'Otros';paymentGroups[key]+=amount;
  }
  for(const [label,amount] of [...Object.entries(paymentGroups).filter(([key,value])=>key!=='Otros'||value!==0),['Total cobrado',result.total]]){
   const card=document.createElement('div');card.style.cssText='border:1px solid #e5d8ee;border-radius:12px;background:#fbf8fd;padding:15px;min-width:0';
   const caption=document.createElement('div');caption.textContent=label;caption.style.cssText='font-size:13px;color:#654978;font-weight:600';
   const number=document.createElement('div');number.textContent=salesMoney(amount);number.style.cssText='font-size:clamp(22px,4vw,30px);font-weight:800;color:#492065;overflow-wrap:anywhere;margin-top:6px';card.append(caption,number);paymentCards.append(card);
  }
  root.append(paymentCards);
  const summary=document.createElement('p');summary.textContent='Por canal: '+Object.entries(bySource).map(([k,v])=>k+' '+salesMoney(v)).join(' · ');root.append(summary);
  const rows=result.sales.map(x=>[new Date(x.created_at).toLocaleString('es-CL',{timeZone:'America/Santiago'}),x.source,x.customer||'—',x.payment_method,salesMoney(x.total),x.id.slice(0,8)]);
  root.append(renderSalesTable(rows,['Fecha','Origen','Cliente','Pago','Total','ID']));
  const h=document.createElement('h4');h.textContent='Productos vendidos';root.append(h);
  root.append(renderSalesTable(result.products.map(x=>[x.product_name,x.quantity,x.amount===null?'No desglosado':salesMoney(x.amount),x.cost===null?'Sin costo histórico':salesMoney(x.cost),x.expenses===null?'—':salesMoney(x.expenses),x.profit===null?'No disponible':salesMoney(x.profit)]),['Producto','Cantidad','Monto detallado','Costo','Gastos estimados','Ganancia estimada']));
  $('salesMessage').textContent='Informe actualizado.';
 } catch(e){$('salesMessage').textContent=e.message;}
}
$('salesDate').value=chileDateValue();$('salesFrom').value=chileDateValue();$('salesTo').value=chileDateValue();
const salesMonthNames=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
for(let m=1;m<=12;m++)$('salesMonth').add(new Option(salesMonthNames[m-1],String(m).padStart(2,'0')));
const currentChileDate=chileDateValue();
const currentYear=Number(currentChileDate.slice(0,4));
for(let y=currentYear+1;y>=2020;y--)$('salesYear').add(new Option(String(y),String(y)));
$('salesMonth').value=currentChileDate.slice(5,7);$('salesYear').value=String(currentYear);
function toggleSalesDateFields(){const period=$('salesPeriod').value,monthly=period==='month',custom=period==='custom';$('salesDateWrap').classList.toggle('hidden',monthly||custom);$('salesRangeWrap').classList.toggle('hidden',!custom);$('salesMonthWrap').classList.toggle('hidden',!monthly);$('salesYearWrap').classList.toggle('hidden',!monthly);}
$('salesPeriod').onchange=()=>{toggleSalesDateFields();lastSalesReport=null;$('salesReport').replaceChildren();$('salesMessage').textContent='Presiona Ver informe para consultar el período seleccionado.';};
for(const id of ['salesDate','salesMonth','salesYear','salesFrom','salesTo'])$(id).onchange=()=>{lastSalesReport=null;$('salesReport').replaceChildren();$('salesMessage').textContent='Presiona Ver informe para consultar el período seleccionado.';};
toggleSalesDateFields();
$('salesRefresh').onclick=renderSales;
$('manualProduct').onchange=()=>{const p=(data.products||[]).find(x=>String(x.id)===$('manualProduct').value);if(p){$('manualPrice').value=Number(p.retail)||0;$('manualTotal').value=(Number(p.retail)||0)*Number($('manualQuantity').value||1);}};
for(const id of ['manualQuantity','manualPrice']) $(id).oninput=()=>{if($('manualProduct').value)$('manualTotal').value=Number($('manualQuantity').value||0)*Number($('manualPrice').value||0);};
$('manualSaleForm').onsubmit=async e=>{
 e.preventDefault();
 if(!confirm('¿Registrar esta venta y descontar stock si corresponde?'))return;
 const pid=$('manualProduct').value;
 const body={customer:$('manualCustomer').value,payment_method:$('manualPayment').value,total:Number($('manualTotal').value),notes:$('manualNotes').value,items:pid?[{id:Number(pid),quantity:Number($('manualQuantity').value),unit_price:Number($('manualPrice').value)}]:[]};
 try{await api('/api/admin/sales/manual','POST',body);$('manualSaleForm').reset();$('manualSaleMessage').textContent='Venta registrada correctamente.';await refresh();await renderSales();}
 catch(err){$('manualSaleMessage').textContent=err.message;}
};
function exportSalesExcel(){
 if(!lastSalesReport){alert('Primero genera el informe.');return;}
 const r=lastSalesReport;
 const summary=[
  ['BRUSAAM · Informe de ventas'],['Desde',r.from],['Hasta',r.to],
  ['Total ventas',r.total],['Número de ventas',r.count],['Unidades',r.units],
  ['Ingresos productos',r.finance?.product_revenue??'No determinado'],
  ['Despachos cobrados',r.finance?.shipping_collected??0],
  ['Costo conocido',r.finance?.cost??0],
  ['Gastos operacionales',r.finance?.expenses??0],
  ['Ganancia estimada',r.finance?.profit??'Pendiente de datos'],
  ['Margen estimado',r.finance?.margin??'No disponible']
 ];
 const sales=[['Fecha','Origen','Cliente','Método de pago','Total','ID']];
 for(const x of r.sales||[])sales.push([
  new Date(x.created_at).toLocaleString('es-CL',{timeZone:'America/Santiago'}),
  x.source,x.customer||'',x.payment_method||'',Number(x.total)||0,x.id
 ]);
 const products=[['Producto','Cantidad','Monto detallado','Costo histórico','Gastos estimados','Ganancia estimada']];
 for(const x of r.products||[])products.push([x.product_name,Number(x.quantity)||0,x.amount??'No desglosado',x.cost??'Sin costo histórico',x.expenses??'',x.profit??'No disponible']);
 const payments=[['Método de pago','Total']];
 const byPayment={Efectivo:0,Transferencia:0,Tarjeta:0,Otros:0};
 for(const x of r.sales||[]){
  const method=String(x.payment_method||'');
  const key=/efectivo/i.test(method)?'Efectivo':/transfer/i.test(method)?'Transferencia':/tarjeta|d[eé]bito|cr[eé]dito/i.test(method)?'Tarjeta':'Otros';
  byPayment[key]+=Number(x.total)||0;
 }
 for(const [method,total] of Object.entries(byPayment))payments.push([method,total]);
 const escapeXml=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
 const col=n=>{let a='';for(n++;n;n=Math.floor((n-1)/26))a=String.fromCharCode(65+(n-1)%26)+a;return a;};
 const worksheet=rows=>'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+
  rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((value,j)=>{
   const ref=col(j)+(i+1);
   if(typeof value==='number'&&Number.isFinite(value))return '<c r="'+ref+'"><v>'+value+'</v></c>';
   return '<c r="'+ref+'" t="inlineStr"><is><t>'+escapeXml(value)+'</t></is></c>';
  }).join('')+'</row>').join('')+'</sheetData></worksheet>';
 const names=['Resumen','Ventas','Productos','Medios de pago'];
 const sheets=[summary,sales,products,payments];
 const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+
  names.map((name,i)=>'<sheet name="'+name+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>';
 const rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
  names.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'</Relationships>';
 const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
  names.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>';
 const rootRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
 const files=[['[Content_Types].xml',types],['_rels/.rels',rootRels],['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',rels],...sheets.map((rows,i)=>['xl/worksheets/sheet'+(i+1)+'.xml',worksheet(rows)])];
 // ZIP sin compresión: formato OOXML .xlsx real, sin dependencias externas.
 const encoder=new TextEncoder(),parts=[],central=[];let offset=0;
 const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);return c>>>0;});
 const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
 const u16=(dv,p,n)=>dv.setUint16(p,n,true),u32=(dv,p,n)=>dv.setUint32(p,n>>>0,true);
 for(const [path,content] of files){
  const name=encoder.encode(path),body=encoder.encode(content),crc=crc32(body);
  const local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
  u32(lv,0,0x04034b50);u16(lv,4,20);u16(lv,6,0x0800);u16(lv,8,0);u32(lv,14,crc);u32(lv,18,body.length);u32(lv,22,body.length);u16(lv,26,name.length);local.set(name,30);
  parts.push(local,body);
  const cd=new Uint8Array(46+name.length),cv=new DataView(cd.buffer);
  u32(cv,0,0x02014b50);u16(cv,4,20);u16(cv,6,20);u16(cv,8,0x0800);u32(cv,16,crc);u32(cv,20,body.length);u32(cv,24,body.length);u16(cv,28,name.length);u32(cv,42,offset);cd.set(name,46);
  central.push(cd);offset+=local.length+body.length;
 }
 const centralLength=central.reduce((n,a)=>n+a.length,0),footer=new Uint8Array(22),fv=new DataView(footer.buffer);
 u32(fv,0,0x06054b50);u16(fv,8,files.length);u16(fv,10,files.length);u32(fv,12,centralLength);u32(fv,16,offset);
 const blob=new Blob([...parts,...central,footer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='BRUSAAM_ventas_'+r.from+'_'+r.to+'.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$('salesExcel').onclick=exportSalesExcel;
$('salesPDF').onclick=()=>{
 if(!lastSalesReport){alert('Primero genera el informe.');return;}
 const r=lastSalesReport,w=window.open('','_blank');if(!w){alert('Permite ventanas emergentes para guardar el PDF.');return;}
 const esc=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 const rows=r.sales.map(x=>'<tr><td>'+esc(new Date(x.created_at).toLocaleString('es-CL',{timeZone:'America/Santiago'}))+'</td><td>'+esc(x.source)+'</td><td>'+esc(x.payment_method)+'</td><td>'+esc(salesMoney(x.total))+'</td></tr>').join('');
 w.document.write('<!doctype html><html lang="es"><meta charset="utf-8"><title>BRUSAAM Informe</title><style>body{font-family:Arial;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:7px;text-align:left}@media print{button{display:none}}</style><h1>BRUSAAM · Informe de ventas</h1><p>'+esc(r.from)+' a '+esc(r.to)+'</p><h2>Total: '+esc(salesMoney(r.total))+'</h2><p>Ventas: '+r.count+' · Unidades: '+r.units+'</p><table><tr><th>Fecha</th><th>Origen</th><th>Pago</th><th>Total</th></tr>'+rows+'</table><p>Solo ventas registradas y confirmadas.</p><button onclick="window.print()">Imprimir / Guardar como PDF</button></html>');w.document.close();w.focus();
};

// El identificador completo permanece como clave interna en D1; al cliente se le muestra el código corto.
let brusaamPublicCodes={};
function orderShortCode(id){return brusaamPublicCodes[String(id||'')]||String(id||'').slice(0,8).toUpperCase();}
function orderChileDate(timestamp){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(Number(timestamp)));
 const get=type=>parts.find(p=>p.type===type)?.value||'';
 return get('year')+'-'+get('month')+'-'+get('day');
}
let activeOrderFilter='all';
document.querySelectorAll('[data-management]').forEach(button=>button.addEventListener('click',()=>{
 $('ordersStatusFilter').value=button.dataset.management;
 document.querySelectorAll('[data-management]').forEach(b=>b.classList.toggle('active',b===button));
 renderOrders();
}));
$('ordersStatusFilter').value='pending';

$('ordersSearch').addEventListener('input',renderOrders);
$('ordersStatusFilter').addEventListener('change',renderOrders);
$('ordersSort').addEventListener('change',renderOrders);
$('ordersDateFrom').addEventListener('change',renderOrders);
$('ordersDateTo').addEventListener('change',renderOrders);
$('ordersClearDates').addEventListener('click',()=>{$('ordersDateFrom').value='';$('ordersDateTo').value='';renderOrders();});
document.querySelectorAll('[data-order-filter]').forEach(button=>button.addEventListener('click',()=>{
 activeOrderFilter=button.dataset.orderFilter;
 document.querySelectorAll('[data-order-filter]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',String(b===button));});
 renderOrders();
}));
let brusaamActiveOrderId=null;
async function renderOrders() {
 const preservedY=window.scrollY;
 const previousCard=brusaamActiveOrderId?[...document.querySelectorAll('[data-order-id]')].find(el=>el.dataset.orderId===brusaamActiveOrderId):null;
 const previousCardTop=previousCard?.getBoundingClientRect().top;
 const root=$('ordersList'),message=$('ordersMessage'),badge=$('pendingOrdersBadge'),summary=$('ordersSummary');
 root.replaceChildren();root.classList.remove('brusaamOrdersScroll');message.textContent='';
 try {
  const result=await api('/api/admin/orders');
  brusaamPublicCodes=Object.fromEntries((result.orders||[]).filter(o=>o.public_code).map(o=>[o.id,o.public_code]));
  // Los festivos del antiguo sistema de pedidos adicionales no se muestran en V32.
  $('brusaamHolidayEditor')?.remove();
  const orders=Array.isArray(result.orders)?result.orders:[];
  // Contadores de las seis secciones, calculados sobre todos los pedidos (sin filtros de búsqueda/fecha).
  const managementCounts={pending:0,confirmed:0,pickup:0,dispatched:0,delivered:0,cancelled:0};
  for(const o of orders){
   if(o.status==='pending')managementCounts.pending++;
   else if(o.status==='cancelled'||o.status==='expired')managementCounts.cancelled++;
   else if(o.status==='confirmed'){
    if(Number(o.delivered_at)>0)managementCounts.delivered++;
    else if(o.delivery_method==='pickup')managementCounts.pickup++;
    else if(Number(o.dispatched_at)>0)managementCounts.dispatched++;
    else managementCounts.confirmed++;
   }
  }
  document.querySelectorAll('.brusaamManagementButton[data-management]').forEach(button=>{
   const count=managementCounts[button.dataset.management]??0;
   let counter=button.querySelector('.brusaamManagementCount');
   if(!counter){counter=document.createElement('span');counter.className='brusaamManagementCount';button.appendChild(counter);}
   counter.textContent=String(count);
   counter.setAttribute('aria-label',count+' pedidos');
  });
  const pending=orders.filter(o=>o.status==='pending').length;
  badge.textContent=String(pending);badge.classList.toggle('hidden',pending===0);
  summary.textContent=(pending===0?'✓ No tienes pedidos pendientes':pending===1?'🔔 Tienes 1 pedido pendiente de revisión':'🔔 Tienes '+pending+' pedidos pendientes de revisión')+' · Orden de atención: del más antiguo al más reciente';
  document.title=pending?'('+pending+') BRUSAAM · Administración':'BRUSAAM · Administración';
  // El filtro principal ahora usa las seis secciones de gestión.
  /* $('orderCountWhatsapp').textContent=String(orders.filter(o=>!o.parent_order_id&&o.order_channel!=='direct').length);
  $('orderCountDirect').textContent=String(orders.filter(o=>!o.parent_order_id&&o.order_channel==='direct').length);
  $('orderCountAdditional').textContent=String(orders.filter(o=>Boolean(o.parent_order_id)).length);
  $('orderCountAll').textContent=String(orders.length); */
  if(!orders.length){root.textContent='Todavía no hay pedidos registrados.';return;}
  const from=$('ordersDateFrom').value,to=$('ordersDateTo').value;
  if(from&&to&&from>to){root.textContent='La fecha inicial no puede ser posterior a la final.';return;}
  const statusFilter=$('ordersStatusFilter').value;
  const normalizeSearch=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const query=normalizeSearch($('ordersSearch').value);
  const visibleOrders=orders.filter(o=>{
   const channelMatches=true;
   const statusMatches=statusFilter==='pickup'?(o.status==='confirmed'&&o.delivery_method==='pickup'&&!Number(o.delivered_at)):statusFilter==='all'||(statusFilter==='cancelled'?(o.status==='cancelled'||o.status==='expired'):statusFilter==='delivered'?(o.status==='confirmed'&&Number(o.delivered_at)>0):statusFilter==='dispatched'?(o.status==='confirmed'&&o.delivery_method!=='pickup'&&Number(o.dispatched_at)>0&&!Number(o.delivered_at)):statusFilter==='confirmed'?(o.status==='confirmed'&&o.delivery_method!=='pickup'&&!Number(o.dispatched_at)&&!Number(o.delivered_at)):o.status===statusFilter);
   const date=orderChileDate(o.created_at);
   const searchable=[o.id,orderShortCode(o.id),o.customer,o.customer_whatsapp,o.contact_phone,o.parent_order_id,orderShortCode(o.parent_order_id)].map(normalizeSearch).join(' ');
   return channelMatches&&statusMatches&&(!query||searchable.includes(query))&&(!from||date>=from)&&(!to||date<=to);
  }).sort((a,b)=>($('ordersSort').value==='newest'?-1:1)*(Number(a.created_at)-Number(b.created_at)||String(a.id).localeCompare(String(b.id))));
  if(!visibleOrders.length){root.textContent='No hay pedidos que coincidan con los filtros seleccionados.';return;}
  root.classList.toggle('brusaamOrdersScroll',visibleOrders.length>3);
  // Numeración estable e independiente para cada una de las seis secciones.
  // Se calcula sobre todos los pedidos, antes de aplicar búsqueda o fechas.
  const managementSection=o=>{
   if(o.status==='pending')return 'pending';
   if(o.status==='cancelled'||o.status==='expired')return 'cancelled';
   if(o.status==='confirmed'){
    if(Number(o.delivered_at)>0)return 'delivered';
    if(o.delivery_method==='pickup')return 'pickup';
    if(Number(o.dispatched_at)>0)return 'dispatched';
    return 'confirmed';
   }
   return null;
  };
  const sectionPositions=new Map();
  const sectionNumbers={pending:0,confirmed:0,pickup:0,dispatched:0,delivered:0,cancelled:0};
  for(const o of [...orders].sort((a,b)=>Number(a.created_at)-Number(b.created_at)||String(a.id).localeCompare(String(b.id)))){
   const group=managementSection(o);
   if(group)sectionPositions.set(o.id,++sectionNumbers[group]);
  }
  // Posibles despachos compartidos: solo sugerencia, nunca fusiona ni modifica importes.
  const normalizeChileWhatsapp=value=>{
   const digits=String(value||'').replace(/\D/g,'');
   if(/^569\d{8}$/.test(digits))return digits;
   if(/^9\d{8}$/.test(digits))return '56'+digits;
   if(/^09\d{8}$/.test(digits))return '56'+digits.slice(1);
   return '';
  };
  const eligibleForSharedDelivery=o=>o.delivery_method==='delivery'&&['pending','confirmed'].includes(o.status)&&!Number(o.dispatched_at)&&!Number(o.delivered_at)&&!o.parent_order_id;
  const sameCustomerOrders=new Map();
  for(const o of orders){
   if(!eligibleForSharedDelivery(o))continue;
   const phone=normalizeChileWhatsapp(o.customer_whatsapp);
   if(!phone)continue;
   const key=phone+'|'+orderChileDate(o.created_at);
   if(!sameCustomerOrders.has(key))sameCustomerOrders.set(key,[]);
   sameCustomerOrders.get(key).push(o);
  }
  for(const order of visibleOrders){
   const section=document.createElement('section');
   section.dataset.orderId=order.id;
   section.className='panel brusaamOrderCard'+(order.status==='pending'?' orderPendingCard':'');
   const header=document.createElement('div');header.className='orderCardHeader';
   const heading=document.createElement('h4');
   heading.textContent='Pedido #'+orderShortCode(order.id);
   const status=document.createElement('span');status.className='orderStatusPill '+order.status;
   status.textContent=Number(order.delivered_at)>0?'📦 ENTREGADO':order.delivery_method==='pickup'&&order.status==='confirmed'?(Number(order.pickup_ready_at)>0?'📦 LISTO PARA RETIRAR':'📦 EN PREPARACIÓN'):Number(order.dispatched_at)>0?'🚚 DESPACHADO':(({pending:'⏳ PENDIENTE',confirmed:'✓ CONFIRMADO',cancelled:'✕ CANCELADO',expired:'VENCIDO'})[order.status]||order.status);
   header.append(heading,status);
   const details=document.createElement('p');details.style.whiteSpace='pre-line';
   details.textContent='📨 Canal: '+(order.parent_order_id?'Pedido adicional':order.order_channel==='direct'?'Pedido directo':'WhatsApp')+'\n'+('📱 Teléfono: '+(order.customer_whatsapp||'No registrado')+'\n')+'👤 Cliente: '+order.customer+'\n💳 Pago: '+order.payment_method+'\n🚚 Entrega: '+(order.delivery_method==='pickup'?'Retiro':'Despacho')+'\n📍 Dirección: '+[order.address,order.commune,order.region].filter(Boolean).join(', ')+'\n📅 Fecha: '+new Date(order.created_at).toLocaleString('es-CL',{timeZone:'America/Santiago'})+(order.notes?'\n📝 Observaciones: '+order.notes:'');
   const itemsBox=document.createElement('div');itemsBox.className='orderProductList';
   const mergedAdditions=(result.orders||[]).filter(a=>a.parent_order_id===order.id&&a.merge_state==='approved'&&a.status!=='cancelled'&&a.status!=='expired');
   // La orden consolidada es una vista: las líneas originales y adicionales conservan su auditoría.
   const orderLines=(result.commercial||[]).filter(i=>i.order_id===order.id||mergedAdditions.some(a=>a.id===i.order_id));
   const orderPricing=(result.pricing||[]).find(p=>p.order_id===order.id);
   const addedSubtotal=mergedAdditions.reduce((sum,a)=>sum+Number((result.pricing||[]).find(p=>p.order_id===a.id)?.product_subtotal||0),0);
   const totalCombined=Number(orderPricing?.expected_total||0)+addedSubtotal;
   const orderDate=new Date(Number(order.created_at)).toLocaleString('es-CL',{timeZone:'America/Santiago'});
   const orderHeading=document.createElement('div');orderHeading.className='brusaamInvoiceTitle';orderHeading.textContent='🧾 ORDEN DE PEDIDO #'+orderShortCode(order.id);itemsBox.append(orderHeading);
   const dateLabel=document.createElement('p');dateLabel.className='muted';dateLabel.textContent='📅 Fecha y hora: '+orderDate;itemsBox.append(dateLabel);
   if(mergedAdditions.length){const label=document.createElement('p');label.className='brusaamMergedLabel';label.textContent='💜 Pedido actualizado con productos adicionales';itemsBox.append(label);}
   const tableWrap=document.createElement('div');tableWrap.className='brusaamInvoiceScroll';
   const table=document.createElement('table');table.className='brusaamInvoiceTable';
   const thead=document.createElement('thead'),hr=document.createElement('tr');
   for(const h of ['Producto','Cantidad','Monto']){const th=document.createElement('th');th.textContent=h;hr.append(th);}thead.append(hr);table.append(thead);
   const tbody=document.createElement('tbody');
   for(const line of orderLines){
    const tr=document.createElement('tr');if(line.order_id!==order.id)tr.className='brusaamAdditionalRow';
    const name=document.createElement('td');name.textContent=line.product_name;
    if(line.order_id!==order.id){const tag=document.createElement('small');tag.className='brusaamAdditionalTag';tag.textContent=' + Adicional #'+orderShortCode(line.order_id);name.append(document.createElement('br'),tag);}
    const qty=document.createElement('td');qty.textContent=line.quantity+' '+line.kind+'(s)';
    const amount=document.createElement('td');amount.textContent=salesMoney(Number(line.validated_line_total||0));
    tr.append(name,qty,amount);tbody.append(tr);
   }
   if(!orderLines.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.textContent='No hay líneas comerciales disponibles para este pedido.';tr.append(td);tbody.append(tr);}
   table.append(tbody);tableWrap.append(table);itemsBox.append(tableWrap);
   if(orderPricing){
    const totals=document.createElement('div');totals.className='brusaamInvoiceTotals';
    for(const [label,value] of [['Subtotal productos',Number(orderPricing.product_subtotal||0)+addedSubtotal],['Despacho',Number(orderPricing.delivery_amount||0)],['TOTAL DEL PEDIDO',totalCombined]]){
     const row=document.createElement('div');row.className=label==='TOTAL DEL PEDIDO'?'brusaamInvoiceGrand':'';
     const a=document.createElement('span');a.textContent=label;const b=document.createElement('strong');b.textContent=label==='Despacho'&&orderPricing.shipping_kind==='collect'?'Por pagar':salesMoney(value);row.append(a,b);totals.append(row);
    }
    itemsBox.append(totals);
   }
   const expand=document.createElement('button');expand.type='button';expand.className='secondary';expand.textContent='Ver detalle del pedido';expand.style.margin='8px 0';
   const body=document.createElement('div');body.className='brusaamOrderExpanded';body.hidden=brusaamActiveOrderId!==order.id;
   if(!body.hidden){section.classList.add('brusaamOrderReviewing');expand.textContent='Ocultar detalle';}
   expand.onclick=()=>{body.hidden=!body.hidden;brusaamActiveOrderId=body.hidden?null:order.id;section.classList.toggle('brusaamOrderReviewing',!body.hidden);expand.textContent=body.hidden?'Ver detalle del pedido':'Ocultar detalle';};
   section.append(header,expand,body);
   const overview=document.createElement('p');overview.className='muted';overview.textContent=order.customer+' · '+new Date(Number(order.created_at)).toLocaleString('es-CL',{timeZone:'America/Santiago'})+' · '+(order.parent_order_id?'Adicional':order.order_channel==='direct'?'Directo':'WhatsApp');
   section.insertBefore(overview,expand);
   if(eligibleForSharedDelivery(order)){
    const phone=normalizeChileWhatsapp(order.customer_whatsapp);
    const related=phone?(sameCustomerOrders.get(phone+'|'+orderChileDate(order.created_at))||[]).filter(o=>o.id!==order.id):[];
    if(related.length){
     const notice=document.createElement('div');notice.className='notice';notice.style.cssText='margin:10px 0;border-left:4px solid #8e5caf;padding:12px';
     const heading=document.createElement('strong');heading.textContent='🚚 Posible despacho compartido';notice.append(heading);
     const desc=document.createElement('p');desc.style.margin='6px 0';
     desc.textContent='El mismo WhatsApp registra otros pedidos del día aún sin despachar: '+related.map(o=>'N.º '+orderShortCode(o.id)).join(', ')+'. Revisa si corresponde compartir el despacho.';
     notice.append(desc);
     const reminder=document.createElement('small');reminder.textContent='Pedidos independientes: no se fusionan ni se descuentan cargos automáticamente. Puedes ajustar el despacho manualmente cuando la edición de órdenes esté habilitada.';notice.append(reminder);
     section.insertBefore(notice,expand);
    }
   }
   const meta=document.createElement('div');meta.className='brusaamOrderMeta';
   const mainDetails=[
    '👤 Cliente: '+order.customer,
    '📨 Canal: '+(order.parent_order_id?'Pedido adicional':order.order_channel==='direct'?'Pedido directo':'WhatsApp'),
    '📱 Teléfono: '+(order.customer_whatsapp||'No registrado')
   ];
   if(order.delivery_method==='delivery')mainDetails.push('📍 Dirección: '+[order.address,order.commune,order.region].filter(Boolean).join(', '));
   if(order.notes)mainDetails.push('📝 Observaciones: '+order.notes);
   for(const label of mainDetails){
    const pill=document.createElement('span');pill.textContent=label;meta.append(pill);
   }
   overview.replaceWith(meta);
   const quick=document.createElement('div');quick.className='brusaamOrderQuick';
   section.insertBefore(quick,expand);
   const quickDetail=document.createElement('button');quickDetail.type='button';quickDetail.className='secondary';quickDetail.textContent='📋 Ver productos y total';
   quickDetail.onclick=()=>{brusaamActiveOrderId=order.id;body.hidden=false;section.classList.add('brusaamOrderReviewing');expand.textContent='Ocultar detalle';body.scrollIntoView({behavior:'smooth',block:'nearest'});};
   const quickPricing=(result.pricing||[]).find(p=>p.order_id===order.id);
   if(quickPricing){
    const amount=document.createElement('strong');amount.style.cssText='margin-left:auto;align-self:center;color:#5b27b5;font-size:18px';
    amount.textContent='Total: '+salesMoney(totalCombined);
    header.append(amount);
   }
   // El botón principal «Ver detalle del pedido» abre la orden completa.
   if(order.status==='pending'&&order.merge_state!=='awaiting'){
    const quickConfirm=document.createElement('button');quickConfirm.type='button';quickConfirm.textContent=order.parent_order_id&&order.merge_state==='approved'?'✓ Confirmar adicional (rebajar solo adicional)':'✓ Confirmar pedido';
    quickConfirm.onclick=()=>{const btn=[...body.querySelectorAll('.orderActions button')].find(b=>b.textContent.includes('Confirmar'));if(btn)btn.click();};
    quick.append(quickConfirm);
    const quickReject=document.createElement('button');quickReject.type='button';quickReject.className='orderReject';quickReject.textContent='✕ Rechazar pedido';
    quickReject.onclick=()=>{const btn=[...body.querySelectorAll('.orderActions button')].find(b=>b.textContent.includes('Rechazar'));if(btn)btn.click();};
    quick.append(quickReject);
   }
   if(order.status==='confirmed'&&!Number(order.delivered_at)){
    const quickStatus=document.createElement('button');quickStatus.type='button';quickStatus.className='secondary';quickStatus.textContent='📦 Ver gestión de entrega';
    quickStatus.onclick=()=>{brusaamActiveOrderId=order.id;body.hidden=false;section.classList.add('brusaamOrderReviewing');expand.textContent='Ocultar detalle';body.scrollIntoView({behavior:'smooth',block:'nearest'});};
    quick.append(quickStatus);
   }
   const productsSection=document.createElement('div');productsSection.className='brusaamOrderSection';
   productsSection.append(itemsBox);
   body.append(productsSection);
   const orderTools=document.createElement('div');orderTools.className='brusaamInvoiceActions';
   if(order.status==='pending'&&order.review_state!=='approved'){
    const modify=document.createElement('button');modify.type='button';modify.className='secondary';modify.textContent='✏️ Modificar pedido';
    modify.onclick=()=>{brusaamActiveOrderId=order.id;const edit=[...body.querySelectorAll('button')].find(b=>b.textContent.includes('Editar pedido y enviar actualización'));if(edit){edit.click();body.querySelector('.orderEditForm')?.scrollIntoView({behavior:'smooth',block:'nearest'});}else alert('Este pedido no admite modificaciones en su estado actual.');};
    orderTools.append(modify);
   }
   // Ajuste manual de despacho: no modifica las tarifas publicadas del catálogo.
   if(order.delivery_method==='delivery'&&['pending','confirmed'].includes(order.status)&&!Number(order.dispatched_at)&&!Number(order.delivered_at)&&orderPricing){
    const shippingEdit=document.createElement('div');shippingEdit.style.cssText='padding:12px;margin:10px 0;border:1px solid #e2d6ee;border-radius:12px;background:#faf7fd';
    const shippingTitle=document.createElement('strong');shippingTitle.textContent='🚚 Ajustar costo de despacho';shippingEdit.append(shippingTitle);
    const shippingHelp=document.createElement('p');shippingHelp.textContent='Puedes dejarlo en $0 para un despacho compartido. No fusiona pedidos ni cambia el precio del catálogo.';shippingEdit.append(shippingHelp);
    const shippingInput=document.createElement('input');shippingInput.type='number';shippingInput.min='0';shippingInput.max='100000';shippingInput.step='1';shippingInput.value=String(orderPricing.delivery_amount??0);shippingInput.setAttribute('aria-label','Nuevo costo de despacho en pesos');shippingEdit.append(shippingInput);
    const shippingReason=document.createElement('input');shippingReason.type='text';shippingReason.maxLength=180;shippingReason.placeholder='Motivo (ej.: despacho compartido)';shippingReason.setAttribute('aria-label','Motivo del ajuste');shippingEdit.append(shippingReason);
    const saveShipping=document.createElement('button');saveShipping.type='button';saveShipping.className='secondary';saveShipping.textContent='💜 Guardar nuevo despacho';
    saveShipping.onclick=async()=>{
     const amount=Number(shippingInput.value),reason=shippingReason.value.trim();
     if(!shippingInput.value||!Number.isSafeInteger(amount)||amount<0||amount>100000)return alert('Ingresa un costo de despacho válido entre $0 y $100.000.');
     if(!reason)return alert('Indica el motivo del cambio.');
     if(!confirm('¿Guardar despacho de '+salesMoney(amount)+' para este pedido? El total se recalculará.'))return;
     saveShipping.disabled=true;
     try{await api('/api/admin/orders/'+order.id+'/shipping-adjustment','POST',{amount,reason});await renderOrders();}catch(e){alert(e.message);saveShipping.disabled=false;}
    };shippingEdit.append(saveShipping);orderTools.append(shippingEdit);
   }
   // Consulta segura del inventario asociado al pedido; no cambia cantidades ni descuenta stock.
   if(['pending','confirmed'].includes(order.status)&&!Number(order.dispatched_at)&&!Number(order.delivered_at)){
    const inspect=document.createElement('button');inspect.type='button';inspect.className='secondary';inspect.textContent='📦 Revisar inventario de este pedido';
    inspect.onclick=async()=>{
     inspect.disabled=true;
     try{
      const data=await api('/api/admin/orders/'+order.id+'/stock-impact','GET');
      const lines=(data.items||[]).map(i=>'• '+i.name+': '+i.units+' unidad(es) física(s) · stock disponible '+i.available+(data.stock_already_deducted?' (ya contabilizado)':(i.sufficient?'':' ⚠️ INSUFICIENTE')));
      alert('📦 Inventario del pedido '+orderShortCode(order.id)+'\n\n'+(lines.join('\n')||'Sin líneas de inventario')+'\n\n'+(data.stock_already_deducted?'Este pedido tiene stock previamente reservado o descontado; no se debe volver a descontar.':'El stock aún no se ha descontado; se comprobará al confirmar.')+'\nEsta consulta no modifica el inventario.');
     }catch(e){alert(e.message);}finally{inspect.disabled=false;}
    };
    orderTools.append(inspect);
   }
   // Simulación de diferencias de inventario, sin alterar productos ni pedidos.
   if(order.status==='confirmed'&&!Number(order.dispatched_at)&&!Number(order.delivered_at)){
    const preview=document.createElement('button');preview.type='button';preview.className='secondary';preview.textContent='🧮 Simular cambio de cantidad (sin guardar)';
    preview.onclick=async()=>{
     preview.disabled=true;
     try{
      const data=await api('/api/admin/orders/'+order.id+'/stock-impact','GET');
      const items=data.items||[];
      if(!items.length){alert('Este pedido no tiene líneas físicas para simular.');return;}
      const options=items.map((x,i)=>(i+1)+'. '+x.name+' ('+x.units+' unidades físicas)').join('\n');
      const choice=prompt('Selecciona el número de producto físico para simular:\n'+options);
      if(choice===null)return;
      const index=Number(choice)-1;if(!Number.isSafeInteger(index)||index<0||index>=items.length){alert('Selección inválida.');return;}
      const selected=items[index];
      const raw=prompt('Cantidad física nueva de '+selected.name+' (actual: '+selected.units+'):',String(selected.units));
      if(raw===null)return;
      const desired=Number(raw);
      if(!/^\d+$/.test(raw.trim())||!Number.isSafeInteger(desired)||desired>100000){alert('Cantidad inválida.');return;}
      const result=await api('/api/admin/orders/'+order.id+'/stock-delta-preview','POST',{product_id:selected.product_id,new_units:desired});
      const movement=result.delta>0?'Se descontarían '+result.delta+' unidades adicionales':result.delta<0?'Se devolverían '+Math.abs(result.delta)+' unidades al stock':'No habría movimiento de stock';
      alert('🧮 SIMULACIÓN (NO GUARDA CAMBIOS)\n\n'+selected.name+'\nActual: '+result.old_units+'\nPropuesta: '+result.new_units+'\n'+movement+'\nStock actual: '+result.available+'\n'+(result.sufficient?'Stock suficiente.':'⚠️ Stock insuficiente para aumentar la cantidad.')+'\n\nLa cantidad y el precio del pedido NO fueron modificados.');
     }catch(e){alert(e.message);}finally{preview.disabled=false;}
    };orderTools.append(preview);
   }
   // Edición transaccional: por seguridad solo unidades simples, no mangas ni packs.
   if(order.status==='confirmed'&&!Number(order.dispatched_at)&&!Number(order.delivered_at)&&!Number(order.pickup_ready_at)){
    const unitLines=(result.commercial||[]).filter(l=>l.order_id===order.id&&l.kind==='unidad'&&Number(l.quantity)>0);
    if(unitLines.length){
     const box=document.createElement('div');box.style.cssText='padding:12px;margin:10px 0;border:1px solid #d9c7e6;border-radius:12px';
     const title=document.createElement('strong');title.textContent='📦 Cambiar cantidad de unidades (pedido confirmado)';box.append(title);
     const sel=document.createElement('select');unitLines.forEach((l,i)=>sel.add(new Option(l.product_name+' · '+l.quantity+' unidad(es)',String(i))));
     const count=document.createElement('input');count.type='number';count.min='1';count.max='100000';count.step='1';
     const sync=()=>{count.value=String(unitLines[Number(sel.value)].quantity)};sel.onchange=sync;sync();
     const reason=document.createElement('input');reason.placeholder='Motivo del cambio (obligatorio)';reason.maxLength=180;
     const save=document.createElement('button');save.type='button';save.className='secondary';save.textContent='💜 Guardar nueva cantidad';
     save.onclick=async()=>{
      const line=unitLines[Number(sel.value)],new_quantity=Number(count.value);
      if(!/^\\d+$/.test(count.value)||!Number.isSafeInteger(new_quantity)||new_quantity<1||new_quantity>100000)return alert('Ingresa una cantidad válida mayor que cero.');
      if(!reason.value.trim())return alert('Ingresa un motivo.');
      if(!confirm('¿Actualizar cantidad, stock y total de este pedido?'))return;
      save.disabled=true;
      try{await api('/api/admin/orders/'+order.id+'/unit-quantity-adjustment','POST',{product_id:Number(line.product_id),new_quantity,reason:reason.value.trim(),expected_quantity:Number(line.quantity)});await renderOrders();}
      catch(e){alert(e.message);save.disabled=false;}
     };
     box.append(sel,count,reason,save);orderTools.append(box);
    }
   }
   // Precio manual por línea: solo afecta este pedido, sin alterar catálogo ni inventario.
   if(['pending','confirmed'].includes(order.status)&&!Number(order.dispatched_at)&&!Number(order.delivered_at)&&orderPricing){
    const editableLines=(result.commercial||[]).filter(l=>l.order_id===order.id&&Number(l.quantity)>0);
    if(editableLines.length){
     const pricePanel=document.createElement('div');pricePanel.style.cssText='padding:12px;margin:10px 0;border:1px solid #e2d6ee;border-radius:12px;background:#faf7fd';
     const heading=document.createElement('strong');heading.textContent='💜 Modificar precio de producto en este pedido';pricePanel.append(heading);
     const help=document.createElement('p');help.textContent='Modifica solo el precio unitario de una línea. El subtotal y total se recalculan; no cambia el catálogo ni el stock.';pricePanel.append(help);
     const picker=document.createElement('select');
     editableLines.forEach((line,index)=>picker.add(new Option(line.product_name+' · '+line.kind+' × '+line.quantity+' · '+salesMoney(line.validated_line_total),String(index))));
     const unitInput=document.createElement('input');unitInput.type='number';unitInput.min='0';unitInput.max='10000000';unitInput.step='1';unitInput.placeholder='Nuevo precio unitario ($)';
     const updateUnit=()=>{const l=editableLines[Number(picker.value)];unitInput.value=Number.isSafeInteger(Number(l.validated_unit_price))?String(l.validated_unit_price):'';};
     picker.onchange=updateUnit;updateUnit();
     const reason=document.createElement('input');reason.type='text';reason.maxLength=180;reason.placeholder='Motivo del cambio (obligatorio)';
     const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='💜 Guardar precio de este pedido';
     button.onclick=async()=>{
      const line=editableLines[Number(picker.value)],unit_price=Number(unitInput.value);
      if(!unitInput.value||!Number.isSafeInteger(unit_price)||unit_price<0||unit_price>10000000)return alert('Ingresa un precio unitario válido.');
      if(!reason.value.trim())return alert('Ingresa el motivo del ajuste.');
      if(!confirm('¿Cambiar el precio unitario solo en este pedido?'))return;
      button.disabled=true;
      try{await api('/api/admin/orders/'+order.id+'/line-price-adjustment','POST',{product_id:Number(line.product_id),kind:line.kind,unit_price,reason:reason.value.trim()});await renderOrders();}
      catch(e){alert(e.message);button.disabled=false;}
     };
     pricePanel.append(picker,unitInput,reason,button);orderTools.append(pricePanel);
    }
   }
   const update=document.createElement('button');update.type='button';update.className='secondary';update.textContent='📋 Copiar actualización';
   update.onclick=async()=>{
    const msg='BRUSAAM · PEDIDO #'+orderShortCode(order.id)+'\nFecha: '+orderDate+'\n'+orderLines.map(i=>(i.order_id===order.id?'':'[ADICIONAL] ')+i.product_name+' × '+i.quantity+' '+i.kind+' — '+salesMoney(Number(i.validated_line_total||0))).join('\n')+'\nSubtotal: '+salesMoney(Number(orderPricing?.product_subtotal||0)+addedSubtotal)+'\nDespacho: '+(orderPricing?.shipping_kind==='collect'?'Por pagar':salesMoney(Number(orderPricing?.delivery_amount||0)))+'\nTOTAL: '+salesMoney(totalCombined);
    try{await navigator.clipboard.writeText(msg);alert('Resumen actualizado copiado. Puedes pegarlo en WhatsApp.');}catch(e){alert('No se pudo copiar automáticamente. Usa el botón de WhatsApp.');}
   };orderTools.append(update);
   const contact=document.createElement('button');contact.type='button';contact.textContent='📲 Enviar resumen por WhatsApp';
   contact.onclick=()=>{
    const digits=String(order.customer_whatsapp||'').replace(/\D/g,'');
    if(!/^569\d{8}$/.test(digits)){alert('Primero vincula un número de WhatsApp válido al pedido. Si está pendiente, abre la sección de vinculación.');return;}
    const rows=orderLines.map(i=>'📝 *'+i.product_name+'*\nCantidad: '+i.quantity+' '+i.kind+'(s)'+(i.order_id===order.id?'':' 💜 ADICIONAL')+'\nTotal: '+salesMoney(Number(i.validated_line_total||0))).join('\n\n');
    const msg=[
      '🛍️ *BRUSAAM*',
      '✨ La excelencia en tu hogar ✨',
      '',
      '━━━━━━━━━━━━━━',
      '💜 *ACTUALIZACIÓN DE PEDIDO N° '+orderShortCode(order.id)+'*',
      '━━━━━━━━━━━━━━',
      '',
      '🛒 *RESUMEN DE COMPRA*',
      '',
      rows,
      '',
      '━━━━━━━━━━━━━━',
      '🧾 *RESUMEN DE PAGO*',
      '',
      'Subtotal productos: '+salesMoney(Number(orderPricing?.product_subtotal||0)+addedSubtotal),
      '🚚 Despacho: '+(orderPricing?.shipping_kind==='collect'?'Por confirmar':salesMoney(Number(orderPricing?.delivery_amount||0))),
      '💰 *TOTAL A PAGAR: '+salesMoney(totalCombined)+'*',
      '',
      '━━━━━━━━━━━━━━',
      '👤 *DATOS DEL SOLICITANTE*',
      'Nombre: '+order.customer,
      '📱 Teléfono: '+(order.customer_whatsapp||'No registrado'),
      '',
      '💳 *MÉTODO DE PAGO*',
      order.payment_method,
      '',
      '📍 *DATOS DE ENTREGA*',
      'Modalidad: '+(order.delivery_method==='pickup'?'Retiro en tienda':'Despacho a domicilio'),
      ...(order.delivery_method==='delivery'?['Dirección: '+[order.address,order.commune,order.region].filter(Boolean).join(', ')]:[]),
      ...(mergedAdditions.length?['','💜 *PEDIDO ACTUALIZADO CON PRODUCTOS ADICIONALES*']:[]),
      ...(order.notes?['','📝 *OBSERVACIONES*',order.notes]:[]),
      '',
      '━━━━━━━━━━━━━━',
      '💜 *¡Gracias por preferir BRUSAAM!*'
     ].join('\n');
    window.open('https://wa.me/'+digits+'?text='+encodeURIComponent(msg),'_blank','noopener');
   };
   orderTools.append(contact);body.append(orderTools);
   if(order.parent_order_id){
    const info=document.createElement('div');info.className='notice brusaamMergeDecision';info.style.margin='12px 0';
    const parent=(result.orders||[]).find(x=>x.id===order.parent_order_id);
    const statusText=({awaiting:'⏳ Esperando decisión',approved:'✓ Unión aprobada: sin segundo despacho',separate:'Pedido independiente: despacho normal'})[order.merge_state]||order.merge_state;
    const parentPrice=(result.pricing||[]).find(p=>p.order_id===order.parent_order_id);
    const additionalPrice=(result.pricing||[]).find(p=>p.order_id===order.id);
    const header=document.createElement('strong');header.style.cssText='display:block;font-size:22px;line-height:1.4;margin:8px 0;color:#5522af';header.textContent='📦 PEDIDO ADICIONAL N.º '+orderShortCode(order.id);info.append(header);const originalRef=document.createElement('div');originalRef.textContent='Pedido original N.º '+orderShortCode(order.parent_order_id);info.append(originalRef);
    const line=document.createElement('p');line.textContent=statusText;info.append(line);


    section.insertBefore(info,expand);
    if(order.merge_state==='awaiting'){
     const resolve=document.createElement('strong');
     resolve.textContent='⚠️ Pedido histórico pendiente de unión: requiere revisión manual. La fusión está deshabilitada.';
     info.insertBefore(resolve,info.firstChild);
    }
   }
   const orderSale=(result.sales||[]).find(v=>v.order_id===order.id);
   if(!orderPricing){const warning=document.createElement('p');warning.className='muted';warning.textContent='Sin desglose de precios validado para este pedido.';body.append(warning);}
   if(order.status==='confirmed'&&Number(order.stock_reserved)===0&&orderSale&&orderPricing&&Number(orderSale.total)===Number(orderPricing.expected_total)){
    const printButton=document.createElement('button');printButton.type='button';printButton.className='secondary';
    printButton.textContent='🖨️ Imprimir orden de compra (2 copias)';printButton.style.margin='10px 0';
    printButton.onclick=()=>window.open('/api/admin/orders/'+encodeURIComponent(order.id)+'/receipt','_blank','noopener');
    body.append(printButton);
   }
   if(order.status==='pending'&&order.merge_state==='separate'&&order.separated_from_order_id){
    const parent=(result.orders||[]).find(o=>o.id===order.separated_from_order_id);
    const valid=parent&&Date.now()-Number(parent.created_at)>=0&&Date.now()-Number(parent.created_at)<=86400000&&order.review_state==='none';
    const exceptional=document.createElement('div');exceptional.className='notice';exceptional.style.margin='12px 0';
    const headline=document.createElement('strong');headline.textContent='💜 Precio mayorista excepcional · pedido separado';exceptional.append(headline);
    const description=document.createElement('p');description.textContent=valid?'Puedes autorizar manualmente un precio por línea dentro de las 24 horas desde el pedido original. No fusiona pedidos.':'El plazo de 24 horas terminó o el pedido ya inició su revisión.';exceptional.append(description);
    if(valid){
     const lines=(result.commercial||[]).filter(l=>l.order_id===order.id);
     const picker=document.createElement('select');
     for(const l of lines){const opt=document.createElement('option');opt.value=l.product_id+'|'+l.kind;opt.textContent=l.product_name+' · '+l.quantity+' '+l.kind;picker.append(opt);}
     const price=document.createElement('input');price.type='number';price.min='0';price.step='1';price.placeholder='Precio unitario autorizado ($)';
     const reason=document.createElement('input');reason.placeholder='Motivo de la autorización';reason.maxLength=180;
     const btn=document.createElement('button');btn.type='button';btn.textContent='💜 Aplicar precio excepcional';
     btn.onclick=async()=>{const [product_id,kind]=picker.value.split('|');const unit_price=Number(price.value);if(!price.value||!reason.value.trim())return alert('Ingresa precio y motivo.');if(!confirm('¿Aplicar el precio excepcional a este pedido independiente? Revisa el total y avisa al cliente.'))return;try{await api('/api/admin/orders/'+order.id+'/exceptional-wholesale','POST',{product_id:Number(product_id),kind,unit_price,reason:reason.value});await renderOrders();}catch(e){alert(e.message);}};
     exceptional.append(picker,price,reason,btn);
    }
    body.append(exceptional);
   }
   if(order.status==='pending'){
    const note=document.createElement('p');note.className='orderStockNotice';note.textContent='Sin descuento de stock. Verifica primero que recibiste el mensaje por WhatsApp.';body.append(note);
    // Vinculación manual: el administrador toma el número del mensaje recibido.
    const phoneBox=document.createElement('div');phoneBox.className='notice';phoneBox.style.margin='12px 0';
    const phoneLabel=document.createElement('label');phoneLabel.textContent=order.order_channel==='direct'?'📱 WhatsApp ingresado en Datos del Solicitante':'📱 WhatsApp real del cliente (desde el mensaje recibido)';
    const phoneInput=document.createElement('input');phoneInput.type='tel';phoneInput.placeholder='Ejemplo: +56 9 1234 5678';phoneInput.value=order.customer_whatsapp||'';
    phoneLabel.append(phoneInput);phoneBox.append(phoneLabel);
    const linkPhone=document.createElement('button');linkPhone.type='button';linkPhone.className='secondary small';linkPhone.textContent=order.order_channel==='direct'?'Actualizar número (opcional)':'Vincular / actualizar número';
    linkPhone.onclick=async()=>{if(!confirm('¿Verificaste que este número corresponde al chat del pedido #'+orderShortCode(order.id)+'?'))return;
      try{await api('/api/admin/orders/'+order.id+'/whatsapp','POST',{phone:phoneInput.value});await renderOrders();}catch(e){alert(e.message);}};
    phoneBox.append(linkPhone);
    const phoneHelp=document.createElement('p');phoneHelp.className='muted';phoneHelp.textContent=order.order_channel==='direct'?'Número tomado de Datos del Solicitante. Solo debes actualizarlo si el cliente solicita un cambio.':'En pedidos por WhatsApp, verifica que el teléfono coincida con el chat recibido antes de vincularlo.';phoneBox.append(phoneHelp);
    body.append(phoneBox);
    if(order.review_state==='approved'||order.review_state==='awaiting'){
      const approved=document.createElement('p');approved.textContent='✓ Pedido actualizado y aprobado · Total: '+salesMoney(order.proposed_total);body.append(approved);
    }
    {
      const edit=document.createElement('button');edit.type='button';edit.textContent='✏️ Editar pedido y enviar actualización';edit.style.display='none';edit.setAttribute('aria-hidden','true');
      edit.onclick=()=>{
        if(section.querySelector('.orderEditForm'))return;
        const form=document.createElement('div');form.className='panel orderEditForm';
        const heading=document.createElement('h4');heading.textContent='Modificar productos y cantidades';form.append(heading);
        const list=document.createElement('div');form.append(list);
        const makeLine=(pid,qty,kind='unidad')=>{
          const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0';
          const select=document.createElement('select');select.style.maxWidth='260px';
          for(const p of data.products||[])select.add(new Option(p.name+' (#'+p.id+')',p.id));
          select.value=String(pid);
          const amount=document.createElement('input');amount.type='number';amount.min='1';amount.max='10000';amount.value=String(qty);amount.style.width='85px';
          const presentation=document.createElement('select');presentation.add(new Option('Unidad','unidad'));presentation.add(new Option('Manga','manga'));presentation.value=kind;
          const remove=document.createElement('button');remove.type='button';remove.textContent='Quitar';remove.onclick=()=>{row.remove();recalculate();};
          row.append(select,amount,presentation,remove);list.append(row);return {row,select,amount,presentation};
        };
        const commercialLines=(result.commercial||[]).filter(i=>i.order_id===order.id);
        const lines=commercialLines.length?commercialLines:(result.items||[]).filter(i=>i.order_id===order.id);
        for(const line of lines)makeLine(line.product_id,line.quantity,line.kind);
        const add=document.createElement('button');add.type='button';add.textContent='+ Agregar producto';add.onclick=()=>{makeLine((data.products||[])[0]?.id||0,1);recalculate();};form.append(add);
        const totalLabel=document.createElement('label');totalLabel.textContent='Nuevo total del pedido ($ CLP)';
        const totalInput=document.createElement('input');totalInput.type='number';totalInput.min='0';totalInput.step='1';totalInput.required=true;totalInput.value=order.proposed_total??(result.pricing||[]).find(p=>p.order_id===order.id)?.expected_total??'';totalInput.readOnly=true;totalInput.title='Calculado automáticamente por BRUSAAM';
        totalLabel.append(totalInput);form.append(totalLabel);
        const quoteStatus=document.createElement('p');quoteStatus.className='muted';quoteStatus.textContent='Calculando precios y despacho...';form.append(quoteStatus);
        let quoteRequest=0;
        const currentItems=()=>[...list.children].map(r=>({product_id:Number(r.children[0].value),quantity:Number(r.children[1].value),kind:r.children[2].value}));
        const recalculate=async()=>{
          const requestNumber=++quoteRequest;totalInput.value='';save.disabled=true;
          const items=currentItems();
          if(!items.length||items.some(i=>!i.product_id||!Number.isSafeInteger(i.quantity)||i.quantity<1)){quoteStatus.textContent='Revisa los productos y cantidades.';return;}
          quoteStatus.textContent='Calculando precios y despacho...';
          try{
            const quote=await api('/api/admin/orders/'+order.id+'/quote','POST',{items});
            if(requestNumber!==quoteRequest)return;
            totalInput.value=String(quote.total);
            quoteStatus.textContent='Productos: '+salesMoney(quote.subtotal)+' · Despacho: '+(quote.shipping_kind==='collect'?'Por pagar':salesMoney(quote.delivery))+' · Total calculado: '+salesMoney(quote.total);
            save.disabled=false;
          }catch(e){if(requestNumber===quoteRequest)quoteStatus.textContent='⚠️ '+e.message;}
        };
        list.addEventListener('change',recalculate);
        list.addEventListener('input',recalculate);
        recalculate();

        const noteLabel=document.createElement('label');noteLabel.textContent='Motivo de la modificación';
        const noteInput=document.createElement('textarea');noteInput.value=order.revision_note||'Productos sin disponibilidad física';noteLabel.append(noteInput);form.append(noteLabel);
        const save=document.createElement('button');save.type='button';save.textContent='Guardar cambios y preparar WhatsApp';
        save.onclick=async()=>{
          const items=currentItems();
          const total=Number(totalInput.value);
          if(!items.length||!totalInput.value||!Number.isSafeInteger(total)||total<0){alert('Revisa productos y total.');return;}
          if(!confirm('¿Guardar pedido corregido y marcarlo como esperando aprobación?'))return;
          save.disabled=true;
          try{
            await api('/api/admin/orders/'+order.id+'/edit','POST',{items,total,note:noteInput.value});
            // La propuesta queda persistida y se prepara WhatsApp directamente.
            const digits=String(order.customer_whatsapp||'').replace(/\D/g,'');
            const rows=items.map(i=>{const p=(data.products||[]).find(x=>Number(x.id)===Number(i.product_id));return '📝 *'+(p?.name||'Producto')+'*\nCantidad: '+i.quantity+' '+(i.kind||'unidad')+'(s)';}).join('\n\n');
            const message=['🛍️ *BRUSAAM*','✨ La excelencia en tu hogar ✨','','━━━━━━━━━━━━━━','💜 *ACTUALIZACIÓN DE PEDIDO N° '+orderShortCode(order.id)+'*','━━━━━━━━━━━━━━','','🛒 *PRODUCTOS ACTUALIZADOS*','',rows,'','🚚 Despacho incluido según cotización','💰 *TOTAL PROPUESTO: '+salesMoney(total)+'*','📝 Motivo: '+(noteInput.value||'Actualización del pedido'),'','Por favor, responde si *ACEPTAS* o *RECHAZAS* estos cambios.','━━━━━━━━━━━━━━','💜 *¡Gracias por preferir BRUSAAM!*'].join('\n');
            brusaamActiveOrderId=order.id;
            if(/^569\d{8}$/.test(digits))window.location.href='https://wa.me/'+digits+'?text='+encodeURIComponent(message);
            else {alert('Cambios guardados. Vincula el WhatsApp del cliente para enviar el resumen actualizado.');brusaamActiveOrderId=order.id;await renderOrders();}
          }catch(e){alert(e.message);save.disabled=false;}
        };
        const cancelEdit=document.createElement('button');cancelEdit.type='button';cancelEdit.className='secondary';cancelEdit.textContent='← Volver sin guardar';
        cancelEdit.onclick=()=>{form.remove();edit.disabled=false;};
        const editButtons=document.createElement('div');editButtons.className='flex';editButtons.style.cssText='display:flex;flex-wrap:wrap;gap:10px;margin-top:12px';
        editButtons.append(cancelEdit,save);form.append(editButtons);body.insertBefore(form,actions);
        edit.disabled=true;
      };
      body.append(edit);
    }
    const actions=document.createElement('div');actions.className='orderActions';
    for(const [action,label] of [['confirm','✓ Confirmar y descontar stock'],['cancel','✕ Rechazar pedido']]){
     const btn=document.createElement('button');btn.type='button';btn.textContent=label;
     if(action==='cancel')btn.className='orderReject';
     btn.onclick=async()=>{
      let payload={};
      if(action==='confirm'){
       if(!confirm(order.order_channel==='direct'?'¿Confirmar este pedido directo y descontar el stock disponible?':'¿Ya recibiste este pedido en WhatsApp? Al confirmar se descontará el stock disponible.'))return;
       // V32: total validado por el servidor; sin ingreso manual.
       payload={};
      }else if(!confirm('¿Rechazar este pedido? No se descontará stock de pedidos nuevos.'))return;
      for(const b of actions.querySelectorAll('button'))b.disabled=true;
      try{
       await api('/api/admin/orders/'+order.id+'/'+action,'POST',payload);
       await refresh();
       if(action==='confirm')await renderSales();
      }catch(e){alert(e.message);for(const b of actions.querySelectorAll('button'))b.disabled=false;}
     };
     actions.append(btn);
    }
    actions.style.display='none';body.append(actions);
   }
   if(order.status==='confirmed'&&order.delivery_method!=='pickup'&&!Number(order.dispatched_at)&&!Number(order.delivered_at)){
    const dispatched=document.createElement('button');dispatched.type='button';dispatched.className='secondary';dispatched.textContent='🚚 Marcar como despachado';
    dispatched.onclick=async()=>{if(!confirm('¿Confirmas que el pedido #'+orderShortCode(order.id)+' salió a despacho? Todavía no se marcará como entregado.'))return;dispatched.disabled=true;try{await api('/api/admin/orders/'+order.id+'/dispatch','POST',{});await renderOrders();}catch(e){alert(e.message);dispatched.disabled=false;}};
    body.append(dispatched);
   }
   if(order.status==='confirmed'&&((order.delivery_method==='pickup'&&Number(order.pickup_ready_at)>0)||(order.delivery_method!=='pickup'&&Number(order.dispatched_at)>0))&&!Number(order.delivered_at)){
    const delivered=document.createElement('button');delivered.type='button';delivered.className='secondary';delivered.textContent='📦 Marcar como entregado';
    delivered.onclick=async()=>{if(!confirm('¿Confirmas que el pedido #'+orderShortCode(order.id)+' fue entregado? Esta acción no modifica el inventario.'))return;delivered.disabled=true;try{await api('/api/admin/orders/'+order.id+'/deliver','POST',{});await renderOrders();}catch(e){alert(e.message);delivered.disabled=false;}};
    body.append(delivered);
   }
   if(order.status==='confirmed'&&Number(order.delivered_at)>0){
    const payBox=document.createElement('div');payBox.style.cssText='margin:14px 0;padding:14px;border:1px solid #d5c4ef;border-radius:12px;background:#faf7ff';
    const total=Number((result.sales||[]).find(x=>x.order_id===order.id)?.total||0);
    const entries=(result.payments||[]).filter(x=>x.order_id===order.id);
    const paid=entries.reduce((sum,x)=>sum+Number(x.amount||0),0),balance=Math.max(0,total-paid);
    const title=document.createElement('strong');title.textContent='💰 Estado de pago: '+(total>0&&balance===0?'🟢 PAGADO':paid>0?'🟡 ABONO PARCIAL':'🔴 PENDIENTE DE PAGO');payBox.append(title);
    const summary=document.createElement('p');summary.textContent='Total: '+salesMoney(total)+' · Abonado: '+salesMoney(paid)+' · Pendiente: '+salesMoney(balance);payBox.append(summary);
    if(entries.length){const log=document.createElement('div');log.style.cssText='font-size:13px;margin:8px 0';log.textContent=entries.map(x=>new Date(x.paid_at).toLocaleString('es-CL',{timeZone:'America/Santiago'})+' · '+salesMoney(x.amount)+(x.note?' · '+x.note:'')).join(' | ');payBox.append(log);}
    if(total>0&&balance>0){
     const amount=document.createElement('input');amount.type='number';amount.min='1';amount.max=String(balance);amount.step='1';amount.placeholder='Monto abonado';amount.style.maxWidth='180px';
     const note=document.createElement('input');note.placeholder='Nota del abono (opcional)';note.maxLength=160;
     const save=document.createElement('button');save.type='button';save.textContent='Guardar abono / pago';save.className='secondary';
     save.onclick=async()=>{const value=Number(amount.value);if(!Number.isSafeInteger(value)||value<=0||value>balance)return alert('Ingresa un monto entre $1 y '+salesMoney(balance));if(!confirm('¿Registrar pago de '+salesMoney(value)+' en este pedido?'))return;save.disabled=true;try{await api('/api/admin/orders/'+order.id+'/payments','POST',{amount:value,note:note.value});await renderOrders();}catch(e){alert(e.message);save.disabled=false;}};
     payBox.append(amount,note,save);
    }
    body.append(payBox);
   }
   const position=sectionPositions.get(order.id);
   if(position!==undefined){
    const turn=document.createElement('div');turn.textContent='N.º '+position;turn.style.cssText='font-weight:800;color:#63358e;margin:14px 0 4px 4px;font-size:16px';
    root.append(turn);
   }
   root.append(section);
  }
  const activeCard=brusaamActiveOrderId?[...root.querySelectorAll('[data-order-id]')].find(el=>el.dataset.orderId===brusaamActiveOrderId):null;
  if(activeCard&&previousCardTop!==undefined){
   window.scrollTo({top:Math.max(0,window.scrollY+activeCard.getBoundingClientRect().top-previousCardTop),behavior:'instant'});
  }else window.scrollTo({top:preservedY,behavior:'instant'});
 }catch(e){message.textContent=e.message;summary.textContent='No fue posible consultar los pedidos.';}
}
$('refreshOrders').onclick=renderOrders;


let inventoryCache={products:[],movements:[],summary:{}};
function inventoryCell(row,value){const td=document.createElement('td');td.textContent=String(value);td.style.padding='7px';td.style.borderBottom='1px solid #ddd';row.append(td);}
function renderInventory(){
 const items=inventoryCache.products||[];
 const term=($('inventorySearch').value||'').trim().toLocaleLowerCase('es');
 const tbody=$('inventoryRows');tbody.replaceChildren();
 for(const p of items.filter(p=>(p.name+' '+p.category).toLocaleLowerCase('es').includes(term))){
  const tr=document.createElement('tr');
  for(const v of [p.name,Number(p.stock)||0,Number(p.recoverable)||0,(Number(p.stock)||0)+(Number(p.recoverable)||0),money(p.cost),money(p.value)])inventoryCell(tr,v);
  tbody.append(tr);
 }
 const summary=inventoryCache.summary||{};
 $('inventorySummary').textContent='Productos: '+(summary.products||0)+' · Stock normal: '+(summary.normal||0)+' · Recuperable: '+(summary.recoverable||0)+' · Sin stock normal: '+(summary.outOfStock||0)+' · Valor disponible a costo: '+money(summary.value)+' · Pérdidas definitivas registradas: '+money(summary.lossValue);
 const hist=document.createElement('table');hist.style.width='100%';
 const head=document.createElement('tr');for(const h of ['Fecha','Producto','Movimiento','Unidades','Costo unitario','Motivo'])inventoryCell(head,h);hist.append(head);
 for(const m of inventoryCache.movements||[]){const tr=document.createElement('tr');for(const v of [new Date(m.created_at).toLocaleString('es-CL'),m.name||m.product_id,m.kind,m.quantity,money(m.cost_snapshot),m.reason])inventoryCell(tr,v);hist.append(tr);}
 $('inventoryHistory').replaceChildren(hist);
 const selects=[$('inventoryProduct'),$('inventoryRecoverProduct')];
 for(const select of selects){const prev=select.value;select.replaceChildren();for(const p of items){const o=document.createElement('option');o.value=p.id;o.textContent=p.name+' (normal: '+p.stock+', recuperable: '+p.recoverable+')';select.append(o);}if(items.some(p=>String(p.id)===prev))select.value=prev;}
}
async function loadInventory(){
 $('inventoryMessage').textContent='Consultando inventario...';
 try{inventoryCache=await api('/api/admin/inventory');renderInventory();$('inventoryMessage').textContent='Actualizado: '+new Date().toLocaleString('es-CL');}
 catch(e){$('inventoryMessage').textContent='Error: '+e.message;}
}
$('inventoryRefresh').onclick=loadInventory;
$('inventorySearch').oninput=renderInventory;
$('inventoryWasteForm').onsubmit=async e=>{
 e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;
 try{
  await api('/api/admin/inventory/movement','POST',{product_id:Number($('inventoryProduct').value),kind:$('inventoryKind').value,quantity:Number($('inventoryQty').value),reason:$('inventoryReason').value,notes:$('inventoryNotes').value});
  $('inventoryWasteForm').reset();await loadInventory();
 }catch(err){alert(err.message);}finally{btn.disabled=false;}
};
$('inventoryRecoverForm').onsubmit=async e=>{
 e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;
 try{
  await api('/api/admin/inventory/movement','POST',{product_id:Number($('inventoryRecoverProduct').value),kind:$('inventoryRecoverAction').value,quantity:Number($('inventoryRecoverQty').value),reason:$('inventoryRecoverReason').value});
  $('inventoryRecoverForm').reset();await loadInventory();
 }catch(err){alert(err.message);}finally{btn.disabled=false;}
};
$('inventoryMovementsExport').onclick=()=>{
 const rows=[['Fecha','Producto','Tipo de movimiento','Cantidad','Costo unitario registrado','Valor','Motivo','Observaciones']];
 for(const m of inventoryCache.movements||[])rows.push([new Date(m.created_at).toLocaleString('es-CL'),m.name||m.product_id,m.kind,m.quantity,m.cost_snapshot,Number(m.quantity)*Number(m.cost_snapshot),m.reason,m.notes]);
 const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='BRUSAAM_Mermas_'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
};
$('inventoryExport').onclick=()=>{
 const rows=[['ID','Producto','Categoría','Stock normal','Recuperable','Total físico','Costo unitario','Valor disponible']];
 for(const p of inventoryCache.products||[])rows.push([p.id,p.name,p.category,p.stock,p.recoverable,Number(p.stock)+Number(p.recoverable),p.cost,p.value]);
 const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='BRUSAAM_Inventario_'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
};

async function refresh() {
 data = await api('/api/admin/data');
 renderShippingSettings();
 populateManualProducts();

 $('logoUrl').value = data.logo || '';
 $('logoPreview').src = data.logo || '${BR.logo}';
 $('shopLogo').src = data.logo || '${BR.logo}';
 $('shopLogo').style.visibility = 'visible';
 $('designUrl').value = data.design || '';

 fillCategorySelects();

 renderProducts();
 renderPackSettings();
 renderCustomPacks();
 await renderOrders();
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
    (product.wholesale_group != null && (typeof product.wholesale_group !== "string" || product.wholesale_group.length > 120)) ||
    !validInteger(product.retail) ||
    !validInteger(product.wholesale) ||
    !validInteger(product.cost_with_vat || 0) ||
    !Number.isFinite(product.operating_percent ?? 20) ||
    (product.operating_percent ?? 20)<0 || (product.operating_percent ?? 20)>100 ||
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

async function saveBundleComponents(env,bundleId,raw){
 if(!Array.isArray(raw)||raw.length>40)return reply({error:'Selecciona hasta 40 productos para el pack.'},400);
 const seen=new Set(),parts=[];
 for(const r of raw){const id=Number(r.id),qty=Number(r.quantity);
  if(!Number.isSafeInteger(id)||id<=0||id===bundleId||seen.has(id)||!Number.isSafeInteger(qty)||qty<1||qty>10000)return reply({error:'Revisa productos y cantidades del pack.'},400);
  seen.add(id);parts.push({id,qty});
 }
 const product=await env.DB.prepare('SELECT id,pack_ahorro,ofertas,box_pyme FROM products WHERE id=?').bind(bundleId).first();
 if(!product||(!product.pack_ahorro&&!product.ofertas&&!product.box_pyme))return reply({error:'Solo se permiten packs en Pack Ahorro, Ofertas y Box Pyme.'},400);
 if(parts.length){
  const found=(await env.DB.prepare('SELECT id FROM products WHERE id IN ('+parts.map(()=>'?').join(',')+')').bind(...parts.map(p=>p.id)).all()).results||[];
  if(found.length!==parts.length)return reply({error:'Uno de los productos ya no existe.'},400);
  const nested=(await env.DB.prepare('SELECT bundle_id FROM shop_bundle_components WHERE bundle_id IN ('+parts.map(()=>'?').join(',')+') LIMIT 1').bind(...parts.map(p=>p.id)).first());
  if(nested)return reply({error:'No puedes incluir otro pack compuesto dentro de un pack.'},400);
 }
 const batch=[env.DB.prepare('DELETE FROM shop_bundle_components WHERE bundle_id=?').bind(bundleId),...parts.map(p=>env.DB.prepare('INSERT INTO shop_bundle_components(bundle_id,component_id,quantity) VALUES(?,?,?)').bind(bundleId,p.id,p.qty))];
 await env.DB.batch(batch);return reply({ok:true});
}
// Costos de compra con IVA incluido. Sin costo registrado, rentabilidad desconocida (NULL).
async function saleFinanceSnapshots(env, productIds){
 const ids=[...new Set(productIds.map(Number).filter(Number.isSafeInteger))];
 const result=new Map();
 for(let i=0;i<ids.length;i+=80){const chunk=ids.slice(i,i+80);
  const rows=(await env.DB.prepare('SELECT product_id,cost_with_vat,operating_percent FROM shop_product_finances WHERE product_id IN ('+chunk.map(()=>'?').join(',')+')').bind(...chunk).all()).results||[];
  for(const r of rows){const cost=Number(r.cost_with_vat),pct=Number(r.operating_percent);
   if(cost>0&&Number.isFinite(pct)&&pct>=0&&pct<=100)result.set(Number(r.product_id),{cost,pct});
  }
 }
 return result;
}
function saleCostFields(item,finances){
 const f=finances.get(Number(item.product_id??item.id));
 if(!f)return [null,null,null];
 const units=Number(item.stock_units??item.quantity);
 return [f.cost,f.pct,Math.round(f.cost*units*f.pct/100)];
}
/* V11: ventas confirmadas y presenciales. */
function validSaleAmount(value){return Number.isSafeInteger(value)&&value>=0&&value<=1000000000;}
async function confirmOrderSale(env,id,total) {
 if(!validSaleAmount(total))return reply({error:'Indica el total cobrado en pesos chilenos.'},400);
 const order=await env.DB.prepare("SELECT * FROM shop_orders WHERE id=?").bind(id).first();
 if(!order||order.status!=='pending')return reply({error:'El pedido ya no está pendiente.'},409);
 if(order.merge_state==='awaiting')return reply({error:'Pedido histórico con solicitud de unión pendiente: requiere revisión manual; la unión de pedidos está deshabilitada.'},409);
 if(order.review_state==='approved'&&Number(order.proposed_total)!==total)return reply({error:'El total debe coincidir con el pedido actualizado y aprobado.'},400);
 const pricing=await env.DB.prepare('SELECT product_subtotal,delivery_amount,expected_total,shipping_kind FROM shop_order_pricing WHERE order_id=?').bind(id).first();
 if(!pricing)return reply({error:'Pedido sin cálculo de precios validado; requiere revisión antes de confirmar.'},409);
 let confirmedQuote;try{confirmedQuote=serverShippingQuote(order,Number(pricing.product_subtotal),await readShippingSettings(env));}catch(e){return reply({error:e.message},409);}
 const expected=Number(pricing.expected_total);
 // Pedidos registrados antes de modificar tarifas conservan su importe validado.
 if(!Number.isSafeInteger(expected)||total!==expected||pricing.expected_total===null||Number(pricing.expected_total)!==expected)return reply({error:'El total no coincide con los productos y el despacho validados: $'+expected+'.'},400);

 const items=(await env.DB.prepare("SELECT * FROM shop_order_items WHERE order_id=?").bind(id).all()).results||[];
 // No confirmar pedidos sin detalle o con unidades de inventario inválidas.
 if(!items.length)return reply({error:'El pedido no tiene productos válidos para confirmar.'},409);
 const needed=new Map();
 for(const item of items){
  const pid=Number(item.product_id),units=Number(item.stock_units),qty=Number(item.quantity);
  if(!Number.isSafeInteger(pid)||pid<=0||!Number.isSafeInteger(units)||units<=0||!Number.isSafeInteger(qty)||qty<=0)
   return reply({error:'El pedido contiene cantidades inválidas; revisa el detalle antes de confirmar.'},409);
  // En venta por unidad, cantidad comercial y descuento de inventario son idénticos.
  if(String(item.kind)==='unidad'&&units!==qty)
   return reply({error:'El stock de un producto por unidad no coincide con su cantidad solicitada.'},409);
  const sum=(needed.get(pid)||0)+units;
  if(!Number.isSafeInteger(sum))return reply({error:'La cantidad total de productos excede el límite permitido.'},409);
  needed.set(pid,sum);
 }
 // Un pedido confirmado debe corresponder a una cotización comercial validada.
 const commercial=(await env.DB.prepare('SELECT product_id,kind,quantity,validated_line_total FROM shop_order_commercial_lines WHERE order_id=?').bind(id).all()).results||[];
 if(!commercial.length||commercial.some(line=>!Number.isSafeInteger(Number(line.quantity))||Number(line.quantity)<=0||!Number.isSafeInteger(Number(line.validated_line_total))||Number(line.validated_line_total)<0))
  return reply({error:'El detalle comercial no está validado; revisa el pedido antes de confirmar.'},409);
 // Cada línea comercial debe corresponder exactamente a una línea de inventario.
 // Evita confirmar una venta con cantidades comerciales distintas de las que
 // se descontarán del stock (incluidas mangas y packs).
 const itemKeys=new Map();
 for(const item of items){
  const key=String(item.product_id)+'|'+String(item.kind);
  if(itemKeys.has(key))return reply({error:'El pedido contiene líneas de inventario duplicadas.'},409);
  itemKeys.set(key,Number(item.quantity));
 }
 const commercialKeys=new Set();
 for(const line of commercial){
  const key=String(line.product_id)+'|'+String(line.kind);
  if(commercialKeys.has(key)||!itemKeys.has(key)||itemKeys.get(key)!==Number(line.quantity))
   return reply({error:'Las cantidades comerciales no coinciden con el inventario del pedido; revisa antes de confirmar.'},409);
  commercialKeys.add(key);
 }
 if(commercialKeys.size!==itemKeys.size)
  return reply({error:'Faltan productos en el detalle comercial validado.'},409);
 const commercialSubtotal=commercial.reduce((sum,line)=>sum+Number(line.validated_line_total),0);
 if(!Number.isSafeInteger(commercialSubtotal)||commercialSubtotal!==Number(pricing.product_subtotal))
  return reply({error:'El subtotal de productos no coincide con el detalle comercial validado.'},409);
 // Validar coherencia básica de cobros antes de crear venta y descontar inventario.
 const delivery=Number(pricing.delivery_amount);
 if(!Number.isSafeInteger(delivery)||delivery<0||!Number.isSafeInteger(expected)||expected<0)
  return reply({error:'El despacho o total del pedido no es válido.'},409);
 const saleId=crypto.randomUUID(),now=Date.now();
 const financeSnapshots=await saleFinanceSnapshots(env,items.map(x=>x.product_id));
 const batch=[
  env.DB.prepare("UPDATE shop_orders SET status='confirmed',stock_reserved=0 WHERE id=? AND status='pending'").bind(id),
  env.DB.prepare("INSERT INTO shop_stock_guard(value) SELECT changes()"),
  env.DB.prepare("DELETE FROM shop_stock_guard"),
  env.DB.prepare("INSERT INTO shop_sales(id,order_id,created_at,source,customer,payment_method,total,notes) VALUES(?,?,?,'online',?,?,?,?)").bind(saleId,id,now,order.customer,order.payment_method,total,order.notes)
 ];
 // Los pedidos anteriores a V13 ya descontaron el inventario al registrarse.
 if(Number(order.stock_reserved)!==1)
  for(const [pid,units] of needed){
   batch.push(env.DB.prepare("UPDATE products SET stock=stock-? WHERE id=? AND active=1 AND stock>=?").bind(units,pid,units));
   batch.push(env.DB.prepare("INSERT INTO shop_stock_guard(value) SELECT changes()"));
   batch.push(env.DB.prepare("DELETE FROM shop_stock_guard"));
  }
 // Conservar el detalle de importes validados para Finanzas.
 // Para mangas y packs, la cantidad de venta corresponde a unidades de inventario;
 // el importe comercial corresponde a la línea completa del pedido.
 const commercialByKey=new Map(commercial.map(line=>[String(line.product_id)+'|'+String(line.kind),line]));
 for(const item of items){
  const [cost,pct,expense]=saleCostFields(item,financeSnapshots);
  const line=commercialByKey.get(String(item.product_id)+'|'+String(item.kind));
  const amount=Number(line.validated_line_total);
  // Un precio unitario exacto solo existe si el importe se divide sin fracciones.
  // No inventar un precio por unidad de inventario para packs o mangas.
  const unit=String(item.kind)==='unidad'&&amount%Number(item.quantity)===0?amount/Number(item.quantity):null;
  batch.push(env.DB.prepare("INSERT INTO shop_sale_items(sale_id,product_id,product_name,quantity,unit_price,line_total,cost_snapshot,operating_percent_snapshot,estimated_expense_snapshot) VALUES(?,?,?,?,?,?,?,?,?)").bind(saleId,item.product_id,item.product_name,item.stock_units,unit,amount,cost,pct,expense));
 }
 try{await env.DB.batch(batch);return reply({ok:true,sale_id:saleId});}
 catch(e){console.error('Error al confirmar venta',e);return reply({error:'No se pudo confirmar: revisa el stock disponible y el estado del pedido.'},409);}
}
async function manualSale(env,body){
 const total=Number(body?.total),payment=cleanOrderText(body?.payment_method,50),customer=cleanOrderText(body?.customer,160),notes=cleanOrderText(body?.notes,500);
 if(!validSaleAmount(total)||!['Efectivo','Transferencia','Tarjeta Débito/Crédito'].includes(payment))return reply({error:'Monto o método de pago inválido.'},400);
 const input=body?.items||[];if(!Array.isArray(input)||input.length>30)return reply({error:'Detalle inválido.'},400);
 const items=[];const needed=new Map();
 for(const line of input){const id=Number(line.id),quantity=Number(line.quantity),price=Number(line.unit_price);if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(quantity)||quantity<=0||!validSaleAmount(price))return reply({error:'Producto, cantidad o precio inválido.'},400);items.push({id,quantity,price});}
 if(items.length&&items.reduce((n,x)=>n+x.quantity*x.price,0)!==total)return reply({error:'El total debe coincidir con cantidad × precio unitario.'},400);
 const ids=items.map(x=>x.id),products=new Map();
 if(ids.length){const result=await env.DB.prepare('SELECT id,name,stock FROM products WHERE id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all();for(const p of result.results||[])products.set(p.id,p);}
 const componentRows=ids.length?(await env.DB.prepare('SELECT bundle_id,component_id,quantity FROM shop_bundle_components WHERE bundle_id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all()).results||[]:[];
 const componentMap=new Map();for(const row of componentRows){if(!componentMap.has(row.bundle_id))componentMap.set(row.bundle_id,[]);componentMap.get(row.bundle_id).push(row);}
 const componentIds=[...new Set(componentRows.map(r=>r.component_id))];
 if(componentIds.length){const result=await env.DB.prepare('SELECT id,name,stock FROM products WHERE id IN ('+componentIds.map(()=>'?').join(',')+')').bind(...componentIds).all();for(const p of result.results||[])products.set(p.id,p);}
 const saleItems=[];
 for(const item of items){
  if(!products.has(item.id))return reply({error:'Producto no disponible.'},409);
  const parts=componentMap.get(item.id)||[];
  if(parts.length){
   if(Number(products.get(item.id).stock)<item.quantity)return reply({error:'Límite de packs disponibles.'},409);
   for(const part of parts){const units=item.quantity*Number(part.quantity);needed.set(part.component_id,(needed.get(part.component_id)||0)+units);saleItems.push({id:part.component_id,quantity:units,price:null});}
  }else{needed.set(item.id,(needed.get(item.id)||0)+item.quantity);saleItems.push(item);}
 }
 for(const [id,quantity] of needed){if(!products.has(id)||Number(products.get(id).stock)<quantity)return reply({error:'Stock insuficiente para la venta presencial.'},409);}
 const financeSnapshots=await saleFinanceSnapshots(env,saleItems.map(x=>x.id));
 const saleId=crypto.randomUUID(),now=Date.now(),batch=[env.DB.prepare("INSERT INTO shop_sales(id,order_id,created_at,source,customer,payment_method,total,notes) VALUES(?,NULL,?,'presencial',?,?,?,?)").bind(saleId,now,customer,payment,total,notes)];
 for(const [id,quantity] of needed){batch.push(env.DB.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').bind(quantity,id,quantity));batch.push(env.DB.prepare('INSERT INTO shop_stock_guard(value) SELECT changes()'));batch.push(env.DB.prepare('DELETE FROM shop_stock_guard'));}
 for(const item of saleItems){const [cost,pct,expense]=saleCostFields(item,financeSnapshots);
  batch.push(env.DB.prepare('INSERT INTO shop_sale_items(sale_id,product_id,product_name,quantity,unit_price,line_total,cost_snapshot,operating_percent_snapshot,estimated_expense_snapshot) VALUES(?,?,?,?,?,?,?,?,?)').bind(saleId,item.id,products.get(item.id).name,item.quantity,item.price,item.price===null?null:item.quantity*item.price,cost,pct,expense));
 }
 try{await env.DB.batch(batch);return reply({ok:true,id:saleId});}catch(e){console.error('Error al registrar venta presencial',e);return reply({error:'No se pudo registrar la venta; verifica stock y reintenta.'},409);}
}
function chileDateParts(timestamp){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp));
 const get=k=>parts.find(p=>p.type===k).value;return get('year')+'-'+get('month')+'-'+get('day');
}
async function salesReport(env,url){
 const period=url.searchParams.get('period')||'day',date=url.searchParams.get('date')||chileDateParts(Date.now());
 if(!['day','week','month','custom'].includes(period)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z')))return reply({error:'Fecha o período inválido.'},400);
 const base=new Date(date+'T12:00:00Z');if(base.toISOString().slice(0,10)!==date)return reply({error:'Fecha inválida.'},400);
 const from=new Date(base);if(period==='week'){const offset=(from.getUTCDay()+6)%7;from.setUTCDate(from.getUTCDate()-offset);}if(period==='month')from.setUTCDate(1);
 const until=new Date(from);if(period==='day')until.setUTCDate(until.getUTCDate()+1);if(period==='week')until.setUTCDate(until.getUTCDate()+7);if(period==='month')until.setUTCMonth(until.getUTCMonth()+1);
 if(period==='custom'){const a=url.searchParams.get('from')||'',b=url.searchParams.get('to')||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(a)||!/^\d{4}-\d{2}-\d{2}$/.test(b))return reply({error:'Selecciona ambas fechas.'},400);const start=new Date(a+'T12:00:00Z'),end=new Date(b+'T12:00:00Z');if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start.toISOString().slice(0,10)!==a||end.toISOString().slice(0,10)!==b||start>end||(end.getTime()-start.getTime())>366*86400000)return reply({error:'Rango inválido o superior a 366 días.'},400);from.setTime(start.getTime());until.setTime(end.getTime()+86400000);}
 const first=from.toISOString().slice(0,10),last=new Date(until.getTime()-86400000).toISOString().slice(0,10);
 // Consulta acotada y filtrado por día civil de Chile para respetar cambios de horario de verano.
 const low=Date.parse(first+'T00:00:00Z')-24*3600000,high=Date.parse(until.toISOString().slice(0,10)+'T00:00:00Z')+24*3600000;
 const candidates=(await env.DB.prepare('SELECT * FROM shop_sales WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 10000').bind(low,high).all()).results||[];
 const sales=candidates.filter(x=>{const d=chileDateParts(x.created_at);return d>=first&&d<=last;});
 const ids=sales.map(x=>x.id),products=new Map();
 let costTotal=0,expenseTotal=0,missingCostLines=0,knownUnits=0;
 for(let i=0;i<ids.length;i+=75){const chunk=ids.slice(i,i+75);
  const rows=(await env.DB.prepare('SELECT * FROM shop_sale_items WHERE sale_id IN ('+chunk.map(()=>'?').join(',')+')').bind(...chunk).all()).results||[];
  for(const item of rows){const key=String(item.product_id??'')+'|'+item.product_name;
   const entry=products.get(key)||{product_name:item.product_name,quantity:0,amount:0,unknown:false,cost:0,expenses:0,missing:0};
   entry.quantity+=Number(item.quantity);
   if(item.line_total===null)entry.unknown=true;else entry.amount+=Number(item.line_total);
   if(item.cost_snapshot===null||item.cost_snapshot===undefined||Number(item.cost_snapshot)<=0){entry.missing+=Number(item.quantity);missingCostLines++;}
   else{const c=Number(item.cost_snapshot)*Number(item.quantity),e=Number(item.estimated_expense_snapshot??Math.round(c*Number(item.operating_percent_snapshot||0)/100));entry.cost+=c;entry.expenses+=e;costTotal+=c;expenseTotal+=e;knownUnits+=Number(item.quantity);}
   products.set(key,entry);
  }
 }
 const total=sales.reduce((n,x)=>n+Number(x.total),0),units=[...products.values()].reduce((n,x)=>n+x.quantity,0);
 // Los totales de ventas online pueden incluir despacho. No se presenta como utilidad de productos.
 let shippingKnown=0,shippingUnknown=0;
 const onlineOrderIds=sales.filter(x=>x.source==='online'&&x.order_id).map(x=>x.order_id);
 for(let i=0;i<onlineOrderIds.length;i+=75){const chunk=onlineOrderIds.slice(i,i+75);
  const rows=(await env.DB.prepare('SELECT order_id,delivery_amount FROM shop_order_pricing WHERE order_id IN ('+chunk.map(()=>'?').join(',')+')').bind(...chunk).all()).results||[];
  const byId=new Map(rows.map(x=>[x.order_id,x]));for(const id of chunk){const r=byId.get(id);if(r&&r.delivery_amount!==null)shippingKnown+=Number(r.delivery_amount);else shippingUnknown++;}
 }
 const unknownRevenueLines=[...products.values()].filter(x=>x.unknown).length;
 const complete=missingCostLines===0&&shippingUnknown===0&&units>0;
 const productRevenue=shippingUnknown?null:total-shippingKnown;
 const profit=complete?productRevenue-costTotal-expenseTotal:null;
 return reply({from:first,to:last,period,count:sales.length,total,units,average:sales.length?Math.round(total/sales.length):0,sales,
  finance:{complete,product_revenue:productRevenue,shipping_collected:shippingKnown,shipping_unknown:shippingUnknown,cost:costTotal,expenses:expenseTotal,profit,margin:complete&&productRevenue>0?Math.round(profit/productRevenue*10000)/100:null,missing_cost_lines:missingCostLines,known_units:knownUnits,unknown_revenue_lines:unknownRevenueLines},
  products:[...products.values()].map(x=>({product_name:x.product_name,quantity:x.quantity,amount:x.unknown?null:x.amount,cost:x.missing?null:x.cost,expenses:x.missing?null:x.expenses,profit:x.missing||x.unknown?null:x.amount-x.cost-x.expenses,missing_cost_units:x.missing})).sort((a,b)=>b.quantity-a.quantity)});
}

/* SERVIDOR CLOUDFLARE WORKERS */

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(initialize(env));
  },
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

      if (path === '/api/orders/status' && method === 'GET') {
        await initialize(env);
        const id=new URL(request.url).searchParams.get('id')||'';
        if(!/^[a-f0-9-]{36}$/i.test(id))return reply({error:'Pedido inválido'},400);
        const order=await env.DB.prepare('SELECT status FROM shop_orders WHERE id=?').bind(id).first();
        return order?reply({status:order.status}):reply({error:'Pedido no encontrado'},404);
      }

      if (path === '/api/orders/reserve' && method === 'POST') {
        if (!checkOrigin(request)) return reply({error:'Origen no permitido'},403);
        await initialize(env);
        const body=await request.json().catch(()=>null);
        return registerOrder(env,body);
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

      // Las tablas de configuración deben existir también en el primer acceso al panel.
      await initialize(env);
      if(path==='/api/admin/shipping-sector'&&(method==='POST'||method==='PUT')){
       if(!checkOrigin(request))return reply({error:'Origen no permitido'},403);
       const body=await request.json().catch(()=>null),name=String(body?.name||'').trim(),price=body?.price,commune=String(body?.commune||'');
       if(name.length<2||name.length>90||!Number.isSafeInteger(price)||price<0||price>100000||!['la serena','coquimbo'].includes(commune))return reply({error:'Nombre, comuna o tarifa inválidos.'},400);
       const current=await readShippingSettings(env),list=current.customSectors||[];
       if(method==='POST'){
        if(list.length>=60)return reply({error:'Límite de sectores alcanzado.'},409);
        const id='sector_'+crypto.randomUUID().replace(/-/g,'').slice(0,16);
        list.push({id,name,price,commune,enabled:true});
       }else{
        const sector=list.find(x=>x.id===body?.id);
        if(!sector)return reply({error:'Sector no encontrado.'},404);
        sector.name=name;sector.price=price;sector.commune=commune;sector.enabled=body.enabled===true;
       }
       const clean=safeShippingSettings({...current,customSectors:list});
       await env.DB.prepare("INSERT INTO shop_settings(key,value) VALUES('shipping_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(clean)).run();
       return reply({ok:true,shippingSettings:clean});
      }
      if(path==='/api/admin/shipping-settings'&&method==='PUT'){
        if(!checkOrigin(request))return reply({error:'Origen no permitido'},403);
        const body=await request.json().catch(()=>null);
        if(!body||!Number.isSafeInteger(body.freeThreshold)||body.freeThreshold<0||body.freeThreshold>10000000||!body.rates||typeof body.rates!=='object')return reply({error:'Monto mínimo inválido'},400);
        for(const key of Object.keys(SHIPPING_DEFAULTS.rates))if(!Number.isSafeInteger(body.rates[key])||body.rates[key]<0||body.rates[key]>100000)return reply({error:'Tarifa inválida: '+key},400);
        // Guardar tarifas generales no debe borrar los sectores personalizados
        // aunque un cliente administrador tenga abierta una pestaña antigua.
        const previous=await readShippingSettings(env);
        const clean=safeShippingSettings({...body,customSectors:previous.customSectors});
        await env.DB.prepare("INSERT INTO shop_settings(key,value) VALUES('shipping_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(clean)).run();
        return reply({ok:true,shippingSettings:clean});
      }

      /* SUBIR IMÁGENES */

      if (
        path === "/api/admin/upload" &&
        method === "POST"
      ) {
        return uploadImage(request, env);
      }

      // BRUSAAM V32: comprobante imprimible, dos copias, acceso solo con sesión de administración.
      const receiptMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/receipt$/i);
      if(receiptMatch&&method==='GET'){
        const id=receiptMatch[1];
        const order=await env.DB.prepare('SELECT * FROM shop_orders WHERE id=?').bind(id).first();
        const sale=await env.DB.prepare("SELECT total FROM shop_sales WHERE order_id=? AND source='online'").bind(id).first();
        const pricing=await env.DB.prepare('SELECT * FROM shop_order_pricing WHERE order_id=?').bind(id).first();
        if(!order||order.status!=='confirmed'||Number(order.stock_reserved)!==0||!sale||!pricing||!Number.isSafeInteger(Number(sale.total))||Number(sale.total)!==Number(pricing.expected_total))
          return reply({error:'Solo se imprimen pedidos confirmados, descontados y con venta y precios validados.'},409);
        const lines=(await env.DB.prepare('SELECT product_name,quantity,kind,validated_line_total FROM shop_order_commercial_lines WHERE order_id=? ORDER BY rowid').bind(id).all()).results||[];
        if(!lines.length||lines.some(x=>!Number.isSafeInteger(Number(x.validated_line_total))||Number(x.validated_line_total)<0))return reply({error:'Este pedido no tiene detalle de precios completo para imprimir.'},409);
        const escapeReceipt=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const peso=x=>'$'+Number(x).toLocaleString('es-CL');
        const rows=lines.map(l=>{
          const qty=Number(l.quantity),total=Number(l.validated_line_total);
          const unit=qty>0&&total%qty===0?peso(total/qty):'Incluido en promoción';
          return '<tr><td>'+escapeReceipt(l.product_name)+'<div class="minor">'+qty+' '+escapeReceipt(l.kind)+'(s) · Unitario: '+unit+'</div></td><td class="right">'+peso(total)+'</td></tr>';
        }).join('');
        const date=new Date(Number(order.created_at)).toLocaleString('es-CL',{timeZone:'America/Santiago'});
        const address=[order.address,order.commune,order.region].filter(Boolean).join(', ');
        const delivery=order.delivery_method==='pickup'?'Retiro en tienda':'Despacho a domicilio';
        const shipping=pricing.shipping_kind==='collect'?'Por pagar (no incluido)':peso(pricing.delivery_amount||0);
        const ticket=(copy)=>'<article class="ticket"><header><h1>BRUSAAM</h1><div>La excelencia en tu hogar</div><h2>COMPROBANTE DE PEDIDO</h2><div>N.º '+escapeReceipt(order.public_code||id.slice(0,8).toUpperCase())+'</div><div>'+escapeReceipt(date)+'</div><strong>'+copy+'</strong></header><hr><p><b>Cliente:</b> '+escapeReceipt(order.customer)+'</p><p><b>Entrega:</b> '+escapeReceipt(delivery)+'</p>'+(address?'<p><b>Dirección:</b> '+escapeReceipt(address)+'</p>':'')+(order.delivery_sector?'<p><b>Sector:</b> '+escapeReceipt(SHIPPING_LABELS[order.delivery_sector]||order.delivery_sector)+'</p>':'')+'<p><b>Pago:</b> '+escapeReceipt(order.payment_method)+'</p><hr><table><thead><tr><th>Producto / cantidad</th><th class="right">Importe</th></tr></thead><tbody>'+rows+'</tbody></table><hr><div class="totalrow"><span>Subtotal</span><b>'+peso(pricing.product_subtotal)+'</b></div><div class="totalrow"><span>Despacho</span><b>'+shipping+'</b></div><div class="totalrow grand"><span>TOTAL</span><b>'+peso(sale.total)+'</b></div>'+(order.notes?'<p><b>Observaciones:</b> '+escapeReceipt(order.notes)+'</p>':'')+'<footer>¡Gracias por preferir BRUSAAM!<div class="minor">Comprobante de pedido; no reemplaza la boleta tributaria.</div></footer></article>';
        const html='<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BRUSAAM · Pedido '+escapeReceipt(order.public_code||id.slice(0,8).toUpperCase())+'</title><style>@page{size:A5 portrait;margin:8mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#111;background:#eee;margin:0}.tools{padding:14px;text-align:center;background:white;position:sticky;top:0}.tools button,.tools select{padding:9px;margin:3px}.ticket{background:white;max-width:148mm;min-height:190mm;margin:14px auto;padding:10mm;break-after:page;page-break-after:always}.ticket:last-child{break-after:auto;page-break-after:auto}header,footer{text-align:center}h1{font-size:25px;margin:0}h2{font-size:14px;margin:12px 0 6px}p{margin:6px 0;overflow-wrap:anywhere}hr{border:0;border-top:1px dashed #888;margin:12px 0}table{width:100%;border-collapse:collapse}td,th{padding:7px 2px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{font-size:11px}.right{text-align:right;white-space:nowrap}.minor{font-size:10px;color:#444;margin-top:3px}.totalrow{display:flex;justify-content:space-between;gap:10px;margin:8px 0}.grand{font-size:17px;border-top:2px solid;padding-top:10px}footer{margin-top:22px}.ticket{overflow-wrap:anywhere}@media print{body{background:white}.tools{display:none}.ticket{margin:0 auto;box-shadow:none;min-height:0;padding:3mm 0;max-width:100%}body.thermal .ticket{width:100%;padding:2mm 0;break-after:page;page-break-after:always}body.thermal h1{font-size:20px}body.thermal{font-size:10px}}@media screen{.ticket{box-shadow:0 2px 10px #bbb}} </style><style id="pageFormat"></style></head><body><div class="tools"><label>Tamaño: <select id="paper"><option value="a5">Media hoja A4 (A5)</option><option value="80">Ticket térmico 80 mm</option><option value="58">Ticket térmico 58 mm</option></select></label><button type="button" onclick="window.print()">Imprimir las 2 copias</button><p>Selecciona el mismo tamaño de papel en las preferencias de la impresora.</p></div>'+ticket('COPIA 1 · PREPARACIÓN')+ticket('COPIA 2 · CLIENTE')+'<script>document.getElementById("paper").onchange=function(){var t=this.value;document.body.classList.toggle("thermal",t!=="a5");document.getElementById("pageFormat").textContent=t==="a5"?"":"@page{size:"+t+"mm auto;margin:2mm}"};<\/script></body></html>';
        return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"}});
      }

      /* PEDIDOS V13: descuento únicamente al confirmar */
      if (path === '/api/admin/orders' && method === 'GET') {
        const orders=(await env.DB.prepare('SELECT * FROM shop_orders ORDER BY created_at DESC LIMIT 250').all()).results || [];
        const items=(await env.DB.prepare('SELECT * FROM shop_order_items WHERE order_id IN (SELECT id FROM shop_orders ORDER BY created_at DESC LIMIT 250)').all()).results || [];
        const commercial=(await env.DB.prepare('SELECT * FROM shop_order_commercial_lines WHERE order_id IN (SELECT id FROM shop_orders ORDER BY created_at DESC LIMIT 250)').all()).results || [];
        const pricing=(await env.DB.prepare('SELECT * FROM shop_order_pricing WHERE order_id IN (SELECT id FROM shop_orders ORDER BY created_at DESC LIMIT 250)').all()).results || [];
        const sales=(await env.DB.prepare("SELECT order_id,total,created_at FROM shop_sales WHERE source='online' AND order_id IN (SELECT id FROM shop_orders ORDER BY created_at DESC LIMIT 250)").all()).results || [];
        const payments=(await env.DB.prepare('SELECT id,order_id,amount,paid_at,note FROM shop_order_payments WHERE order_id IN (SELECT id FROM shop_orders ORDER BY created_at DESC LIMIT 250) ORDER BY paid_at,id').all()).results||[];
        const holidays=await env.DB.prepare("SELECT value FROM shop_settings WHERE key='holiday_dates'").first();
        return reply({orders,items,commercial,pricing,sales,payments,holidays:JSON.parse(holidays?.value||'[]')});
      }
      // Modificación auditada del despacho por pedido, sin alterar tarifas globales.
      const shippingAdjustmentMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/shipping-adjustment$/i);
      if(shippingAdjustmentMatch&&method==='POST'){
       if(!checkOrigin(request))return reply({error:'Origen no permitido'},403);
       const id=shippingAdjustmentMatch[1],body=await request.json().catch(()=>null);
       const amount=body?.amount,reason=cleanOrderText(body?.reason,180);
       if(!Number.isSafeInteger(amount)||amount<0||amount>100000||!reason)return reply({error:'Monto o motivo inválido.'},400);
       const order=await env.DB.prepare('SELECT * FROM shop_orders WHERE id=?').bind(id).first();
       if(!order||!['pending','confirmed'].includes(order.status)||order.delivery_method!=='delivery'||Number(order.dispatched_at)>0||Number(order.delivered_at)>0)return reply({error:'Solo se puede modificar el despacho de pedidos a domicilio no despachados.'},409);
       const pricing=await env.DB.prepare('SELECT * FROM shop_order_pricing WHERE order_id=?').bind(id).first();
       if(!pricing||!Number.isSafeInteger(Number(pricing.product_subtotal))||Number(pricing.product_subtotal)<0)return reply({error:'No se encontró una cotización válida.'},409);
       const total=Number(pricing.product_subtotal)+amount;
       if(!Number.isSafeInteger(total)||total>100000000)return reply({error:'Total inválido.'},409);
       const audit='Despacho manual: $'+Number(pricing.delivery_amount||0)+' → $'+amount+'. Motivo: '+reason+'; fecha '+new Date().toISOString();
       try{
        const batch=[env.DB.prepare("UPDATE shop_order_pricing SET delivery_amount=?,expected_total=?,shipping_kind='manual_adjustment',validated_at=?,pricing_version=? WHERE order_id=?").bind(amount,total,Date.now(),'v32-manual-shipping',id),env.DB.prepare("UPDATE shop_orders SET exceptional_wholesale_note=substr(COALESCE(exceptional_wholesale_note,'') || char(10) || ?,1,2000) WHERE id=?").bind(audit,id)];
        if(order.status==='confirmed'){
         const sale=await env.DB.prepare("SELECT total FROM shop_sales WHERE order_id=? AND source='online'").bind(id).first();
         if(!sale)return reply({error:'El pedido confirmado no tiene una venta asociada; requiere revisión antes de modificar.'},409);
         batch.push(env.DB.prepare("UPDATE shop_sales SET total=? WHERE order_id=? AND source='online'").bind(total,id));
        }
        await env.DB.batch(batch);
        return reply({ok:true,total,delivery_amount:amount});
       }catch(e){return reply({error:'No se pudo actualizar el despacho.'},409);}
      }
      // Cambio auditado del precio de una línea, independiente del catálogo.
      const linePriceMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/line-price-adjustment$/i);
      if(linePriceMatch&&method==='POST'){
       if(!checkOrigin(request))return reply({error:'Origen no permitido'},403);
       const id=linePriceMatch[1],body=await request.json().catch(()=>null);
       const productId=Number(body?.product_id),kind=String(body?.kind||''),unit=body?.unit_price,reason=cleanOrderText(body?.reason,180);
       if(!Number.isSafeInteger(productId)||productId<1||!['unidad','manga','pack'].includes(kind)||!Number.isSafeInteger(unit)||unit<0||unit>10000000||!reason)return reply({error:'Producto, precio o motivo inválido.'},400);
       const order=await env.DB.prepare('SELECT * FROM shop_orders WHERE id=?').bind(id).first();
       if(!order||!['pending','confirmed'].includes(order.status)||Number(order.dispatched_at)>0||Number(order.delivered_at)>0||Number(order.pickup_ready_at)>0)return reply({error:'El pedido ya no admite cambios de precio.'},409);
       const line=await env.DB.prepare('SELECT * FROM shop_order_commercial_lines WHERE order_id=? AND product_id=? AND kind=?').bind(id,productId,kind).first();
       const pricing=await env.DB.prepare('SELECT * FROM shop_order_pricing WHERE order_id=?').bind(id).first();
       if(!line||!pricing)return reply({error:'No se encontró el detalle de precio del pedido.'},409);
       const newLineTotal=unit*Number(line.quantity);
       const subtotal=Number(pricing.product_subtotal)-Number(line.validated_line_total)+newLineTotal;
       const total=subtotal+Number(pricing.delivery_amount||0);
       if(!Number.isSafeInteger(newLineTotal)||!Number.isSafeInteger(subtotal)||subtotal<0||!Number.isSafeInteger(total)||total<0||total>100000000)return reply({error:'El nuevo total supera los límites permitidos.'},400);
       let saleLine=null;
       if(order.status==='confirmed'){
        if(kind!=='unidad')return reply({error:'Para proteger Finanzas, los cambios de precios confirmados de mangas y packs requieren revisión manual.'},409);
        const saleRow=await env.DB.prepare("SELECT id FROM shop_sales WHERE order_id=? AND source='online'").bind(id).first();
        if(!saleRow)return reply({error:'Falta la venta asociada.'},409);
        const saleLines=(await env.DB.prepare('SELECT rowid,quantity,line_total FROM shop_sale_items WHERE sale_id=? AND product_id=?').bind(saleRow.id,productId).all()).results||[];
        if(saleLines.length!==1||Number(saleLines[0].quantity)!==Number(line.quantity)||(saleLines[0].line_total!==null&&Number(saleLines[0].line_total)!==Number(line.validated_line_total)))return reply({error:'El detalle contable no coincide con el pedido; requiere revisión manual.'},409);
        saleLine=saleLines[0];
        const sale=await env.DB.prepare("SELECT total FROM shop_sales WHERE order_id=? AND source='online'").bind(id).first();
        if(!sale)return reply({error:'Falta la venta asociada; revisa el pedido antes de modificar.'},409);
       }
       const audit='Precio manual '+line.product_name+' ('+kind+'): $'+line.validated_unit_price+' → $'+unit+'. Motivo: '+reason+'; fecha '+new Date().toISOString();
       const batch=[
        env.DB.prepare("UPDATE shop_order_commercial_lines SET validated_unit_price=?,validated_line_total=?,price_rule='precio_manual_pedido' WHERE order_id=? AND product_id=? AND kind=?").bind(unit,newLineTotal,id,productId,kind),
        env.DB.prepare("UPDATE shop_order_pricing SET product_subtotal=?,expected_total=?,validated_at=?,pricing_version=? WHERE order_id=?").bind(subtotal,total,Date.now(),'v32-line-price-manual',id),
        env.DB.prepare("UPDATE shop_orders SET exceptional_wholesale_note=substr(COALESCE(exceptional_wholesale_note,'') || char(10) || ?,1,2000) WHERE id=?").bind(audit,id)
       ];
       if(order.status==='confirmed'){
        batch.push(env.DB.prepare("UPDATE shop_sales SET total=? WHERE order_id=? AND source='online'").bind(total,id));
        batch.push(env.DB.prepare('UPDATE shop_sale_items SET unit_price=?,line_total=? WHERE rowid=?').bind(unit,newLineTotal,saleLine.rowid));
       }
       try{await env.DB.batch(batch);return reply({ok:true,subtotal,total});}catch(e){return reply({error:'No se pudo guardar el cambio de precio.'},409);}
      }
      const stockImpactMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/stock-impact$/i);
      if(stockImpactMatch&&method==='GET'){
       const id=stockImpactMatch[1];
       const order=await env.DB.prepare('SELECT id,status,stock_reserved FROM shop_orders WHERE id=?').bind(id).first();
       if(!order)return reply({error:'Pedido no encontrado.'},404);
       const items=(await env.DB.prepare('SELECT product_id,product_name,stock_units FROM shop_order_items WHERE order_id=?').bind(id).all()).results||[];
       const grouped=new Map();
       for(const item of items){
        const key=Number(item.product_id);
        const old=grouped.get(key)||{product_id:key,name:String(item.product_name||'Producto'),units:0};
        old.units+=Number(item.stock_units||0);grouped.set(key,old);
       }
       const output=[];
       for(const row of grouped.values()){
        const product=await env.DB.prepare('SELECT stock FROM products WHERE id=?').bind(row.product_id).first();
        const available=Number(product?.stock||0);
        output.push({...row,available,sufficient:available>=row.units});
       }
       return reply({ok:true,stock_already_deducted:order.status==='confirmed',legacy_stock_reserved:Number(order.stock_reserved)===1,items:output});
      }
      const unitQuantityMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/unit-quantity-adjustment$/i);
      if(unitQuantityMatch&&method==='POST'){
       if(!checkOrigin(request))return reply({error:'Origen no permitido.'},403);
       const id=unitQuantityMatch[1],body=await request.json().catch(()=>null);
       const pid=Number(body?.product_id),qty=body?.new_quantity,expected=body?.expected_quantity,reason=cleanOrderText(body?.reason,180);
       if(!Number.isSafeInteger(pid)||pid<1||!Number.isSafeInteger(qty)||qty<1||qty>100000||!Number.isSafeInteger(expected)||expected<1||!reason)return reply({error:'Cantidad, producto o motivo inválido.'},400);
       const order=await env.DB.prepare('SELECT * FROM shop_orders WHERE id=?').bind(id).first();
       if(!order||order.status!=='confirmed'||Number(order.stock_reserved)===1||Number(order.dispatched_at)>0||Number(order.delivered_at)>0||Number(order.pickup_ready_at)>0)return reply({error:'Este pedido no permite modificar cantidades.'},409);
       const items=(await env.DB.prepare('SELECT * FROM shop_order_items WHERE order_id=? AND product_id=?').bind(id,pid).all()).results||[];
       const lines=(await env.DB.prepare('SELECT * FROM shop_order_commercial_lines WHERE order_id=? AND product_id=?').bind(id,pid).all()).results||[];
       if(items.length!==1||lines.length!==1||items[0].kind!=='unidad'||lines[0].kind!=='unidad'||Number(items[0].stock_units)!==Number(items[0].quantity)||Number(lines[0].quantity)!==expected||Number(items[0].quantity)!==expected)return reply({error:'Solo se admiten unidades simples sin presentaciones combinadas.'},409);
       const price=Number(lines[0].validated_unit_price),oldTotal=Number(lines[0].validated_line_total);
       if(!Number.isSafeInteger(price)||price<0||oldTotal!==price*expected)return reply({error:'El precio de la línea requiere revisión manual.'},409);
       const pricing=await env.DB.prepare('SELECT * FROM shop_order_pricing WHERE order_id=?').bind(id).first();
       const sale=await env.DB.prepare("SELECT id,total FROM shop_sales WHERE order_id=? AND source='online'").bind(id).first();
       const saleItems=(await env.DB.prepare('SELECT rowid,quantity,unit_price,line_total FROM shop_sale_items WHERE sale_id=? AND product_id=?').bind(sale?.id||'',pid).all()).results||[];
       if(!pricing||!sale||saleItems.length!==1||Number(saleItems[0].quantity)!==expected)return reply({error:'El inventario o la venta necesitan revisión antes del cambio.'},409);
       // La venta puede guardar precios unitarios nulos (costo congelado) o importes explícitos.
       // Si tiene importe explícito, no sobrescribirlo a ciegas si difiere del precio del pedido.
       if(saleItems[0].line_total!==null&&Number(saleItems[0].line_total)!==oldTotal)return reply({error:'La línea contable no coincide con el pedido. Requiere revisión manual.'},409);
       const delta=qty-expected,newLineTotal=qty*price,newSubtotal=Number(pricing.product_subtotal)+delta*price,newTotal=newSubtotal+Number(pricing.delivery_amount||0);
       if(![newLineTotal,newSubtotal,newTotal].every(Number.isSafeInteger)||newSubtotal<0||newTotal<0||newTotal>100000000||Number(sale.total)!==Number(pricing.expected_total))return reply({error:'Los totales no coinciden; revisa el pedido.'},409);
       if(delta===0)return reply({ok:true,unchanged:true,total:newTotal});
       const now=Date.now(),audit='Cantidad '+lines[0].product_name+': '+expected+' → '+qty+'. Motivo: '+reason+'; fecha '+new Date(now).toISOString();
       const batch=[
        env.DB.prepare('UPDATE products SET stock=stock-? WHERE id=? AND active=1 AND stock>=?').bind(delta,pid,Math.max(0,delta)),
        env.DB.prepare('INSERT INTO shop_stock_guard(value) SELECT changes()'),
        env.DB.prepare('DELETE FROM shop_stock_guard'),
        env.DB.prepare("UPDATE shop_order_items SET quantity=?,stock_units=? WHERE order_id=? AND product_id=? AND kind='unidad' AND quantity=? AND stock_units=?").bind(qty,qty,id,pid,expected,expected),
        env.DB.prepare('INSERT INTO shop_stock_guard(value) SELECT changes()'),
        env.DB.prepare('DELETE FROM shop_stock_guard'),
        env.DB.prepare("UPDATE shop_order_commercial_lines SET quantity=?,validated_line_total=?,price_rule='cantidad_manual_pedido' WHERE order_id=? AND product_id=? AND kind='unidad' AND quantity=?").bind(qty,newLineTotal,id,pid,expected),
        env.DB.prepare('INSERT INTO shop_stock_guard(value) SELECT changes()'),
        env.DB.prepare('DELETE FROM shop_stock_guard'),
        env.DB.prepare('UPDATE shop_order_pricing SET product_subtotal=?,expected_total=?,validated_at=? WHERE order_id=? AND expected_total=?').bind(newSubtotal,newTotal,now,id,Number(pricing.expected_total)),
        env.DB.prepare('INSERT INTO shop_stock_guard(value) SELECT changes()'),
        env.DB.prepare('DELETE FROM shop_stock_guard'),
        env.DB.prepare("UPDATE shop_sales SET total=? WHERE id=? AND total=?").bind(newTotal,sale.id,Number(sale.total)),
        env.DB.prepare('INSERT INTO shop_stock_guard(value) SELECT changes()'),
        env.DB.prepare('DELETE FROM shop_stock_guard'),
        env.DB.prepare('UPDATE shop_sale_items SET quantity=?,line_total=CASE WHEN line_total IS NULL THEN NULL ELSE ? END WHERE rowid=? AND quantity=?').bind(qty,newLineTotal,saleItems[0].rowid,expected),
        env.DB.prepare('INSERT INTO shop_stock_guard(value) SELECT changes()'),
        env.DB.prepare('DELETE FROM shop_stock_guard'),
        env.DB.prepare("UPDATE shop_orders SET exceptional_wholesale_note=substr(COALESCE(exceptional_wholesale_note,'') || char(10) || ?,1,2000) WHERE id=? AND status='confirmed' AND dispatched_at=0 AND delivered_at=0 AND pickup_ready_at=0").bind(audit,id),
        env.DB.prepare('INSERT INTO shop_stock_guard(value) SELECT changes()'),
        env.DB.prepare('DELETE FROM shop_stock_guard')
       ];
       try{await env.DB.batch(batch);return reply({ok:true,total:newTotal,delta});}
       catch(e){console.error('Quantity adjustment failed',e);return reply({error:'No se guardó el cambio. Revisa existencias y vuelve a cargar el pedido.'},409);}
      }
      const stockDeltaPreviewMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/stock-delta-preview$/i);
      if(stockDeltaPreviewMatch&&method==='POST'){
       if(!checkOrigin(request))return reply({error:'Origen no permitido.'},403);
       const id=stockDeltaPreviewMatch[1],body=await request.json().catch(()=>null);
       const productId=Number(body?.product_id),newUnits=body?.new_units;
       if(!Number.isSafeInteger(productId)||productId<=0||!Number.isSafeInteger(newUnits)||newUnits<0||newUnits>100000)return reply({error:'Cantidad o producto inválido.'},400);
       const order=await env.DB.prepare('SELECT status,stock_reserved,dispatched_at,delivered_at,pickup_ready_at FROM shop_orders WHERE id=?').bind(id).first();
       if(!order||order.status!=='confirmed'||Number(order.dispatched_at)>0||Number(order.delivered_at)>0||Number(order.pickup_ready_at)>0)return reply({error:'Solo se pueden simular pedidos confirmados sin despachar.'},409);
       if(Number(order.stock_reserved)===1)return reply({error:'Pedido antiguo con stock reservado: requiere revisión manual antes de modificar cantidades.'},409);
       const rows=(await env.DB.prepare('SELECT stock_units FROM shop_order_items WHERE order_id=? AND product_id=?').bind(id,productId).all()).results||[];
       if(!rows.length)return reply({error:'Producto no asociado al pedido.'},404);
       const oldUnits=rows.reduce((sum,r)=>sum+Number(r.stock_units),0);
       const product=await env.DB.prepare('SELECT stock,name FROM products WHERE id=?').bind(productId).first();
       if(!product)return reply({error:'Producto no encontrado.'},404);
       const delta=newUnits-oldUnits,available=Number(product.stock);
       return reply({ok:true,product_name:product.name,old_units:oldUnits,new_units:newUnits,delta,available,sufficient:delta<=available,legacy_stock_reserved:Number(order.stock_reserved)===1,simulation_only:true});
      }
      const dispatchMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/dispatch$/i);
      if(dispatchMatch&&method==='POST'){
       const id=dispatchMatch[1];
       const updated=await env.DB.prepare("UPDATE shop_orders SET dispatched_at=? WHERE id=? AND status='confirmed' AND delivery_method!='pickup' AND dispatched_at=0 AND delivered_at=0").bind(Date.now(),id).run();
       if(Number(updated.meta?.changes)!==1)return reply({error:'Solo puedes despachar pedidos confirmados que aún no hayan salido.'},409);
       return reply({ok:true});
      }
      const pickupReadyMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/pickup-ready$/i);
      if(pickupReadyMatch&&method==='POST'){
       const id=pickupReadyMatch[1];
       const updated=await env.DB.prepare("UPDATE shop_orders SET pickup_ready_at=? WHERE id=? AND status='confirmed' AND delivery_method='pickup' AND dispatched_at=0 AND pickup_ready_at=0 AND delivered_at=0").bind(Date.now(),id).run();
       if(Number(updated.meta?.changes)!==1)return reply({error:'Solo puedes preparar retiros confirmados y aún no entregados.'},409);
       return reply({ok:true});
      }
      const paymentMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/payments$/i);
      if(paymentMatch&&method==='POST'){
       if(!checkOrigin(request))return reply({error:'Origen no permitido'},403);
       const id=paymentMatch[1],body=await request.json().catch(()=>null);
       const amount=Number(body?.amount),note=cleanOrderText(body?.note||'',160);
       if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000)return reply({error:'Ingresa un abono válido.'},400);
       const order=await env.DB.prepare('SELECT status,delivered_at FROM shop_orders WHERE id=?').bind(id).first();
       if(!order||order.status!=='confirmed'||!Number(order.delivered_at))return reply({error:'Solo puedes registrar abonos en pedidos entregados.'},409);
       const sale=await env.DB.prepare("SELECT total FROM shop_sales WHERE order_id=? AND source='online'").bind(id).first();
       if(!sale||!Number.isSafeInteger(Number(sale.total))||Number(sale.total)<=0)return reply({error:'No existe un total de venta válido para este pedido.'},409);
       const paid=await env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM shop_order_payments WHERE order_id=?').bind(id).first();
       const remaining=Number(sale.total)-Number(paid?.total||0);
       if(amount>remaining)return reply({error:'El abono supera el saldo pendiente de '+remaining+' pesos.'},409);
       await env.DB.prepare('INSERT INTO shop_order_payments(order_id,amount,paid_at,note) VALUES(?,?,?,?)').bind(id,amount,Date.now(),note).run();
       return reply({ok:true,remaining:remaining-amount,status:remaining===amount?'paid':'partial'});
      }
      const deliverMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/deliver$/i);
      if(deliverMatch&&method==='POST'){
       const id=deliverMatch[1];
       const updated=await env.DB.prepare("UPDATE shop_orders SET delivered_at=?,allow_confirmed_additional=0 WHERE id=? AND status='confirmed' AND (dispatched_at>0 OR (delivery_method='pickup' AND pickup_ready_at>0)) AND delivered_at=0").bind(Date.now(),id).run();
       if(Number(updated.meta?.changes)!==1)return reply({error:'El pedido no está confirmado, ya fue entregado o no existe.'},409);
       return reply({ok:true});
      }
      // Permiso antiguo deshabilitado; los pedidos históricos permanecen intactos.
      const additionalToggleMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/additional-permission$/i);
      if(additionalToggleMatch&&method==='POST')return reply({error:'Los pedidos adicionales ya no están disponibles.'},410);
      const mergeMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/merge$/i);
      if(mergeMatch&&method==='POST')return reply({error:'La fusión de pedidos adicionales está deshabilitada en BRUSAAM V32.'},410);
      // Autorización manual: precio excepcional para un adicional separado dentro de 24 horas.
      const exceptionalMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/exceptional-wholesale$/i);
      if(exceptionalMatch&&method==='POST'){
       const id=exceptionalMatch[1],body=await request.json().catch(()=>null);
       const productId=Number(body?.product_id),kind=String(body?.kind||''),unitPrice=Number(body?.unit_price);
       if(!Number.isSafeInteger(productId)||productId<1||!['unidad','manga','pack'].includes(kind)||!Number.isSafeInteger(unitPrice)||unitPrice<0||unitPrice>10000000)return reply({error:'Producto o precio inválido.'},400);
       const order=await env.DB.prepare('SELECT * FROM shop_orders WHERE id=?').bind(id).first();
       if(!order||order.status!=='pending'||order.merge_state!=='separate'||!order.separated_from_order_id||order.review_state!=='none')return reply({error:'Solo se permite en adicionales separados pendientes y sin revisión iniciada.'},409);
       const parent=await env.DB.prepare('SELECT created_at FROM shop_orders WHERE id=?').bind(order.separated_from_order_id).first();
       if(!parent||Date.now()-Number(parent.created_at)>86400000||Date.now()<Number(parent.created_at))return reply({error:'La autorización de 24 horas desde el pedido original ya venció.'},409);
       const line=await env.DB.prepare('SELECT * FROM shop_order_commercial_lines WHERE order_id=? AND product_id=? AND kind=?').bind(id,productId,kind).first();
       if(!line||!Number.isSafeInteger(Number(line.quantity))||Number(line.quantity)<1)return reply({error:'Línea no encontrada.'},404);
       const product=await env.DB.prepare('SELECT wholesale,retail,name FROM products WHERE id=?').bind(productId).first();
       if(!product)return reply({error:'Producto no disponible.'},404);
       const reason=cleanOrderText(body?.reason,180);
       if(!reason)return reply({error:'Escribe el motivo de la autorización.'},400);
       const newLineTotal=unitPrice*Number(line.quantity),oldLineTotal=Number(line.validated_line_total);
       const pricing=await env.DB.prepare('SELECT * FROM shop_order_pricing WHERE order_id=?').bind(id).first();
       if(!pricing||!Number.isSafeInteger(oldLineTotal)||!Number.isSafeInteger(newLineTotal))return reply({error:'No se puede actualizar esta línea.'},409);
       const subtotal=Number(pricing.product_subtotal)-oldLineTotal+newLineTotal;
       if(!Number.isSafeInteger(subtotal)||subtotal<0)return reply({error:'Subtotal inválido.'},409);
       let shipping;try{shipping=serverShippingQuote(order,subtotal,await readShippingSettings(env));}catch(e){return reply({error:e.message},409);}
       const audit='Precio excepcional: '+product.name+' ('+kind+') $'+unitPrice+' c/u. Motivo: '+reason+'; fecha '+new Date().toISOString();
       try{await env.DB.batch([
        env.DB.prepare('UPDATE shop_order_commercial_lines SET validated_unit_price=?,validated_line_total=?,price_rule=? WHERE order_id=? AND product_id=? AND kind=?').bind(unitPrice,newLineTotal,'mayorista_excepcional',id,productId,kind),
        env.DB.prepare('UPDATE shop_order_pricing SET product_subtotal=?,delivery_amount=?,expected_total=?,shipping_kind=?,validated_at=?,pricing_version=? WHERE order_id=?').bind(subtotal,shipping.amount,subtotal+shipping.amount,shipping.kind,Date.now(),'v32-exceptional-wholesale',id),
        env.DB.prepare("UPDATE shop_orders SET exceptional_wholesale_note=substr(COALESCE(exceptional_wholesale_note,'') || char(10) || ?,1,2000) WHERE id=?").bind(audit,id)
       ]);return reply({ok:true,total:subtotal+shipping.amount});}catch(e){return reply({error:'No fue posible guardar el precio excepcional.'},409);}
      }
      if(path==='/api/admin/holidays'&&method==='POST'){
       const body=await request.json().catch(()=>null),dates=String(body?.dates||'').split(/[\s,;]+/).filter(Boolean);
       if(dates.length>80||dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d))))return reply({error:'Usa fechas AAAA-MM-DD separadas por coma'},400);
       await env.DB.prepare("INSERT INTO shop_settings(key,value) VALUES('holiday_dates',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(dates)).run();
       return reply({ok:true,dates});
      }
      // V32: cotización del editor, calculada en servidor con las mismas reglas del carrito.
      const quoteMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/quote$/i);
      if(quoteMatch&&method==='POST'){
        const order=await env.DB.prepare('SELECT * FROM shop_orders WHERE id=?').bind(quoteMatch[1]).first();
        if(!order||order.status!=='pending')return reply({error:'Pedido pendiente no disponible.'},409);
        const body=await request.json().catch(()=>null);
        if(!Array.isArray(body?.items)||body.items.length<1||body.items.length>60)return reply({error:'Agrega productos válidos.'},400);
        const lines=[],seen=new Set();
        for(const item of body.items){
          const id=Number(item.product_id),quantity=Number(item.quantity),kind=String(item.kind||'unidad');
          if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(quantity)||quantity<1||quantity>10000||!['unidad','manga','pack'].includes(kind))return reply({error:'Producto o cantidad inválidos.'},400);
          const key=id+':'+kind;if(seen.has(key))return reply({error:'Producto repetido; agrupa cantidades.'},400);seen.add(key);
          lines.push({id,quantity,kind});
        }
        const ids=[...new Set(lines.map(l=>l.id))];
        const rows=(await env.DB.prepare('SELECT id,name,category,active,retail,wholesale,min_qty,ofertas,offer_price,manga_price,offer_manga_price,packs_per_manga,special_only,pack_eligible,wholesale_group FROM products WHERE id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all()).results||[];
        if(rows.length!==ids.length||rows.some(p=>Number(p.active)!==1))return reply({error:'Hay productos que ya no están disponibles.'},409);
        for(const line of lines){const p=rows.find(p=>Number(p.id)===line.id);if(line.kind==='manga'&&!(Number(p.packs_per_manga)>=2&&Number(p.manga_price)>0))return reply({error:'Manga no disponible para '+p.name},400);}
        const packRow=await env.DB.prepare("SELECT value FROM shop_settings WHERE key='pack_settings'").first();
        try{
          const priced=calculateServerOrderPricing(rows,lines,safePackSettings(packRow?.value),safeCustomPacks((await env.DB.prepare("SELECT value FROM shop_settings WHERE key='custom_packs'").first())?.value));
          const shipping=order.merge_state==='approved'?{amount:0,kind:'combined_no_extra_shipping'}:serverShippingQuote(order,priced.subtotal,await readShippingSettings(env));
          return reply({subtotal:priced.subtotal,delivery:shipping.amount,total:priced.subtotal+shipping.amount,shipping_kind:shipping.kind});
        }catch(e){return reply({error:'No se pudo calcular el pedido: '+e.message},400);}
      }
      const phoneMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/whatsapp$/i);
      if(phoneMatch&&method==='POST'){
        const id=phoneMatch[1],body=await request.json().catch(()=>null);
        const digits=String(body?.phone||'').replace(/[^0-9]/g,'');
        // Se aceptan celulares chilenos (+56 9 XXXXXXXX) o 9 XXXXXXXX.
        const phone=/^569[0-9]{8}$/.test(digits)?digits:/^9[0-9]{8}$/.test(digits)?'56'+digits:null;
        if(!phone)return reply({error:'Ingresa un celular chileno válido: +56 9 XXXX XXXX.'},400);
        const result=await env.DB.prepare("UPDATE shop_orders SET customer_whatsapp=? WHERE id=? AND status='pending'").bind(phone,id).run();
        if(!result.meta?.changes)return reply({error:'Pedido no encontrado o ya procesado.'},409);
        return reply({ok:true});
      }
      const editMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/(edit|approve)$/i);
      if(editMatch&&method==='POST'){
        const id=editMatch[1],action=editMatch[2];
        const order=await env.DB.prepare('SELECT * FROM shop_orders WHERE id=?').bind(id).first();
        if(!order||order.status!=='pending')return reply({error:'Solo puedes modificar pedidos pendientes.'},409);
        if(action==='approve'){
          if(order.review_state!=='awaiting')return reply({error:'El pedido no está esperando aprobación.'},409);
          if(!order.customer_whatsapp)return reply({error:'Vincula el WhatsApp real del cliente antes de registrar su aprobación.'},409);
          await env.DB.batch([
            env.DB.prepare("UPDATE shop_orders SET review_state='approved' WHERE id=? AND status='pending' AND review_state='awaiting'").bind(id),
            env.DB.prepare("INSERT INTO shop_stock_guard(value) SELECT changes()"),
            env.DB.prepare("DELETE FROM shop_stock_guard")
          ]);
          return reply({ok:true});
        }
        if(Number(order.stock_reserved)===1)return reply({error:'Pedido antiguo con stock reservado: no se puede editar de forma segura.'},409);
        const body=await request.json().catch(()=>null);
        const lines=body?.items;
        if(!Array.isArray(lines)||!lines.length||lines.length>60)return reply({error:'Agrega al menos un producto.'},400);
        const total=Number(body.total);
        if(!validSaleAmount(total))return reply({error:'Total inválido.'},400);
        const note=cleanOrderText(body.note,500);
        const rows=[],used=new Set();
        for(const line of lines){
          const pid=Number(line.product_id),qty=Number(line.quantity),kind=String(line.kind||'unidad');
          if(!Number.isSafeInteger(pid)||pid<1||!Number.isSafeInteger(qty)||qty<1||qty>10000||!['unidad','manga'].includes(kind))return reply({error:'Producto, cantidad o presentación inválida.'},400);
          const key=pid+':'+kind;if(used.has(key))return reply({error:'Producto repetido. Agrupa las cantidades.'},400);used.add(key);
          const product=await env.DB.prepare('SELECT id,name,active,packs_per_manga FROM products WHERE id=?').bind(pid).first();
          if(!product||Number(product.active)!==1)return reply({error:'Producto no disponible.'},409);
          const per=kind==='manga'?Number(product.packs_per_manga):1;
          if(!Number.isSafeInteger(per)||per<1||(kind==='manga'&&per<2))return reply({error:'Presentación de manga inválida.'},400);
          const units=qty*per;
          if(!Number.isSafeInteger(units))return reply({error:'Cantidad demasiado grande.'},400);
          // V32: expandir packs compuestos a sus componentes físicos, igual que registerOrder.
          const bundleParts=(await env.DB.prepare('SELECT component_id,quantity FROM shop_bundle_components WHERE bundle_id=?').bind(pid).all()).results||[];
          if(bundleParts.length){
            if(kind!=='unidad')return reply({error:'Los packs compuestos solo se venden por unidad.'},400);
            const pack=await env.DB.prepare('SELECT stock FROM products WHERE id=?').bind(pid).first();
            if(!pack||Number(pack.stock)<qty)return reply({error:'No hay suficientes packs disponibles.'},409);
            for(const part of bundleParts){
              const component=await env.DB.prepare('SELECT id,name,stock,active FROM products WHERE id=?').bind(part.component_id).first();
              const partUnits=qty*Number(part.quantity);
              if(!component||Number(component.active)!==1||!Number.isSafeInteger(partUnits)||partUnits<1)return reply({error:'Componente del pack no disponible.'},409);
              const existing=rows.find(r=>r.pid===component.id&&r.kind==='unidad');
              if(existing){existing.qty+=partUnits;existing.units+=partUnits;}
              else rows.push({pid:component.id,kind:'unidad',qty:partUnits,units:partUnits,name:component.name});
            }
          }else{
            const existing=rows.find(r=>r.pid===pid&&r.kind===kind);
            if(existing){existing.qty+=qty;existing.units+=units;}
            else rows.push({pid,kind,qty,units,name:product.name});
          }
        }
        // Validar stock agregado, incluyendo componentes repetidos entre packs y unidades.
        const required=new Map();
        for(const r of rows)required.set(r.pid,(required.get(r.pid)||0)+r.units);
        for(const [productId,requiredUnits] of required){
          const available=await env.DB.prepare('SELECT stock,active,name FROM products WHERE id=?').bind(productId).first();
          if(!available||Number(available.active)!==1||Number(available.stock)<requiredUnits)
            return reply({error:'Stock insuficiente para '+(available?.name||'un producto del pedido')+'.'},409);
        }
        // V32: recalcular el detalle comercial completo desde D1 al editar.
        const originalLines=lines.map(l=>({id:Number(l.product_id),kind:String(l.kind||'unidad'),quantity:Number(l.quantity)}));
        const productIds=[...new Set(originalLines.map(l=>l.id))];
        const priceRows=(await env.DB.prepare('SELECT id,name,category,retail,wholesale,min_qty,ofertas,offer_price,manga_price,offer_manga_price,packs_per_manga,special_only,pack_eligible,wholesale_group FROM products WHERE id IN ('+productIds.map(()=>'?').join(',')+')').bind(...productIds).all()).results||[];
        const packRow=await env.DB.prepare("SELECT value FROM shop_settings WHERE key='pack_settings'").first();
        let priced;
        try{priced=calculateServerOrderPricing(priceRows,originalLines,safePackSettings(packRow?.value),safeCustomPacks((await env.DB.prepare("SELECT value FROM shop_settings WHERE key='custom_packs'").first())?.value));}
        catch(e){console.error('Error de precios al editar pedido',e);return reply({error:'No se pudo recalcular el pedido.'},409);}
        let quote;try{quote=serverShippingQuote(order,priced.subtotal,await readShippingSettings(env));}catch(e){return reply({error:e.message},400);}
        const expectedTotal=priced.subtotal+quote.amount;
        if(total!==expectedTotal)return reply({error:'El total no coincide con productos y despacho recalculados: $'+expectedTotal+'.'},400);
        const now=Date.now();
        const batch=[
          env.DB.prepare("UPDATE shop_orders SET proposed_total=?,revision_note=?,review_state='approved' WHERE id=? AND status='pending' AND stock_reserved=0").bind(total,note,id),
          env.DB.prepare("INSERT INTO shop_stock_guard(value) SELECT changes()"),
          env.DB.prepare("DELETE FROM shop_stock_guard"),
          env.DB.prepare('DELETE FROM shop_order_items WHERE order_id=?').bind(id),
          env.DB.prepare('DELETE FROM shop_order_commercial_lines WHERE order_id=?').bind(id),
          env.DB.prepare('DELETE FROM shop_order_pricing WHERE order_id=?').bind(id)
        ];
        for(const r of rows)batch.push(env.DB.prepare('INSERT INTO shop_order_items(order_id,product_id,kind,quantity,stock_units,product_name) VALUES(?,?,?,?,?,?)').bind(id,r.pid,r.kind,r.qty,r.units,r.name));
        const priceProducts=new Map(priceRows.map(p=>[Number(p.id),p]));
        const safePrice=v=>Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
        for(const l of priced.lines){
          const p=priceProducts.get(Number(l.id));
          if(!p)return reply({error:'Falta información del producto para calcular el precio.'},409);
          const unit=l.paired===0&&Number.isInteger(l.line_total/l.quantity)?l.line_total/l.quantity:null;
          batch.push(env.DB.prepare(`INSERT INTO shop_order_commercial_lines
           (order_id,product_id,kind,quantity,product_name,retail_snapshot,wholesale_snapshot,offer_snapshot,manga_snapshot,min_qty_snapshot,price_rule,validated_unit_price,validated_line_total)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,l.id,l.kind,l.quantity,p.name,safePrice(p.retail),safePrice(p.wholesale),Number(p.ofertas)===1?safePrice(p.offer_price):null,Number(p.ofertas)===1&&Number(p.offer_manga_price)>0?safePrice(p.offer_manga_price):safePrice(p.manga_price),safePrice(p.min_qty)||2,l.price_rule,unit,l.line_total));
        }
        batch.push(env.DB.prepare('INSERT INTO shop_order_pricing(order_id,product_subtotal,delivery_amount,expected_total,shipping_kind,validated_at,pricing_version) VALUES(?,?,?,?,?,?,?)').bind(id,priced.subtotal,quote.amount,expectedTotal,quote.kind,now,'v32-edit-shipping-2'));
        try{await env.DB.batch(batch);return reply({ok:true});}catch(e){return reply({error:'No fue posible guardar la revisión.'},409);}
      }
      const orderAction=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})\/(confirm|cancel)$/i);
      if (orderAction && method === 'POST') {
        const [,id,action]=orderAction;
        if (action==='cancel') {
          const released=await releaseOrder(env,id,'cancelled');
          return released?reply({ok:true}):reply({error:'El pedido no está pendiente o ya fue procesado.'},409);
        }
        const validated=await env.DB.prepare('SELECT expected_total FROM shop_order_pricing WHERE order_id=?').bind(id).first();
        if(!validated||!validSaleAmount(validated.expected_total))return reply({error:'El pedido no tiene un total validado; revisa sus precios antes de confirmar.'},409);
        return confirmOrderSale(env,id,Number(validated.expected_total));
      }

      /* Inventario V32: consulta y movimientos protegidos de Administración. */
      if(path==='/api/admin/inventory'&&method==='GET'){
        const rows=(await env.DB.prepare(`SELECT p.id,p.name,p.category,p.stock,
          COALESCE(r.quantity,0) AS recoverable,COALESCE(f.cost_with_vat,0) AS cost
          FROM products p LEFT JOIN shop_inventory_recoverable r ON r.product_id=p.id
          LEFT JOIN shop_product_finances f ON f.product_id=p.id ORDER BY p.name COLLATE NOCASE`).all()).results||[];
        const products=rows.map(p=>({...p,stock:Number(p.stock)||0,recoverable:Number(p.recoverable)||0,cost:Number(p.cost)||0,value:((Number(p.stock)||0)+(Number(p.recoverable)||0))*(Number(p.cost)||0)}));
        const movements=(await env.DB.prepare(`SELECT m.*,p.name FROM shop_inventory_movements m LEFT JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 500`).all()).results||[];
        const loss=await env.DB.prepare("SELECT COALESCE(SUM(quantity*cost_snapshot),0) AS value FROM shop_inventory_movements WHERE kind IN ('loss','discard')").first();
        return reply({products,movements,summary:{products:products.length,normal:products.reduce((a,p)=>a+p.stock,0),recoverable:products.reduce((a,p)=>a+p.recoverable,0),outOfStock:products.filter(p=>p.stock<=0).length,value:products.reduce((a,p)=>a+p.value,0),lossValue:Number(loss?.value)||0}});
      }
      if(path==='/api/admin/inventory/movement'&&method==='POST'){
        const body=await request.json().catch(()=>null);
        const pid=Number(body?.product_id),qty=Number(body?.quantity),kind=String(body?.kind||'');
        const reason=String(body?.reason||'').trim().slice(0,120),notes=String(body?.notes||'').trim().slice(0,500);
        if(!Number.isSafeInteger(pid)||pid<1||!Number.isSafeInteger(qty)||qty<1||qty>100000||!['loss','recoverable','restore','discard'].includes(kind)||!reason)return reply({error:'Revisa producto, cantidad, tipo y motivo.'},400);
        const p=await env.DB.prepare(`SELECT p.id,p.stock,COALESCE(r.quantity,0) AS recoverable,COALESCE(f.cost_with_vat,0) AS cost FROM products p LEFT JOIN shop_inventory_recoverable r ON r.product_id=p.id LEFT JOIN shop_product_finances f ON f.product_id=p.id WHERE p.id=?`).bind(pid).first();
        if(!p)return reply({error:'Producto no encontrado.'},404);
        if(['loss','recoverable'].includes(kind)&&Number(p.stock)<qty)return reply({error:'Stock normal insuficiente.'},409);
        if(['restore','discard'].includes(kind)&&Number(p.recoverable)<qty)return reply({error:'Stock recuperable insuficiente.'},409);
        const batch=[];
        if(['loss','recoverable'].includes(kind)){
          batch.push(env.DB.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').bind(qty,pid,qty));
        }else{
          batch.push(env.DB.prepare('UPDATE shop_inventory_recoverable SET quantity=quantity-? WHERE product_id=? AND quantity>=?').bind(qty,pid,qty));
        }
        batch.push(env.DB.prepare('INSERT INTO shop_stock_guard(value) SELECT changes()'));
        batch.push(env.DB.prepare('DELETE FROM shop_stock_guard'));
        if(kind==='recoverable'){
          batch.push(env.DB.prepare('INSERT INTO shop_inventory_recoverable(product_id,quantity) VALUES(?,?) ON CONFLICT(product_id) DO UPDATE SET quantity=quantity+excluded.quantity').bind(pid,qty));
        }
        if(kind==='restore')batch.push(env.DB.prepare('UPDATE products SET stock=stock+? WHERE id=?').bind(qty,pid));
        batch.push(env.DB.prepare('INSERT INTO shop_inventory_movements(product_id,kind,quantity,cost_snapshot,reason,notes,created_at) VALUES(?,?,?,?,?,?,?)').bind(pid,kind,qty,Math.round(Number(p.cost)||0),reason,notes,Date.now()));
        try{await env.DB.batch(batch);return reply({ok:true});}
        catch(e){return reply({error:'No se pudo registrar el movimiento; revisa stock y vuelve a intentar.'},409);}
      }

      /* INFORMES Y VENTAS V11 — rutas autenticadas del administrador */
      if(path==='/api/admin/sales/report' && method==='GET') return salesReport(env,url);
      if(path==='/api/admin/sales/manual' && method==='POST') return manualSale(env,await request.json().catch(()=>null));

      /* DATOS DE ADMINISTRACIÓN */

      if (
        path === "/api/admin/data" &&
        method === "GET"
      ) {
        return reply(
          await getData(env, true)
        );
      }

      /* V32: packs personalizables, solo 1 SH + 1 Acond. */
      if(path==='/api/admin/custom-packs'&&method==='PUT'){
        const body=await request.json().catch(()=>null),packs=body?.packs;
        if(!Array.isArray(packs)||packs.length>60||packs.some(x=>
          !x||typeof x.id!=='string'||!/^custom_[a-z0-9_]{5,60}$/.test(x.id)||
          !['name','brand','format'].every(k=>typeof x[k]==='string'&&x[k].trim().length>0&&x[k].length<=90)||
          !['estandar','botella','doypack'].includes(x.presentation)||
          !Number.isSafeInteger(x.price)||x.price<1||x.price>1000000||typeof x.enabled!=='boolean')||
          new Set((packs||[]).map(x=>x.id)).size!==(packs||[]).length){
          return reply({error:'Revisa los datos del pack: nombre, marca, formato, presentación y precio.'},400);
        }
        await env.DB.prepare("INSERT INTO shop_settings(key,value) VALUES('custom_packs',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(packs)).run();
        return reply({ok:true});
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

      const bundleMatch=path.match(/^\/api\/admin\/bundles\/(\d+)$/);
      if(bundleMatch&&method==='PUT'){
       const body=await request.json().catch(()=>null);
       return saveBundleComponents(env,Number(bundleMatch[1]),body?.components);
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
           manga_price,packs_per_manga,offer_price,offer_manga_price,nuevos_ingresos,special_only,pack_eligible,wholesale_group,new_image
          )
          VALUES(
           ?,?,?,?,?,?,?,?,?,?,
           ?,?,?,?,?,?,?,?,?,?,?,?,?
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
          product.pack_eligible === true ? 1 : 0,
          (product.wholesale_group || "").trim(),
          product.new_image === true ? 1 : 0
        ).run();

        await env.DB.prepare('INSERT INTO shop_product_finances(product_id,cost_with_vat,operating_percent) VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET cost_with_vat=excluded.cost_with_vat,operating_percent=excluded.operating_percent').bind(result.meta.last_row_id,product.cost_with_vat||0,product.operating_percent??20).run();
        return reply({
          ok: true,
          id: result.meta.last_row_id
        });
      }

      const historyMatch=path.match(/^\/api\/admin\/products\/(\d+)\/history$/);
      if(historyMatch&&method==='GET'){
        const rows=(await env.DB.prepare('SELECT changed_at,field,old_value,new_value FROM shop_product_price_history WHERE product_id=? ORDER BY id DESC LIMIT 200').bind(Number(historyMatch[1])).all()).results||[];
        return reply({history:rows});
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

        const previousProduct=await env.DB.prepare('SELECT retail,wholesale,offer_price,offer_manga_price,manga_price FROM products WHERE id=?').bind(Number(productId[1])).first();
        if(!previousProduct)return reply({error:'Producto no encontrado'},404);
        const previousFinance=await env.DB.prepare('SELECT cost_with_vat,operating_percent FROM shop_product_finances WHERE product_id=?').bind(Number(productId[1])).first();
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
           pack_eligible=?,
           wholesale_group=?,
           new_image=?
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
          (product.wholesale_group || "").trim(),
          product.new_image === true ? 1 : 0,
          Number(productId[1])
        ).run();

        await env.DB.prepare('INSERT INTO shop_product_finances(product_id,cost_with_vat,operating_percent) VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET cost_with_vat=excluded.cost_with_vat,operating_percent=excluded.operating_percent').bind(Number(productId[1]),product.cost_with_vat||0,product.operating_percent??20).run();
        const oldValues={...previousProduct,cost_with_vat:previousFinance?.cost_with_vat??0,operating_percent:previousFinance?.operating_percent??20};
        const newValues={retail:product.retail,wholesale:product.wholesale,offer_price:product.offer_price||0,offer_manga_price:product.offer_manga_price||0,manga_price:product.manga_price||0,cost_with_vat:product.cost_with_vat||0,operating_percent:product.operating_percent??20};
        const changes=Object.keys(newValues).filter(key=>Number(oldValues[key])!==Number(newValues[key]));
        if(changes.length)await env.DB.batch(changes.map(field=>env.DB.prepare('INSERT INTO shop_product_price_history(product_id,changed_at,field,old_value,new_value) VALUES(?,?,?,?,?)').bind(Number(productId[1]),Date.now(),field,Number(oldValues[field])||0,Number(newValues[field])||0)));
        return reply({ ok: true });
      }

      if (
        productId &&
        method === "DELETE"
      ) {
        await env.DB.prepare('DELETE FROM shop_product_finances WHERE product_id=?').bind(Number(productId[1])).run();
        await env.DB.prepare('DELETE FROM shop_bundle_components WHERE bundle_id=? OR component_id=?').bind(Number(productId[1]),Number(productId[1])).run();
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

/* Fin BRUSAAM V32 - presentación de órdenes */
