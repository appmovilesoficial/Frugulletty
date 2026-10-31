/* Pruebas de la lógica de decisión del escáner en vivo (app.js v27).
   Extrae las funciones REALES del archivo y las valida con casos de prueba.
   Ejecutar: node tests/escaneo.test.js
   NOTA: no prueba hardware (necesita cámara física); prueba la lógica: qué
   mensaje/acción se elige ante cada estado de permiso/error. */
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

let fallas = 0, ok = 0;
function esperar(cond, nombre, detalle) {
  if (cond) { ok++; console.log('  ✅ ' + nombre); }
  else { fallas++; console.log('  ❌ ' + nombre + (detalle ? ' → ' + detalle : '')); }
}
function setUa(ua) {
  // Node 24 trae un navigator global de solo lectura: hay que redefinirlo de verdad.
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua, vendor: '' },
    configurable: true, writable: true
  });
}

function extraerFuncion(nombre) {
  const re = new RegExp('function ' + nombre + '\\([^)]*\\)[\\s\\S]*?\\n\\}', 'm');
  const m = APP.match(re);
  if (!m) throw new Error('No se encontró ' + nombre + ' en app.js');
  return m[0];
}

// ---------- 1) navegadorInterno (se prueba con un navigator simulado) ----------
console.log('\n1) Detección de navegadores internos (WhatsApp/Facebook/IG):');
const fnInterno = extraerFuncion('navegadorInterno');
function internoCon(ua) {
  setUa(ua);
  return new Function(fnInterno + '; return navegadorInterno();')();
}
esperar(internoCon('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36') === false,
  'Chrome Android normal → NO es navegador interno');
esperar(internoCon('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 [FBAN/FB4A]') === true,
  'Facebook (FBAN) → SÍ es interno');
esperar(internoCon('Mozilla/5.0 (Linux; Android 13) Instagram 255.0.0.19.101 Android') === true,
  'Instagram → SÍ es interno');
esperar(internoCon('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 WhatsApp/2.24.8') === true,
  'WhatsApp → SÍ es interno');
esperar(internoCon('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36') === false,
  'Chrome escritorio → NO es interno');

// ---------- 1b) chromeAndroid: mensajes adaptados al candado sin "Permisos" ----------
console.log('\n1b) Detección de Chrome Android (candado solo dice "Conexión segura"):');
const fnChromeAndroid = extraerFuncion('chromeAndroid');
function chromeCon(ua) {
  setUa(ua);
  return new Function(fnChromeAndroid + '; return chromeAndroid();')();
}
esperar(chromeCon('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36') === true,
  'Chrome Android normal → SÍ aplica el camino ⋮ → Configuración del sitio');
esperar(chromeCon('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36') === false,
  'Chrome escritorio → NO aplica (usa el camino ⓘ/🔒 directo)');
esperar(chromeCon('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36 [FBAN/FB4A]') === false,
  'Chrome Android dentro de Facebook → prioriza el aviso de navegador interno');
esperar(chromeCon('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 OPR/80.0 Mobile') === false,
  'Opera Android → no se confunde con Chrome');

// ---------- 2) mensajePermisoCam según estado del permiso ----------
console.log('\n2) Mensajes según el estado del permiso:');
const fnMsg = extraerFuncion('mensajePermisoCam');
const fnChromeAndroidSrc = extraerFuncion('chromeAndroid');
function msgCon(diag, ua) {
  setUa(ua || 'Mozilla/5.0 Chrome/120.0 Mobile');
  const fn = new Function('_diagCamara', fnInterno + '; ' + fnChromeAndroidSrc + '; ' + fnMsg + '; return mensajePermisoCam();');
  return fn(diag);
}
const mInt = msgCon({ permiso: 'denied', prueba: false }, 'Mozilla/5.0 WhatsApp/2.24.8');
esperar(/WhatsApp \/ Facebook/.test(mInt) && /Chrome/.test(mInt), 'En navegador interno → manda a abrir en Chrome: ' + mInt.slice(0, 45) + '…');
const mBloq = msgCon({ permiso: 'denied', prueba: false, error: { name: 'NotAllowedError' } });
esperar(/BLOQUEADO para esta p[aá]gina/.test(mBloq) && /icono \u24d8/.test(mBloq), 'Permiso denegado → explica ⓘ/🔒/⋮ → Permitir: ' + mBloq.slice(0, 45) + '…');
const mBloqAnd = msgCon({ permiso: 'denied', prueba: false, error: { name: 'NotAllowedError' } }, 'Mozilla/5.0 (Linux; Android 13) Chrome/125.0 Mobile');
esperar(/Configuración del sitio/.test(mBloqAnd) && /Conexión segura/.test(mBloqAnd) && /google\.com/.test(mBloqAnd),
  'En Chrome Android el mensaje manda a ⋮ → Configuración del sitio → "google.com": ' + mBloqAnd.slice(0, 45) + '…');
