/* ============================================================
   FRUGULLETTY — Lógica del cliente
   Se ejecuta en el navegador (Android, iPhone, PC).
   ============================================================ */

/* ---------- Estado global ---------- */
var store = {
  get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
};

var S = {
  tok: store.get('neg_tok') || '',
  usuario: store.get('neg_usr') || '',
  nombre: store.get('neg_nom') || '',
  rol: store.get('neg_rol') || '',
  perfil: store.get('neg_perfil') || '',
  perfilNombre: store.get('neg_perfil_nom') || '',
  perm: (function () { try { return JSON.parse(store.get('neg_perm') || '{}'); } catch (e) { return {}; } })(),
  tasa: null,
  fechaTasa: '',
  fuenteTasa: '',
  tasaManual: false,
  pagina: 'inicio',
  cacheProds: [],
  errProds: '',
  categoriasExtra: []
};

var usaRun = (typeof google !== 'undefined' && google.script && google.script.run);
var DEMO = !usaRun && (typeof location === 'undefined' || location.protocol === 'file:');
// URL del backend (despliegue web de Apps Script).
var URL_API = 'https://script.google.com/macros/s/AKfycbz3dtfCBfItznU4yfxeiaFYoN7SNGmAHcq5N5pFtZxA8y2lelLtn9AxF8s8Mr_dXTen/exec';
var CARRITO = [];
var _promTasa = null;
var _scan = null;
var _scanPos = null; // escáner en vivo de la caja (pestaña Vender)
var _cancelarEscaneoVivo = false; // cancela los reintentos si el usuario detiene a mitad
var escLector = { texto: '', t: 0 }; // buffer para lectores físicos USB/Bluetooth (se comportan como teclado)
var _toastT = null;
var render = {};

/* ---------- Aviso de errores inesperados en pantalla ----------
   Cualquier error no capturado se muestra arriba para que nadie quede
   "sin saber qué pasó" (ni toast ni nada). También se puede llamar con
   window.__avisar('...') desde cualquier parte del código. */
(function () {
  function avisar(msg, persistente) {
    try {
      var b = document.getElementById('alerta-js');
      if (!b) {
        b = document.createElement('div');
        b.id = 'alerta-js';
        b.style.cssText = 'position:fixed;left:8px;right:8px;top:6px;z-index:300;background:#c62828;color:#fff;padding:8px 10px;border-radius:10px;font-size:12.5px;box-shadow:0 4px 14px rgba(0,0,0,.35);display:none;cursor:pointer';
        b.title = 'Toca para cerrar este aviso';
        b.addEventListener('click', function () { b.style.display = 'none'; });
        document.body.appendChild(b);
      }
      var texto = msg || 'Error desconocido de la app.';
      b.textContent = '⚠️ ' + texto;
      b.style.display = 'block';
      clearTimeout(b._t);
      if (persistente) return;
      b._t = setTimeout(function () { b.style.display = 'none'; }, 30000);
    } catch (e) {}
  }
  window.addEventListener('error', function (ev) {
    avisar('Error de la app: ' + (ev && ev.message ? ev.message : 'desconocido'));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    avisar('Error de la app: ' + (r && r.message ? r.message : String(r)));
  });
  window.__avisar = avisar;
})();

/* ---------- Helpers básicos ---------- */
function el(id) { return document.getElementById(id); }
function pintar(html) { var c = el('contenido'); if (c) c.innerHTML = html; }
// Los productos SIEMPRE se manejan como arreglo; prods() evita errores si la lista
// llegara vacía o nula desde el servidor.
function prods() { return Array.isArray(S.cacheProds) ? S.cacheProds : []; }

/* ---------- CATEGORÍAS ----------
   La lista es DINÁMICA: categorías fijas + las que tú agregas (se guardan en
   la hoja) + las que ya están en uso en los productos. Así cada categoría
   nueva que crees aparece en el desplegable de los demás artículos. */
var _promCats = null;
function cargaCategorias() {
  if (_promCats) return _promCats;
  _promCats = apiFetch('getCategorias', [S.tok]).then(function (r) {
    S.categoriasExtra = Array.isArray(r) ? r : [];
    return S.categoriasExtra;
  }).catch(function () {
    S.categoriasExtra = [];
    return S.categoriasExtra;
  });
  return _promCats;
}
function listaDeCategorias() {
  var extra = Array.isArray(S.categoriasExtra) ? S.categoriasExtra : [];
  var set = {};
  CATEGORIAS.forEach(function (c) { if (c) set[c] = true; });
  extra.forEach(function (c) { var n = String(c || '').trim(); if (n) set[n] = true; });
  prods().forEach(function (p) {
    var c = String(p.categoria || '').trim();
    if (c) set[c] = true;
  });
  var orden = function (a, b) {
    if (a === 'General') return -1;
    if (b === 'General') return 1;
    return a.localeCompare(b);
  };
  return Object.keys(set).sort(orden);
}
function opcionesCategorias(conTodos) {
  var opts = listaDeCategorias().map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');
  return (conTodos ? '<option value="">Todas las categorías</option>' : '') + opts;
}
function refrescarSelectCategorias(id, valorActual) {
  var s = el(id);
  if (!s) return;
  var v = valorActual || s.value || '';
  s.innerHTML = opcionesCategorias(true);
  var ok = false;
  if (v) {
    Array.prototype.some.call(s.options, function (o) { if (String(o.value) === v) { ok = true; return true; } return false; });
  }
  s.value = ok ? v : '';
}
var _promProd = null;
function cargarProductos() {
  if (_promProd) return _promProd;
  _promProd = API.listarProductos().then(function (r) {
    if (Array.isArray(r)) { S.cacheProds = r; S.errProds = ''; }
    else { S.cacheProds = []; S.errProds = 'El servidor respondió sin la lista de productos.'; }
    return S.cacheProds;
  }).catch(function (e) {
    if (!Array.isArray(S.cacheProds)) S.cacheProds = [];
    S.errProds = (e && e.message) || 'No se pudieron cargar los productos. Revisa tu conexión.';
    _promProd = null; // permite reintentar la próxima vez
    return S.cacheProds;
  });
  return _promProd;
}
/* ---------- Mini-caché local (acelera el cambio de pestañas) ----------
   Guarda copias de lo último que pidió cada pantalla y las reutiliza para
   pintar AL INSTANTE, refrescando en segundo plano solo cuando pasan los
   segundos de validez. Las escrituras (vender, gastos, productos…) borran
   la copia correspondiente para que la próxima vista traiga datos frescos. */
var _CACHE = {};
function cacheSet(clave, v) {
  try { _CACHE[clave] = { v: v, t: Date.now() }; } catch (e) {}
}
function cacheGet(clave, ttl) {
  var c = _CACHE[clave];
  if (!c) return undefined;
  if (Date.now() - c.t > ttl) return undefined;
  return c.v;
}
// Borra una clave ('dashboard') o todas las de un grupo ('ventas' borra 'ventas:*').
function invalidarCache() {
  for (var i = 0; i < arguments.length; i++) {
    var k = arguments[i];
    if (!k) continue;
    if (k in _CACHE) delete _CACHE[k];
    Object.keys(_CACHE).forEach(function (kk) { if (kk.indexOf(k + ':') === 0) delete _CACHE[kk]; });
  }
}
// Trae datos SIN bloquear: si ya hay copia local, pinta al instante y refresca en
// segundo plano solo si pasó el TTL (ms). Si no hay copia, espera al servidor.
async function datosRapidos(clave, ttl, pedir, aplicar, alFallar) {
  var c = _CACHE[clave];
  if (c) {
    aplicar(c.v); // al instante
    if (Date.now() - c.t <= ttl) return;
    try {
      var v = await pedir();
      cacheSet(clave, v);
      aplicar(v);
    } catch (e) { /* se queda lo anterior en pantalla */ }
    return;
  }
  try {
    var v2 = await pedir();
    cacheSet(clave, v2);
    aplicar(v2);
  } catch (e) {
    if (alFallar) alFallar(e);
    else throw e;
  }
}

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function num(n) { return (parseFloat(n) || 0); }
function fmtNum(n) { return num(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtUSD(n) { return '$ ' + fmtNum(n); }
function fmtVES(n) { return 'Bs ' + fmtNum(n); }
function fmtCant(n) { var v = num(n); return (v % 1 === 0) ? String(v) : v.toFixed(2); }
function fechaCorta(s) { return String(s == null ? '' : s).slice(0, 10); }
function fechaHora(s) { if (!s) return '—'; return String(s).slice(0, 16).replace('T', ' '); }
function hoyLocal() {
  var d = new Date();
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  var dd = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + m + '-' + dd;
}

function toast(msg, tipo) {
  var t = el('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (tipo ? ' t-' + tipo : '');
  clearTimeout(_toastT);
  _toastT = setTimeout(function () { t.className = 'toast'; }, 2800);
}

var _modales = []; // pilas de modales: el escáner se abre ENCIMA de un formulario sin perderlo

function fondoVisible(m) {
  var fondos = m.querySelectorAll('.modal-fondo');
  return fondos.length ? fondos[fondos.length - 1] : null; // el modal actual es el último de la pila visual
}

function abrirModal(html) {
  var m = el('modal');
  var viejo = fondoVisible(m);
  if (!m.hidden && viejo) {
    _modales.push(viejo); // guardar el modal actual (con sus botones y eventos)
    viejo.style.display = 'none';
  } else {
    _modales = [];
  }
  var fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.setAttribute('onclick', 'cerrarModal()');
  var card = document.createElement('div');
  card.className = 'modal-card';
  card.setAttribute('onclick', 'event.stopPropagation()');
  card.innerHTML = html;
  fondo.appendChild(card);
  m.appendChild(fondo);
  m.hidden = false;
  document.body.classList.add('modal-abierto');
  card.scrollTop = 0;
}

function cerrarModal() {
  var m = el('modal');
  if (!m) return;
  var fondo = fondoVisible(m);
  if (fondo && _modales.length) {
    fondo.remove();
    var anterior = _modales.pop(); // restaurar el formulario que estaba debajo
    anterior.style.display = '';
    m.appendChild(anterior);
    var card = m.querySelector('.modal-card');
    if (card) card.scrollTop = 0;
  } else {
    m.hidden = true;
    m.innerHTML = '';
  }
  if (_scan) {
    try { _scan.stop(); } catch (e) {}
    try { _scan.clear(); } catch (e) {}
    _scan = null;
  }
  if (_modales.length) document.body.classList.add('modal-abierto');
  else document.body.classList.remove('modal-abierto');
}

function confirmar(mensaje) {
  return new Promise(function (resolve) {
    abrirModal('<h3>Confirmar</h3><p>' + esc(mensaje) + '</p>' +
      '<div class="modal-acciones">' +
      '<button class="btn btn-peligro" id="conf-no">Cancelar</button>' +
      '<button class="btn btn-primario" id="conf-si">Aceptar</button></div>');
    el('conf-si').addEventListener('click', function () { cerrarModal(); resolve(true); });
    el('conf-no').addEventListener('click', function () { cerrarModal(); resolve(false); });
  });
}

/* ---------- Capa de API (servidor Apps Script) ----------
   3 vías según dónde corra la app:
   - Dentro del alojamiento de Apps Script (URL script.google.com): RPC google.script.run.
   - En una página externa (host propio, localhost): HTTP fetch al despachador ?accion=.
   - Archivo local sin conexión: modo DEMO con datos simulados. */
function apiLlamada(fn, args) {
  if (usaRun) return apiRpc(fn, args);
  if (DEMO) {
    return new Promise(function (resolve, reject) {
      Promise.resolve(mockApi(fn, args)).then(resolve).catch(reject);
    });
  }
  return apiFetch(fn, args);
}

function apiRpc(fn, args) {
  return new Promise(function (resolve, reject) {
    var listo = false;
    // Nunca dejar la pantalla "colgada": si el servidor no responde en 25 s
    // se muestra un aviso claro en lugar de quedarse en silencio.
    var temporizador = setTimeout(function () {
      if (listo) return;
      listo = true;
      reject(new Error('El servidor tardó demasiado. Revisa tu conexión y vuelve a intentarlo.'));
    }, 25000);
    google.script.run
      .withSuccessHandler(function (v) {
        if (listo) return;
        listo = true;
        clearTimeout(temporizador);
        // Transporte robusto: el servidor envía las listas como texto JSON
        // (los textos siempre llegan bien; los arreglos sueltos no siempre).
        var r = v;
        if (typeof v === 'string') {
          try { r = JSON.parse(v); } catch (e) { r = v; }
        }
        resolve(r);
      })
      .withFailureHandler(function (e) {
        if (listo) return;
        listo = true;
        clearTimeout(temporizador);
        reject(new Error((e && e.message) || 'Error del servidor'));
      })[fn].apply(null, args);
  });
}

// Llamada HTTP al despachador del servidor (?accion=<función>&args=<JSON>).
// Sirve cuando la app se ejecuta desde una página que NO es el alojamiento de
// Apps Script (host propio, GitHub Pages, localhost…). Cada función del servidor
// valida su propio token; es la misma seguridad que el RPC interno.
// Introducción de 404 intermitente en la primera ejecución: se reintenta (4 veces)
// SOLO ante fallos de transporte/arranque; los errores lógicos del servidor
// (ok:false, ej. "usuario incorrecto") se devuelven de inmediato, sin esperas.
function pausa(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function apiFetch(fn, args) {
  var url = URL_API + '?accion=' + encodeURIComponent(fn) + '&args=' + encodeURIComponent(JSON.stringify(args || []));
  var ultimo = null;
  for (var i = 0; i < 4; i++) {
    var r;
    try { r = await fetch(url); }
    catch (e) { ultimo = e; await pausa(1400); continue; }
    if (r.status === 404) { await pausa(1400); continue; }
    var o;
    try { o = await r.json(); } catch (e) { ultimo = e; await pausa(1400); continue; }
    if (!o || o.ok !== true) throw new Error((o && o.error) || 'Servidor sin respuesta');
    var v = o.r;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (e) {}
    }
    return v;
  }
  throw new Error((ultimo && ultimo.message) || 'El servidor no respondió. Revisa tu conexión.');
}

var API = {
  login: function (u, p) { return apiLlamada('login', [u, p]); },
  logout: function () { return apiLlamada('logout', [S.tok]); },
  cambiarPassword: function (a, b) { return apiLlamada('cambiarPassword', [S.tok, a, b]); },
  resetearPassword: function (u, n) { return apiGrabar('resetearPassword', [S.tok, u, n], ['usuarios']); },
  crearUsuario: function (d) { return apiGrabar('crearUsuario', [S.tok, d], ['usuarios']); },
  listarUsuarios: function () { return apiLlamada('listarUsuarios', [S.tok]); },
  cambiarEstadoUsuario: function (u, a) { return apiGrabar('cambiarEstadoUsuario', [S.tok, u, a], ['usuarios', 'empleados', 'dashboard']); },
  cambiarRolUsuario: function (u, r) { return apiGrabar('cambiarRolUsuario', [S.tok, u, r], ['usuarios']); },
  misPermisos: function () { return apiLlamada('misPermisos', [S.tok]); },
  listarPerfiles: function () { return apiLlamada('listarPerfiles', [S.tok]); },
  guardarPerfil: function (d) { return apiGrabar('guardarPerfil', [S.tok, d], ['perfiles', 'usuarios']); },
  eliminarPerfil: function (p) { return apiGrabar('eliminarPerfil', [S.tok, p], ['perfiles', 'usuarios']); },
  cambiarPerfilUsuario: function (u, p) { return apiGrabar('cambiarPerfilUsuario', [S.tok, u, p], ['usuarios']); },
  getTasaVigente: function () { return apiLlamada('getTasaVigente', [S.tok]); },
  actualizarTasa: function () { return apiGrabar('actualizarTasa', [S.tok], ['dashboard']); },
  setTasaManual: function (t) { return apiGrabar('setTasaManual', [S.tok, t], ['dashboard']); },
  quitarTasaManual: function () { return apiGrabar('quitarTasaManual', [S.tok], ['dashboard']); },
  listarProductos: function () { return apiLlamada('listarProductos', [S.tok]); },
  guardarProducto: function (p) { return apiGrabar('guardarProducto', [S.tok, p], ['productos', 'dashboard']); },
  getZonasDelivery: function () { return apiLlamada('getZonasDelivery', []); },
  guardarZonasDelivery: function (z) { return apiGrabar('guardarZonasDelivery', [S.tok, z], []); },
  getPrecioEnvio: function () { return apiLlamada('getPrecioEnvio', []); },
  setPrecioEnvioNacional: function (p) { return apiGrabar('setPrecioEnvioNacional', [S.tok, p], []); },
  infoServidor: function () { return apiLlamada('infoServidor', []); },
  ajustarStock: function (c, q, m) { return apiGrabar('ajustarStock', [S.tok, c, q, m], ['productos', 'dashboard']); },
  buscarPorCodigo: function (c) { return apiLlamada('buscarPorCodigo', [S.tok, c]); },
  registrarVenta: function (d) { return apiGrabar('registrarVenta', [S.tok, d], ['ventas', 'dashboard']); },
  listarVentas: function (f) { return apiLlamada('listarVentas', [S.tok, f || {}]); },
  listarGastos: function (f) { return apiLlamada('listarGastos', [S.tok, f || {}]); },
  guardarGasto: function (g) { return apiGrabar('guardarGasto', [S.tok, g], ['gastos', 'dashboard']); },
  eliminarGasto: function (id) { return apiGrabar('eliminarGasto', [S.tok, id], ['gastos', 'dashboard']); },
  listarEmpleados: function () { return apiLlamada('listarEmpleados', [S.tok]); },
  guardarEmpleado: function (e) { return apiGrabar('guardarEmpleado', [S.tok, e], ['empleados', 'dashboard']); },
  listarSueldos: function (f) { return apiLlamada('listarSueldos', [S.tok, f || {}]); },
  registrarSueldo: function (s) { return apiGrabar('registrarSueldo', [S.tok, s], ['sueldos', 'nomina', 'dashboard']); },
  cambiarEstadoSueldo: function (id, e) { return apiGrabar('cambiarEstadoSueldo', [S.tok, id, e], ['sueldos', 'nomina', 'dashboard']); },
  // --- Nómina con sueldo diario (V2.2) ---
  getNomina: function () { return apiLlamada('getNomina', [S.tok]); },
  diasPendientes: function (empleado_id) { return apiLlamada('diasPendientes', [S.tok, empleado_id]); },
  registrarPagoSueldo: function (d) { return apiGrabar('registrarPagoSueldo', [S.tok, d], ['sueldos', 'nomina', 'dashboard']); },
  corridaNominaManual: function () { return apiGrabar('corridaNominaManual', [S.tok], ['sueldos', 'nomina', 'dashboard']); },
  instalarTriggersNomina: function () { return apiGrabar('instalarTriggersNomina', [S.tok], []); },
  estadoTriggersNomina: function () { return apiLlamada('estadoTriggersNomina', [S.tok]); },
  listarRemodelaciones: function () { return apiLlamada('listarRemodelaciones', [S.tok]); },
  guardarRemodelacion: function (r) { return apiGrabar('guardarRemodelacion', [S.tok, r], ['remodelaciones']); },
  listarRemodGastos: function (rid) { return apiLlamada('listarRemodGastos', [S.tok, rid]); },
  guardarRemodGasto: function (g) { return apiGrabar('guardarRemodGasto', [S.tok, g], ['remodgastos', 'remodelaciones']); },
  eliminarRemodGasto: function (id) { return apiGrabar('eliminarRemodGasto', [S.tok, id], ['remodgastos']); },
  getDashboard: function () { return apiLlamada('getDashboard', [S.tok]); },
  reporteComparativo: function (tipo, a, b) { return apiLlamada('reporteComparativo', [S.tok, tipo, a, b]); }
};

// Las escrituras borran la caché local de lo que cambian, para que la siguiente
// visita a esa pantalla traiga datos frescos sin esperar al TTL.
function apiGrabar(fn, args, claves) {
  return apiLlamada(fn, args).then(function (r) {
    invalidarCache.apply(null, claves);
    if (claves.indexOf('productos') >= 0) _promProd = null; // el inventario cambió: recargar
    return r;
  });
}

/* ---------- Modo DEMO (sin servidor, para probar la interfaz) ---------- */
function mockApi(fn, args) {
  var tasaMock = { tasa: 853.50, fecha: '2026-09-23', fuente: 'bcv_api', historico: [{ fecha: '2026-09-23', tasa: 853.50 }] };
  var prods = [
    { codigo: 'MK-001', nombre: 'Labial mate rojo', categoria: 'Labiales', precio_usd: 6.5, costo_usd: 3.2, stock: 40, stock_min: 10, activo: 1, imagen: '', creado: '2026-09-01' },
    { codigo: 'MK-002', nombre: 'Base líquida tono medio', categoria: 'Bases', precio_usd: 12, costo_usd: 7.5, stock: 8, stock_min: 10, activo: 1, imagen: '', creado: '2026-09-01' },
    { codigo: 'MK-003', nombre: 'Paleta de sombras 12 tonos', categoria: 'Ojos', precio_usd: 15, costo_usd: 9, stock: 25, stock_min: 6, activo: 1, imagen: '', creado: '2026-08-15' },
    { codigo: 'MK-004', nombre: 'Rubor en polvo', categoria: 'Rubor', precio_usd: 8, costo_usd: 4.5, stock: 3, stock_min: 5, activo: 1, imagen: '', creado: '2026-07-10' }
  ];
  var map = {
    login: function () { return { ok: true, token: 'demo', usuario: 'admin', nombre: 'Administrador (Demo)', rol: 'admin', perfil: '', perfilNombre: 'Administrador', permisos: { inicio: 'editar', vender: 'editar', productos: 'editar', ventas: 'editar', reportes: 'editar', gastos: 'editar', nomina: 'editar', remodelaciones: 'editar', admin: 'editar' } }; },
    misPermisos: function () { return { rol: 'admin', perfil: '', perfilNombre: 'Administrador', permisos: { inicio: 'editar', vender: 'editar', productos: 'editar', ventas: 'editar', reportes: 'editar', gastos: 'editar', nomina: 'editar', remodelaciones: 'editar', admin: 'editar' } }; },
    getDashboard: function () {
      return {
        tasa: tasaMock,
        ventasHoy: { cantidad: 12, usd: 845.2, ves: 721378 },
        ventasMes: { cantidad: 310, usd: 21590, ves: 18427350 },
        gastosMes: { cantidad: 8, usd: 1250 },
        sueldosPagadosMes: { cantidad: 1, usd: 30 },
        egresosMes: { cantidad: 9, usd: 1280 },
        sueldosPendientes: { dias: 2, usd: 40 },
        stockBajo: [prods[1], prods[3]],
        totalProductos: prods.length
      };
    },
    getTasaVigente: function () { return tasaMock; },
    actualizarTasa: function () { return tasaMock; },
    setTasaManual: function () { return tasaMock; },
    quitarTasaManual: function () { return tasaMock; },
    listarProductos: function () { return prods; },
    buscarPorCodigo: function () { return null; },
    listarVentas: function () {
      return [
        { id: 'V1', fecha: '2026-09-23T10:15:00', vendedor: 'admin', empleado_nombre: 'Administrador (Demo)', items: JSON.stringify([{ codigo: 'MK-001', nombre: 'Labial mate rojo', cantidad: 2, precio_usd: 6.5, sub_usd: 13 }]), metodo: 'efectivo_usd', total_usd: 13, tasa: 853.5, total_ves: 11095.5, nota: '' },
        { id: 'V2', fecha: '2026-09-23T11:30:00', vendedor: 'admin', empleado_nombre: 'Administrador (Demo)', items: '[]', metodo: 'transferencia', total_usd: 22.5, tasa: 853.5, total_ves: 19203.75, nota: '' }
      ];
    },
    listarGastos: function () { return [{ id: 'G1', fecha: '2026-09-22', concepto: 'Compra de labiales', categoria: 'Mercancía', monto_usd: 20, responsable: '', nota: '' }]; },
    listarUsuarios: function () { return [{ usuario: 'admin', nombre: 'Administrador', rol: 'admin', activo: 1, perfil: '', perfilNombre: 'Administrador' }, { usuario: 'caja', nombre: 'Cajero', rol: 'empleado', activo: 1, perfil: 'cajero', perfilNombre: 'Cajero' }]; },
    listarPerfiles: function () { return [
      { perfil: 'administrador', nombre: 'Administrador', activo: 1, sistema: true, permisos: { inicio: 'editar', vender: 'editar', productos: 'editar', ventas: 'editar', reportes: 'editar', gastos: 'editar', nomina: 'editar', remodelaciones: 'editar', admin: 'editar' } },
      { perfil: 'vendedor', nombre: 'Vendedor', activo: 1, sistema: false, permisos: { inicio: 'ver', vender: 'editar', productos: 'ver', ventas: 'ver', reportes: 'none', gastos: 'none', nomina: 'none', remodelaciones: 'none', admin: 'none' } },
      { perfil: 'cajero', nombre: 'Cajero', activo: 1, sistema: false, permisos: { inicio: 'ver', vender: 'editar', productos: 'none', ventas: 'ver', reportes: 'ver', gastos: 'none', nomina: 'none', remodelaciones: 'none', admin: 'none' } }
    ]; },
    guardarPerfil: function () { return { ok: true, perfil: 'nuevo' }; },
    eliminarPerfil: function () { return { ok: true }; },
    cambiarPerfilUsuario: function () { return { ok: true }; },
    listarEmpleados: function () { return [{ id: 'E1', nombre: 'Karelys', cargo: 'Vendedora', salario_usd: 10, sueldo_diario: 10, dias_semana: '1,2,3,4,5', fecha_ingreso: '2026-01-10', activo: 1 }]; },
    listarSueldos: function () { return [{ id: 'S1', empleado_id: 'E1', empleado_nombre: 'Karelys', periodo: '2026-09', fecha_dia: '2026-09-23', fecha_pago: '', monto_usd: 10, estado: 'pendiente', nota: '' }]; },
    getNomina: function () { return { esAdmin: true, mes: '2026-09', empleados: [{ id: 'E1', nombre: 'Karelys', cargo: 'Vendedora', activo: 1, sueldo_diario: 10, dias_semana: '1,2,3,4,5', dias_txt: 'Lun · Mar · Mié · Jue · Vie', fecha_ingreso: '2026-01-10', pend_dias: 2, pend_usd: 20 }], kpis: { pend_usd: 20, pend_dias: 2, pag_mes_usd: 30, pag_mes_dias: 3 }, pagos: [{ fecha: '2026-09-23', empleado: 'Karelys', dias: 3, usd: 30 }] }; },
    diasPendientes: function () { return [{ id: 'S1', fecha_dia: '2026-09-23', periodo: '2026-09', monto_usd: 10, nota: '' }, { id: 'S2', fecha_dia: '2026-09-24', periodo: '2026-09', monto_usd: 10, nota: '' }]; },
    registrarPagoSueldo: function () { return { ok: true, pagados: 2, faltas: 0, total_usd: 20 }; },
    estadoTriggersNomina: function () { return { total: 2 }; },
    listarRemodelaciones: function () { return [{ id: 'R1', nombre: 'Adecuación del local', tipo: 'Remodelación', descripcion: 'Pintura y estantes', estado: 'En progreso', progreso: 60, fecha_inicio: '2026-08-01', fecha_fin_estimada: '2026-10-15' }]; },
    listarRemodGastos: function () { return []; }
  };
  var f = map[fn];
  if (!f) return Promise.resolve({ ok: true });
  try { return Promise.resolve(f.apply(null, args)); }
  catch (e) { return Promise.reject(e); }
}

/* ---------- Tasa de cambio ---------- */
function actualizarChipTasa() {
  var chip = el('chip-tasa');
  if (!chip) return;
  chip.textContent = (S.tasa ? 'Bs ' + fmtNum(S.tasa) + ' / $' + (S.tasaManual ? ' · manual' : '') : 'Tasa: …');
  chip.classList.toggle('desactivado', !S.tasa);
}

async function refrescarTasa() {
  try {
    var t = await API.getTasaVigente();
    if (t && typeof t === 'object') {
      S.tasa = num(t.tasa);
      S.fechaTasa = t.fecha || '';
      S.fuenteTasa = t.fuente || '';
      S.tasaManual = !!t.manual;
    }
    actualizarChipTasa();
  } catch (e) {
    _promTasa = null;
  }
}

function cargarTasaSiYace() {
  if (!_promTasa) _promTasa = refrescarTasa();
  return _promTasa;
}

/* ---------- Escáner de códigos (QR y barras) ---------- */
// La librería html5-qrcode se descarga SOLO cuando el usuario abre el escáner
// (no al cargar la app), para que las pestañas carguen más rápido en el celular.
var _promQr = null;
function cargarLibQr() {
  if (typeof Html5Qrcode !== 'undefined') return Promise.resolve(true);
  if (_promQr) return _promQr;
  _promQr = new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.onload = function () { res(true); };
    s.onerror = function () { _promQr = null; rej(new Error('No se pudo descargar la librería del escáner. Revisa tu conexión a internet.')); };
    document.head.appendChild(s);
  });
  return _promQr;
}

async function abrirScanner(onDetect) {
  try { await cargarLibQr(); }
  catch (e) { toast(e.message, 'error'); return; }
  abrirModal(
    '<div class="modal-tope"><h3>📷 Leer código</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<p class="muted">Elige cómo quieres leer el código de barras o QR:</p>' +
    '<div style="display:grid;gap:10px;margin-top:12px">' +
    '<button class="btn btn-primario btn-ancho" id="scan-foto">📸 Abrir la cámara y tomar foto</button>' +
    '<button class="btn btn-ancho" id="scan-galeria">🖼️ Elegir de la galería</button>' +
    '<button class="btn btn-ancho" id="scan-vivo">🎥 Escanear en vivo</button>' +
    '</div>' +
    '<div id="qr-reader" style="margin-top:12px;display:none"></div>' +
    '<p class="muted" id="scan-estado" style="margin-top:10px"></p>' +
    '<input type="file" accept="image/*" capture="environment" id="scan-fich-cam" tabindex="-1" style="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0">' +
    '<input type="file" accept="image/*" id="scan-fich-gal" tabindex="-1" style="position:fixed;top:0;left:0;width:1px;height:1px;opacity:0">' +
    '<div id="qr-foto" style="display:none"></div>' +
    '<div class="fila-botones"><button class="btn btn-suave btn-ancho" onclick="cerrarModal()">Cancelar</button></div>'
  );
  var MAX_BORDE = 1000; // foto reducida: suficiente para leer códigos y ligera para el telefono
  var prepararFoto = function (file, cb) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    var liberar = function () { try { URL.revokeObjectURL(url); } catch (e) {} };
    img.onload = function () {
      liberar();
      var w = img.naturalWidth || 0, h = img.naturalHeight || 0;
      if (!w || !h) { cb(null); return; }
      var esc = Math.min(1, MAX_BORDE / Math.max(w, h));
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * esc));
      cv.height = Math.max(1, Math.round(h * esc));
      var ctx = null;
      try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
      if (!ctx) { cb(null); return; }
      try { ctx.drawImage(img, 0, 0, cv.width, cv.height); } catch (e) { cb(null); return; }
      try { img.src = ''; } catch (e) {}
      cb(cv);
    };
    img.onerror = function () { liberar(); cb(null); };
    try { img.src = url; } catch (e) { liberar(); cb(null); }
  };
  var rotar = function (cv, grados) {
    var w = cv.width, h = cv.height;
    var r = document.createElement('canvas');
    if (grados === 90 || grados === -90 || grados === 270) { r.width = h; r.height = w; } else { r.width = w; r.height = h; }
    var ctx = r.getContext('2d');
    if (!ctx) return cv;
    ctx.translate(r.width / 2, r.height / 2);
    ctx.rotate(grados * Math.PI / 180);
    ctx.drawImage(cv, -w / 2, -h / 2);
    return r;
  };
  var decodificarFoto = function (input) {
    var f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    var estado = el('scan-estado');
    var qr;
    try { qr = new Html5Qrcode('qr-foto'); } catch (e) { qr = null; }
    estado.textContent = 'Preparando la foto…';
    try {
      prepararFoto(f, function (canvas) {
        if (!canvas) {
          estado.textContent = 'No se pudo abrir la foto tomada. Inténtalo de nuevo.';
          return;
        }
        var versiones;
        try { versiones = [canvas, rotar(canvas, 90), rotar(canvas, 270)]; } catch (e) { versiones = [canvas]; }
        var exito = function (texto) {
          var c = String(texto || '').trim();
          if (!c) return false;
          cerrarModal();
          if (onDetect) onDetect(c);
          return true;
        };
        // 1) Lector NATIVO del navegador (exacto para barras EAN/UPC/Code128 y QR).
        var bd = null;
        try {
          if (window.BarcodeDetector) {
            bd = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'codabar', 'itf', 'qr_code', 'data_matrix', 'aztec'] });
          }
        } catch (e2) { bd = null; }
        // 2) Respaldo: lector JS clásico sobre la imagen.
        function probarConHtml5() {
          if (!qr) {
            estado.textContent = 'El lector no pudo iniciarse. Toca ✕ y escribe el código a mano.';
            return;
          }
          var i = 0;
          var siguiente = function () {
            if (i >= versiones.length) {
              estado.textContent = 'No encontré el código en la foto 🤔. Acércate, enfoca bien y que el código quede completo y con buena luz. Si no funciona, toca ✕ y escríbelo a mano.';
              return;
            }
            var cnv = versiones[i++];
            estado.textContent = 'Leyendo el código…';
            var img = new Image();
            img.onload = function () {
              var prom;
              try { prom = qr.decodeFromImageElement(img); }
              catch (e) { siguiente(); return; }
              prom.then(function (texto) { if (!exito(texto)) siguiente(); }).catch(function () { siguiente(); });
            };
            img.onerror = function () { siguiente(); };
            var data;
            try { data = cnv.toDataURL('image/jpeg', 0.9); } catch (e) { siguiente(); return; }
            img.src = data;
          };
          siguiente();
        }
        function siguienteBd() {
          if (ibd >= versiones.length) { probarConHtml5(); return; }
          estado.textContent = 'Leyendo el código…';
          bd.detect(versiones[ibd++]).then(function (res) {
            var ok = false;
            try { if (res && res.length && res[0].rawValue) ok = exito(res[0].rawValue); } catch (e3) { ok = false; }
            if (!ok) siguienteBd();
          }).catch(function () { siguienteBd(); });
        }
        var ibd = 0;
        if (bd) siguienteBd(); else probarConHtml5();
      });
    } catch (e) {
      estado.textContent = 'No se pudo procesar la foto. Toca ✕ y escribe el código a mano.';
    }
  };
  el('scan-foto').addEventListener('click', function () { el('scan-fich-cam').click(); });
  el('scan-galeria').addEventListener('click', function () { el('scan-fich-gal').click(); });
  el('scan-fich-cam').addEventListener('change', function () { decodificarFoto(this); });
  el('scan-fich-gal').addEventListener('change', function () { decodificarFoto(this); });
  el('scan-vivo').addEventListener('click', function () {
    var estado = el('scan-estado');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      estado.textContent = 'Este navegador no permite la cámara en vivo desde esta página. Usa "Abrir la cámara y tomar foto".';
      return;
    }
    el('qr-reader').style.display = 'block';
    estado.textContent = 'Apuntando… acepta el permiso de la cámara si te lo pide.';
    var qr = new Html5Qrcode('qr-reader');
    _scan = qr;
    var detener = function () {
      if (!_scan) return;
      try { _scan.stop(); } catch (e) {}
      try { _scan.clear(); } catch (e) {}
      _scan = null;
    };
    qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 160 } },
      function (texto) {
        detener();
        cerrarModal();
        if (onDetect) onDetect(String(texto || '').trim());
      },
      function () {}).catch(function (e) {
      detener();
      el('qr-reader').style.display = 'none';
      if (e && e.name === 'NotAllowedError') {
        estado.textContent = 'Permiso de cámara bloqueado para esta página. Para el escáner en vivo: toca el icono ⓘ (o candado 🔒) a la izquierda de la barra de dirección → Permisos → Cámara → Permitir y recarga. La opción "Abrir la cámara y tomar foto" no necesita permiso y siempre funciona.';
        toast('Cámara en vivo bloqueada — "Abrir la cámara y tomar foto" funciona sin permiso.', 'error');
      } else {
        estado.textContent = 'No se pudo abrir la cámara. Usa "Abrir la cámara y tomar foto".';
        toast('No se pudo abrir la cámara: ' + ((e && e.message) || e), 'error');
      }
    });
  });
}

