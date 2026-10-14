
const encoder = new TextEncoder();
const htmlEscape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = (data, status=200, headers={}) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const cookieName = 'brusaam_session';
function cookies(req){return Object.fromEntries((req.headers.get('Cookie')||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2));}
function b64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sign(value, secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))));}
async function valid(req,env){const c=cookies(req)[cookieName];if(!c||!env.SESSION_SECRET)return false;const parts=c.split('.');if(parts.length!==2)return false;const [expiry,mac]=parts;if(!/^\d{10,15}$/.test(expiry)||Number(expiry)<Date.now())return false;const expected=await sign(expiry,env.SESSION_SECRET);if(mac.length!==expected.length)return false;let diff=0;for(let i=0;i<mac.length;i++)diff|=mac.charCodeAt(i)^expected.charCodeAt(i);return diff===0;}
function sameOrigin(req){const origin=req.headers.get('Origin');return !!origin && origin===new URL(req.url).origin;}
function document(body){return new Response('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brusaam</title><style>body{margin:0;background:#f3f6f3;color:#243c30;font:16px Arial,sans-serif}header{background:white;padding:18px;text-align:center;box-shadow:0 1px 4px #ddd}h1{margin:0;color:#28563f}main{max-width:980px;margin:auto;padding:16px}a{color:#28563f}nav{margin-top:12px}button,.btn{background:#28563f;color:white;border:0;border-radius:8px;padding:10px 13px;cursor:pointer;display:inline-block;text-decoration:none}button:disabled{opacity:.5}input,select,textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid #bbb;border-radius:8px;margin:4px 0 10px}label{font-size:14px}section,.card{background:white;padding:16px;border-radius:12px;margin:12px 0;box-shadow:0 1px 4px #ddd}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.grid .card{margin:0}.card img{max-width:100%;height:140px;object-fit:contain}.flex{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.flex button{flex-shrink:0}.small{font-size:13px;color:#52685b}.danger{background:#9d3434}.qty{width:75px}.hidden{display:none}</style></head><body><header><h1>BRUSAAM</h1><div class="small">Limpieza y cuidado personal</div><nav><a href="/">Tienda</a> · <a href="/admin">Administración</a></nav></header><main>'+body+'</main></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});}
const shop = `<h2>Catálogo de productos</h2><input id="buscar" placeholder="Buscar productos"><div id="catalogo" class="grid"></div><section><h2>Mi carrito</h2><div id="items"></div><h3 id="total">Total: $0</h3><button id="enviar">Enviar pedido por WhatsApp</button><p class="small">Precios y stock sujetos a confirmación al recibir el pedido.</p></section><script>
let productos=[],carrito={};const pesos=n=>'$'+Number(n).toLocaleString('es-CL');const unit=(p,n)=>n>=2?p.wholesale:p.retail;
function el(tag,text){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;return x;}
function render(){const target=document.getElementById('catalogo');target.replaceChildren();const q=document.getElementById('buscar').value.toLowerCase();for(const p of productos.filter(x=>x.name.toLowerCase().includes(q))){const c=el('div');c.className='card';if(p.image&&/^https:\/\//.test(p.image)){const im=el('img');im.src=p.image;im.alt=p.name;c.append(im);}c.append(el('h3',p.name),el('p','Detalle: '+pesos(p.retail)),el('p','Mayor desde 2 unidades: '+pesos(p.wholesale)),el('p','Stock: '+p.stock));const row=el('div');row.className='flex';const inp=el('input');inp.type='number';inp.min='1';inp.max=String(p.stock);inp.value='1';inp.className='qty';const b=el('button','Agregar');b.disabled=p.stock<1;b.onclick=()=>{const n=Number(inp.value);if(!Number.isInteger(n)||n<1||n+(carrito[p.id]||0)>p.stock){alert('Cantidad inválida o stock insuficiente');return;}carrito[p.id]=(carrito[p.id]||0)+n;update();};row.append(inp,b);c.append(row);target.append(c);}}
function update(){const t=document.getElementById('items');t.replaceChildren();let total=0;for(const [id,n] of Object.entries(carrito)){const p=productos.find(x=>String(x.id)===id);if(!p)continue;const sub=unit(p,n)*n;total+=sub;const row=el('p',n+' x '+p.name+' — '+pesos(sub)+' ');const b=el('button','Quitar');b.onclick=()=>{delete carrito[id];update();};row.append(b);t.append(row);}document.getElementById('total').textContent='Total: '+pesos(total);}
document.getElementById('buscar').oninput=render;document.getElementById('enviar').onclick=()=>{let total=0;const lines=[];for(const [id,n] of Object.entries(carrito)){const p=productos.find(x=>String(x.id)===id);if(!p)continue;const sub=unit(p,n)*n;total+=sub;lines.push(n+' x '+p.name+' — '+pesos(sub));}if(!lines.length){alert('El carrito está vacío');return;}const msg='Hola Brusaam, solicito:\n'+lines.join('\n')+'\nTotal: '+pesos(total)+'\nNombre:\nEntrega o retiro:\nDirección (si corresponde):';location.href='https://wa.me/56966282007?text='+encodeURIComponent(msg);};
fetch('/api/productos').then(r=>{if(!r.ok)throw Error();return r.json()}).then(p=>{productos=p;render();}).catch(()=>{document.getElementById('catalogo').textContent='No se pudo cargar el catálogo';});</script>`;
const admin = `<h2>Administración de productos</h2><section id="login"><h3>Iniciar sesión</h3><form id="loginForm"><label>Contraseña de administración<input id="password" type="password" autocomplete="current-password" required></label><button>Ingresar</button></form><p id="loginMsg"></p></section><div id="panel" class="hidden"><section><div class="flex"><h3>Nuevo producto / Editar producto</h3><button id="salir">Cerrar sesión</button></div><form id="form"><input type="hidden" id="id"><label>Nombre<input id="name" required maxlength="160"></label><label>Categoría<input id="category" value="General" maxlength="80"></label><label>Descripción<textarea id="description" maxlength="1000"></textarea></label><label>Precio detalle (CLP)<input id="retail" type="number" min="0" step="1" required></label><label>Precio mayor desde 2 (CLP)<input id="wholesale" type="number" min="0" step="1" required></label><label>Stock<input id="stock" type="number" min="0" step="1" required></label><label>URL de fotografía HTTPS<input id="image" type="url" placeholder="https://..."></label><label><input id="active" type="checkbox" checked style="width:auto"> Producto visible</label><div class="flex"><button>Guardar producto</button><button type="button" id="limpiar">Nuevo / Limpiar</button></div></form><p id="estado"></p></section><section><h3>Productos</h3><div id="productosAdmin"></div></section></div><script>
const $=id=>document.getElementById(id);let lista=[];function msg(s){$('estado').textContent=s;}async function api(url,opts){const r=await fetch(url,{credentials:'same-origin',...opts,headers:{'Content-Type':'application/json',...(opts?.headers||{})}});const data=await r.json().catch(()=>({error:'Error de conexión'}));if(!r.ok)throw Error(data.error||'Error');return data;}
async function iniciar(){try{const r=await api('/api/admin/session');if(r.authenticated){$('login').classList.add('hidden');$('panel').classList.remove('hidden');await cargar();}else{$('login').classList.remove('hidden');$('panel').classList.add('hidden');}}catch(e){$('loginMsg').textContent=e.message;}}
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';$('loginMsg').textContent='';await iniciar();}catch(err){$('loginMsg').textContent=err.message;}};
$('salir').onclick=async()=>{await api('/api/admin/logout',{method:'POST',body:'{}'});await iniciar();};
function limpiar(){$('form').reset();$('id').value='';$('category').value='General';$('active').checked=true;msg('');}$('limpiar').onclick=limpiar;
async function cargar(){lista=await api('/api/admin/products');const root=$('productosAdmin');root.replaceChildren();for(const p of lista){const row=document.createElement('p');row.textContent=p.name+' — $'+p.retail+' / $'+p.wholesale+' — stock '+p.stock+' ';const edit=document.createElement('button');edit.textContent='Editar';edit.onclick=()=>{for(const k of ['id','name','category','description','retail','wholesale','stock','image'])$(k).value=p[k]??'';$('active').checked=!!p.active;window.scrollTo(0,0);};const del=document.createElement('button');del.className='danger';del.textContent='Eliminar';del.onclick=async()=>{if(!confirm('¿Eliminar '+p.name+'?'))return;try{await api('/api/admin/products/'+p.id,{method:'DELETE',body:'{}'});await cargar();}catch(e){msg(e.message);}};row.append(edit,' ',del);root.append(row);}}
$('form').onsubmit=async e=>{e.preventDefault();const id=$('id').value;const p={name:$('name').value,category:$('category').value,description:$('description').value,retail:Number($('retail').value),wholesale:Number($('wholesale').value),stock:Number($('stock').value),image:$('image').value,active:$('active').checked};try{await api('/api/admin/products'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(p)});limpiar();msg('Producto guardado');await cargar();}catch(e){msg(e.message);}};iniciar();</script>`;
async function failedLogins(env,ip){await env.DB.prepare('CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, failures INTEG
…
¡Perfecto! Ahora sí tengo el código completo de tu tienda Brusaam. Gracias por copiarlo.

Ya identifiqué exactamente dónde debemos incorporar la subida de fotografías. Podemos conservar el inicio de sesión, el catálogo, los precios, el stock y el carrito de WhatsApp.

Para que las imágenes se suban de forma segura, no vamos a colocar el preset público de Cloudinary directamente en la página. La subida pasará por una ruta protegida del panel de administración, que comprobará que hayas iniciado sesión.

Paso 6. Preparar la conexión segura con Cloudinary
Antes de cambiar worker.js, necesitamos guardar dos credenciales de Cloudinary como secretos privados en Cloudflare, nunca en GitHub.

Entra a 
Cloudinary
.

Busca Settings → API Keys. En algunas versiones aparece en el Dashboard.

Comprueba que encuentras API Key y API Secret.

No copies esas claves en este chat ni me envíes una captura donde se vean. Las utilizaremos directamente en Cloudflare para que solo tu panel autorizado pueda subir fotografías.

¿Qué encontraste en Cloudinary?


Encontré API Key y API Secret.

No encuentro esas opciones.

Mi pantalla muestra otras opciones.
Después de guardar las credenciales, prepararemos el cambio en worker.js para que puedas elegir una foto de tu galería, subirla y asociarla al producto.

Encontré API Key y API Secret en Cloudinary. Indícame cómo guardarlas de forma segura en Cloudflare, sin compartir sus valores.
¡Excelente! 🔐 Vamos a guardar las claves de Cloudinary de forma segura en Cloudflare, sin compartirlas conmigo ni publicarlas en GitHub.

Paso 1. Entrar a tu Worker
Abre 
Cloudflare
.

Entra a Workers & Pages.

Selecciona tu Worker brusaam-tienda.

Abre Settings (Configuración).

Busca Variables and Secrets o Variables y secretos.

Paso 2. Guardar la primera clave
Presiona Add / Agregar y completa:

Primera variable

Tipo	
Secret

Nombre	
CLOUDINARY_API_KEY

Valor	
Tu API Key de Cloudinary

Guarda el secreto. Si aparece una opción para Deploy o aplicar los cambios, confírmala.

Paso 3. Guardar la segunda clave
Vuelve a presionar Add / Agregar.

Segunda variable

Tipo	
Secret

Nombre	
CLOUDINARY_API_SECRET

Valor	
Tu API Secret de Cloudinary

Guarda los cambios.

Paso 4. Verificar
Al finalizar, en Cloudflare deberían aparecer estos cuatro secretos:

ADMIN_PASSWORD

SESSION_SECRET

CLOUDINARY_API_KEY

CLOUDINARY_API_SECRET

Los valores deben permanecer ocultos.

Seguridad

No coloques los valores de las claves en worker.js, wrangler.jsonc ni en GitHub. Solo deben estar guardados como secretos de Cloudflare.

Confírmame el resultado

Guardé ambas claves como Secret en Cloudflare.

No encuentro cómo seleccionar Secret.

Me apareció un error al guardar.
Cuando confirmes que están guardadas, prepararemos el código para agregar el botón Subir fotografía desde mi celular al panel de Brusaam.

Ya guardé CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET como secretos en Cloudflare para brusaam-tienda.
¡Excelente! 🎉 Ya tienes las dos claves de Cloudinary guardadas como secretos en Cloudflare.

Ahora podemos preparar la función para subir fotografías desde la galería de tu celular sin exponer esas claves en GitHub.

La modificación conservará el panel de administración, los productos, los precios, el stock y el carrito de WhatsApp. Además, la subida de imágenes exigirá que hayas iniciado sesión como administrador.

Antes de cambiar el código, vamos a crear una copia de seguridad para poder volver a la versión actual si algo no funciona.

Paso 7. Respaldar el código actual
Entra a 
tu repositorio Brusaam en GitHub
.

Abre el archivo worker.js.

Busca el menú de los tres puntos ⋯.

Si aparece Download file, selecciónalo para guardar una copia en tu celular.

También puedes recuperar versiones anteriores desde History, porque GitHub conserva el historial de cambios.

Por ahora no edites worker.js. Primero aseguraremos la versión que ya funciona.

¿Pudiste respaldar el archivo?


Sí, descargué worker.js en mi celular.

No pude descargarlo, pero veo el historial de versiones.

No encuentro ninguna de esas opciones.
Después prepararemos el cambio completo, incluyendo la conexión con Cloudinary, la validación de fotografías y el botón para subirlas desde el celular.

Ya descargué el respaldo de worker.js de Brusaam. Continuemos con el botón para subir fotografías.
¡Excelente! 🎉 Ya tenemos el respaldo de worker.js y las claves de Cloudinary guardadas de forma segura.

Ahora vamos a incorporar a Brusaam el botón «Seleccionar fotografía», para que puedas elegir una imagen desde la galería de tu celular y asociarla a un producto.

Como el archivo worker.js contiene toda la tienda, el panel de administración y el carrito de WhatsApp, prefiero prepararte el archivo completo ya modificado, en lugar de pedirte que copies varios fragmentos de código desde el celular. Así reducimos el riesgo de borrar algo por accidente.

Paso 8. Enviarme el archivo de respaldo
Presiona el botón + o el clip para adjuntar archivos en este chat.

Selecciona Archivos.

Busca el archivo worker.js que acabas de descargar de GitHub.

Adjunta el archivo aquí.

Con ese archivo prepararé una nueva versión que incluya:

 Botón para seleccionar fotografías desde tu galería.

 Subida de imágenes a Cloudinary, dentro de brusaam-productos.

 Validación de tu sesión de administrador antes de subir.

 Vista previa de la fotografía antes de guardar el producto.

 Conservación del catálogo, precios, stock y pedidos por WhatsApp.

Utilizaré el Cloud Name oobzcqc2 y las claves privadas que ya guardaste en Cloudflare, sin necesitar que me las compartas.

Adjúntame worker.js y te prepararé el archivo actualizado, listo para reemplazarlo en GitHub.


worker.js
Código
¡Recibí tu archivo worker.js! Ya preparé una versión actualizada para Brusaam, conservando las funciones existentes de la tienda.

La nueva versión incluye un botón para seleccionar fotografías desde tu celular, subirlas a Cloudinary y verlas antes de guardar el producto. La subida se realiza a través del panel protegido, sin mostrar las claves privadas a los visitantes.

También comprobé que el archivo y los scripts incluidos no tienen errores de sintaxis.

Código actualizado de Brusaam

Archivo JavaScript listo para reemplazar worker.js en GitHub.
 Descargar worker_brusaam_fotografias.js

Paso siguiente: actualizar GitHub
Descarga el archivo desde el enlace anterior.

Entra a 
tu repositorio de Brusaam
.

Abre worker.js y presiona Editar .

Borra el contenido anterior y pega todo el contenido del archivo nuevo.

Guarda con Commit changes directamente en main.

Importante: El archivo de GitHub debe seguir llamándose worker.js. No cambies wrangler.jsonc ni las claves de Cloudflare.

Después de guardar
Entra a Cloudflare → Workers & Pages → brusaam-tienda → Deployments y comprueba que la nueva publicación aparezca como Ready.

Cuando esté lista, probaremos con una fotografía real desde el panel. No necesitaremos volver a crear el producto de prueba.

Dime cuando Cloudflare muestre Ready, o envíame una captura si aparece algún error.

const encoder = new TextEncoder();
const htmlEscape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = (data, status=200, headers={}) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const cookieName = 'brusaam_session';
function cookies(req){return Object.fromEntries((req.headers.get('Cookie')||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2));}
function b64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sign(value, secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))));}
async function valid(req,env){const c=cookies(req)[cookieName];if(!c||!env.SESSION_SECRET)return false;const parts=c.split('.');if(parts.length!==2)return false;const [expiry,mac]=parts;if(!/^\d{10,15}$/.test(expiry)||Number(expiry)<Date.now())return false;const expected=await sign(expiry,env.SESSION_SECRET);if(mac.length!==expected.length)return false;let diff=0;for(let i=0;i<mac.length;i++)diff|=mac.charCodeAt(i)^expected.charCodeAt(i);return diff===0;}
function sameOrigin(req){const origin=req.headers.get('Origin');return !!origin && origin===new URL(req.url).origin;}
function document(body){return new Response('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brusaam</title><style>body{margin:0;background:#f3f6f3;color:#243c30;font:16px Arial,sans-serif}header{background:white;padding:18px;text-align:center;box-shadow:0 1px 4px #ddd}h1{margin:0;color:#28563f}main{max-width:980px;margin:auto;padding:16px}a{color:#28563f}nav{margin-top:12px}button,.btn{background:#28563f;color:white;border:0;border-radius:8px;padding:10px 13px;cursor:pointer;display:inline-block;text-decoration:none}button:disabled{opacity:.5}input,select,textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid #bbb;border-radius:8px;margin:4px 0 10px}label{font-size:14px}section,.card{background:white;padding:16px;border-radius:12px;margin:12px 0;box-shadow:0 1px 4px #ddd}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.grid .card{margin:0}.card img{max-width:100%;height:140px;object-fit:contain}.flex{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.flex button{flex-shrink:0}.small{font-size:13px;color:#52685b}.danger{background:#9d3434}.qty{width:75px}.hidden{display:none}</style></head><body><header><h1>BRUSAAM</h1><div class="small">Limpieza y cuidado personal</div><nav><a href="/">Tienda</a> · <a href="/admin">Administración</a></nav></header><main>'+body+'</main></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});}
const shop = `<h2>Catálogo de productos</h2><input id="buscar" placeholder="Buscar productos"><div id="catalogo" class="grid"></div><section><h2>Mi carrito</h2><div id="items"></div><h3 id="total">Total: $0</h3><button id="enviar">Enviar pedido por WhatsApp</button><p class="small">Precios y stock sujetos a confirmación al recibir el pedido.</p></section><script>
let productos=[],carrito={};const pesos=n=>'$'+Number(n).toLocaleString('es-CL');const unit=(p,n)=>n>=2?p.wholesale:p.retail;
function el(tag,text){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;return x;}
function render(){const target=document.getElementById('catalogo');target.replaceChildren();const q=document.getElementById('buscar').value.toLowerCase();for(const p of productos.filter(x=>x.name.toLowerCase().includes(q))){const c=el('div');c.className='card';if(p.image&&/^https:\/\//.test(p.image)){const im=el('img');im.src=p.image;im.alt=p.name;c.append(im);}c.append(el('h3',p.name),el('p','Detalle: '+pesos(p.retail)),el('p','Mayor desde 2 unidades: '+pesos(p.wholesale)),el('p','Stock: '+p.stock));const row=el('div');row.className='flex';const inp=el('input');inp.type='number';inp.min='1';inp.max=String(p.stock);inp.value='1';inp.className='qty';const b=el('button','Agregar');b.disabled=p.stock<1;b.onclick=()=>{const n=Number(inp.value);if(!Number.isInteger(n)||n<1||n+(carrito[p.id]||0)>p.stock){alert('Cantidad inválida o stock insuficiente');return;}carrito[p.id]=(carrito[p.id]||0)+n;update();};row.append(inp,b);c.append(row);target.append(c);}}
function update(){const t=document.getElementById('items');t.replaceChildren();let total=0;for(const [id,n] of Object.entries(carrito)){const p=productos.find(x=>String(x.id)===id);if(!p)continue;const sub=unit(p,n)*n;total+=sub;const row=el('p',n+' x '+p.name+' — '+pesos(sub)+' ');const b=el('button','Quitar');b.onclick=()=>{delete carrito[id];update();};row.append(b);t.append(row);}document.getElementById('total').textContent='Total: '+pesos(total);}
document.getElementById('buscar').oninput=render;document.getElementById('enviar').onclick=()=>{let total=0;const lines=[];for(const [id,n] of Object.entries(carrito)){const p=productos.find(x=>String(x.id)===id);if(!p)continue;const sub=unit(p,n)*n;total+=sub;lines.push(n+' x '+p.name+' — '+pesos(sub));}if(!lines.length){alert('El carrito está vacío');return;}const msg='Hola Brusaam, solicito:\n'+lines.join('\n')+'\nTotal: '+pesos(total)+'\nNombre:\nEntrega o retiro:\nDirección (si corresponde):';location.href='https://wa.me/56966282007?text='+encodeURIComponent(msg);};
fetch('/api/productos').then(r=>{if(!r.ok)throw Error();return r.json()}).then(p=>{productos=p;render();}).catch(()=>{document.getElementById('catalogo').textContent='No se pudo cargar el catálogo';});</script>`;
const admin = `<h2>Administración de productos</h2><section id="login"><h3>Iniciar sesión</h3><form id="loginForm"><label>Contraseña de administración<input id="password" type="password" autocomplete="current-password" required></label><button>Ingresar</button></form><p id="loginMsg"></p></section><div id="panel" class="hidden"><section><div class="flex"><h3>Nuevo producto / Editar producto</h3><button id="salir">Cerrar sesión</button></div><form id="form"><input type="hidden" id="id"><label>Nombre<input id="name" required maxlength="160"></label><label>Categoría<input id="category" value="General" maxlength="80"></label><label>Descripción<textarea id="description" maxlength="1000"></textarea></label><label>Precio detalle (CLP)<input id="retail" type="number" min="0" step="1" required></label><label>Precio mayor desde 2 (CLP)<input id="wholesale" type="number" min="0" step="1" required></label><label>Stock<input id="stock" type="number" min="0" step="1" required></label><label>URL de fotografía HTTPS<input id="image" type="url" placeholder="https://..."></label><label><input id="active" type="checkbox" checked style="width:auto"> Producto visible</label><div class="flex"><button>Guardar producto</button><button type="button" id="limpiar">Nuevo / Limpiar</button></div></form><p id="estado"></p></section><section><h3>Productos</h3><div id="productosAdmin"></div></section></div><script>
const $=id=>document.getElementById(id);let lista=[];function msg(s){$('estado').textContent=s;}async function api(url,opts){const r=await fetch(url,{credentials:'same-origin',...opts,headers:{'Content-Type':'application/json',...(opts?.headers||{})}});const data=await r.json().catch(()=>({error:'Error de conexión'}));if(!r.ok)throw Error(data.error||'Error');return data;}
async function iniciar(){try{const r=await api('/api/admin/session');if(r.authenticated){$('login').classList.add('hidden');$('panel').classList.remove('hidden');await cargar();}else{$('login').classList.remove('hidden');$('panel').classList.add('hidden');}}catch(e){$('loginMsg').textContent=e.message;}}
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';$('loginMsg').textContent='';await iniciar();}catch(err){$('loginMsg').textContent=err.message;}};
$('salir').onclick=async()=>{await api('/api/admin/logout',{method:'POST',body:'{}'});await iniciar();};
function limpiar(){$('form').reset();$('id').value='';$('category').value='General';$('active').checked=true;msg('');}$('limpiar').onclick=limpiar;
async function cargar(){lista=await api('/api/admin/products');const root=$('productosAdmin');root.replaceChildren();for(const p of lista){const row=document.createElement('p');row.textContent=p.name+' — $'+p.retail+' / $'+p.wholesale+' — stock '+p.stock+' ';const edit=document.createElement('button');edit.textContent='Editar';edit.onclick=()=>{for(const k of ['id','name','category','description','retail','wholesale','stock','image'])$(k).value=p[k]??'';$('active').checked=!!p.active;window.scrollTo(0,0);};const del=document.createElement('button');del.className='danger';del.textContent='Eliminar';del.onclick=async()=>{if(!confirm('¿Eliminar '+p.name+'?'))return;try{await api('/api/admin/products/'+p.id,{method:'DELETE',body:'{}'});await cargar();}catch(e){msg(e.message);}};row.append(edit,' ',del);root.append(row);}}
$('form').onsubmit=async e=>{e.preventDefault();const id=$('id').value;const p={name:$('name').value,category:$('category').value,description:$('description').value,retail:Number($('retail').value),wholesale:Number($('wholesale').value),stock:Number($('stock').value),image:$('image').value,active:$('active').checked};try{await api('/api/admin/products'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(p)});limpiar();msg('Producto guardado');await cargar();}catch(e){msg(e.message);}};iniciar();</script>`;
async function failedLogins(env,ip){await env.DB.prepare('CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY, failures INTEGER NOT NULL, until_ms INTEGER NOT NULL)').run();const r=await env.DB.prepare('SELECT failures, until_ms FROM login_attempts WHERE ip = ?').bind(ip).first();return r||{failures:0,until_ms:0};}
async function trackFailure(env,ip,n){await env.DB.prepare('INSERT INTO login_attempts (ip,failures,until_ms) VALUES (?,?,?) ON CONFLICT(ip) DO UPDATE SET failures=excluded.failures,until_ms=excluded.until_ms').bind(ip,n,Date.now()+15*60*1000).run();}
function checkProduct(p){if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>160||typeof p.category!=='string'||p.category.length>80||typeof p.description!=='string'||p.description.length>1000||!Number.isSafeInteger(p.retail)||p.retail<0||!Number.isSafeInteger(p.wholesale)||p.wholesale<0||!Number.isSafeInteger(p.stock)||p.stock<0||typeof p.image!=='string'||p.image.length>1500||!!p.image&&!/^https:\/\//i.test(p.image))return false;return true;}
export default {async fetch(request,env){const url=new URL(request.url),path=url.pathname,method=request.method;
try{
if(path==='/')return document(shop);
if(path==='/admin'&&method==='GET')return document(admin);
if(path==='/api/productos'&&method==='GET'){const r=await env.DB.prepare('SELECT id,name,category,retail,wholesale,stock,image FROM products WHERE active=1 ORDER BY name').all();return json(r.results);}
if(path==='/api/admin/session'&&method==='GET')return json({authenticated:await valid(request,env)});
if(path.startsWith('/api/admin/')){
if(!env.DB||!env.ADMIN_PASSWORD||!env.SESSION_SECRET)return json({error:'Falta configuración de seguridad'},503);
if(method!=='GET'&&!sameOrigin(request))return json({error:'Origen no permitido'},403);
if(path==='/api/admin/login'&&method==='POST'){
const ip=request.headers.get('CF-Connecting-IP')||'unknown';const state=await failedLogins(env,ip);if(state.failures>=5&&state.until_ms>Date.now())return json({error:'Demasiados intentos. Espera 15 minutos.'},429);
const body=await request.json().catch(()=>({}));const supplied=typeof body.password==='string'?body.password:'';
const stored=env.ADMIN_PASSWORD;const a=await crypto.subtle.digest('SHA-256',encoder.encode(supplied));const b=await crypto.subtle.digest('SHA-256',encoder.encode(stored));const aa=new Uint8Array(a),bb=new Uint8Array(b);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];if(diff!==0){await trackFailure(env,ip,state.until_ms<Date.now()?1:state.failures+1);return json({error:'Contraseña incorrecta'},401);}
await env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ip).run();const expiry=String(Date.now()+8*60*60*1000),mac=await sign(expiry,env.SESSION_SECRET);return json({ok:true},200,{'Set-Cookie':cookieName+'='+expiry+'.'+mac+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800'});
}
if(path==='/api/admin/logout'&&method==='POST')return json({ok:true},200,{'Set-Cookie':cookieName+'=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
if(!await valid(request,env))return json({error:'Inicia sesión'},401);
if(path==='/api/admin/products'&&method==='GET'){const r=await env.DB.prepare('SELECT * FROM products ORDER BY id DESC').all();return json(r.results);}
if((path==='/api/admin/products'&&method==='POST')||(/^\/api\/admin\/products\/\d+$/.test(path)&&['PUT','DELETE'].includes(method))){
const id=Number(path.split('/').pop());if(method==='DELETE'){await env.DB.prepare('DELETE FROM products WHERE id=?').bind(id).run();return json({ok:true});}
const p=await request.json().catch(()=>null);if(!checkProduct(p))return json({error:'Revisa los campos del producto'},400);
if(method==='POST'){const r=await env.DB.prepare('INSERT INTO products(name,category,description,retail,wholesale,min_qty,stock,image,active) VALUES(?,?,?,?,?,2,?,?,?)').bind(p.name.trim(),p.category,p.description,p.retail,p.wholesale,p.stock,p.image,p.active?1:0).run();return json({ok:true,id:r.meta.last_row_id});}
await env.DB.prepare('UPDATE products SET name=?,category=?,description=?,retail=?,wholesale=?,stock=?,image=?,active=? WHERE id=?').bind(p.name.trim(),p.category,p.description,p.retail,p.wholesale,p.stock,p.image,p.active?1:0,id).run();return json({ok:true});
}
return json({error:'Ruta no encontrada'},404);
}
return new Response('No encontrado',{status:404});
}catch(e){return json({error:'Error interno de la tienda'},500);}
}};