const mSist = msgCon({ permiso: 'granted', prueba: false, error: { name: 'NotAllowedError' } });
esperar(/nivel del sistema/.test(mSist), 'Permiso otorgado pero falla → apunta al sistema: ' + mSist.slice(0, 45) + '…');
const mGen = msgCon({ permiso: 'prompt', prueba: false, error: { name: 'NotAllowedError' } });
esperar(/icono \u24d8/.test(mGen), 'Estado incierto → instrucciones genéricas: ' + mGen.slice(0, 45) + '…');

// ---------- 3) Simulación del precheck de iniciarEscaneoVivo ----------
console.log('\n3) El precheck ataja SOLO cuando es NotAllowedError (las demás pasan al ladder):');
function precheck(diag) {
  if (diag && diag.prueba === false && diag.error && diag.error.name === 'NotAllowedError') return 'ATRAPADO';
  return 'LADDER';
}
esperar(precheck({ permiso: 'denied', prueba: false, error: { name: 'NotAllowedError' } }) === 'ATRAPADO', 'denied+NotAllowed → se ataja y se explica');
esperar(precheck({ permiso: 'prompt', prueba: true, error: null }) === 'LADDER', 'permiso ok → continúa al ladder');
esperar(precheck({ permiso: 'granted', prueba: true, error: null }) === 'LADDER', 'otorgado+probado → continúa al ladder');
esperar(precheck({ permiso: null, prueba: false, error: { name: 'NotFoundError' } }) === 'LADDER', 'sin cámara → continúa (el ladder maneja)');

// ---------- 3b) Categorías dinámicas (desplegable + filtros inventario/vender) ----------
console.log('\n3b) Categorías dinámicas (desplegable + filtros inventario/vender):');
const fnLista = extraerFuncion('listaDeCategorias');
const fnOpc = extraerFuncion('opcionesCategorias');
function listaCats(extra, prodsArr) {
  const CATEGORIAS = ['Materiales', 'Ferretería', 'General'];
  const S = { categoriasExtra: extra };
  const prods = function () { return prodsArr || []; };
  return new Function('CATEGORIAS', 'S', 'prods', fnLista + '; return listaDeCategorias();')(CATEGORIAS, S, prods);
}
function optsCats(extra, prodsArr, conTodos) {
  const CATEGORIAS = ['Materiales', 'General'];
  const S = { categoriasExtra: extra };
  const prods = function () { return prodsArr || []; };
  const esc = function (x) { return String(x); };
  return new Function('CATEGORIAS', 'S', 'prods', 'esc', fnLista + '; ' + fnOpc + '; return opcionesCategorias(' + (conTodos ? 'true' : 'false') + ');')(CATEGORIAS, S, prods, esc);
}
const l1 = listaCats([], [{ categoria: 'Materiales' }, { categoria: 'Pintura' }]);
esperar(l1[0] === 'General' && l1.indexOf('Pintura') >= 0 && l1.indexOf('Materiales') >= 0,
  'Categorías en uso aparecen en el desplegable (' + l1.join(', ') + ')');
const l2 = listaCats(['Instalación', 'Materiales'], [{ categoria: 'Pintura' }]);
esperar(l2.indexOf('Instalación') >= 0 && l2.indexOf('Materiales') >= 0,
  'Categoría nueva agregada aparece aunque aún no tenga productos');
const l3 = listaCats([], [{ categoria: '   Eléctrico  ' }]);
esperar(l3.indexOf('Eléctrico') >= 0, 'Se recogen y limpian las categorías escritas en los productos');
const o1 = optsCats([], [], true);
esperar(o1.indexOf('Todas las categorías') >= 0 && o1.indexOf('>General</option>') >= 0,
  'opcionesCategorias(true) incluye "Todas las categorías" y General');
const o2 = optsCats([], [], false);
esperar(o2.indexOf('Todas las categorías') < 0, 'sin "Todas" en el datalist del formulario de producto');

// ---------- 4) API de html5-qrcode 2.3.8 (desde el CDN real) ----------
console.log('\n4) API de html5-qrcode@2.3.8 (CDN real):');
const CDN = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
const http = require('https');
http.get(CDN, (r) => {
  let d = '';
  r.on('data', (c) => d += c);
  r.on('end', () => {
    esperar(/getCameras\s*[:=(]/.test(d), 'bundle 2.3.8 expone getCameras');
    esperar(/start\s*[:=(]/.test(d) && /stop\s*[:=(]/.test(d), 'bundle 2.3.8 expone start/stop');
    esperar(/Html5Qrcode/.test(d) && d.length > 100000, 'bundle íntegro (' + d.length + ' bytes)');
    console.log('\n========================================');
    console.log('RESULTADO: ' + ok + ' OK, ' + fallas + ' FALLAS');
    process.exit(fallas ? 1 : 0);
  });
}).on('error', (e) => {
  esperar(false, 'descargar bundle CDN', String(e && e.message));
  console.log('\n========================================');
  console.log('RESULTADO: ' + ok + ' OK, ' + fallas + ' FALLAS');
  process.exit(1);
});