/* ---------- Escáner EN VIVO para la caja (Vender) ---------- */
// Funciona como un lector de supermercado: la cámara queda a la espera y cada
// código que aparezca se agrega a la factura sin cerrar la cámara entre artículos.
function estadoEscaneoVivo(activo) {
  var ini = el('pos-live-ini'); if (ini) ini.style.display = activo ? 'none' : '';
  var det = el('pos-live-det'); if (det) det.style.display = activo ? '' : 'none';
}

function detenerEscaneoVivo() {
  _cancelarEscaneoVivo = true;
  var acc = el('pos-live-acc'); if (acc) acc.innerHTML = '';
  if (!_scanPos) { estadoEscaneoVivo(false); return; }
  var q = _scanPos; _scanPos = null;
  try { q.stop().catch(function () {}).then(function () { try { q.clear(); } catch (e2) {} }); }
  catch (e) { try { q.clear(); } catch (e2) {} }
  estadoEscaneoVivo(false);
  var msg = el('pos-live-msg');
  if (msg) msg.textContent = 'Escáner detenido. Toca "▶ Iniciar escáner" para volver a escanear.';
}

/* ---------- Diagnóstico del permiso de cámara ----------
   Hay DOS caminos de cámara:
   - "📸 Foto / galería" (y el escáner del inventario): abre la app de cámara del
     teléfono. NO pide permiso web → funciona siempre (probablemente es lo que usó
     el usuario y por eso "sí le funcionó la cámara en Chrome").
   - "▶ Escáner en vivo": usa la cámara DENTRO de la página (getUserMedia) → exige
     el permiso "Cámara" del navegador para este sitio.
   estadoCamara() devuelve el estado real para explicar al usuario cuál está fallando. */
var _diagCamara = null;
async function estadoCamara() {
  var r = { soporte: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia), permiso: null, prueba: null, error: null };
  if (!r.soporte) return r;
  try {
    if (navigator.permissions && navigator.permissions.query) {
      var s = await navigator.permissions.query({ name: 'camera' });
      r.permiso = (s && s.state) || null; // 'granted' | 'denied' | 'prompt'
    }
  } catch (e) {}
  try {
    var st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    r.prueba = true;
    st.getTracks().forEach(function (t) { t.stop(); });
  } catch (e) {
    r.prueba = false;
    r.error = e;
  }
  return r;
}

function navegadorInterno() {
  var ua = (navigator.userAgent || '') + ' ' + (navigator.vendor || '');
  return /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|\bLine\/|Twitter|MicroMessenger|Snapchat|TikTok/i.test(ua);
}

function chromeAndroid() {
  var ua = navigator.userAgent || '';
  return /Android/i.test(ua) && /Chrome\//i.test(ua) && !/OPR\/|EdgA|MiuiBrowser|FBAN|Instagram|WhatsApp/i.test(ua);
}

function mensajePermisoCam() {
  if (navegadorInterno()) {
    return '📱 Esta vista (WhatsApp / Facebook / Instagram u otro) NO permite usar la cámara en vivo dentro del chat. Toca el menú ⋮ (arriba a la derecha) → "Abrir en Chrome" (o copia el enlace y pégalo en Chrome), entra de nuevo y todo funcionará.';
  }
  var d = _diagCamara;
  if (d && d.permiso === 'denied') {
    if (chromeAndroid()) {
      return '🔒 Permiso de cámara bloqueado para esta página. Lo que ves es NORMAL: el candado ⓘ solo dice "Conexión segura" y en el menú ⋮ NO existe "Permisos". El permiso se cambia en: ⋮ → Configuración → Configuración del sitio → busca "script.google.com" → Cámara → Permitir (si no aparece, toca "Todos los sitios"). Revisa también: Ajustes del teléfono → Aplicaciones → Chrome → Permisos → Cámara. Vuelve y toca "🔄 Ya lo activé — probar de nuevo".';
    }
    return '🔒 El permiso de cámara está BLOQUEADO para esta página. "📸 Foto / galería" no necesita permiso y siempre funciona (por eso te funcionó). Para el escáner en vivo: toca el icono ⓘ (o candado 🔒) a la IZQUIERDA de la barra de dirección, o el menú ⋮ del navegador, busca Permisos → Cámara → Permitir, y recarga la página.';
  }
  if (d && d.permiso === 'granted') {
    return '📱 El permiso de cámara de Chrome en este teléfono está apagado a nivel del sistema: Ajustes → Aplicaciones → Chrome → Permisos → Cámara → Permitir, y vuelve a iniciar.';
  }
  if (chromeAndroid()) {
    return 'Permiso de cámara bloqueado por esta página. Es normal que el candado ⓘ solo diga "Conexión segura" y que el menú ⋮ no traiga "Permisos": ese permiso vive en ⋮ → Configuración → Configuración del sitio → "script.google.com" → Cámara → Permitir. Vuelve y toca "🔄 Ya lo activé — probar de nuevo".';
  }
  return 'Permiso de cámara bloqueado por esta página. En Chrome toca el icono ⓘ (o candado 🔒) junto a la dirección → Permisos → Cámara → Permitir y vuelve a iniciar. También puedes usar "📸 Foto / galería".';
}

function mostrarFalloPos(mensaje, e) {
  detenerEscaneoVivo();
  var ms = el('pos-live-msg');
  var detalle = e ? (((e && e.name) || '') + ((e && e.message) ? ': ' + e.message : '')) : '';
  if (ms) ms.textContent = mensaje + (detalle ? ' (' + detalle + ')' : '');
  var acc = el('pos-live-acc');
  if (acc) {
    acc.innerHTML = '<button class="btn btn-ancho" id="pos-live-reintentar">🔄 Ya lo activé — probar de nuevo</button>';
    el('pos-live-reintentar').addEventListener('click', function () {
      acc.innerHTML = '';
      iniciarEscaneoVivo();
    });
  }
  if (e) toast('No se pudo abrir la cámara en vivo (' + detalle + ').', 'error');
}

function ayudaCamara() {
  abrirModal(
    '<div class="modal-tope"><h3>📷 Cámara: por qué a veces no abre</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<p class="muted">Hay dos formas de leer códigos:</p>' +
    '<div class="tarjeta" style="margin-bottom:8px">' +
    '<b>▶ Escáner en vivo</b> (el de la caja): usa la cámara <i>dentro</i> de la página y necesita el permiso "Cámara" del navegador para este sitio.<br>' +
    '<b>📸 Foto / galería</b>: abre la app de cámara del teléfono. Funciona siempre, sin permiso web. Si agregaste un código con la cámara y funcionó, fue por esta vía.' +
    '</div>' +
    '<h3 style="font-size:15px">Cómo activar el escáner en vivo</h3>' +
    '<div class="detalle-venta">' +
    '<div class="d-lin"><span>1. ⋮ (menú, arriba a la derecha) → Configuración → Configuración del sitio</span></div>' +
    '<div class="d-lin"><span>2. Busca "script.google.com" → Cámara → "Permitir"</span></div>' +
    '<div class="d-lin"><span>3. Vuelve aquí y toca ▶ Iniciar escáner (o el botón "🔄 Ya lo activé")</span></div>' +
    '</div>' +
    '<p class="muted">Es normal que el candado ⓘ solo diga "Conexión segura" y que el menú ⋮ no traiga "Permisos": ese permiso vive en ⋮ → Configuración → Configuración del sitio → "script.google.com" → Cámara → "Permitir". Si el sitio no aparece en la lista, toca "Todos los sitios". Y revisa también: Ajustes del teléfono → Aplicaciones → Chrome → Permisos → Cámara → Permitir.</p>' +
    '<div class="fila-botones"><button class="btn btn-primario btn-ancho" id="cam-comprobar">🔍 Comprobar permiso ahora</button></div>' +
    '<p class="muted" id="cam-resultado"></p>' +
    '<div class="fila-botones"><button class="btn btn-suave btn-ancho" onclick="cerrarModal()">Cerrar</button></div>'
  );
  el('cam-comprobar').addEventListener('click', async function () {
    var out = el('cam-resultado');
    out.textContent = 'Comprobando…';
    if (navegadorInterno()) {
      out.textContent = '📱 Estás en la vista de WhatsApp/Facebook/Instagram. Esta vista no permite cámara web: abre el enlace en Chrome y repite aquí.';
      return;
    }
    var d = await estadoCamara();
    var partes = [];
    var nombre = { granted: 'OTORGADO ✅', denied: 'BLOQUEADO ❌', prompt: 'Aún sin decidir (Chrome preguntará al iniciar)' };
    partes.push('Permiso de esta página: ' + (nombre[d.permiso] || 'no consultable'));
    if (d.prueba === true) partes.push('Cámara en vivo: DISPONIBLE ✅');
    else if (d.prueba === false) partes.push('Cámara en vivo: NO disponible ❌ (' + ((d.error && d.error.name) || 'error') + ')');
    else partes.push('Este navegador no permite cámara en vivo');
    out.textContent = partes.join(' · ');
    if (d.permiso === 'denied') out.textContent += ' → El permiso está guardado para ' + location.origin + ': se desbloquea con ⋮ → Configuración → Configuración del sitio → ' + location.hostname + ' → Cámara → Permitir (mira los pasos de arriba). La "📸 Foto / galería" mientras tanto sigue funcionando.';
    else if (d.prueba === true && d.permiso === 'granted') out.textContent += ' ✅ En ' + location.origin + ' todo listo: puedes cerrar este aviso y tocar ▶ Iniciar escáner.';
  });
}

async function iniciarEscaneoVivo() {
  try { await cargarLibQr(); }
  catch (e) {
    var mq = el('pos-live-msg');
    if (mq) mq.textContent = e.message;
    toast(e.message, 'error');
    return;
  }
  if (_scanPos) return;
  _cancelarEscaneoVivo = false;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    var m0 = el('pos-live-msg');
    if (m0) m0.textContent = 'Este navegador no permite la cámara en vivo. Usa "📸 Foto / galería" o escribe el código.';
    return;
  }
  estadoEscaneoVivo(true);
  var acc = el('pos-live-acc'); if (acc) acc.innerHTML = '';
  var m = el('pos-live-msg');
  if (m) m.textContent = 'Abriendo la cámara… acepta el permiso si te lo pide.';
  // Diagnóstico real del permiso: si Chrome ya lo tiene bloqueado, avisamos con
  // precisión en vez de reintentar a ciegas (la "📸 Foto / galería" usa la app de
  // cámara del teléfono y funciona sin este permiso, por eso esa vía sí funciona).
  var diag = await estadoCamara();
  _diagCamara = diag;
  if (diag && diag.prueba === false && diag.error && diag.error.name === 'NotAllowedError') {
    mostrarFalloPos(mensajePermisoCam(), diag.error);
    return;
  }
  var ult = { codigo: '', t: 0 };
  var onCode = function (texto) {
    var c = String(texto || '').trim();
    if (!c) return;
    var a = Date.now();
    if (c === ult.codigo && a - ult.t < 1400) return; // evita sumar el mismo código repetido
    ult.codigo = c; ult.t = a;
    agregarAlCarrito(c, 1);
    var p = prods().find(function (x) { return String(x.codigo).trim() === c; });
    var msg = el('pos-live-msg');
    if (msg) msg.textContent = '✅ ' + (p ? p.nombre : c) + ' añadido. Sigue escaneando…';
    try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) {}
  };
  // Visor que SIEMPRE cabe en la pantalla (si no cabe, el lector se niega a iniciar).
  var cfg = {
    fps: 10,
    qrbox: function (vw, vh) {
      return { width: Math.max(140, Math.min(260, vw - 30)), height: Math.max(90, Math.min(150, vh - 30)) };
    }
  };
  // Intenta en orden: cámara trasera explícita → 'environment' → cualquier cámara.
  var falloFinal = function (mensaje, e) {
    detenerEscaneoVivo();
    var ms = el('pos-live-msg');
    var detalle = e ? ((e.name || '') + (e.message ? ': ' + e.message : '')) : '';
    if (ms) ms.textContent = mensaje + (detalle ? ' (' + detalle + ')' : '');
    if (e) toast('No se pudo abrir la cámara (' + detalle + ').', 'error');
  };
  var pasos = ['trasera', 'environment', 'cualquiera'];
  var paso = 0;
  var iniciarCon = function (contras) {
    if (_cancelarEscaneoVivo) return;
    var qr;
    try { qr = new Html5Qrcode('pos-live'); }
    catch (e) { falloFinal('No se pudo iniciar el lector.', e); return; }
    _scanPos = qr;
    var listo = false;
    // Vigilante: si la cámara no llega a abrirse en 12 s, se pasa a la siguiente
    // configuración en vez de quedarse colgado con el mensaje "abriendo…".
    var reloj = setTimeout(function () {
      if (_cancelarEscaneoVivo || listo) return;
      if (m) m.textContent = 'La cámara tardó en abrirse… probando otra configuración.';
      var q0 = _scanPos; _scanPos = null;
      try { if (q0) q0.stop().catch(function () {}); } catch (e2) {}
      try { if (q0) q0.clear(); } catch (e2) {}
      probarSiguiente({ name: 'TimeoutError', message: 'la cámara tardó en abrirse' });
    }, 12000);
    qr.start(contras || {}, cfg, onCode, function () {}).then(function () {
      listo = true; clearTimeout(reloj);
      if (_cancelarEscaneoVivo) { detenerEscaneoVivo(); return; }
      // Verifica que el video REALMENTE esté corriendo (algunos equipos inician
      // sin entregar imagen y eso antes pasaba como "éxito" aunque no veías nada).
      var vid = document.querySelector('#pos-live video');
      var anunciar = function () {
        if (m) m.textContent = '✅ Escáner listo: queda a la espera. Pasa cada artículo por la cámara.';
      };
      var verificar = function (intentos) {
        if (_cancelarEscaneoVivo) return;
        var ok = !vid || (vid.readyState >= 2 && !vid.paused);
        if (ok) { anunciar(); return; }
        if (intentos <= 0) {
          var q0 = _scanPos; _scanPos = null;
          try { if (q0) q0.stop().catch(function () {}); } catch (e2) {}
          try { if (q0) q0.clear(); } catch (e2) {}
          probarSiguiente({ name: 'NotStreamingError', message: 'la cámara no entregó imagen' });
          return;
        }
        setTimeout(function () { verificar(intentos - 1); }, 1200);
      };
      verificar(3);
    }).catch(function (e) {
      listo = true; clearTimeout(reloj);
      var q0 = _scanPos; _scanPos = null;
      try { if (q0) q0.stop().catch(function () {}); } catch (e2) {}
      try { if (q0) q0.clear(); } catch (e2) {}
      if (e && e.name === 'NotAllowedError') {
        falloFinal(mensajePermisoCam(), e);
        return;
      }
      probarSiguiente(e);
    });
  };
  var probarSiguiente = function (e) {
    if (_cancelarEscaneoVivo) return;
    paso++;
    if (paso >= pasos.length) { falloFinal('No se pudo abrir la cámara en este navegador.', e); return; }
    if (m) m.textContent = 'Reintentando con otra cámara…';
    setTimeout(function () {
      if (_cancelarEscaneoVivo) return;
      lanzarPaso();
    }, 350);
  };
  var lanzarPaso = function () {
    if (_cancelarEscaneoVivo) return;
    if (pasos[paso] === 'trasera') {
      Html5Qrcode.getCameras().then(function (lista) {
        if (_cancelarEscaneoVivo) return;
        var cams = (lista || []).filter(function (x) { return x && (x.id || x.deviceId); });
        var tras = null;
        cams.forEach(function (x) {
          var lb = (x.label || '').toLowerCase();
          if (/back|trasera|rear|posterior|environment/.test(lb)) tras = x;
        });
        if (tras) iniciarCon({ deviceId: { exact: tras.deviceId || tras.id } });
        else probarSiguiente(null);
      }).catch(function (e) {
        if (_cancelarEscaneoVivo) return;
        if (e && e.name === 'NotAllowedError') {
          falloFinal(mensajePermisoCam(), e);
          return;
        }
        probarSiguiente(e);
      });
    } else if (pasos[paso] === 'environment') {
      // Forma plana (probada): html5-qrcode la resuelve a la cámara trasera (o la
      // única disponible). La forma {ideal:...} falla en algunos entornos.
      iniciarCon({ facingMode: 'environment' });
    } else {
      iniciarCon({});
    }
  };
  lanzarPaso();
}

/* ---------- Lector físico de códigos (PC / laptop) ---------- */
// Un lector USB/Bluetooth de códigos se comporta como un teclado: "escribe" el
// código y pulsa Enter. Esto hace que funcione en la caja sin importar en dónde
// esté el cursor: captura la ráfaga de teclas y agrega el artículo a la factura.
document.addEventListener('keydown', function (ev) {
  if (S.pagina !== 'vender') return; // solo en la caja registradora
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  var tgt = ev.target;
  var esBus = tgt === el('pos-bus');
  var enCampo = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT');
  if (enCampo && !esBus) return; // no interferir con los campos del cliente ni otros
  var k = ev.key;
  if (k && k.length === 1) {
    if (Date.now() - escLector.t > 150) escLector.texto = '';
    escLector.texto += k;
    escLector.t = Date.now();
    return;
  }
  if (k === 'Enter') {
    var codigo = escLector.texto.trim();
    escLector.texto = ''; escLector.t = Date.now();
    if (codigo && !esBus) {
      ev.preventDefault(); // evita que el Enter del lector "active" el botón enfocado
      agregarAlCarrito(codigo, 1);
      var p = prods().find(function (x) { return String(x.codigo).trim() === codigo; });
      toast('✅ ' + (p ? p.nombre : codigo) + ' añadido', 'ok');
    }
  }
});

/* ---------- Menú / navegación ---------- */
var PAGINAS = [
  { id: 'inicio', etq: 'Inicio', icono: '🏠', admin: false },
  { id: 'catalogo', etq: 'Catálogo', icono: '👟', admin: false },
  { id: 'vender', etq: 'Pedidos', icono: '🛒', admin: false },
  { id: 'productos', etq: 'Inventario', icono: '📦', admin: false },
  { id: 'ventas', etq: 'Ventas', icono: '🧾', admin: false },
  { id: 'reportes', etq: 'Reportes', icono: '📊', admin: true },
  { id: 'gastos', etq: 'Gastos', icono: '💸', admin: true },
  { id: 'nomina', etq: 'Nómina', icono: '👥', admin: true },
  { id: 'remodelaciones', etq: 'Obras', icono: '🏗️', admin: true },
  { id: 'admin', etq: 'Ajustes', icono: '⚙️', admin: true }
];
var METODOS = [
  ['pagomovil', 'PagoMóvil'],
  ['efectivo_usd', 'Efectivo $'],
  ['efectivo_ves', 'Efectivo Bs']
];
var CATEGORIAS = ['Running', 'Training', 'Lifestyle', 'Tennis', 'Calzado', 'Accesorios', 'General'];
var CATEGORIAS_GASTO = ['General', 'Mercancía', 'Empaque', 'Transporte', 'Servicios', 'Alquiler', 'Publicidad', 'Impuestos', 'Otros'];
var TIPOS_OBRA = [['material', 'Material'], ['mano_obra', 'Mano de obra'], ['otro', 'Otro']];

// ---------- Permisos de perfiles ----------
// Cada módulo (id de página) tiene un nivel: none (0) · ver (1) · editar (2).
var MODULOS_PERFIL = [
  ['inicio', 'Inicio'], ['vender', 'Vender'], ['productos', 'Inventario'], ['ventas', 'Ventas'],
  ['reportes', 'Reportes'], ['gastos', 'Gastos'], ['nomina', 'Nómina'],
  ['remodelaciones', 'Obras'], ['admin', 'Ajustes']
];
var NIVELES_PERFIL = [['none', 'Oculto'], ['ver', 'Solo ver'], ['editar', 'Editar']];
var _NIVEL = { none: 0, ver: 1, editar: 2 };
function esRolAdmin() { return S.rol === 'admin'; }
function puede(modulo, nivel) {
  if (esRolAdmin()) return true;
  var v = _NIVEL[S.perm && S.perm[modulo]] || 0;
  return v >= (_NIVEL[nivel || 'ver'] || 0);
}
function puedoEditar() { return puede(S.pagina, 'editar'); }

function paginasVisibles() {
  return PAGINAS.filter(function (p) { return puede(p.id, 'ver'); });
}
function nombreMetodo(v) {
  var f = METODOS.find(function (m) { return m[0] === v; });
  return f ? f[1] : (v || 'Otro');
}
function tipoGasto(t) {
  var f = TIPOS_OBRA.find(function (x) { return x[0] === t; });
  return f ? f[1] : t;
}
function tituloDe(p) {
  var f = PAGINAS.find(function (x) { return x.id === p; });
  return f ? f.etq : 'Frugulletty';
}

function pintarNav() {
  var nav = el('nav');
  if (!nav) return;
  nav.innerHTML = paginasVisibles().map(function (p) {
    return '<button class="nav-item' + (S.pagina === p.id ? ' activo' : '') + '" data-pagina="' + p.id + '">' +
      '<span class="nav-ic">' + p.icono + '</span>' + p.etq + '</button>';
  }).join('');
  Array.prototype.forEach.call(nav.querySelectorAll('.nav-item'), function (b) {
    b.addEventListener('click', function () { irA(b.getAttribute('data-pagina')); cerrarGaveta(); });
  });
  var gu = el('gaveta-usuario');
  if (gu) gu.textContent = (S.nombre || S.usuario) + (esRolAdmin() ? ' · Admin' : (S.perfilNombre ? ' · ' + S.perfilNombre : ''));
}

/* ---------- Gaveta (menú lateral) ---------- */
function abrirGaveta() {
  var g = el('gaveta');
  if (!g) return;
  el('gaveta-fondo').hidden = false;
  document.body.classList.add('gaveta-abierta');
  requestAnimationFrame(function () { g.classList.add('abierta'); });
}
function cerrarGaveta() {
  var g = el('gaveta');
  if (!g) return;
  g.classList.remove('abierta');
  document.body.classList.remove('gaveta-abierta');
  setTimeout(function () { el('gaveta-fondo').hidden = true; }, 250);
}

function piePosVisible(v) {
  var pie = el('pie-pos');
  if (pie) pie.hidden = !v;
}

async function irA(pagina, params) {
  detenerEscaneoVivo(); // si salimos de Vender, apaga la cámara para no dejarla abierta
  cerrarGavetaCarrito(); // al salir de Vender cerramos la gaveta del carrito
  S.pagina = pagina;
  pintarNav();
  var tl = el('titulo-pagina');
  if (tl) tl.textContent = tituloDe(pagina);
  piePosVisible(false);
  pintar('<div class="cargando">Cargando…</div>');
  try {
    if (typeof render[pagina] === 'function') await render[pagina](params || {});
  } catch (e) {
    var M = (e && e.message) || String(e);
    if (/Sesi/.test(M)) { cerrarSesionLocal(); return; }
    pinError(M);
  }
}

function pinError(m) {
  pintar('<div class="tarjeta"><div class="aviso aviso-error">' + esc(m) + '</div></div>');
}

/* ---------- Sesión / login ---------- */
function mostrarLogin() {
  el('pantalla-login').hidden = false;
  el('app').hidden = true;
  var u = el('in-usr');
  if (u) u.focus();
}

function entrarApp() {
  el('pantalla-login').hidden = true;
  el('app').hidden = false;
  cargarTasaSiYace(); // precarga la tasa BCV de inmediato (no bloquea)
  cargarProductos();  // precarga el inventario en segundo plano: Vender y el catálogo abren al instante
  cargaCategorias();  // precarga las categorías extras guardadas en la hoja
  pintarNav();
  irA('inicio');
}

async function intentarLogin() {
  var er = el('login-error');
  er.hidden = true;
  var u = el('in-usr').value.trim();
  var p = el('in-pwd').value;
  if (!u || !p) { er.textContent = 'Escribe usuario y contraseña.'; er.hidden = false; return; }
  var btn = el('btn-login');
  btn.disabled = true;
  try {
    var r = await API.login(u, p);
    if (!r.ok) { er.textContent = r.error || 'No se pudo iniciar sesión.'; er.hidden = false; return; }
    S.tok = r.token; S.usuario = r.usuario; S.nombre = r.nombre; S.rol = r.rol;
    S.perfil = r.perfil || ''; S.perfilNombre = r.perfilNombre || ''; S.perm = r.permisos || {};
    store.set('neg_tok', S.tok); store.set('neg_usr', S.usuario); store.set('neg_nom', S.nombre); store.set('neg_rol', S.rol);
    store.set('neg_perfil', S.perfil); store.set('neg_perfil_nom', S.perfilNombre); store.set('neg_perm', JSON.stringify(S.perm));
    entrarApp();
  } catch (e) {
    er.textContent = (e && e.message) || 'Error al iniciar sesión.';
    er.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

function cerrarSesionLocal() {
  if (S.tok) { API.logout().catch(function () {}); }
  S.tok = ''; S.usuario = ''; S.nombre = ''; S.rol = ''; S.perfil = ''; S.perfilNombre = ''; S.perm = {};
  S.tasa = null; S.fechaTasa = ''; S.fuenteTasa = '';
  _promTasa = null; _promProd = null; CARRITO = [];
  Object.keys(_CACHE).forEach(function (k) { delete _CACHE[k]; });
  ['neg_tok', 'neg_usr', 'neg_nom', 'neg_rol', 'neg_perfil', 'neg_perfil_nom', 'neg_perm'].forEach(function (k) { store.del(k); });
  mostrarLogin();
}

async function iniciarApp() {
  if (DEMO) {
    var sub = document.querySelector('.login-card .sub');
    if (sub) sub.textContent = 'Modo DEMO (sin Google) — entra con lo que sea';
    mostrarLogin();
    if (window.__avisar) window.__avisar('MODO DEMO ACTIVO: la app NO está conectada a tus datos; los cambios NO se guardan. Verifica internet y recarga.', true);
    return;
  }
  // Comprobación de versión: el servidor debe coincidir con esta página.
  API.infoServidor().then(function (sv) {
    try {
      if (sv && sv.version && sv.version !== 'v40' && window.__avisar) {
        window.__avisar('La página es v40, pero el servidor está en la versión ' + sv.version + '. Cierra esta pestaña y abre el enlace oficial (debe decir v40).', true);
      }
    } catch (e) {}
  }).catch(function () {});
  if (S.tok) {
    try {
      try {
        var mp = await API.misPermisos();
        if (mp) {
          S.rol = mp.rol || S.rol;
          S.perfil = mp.perfil || '';
          S.perfilNombre = mp.perfilNombre || '';
          S.perm = mp.permisos || {};
          store.set('neg_rol', S.rol);
          store.set('neg_perfil', S.perfil);
          store.set('neg_perfil_nom', S.perfilNombre);
          store.set('neg_perm', JSON.stringify(S.perm));
        }
      } catch (e2) {}
      await API.getDashboard();
      entrarApp();
      return;
    } catch (e) { /* sesión inválida, volver a login */ }
  }
  mostrarLogin();
}

/* ============================================================
   PANTALLA: INICIO / PANEL
   ============================================================ */
function kpi(etiq, num1, num2, sub, clase, ir) {
  return '<div class="card-kpi" data-ir="' + ir + '">' +
    '<div class="k-etiq">' + etiq + '</div>' +
    '<div class="k-num ' + (clase || '') + '">' + num1 + (num2 ? '<small> · ' + num2 + '</small>' : '') + '</div>' +
    (sub ? '<div class="k-etiq">' + sub + '</div>' : '') +
    '</div>';
}

render.inicio = async function () {
  await cargarTasaSiYace();
  var aplicar = function (d) {
    // El refresco del panel (cada 10 s) NO debe pisar otra pantalla:
    // si el usuario ya cambió de pestaña, este pintado se descarta.
    if (S.pagina !== 'inicio') return;
    if (!d || typeof d !== 'object') {
      d = {
        tasa: { tasa: S.tasa || 0, fecha: S.fechaTasa || '', fuente: S.fuenteTasa || '' },
        ventasHoy: { cantidad: 0, usd: 0, ves: 0 },
        ventasMes: { cantidad: 0, usd: 0, ves: 0 },
        gastosMes: { cantidad: 0, usd: 0 },
        egresosMes: { cantidad: 0, usd: 0 },
        sueldosPagadosMes: { cantidad: 0, usd: 0 },
        sueldosPendientes: { dias: 0, usd: 0 },
        stockBajo: [],
        totalProductos: 0
      };
    }
    if (typeof d.sueldosPendientes === 'number') d.sueldosPendientes = { dias: d.sueldosPendientes, usd: 0 };
    if (!d.sueldosPendientes) d.sueldosPendientes = { dias: 0, usd: 0 };
    if (S.tasa === null && d.tasa && num(d.tasa.tasa)) {
      S.tasa = num(d.tasa.tasa);
      S.tasaManual = !!d.tasa.manual;
      actualizarChipTasa();
    }
    var sb = (d.stockBajo || []).slice(0, 6);
    pintar(
      '<div class="tarjeta"><div class="fila-entre">' +
      '<div><strong>💱 Tasa vigente</strong><br><span class="muted">' + esc(d.tasa && d.tasa.fecha) + ' · ' + esc(d.tasa && d.tasa.fuente) + (d.tasa && d.tasa.manual ? ' · manual' : '') + '</span></div>' +
      '<div class="k-azul" style="font-size:19px;font-weight:800">Bs ' + fmtNum(num(d.tasa && d.tasa.tasa)) + ' / $</div>' +
      '</div></div>' +
      '<div class="grid-cards" style="margin-top:14px">' +
      (puede('ventas', 'ver') ? kpi('💵 Ventas de hoy', fmtUSD(d.ventasHoy.usd), fmtVES(d.ventasHoy.ves), d.ventasHoy.cantidad + ' ventas', 'k-verde', 'ventas') : '') +
      (puede('ventas', 'ver') ? kpi('📈 Ventas del mes', fmtUSD(d.ventasMes.usd), fmtVES(d.ventasMes.ves), d.ventasMes.cantidad + ' ventas', 'k-azul', 'ventas') : '') +
      (puede('gastos', 'ver') ? kpi('💸 Gastos del mes', fmtUSD(d.gastosMes.usd), fmtVES(d.gastosMes.usd * (S.tasa || 0)), d.gastosMes.cantidad + ' registros', 'k-rojo', 'gastos') : '') +
      (puede('reportes', 'ver') ? kpi('💸 Egresos del mes', fmtUSD((d.egresosMes || {}).usd || 0), fmtVES(((d.egresosMes || {}).usd || 0) * (S.tasa || 0)), ((d.egresosMes || {}).cantidad || 0) + ' pagos (gastos + sueldos + obras)', 'k-rojo', 'reportes') : '') +
      (puede('nomina', 'ver') ? kpi('💰 Sueldos pendientes', fmtUSD(d.sueldosPendientes.usd), (d.sueldosPendientes.dias || 0) + ' días', 'por pagar', 'k-naranja', 'nomina') : '') +
      (puede('productos', 'ver') ? kpi('📦 Productos', String(d.totalProductos), 'activos', (d.stockBajo && d.stockBajo.length) + ' bajo el mínimo', 'k-azul', 'productos') : '') +
      (puede('vender', 'ver') ? kpi('🛒 Vender ahora', 'Abrir POS', 'escanea y cobra', '', 'k-verde', 'vender') : '') +
      '</div>' +
      (sb.length && puede('productos', 'ver') ? '<div class="tarjeta"><h2>🔺 Stock bajo</h2><div class="detalle-venta">' +
        sb.map(function (p) {
          return '<div class="d-lin"><span>' + esc(p.nombre) + '</span><span class="baja">' + fmtCant(p.stock) + ' / ' + fmtCant(p.stock_min) + '</span></div>';
        }).join('') +
        '</div><div class="fila-botones"><button class="btn" data-ir="productos">Ir al inventario</button></div></div>' : '')
    );
    Array.prototype.forEach.call(document.querySelectorAll('#contenido [data-ir]'), function (btn) {
      btn.addEventListener('click', function () { irA(btn.getAttribute('data-ir')); });
    });
  };
  await datosRapidos('dashboard', 10000, function () { return API.getDashboard(); }, aplicar);
};

/* ============================================================
   PANTALLA: CATÁLOGO (TIENDA ONLINE)
   ============================================================ */
render.catalogo = async function () {
  await cargarTasaSiYace();
  if (!prods().length) await cargarProductos();
  pintar(
    '<div class="buscador"><input id="cat-bus" placeholder="Buscar modelo..." autocomplete="off"></div>' +
    '<select id="cat-cat" class="select-grow" style="width:100%;margin:0 0 10px">' + opcionesCategorias(true) + '</select>' +
    '<div id="cat-grid" class="grid-cards"></div>'
  );
  var bus = el('cat-bus');
  var catSel = el('cat-cat');
  bus.addEventListener('input', function () { pintarCatalogo(this.value, catSel.value); });
  catSel.addEventListener('change', function () { pintarCatalogo(bus.value, this.value); });
  pintarCatalogo('', '');
};

function pintarCatalogo(q, cat) {
  var cont = el('cat-grid');
  if (!cont) return;
  var ql = (q || '').trim().toLowerCase();
  var lista = prods().filter(function (p) {
    if (String(p.activo) !== '1') return false;
    if (cat && String(p.categoria || '').trim() !== cat) return false;
    if (ql && String(p.nombre).toLowerCase().indexOf(ql) < 0 && String(p.codigo).toLowerCase().indexOf(ql) < 0) return false;
    return true;
  });
  if (!lista.length) { cont.innerHTML = '<div class="tarjeta muted">No hay productos disponibles.</div>'; return; }
  cont.innerHTML = lista.map(function (p) {
    return '<div class="card-kpi" data-cod="' + esc(p.codigo) + '" style="cursor:pointer"><div style="font-size:28px;text-align:center">👟</div>' +
      '<div class="k-etiq" style="text-align:center;margin-top:6px">' + esc(p.nombre) + '</div>' +
      '<div class="k-num k-verde" style="text-align:center">' + fmtUSD(p.precio_usd) + '</div>' +
      '<div class="muted" style="text-align:center;font-size:11px">' + fmtVES(p.precio_usd * (S.tasa || 0)) + '</div></div>';
  }).join('');
  Array.prototype.forEach.call(cont.querySelectorAll('.card-kpi'), function (b) {
    b.addEventListener('click', function () {
      var cod = b.getAttribute('data-cod');
      var p = prods().find(function (x) { return String(x.codigo) === cod; });
      if (p) verDetalleProductoTienda(p);
    });
  });
}

function verDetalleProductoTienda(p) {
  var tallas = String(p.tallas || '').split(',').filter(function (t) { return t.trim(); });
  if (tallas.length === 0) tallas = ['35','36','37','38','39','40'];
  abrirModal(
    '<div class="modal-tope"><h3>' + esc(p.nombre) + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<div style="text-align:center;font-size:48px;margin:10px 0">👟</div>' +
    '<p class="muted">' + esc(p.descripcion || p.categoria || '') + '</p>' +
    '<div class="fila-entre"><div><strong>Precio</strong></div><div class="k-verde" style="font-size:18px;font-weight:800">' + fmtUSD(p.precio_usd) + ' / ' + fmtVES(p.precio_usd * (S.tasa || 0)) + '</div></div>' +
    '<label class="campo">Seleccionar talla</label>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
    tallas.map(function (t) { return '<button class="btn btn-suave talla-btn" data-talla="' + esc(t.trim()) + '">' + esc(t.trim()) + '</button>'; }).join('') +
    '</div>' +
    '<input type="hidden" id="sel-talla" value="">' +
    '<div class="modal-acciones"><button class="btn btn-suave" onclick="cerrarModal()">Cerrar</button><button class="btn btn-primario" id="agregar-tienda">Agregar al carrito</button></div>'
  );
  var tallaSel = '';
  Array.prototype.forEach.call(document.querySelectorAll('.talla-btn'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.talla-btn'), function (x) { x.classList.remove('btn-primario'); x.classList.add('btn-suave'); });
      b.classList.remove('btn-suave'); b.classList.add('btn-primario');
      tallaSel = b.getAttribute('data-talla');
      el('sel-talla').value = tallaSel;
    });
  });
  el('agregar-tienda').addEventListener('click', function () {
    if (!tallaSel) { toast('Selecciona una talla', 'error'); return; }
    agregarAlCarritoConTalla(p.codigo, 1, tallaSel);
    cerrarModal();
    toast('Agregado al carrito', 'ok');
    abrirGavetaCarrito();
  });
}

function agregarAlCarritoConTalla(cod, cantidad, talla) {
  var eraVacio = !CARRITO.length;
  var p = prods().find(function (x) { return String(x.codigo).trim() === String(cod).trim(); });
  if (!p) { toast('Producto no encontrado: ' + cod, 'error'); return; }
  if (String(p.activo) !== '1') { toast('"' + p.nombre + '" no está disponible.', 'error'); return; }
  var lin = CARRITO.find(function (l) { return l.codigo === String(p.codigo) && l.talla === talla; });
  if (lin) lin.cantidad += Math.max(1, num(cantidad) || 1);
  else CARRITO.push({ codigo: String(p.codigo), nombre: p.nombre, precio: num(p.precio_usd), stock: num(p.stock), cantidad: Math.max(1, num(cantidad) || 1), talla: talla });
  pintarCarrito();
  abrirSiPrimerArticulo(eraVacio);
}

/* ============================================================
   PANTALLA: PEDIDOS / VENDER (PUNTO DE VENTA / E-COMMERCE)
   ============================================================ */
function metodosHTML() {
  return METODOS.map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('');
}

render.vender = async function () {
  await cargarTasaSiYace();
  if (!prods().length) await cargarProductos();
  piePosVisible(false);
  pintar(
    '<div class="tarjeta"><h2>🛒 Pedido / Checkout</h2>' +
    '<div class="form-2col">' +
    '<div><label class="campo">Nombre completo</label><input id="pos-cli-nombre" autocomplete="off"></div>' +
    '<div><label class="campo">Teléfono / WhatsApp</label><input id="pos-cli-tel" inputmode="tel" autocomplete="off"></div>' +
    '<div><label class="campo">Cédula / ID</label><input id="pos-cli-doc" autocomplete="off"></div>' +
    '<div><label class="campo">Estado</label><input id="pos-cli-estado" autocomplete="off" placeholder="Caracas, Miranda, etc."></div>' +
    '</div>' +
    '<label class="campo">Dirección de entrega</label>' +
    '<input id="pos-cli-dir" autocomplete="off" placeholder="Dirección completa">' +
    '<div class="form-2col" style="margin-top:10px">' +
    '<div><label class="campo">Tipo de entrega</label><select id="pos-entrega"><option value="envio">Envío</option><option value="retiro">Retiro en tienda</option></select></div>' +
    '<div><label class="campo">Zona</label><input id="pos-zona" autocomplete="off" placeholder="Especifica zona"></div>' +
    '</div>' +
    '<p class="muted" style="margin-top:6px">* En Caracas aplica delivery. Para otras zonas solo aplica tarifa nacional de envío.</p>' +
    '<div class="fila-botones" style="margin-top:10px"><button class="btn btn-primario" id="ir-catalogo">Ver catálogo de zapatos</button></div>' +
    '</div>'
  );
  el('ir-catalogo').addEventListener('click', function () { irA('catalogo'); });
  asegurarGavetaCarrito();
  var bus = el('pos-bus');
  bus.addEventListener('input', buscarEnPos);
  bus.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var cod = bus.value.trim();
      if (cod) { agregarAlCarrito(cod, 1); bus.value = ''; }
    }
  });
  el('pos-cat').addEventListener('change', buscarEnPos);
  el('pos-live-ini').addEventListener('click', iniciarEscaneoVivo);
  el('pos-live-det').addEventListener('click', detenerEscaneoVivo);
  el('pos-foto').addEventListener('click', function () {
    detenerEscaneoVivo(); // evita dos cámaras abiertas a la vez
    abrirScanner(function (codigo) { agregarAlCarrito(codigo, 1); });
  });
  el('pos-cam-ayuda').addEventListener('click', ayudaCamara);
  el('pos-cobrar').addEventListener('click', cobrarVenta);
  el('carrito-fab').addEventListener('click', function (e) {
    e.stopPropagation();
    gavetaCarritoAbierta() ? cerrarGavetaCarrito() : abrirGavetaCarrito();
  });
  el('cg-cerrar').addEventListener('click', function (e) {
    e.stopPropagation();
    cerrarGavetaCarrito();
  });
  pintarCarrito();
};

/* ============================================================
   GAVETA DEL CARRITO (Vender)
   Se desliza desde la derecha cubriendo el 85% del ancho.
   Queda visible el 15% de la sección de ventas: tocar ahí
   (o la ✕) cierra la gaveta y vuelves a la caja registradora.
   ============================================================ */
function asegurarGavetaCarrito() {
  if (el('carrito-gaveta')) return;
  var g = document.createElement('div');
  g.id = 'carrito-gaveta';
  g.setAttribute('aria-hidden', 'true');
  g.innerHTML =
    '<div class="cg-cab">' +
    '<span><strong>🛒 Carrito Frugulletty</strong><small class="muted" id="cg-cab-n">Sin productos todavía</small></span>' +
    '<button class="cg-cerrar" id="cg-cerrar" aria-label="Cerrar el carrito">✕</button>' +
    '</div>' +
    '<div id="pos-carrito" class="cg-lista">Sin productos todavía. Ve al catálogo para agregar modelos y tallas.</div>' +
    '<div class="cg-pie">' +
    '<div class="cg-totales">' +
    '<div id="pos-tot-usd">Subtotal: $ 0,00</div>' +
    '<div id="pos-tot-envio">Envío: $ 0,00</div>' +
    '<div id="pos-tot-total"><strong>Total: $ 0,00</strong></div>' +
    '<small id="pos-tot-ves">Bs 0,00</small>' +
    '</div>' +
    '<label class="campo" style="width:100%;margin:6px 0 4px">Método de pago</label>' +
    '<select id="pos-metodo" style="width:100%">' + metodosHTML() + '</select>' +
    '<button class="btn btn-ok btn-ancho" id="pos-cobrar">Confirmar pedido</button>' +
    '</div>';
  document.body.appendChild(g);
  var fab = document.createElement('button');
  fab.id = 'carrito-fab';
  fab.className = 'carrito-fab';
  fab.setAttribute('aria-label', 'Abrir la factura');
  fab.innerHTML = '🛒<span class="fab-badge" id="carrito-fab-badge" style="display:none">0</span>';
  document.body.appendChild(fab);
  // "Otro" muestra el campo para especificar; los demás métodos lo ocultan.
}

function gavetaCarritoAbierta() {
  var g = el('carrito-gaveta');
  return !!(g && g.classList.contains('abierta'));
}

function abrirGavetaCarrito() {
  var g = el('carrito-gaveta');
  if (!g) return;
  g.classList.add('abierta');
  g.setAttribute('aria-hidden', 'false');
  var f = el('carrito-fab');
  if (f) f.style.display = 'none';
}

function cerrarGavetaCarrito() {
  var g = el('carrito-gaveta');
  if (!g) return;
  g.classList.remove('abierta');
  g.setAttribute('aria-hidden', 'true');
  var f = el('carrito-fab');
  if (f) f.style.display = '';
}

// Tocar la parte visible de ventas (el 30% del fondo) cierra la gaveta.
// Ojo: los avisos (toast) o el resto de la interfaz NO la cierran.
if (document.addEventListener) {
  document.addEventListener('click', function (e) {
    var g = el('carrito-gaveta');
    if (!g || !g.classList.contains('abierta')) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#carrito-gaveta') || t.closest('#carrito-fab')) return; // toques dentro de la gaveta o en su botón
    if (t.closest('#contenido')) cerrarGavetaCarrito(); // tocó la sección de ventas (el 30% visible)
  });
}

function buscarEnPos() {
  var q = (el('pos-bus').value || '').trim().toLowerCase();
  var cont = el('pos-sug');
  if (!cont) return;
  if (!q) { cont.innerHTML = ''; return; }
  var cat = el('pos-cat') ? (el('pos-cat').value || '').trim() : '';
  var lista = prods().filter(function (p) {
    if (String(p.activo) !== '1') return false;
    if (cat && String(p.categoria || '').trim() !== cat) return false;
    return String(p.nombre).toLowerCase().indexOf(q) >= 0 || String(p.codigo).toLowerCase().indexOf(q) >= 0;
  }).slice(0, 8);
  if (!lista.length) {
    cont.innerHTML = '<div class="aviso aviso-error" style="margin-top:8px">Sin resultados para "' + esc(q) + '"</div>';
    return;
  }
  cont.innerHTML = lista.map(function (p) {
    return '<div class="sugerido" data-cod="' + esc(p.codigo) + '">' +
      '<div><div class="s-nombre">' + esc(p.nombre) + '</div><div class="mono muted">' + esc(p.codigo) + ' · ' + fmtCant(p.stock) + ' disp.</div></div>' +
      '<div class="s-precio der">' + fmtUSD(p.precio_usd) + '<br><small class="muted">' + fmtVES(p.precio_usd * (S.tasa || 0)) + '</small></div>' +
      '</div>';
  }).join('');
  Array.prototype.forEach.call(cont.querySelectorAll('.sugerido'), function (b) {
    b.addEventListener('click', function () {
      agregarAlCarrito(b.getAttribute('data-cod'), 1);
      el('pos-bus').value = '';
      cont.innerHTML = '';
      if (el('pos-bus')) el('pos-bus').focus();
    });
  });
}

function stockDe(codigo) {
  var p = prods().find(function (x) { return String(x.codigo).trim() === String(codigo).trim(); });
  return p ? num(p.stock) : 0;
}

function agregarAlCarrito(cod, cantidad) {
  var eraVacio = !CARRITO.length;
  var p = prods().find(function (x) { return String(x.codigo).trim() === String(cod).trim(); });
  if (!p) { toast('Producto no encontrado: ' + cod, 'error'); return; }
  if (String(p.activo) !== '1') { toast('"' + p.nombre + '" está desactivado.', 'error'); return; }
  var stock = num(p.stock);
  var lin = CARRITO.find(function (l) { return l.codigo === String(p.codigo); });
  var enCarrito = lin ? lin.cantidad : 0;
  var pedido = enCarrito + Math.max(1, num(cantidad) || 1);
  // Límite del inventario: no se puede pedir más de lo que hay.
  if (pedido > stock) {
    if (stock <= 0) {
      toast('No hay unidades de "' + p.nombre + '" en el inventario.', 'error');
      return; // no se agrega nada más
    }
    if (lin) lin.cantidad = stock;
    else CARRITO.push({ codigo: String(p.codigo), nombre: p.nombre, precio: num(p.precio_usd), stock: stock, cantidad: stock });
    pintarCarrito();
    toast('Solo hay ' + fmtCant(stock) + ' de "' + p.nombre + '". Se puso la cantidad disponible.', 'error');
    abrirSiPrimerArticulo(eraVacio);
    return;
  }
  if (lin) lin.cantidad = pedido;
  else CARRITO.push({ codigo: String(p.codigo), nombre: p.nombre, precio: num(p.precio_usd), stock: stock, cantidad: pedido });
  pintarCarrito();
  abrirSiPrimerArticulo(eraVacio);
}

// Al agregar el primer artículo se abre la gaveta para "ver lo que se agrega".
function abrirSiPrimerArticulo(eraVacio) {
  if (!eraVacio) return;
  if (!CARRITO.length) return;
  if (S.pagina !== 'vender') return;
  abrirGavetaCarrito();
}

function cambiarCant(idx, delta) {
  var lin = CARRITO[idx];
  if (!lin) return;
  var nueva = lin.cantidad + delta;
  if (nueva <= 0) { CARRITO.splice(idx, 1); pintarCarrito(); return; }
  // Al subir, nunca pasar del stock disponible.
  if (delta > 0) {
    var tope = stockDe(lin.codigo);
    if (nueva > tope) {
      lin.cantidad = Math.max(0, tope);
      pintarCarrito();
      toast('Solo hay ' + fmtCant(tope) + ' de "' + lin.nombre + '" en el inventario', 'error');
      return;
    }
  }
  lin.cantidad = nueva;
  pintarCarrito();
}

function pintarCarrito() {
  var cont = el('pos-carrito');
  if (!cont) return;
  var t1 = el('pos-tot-usd');
  var t2 = el('pos-tot-ves');
  var badge = el('carrito-fab-badge');
  var cabN = el('cg-cab-n');
  var unidades = CARRITO.reduce(function (s, l) { return s + l.cantidad; }, 0);
  var tot = CARRITO.reduce(function (s, l) { return s + l.precio * l.cantidad; }, 0);
  if (badge) {
    badge.textContent = String(unidades);
    badge.style.display = unidades ? '' : 'none';
  }
  if (cabN) {
    cabN.textContent = !unidades ? 'Sin productos todavía'
      : (unidades === 1 ? '1 artículo' : unidades + ' artículos') + ' · ' + fmtUSD(tot);
  }
  if (!CARRITO.length) {
    cont.innerHTML = '<div class="muted">Sin productos todavía. Busca, escribe el código o escanea.</div>';
    if (t1) t1.textContent = 'Total: $ 0,00';
    if (t2) t2.textContent = 'Bs 0,00';
    return;
  }
  cont.innerHTML = CARRITO.map(function (l, i) {
    var sub = l.precio * l.cantidad;
    return '<div class="pos-art">' +
      '<div style="flex:1"><div class="negrita">' + esc(l.nombre) + '</div>' +
      '<div class="mono muted">' + esc(l.codigo) + ' · Talla: ' + esc(l.talla || '-') + ' · ' + fmtUSD(l.precio) + '</div></div>' +
      '<div class="cnt">' +
      '<button class="cnt-btn" data-q="-1" data-i="' + i + '">−</button>' +
      '<span>' + fmtCant(l.cantidad) + '</span>' +
      '<button class="cnt-btn" data-q="1" data-i="' + i + '">+</button>' +
      '</div>' +
      '<div class="der negrita" style="min-width:82px">' + fmtUSD(sub) + '<br><small class="muted">' + fmtVES(sub * (S.tasa || 0)) + '</small></div>' +
      '</div>';
  }).join('');
  Array.prototype.forEach.call(cont.querySelectorAll('.cnt-btn'), function (b) {
    b.addEventListener('click', function () {
      cambiarCant(num(b.getAttribute('data-i')), num(b.getAttribute('data-q')));
    });
  });
  var zona = el('pos-zona') ? el('pos-zona').value : '';
  var entrega = el('pos-entrega') ? el('pos-entrega').value : 'envio';
  var envioUsd = 0;
  if (entrega === 'envio') {
    if (String(zona).toLowerCase().indexOf('caracas') >= 0) {
      envioUsd = 0;
    } else {
      envioUsd = 5;
    }
  }
  var total = tot + envioUsd;
  var tEnv = el('pos-tot-envio');
  var tTot = el('pos-tot-total');
  if (t1) t1.textContent = 'Subtotal: ' + fmtUSD(tot);
  if (tEnv) tEnv.textContent = 'Envío: ' + fmtUSD(envioUsd);
  if (tTot) tTot.innerHTML = '<strong>Total: ' + fmtUSD(total) + '</strong>';
  if (t2) t2.textContent = fmtVES(total * (S.tasa || 0)) + ' (tasa ' + fmtNum(S.tasa || 0) + ')';
}

async function cobrarVenta() {
  if (!CARRITO.length) { toast('El carrito está vacío', 'error'); return; }
  var nombre = (el('pos-cli-nombre') ? el('pos-cli-nombre').value : '').trim();
  var tel = (el('pos-cli-tel') ? el('pos-cli-tel').value : '').trim();
  var dir = (el('pos-cli-dir') ? el('pos-cli-dir').value : '').trim();
  if (!nombre || !tel || !dir) { toast('Completa nombre, teléfono y dirección', 'error'); return; }
  var btn = el('pos-cobrar');
  btn.disabled = true;
  try {
    var items = CARRITO.map(function (l) { return { codigo: l.codigo, cantidad: l.cantidad, talla: l.talla }; });
    var cliente = {
      nombre: nombre,
      documento: (el('pos-cli-doc') ? el('pos-cli-doc').value : '').trim(),
      telefono: tel,
      direccion: dir,
      estado: (el('pos-cli-estado') ? el('pos-cli-estado').value : '').trim()
    };
    var metodo = el('pos-metodo').value;
    var tipoEntrega = el('pos-entrega') ? el('pos-entrega').value : 'envio';
    var zona = el('pos-zona') ? el('pos-zona').value : '';
    var r = await API.registrarVenta({ items: items, metodo: metodo, tipo_entrega: tipoEntrega, zona: zona, cliente: cliente });
    CARRITO = [];
    ['pos-cli-nombre', 'pos-cli-doc', 'pos-cli-tel', 'pos-cli-dir', 'pos-cli-estado', 'pos-zona'].forEach(function (id) { var x = el(id); if (x) x.value = ''; });
    pintarCarrito();
    toast('✅ Pedido confirmado: ' + r.id + ' · Total ' + fmtUSD(r.totalUSD), 'ok');
    await cargarProductos();
    cerrarGavetaCarrito();
    irA('ventas');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ============================================================
   PANTALLA: INVENTARIO / PRODUCTOS
   ============================================================ */
render.productos = async function () {
  if (!prods().length) await cargarProductos();
  var esAdmin = puedoEditar();
  pintar(
    '<div class="buscador"><input id="prod-bus" placeholder="Filtrar productos…" autocomplete="off"></div>' +
    '<div class="fila-botones" style="margin:0 0 8px">' +
    '<select id="prod-cat" class="select-grow">' + opcionesCategorias(true) + '</select>' +
    (esAdmin ? '<button class="btn" id="prod-cats" title="Administrar categorías">🏷️ Categorías</button>' : '') +
    '</div>' +
    '<div class="fila-botones">' +
    (esAdmin ? '<button class="btn btn-primario" id="prod-nuevo">＋ Nuevo producto</button>' : '') +
    '<button class="btn" id="prod-scan">📷 Escanear</button>' +
    '<button class="btn" id="prod-reload">↻ Recargar</button>' +
    '</div>' +
    '<div id="prod-tabla"></div>'
  );
  if (esAdmin) {
    el('prod-nuevo').addEventListener('click', function () { formularioProducto(null); });
    el('prod-scan').addEventListener('click', function () {
      abrirScanner(function (codigo) { formularioProductoPorCodigo(codigo); });
    });
    el('prod-cats').addEventListener('click', function () { modalCategorias(null); });
  } else {
    el('prod-scan').addEventListener('click', function () {
      abrirScanner(function (codigo) { verProducto(codigo); });
    });
  }
  el('prod-reload').addEventListener('click', async function () {
    await cargarProductos();
    refrescarSelectCategorias('prod-cat', '');
    pintarTablaProductos(el('prod-bus').value, el('prod-cat').value);
    toast('Inventario recargado', 'ok');
  });
  el('prod-bus').addEventListener('input', function () { pintarTablaProductos(this.value, el('prod-cat').value); });
  el('prod-cat').addEventListener('change', function () { pintarTablaProductos(el('prod-bus').value, this.value); });
  pintarTablaProductos('', '');
};

function pintarTablaProductos(q, cat) {
  var cont = el('prod-tabla');
  if (!cont) return;
  if (S.errProds) {
    cont.innerHTML = '<div class="tarjeta" style="border-left:4px solid #c62828"><b>⚠️ No se pudo cargar el inventario:</b> ' + esc(S.errProds) +
      '<div style="margin-top:8px"><button class="btn" id="prod-reintentar">↻ Reintentar</button></div></div>';
    var br = el('prod-reintentar');
    if (br) br.addEventListener('click', async function () { S.errProds = ''; await cargarProductos(); pintarTablaProductos('', ''); });
    return;
  }
  var ql = (q || '').trim().toLowerCase();
  var cat = (cat || '').trim();
  var lista = prods().filter(function (p) {
    if (ql && String(p.nombre).toLowerCase().indexOf(ql) < 0 && String(p.codigo).toLowerCase().indexOf(ql) < 0) return false;
    if (cat && String(p.categoria || '').trim() !== cat) return false;
    return true;
  });
  if (!lista.length) { cont.innerHTML = '<div class="tarjeta muted">No hay productos.</div>'; return; }
  var esAdmin = puedoEditar();
  cont.innerHTML = '<div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
    '<th>Código</th><th>Nombre</th><th>Cat.</th><th class="der">Precio $</th><th class="der">Bs</th>' +
    '<th class="der">Stock</th><th class="der">Min</th>' + (esAdmin ? '<th>Acciones</th>' : '') +
    '</tr></thead><tbody>' +
    lista.map(function (p) {
      var stock = num(p.stock);
      var min = num(p.stock_min);
      var activo = String(p.activo) === '1';
      var baja = activo && stock <= min;
      var acc = esAdmin
        ? '<button class="btn" style="padding:6px 10px" data-acc="edit" data-cod="' + esc(p.codigo) + '">✏️</button> ' +
          '<button class="btn btn-suave" style="padding:6px 10px" data-acc="stock" data-cod="' + esc(p.codigo) + '">±Stock</button>'
        : '';
      return '<tr' + (activo ? '' : ' style="opacity:.45"') + '>' +
        '<td class="mono">' + esc(p.codigo) + '</td>' +
        '<td>' + esc(p.nombre) + (activo ? '' : '<br><small class="muted">Inactivo</small>') + '</td>' +
        '<td>' + esc(p.categoria) + '</td>' +
        '<td class="der">' + fmtUSD(p.precio_usd) + '</td>' +
        '<td class="der muted">' + fmtVES(p.precio_usd * (S.tasa || 0)) + '</td>' +
        '<td class="der' + (baja ? ' baja' : '') + '">' + fmtCant(stock) + '</td>' +
        '<td class="der muted">' + fmtCant(min) + '</td>' +
        (esAdmin ? '<td>' + acc + '</td>' : '') +
        '</tr>';
    }).join('') +
    '</tbody></table></div>';
  Array.prototype.forEach.call(cont.querySelectorAll('[data-acc]'), function (b) {
    b.addEventListener('click', function () {
      var acc = b.getAttribute('data-acc');
      var cod = b.getAttribute('data-cod');
      var p = prods().find(function (x) { return String(x.codigo) === cod; });
      if (acc === 'edit') formularioProducto(p || { codigo: cod });
      else formularioStock(cod);
    });
  });
}

/* ---------- ADMINISTRAR CATEGORÍAS (solo admin) ---------- */
function modalCategorias(editando) {
  var cats = listaDeCategorias();
  abrirModal(
    '<div class="modal-tope"><h3>🏷️ Categorías</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<label class="campo">Agregar categoría</label>' +
    '<div class="fila-botones"><input id="gc-nueva" placeholder="Nombre de la categoría…" autocomplete="off">' +
    '<button class="btn btn-primario" id="gc-add">＋ Agregar</button></div>' +
    '<div class="cats-admin" id="gc-lista">' +
    cats.map(function (c) {
      if (c === editando) {
        return '<div class="cat-admin" data-cat="' + esc(c) + '">' +
          '<input id="gc-renombrar" value="' + esc(c) + '" autocomplete="off">' +
          '<span class="ca-acc">' +
          '<button class="btn btn-primario" style="padding:4px 10px" id="gc-ren-ok">✓</button>' +
          '<button class="btn btn-suave" style="padding:4px 10px" id="gc-ren-cancel">✕</button>' +
          '</span></div>';
      }
      var fija = c === 'General';
      return '<div class="cat-admin" data-cat="' + esc(c) + '">' +
        '<span class="ca-nombre"' + (fija ? ' style="opacity:.55"' : '') + '>' + esc(c) + '</span>' +
        (fija ? '<small class="muted"> fija</small>' : '') +
        '<span class="ca-acc">' +
        (fija ? '' : '<button class="btn" style="padding:4px 9px" data-ca="edit">✏️</button>') +
        (fija ? '' : '<button class="btn btn-suave" style="padding:4px 9px" data-ca="del">🗑</button>') +
        '</span></div>';
    }).join('') +
    '</div>' +
    '<p class="muted" style="margin-top:10px;font-size:12px">Renombrar cambia la categoría en todos los productos que la usan. Al eliminar, esos productos pasan a "General".</p>'
  );
  el('gc-add').addEventListener('click', async function () {
    var n = el('gc-nueva').value.trim();
    if (!n) { toast('Escribe el nombre de la categoría', 'error'); return; }
    try {
      var lista = await apiFetch('guardarCategoria', [S.tok, n]);
      if (Array.isArray(lista)) { S.categoriasExtra = lista; _promCats = null; }
      toast('Categoría agregada: ' + n, 'ok');
      reabrirCategorias(null);
    } catch (e) { toast((e && e.message) || 'No se pudo guardar la categoría', 'error'); }
  });
  Array.prototype.forEach.call(el('gc-lista').querySelectorAll('[data-ca]'), function (b) {
    b.addEventListener('click', function () {
      var fila = b.closest('.cat-admin');
      var cat = fila.getAttribute('data-cat');
      if (b.getAttribute('data-ca') === 'edit') {
        reabrirCategorias(cat);
      } else if (b.getAttribute('data-ca') === 'del') {
        fila.innerHTML = '<span class="ca-nombre">¿Eliminar "' + esc(cat) + '"?</span>' +
          '<span class="ca-acc">' +
          '<button class="btn btn-peligro" style="padding:4px 10px" data-ca="del-ok">Sí</button>' +
          '<button class="btn btn-suave" style="padding:4px 10px" data-ca="del-no">No</button>' +
          '</span>';
        var okBtn = fila.querySelector('[data-ca="del-ok"]');
        var noBtn = fila.querySelector('[data-ca="del-no"]');
        if (okBtn) okBtn.addEventListener('click', async function () {
          try {
            var lista2 = await apiFetch('eliminarCategoria', [S.tok, cat]);
            if (Array.isArray(lista2)) { S.categoriasExtra = lista2; _promCats = null; }
            await cargarProductos();
            refrescarInventarioTrasCategorias();
            toast('Categoría eliminada: ' + cat, 'ok');
            cerrarModal();
          } catch (e) { toast((e && e.message) || 'No se pudo eliminar la categoría', 'error'); }
        });
        if (noBtn) noBtn.addEventListener('click', function () { reabrirCategorias(null); });
      }
    });
  });
  var ren = el('gc-renombrar');
  var rOk = el('gc-ren-ok');
  var rCan = el('gc-ren-cancel');
  if (ren && rOk) rOk.addEventListener('click', async function () {
    var nueva = ren.value.trim();
    if (!nueva) { toast('Escribe el nombre de la categoría', 'error'); return; }
    if (nueva === editando) { reabrirCategorias(null); return; }
    try {
      var lista3 = await apiFetch('renombrarCategoria', [S.tok, editando, nueva]);
      if (Array.isArray(lista3)) { S.categoriasExtra = lista3; _promCats = null; }
      await cargarProductos();
      refrescarInventarioTrasCategorias();
      toast('Categoría renombrada a "' + nueva + '"', 'ok');
      reabrirCategorias(null);
    } catch (e) { toast((e && e.message) || 'No se pudo renombrar la categoría', 'error'); }
  });
  if (ren && rCan) rCan.addEventListener('click', function () { reabrirCategorias(null); });
}

function reabrirCategorias(editando) {
  cerrarModal();
  modalCategorias(editando);
}

function refrescarInventarioTrasCategorias() {
  if (!el('prod-cat')) return;
  refrescarSelectCategorias('prod-cat', '');
  pintarTablaProductos(el('prod-bus') ? el('prod-bus').value : '', el('prod-cat').value);
}

function formularioProducto(prod) {
  var ed = !!(prod && prod.codigo);
  var p = prod || { codigo: '', nombre: '', categoria: 'General', precio_usd: '', costo_usd: '', stock: 0, stock_min: 0, activo: 1 };
  abrirModal(
    '<div class="modal-tope"><h3>' + (ed ? 'Editar producto' : 'Nuevo producto') + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<label class="campo">Código de barras / QR</label>' +
    '<div class="fila-botones"><input id="f-cod" value="' + esc(p.codigo) + '"' + (ed ? ' disabled' : '') + '>' +
    (!ed ? '<button class="btn" id="f-scan">📷</button>' : '') + '</div>' +
    '<label class="campo">Nombre</label><input id="f-nom" value="' + esc(p.nombre) + '">' +
    '<label class="campo">Categoría</label><input id="f-cat" list="lst-cat" value="' + esc(p.categoria || '') + '">' +
    '<datalist id="lst-cat">' + opcionesCategorias(false) + '</datalist>' +
    '<div class="form-2col">' +
    '<div><label class="campo">Precio ($)</label><input id="f-precio" type="number" step="0.01" min="0" value="' + esc(p.precio_usd) + '"></div>' +
    '<div><label class="campo">Costo ($)</label><input id="f-costo" type="number" step="0.01" min="0" value="' + esc(p.costo_usd || '') + '"></div>' +
    '<div><label class="campo">Stock inicial</label><input id="f-stock" type="number" min="0" value="' + esc(p.stock) + '"' + (ed ? ' disabled' : '') + '></div>' +
    '<div><label class="campo">Stock mínimo</label><input id="f-min" type="number" min="0" value="' + esc(p.stock_min || 0) + '"></div>' +
    '</div>' +
    '<label class="campo"><input type="checkbox" id="f-activo" style="width:auto"' + (String(p.activo) !== '0' ? ' checked' : '') + '> Activo</label>' +
    '<div id="f-error" class="aviso aviso-error" style="display:none;margin-top:10px"></div>' +
    '<div class="modal-acciones">' +
    '<button class="btn btn-suave" onclick="cerrarModal()">Cancelar</button>' +
    '<button class="btn btn-primario" id="f-guardar">' + (ed ? 'Guardar cambios' : 'Crear producto') + '</button></div>'
  );
  if (!ed) {
    el('f-scan').addEventListener('click', function () {
      abrirScanner(function (c) { el('f-cod').value = c; });
    });
  }
  el('f-guardar').addEventListener('click', async function () {
    var errBox = el('f-error');
    if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
    try {
      var datos = {
        codigo: (ed ? p.codigo : el('f-cod').value).trim(),
        nombre: el('f-nom').value.trim(),
        categoria: el('f-cat').value.trim(),
        precio_usd: num(el('f-precio').value),
        costo_usd: num(el('f-costo').value),
        stock: ed ? num(p.stock) : num(el('f-stock').value),
        stock_min: num(el('f-min').value),
        activo: el('f-activo').checked ? 1 : 0
      };
      var r = await API.guardarProducto(datos);
      // Si la categoría es nueva, se guarda en la hoja (aparece en el
      // desplegable de los demás artículos aunque aún no tenga otros productos).
      if (datos.categoria && datos.categoria !== 'General') {
        try {
          var nuevaLista = await apiFetch('guardarCategoria', [S.tok, datos.categoria]);
          if (Array.isArray(nuevaLista)) { S.categoriasExtra = nuevaLista; _promCats = null; }
        } catch (e) {}
      }
      // Aviso de éxito ANTES de cerrar/redibujar, para que nunca se pierda.
      toast(ed ? 'Producto actualizado' : 'Producto creado', 'ok');
      cerrarModal();
      await cargarProductos();
      var bus = el('prod-bus');
      pintarTablaProductos(bus ? bus.value : '', el('prod-cat') ? el('prod-cat').value : '');
      if (!r && window.__avisar) {
        (function () {
          var tipo = r === null ? 'null' : r === undefined ? 'undefined' : typeof r;
          var extra = DEMO ? ' La app está en MODO DEMO (sin servidor).' : '';
          API.infoServidor().then(function (sv) {
            window.__avisar('El guardado llegó vacío a la app (respuesta: ' + tipo + ').' + extra + ' El servidor está en la versión ' + (sv && sv.version ? sv.version : '?') + '. Cierra esta pestaña y abre el enlace oficial (debe decir v40 en la pantalla de entrada).');
          }).catch(function () {
            window.__avisar('El guardado llegó vacío a la app (respuesta: ' + tipo + ').' + extra + ' No se pudo consultar el servidor — parece que estás sin conexión o con una página vieja. Recarga con el enlace oficial (debe decir v40).');
          });
        })();
      }
    } catch (e) {
      var M = (e && e.message) || 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.';
      if (errBox) { errBox.textContent = '⚠️ ' + M; errBox.style.display = 'block'; }
      toast(M, 'error');
    }
  });
}

function formularioProductoPorCodigo(codigo) {
  var p = prods().find(function (x) { return String(x.codigo) === String(codigo); });
  if (p) { formularioProducto(p); toast('Producto encontrado por código', 'ok'); }
  else { formularioProducto({ codigo: codigo, categoria: 'General' }); toast('Código nuevo: completa los datos', 'ok'); }
}

function verProducto(codigo) {
  var p = prods().find(function (x) { return String(x.codigo) === codigo; });
  if (!p) { toast('Producto no encontrado: ' + codigo, 'error'); return; }
  abrirModal(
    '<div class="modal-tope"><h3>' + esc(p.nombre) + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<p class="muted mono">' + esc(p.codigo) + ' · ' + esc(p.categoria) + '</p>' +
    '<div class="resumen-venta">' +
    '<div class="cajita"><small>Precio</small><div class="tot">' + fmtUSD(p.precio_usd) + '</div></div>' +
    '<div class="cajita"><small>En Bolívares</small><div class="tot">' + fmtVES(p.precio_usd * (S.tasa || 0)) + '</div></div>' +
    '<div class="cajita"><small>Stock</small><div class="tot">' + fmtCant(p.stock) + '</div></div>' +
    '<div class="cajita"><small>Mínimo</small><div class="tot">' + fmtCant(p.stock_min) + '</div></div>' +
    '</div>'
  );
}

function formularioStock(codigo) {
  var p = prods().find(function (x) { return String(x.codigo) === String(codigo); });
  if (!p) return;
  abrirModal(
    '<div class="modal-tope"><h3>Ajustar stock — ' + esc(p.nombre) + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<p class="muted">Stock actual: <b>' + fmtCant(p.stock) + '</b> · Precio: ' + fmtUSD(p.precio_usd) + '</p>' +
    '<label class="campo">Tipo de movimiento</label>' +
    '<select id="f-mov">' +
    '<option value="entrada">Entrada (compra / devolución)</option>' +
    '<option value="salida">Salida (merma / ajuste)</option>' +
    '<option value="conteo">Colocar stock exacto (conteo)</option>' +
    '</select>' +
    '<label class="campo">Cantidad</label><input id="f-cant" type="number" min="0" step="any" value="1">' +
    '<div class="modal-acciones">' +
    '<button class="btn btn-suave" onclick="cerrarModal()">Cancelar</button>' +
    '<button class="btn btn-primario" id="f-mov-go">Aplicar</button></div>'
  );
  el('f-mov-go').addEventListener('click', async function () {
    var mov = el('f-mov').value;
    var cant = num(el('f-cant').value);
    if (cant <= 0) { toast('Cantidad inválida', 'error'); return; }
    var delta = 0;
    if (mov === 'entrada') delta = cant;
    else if (mov === 'salida') delta = -cant;
    else delta = cant - num(p.stock);
    try {
      await API.ajustarStock(codigo, delta, mov);
      cerrarModal();
      await cargarProductos();
      var bus = el('prod-bus');
      pintarTablaProductos(bus ? bus.value : '');
      toast('Stock actualizado', 'ok');
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ============================================================
   PANTALLA: HISTORIAL DE VENTAS
   ============================================================ */
render.ventas = async function () {
  var h = hoyLocal();
  pintar(
    '<div class="tarjeta"><h2>🧾 Historial de ventas</h2>' +
    '<div class="form-2col">' +
    '<div><label class="campo">Desde</label><input type="date" id="v-desde" value="' + h + '"></div>' +
    '<div><label class="campo">Hasta</label><input type="date" id="v-hasta" value="' + h + '"></div>' +
    '</div>' +
    (puedoEditar() ? '<label class="campo">Vendedor</label><select id="v-vend"></select>' : '') +
    '<div class="fila-botones">' +
    '<button class="btn btn-primario" id="v-buscar">Buscar</button>' +
    '<button class="btn" id="v-hoy">Hoy</button>' +
    '<button class="btn" id="v-mes">Este mes</button>' +
    '</div></div>' +
    '<div id="v-resumen"></div>' +
    '<div id="v-lista"></div>'
  );
  if (puedoEditar()) {
    // La lista de vendedores se pinta sola cuando llegue (en paralelo, no bloquea).
    var pUsu = API.listarUsuarios().catch(function () { return []; });
  }
  async function cargar() {
    var f = {
      desde: el('v-desde').value || '',
      hasta: el('v-hasta').value || '',
      vendedor: puedoEditar() ? el('v-vend').value : S.usuario
    };
    await pintarVentas(f);
  }
  el('v-buscar').addEventListener('click', cargar);
  el('v-hoy').addEventListener('click', function () {
    el('v-desde').value = h; el('v-hasta').value = h;
    cargar();
  });
  el('v-mes').addEventListener('click', function () {
    el('v-desde').value = h.slice(0, 8) + '01';
    el('v-hasta').value = h;
    cargar();
  });
  await cargar();
  if (puedoEditar()) {
    var usrs = await pUsu;
    var vv = el('v-vend');
    if (vv) vv.innerHTML = '<option value="">Todos</option>' + usrs.map(function (u) {
      return '<option value="' + esc(u.usuario) + '">' + esc(u.nombre || u.usuario) + '</option>';
    }).join('');
  }
};

async function pintarVentas(f) {
  var resumen = el('v-resumen');
  var cont = el('v-lista');
  if (!resumen || !cont) return;
  var aplicar = function (lista) {
    var totUSD = lista.reduce(function (s, v) { return s + num(v.total_usd); }, 0);
    var totVES = lista.reduce(function (s, v) { return s + num(v.total_ves); }, 0);
    var porMetodo = {};
    lista.forEach(function (v) {
      var m = String(v.metodo || 'otro');
      porMetodo[m] = (porMetodo[m] || 0) + num(v.total_usd);
    });
    resumen.innerHTML = '<div class="grid-cards">' +
      '<div class="card-kpi"><div class="k-etiq">Ventas</div><div class="k-num k-azul">' + lista.length + '</div></div>' +
      '<div class="card-kpi"><div class="k-etiq">Total $</div><div class="k-num k-verde">' + fmtUSD(totUSD) + '</div></div>' +
      '<div class="card-kpi"><div class="k-etiq">Total Bs</div><div class="k-num">' + fmtVES(totVES) + '</div></div>' +
      '</div>' +
      (Object.keys(porMetodo).length ? '<div class="tarjeta" style="margin-top:12px"><h2>Por método de pago ($)</h2><div class="detalle-venta">' +
        Object.keys(porMetodo).map(function (m) {
          return '<div class="d-lin"><span>' + nombreMetodo(m) + '</span><span class="negrita">' + fmtUSD(porMetodo[m]) + ' <span class="muted">·</span> ' + fmtVES(porMetodo[m] * (S.tasa || 0)) + '</span></div>';
        }).join('') + '</div></div>' : '');
    if (!lista.length) { cont.innerHTML = '<div class="tarjeta muted">No hay ventas en ese rango.</div>'; return; }
    cont.innerHTML = '<div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
      '<th>Fecha</th><th>Vendedor</th><th>Cliente</th><th>Pago</th><th class="der">Art.</th><th class="der">Total $</th><th class="der">Total Bs</th><th></th>' +
      '</tr></thead><tbody>' +
      lista.map(function (v, i) {
        var nArt = 0;
        try { nArt = JSON.parse(v.items || '[]').reduce(function (s, it) { return s + num(it.cantidad); }, 0); } catch (e) {}
        return '<tr>' +
          '<td class="mono">' + fechaHora(v.fecha) + '</td>' +
          '<td>' + esc(v.empleado_nombre || v.vendedor) + '</td>' +
          '<td>' + esc(v.cliente_nombre || v.cliente_documento || '—') + '</td>' +
          '<td>' + nombreMetodo(v.metodo) + '</td>' +
          '<td class="der">' + nArt + '</td>' +
          '<td class="der negrita">' + fmtUSD(v.total_usd) + '</td>' +
          '<td class="der">' + fmtVES(v.total_ves) + '</td>' +
          '<td class="der"><button class="btn btn-suave" style="padding:6px 10px" data-ver="' + i + '">Ver</button></td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div>';
    Array.prototype.forEach.call(cont.querySelectorAll('[data-ver]'), function (b) {
      b.addEventListener('click', function () {
        var v = lista[num(b.getAttribute('data-ver'))];
        verDetalleVenta(v);
      });
    });
  };
  await datosRapidos('ventas:' + JSON.stringify(f), 15000, function () { return API.listarVentas(f); }, aplicar);
}

function verDetalleVenta(v) {
  var det = [];
  try { det = JSON.parse(v.items || '[]'); } catch (e) {}
  abrirModal(
    '<div class="modal-tope"><h3>Venta ' + esc(v.id) + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<p class="muted">' + fechaHora(v.fecha) + ' · ' + esc(v.empleado_nombre || v.vendedor) + ' · ' + nombreMetodo(v.metodo) + '</p>' +
    (det.length ? '<div class="tarjeta" style="margin-bottom:8px"><h2>Artículos</h2><div class="detalle-venta">' + det.map(function (it) {
      return '<div class="d-lin"><span>' + fmtCant(it.cantidad) + ' × ' + esc(it.nombre) + '</span><span class="negrita">' + fmtUSD(it.sub_usd) + '</span></div>';
    }).join('') + '</div></div>' : '') +
    (v.cliente_nombre || v.cliente_documento ?
      '<div class="tarjeta" style="margin-bottom:8px"><h2>Cliente</h2><div class="detalle-venta">' +
      '<div class="d-lin"><span>Nombre</span><span class="negrita">' + esc(v.cliente_nombre || '—') + '</span></div>' +
      '<div class="d-lin"><span>Cédula / RIF</span><span>' + esc(v.cliente_documento || '—') + '</span></div>' +
      (v.cliente_telefono ? '<div class="d-lin"><span>Teléfono</span><span>' + esc(v.cliente_telefono) + '</span></div>' : '') +
      (v.cliente_direccion ? '<div class="d-lin"><span>Dirección</span><span>' + esc(v.cliente_direccion) + '</span></div>' : '') +
      '</div></div>' : '') +
    '<div class="fila-entre"><span class="negrita">Total $</span><span class="negrita">' + fmtUSD(v.total_usd) + '</span></div>' +
    '<div class="fila-entre"><span>Total Bs (tasa ' + fmtNum(v.tasa) + ')</span><span>' + fmtVES(v.total_ves) + '</span></div>' +
    (v.nota ? '<p class="muted">Nota: ' + esc(v.nota) + '</p>' : '')
  );
}

/* ============================================================
   PANTALLA: REPORTES COMPARATIVOS (solo administrador)
   Compara dos periodos (día, semana, mes o año): cuánto se
   ingresó (ventas), cuánto se egresó (gastos + sueldos pagados +
   obras) y cuánto quedó libre, todo en $ y en Bs.
   ============================================================ */
var REP_TIPOS = [
  ['dia', 'Día vs día', 'date'],
  ['semana', 'Semana vs semana', 'date'],
  ['mes', 'Mes vs mes', 'month'],
  ['anio', 'Año vs año', 'number']
];

// Periodo "actual" (cual = 0) o "anterior" (cual = 1) para cada tipo.
function repPeriodo(tipo, cual) {
  var hoy = new Date();
  var fDM = function (d) {
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + dd;
  };
  if (tipo === 'dia') {
    var d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - cual);
    return fDM(d);
  }
  if (tipo === 'semana') {
    var ds = hoy.getDay(), off = ds === 0 ? -6 : 1 - ds;
    var lun = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + off - cual * 7);
    return fDM(lun);
  }
  if (tipo === 'mes') {
    var m2 = new Date(hoy.getFullYear(), hoy.getMonth() - cual, 1);
    return m2.getFullYear() + '-' + ('0' + (m2.getMonth() + 1)).slice(-2);
  }
  return String(hoy.getFullYear() - cual);
}

render.reportes = async function () {
  pintar(
    '<div class="tarjeta"><h2>📊 Reportes comparativos</h2>' +
    '<p class="muted">Compara dos periodos: cuánto ingresaste, cuánto egresaste y cuánto quedó libre del negocio, en dólares ($) y bolívares (Bs).</p>' +
    '<label class="campo">Comparar por</label>' +
    '<select id="rep-tipo">' + REP_TIPOS.map(function (t) {
      return '<option value="' + t[0] + '"' + (t[0] === 'mes' ? ' selected' : '') + '>' + t[1] + '</option>';
    }).join('') + '</select>' +
    '<div class="form-2col" style="margin-top:4px">' +
    '<div><label class="campo" id="rep-lab-a">Periodo A</label><input id="rep-a"></div>' +
    '<div><label class="campo" id="rep-lab-b">Periodo B</label><input id="rep-b"></div>' +
    '</div>' +
    '<div class="fila-botones">' +
    '<button class="btn btn-primario" id="rep-go">Generar comparación</button>' +
    '<button class="btn" id="rep-recientes">↻ Actual vs anterior</button>' +
    '</div></div>' +
    '<div id="rep-res"><div class="cargando">Calculando…</div></div>'
  );
  var res = el('rep-res');
  function configInputs() {
    var t = el('rep-tipo').value;
    var ta = REP_TIPOS.find(function (x) { return x[0] === t; });
    var a = el('rep-a'), b = el('rep-b');
    a.type = ta[2]; b.type = ta[2];
    a.value = repPeriodo(t, 0);
    b.value = repPeriodo(t, 1);
    if (ta[2] === 'number') { a.min = 2000; a.max = 2100; a.step = 1; b.min = 2000; b.max = 2100; b.step = 1; }
    if (t === 'dia') { el('rep-lab-a').textContent = 'Día A'; el('rep-lab-b').textContent = 'Día B (anterior)'; }
    else if (t === 'semana') {
      el('rep-lab-a').textContent = 'Semana A (cualquier día)';
      el('rep-lab-b').textContent = 'Semana B (cualquier día)';
    }
    else if (t === 'mes') { el('rep-lab-a').textContent = 'Mes A'; el('rep-lab-b').textContent = 'Mes B (anterior)'; }
    else { el('rep-lab-a').textContent = 'Año A'; el('rep-lab-b').textContent = 'Año B (anterior)'; }
  }
  async function generar() {
    var t = el('rep-tipo').value;
    var a = el('rep-a').value.trim();
    var b = el('rep-b').value.trim();
    if (!a || !b) { toast('Indica los dos periodos a comparar.', 'error'); return; }
    if (a === b) { toast('Los dos periodos son iguales: elige dos distintos.', 'error'); return; }
    res.innerHTML = '<div class="cargando">Calculando…</div>';
    try {
      var r = await API.reporteComparativo(t, a, b);
      if (S.pagina !== 'reportes') return; // el usuario ya cambió de pantalla
      pintarReporte(r);
    } catch (e) {
      if (S.pagina !== 'reportes') return;
      res.innerHTML = '<div class="tarjeta"><div class="aviso aviso-error">' + esc((e && e.message) || 'No se pudo generar el reporte.') + '</div></div>';
    }
  }
  el('rep-a').addEventListener('keydown', function (e) { if (e.key === 'Enter') generar(); });
  el('rep-b').addEventListener('keydown', function (e) { if (e.key === 'Enter') generar(); });
  el('rep-tipo').addEventListener('change', function () { configInputs(); generar(); });
  el('rep-go').addEventListener('click', generar);
  el('rep-recientes').addEventListener('click', function () { configInputs(); generar(); });
  configInputs();
  generar(); // muestra de entrada el periodo actual vs el anterior
};

function pintarReporte(r) {
  var A = r.A, B = r.B, res = el('rep-res');
  if (!res) return;
  function repLinea(nombre, usd, ves, cl) {
    return '<div class="d-lin"><span>' + nombre + '</span>' +
      '<span class="negrita' + (cl ? ' ' + cl : '') + '">' + fmtUSD(usd) + '<small class="rep-bs"> (' + fmtVES(ves) + ')</small></span></div>';
  }
  function bloq(p, letra) {
    return '<div class="tarjeta rep-per"><div class="rep-per-cab">' + letra + ' · ' + esc(p.etiqueta) + '</div>' +
      '<div class="detalle-venta">' +
      repLinea('💵 Ventas (ingreso)', p.ingreso_usd, p.ingreso_ves, 'k-verde') +
      repLinea('💸 Egresos', p.egreso_usd, p.egreso_ves, 'k-rojo') +
      repLinea('🧮 Quedó libre', p.libre_usd, p.libre_ves, p.libre_usd < 0 ? 'k-rojo' : 'k-azul') +
      '</div>' +
      '<p class="muted" style="margin-top:8px">' + p.ventas + ' ventas · ' + p.gastos + ' gastos · ' +
      p.sueldos + ' sueldos · ' + p.obras + ' gastos de obras' +
      (p.tasa ? ' · tasa media Bs ' + fmtNum(p.tasa) : '') + '</p></div>';
  }
  function celda(usd, ves, conSigno, cl) {
    return '<td class="der">' +
      '<div class="rep-monto' + (cl ? ' ' + cl : '') + '">' + (conSigno && usd >= 0 ? '+' : '') + fmtUSD(usd) + '</div>' +
      '<div class="rep-monto rep-bs' + (cl ? ' ' + cl : '') + '">' + (conSigno && ves >= 0 ? '+' : '') + fmtVES(ves) + '</div></td>';
  }
  var filas = [
    { n: 'Ventas (ingreso)', aU: num(A.ingreso_usd), aV: num(A.ingreso_ves), bU: num(B.ingreso_usd), bV: num(B.ingreso_ves), clA: '', clB: '' },
    { n: 'Gastos', aU: num(A.gastos_usd), aV: num(A.gastos_usd) * num(A.tasa), bU: num(B.gastos_usd), bV: num(B.gastos_usd) * num(B.tasa) },
    { n: 'Sueldos pagados', aU: num(A.sueldos_usd), aV: num(A.sueldos_usd) * num(A.tasa), bU: num(B.sueldos_usd), bV: num(B.sueldos_usd) * num(B.tasa) },
    { n: 'Gastos de obras', aU: num(A.obras_usd), aV: num(A.obras_usd) * num(A.tasa), bU: num(B.obras_usd), bV: num(B.obras_usd) * num(B.tasa) },
    { n: '💸 Total egresos', aU: num(A.egreso_usd), aV: num(A.egreso_ves), bU: num(B.egreso_usd), bV: num(B.egreso_ves), clA: 'k-rojo', clB: 'k-rojo' },
    { n: '🧮 Quedó libre', aU: num(A.libre_usd), aV: num(A.libre_ves), bU: num(B.libre_usd), bV: num(B.libre_ves), clA: num(A.libre_usd) < 0 ? 'k-rojo' : 'k-azul', clB: num(B.libre_usd) < 0 ? 'k-rojo' : 'k-azul' }
  ];
  var dLib = num(B.libre_usd) - num(A.libre_usd);
  var dLibVes = num(B.libre_ves) - num(A.libre_ves);
  var balCl = Math.abs(dLib) < 0.005 ? 'muted' : (dLib > 0 ? 'k-verde' : 'k-rojo');
  res.innerHTML =
    '<div class="grid-cards" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">' + bloq(A, 'A') + bloq(B, 'B') + '</div>' +
    '<div class="tarjeta" style="margin-top:14px"><h2>⚖️ Comparación</h2>' +
    '<div class="tabla-envoltura" style="margin-top:8px"><table class="tabla" style="min-width:560px"><thead><tr>' +
    '<th>Concepto</th><th class="der">Periodo A</th><th class="der">Periodo B</th><th class="der">Diferencia (B − A)</th>' +
    '</tr></thead><tbody>' +
    filas.map(function (f) {
      var dU = f.bU - f.aU, dV = f.bV - f.aV;
      var clD = Math.abs(dU) < 0.005 ? '' : (dU > 0 ? 'k-verde' : 'k-rojo');
      return '<tr>' +
        '<td class="negrita">' + f.n + '</td>' +
        celda(f.aU, f.aV, false, f.clA) +
        celda(f.bU, f.bV, false, f.clB) +
        celda(dU, dV, true, clD) +
        '</tr>';
    }).join('') +
    '</tbody></table></div>' +
    '<div class="fila-entre" style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--borde)">' +
    '<span class="negrita">Balance del periodo B vs A</span>' +
    '<span class="negrita ' + balCl + '">' +
    (dLib >= 0 ? 'Quedó libre ' + fmtUSD(dLib) + ' MÁS' : 'Quedó libre ' + fmtUSD(Math.abs(dLib)) + ' MENOS') +
    '<small class="rep-bs"> (' + fmtVES(Math.abs(dLibVes)) + ')</small></span></div>' +
    '<p class="muted" style="margin-top:8px">Los Bs de egresos se convierten con la tasa media de cada periodo' +
    ' (A: 1 $ = Bs ' + fmtNum(A.tasa) + ' · B: 1 $ = Bs ' + fmtNum(B.tasa) + ').' +
    ' Los Bs de ventas son los reales con los que se cobró.</p>' +
    '</div>';
}

/* ============================================================
   PANTALLA: GASTOS
   ============================================================ */
render.gastos = async function () {
  var mes = hoyLocal().slice(0, 7);
  pintar(
    '<div class="tarjeta"><h2>💸 Gastos</h2>' +
    '<div class="form-2col">' +
    '<div><label class="campo">Mes</label><input type="month" id="g-mes" value="' + mes + '"></div>' +
    (puedoEditar() ? '<div style="display:flex;align-items:flex-end"><button class="btn btn-primario btn-ancho" id="g-nuevo">＋ Nuevo gasto</button></div>' : '') +
    '</div></div>' +
    '<div id="g-total"></div>' +
    '<div id="g-lista"></div>'
  );
  if (puedoEditar()) el('g-nuevo').addEventListener('click', formularioGasto);
  el('g-mes').addEventListener('change', cargarGastos);
  async function cargarGastos() {
    var m = el('g-mes').value;
    if (!m) return;
    var aplicar = function (lista) {
      var tot = lista.reduce(function (s, g) { return s + num(g.monto_usd); }, 0);
      el('g-total').innerHTML = '<div class="card-kpi" style="margin-top:12px">' +
        '<div class="k-etiq">Total del mes (en $)</div>' +
        '<div class="k-num k-rojo">' + fmtUSD(tot) + '</div>' +
        '<div class="k-etiq">' + fmtVES(tot * (S.tasa || 0)) + '</div></div>';
      if (!lista.length) { el('g-lista').innerHTML = '<div class="tarjeta muted">Sin gastos este mes.</div>'; return; }
      el('g-lista').innerHTML = '<div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
        '<th>Fecha</th><th>Concepto</th><th>Cat.</th><th class="der">Monto $</th>' + (puedoEditar() ? '<th></th>' : '') +
        '</tr></thead><tbody>' +
        lista.map(function (g, i) {
          return '<tr><td class="mono">' + fechaCorta(g.fecha) + '</td>' +
            '<td>' + esc(g.concepto) + (g.responsable ? '<br><small class="muted">' + esc(g.responsable) + '</small>' : '') + '</td>' +
            '<td>' + esc(g.categoria) + '</td>' +
            '<td class="der negrita">' + fmtUSD(g.monto_usd) + '</td>' +
            (puedoEditar() ? '<td class="der"><button class="btn btn-peligro" style="padding:5px 9px" data-del="' + i + '">🗑</button></td>' : '') +
            '</tr>';
        }).join('') +
        '</tbody></table></div>';
      if (puedoEditar()) {
        Array.prototype.forEach.call(el('g-lista').querySelectorAll('[data-del]'), function (b) {
          b.addEventListener('click', async function () {
            var g = lista[num(b.getAttribute('data-del'))];
            if (await confirmar('¿Eliminar el gasto "' + g.concepto + '"?')) {
              try { await API.eliminarGasto(g.id); toast('Gasto eliminado', 'ok'); cargarGastos(); }
              catch (e) { toast(e.message, 'error'); }
            }
          });
        });
      }
    };
    await datosRapidos('gastos:' + m, 15000, function () { return API.listarGastos({ desde: m + '-01', hasta: m + '-31' }); }, aplicar);
  }
  await cargarGastos();
};

function formularioGasto() {
  abrirModal(
    '<div class="modal-tope"><h3>Nuevo gasto</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<label class="campo">Fecha</label><input type="date" id="ga-fecha" value="' + hoyLocal() + '">' +
    '<label class="campo">Concepto</label><input id="ga-conc" placeholder="Ej: Combustible">' +
    '<label class="campo">Categoría</label><div class="categorias" id="ga-cats">' + CATEGORIAS_GASTO.map(function (c, i) {
      return '<span class="cat-chip' + (i === 0 ? ' sel' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</span>';
    }).join('') + '</div>' +
    '<label class="campo">Monto ($)</label><input id="ga-monto" type="number" step="0.01" min="0.01">' +
    '<label class="campo">Responsable (opcional)</label><input id="ga-resp">' +
    '<div class="modal-acciones"><button class="btn btn-suave" onclick="cerrarModal()">Cancelar</button>' +
    '<button class="btn btn-primario" id="ga-guardar">Guardar</button></div>'
  );
  var catSel = 'General';
  Array.prototype.forEach.call(el('ga-cats').querySelectorAll('.cat-chip'), function (c) {
    c.addEventListener('click', function () {
      Array.prototype.forEach.call(el('ga-cats').querySelectorAll('.cat-chip'), function (x) { x.classList.remove('sel'); });
      c.classList.add('sel');
      catSel = c.getAttribute('data-cat');
    });
  });
  el('ga-guardar').addEventListener('click', async function () {
    var g = {
      fecha: el('ga-fecha').value,
      concepto: el('ga-conc').value,
      categoria: catSel,
      monto_usd: num(el('ga-monto').value),
      responsable: el('ga-resp').value
    };
    try { await API.guardarGasto(g); cerrarModal(); toast('Gasto registrado', 'ok'); irA('gastos'); }
    catch (e) { toast(e.message, 'error'); }
  });
}

/* ============================================================
   PANTALLA: NÓMINA / EMPLEADOS / SUELDOS
   ============================================================ */
render.nomina = async function (params) {
  var sub = (params && params.sub === 'sueldos') ? 'sueldos' : 'empleados';
  pintar(
    '<div class="fila-botones" style="margin-bottom:12px">' +
    '<button class="btn ' + (sub === 'empleados' ? 'btn-primario' : '') + '" id="nb-emp">👥 Empleados</button>' +
    '<button class="btn ' + (sub === 'sueldos' ? 'btn-primario' : '') + '" id="nb-suel">💰 Sueldos</button>' +
    '</div><div id="nom-cont"></div>'
  );
  el('nb-emp').addEventListener('click', function () { irA('nomina', { sub: 'empleados' }); });
  el('nb-suel').addEventListener('click', function () { irA('nomina', { sub: 'sueldos' }); });
  if (sub === 'empleados') await renderSubEmpleados();
  else await renderSubSueldos();
};

async function renderSubEmpleados() {
  var cont = el('nom-cont');
  cont.innerHTML = '<div class="fila-entre"><h2 style="margin:0">Empleados</h2>' +
    (puedoEditar() ? '<button class="btn btn-primario" id="e-nuevo">＋ Nuevo</button>' : '') + '</div>' +
    '<div id="e-lista"></div>';
  if (puedoEditar()) el('e-nuevo').addEventListener('click', function () { formularioEmpleado(null); });
  var aplicar = function (emp) {
    if (!emp.length) { el('e-lista').innerHTML = '<div class="tarjeta muted">Aún no hay empleados.</div>'; return; }
    el('e-lista').innerHTML = '<div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
      '<th>Nombre</th><th>Cargo</th><th class="der">Sueldo/día $</th><th>Días que trabaja</th><th class="der">Bs/día</th><th>Ingreso</th><th>Estado</th>' +
      (puedoEditar() ? '<th></th>' : '') + '</tr></thead><tbody>' +
      emp.map(function (e, i) {
        var sd = num(e.sueldo_diario || e.salario_usd);
        var dias = diasSemanaTexto(e.dias_semana);
        var faltaConf = (!num(e.sueldo_diario || e.salario_usd) || !e.dias_semana) ? ' <span class="etq etq-peligro" title="Falta configurar sueldo diario o días">⚠️</span>' : '';
        return '<tr' + (String(e.activo) !== '1' ? ' style="opacity:.45"' : '') + '>' +
          '<td class="negrita">' + esc(e.nombre) + faltaConf + '</td>' +
          '<td>' + esc(e.cargo) + '</td>' +
          '<td class="der">' + fmtUSD(sd) + '</td>' +
          '<td>' + esc(dias) + '</td>' +
          '<td class="der muted">' + fmtVES(sd * (S.tasa || 0)) + '</td>' +
          '<td>' + fechaCorta(e.fecha_ingreso) + '</td>' +
          '<td>' + (String(e.activo) === '1' ? '<span class="etq etq-ok">Activo</span>' : '<span class="etq etq-peligro">Inactivo</span>') + '</td>' +
          (puedoEditar() ? '<td><button class="btn" style="padding:6px 10px" data-ed="' + i + '">✏️</button></td>' : '') +
          '</tr>';
      }).join('') +
      '</tbody></table></div>';
    if (puedoEditar()) {
      Array.prototype.forEach.call(el('e-lista').querySelectorAll('[data-ed]'), function (b) {
        b.addEventListener('click', function () {
          formularioEmpleado(emp[num(b.getAttribute('data-ed'))]);
        });
      });
    }
  };
  await datosRapidos('empleados', 60000, function () { return API.listarEmpleados(); }, aplicar);
}

function formularioEmpleado(e) {
  var ed = !!(e && e.id);
  var v = e || {};
  var diasSel = String(v.dias_semana || '').split(',');
  var chks = '';
  for (var n = 1; n <= 7; n++) {
    var on = diasSel.indexOf(String(n)) >= 0;
    chks += '<label style="display:flex;align-items:center;gap:4px;background:#f4f4f5;border-radius:8px;padding:6px 10px;font-size:13px">' +
      '<input type="checkbox" class="em-dia" value="' + n + '" style="width:auto"' + (on ? ' checked' : '') + '>' + DIAS_CORTOS[n] + '</label>';
  }
  var salVal = (v.sueldo_diario != null && v.sueldo_diario !== '') ? v.sueldo_diario : (v.salario_usd || '');
  abrirModal(
    '<div class="modal-tope"><h3>' + (ed ? 'Editar empleado' : 'Nuevo empleado') + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<label class="campo">Nombre</label><input id="em-nom" value="' + esc(v.nombre || '') + '">' +
    '<div class="form-2col">' +
    '<div><label class="campo">Cargo</label><input id="em-cargo" value="' + esc(v.cargo || '') + '"></div>' +
    '<div><label class="campo">Sueldo diario ($)</label><input id="em-sal" type="number" step="0.01" min="0" value="' + esc(salVal) + '"></div>' +
    '</div>' +
    '<label class="campo">Días que trabaja</label>' +
    '<div id="em-dias" style="display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 10px">' + chks + '</div>' +
    '<label class="campo">Fecha de ingreso</label><input type="date" id="em-fecha" value="' + (fechaCorta(v.fecha_ingreso) || hoyLocal()) + '">' +
    '<label class="campo"><input type="checkbox" id="em-act" style="width:auto"' + (String(v.activo) !== '0' ? ' checked' : '') + '> Activo</label>' +
    '<div class="modal-acciones"><button class="btn btn-suave" onclick="cerrarModal()">Cancelar</button>' +
    '<button class="btn btn-primario" id="em-guardar">Guardar</button></div>'
  );
  el('em-guardar').addEventListener('click', async function () {
    var dias = [];
    Array.prototype.forEach.call(document.querySelectorAll('#em-dias .em-dia'), function (c) { if (c.checked) dias.push(c.value); });
    try {
      await API.guardarEmpleado({
        id: v.id, nombre: el('em-nom').value, cargo: el('em-cargo').value,
        sueldo_diario: num(el('em-sal').value), dias_semana: dias.join(','),
        fecha_ingreso: el('em-fecha').value,
        activo: el('em-act').checked ? 1 : 0
      });
      cerrarModal(); toast('Empleado guardado', 'ok'); irA('nomina', { sub: 'empleados' });
    } catch (err) { toast(err.message, 'error'); }
  });
}

var DIAS_CORTOS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

async function renderSubSueldos() {
  var cont = el('nom-cont');
  cont.innerHTML = '<div id="s-lista"></div>';
  async function cargar() {
    var aplicar = function (n) {
      n = n || {};
      var emp = n.empleados || [];
      var k = n.kpis || {};
      var pagos = n.pagos || [];
      var activos = emp.filter(function (e) { return String(e.activo) === '1'; });
      var pend = emp.filter(function (e) { return num(e.pend_dias) > 0; });
      el('s-lista').innerHTML =
        '<div class="grid-cards">' +
        '<div class="card-kpi"><div class="k-etiq">Pendiente por pagar</div><div class="k-num k-rojo">' + fmtUSD(k.pend_usd) + '</div><div class="k-etiq">' + (k.pend_dias || 0) + ' días</div></div>' +
        '<div class="card-kpi"><div class="k-etiq">Pagado este mes</div><div class="k-num k-verde">' + fmtUSD(k.pag_mes_usd) + '</div><div class="k-etiq">' + (k.pag_mes_dias || 0) + ' días</div></div>' +
        '</div>' +
        '<div class="tarjeta"><div class="fila-entre"><h2 style="margin:0">💰 Pendientes por empleado</h2>' +
        (puedoEditar() ? '<button class="btn btn-primario" id="s-nuevo">＋ Registrar pago</button>' : '') + '</div>' +
        (pend.length
          ? '<div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
            '<th>Empleado</th><th>Días que trabaja</th><th class="der">Sueldo/día $</th><th class="der">Días</th><th class="der">Pendiente $</th>' +
            (puedoEditar() ? '<th></th>' : '') + '</tr></thead><tbody>' +
            pend.map(function (e) {
              return '<tr><td class="negrita">' + esc(e.nombre) + '</td>' +
                '<td class="muted">' + esc(e.dias_txt) + '</td>' +
                '<td class="der">' + fmtUSD(e.sueldo_diario) + '</td>' +
                '<td class="der">' + e.pend_dias + '</td>' +
                '<td class="der negrita k-rojo">' + fmtUSD(e.pend_usd) + '</td>' +
                (puedoEditar() ? '<td><button class="btn btn-ok" style="padding:6px 10px" data-pagar="' + esc(e.id) + '">Pagar</button></td>' : '') +
                '</tr>';
            }).join('') + '</tbody></table></div>'
          : '<div class="muted" style="margin-top:8px">No hay sueldos pendientes. 🎉</div>') +
        '</div>' +
        (puedoEditar()
          ? '<div class="tarjeta"><div class="fila-entre"><div><strong>⏰ Corrida automática</strong><br>' +
            '<span class="muted" id="s-trig-estado">Consultando…</span></div>' +
            '<div class="fila-botones"><button class="btn" id="s-rec">🔄 Recalcular</button>' +
            '<button class="btn" id="s-trig">Activar / reparar</button></div></div></div>'
          : '') +
        '<div class="tarjeta"><h2>🧾 Pagos de ' + esc(n.mes || '') + '</h2>' +
        (pagos.length
          ? '<div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Fecha</th><th>Empleado</th><th class="der">Días</th><th class="der">Monto $</th><th class="der">Bs</th></tr></thead><tbody>' +
            pagos.map(function (p) {
              return '<tr><td>' + fechaCorta(p.fecha) + '</td><td>' + esc(p.empleado) + '</td>' +
                '<td class="der">' + p.dias + '</td><td class="der">' + fmtUSD(p.usd) + '</td>' +
                '<td class="der muted">' + fmtVES(p.usd * (S.tasa || 0)) + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<div class="muted" style="margin-top:8px">Sin pagos este mes.</div>') +
        '</div>';
      if (puedoEditar()) {
        if (el('s-nuevo')) el('s-nuevo').addEventListener('click', function () {
          var conP = activos.filter(function (e) { return num(e.pend_dias) > 0; });
          if (!conP.length) { toast('No hay días pendientes por pagar', 'error'); return; }
          if (conP.length === 1) formularioPagoSueldo(conP[0]);
          else selectorEmpleadoPago(conP);
        });
        Array.prototype.forEach.call(el('s-lista').querySelectorAll('[data-pagar]'), function (b) {
          b.addEventListener('click', function () {
            var id = b.getAttribute('data-pagar');
            var e = emp.filter(function (x) { return String(x.id) === String(id); })[0];
            formularioPagoSueldo(e);
          });
        });
        if (el('s-trig')) el('s-trig').addEventListener('click', instalarTriggersNominaUI);
        if (el('s-rec')) el('s-rec').addEventListener('click', async function () {
          try { var r = await API.corridaNominaManual(); toast('Corrida hecha: ' + ((r && r.creadas) || 0) + ' día(s) nuevos', 'ok'); cargar(); }
          catch (er) { toast(er.message, 'error'); }
        });
      }
      pintarEstadoTriggers();
    };
    await datosRapidos('nomina', 10000, function () { return API.getNomina(); }, aplicar);
  }
  await cargar();
}

// Modal de pago: lista los días pendientes con casilla (marcado = se paga).
// Los días que se desmarcan quedan como "no trabajó" (no se cobran).
function formularioPagoSueldo(emp) {
  if (!emp) return;
  API.diasPendientes(emp.id).then(function (lista) {
    lista = (lista || []).slice();
    if (!lista.length) { toast('Ese empleado no tiene días pendientes', 'error'); return; }
    var total = lista.reduce(function (a, x) { return a + num(x.monto_usd); }, 0);
    var filas = lista.map(function (d) {
      var etq = d.fecha_dia ? etiquetaFechaCorta(d.fecha_dia) : ('Periodo ' + (d.periodo || '') + ' (registro anterior)');
      return '<label style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-bottom:1px solid #eee">' +
        '<span style="display:flex;align-items:center;gap:8px"><input type="checkbox" class="pg-dia" value="' + esc(d.id) + '" data-monto="' + num(d.monto_usd) + '" checked style="width:auto"> ' + esc(etq) + '</span>' +
        '<b>' + fmtUSD(d.monto_usd) + '</b></label>';
    }).join('');
    abrirModal(
      '<div class="modal-tope"><h3>Pagar sueldo · ' + esc(emp.nombre) + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
      '<p class="muted" style="margin:4px 0 8px">Desmarca los días que <b>no trabajó</b>: esos no se cobran.</p>' +
      '<div style="max-height:46vh;overflow:auto;border:1px solid #eee;border-radius:10px">' + filas + '</div>' +
      '<div class="fila-entre" style="margin-top:10px"><strong>Total a pagar</strong><strong id="pg-total" class="k-verde">' + fmtUSD(total) + '</strong></div>' +
      '<div class="modal-acciones"><button class="btn btn-suave" onclick="cerrarModal()">Cancelar</button>' +
      '<button class="btn btn-primario" id="pg-guardar">Registrar pago</button></div>'
    );
    function recalcular() {
      var t = 0;
      Array.prototype.forEach.call(document.querySelectorAll('.pg-dia'), function (c) { if (c.checked) t += num(c.getAttribute('data-monto')); });
      el('pg-total').textContent = fmtUSD(t);
    }
    Array.prototype.forEach.call(document.querySelectorAll('.pg-dia'), function (c) { c.addEventListener('change', recalcular); });
    el('pg-guardar').addEventListener('click', async function () {
      var pagar = [], falta = [];
      Array.prototype.forEach.call(document.querySelectorAll('.pg-dia'), function (c) { (c.checked ? pagar : falta).push(c.value); });
      if (!pagar.length && !falta.length) { toast('No hay días seleccionados', 'error'); return; }
      try {
        var r = await API.registrarPagoSueldo({ empleado_id: emp.id, pagar: pagar, falta: falta });
        cerrarModal();
        toast('Pago registrado: ' + fmtUSD((r && r.total_usd) || 0) + (falta.length ? ' · ' + falta.length + ' día(s) no trabajado(s)' : ''), 'ok');
        irA('nomina', { sub: 'sueldos' });
      } catch (err) { toast(err.message, 'error'); }
    });
  }).catch(function (e) { toast(e.message, 'error'); });
}

function selectorEmpleadoPago(lista) {
  abrirModal(
    '<div class="modal-tope"><h3>¿A quién le pagas?</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
    lista.map(function (e) {
      return '<button class="btn btn-ancho" data-el="' + esc(e.id) + '">' + esc(e.nombre) + ' · ' + e.pend_dias + ' días · ' + fmtUSD(e.pend_usd) + '</button>';
    }).join('') + '</div>'
  );
  Array.prototype.forEach.call(document.querySelectorAll('[data-el]'), function (b) {
    b.addEventListener('click', function () {
      var e = lista.filter(function (x) { return String(x.id) === String(b.getAttribute('data-el')); })[0];
      cerrarModal();
      formularioPagoSueldo(e);
    });
  });
}

function pintarEstadoTriggers() {
  var box = el('s-trig-estado');
  if (!box) return;
  API.estadoTriggersNomina().then(function (r) {
    box.textContent = (r && r.total >= 2)
      ? '✅ Activa: se calcula sola a las 8:00 y 16:00'
      : '⚠️ Sin activar. Usa «Activar / reparar» (o se calcula al abrir la app).';
  }).catch(function () {
    box.textContent = '⚠️ Sin activar. Usa «Activar / reparar» (o se calcula al abrir la app).';
  });
}

function instalarTriggersNominaUI() {
  API.instalarTriggersNomina().then(function () {
    toast('Avisos automáticos activados (8:00 y 16:00)', 'ok');
    pintarEstadoTriggers();
  }).catch(function (e) { toast(e.message, 'error'); });
}

function etiquetaFechaCorta(f) {
  var p = String(f || '').slice(0, 10).split('-');
  if (p.length !== 3) return String(f || '');
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  var dow = d.getDay();
  return DIAS_CORTOS[dow === 0 ? 7 : dow] + ' ' + ('0' + d.getDate()).slice(-2) + '/' + p[1];
}

function diasSemanaTexto(v) {
  var a = String(v == null ? '' : v).split(',').map(function (x) { return parseInt(x, 10); })
    .filter(function (n) { return n >= 1 && n <= 7; });
  if (!a.length) return '—';
  return a.map(function (n) { return DIAS_CORTOS[n]; }).join(' · ');
}

/* ============================================================
   PANTALLA: REMODELACIONES / OBRAS
   ============================================================ */
render.remodelaciones = async function () {
  pintar('<div class="fila-entre"><h2 style="margin:0">🏗️ Remodelaciones / obras</h2>' +
    (puedoEditar() ? '<button class="btn btn-primario" id="r-nuevo">＋ Nueva</button>' : '') + '</div>' +
    '<div id="r-lista"></div>');
  if (puedoEditar()) el('r-nuevo').addEventListener('click', function () { formularioRemodelacion(null); });
  var aplicar = async function (lista) {
    if (!lista.length) { el('r-lista').innerHTML = '<div class="tarjeta muted">Aún no hay proyectos.</div>'; return; }
    var con = await Promise.all(lista.map(async function (r) {
      var gs = cacheGet('remodgastos:' + r.id, 20000);
      if (gs === undefined) { gs = await API.listarRemodGastos(r.id).catch(function () { return []; }); cacheSet('remodgastos:' + r.id, gs); }
      return { r: r, total: gs.reduce(function (a, g) { return a + num(g.monto_usd); }, 0), n: gs.length };
    }));
    el('r-lista').innerHTML = con.map(function (cg) {
      var r = cg.r;
      return '<div class="tarjeta">' +
        '<div class="fila-entre"><h2 style="margin:0">' + esc(r.nombre) + '</h2><span class="etq etq-azul">' + esc(r.estado || 'En progreso') + '</span></div>' +
        '<p class="muted" style="margin:6px 0">' + esc(r.tipo || '') + (r.descripcion ? ' · ' + esc(r.descripcion) : '') + '</p>' +
        '<div class="progreso"><div style="width:' + Math.min(100, num(r.progreso)) + '%"></div></div>' +
        '<div class="muted" style="margin-top:4px">Progreso: ' + num(r.progreso) + '% · Inversión: ' + fmtUSD(cg.total) + ' (' + cg.n + ' registros)</div>' +
        '<div class="fila-botones">' +
        '<button class="btn btn-primario" data-ver="' + esc(r.id) + '">Ver detalle</button>' +
        (puedoEditar() ? '<button class="btn" data-ed="' + esc(r.id) + '">✏️ Editar</button>' : '') +
        '</div></div>';
    }).join('');
    Array.prototype.forEach.call(el('r-lista').querySelectorAll('[data-ver]'), function (b) {
      b.addEventListener('click', function () { detalleRemodelacion(b.getAttribute('data-ver')); });
    });
    Array.prototype.forEach.call(el('r-lista').querySelectorAll('[data-ed]'), function (b) {
      b.addEventListener('click', function () {
        var r = lista.find(function (x) { return String(x.id) === String(b.getAttribute('data-ed')); });
        formularioRemodelacion(r);
      });
    });
  };
  await datosRapidos('remodelaciones', 20000, function () { return API.listarRemodelaciones(); }, aplicar);
};

async function detalleRemodelacion(id) {
  var lista = await API.listarRemodelaciones();
  var r = lista.find(function (x) { return String(x.id) === String(id); });
  if (!r) return;
  var gs = cacheGet('remodgastos:' + id, 20000);
  if (gs === undefined) { gs = await API.listarRemodGastos(id).catch(function () { return []; }); cacheSet('remodgastos:' + id, gs); }
  var total = gs.reduce(function (a, g) { return a + num(g.monto_usd); }, 0);
  var admin = puedoEditar();
  abrirModal(
    '<div class="modal-tope"><h3>' + esc(r.nombre) + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<p class="muted">' + esc(r.tipo || '') + ' · Inicio: ' + fechaCorta(r.fecha_inicio) + (r.fecha_fin_estimada ? ' · Fin est.: ' + fechaCorta(r.fecha_fin_estimada) : '') + '</p>' +
    '<div class="progreso"><div style="width:' + Math.min(100, num(r.progreso)) + '%"></div></div>' +
    '<p class="muted">Progreso <b>' + num(r.progreso) + '%</b> · Inversión: <b>' + fmtUSD(total) + '</b></p>' +
    '<h3 style="font-size:15px">💸 Gastos de la obra</h3>' +
    (gs.length ? '<div class="tarjeta" style="margin-bottom:8px"><div class="detalle-venta">' + gs.map(function (g) {
      return '<div class="d-lin"><span>' + fechaCorta(g.fecha) + ' · <span class="etq">' + tipoGasto(g.tipo) + '</span> ' + esc(g.concepto) + '</span>' +
        '<span class="negrita">' + fmtUSD(g.monto_usd) + '</span></div>';
    }).join('') + '</div></div>' : '<p class="muted">Sin gastos registrados.</p>') +
    (admin ? '<div id="rg-form">' +
      '<label class="campo">Nuevo gasto de obra</label>' +
      '<input id="rg-conc" placeholder="Concepto (ej. bolsas de cemento)">' +
      '<div class="form-2col">' +
      '<div><select id="rg-tipo">' + TIPOS_OBRA.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select></div>' +
      '<div><input id="rg-monto" type="number" step="0.01" min="0.01" placeholder="Monto $"></div>' +
      '</div>' +
      '<div class="fila-botones"><button class="btn btn-ok btn-ancho" id="rg-guardar">＋ Agregar</button></div>' +
      '</div>' : '')
  );
  if (admin) {
    el('rg-guardar').addEventListener('click', async function () {
      var g = { remod_id: id, concepto: el('rg-conc').value, tipo: el('rg-tipo').value, monto_usd: num(el('rg-monto').value) };
      try { await API.guardarRemodGasto(g); cerrarModal(); toast('Gasto agregado a la obra', 'ok'); await render.remodelaciones(); }
      catch (e) { toast(e.message, 'error'); }
    });
  }
}

function formularioRemodelacion(r) {
  var ed = !!(r && r.id);
  var v = r || {};
  abrirModal(
    '<div class="modal-tope"><h3>' + (ed ? 'Editar proyecto' : 'Nueva remodelación') + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<label class="campo">Nombre</label><input id="re-nom" value="' + esc(v.nombre || '') + '">' +
    '<div class="form-2col">' +
    '<div><label class="campo">Tipo</label><input id="re-tipo" value="' + esc(v.tipo || 'Remodelación') + '"></div>' +
    '<div><label class="campo">Estado</label><select id="re-estado">' +
    ['En progreso', 'Pausado', 'Terminado', 'Cancelado'].map(function (s) { return '<option' + (String(v.estado) === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
    '</select></div>' +
    '</div>' +
    '<label class="campo">Descripción</label><textarea id="re-desc" rows="2">' + esc(v.descripcion || '') + '</textarea>' +
    '<div class="form-2col">' +
    '<div><label class="campo">Inicio</label><input type="date" id="re-ini" value="' + (v.fecha_inicio || hoyLocal()) + '"></div>' +
    '<div><label class="campo">Fin estimado</label><input type="date" id="re-fin" value="' + (v.fecha_fin_estimada || '') + '"></div>' +
    '</div>' +
    '<label class="campo">Progreso: <span id="re-prog-txt">' + num(v.progreso) + '%</span></label>' +
    '<input type="range" id="re-prog" min="0" max="100" step="5" value="' + num(v.progreso) + '">' +
    '<div class="modal-acciones"><button class="btn btn-suave" onclick="cerrarModal()">Cancelar</button>' +
    '<button class="btn btn-primario" id="re-guardar">Guardar</button></div>'
  );
  el('re-prog').addEventListener('input', function () { el('re-prog-txt').textContent = el('re-prog').value + '%'; });
  el('re-guardar').addEventListener('click', async function () {
    var datos = {
      id: v.id, nombre: el('re-nom').value, tipo: el('re-tipo').value, estado: el('re-estado').value,
      descripcion: el('re-desc').value, fecha_inicio: el('re-ini').value,
      fecha_fin_estimada: el('re-fin').value, progreso: num(el('re-prog').value)
    };
    try { await API.guardarRemodelacion(datos); cerrarModal(); toast('Proyecto guardado', 'ok'); irA('remodelaciones'); }
    catch (e) { toast(e.message, 'error'); }
  });
}

/* ============================================================
   PANTALLA: ADMINISTRACIÓN
   ============================================================ */
render.admin = async function () {
  await cargarTasaSiYace();
  var puedeEdit = puede('admin', 'editar');
  var perfiles = [];
  try { perfiles = await API.listarPerfiles(); } catch (e) { perfiles = []; }
  if (!Array.isArray(perfiles)) perfiles = [];
  pintar(
    '<div class="tarjeta"><h2>⚙️ Administración</h2><p class="muted">Usuarios, perfiles, tasas y tu contraseña.</p></div>' +
    '<div class="tarjeta"><h2>👤 Usuarios</h2>' +
    (puedeEdit ? '<div class="fila-botones" style="margin-bottom:10px"><button class="btn btn-primario" id="ad-usu-nuevo">＋ Nuevo usuario</button></div>' : '') +
    '<div id="ad-usu-lista"></div></div>' +
    (puedeEdit ? '<div class="tarjeta"><h2>🧩 Perfiles y permisos</h2>' +
      '<p class="muted">Define qué puede <b>ver</b> y <b>editar</b> cada tipo de empleado y luego asígnalo a cada usuario.</p>' +
      '<div class="fila-botones" style="margin-bottom:10px"><button class="btn btn-primario" id="ad-per-nuevo">＋ Nuevo perfil</button></div>' +
      '<div id="ad-per-lista"></div></div>' : '') +
    '<div class="tarjeta"><h2>💱 Tasa de cambio</h2><div id="ad-tasa"></div></div>' +
    '<div class="tarjeta"><h2>🔑 Mi contraseña</h2>' +
    '<input id="ad-pwd-v" type="password" placeholder="Contraseña actual">' +
    '<input id="ad-pwd-n1" type="password" placeholder="Nueva contraseña" style="margin-top:8px">' +
    '<input id="ad-pwd-n2" type="password" placeholder="Repetir nueva contraseña" style="margin-top:8px">' +
    '<div class="fila-botones" style="margin-top:10px"><button class="btn btn-primario btn-ancho" id="ad-pwd-go">Cambiar contraseña</button></div>' +
    '</div>'
  );
  if (puedeEdit) el('ad-usu-nuevo').addEventListener('click', function () { formularioUsuario(perfiles); });

  var aplicarUsu = function (usrs) {
    el('ad-usu-lista').innerHTML = '<div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
      '<th>Usuario</th><th>Nombre</th><th>Rol</th><th>Perfil</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' +
      usrs.map(function (u, i) {
        var esAdm = u.rol === 'admin';
        var perfilCel = esAdm ? '<span class="muted">— (todo)</span>' :
          '<select data-perf="' + i + '"' + (puedeEdit ? '' : ' disabled') + '>' +
            perfiles.filter(function (p) { return !p.sistema; }).map(function (p) {
              return '<option value="' + esc(p.perfil) + '"' + (String(u.perfil) === p.perfil ? ' selected' : '') + '>' + esc(p.nombre) + '</option>';
            }).join('') +
          '</select>';
        return '<tr><td class="mono">' + esc(u.usuario) + '</td>' +
          '<td>' + esc(u.nombre) + '</td>' +
          '<td>' + (puedeEdit ? '<select data-rol="' + i + '">' +
            '<option value="empleado"' + (u.rol === 'empleado' ? ' selected' : '') + '>Empleado</option>' +
            '<option value="admin"' + (u.rol === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '</select>' : (esAdm ? 'Admin' : 'Empleado')) + '</td>' +
          '<td>' + perfilCel + '</td>' +
          '<td>' + (String(u.activo) === '1' ? '<span class="etq etq-ok">Activo</span>' : '<span class="etq etq-peligro">Desact.</span>') + '</td>' +
          '<td>' + (puedeEdit ? '<button class="btn btn-suave" style="padding:5px 9px" data-pwd="' + i + '">Clave</button> ' +
            '<button class="btn ' + (String(u.activo) === '1' ? 'btn-peligro' : 'btn-ok') + '" style="padding:5px 9px" data-tog="' + i + '">' + (String(u.activo) === '1' ? 'Desactivar' : 'Activar') + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    if (!puedeEdit) return;
    Array.prototype.forEach.call(el('ad-usu-lista').querySelectorAll('[data-rol]'), function (sel) {
      sel.addEventListener('change', async function () {
        var u = usrs[num(sel.getAttribute('data-rol'))];
        try { await API.cambiarRolUsuario(u.usuario, sel.value); toast('Rol actualizado', 'ok'); irA('admin'); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
    Array.prototype.forEach.call(el('ad-usu-lista').querySelectorAll('[data-perf]'), function (sel) {
      sel.addEventListener('change', async function () {
        var u = usrs[num(sel.getAttribute('data-perf'))];
        try { await API.cambiarPerfilUsuario(u.usuario, sel.value); toast('Perfil asignado', 'ok'); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
    Array.prototype.forEach.call(el('ad-usu-lista').querySelectorAll('[data-pwd]'), function (b) {
      b.addEventListener('click', function () {
        resetearClaveUsuario(usrs[num(b.getAttribute('data-pwd'))]);
      });
    });
    Array.prototype.forEach.call(el('ad-usu-lista').querySelectorAll('[data-tog]'), function (b) {
      b.addEventListener('click', async function () {
        var u = usrs[num(b.getAttribute('data-tog'))];
        var activo = String(u.activo) !== '1';
        try { await API.cambiarEstadoUsuario(u.usuario, activo); toast(u.usuario + (activo ? ' activado' : ' desactivado'), 'ok'); irA('admin'); }
        catch (e) { toast(e.message, 'error'); }
      });
    });
  };
  await datosRapidos('usuarios', 30000, function () { return API.listarUsuarios(); }, aplicarUsu);

  if (puedeEdit) {
    var pintarPerfiles = function (lista) {
      el('ad-per-lista').innerHTML = '<div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
        '<th>Perfil</th><th>Permisos</th><th>Acciones</th></tr></thead><tbody>' +
        lista.map(function (p, i) {
          return '<tr><td><strong>' + esc(p.nombre) + '</strong>' + (p.sistema ? ' <span class="etq etq-azul">sistema</span>' : '') + '</td>' +
            '<td class="muted" style="font-size:12px">' + esc(resumenPermisos(p.permisos)) + '</td>' +
            '<td>' + (p.sistema
              ? '<span class="muted" style="font-size:12px">No editable</span>'
              : '<button class="btn btn-suave" style="padding:5px 9px" data-pedit="' + i + '">Editar</button> ' +
                '<button class="btn btn-peligro" style="padding:5px 9px" data-pdel="' + i + '">Eliminar</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      Array.prototype.forEach.call(el('ad-per-lista').querySelectorAll('[data-pedit]'), function (b) {
        b.addEventListener('click', function () { formularioPerfil(lista[num(b.getAttribute('data-pedit'))]); });
      });
      Array.prototype.forEach.call(el('ad-per-lista').querySelectorAll('[data-pdel]'), function (b) {
        b.addEventListener('click', async function () {
          var p = lista[num(b.getAttribute('data-pdel'))];
          if (!confirm('¿Eliminar el perfil "' + p.nombre + '"?')) return;
          try { await API.eliminarPerfil(p.perfil); toast('Perfil eliminado', 'ok'); irA('admin'); }
          catch (e) { toast(e.message, 'error'); }
        });
      });
    };
    el('ad-per-nuevo').addEventListener('click', function () { formularioPerfil(null); });
    pintarPerfiles(perfiles);
  }

  pintarTasaAdmin().catch(function () {});

  el('ad-pwd-go').addEventListener('click', async function () {
    var v = el('ad-pwd-v').value, n1 = el('ad-pwd-n1').value, n2 = el('ad-pwd-n2').value;
    if (!v || !n1) { toast('Completa los campos', 'error'); return; }
    if (n1 !== n2) { toast('La nueva contraseña no coincide', 'error'); return; }
    try {
      await API.cambiarPassword(v, n1);
      toast('Contraseña actualizada', 'ok');
      el('ad-pwd-v').value = ''; el('ad-pwd-n1').value = ''; el('ad-pwd-n2').value = '';
    } catch (e) { toast(e.message, 'error'); }
  });
};

async function pintarTasaAdmin() {
  var cont = el('ad-tasa');
  if (!cont) return;
  var t = null;
  try { t = await API.getTasaVigente(); } catch (e) { t = null; }
  if (!t || typeof t !== 'object') t = { tasa: 0, fecha: '', fuente: '', manual: false, historico: [] };
  S.tasa = num(t.tasa); S.fechaTasa = t.fecha || ''; S.fuenteTasa = t.fuente || ''; S.tasaManual = !!t.manual;
  actualizarChipTasa();
  var fuenteTxt = t.manual ? 'fijada por ti' : (t.fuente === 'bcv_sitio' ? 'BCV oficial' : (t.fuente === 'bcv_api' ? 'BCV (dolarapi)' : (t.fuente || '—')));
  var hist = (t.historico || []).slice(0, 10);
  cont.innerHTML = '<div class="fila-entre"><div><div class="k-num k-azul">Bs ' + fmtNum(t.tasa) + ' / $</div>' +
    '<div class="muted">Fecha: ' + esc(t.fecha) + ' · Fuente: ' + esc(fuenteTxt) + '</div></div>' +
    '<span class="etq ' + (t.manual ? 'etq-azul' : 'etq-ok') + '">' + (t.manual ? '✋ Manual' : '✅ Automática') + '</span></div>' +
    (t.manual ? '<div class="aviso aviso-ok" style="margin-top:10px">Tasa manual activa: las ventas usan <b>Bs ' + fmtNum(t.tasa) + ' / $</b>. Se quita <b>sola</b> al llegar el próximo día hábil (lunes a viernes); también puedes quitarla aquí o actualizando desde el BCV.</div>' : '') +
    '<div class="fila-botones" style="margin-top:10px">' +
    '<button class="btn btn-primario" id="ad-tasa-act">↻ Actualizar desde BCV</button>' +
    (t.manual
      ? '<button class="btn btn-peligro" id="ad-tasa-quita">✖ Quitar manual</button>'
      : '<button class="btn" id="ad-tasa-man">✏️ Fijar manual</button>') +
    '</div>' +
    '<p class="muted" style="margin-top:8px">El BCV publica los <b>viernes después de las 5:00 p. m.</b> la tasa del lunes siguiente. La app la busca sola el viernes en la noche, el sábado y el domingo para que vendas con esa tasa.</p>' +
    '<div id="ad-tasa-hist"></div>';
  el('ad-tasa-act').addEventListener('click', async function () {
    try { await API.actualizarTasa(); toast('Tasa actualizada desde el BCV', 'ok'); pintarTasaAdmin(); }
    catch (e) { toast(e.message, 'error'); }
  });
  if (t.manual) {
    el('ad-tasa-quita').addEventListener('click', async function () {
      try { await API.quitarTasaManual(); toast('Tasa manual quitada: usa el BCV automático', 'ok'); pintarTasaAdmin(); }
      catch (e) { toast(e.message, 'error'); }
    });
  } else {
    el('ad-tasa-man').addEventListener('click', formularioTasaManual);
  }
  if (hist.length) {
    el('ad-tasa-hist').innerHTML = '<h3 style="font-size:14px">Historial reciente</h3><div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
      '<th>Fecha</th><th class="der">Tasa</th><th>Fuente</th></tr></thead><tbody>' +
      hist.map(function (h) { return '<tr><td>' + esc(h.fecha) + '</td><td class="der">Bs ' + fmtNum(h.tasa) + '</td><td>' + esc(h.fuente) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }
}

function formularioTasaManual() {
  abrirModal(
    '<div class="modal-tope"><h3>✏️ Fijar tasa manual</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<p class="muted">Fija la tasa que la app usará para vender. Son esos casos donde el control lo llevas tú: por ejemplo, el viernes en la noche para vender todo el fin de semana con la tasa que el BCV publicó para el lunes.</p>' +
    '<label class="campo">Tasa (Bs por $)</label><input id="tm-tasa" type="number" step="0.0001" min="1" value="' + (S.tasa ? S.tasa : '') + '">' +
    '<div class="modal-acciones"><button class="btn btn-suave" onclick="cerrarModal()">Cancelar</button>' +
    '<button class="btn btn-primario" id="tm-guardar">Guardar</button></div>'
  );
  el('tm-guardar').addEventListener('click', async function () {
    try {
      var v = num(el('tm-tasa').value);
      var r = await API.setTasaManual(v);
      cerrarModal();
      if (r && typeof r === 'object') { S.tasa = num(r.tasa); S.tasaManual = true; S.fuenteTasa = 'manual'; actualizarChipTasa(); }
      toast('Tasa manual activada: Bs ' + fmtNum(v) + ' / $', 'ok');
      pintarTasaAdmin();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function formularioUsuario(perfiles) {
  perfiles = (perfiles || []).filter(function (p) { return !p.sistema; });
  abrirModal(
    '<div class="modal-tope"><h3>Nuevo usuario</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<label class="campo">Usuario (para entrar)</label><input id="us-nom" placeholder="ej: caja1">' +
    '<label class="campo">Nombre visible</label><input id="us-nombre" placeholder="ej: María Pérez">' +
    '<label class="campo">Rol</label><select id="us-rol"><option value="empleado">Empleado</option><option value="admin">Administrador</option></select>' +
    '<div id="us-perf-caja"><label class="campo">Perfil (permisos)</label><select id="us-perf">' +
      (perfiles.length ? perfiles.map(function (p) { return '<option value="' + esc(p.perfil) + '">' + esc(p.nombre) + '</option>'; }).join('') : '<option value="vendedor">Vendedor</option>') +
    '</select></div>' +
    '<label class="campo">Contraseña inicial</label><input id="us-pwd" type="text" placeholder="Asigna una clave">' +
    '<div class="modal-acciones"><button class="btn btn-suave" onclick="cerrarModal()">Cancelar</button>' +
    '<button class="btn btn-primario" id="us-guardar">Crear</button></div>'
  );
  var syncPerfil = function () {
    var caja = el('us-perf-caja');
    if (caja) caja.style.display = el('us-rol').value === 'admin' ? 'none' : '';
  };
  el('us-rol').addEventListener('change', syncPerfil);
  syncPerfil();
  el('us-guardar').addEventListener('click', async function () {
    var d = { usuario: el('us-nom').value.trim(), nombre: el('us-nombre').value.trim(), rol: el('us-rol').value, password: el('us-pwd').value };
    if (d.rol !== 'admin' && el('us-perf')) d.perfil = el('us-perf').value;
    if (!d.usuario || !d.password) { toast('Usuario y contraseña son obligatorios', 'error'); return; }
    try { await API.crearUsuario(d); cerrarModal(); toast('Usuario creado', 'ok'); irA('admin'); }
    catch (e) { toast(e.message, 'error'); }
  });
}

// Resumen legible de los permisos de un perfil (para la tabla).
function resumenPermisos(perm) {
  var partes = [];
  MODULOS_PERFIL.forEach(function (m) {
    var v = perm && perm[m[0]];
    if (v === 'ver' || v === 'editar') partes.push(m[1] + (v === 'editar' ? ' ✏️' : ' 👁'));
  });
  return partes.length ? partes.join(' · ') : 'Sin acceso';
}

// Modal para crear/editar un perfil con su matriz de permisos.
function formularioPerfil(p) {
  var esNuevo = !p;
  var perm = (p && p.permisos) || {};
  var filas = MODULOS_PERFIL.map(function (m) {
    var v = perm[m[0]] || 'none';
    return '<tr><td>' + esc(m[1]) + '</td><td><select data-mod="' + m[0] + '">' +
      NIVELES_PERFIL.map(function (n) {
        return '<option value="' + n[0] + '"' + (v === n[0] ? ' selected' : '') + '>' + n[1] + '</option>';
      }).join('') + '</select></td></tr>';
  }).join('');
  abrirModal(
    '<div class="modal-tope"><h3>' + (esNuevo ? 'Nuevo perfil' : 'Editar perfil') + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<label class="campo">Nombre del perfil</label><input id="pf-nombre" placeholder="ej: Almacén" value="' + esc(p ? p.nombre : '') + '">' +
    '<p class="muted" style="margin:12px 0 4px">Permisos por módulo</p>' +
    '<div class="tabla-envoltura"><table class="tabla"><thead><tr><th>Módulo</th><th>Acceso</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
    '<div class="modal-acciones"><button class="btn btn-suave" onclick="cerrarModal()">Cancelar</button>' +
    '<button class="btn btn-primario" id="pf-guardar">Guardar</button></div>'
  );
  el('pf-guardar').addEventListener('click', async function () {
    var permisos = {};
    Array.prototype.forEach.call(document.querySelectorAll('#modal [data-mod]'), function (sel) {
      permisos[sel.getAttribute('data-mod')] = sel.value;
    });
    var datos = { nombre: el('pf-nombre').value.trim(), permisos: permisos };
    if (p && p.perfil) datos.perfil = p.perfil;
    if (!datos.nombre) { toast('Indica el nombre del perfil', 'error'); return; }
    try { await API.guardarPerfil(datos); cerrarModal(); toast('Perfil guardado', 'ok'); irA('admin'); }
    catch (e) { toast(e.message, 'error'); }
  });
}

function resetearClaveUsuario(u) {
  abrirModal(
    '<div class="modal-tope"><h3>Nueva contraseña — ' + esc(u.nombre || u.usuario) + '</h3><button class="btn-icono" onclick="cerrarModal()">✕</button></div>' +
    '<label class="campo">Nueva contraseña</label><input id="ru-pwd" type="text">' +
    '<div class="modal-acciones"><button class="btn btn-suave" onclick="cerrarModal()">Cancelar</button>' +
    '<button class="btn btn-primario" id="ru-guardar">Guardar</button></div>'
  );
  el('ru-guardar').addEventListener('click', async function () {
    try { await API.resetearPassword(u.usuario, el('ru-pwd').value); cerrarModal(); toast('Contraseña cambiada', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  });
}

/* ---------- Arranque ---------- */
el('btn-menu').addEventListener('click', abrirGaveta);
el('btn-login').addEventListener('click', intentarLogin);
el('in-usr').addEventListener('keydown', function (e) { if (e.key === 'Enter') intentarLogin(); });
el('in-pwd').addEventListener('keydown', function (e) { if (e.key === 'Enter') intentarLogin(); });
el('btn-salir').addEventListener('click', async function () {
  if (await confirmar('¿Cerrar sesión?')) cerrarSesionLocal();
});
iniciarApp();