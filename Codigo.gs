/**************************************************************
 *  FRUGULLETTY — Tienda online de calzado deportivo femenino
 *  Sistema de e-commerce con carrito, tallas, envíos por zona,
 *  pagos PagoMóvil y efectivo, inventario y panel admin.
 *  Base de datos: Google Sheets en tu Drive.
 *
 *  INSTALACIÓN:
 *  1) Crea una hoja de cálculo en Google Drive.
 *  2) Extensiones -> Apps Script.
 * 3) Pega este archivo en "Código.gs" y crea el archivo
 *     Index.html con el contenido de la carpeta.
 *  4) Configuración del proyecto -> Zona horaria: America/Caracas.
 *  5) Ejecuta en el editor:  inicializar()   (un solo clic, sin argumentos)
 *  6) Implementar -> Nueva implementación -> Aplicación web:
 *       - Ejecutar como: Yo
 *       - Acceso: Cualquier persona
 **************************************************************/

const CARACAS = 'America/Caracas';
const TASA_API = 'https://ve.dolarapi.com/v1/dolares/oficial';
const SESION_HORAS = 12;

/* ================= SERVIDOR WEB ================= */

function include(dato) {
  if (!dato) {
    throw new Error('Ejecutaste la funcion "include" por error: en el desplegable de arriba elige "inicializar" y pulsa Ejecutar.');
  }
  return HtmlService.createHtmlOutputFromFile(dato).getContent();
}

function doGet(e) {
  e = e || {};
  const q = (e.parameter || {});
  // === DESPACHADOR JSON ===
  if (q.accion) {
    try {
      const fn = globalThis[q.accion];
      if (typeof fn !== 'function') return jsonOut({ ok: false, error: 'Acción no encontrada: ' + q.accion });
      let args = [];
      if (q.args) {
        try { args = JSON.parse(q.args); } catch (err) { return jsonOut({ ok: false, error: 'Argumentos inválidos' }); }
        if (!Array.isArray(args)) args = [args];
      }
      return jsonOut({ ok: true, r: fn.apply(null, args) });
    } catch (err) {
      return jsonOut({ ok: false, error: String((err && err.message) || err) });
    }
  }
  return HtmlService.createHtmlOutputFromFile('Index.html')
    .setTitle('Frugulletty - Calzado Deportivo Femenino')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Clave interna de diagnóstico (se retirará en una versión futura).
const CLAVE_DIAG = 'm1neg0c1o2026-v31';
const jsonOut = function (o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
};
// Envía datos al cliente como texto JSON: es el transporte más estable en
// teléfonos/buscadores (los arreglos sueltos no siempre llegan bien).
const empaquetar = function (o) { return JSON.stringify(o); };

/* ================= ACCESO A LA HOJA ================= */

const SHEET_ID_FRUGULLETTY = '1pt21FErAWT1saULwjbOQihlBv7aC-UUiWrrzkeuqoyM';

function getSS() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID') || SHEET_ID_FRUGULLETTY;
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) {}
  }
  const activa = SpreadsheetApp.getActiveSpreadsheet();
  if (activa) return activa;
  throw new Error('No hay hoja configurada. Ejecuta inicializar() en el editor de Apps Script.');
}

function getTab(nombre) {
  const ss = getSS();
  let sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);
  return sh;
}

function asegurarTab(nombre, headers) {
  const sh = getTab(nombre);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  return sh;
}

const ESQ_PRODUCTOS = ['codigo', 'nombre', 'categoria', 'precio_usd', 'costo_usd', 'stock', 'stock_min', 'imagen', 'tallas', 'stock_tallas', 'descripcion', 'activo', 'creado'];
const ESQ_VENTAS = ['id', 'fecha', 'vendedor', 'empleado_nombre', 'cliente_nombre', 'cliente_documento', 'cliente_telefono', 'cliente_direccion', 'cliente_estado', 'items', 'metodo', 'tipo_entrega', 'zona', 'envio_usd', 'envio_ves', 'subtotal_usd', 'total_usd', 'tasa', 'total_ves', 'nota', 'estado_pedido'];
// Empleados: "sueldo_diario" = pago por día trabajado; "dias_semana" = días que
// trabaja, como números 1..7 (1=Lunes … 7=Domingo) separados por coma.
const ESQ_EMPLEADOS = ['id', 'nombre', 'cargo', 'salario_usd', 'sueldo_diario', 'dias_semana', 'fecha_ingreso', 'activo'];
// Sueldos = LIBRO DE NÓMINA: cada fila es UN DÍA de un empleado.
//   "fecha_dia"  = el día trabajado (yyyy-MM-dd)
//   "estado"     = pendiente | pagado | falta (no trabajó: no se cobra)
//   "fecha_pago" = el día en que se pagó (para los egresos del mes)
const ESQ_SUELDOS = ['id', 'empleado_id', 'empleado_nombre', 'periodo', 'fecha_dia', 'fecha_pago', 'monto_usd', 'estado', 'nota'];

// Repara/crea los encabezados de la hoja: la fila 1 debe tener las columnas que
// espera la app. Si la hoja está vacía o la fila 1 no coincide, la escribe; si
// solo faltan columnas, las agrega al final sin tocar los datos existentes.
// Así, aunque la hoja tenga formato viejo, las nuevas escrituras sí se leen bien.
function asegurarEsquema(nombre, esperados) {
  const sh = getTab(nombre);
  const vals = sh.getDataRange().getValues();
  const headers = vals.length ? vals[0].map(function (c) { return String(c).trim(); }) : [];
  const coincideAlguno = headers.some(function (h) { return esperados.indexOf(h) >= 0; });
  if (!headers.length || !coincideAlguno) {
    sh.getRange(1, 1, 1, esperados.length).setValues([esperados]);
    if (headers.length > esperados.length) {
      sh.getRange(1, esperados.length + 1, 1, headers.length - esperados.length).clearContent();
    }
    return;
  }
  const faltan = esperados.filter(function (h) { return headers.indexOf(h) < 0; });
  if (faltan.length) sh.getRange(1, headers.length + 1, 1, faltan.length).setValues([faltan]);
}

// Permite que la app verifique QUÉ versión del servidor está respondiendo.
// Si la página y el servidor no coinciden, la app avisa al usuario claramente.
function infoServidor() {
  return { version: 'v1-frugulletty', esquema: ESQ_PRODUCTOS.join(','), ok: true };
}

function leerFilas(nombre) {
  const sh = getTab(nombre);
  const vals = sh.getDataRange().getValues();
  if (!vals.length) return [];
  const headers = vals[0].map(String);
  const filas = [];
  for (let i = 1; i < vals.length; i++) {
    const o = {};
    headers.forEach(function (h, j) { o[h] = vals[i][j]; });
    filas.push(o);
  }
  return filas;
}

function escribirFila(nombre, obj) {
  const sh = getTab(nombre);
  const vals = sh.getDataRange().getValues();
  const headers = vals.length ? vals[0].map(String) : [];
  if (!headers.length) {
    const hs = Object.keys(obj);
    sh.appendRow(hs);
    headers = hs;
  }
  const fila = headers.map(function (h) {
    return obj[h] !== undefined ? obj[h] : '';
  });
  sh.appendRow(fila);
}

// Escribe MUCHAS filas de una sola vez (la corrida de nómina puede crear decenas
// de días). Mucho más rápido que llamar a escribirFila en un bucle.
function escribirFilas(nombre, arr) {
  if (!arr || !arr.length) return;
  const sh = getTab(nombre);
  const vals = sh.getDataRange().getValues();
  let headers = vals.length ? vals[0].map(String) : [];
  if (!headers.length) {
    headers = Object.keys(arr[0]);
    sh.appendRow(headers);
  }
  const filas = arr.map(function (obj) {
    return headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  });
  const ini = Math.max(1, sh.getLastRow()) + 1;
  sh.getRange(ini, 1, filas.length, headers.length).setValues(filas);
}

function actualizarFila(nombre, claveCol, claveVal, cambios, crearSiNoExiste) {
  const sh = getTab(nombre);
  const vals = sh.getDataRange().getValues();
  const headers = vals.length ? vals[0].map(String) : [];
  if (!headers.length) {
    headers = Object.keys(Object.assign({}, cambios, {}));
    sh.appendRow(headers);
  }
  const ci = headers.indexOf(claveCol);
  if (ci < 0) throw new Error('Columna ' + claveCol + ' no existe en ' + nombre);
  let rowToEdit = -1;
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][ci]) === String(claveVal)) { rowToEdit = i + 1; break; }
  }
  if (rowToEdit === -1 && crearSiNoExiste) {
    const fila = headers.map(function (h) {
      if (h === claveCol) return claveVal;
      if (h in cambios) return cambios[h];
      return '';
    });
    sh.appendRow(fila);
    return;
  }
  if (rowToEdit === -1) throw new Error('No se encontró el registro ' + claveCol + '=' + claveVal);
  const range = sh.getRange(rowToEdit, 1, 1, headers.length);
  const row = range.getValues()[0];
  Object.keys(cambios).forEach(function (k) {
    const idx = headers.indexOf(k);
    if (idx >= 0) row[idx] = cambios[k];
  });
  range.setValues([row]);
}

function borrarFilaPorId(nombre, claveCol, val) {
  const sh = getTab(nombre);
  const vals = sh.getDataRange().getValues();
  if (!vals.length) throw new Error('No hay registros en ' + nombre);
  const headers = vals[0].map(String);
  const ci = headers.indexOf(claveCol);
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][ci]) === String(val)) { sh.deleteRow(i + 1); return; }
  }
  throw new Error('No se encontró el registro ' + val);
}

/* ================= UTILIDADES ================= */

function hoy() {
  return Utilities.formatDate(new Date(), CARACAS, 'yyyy-MM-dd');
}
function ahora() {
  return Utilities.formatDate(new Date(), CARACAS, "yyyy-MM-dd'T'HH:mm:ss");
}
// Normaliza el valor de una celda "fecha" de Sheets a texto (yyyy-MM-ddTHH:mm:ss).
// Si la celda es tipo fecha, la formatea a texto con zona Caracas; si ya es texto, lo deja igual.
function fechaTxt(f) {
  if (f instanceof Date) return Utilities.formatDate(f, CARACAS, "yyyy-MM-dd'T'HH:mm:ss");
  return String(f || '');
}
function fechaPub(f) {
  return fechaTxt(f).slice(0, 10);
}
// Ayudas de fecha basadas en UTC: evitan que la zona horaria corra el día.
function _fechaUTC(s) {
  const p = String(s == null ? '' : s).slice(0, 10).split('-');
  return new Date(Date.UTC(parseInt(p[0], 10), (parseInt(p[1], 10) || 1) - 1, parseInt(p[2], 10) || 1));
}
// 1=Lunes … 7=Domingo para una fecha "yyyy-MM-dd".
function diaSemanaIso(s) {
  const w = _fechaUTC(s).getUTCDay();
  return w === 0 ? 7 : w;
}
// Suma (o resta) días a una fecha "yyyy-MM-dd" y devuelve "yyyy-MM-dd".
function sumarDiasFecha(s, n) {
  const d = _fechaUTC(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function getConfig() {
  const cfg = {};
  leerFilas('Config').forEach(function (f) {
    if (f.clave) cfg[f.clave] = f.valor;
  });
  return cfg;
}

function getZonasDelivery() {
  const cfg = getConfig();
  try {
    return JSON.parse(cfg.zonas_delivery || '[]');
  } catch (e) {
    return [
      { nombre: 'Caracas', precio_usd: 0, aplica_delivery: true },
      { nombre: 'Interior', precio_usd: 5, aplica_delivery: false }
    ];
  }
}

function guardarZonasDelivery(token, zonas) {
  requirePermiso(token, 'admin', 'editar');
  setConfig('zonas_delivery', JSON.stringify(zonas || []), 'Zonas de entrega y precios');
  return getZonasDelivery();
}

function getPrecioEnvio() {
  const cfg = getConfig();
  try {
    return parseFloat(cfg.precio_envio_nacional) || 5;
  } catch (e) {
    return 5;
  }
}

function setPrecioEnvioNacional(token, precio) {
  requirePermiso(token, 'admin', 'editar');
  const p = parseFloat(precio) || 0;
  setConfig('precio_envio_nacional', p, 'Precio de envío nacional por defecto');
  return p;
}

function setConfig(clave, valor, desc) {
  const exist = leerFilas('Config').some(function (f) { return f.clave === clave; });
  if (exist) actualizarFila('Config', 'clave', clave, { valor: valor, descripcion: desc || '' });
  else escribirFila('Config', { clave: clave, valor: valor, descripcion: desc || '' });
}

/* ================= SEGURIDAD / SESIONES ================= */

function hashPassword(pwd, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pwd) + '::' + salt);
  return raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function crearSesion(usuario) {
  const props = PropertiesService.getScriptProperties();
  const token = Utilities.getUuid();
  const sesiones = JSON.parse(props.getProperty('SESIONES') || '{}');
  sesiones[token] = { usuario: usuario, expira: Date.now() + SESION_HORAS * 3600 * 1000 };
  props.setProperty('SESIONES', JSON.stringify(sesiones));
  return token;
}

function cerrarSesion(token) {
  if (!token) return;
  const props = PropertiesService.getScriptProperties();
  const sesiones = JSON.parse(props.getProperty('SESIONES') || '{}');
  delete sesiones[token];
  props.setProperty('SESIONES', JSON.stringify(sesiones));
}

function buscarUsuario(usuario) {
  const f = String(usuario || '').toLowerCase();
  return leerFilas('Usuarios').find(function (u) {
    return String(u.usuario || '').toLowerCase() === f;
  }) || null;
}

function sesionValida(token) {
  if (!token) return null;
  const props = PropertiesService.getScriptProperties();
  const sesiones = JSON.parse(props.getProperty('SESIONES') || '{}');
  const s = sesiones[token];
  if (!s) return null;
  if (s.expira < Date.now()) {
    delete sesiones[token];
    props.setProperty('SESIONES', JSON.stringify(sesiones));
    return null;
  }
  return s;
}

function requireAuth(token) {
  const s = sesionValida(token);
  if (!s) throw new Error('Sesión vencida o inválida. Vuelve a iniciar sesión.');
  const user = buscarUsuario(s.usuario);
  if (!user || String(user.activo) !== '1') throw new Error('Usuario no existe o está desactivado.');
  return { usuario: user.usuario, rol: user.rol, nombre: user.nombre, perfil: user.perfil };
}

/* ================= PERFILES Y PERMISOS =================
   El rol "admin" es superusuario (siempre puede todo). Los usuarios con rol
   "empleado" usan el PERFIL que se les asigne; cada perfil guarda, por módulo,
   un nivel: none (oculto) · ver (solo lectura) · editar (crear/editar/borrar).
   Los módulos coinciden con los id de las páginas de la app. */
const MODULOS_PERM = [
  ['inicio', 'Inicio'],
  ['vender', 'Vender'],
  ['productos', 'Inventario'],
  ['ventas', 'Ventas'],
  ['reportes', 'Reportes'],
  ['gastos', 'Gastos'],
  ['nomina', 'Nómina'],
  ['remodelaciones', 'Obras'],
  ['admin', 'Ajustes']
];
const NIVEL_PERM = { none: 0, ver: 1, editar: 2 };
const ESQ_PERFILES = ['perfil', 'nombre', 'permisos', 'activo', 'creado'];

function permisosTodo() {
  const o = {};
  MODULOS_PERM.forEach(function (m) { o[m[0]] = 'editar'; });
  return o;
}
function normalizarPermisos(p) {
  const o = {};
  MODULOS_PERM.forEach(function (m) {
    const v = p && p[m[0]];
    o[m[0]] = (v === 'ver' || v === 'editar') ? v : 'none';
  });
  return o;
}
function perfilesPredeterminados() {
  const base = function (extra) {
    const o = {};
    MODULOS_PERM.forEach(function (m) { o[m[0]] = 'none'; });
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return JSON.stringify(o);
  };
  return [
    { perfil: 'administrador', nombre: 'Administrador', permisos: JSON.stringify(permisosTodo()) },
    { perfil: 'vendedor', nombre: 'Vendedor', permisos: base({ inicio: 'ver', vender: 'editar', productos: 'ver', ventas: 'ver' }) },
    { perfil: 'cajero', nombre: 'Cajero', permisos: base({ inicio: 'ver', vender: 'editar', ventas: 'ver', reportes: 'ver' }) }
  ];
}
function leerPerfiles() {
  asegurarEsquema('Perfiles', ESQ_PERFILES);
  let filas = leerFilas('Perfiles');
  if (!filas.length || !filas.some(function (p) { return String(p.perfil || '').trim(); })) {
    escribirFilas('Perfiles', perfilesPredeterminados().map(function (d) {
      return { perfil: d.perfil, nombre: d.nombre, permisos: d.permisos, activo: 1, creado: ahora() };
    }));
    filas = leerFilas('Perfiles');
  }
  return filas;
}
function buscarPerfil(nombre) {
  const f = String(nombre || '').toLowerCase().trim();
  if (!f) return null;
  return leerPerfiles().find(function (p) { return String(p.perfil || '').toLowerCase().trim() === f; }) || null;
}
function permisosDeUsuario(user) {
  if (String(user && user.rol) === 'admin') {
    return { rol: 'admin', perfil: '', perfilNombre: 'Administrador', permisos: permisosTodo() };
  }
  let per = String((user && user.perfil) || '').trim();
  if (!per) per = 'vendedor';
  let p = buscarPerfil(per);
  if (!p) p = buscarPerfil('vendedor');
  let permisos = {};
  try { permisos = JSON.parse(p && p.permisos ? p.permisos : '{}'); } catch (e) { permisos = {}; }
  return {
    rol: (user && user.rol) || 'empleado',
    perfil: p ? p.perfil : per,
    perfilNombre: p ? (p.nombre || p.perfil) : per,
    permisos: normalizarPermisos(permisos)
  };
}
function nivelPerm(permisos, modulo) {
  const v = (permisos || {})[modulo];
  return NIVEL_PERM[v] == null ? 0 : NIVEL_PERM[v];
}
function requirePermiso(token, modulo, nivel) {
  const s = requireAuth(token);
  const user = buscarUsuario(s.usuario);
  const info = permisosDeUsuario(user);
  if (info.rol === 'admin') return s;
  if (nivelPerm(info.permisos, modulo) < (NIVEL_PERM[nivel] || 1)) {
    throw new Error('No tienes permiso para esta acción (' + modulo + ').');
  }
  return s;
}

function requireAdmin(token) {
  const s = requireAuth(token);
  if (s.rol !== 'admin') throw new Error('No tienes permisos de administrador.');
  return s;
}

/* ================= AUTENTICACIÓN (cliente) ================= */

function login(usuario, password) {
  const user = buscarUsuario(usuario);
  if (!user) return { ok: false, error: 'Usuario o contraseña incorrectos' };
  if (String(user.activo) !== '1') return { ok: false, error: 'Usuario desactivado. Contacta al administrador.' };
  const h = hashPassword(password, String(user.salt));
  if (h !== String(user.hash)) return { ok: false, error: 'Usuario o contraseña incorrectos' };
  const token = crearSesion(user.usuario);
  const info = permisosDeUsuario(user);
  return {
    ok: true, token: token, usuario: user.usuario, nombre: user.nombre, rol: user.rol,
    perfil: info.perfil, perfilNombre: info.perfilNombre, permisos: info.permisos
  };
}

// Permisos efectivos del usuario de la sesión (al recargar la app).
function misPermisos(token) {
  const s = requireAuth(token);
  const user = buscarUsuario(s.usuario);
  const info = permisosDeUsuario(user);
  return { rol: info.rol, perfil: info.perfil, perfilNombre: info.perfilNombre, permisos: info.permisos };
}

function logout(token) {
  cerrarSesion(token);
  return { ok: true };
}

function cambiarPassword(token, vieja, nueva) {
  const s = requireAuth(token);
  const user = buscarUsuario(s.usuario);
  if (hashPassword(vieja, String(user.salt)) !== String(user.hash)) throw new Error('La contraseña actual no es correcta.');
  const salt = Utilities.getUuid();
  actualizarFila('Usuarios', 'usuario', user.usuario, { salt: salt, hash: hashPassword(nueva, salt) });
  return { ok: true };
}

function resetearPassword(token, usuario, nueva) {
  requirePermiso(token, 'admin', 'editar');
  const user = buscarUsuario(usuario);
  if (!user) throw new Error('Usuario no existe.');
  const salt = Utilities.getUuid();
  actualizarFila('Usuarios', 'usuario', user.usuario, { salt: salt, hash: hashPassword(nueva, salt) });
  return { ok: true };
}

/* ================= USUARIOS (admin) ================= */

function agregarUsuarioInterno(usuario, nombre, rol, pwd, perfil) {
  const u = String(usuario || '').trim();
  if (!u || !pwd) throw new Error('Usuario y contraseña son obligatorios.');
  if (buscarUsuario(u)) throw new Error('El usuario "' + u + '" ya existe.');
  const salt = Utilities.getUuid();
  const esAdmin = rol === 'admin';
  escribirFila('Usuarios', {
    usuario: u.toLowerCase(), nombre: nombre || u, rol: esAdmin ? 'admin' : 'empleado',
    salt: salt, hash: hashPassword(pwd, salt), activo: 1,
    perfil: esAdmin ? '' : String(perfil || 'vendedor').toLowerCase().trim()
  });
}

function listarUsuarios(token) {
  requirePermiso(token, 'admin', 'ver');
  return empaquetar(leerFilas('Usuarios').map(function (u) {
    const info = permisosDeUsuario(u);
    return {
      usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: u.activo,
      perfil: u.perfil || '', perfilNombre: info.perfilNombre
    };
  }));
}

function crearUsuario(token, datos) {
  requirePermiso(token, 'admin', 'editar');
  agregarUsuarioInterno(datos.usuario, datos.nombre, datos.rol, datos.password, datos.perfil);
  return { ok: true };
}

function cambiarEstadoUsuario(token, usuario, activo) {
  requirePermiso(token, 'admin', 'editar');
  actualizarFila('Usuarios', 'usuario', usuario, { activo: activo ? 1 : 0 });
  return { ok: true };
}

function cambiarRolUsuario(token, usuario, rol) {
  requirePermiso(token, 'admin', 'editar');
  const esAdmin = rol === 'admin';
  const cambios = { rol: esAdmin ? 'admin' : 'empleado' };
  if (esAdmin) cambios.perfil = '';
  actualizarFila('Usuarios', 'usuario', usuario, cambios);
  return { ok: true };
}

function cambiarPerfilUsuario(token, usuario, perfil) {
  requirePermiso(token, 'admin', 'editar');
  const user = buscarUsuario(usuario);
  if (!user) throw new Error('Usuario no existe.');
  const p = String(perfil || '').toLowerCase().trim();
  if (p && !buscarPerfil(p)) throw new Error('El perfil indicado no existe.');
  actualizarFila('Usuarios', 'usuario', usuario, { perfil: p });
  return { ok: true };
}

/* ================= PERFILES (CRUD, admin) ================= */

function listarPerfiles(token) {
  requirePermiso(token, 'admin', 'ver');
  return empaquetar(listarPerfilesCore());
}
function listarPerfilesCore() {
  return leerPerfiles().filter(function (p) { return String(p.perfil || '').trim(); }).map(function (p) {
    let pr = {};
    try { pr = JSON.parse(p.permisos || '{}'); } catch (e) { pr = {}; }
    return {
      perfil: p.perfil, nombre: p.nombre || p.perfil, activo: p.activo,
      permisos: normalizarPermisos(pr), sistema: (p.perfil === 'administrador')
    };
  });
}
function guardarPerfil(token, datos) {
  requirePermiso(token, 'admin', 'editar');
  datos = datos || {};
  const nombre = String(datos.nombre || '').trim();
  let perfil = String(datos.perfil || '').toLowerCase().trim()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!perfil) perfil = nombre.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!nombre || !perfil) throw new Error('Indica el nombre del perfil.');
  if (perfil === 'administrador') throw new Error('El perfil Administrador no se puede modificar.');
  const existente = buscarPerfil(perfil);
  const fila = {
    perfil: perfil,
    nombre: nombre,
    permisos: JSON.stringify(normalizarPermisos(datos.permisos || {})),
    activo: (datos.activo === false || datos.activo === 0 || datos.activo === '0') ? 0 : 1,
    creado: existente ? existente.creado : ahora()
  };
  if (existente) actualizarFila('Perfiles', 'perfil', perfil, fila);
  else escribirFila('Perfiles', fila);
  return { ok: true, perfil: perfil };
}
function eliminarPerfil(token, perfil) {
  requirePermiso(token, 'admin', 'editar');
  const p = String(perfil || '').toLowerCase().trim();
  if (p === 'administrador' || p === 'vendedor') throw new Error('Ese perfil es del sistema y no se puede eliminar.');
  const enUso = leerFilas('Usuarios').some(function (u) { return String(u.perfil || '').toLowerCase().trim() === p; });
  if (enUso) throw new Error('No se puede eliminar: hay usuarios con ese perfil. Cámbialos primero.');
  borrarFilaPorId('Perfiles', 'perfil', p);
  return { ok: true };
}

/* ================= TASA DE CAMBIO BCV ================= */

const CLAVE_TASA_MANUAL = 'tasa_manual';

// Lee la tasa oficial. Fuente principal: el sitio oficial del BCV (publica los
// viernes ~5:00 p. m. el valor con el que se venderá el lunes siguiente; ese
// mismo valor es el que debe usarse viernes en la noche, sábado y domingo).
// Respaldo: los espejos de dolarapi (tardan un poco más en actualizarse).
function leerTasaBCV() {
  try {
    const res = UrlFetchApp.fetch('https://www.bcv.org.ve/', { muteHttpExceptions: true, contentType: 'text/html; charset=utf-8' });
    if (res.getResponseCode() === 200) {
      const html = res.getContentText();
      const m = html.match(/<div id="dolar"[\s\S]*?<strong class="strong-tb">\s*([\d.,]+)/);
      if (m) {
        const t = parseFloat(String(m[1]).replace(/\./g, '').replace(',', '.'));
        if (t && t > 0) return { tasa: +t.toFixed(4), fecha: hoy(), fuente: 'bcv_sitio' };
      }
    }
  } catch (e) { /* se intenta con los espejos */ }
  const urls = [TASA_API, 'https://dolarapi.com/v1/dolares/oficial'];
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = UrlFetchApp.fetch(urls[i], { muteHttpExceptions: true, contentType: 'application/json' });
      if (res.getResponseCode() !== 200) continue;
      const data = JSON.parse(res.getContentText());
      const tasa = parseFloat(data.promedio || data.venta || data.compra || data.tasa);
      if (!tasa || tasa <= 0) continue;
      const fecha = String(data.fechaActualizacion || '').slice(0, 10);
      return { tasa: +tasa.toFixed(4), fecha: fecha || hoy(), fuente: 'bcv_api' };
    } catch (e2) { /* intentar con la siguiente fuente */ }
  }
  throw new Error('No se pudo obtener la tasa (BCV y dolarapi no respondieron).');
}

// Tasa manual fijada por el administrador (queda en Config hasta que se quite).
function getManualTasa() {
  const cfg = getConfig();
  const v = cfg[CLAVE_TASA_MANUAL];
  if (!v) return null;
  try {
    const o = JSON.parse(v);
    if (o && o.valor && parseFloat(o.valor) > 0) {
      return { valor: parseFloat(o.valor), fecha: String(o.fecha || '').slice(0, 10) };
    }
  } catch (e) {}
  return null;
}

// ¿La tasa manual sigue vigente? Se usa tal cual mientras NO llegue un día hábil
// nuevo: en fin de semana (vie ≥5pm, sáb, dom) sigue vigente; en día hábil
// (lunes a viernes) solo dura el MISMO día en que se fijó. Así expira sola el
// siguiente día hábil y vuelve el BCV automático.
function manualVigente(man) {
  const d = new Date();
  const dia = d.getDay(); // 0 = domingo
  const esHabil = dia >= 1 && dia <= 5;
  if (!esHabil) return true;
  return String(man.fecha).slice(0, 10) === hoy();
}

// Tasa vigente (la que se USA para vender): la manual si está activa, si no la
// última guardada del BCV. Incluye el historial para la pantalla de Ajustes.
function getTasaVigenteObj() {
  const ult = leerFilas('TasaCambio');
  const u = ult.length ? ult[ult.length - 1] : null;
  const historico = ult.slice(-30).reverse().map(function (f) {
    return { fecha: fechaPub(f.fecha_publicacion), tasa: parseFloat(f.tasa), fuente: f.fuente };
  });
  const man = getManualTasa();
  if (man && manualVigente(man)) {
    return { tasa: man.valor, fecha: man.fecha, fuente: 'manual', manual: true, historico: historico };
  }
  if (man) {
    // Llegó un día hábil nuevo: la manual expira sola y vuelve el BCV.
    try { borrarFilaPorId('Config', 'clave', CLAVE_TASA_MANUAL); } catch (e) {}
  }
  return {
    tasa: u ? parseFloat(u.tasa) : 0,
    fecha: u ? fechaPub(u.fecha_publicacion) : '',
    fuente: u ? String(u.fuente) : '',
    manual: false,
    historico: historico
  };
}

// Guarda la tasa del BCV si cambió (evita filas duplicadas sin valor nuevo).
function guardarTasaSiCambio(info) {
  const ult = leerFilas('TasaCambio');
  const u = ult.length ? ult[ult.length - 1] : null;
  const igual = u && fechaPub(u.fecha_publicacion) === info.fecha && Math.abs(parseFloat(u.tasa) - info.tasa) < 0.0001;
  if (!igual) {
    escribirFila('TasaCambio', { fecha_publicacion: info.fecha, tasa: info.tasa, fuente: info.fuente, actualizado: ahora() });
  }
}

// Viernes después de las 17:00, sábado o domingo: el BCV ya publicó (o está por
// publicar) la tasa del lunes siguiente, que es la que debe mandar el fin de
// semana. En esos momentos la app SIEMPRE intenta refrescar.
function esFinDeSemanaO_ViernesNoche() {
  const d = new Date();
  const dia = d.getDay(); // 0 = domingo
  const mins = d.getHours() * 60 + d.getMinutes();
  return (dia === 5 && mins >= 17 * 60) || dia === 6 || dia === 0;
}

// Refresca la tasa desde el BCV cuando corresponde. En días hábiles usa una
// caché de 2 horas para no golpear al sitio del BCV en cada apertura de la app;
// el viernes ≥5pm y el fin de semana refresca SIEMPRE. "forzar" ignora la caché
// (lo usa el botón "↻ Actualizar desde BCV" de Ajustes).
function refrescarTasaAuto(forzar) {
  const cache = CacheService.getScriptCache();
  const siempre = esFinDeSemanaO_ViernesNoche();
  if (!forzar && !siempre) {
    const o = cache.get('TASA_OK_MS');
    if (o && Date.now() - Number(o) < 2 * 3600 * 1000) return getTasaVigenteObj();
  }
  const info = leerTasaBCV();
  guardarTasaSiCambio(info);
  if (!siempre) cache.put('TASA_OK_MS', String(Date.now()), 7800);
  return getTasaVigenteObj();
}

// ¿Conviene intentar refrescar la tasa automática AHORA?
// - Viernes ≥17:00, sábado y domingo: SIEMPRE (la nueva tasa del lunes ya rige).
// - Lunes a viernes antes de las 17:00: solo si aún no existe la tasa de hoy.
function tocaRefrescar() {
  if (esFinDeSemanaO_ViernesNoche()) return true;
  const ult = leerFilas('TasaCambio');
  const u = ult.length ? ult[ult.length - 1] : null;
  const ultFecha = u ? fechaPub(u.fecha_publicacion) : '';
  const dia = new Date().getDay();
  if (dia >= 1 && dia <= 5 && ultFecha !== hoy()) return true;
  return false;
}

function getTasaVigente(token) {
  requireAuth(token);
  // La manual vigente se usa tal cual y NO se toca. Si ya venció (día hábil
  // nuevo), se deja que el flujo normal refresque y expira dentro de la lectura.
  const man = getManualTasa();
  if (man && manualVigente(man)) return getTasaVigenteObj();
  try {
    if (tocaRefrescar()) return refrescarTasaAuto();
  } catch (e) { /* se queda con la última conocida */ }
  return getTasaVigenteObj();
}

function actualizarTasa(token) {
  requirePermiso(token, 'admin', 'editar'); // botón "↻ Actualizar desde BCV" de Ajustes
  try { borrarFilaPorId('Config', 'clave', CLAVE_TASA_MANUAL); } catch (e) {} // vuelve al modo automático
  return refrescarTasaAuto(true); // forzado: ignora la caché de 2 horas
}

function setTasaManual(token, tasa) {
  requirePermiso(token, 'admin', 'editar');
  const t = parseFloat(tasa);
  if (!t || t <= 0) throw new Error('Tasa inválida. Escribe un número mayor que 0.');
  setConfig(CLAVE_TASA_MANUAL, JSON.stringify({ valor: t, fecha: hoy(), hora: ahora() }), 'tasa manual fijada por el administrador');
  return getTasaVigenteObj();
}

function quitarTasaManual(token) {
  requirePermiso(token, 'admin', 'editar');
  try { borrarFilaPorId('Config', 'clave', CLAVE_TASA_MANUAL); } catch (e) {}
  return getTasaVigenteObj();
}

/* ================= PRODUCTOS / INVENTARIO ================= */

function buscarProductoPorCodigo(codigo) {
  asegurarEsquema('Productos', ESQ_PRODUCTOS);
  const c = String(codigo || '').trim();
  return leerFilas('Productos').find(function (p) { return String(p.codigo).trim() === c; }) || null;
}

function listarProductos(token) {
  requireAuth(token);
  asegurarEsquema('Productos', ESQ_PRODUCTOS);
  return empaquetar(leerFilas('Productos') || []);
}

function buscarPorCodigo(token, codigo) {
  requireAuth(token);
  return empaquetar(buscarProductoPorCodigo(codigo));
}

function guardarProducto(token, prod) {
  requirePermiso(token, 'productos', 'editar');
  asegurarEsquema('Productos', ESQ_PRODUCTOS);
  const fila = {
    codigo: String(prod.codigo || '').trim(),
    nombre: String(prod.nombre || '').trim(),
    categoria: String(prod.categoria || '').trim() || 'Calzado',
    precio_usd: parseFloat(prod.precio_usd) || 0,
    costo_usd: parseFloat(prod.costo_usd) || 0,
    stock: parseFloat(prod.stock) || 0,
    stock_min: parseFloat(prod.stock_min) || 0,
    imagen: String(prod.imagen || '').trim(),
    tallas: Array.isArray(prod.tallas) ? prod.tallas.join(',') : String(prod.tallas || ''),
    stock_tallas: typeof prod.stock_tallas === 'string' ? prod.stock_tallas : JSON.stringify(prod.stock_tallas || {}),
    descripcion: String(prod.descripcion || '').trim(),
    activo: prod.activo === false || prod.activo === 0 || prod.activo === '0' ? 0 : 1
  };
  if (!fila.codigo || !fila.nombre) throw new Error('El código y el nombre son obligatorios.');
  const exist = buscarProductoPorCodigo(fila.codigo);
  if (exist) actualizarFila('Productos', 'codigo', fila.codigo, fila);
  else { fila.creado = ahora(); escribirFila('Productos', fila); }
  const res = buscarProductoPorCodigo(fila.codigo);
  return empaquetar(res || fila);
}

/* ---------- CATEGORÍAS ---------- */

function leerCategoriasExtras() {
  const cfg = getConfig();
  try { return JSON.parse(cfg.categorias || '[]'); } catch (e) { return []; }
}

function getCategorias(token) {
  requireAuth(token);
  return empaquetar(leerCategoriasExtras());
}

function guardarCategoria(token, nombre) {
  requirePermiso(token, 'productos', 'editar');
  const n = String(nombre || '').trim();
  if (!n) throw new Error('Escribe el nombre de la categoría.');
  const set = new Set(leerCategoriasExtras());
  set.add(n);
  const lista = Array.from(set);
  setConfig('categorias', JSON.stringify(lista));
  return empaquetar(lista);
}

function renombrarCategoria(token, vieja, nueva) {
  requirePermiso(token, 'productos', 'editar');
  const v = String(vieja || '').trim();
  const n = String(nueva || '').trim();
  if (!v || !n) throw new Error('Indica la categoría y su nuevo nombre.');
  if (v === 'General') throw new Error('La categoría General no se puede renombrar.');
  asegurarEsquema('Productos', ESQ_PRODUCTOS);
  const extras = leerCategoriasExtras().filter(function (c) { return String(c) !== v; });
  if (n !== 'General') extras.push(n);
  setConfig('categorias', JSON.stringify(extras));
  leerFilas('Productos').forEach(function (p) {
    if (String(p.categoria || '').trim() === v) {
      actualizarFila('Productos', 'codigo', p.codigo, { categoria: n });
    }
  });
  return empaquetar(extras);
}

function eliminarCategoria(token, nombre) {
  requirePermiso(token, 'productos', 'editar');
  const n = String(nombre || '').trim();
  if (!n) throw new Error('Indica la categoría.');
  if (n === 'General') throw new Error('La categoría General no se puede eliminar.');
  asegurarEsquema('Productos', ESQ_PRODUCTOS);
  const extras = leerCategoriasExtras().filter(function (c) { return String(c) !== n; });
  setConfig('categorias', JSON.stringify(extras));
  leerFilas('Productos').forEach(function (p) {
    if (String(p.categoria || '').trim() === n) {
      actualizarFila('Productos', 'codigo', p.codigo, { categoria: 'General' });
    }
  });
  return empaquetar(extras);
}

function ajustarStock(token, codigo, cantidad, motivo) {
  requirePermiso(token, 'productos', 'editar');
  asegurarEsquema('Productos', ESQ_PRODUCTOS);
  const prod = buscarProductoPorCodigo(codigo);
  if (!prod) throw new Error('Producto no encontrado: ' + codigo);
  const nuevo = (parseFloat(prod.stock) || 0) + (parseFloat(cantidad) || 0);
  if (nuevo < 0) throw new Error('El stock no puede quedar negativo.');
  actualizarFila('Productos', 'codigo', codigo, { stock: nuevo });
  return empaquetar(buscarProductoPorCodigo(codigo));
}

/* ================= VENTAS ================= */

function registrarVenta(token, datos) {
  const sess = requireAuth(token);
  return registrarVentaCore(datos, sess.usuario, sess.nombre);
}

function registrarVentaCore(datos, usuario, nombre) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    asegurarEsquema('Ventas', ESQ_VENTAS);
    let tasaObj = getTasaVigenteObj();
    if (!tasaObj.tasa) { try { tasaObj = refrescarTasaAuto(); } catch (e) {} }
    const tasa = tasaObj.tasa || 0;
    const config = getConfig();
    const permitirNeg = String(config.stock_negativo) === 'si';
    const prods = leerFilas('Productos');
    const items = datos.items || [];
    if (!items.length) throw new Error('El carrito está vacío.');
    const detalle = [];
    let subtotal = 0;
    items.forEach(function (it) {
      const prod = prods.find(function (f) { return String(f.codigo).trim() === String(it.codigo).trim(); });
      if (!prod) throw new Error('Producto no encontrado: ' + it.codigo);
      if (String(prod.activo) !== '1') throw new Error('Producto inactivo: ' + prod.nombre);
      const cant = parseFloat(it.cantidad) || 0;
      if (cant <= 0) throw new Error('Cantidad inválida para ' + prod.nombre);
      const stockActual = parseFloat(prod.stock) || 0;
      if (!permitirNeg && stockActual < cant) {
        throw new Error('Stock insuficiente de "' + prod.nombre + '" (hay ' + stockActual + ').');
      }
      const pvp = parseFloat(prod.precio_usd) || 0;
      const sub = +(pvp * cant).toFixed(2);
      subtotal += sub;
      detalle.push({ codigo: it.codigo, nombre: prod.nombre, cantidad: cant, precio_usd: pvp, sub_usd: sub, talla: it.talla || '' });
      actualizarFila('Productos', 'codigo', it.codigo, { stock: stockActual - cant });
    });
    const tipoEntrega = datos.tipo_entrega || 'envio';
    const zona = datos.zona || '';
    const cliente = datos.cliente || {};
    let envioUsd = 0;
    if (tipoEntrega === 'envio') {
      if (String(zona).toLowerCase().indexOf('caracas') >= 0) {
        envioUsd = parseFloat(datos.envio_usd) || 0;
      } else {
        envioUsd = getPrecioEnvio();
      }
    }
    const envioVes = +(envioUsd * tasa).toFixed(2);
    const totalUSD = +(subtotal + envioUsd).toFixed(2);
    const totalVES = +(totalUSD * tasa).toFixed(2);
    const id = 'PED-' + Date.now();
    escribirFila('Ventas', {
      id: id,
      fecha: ahora(),
      vendedor: usuario,
      empleado_nombre: nombre,
      cliente_nombre: String(cliente.nombre || '').trim(),
      cliente_documento: String(cliente.documento || '').trim(),
      cliente_telefono: String(cliente.telefono || '').trim(),
      cliente_direccion: String(cliente.direccion || '').trim(),
      cliente_estado: String(cliente.estado || '').trim(),
      items: JSON.stringify(detalle),
      metodo: datos.metodo || 'pagomovil',
      tipo_entrega: tipoEntrega,
      zona: zona,
      envio_usd: envioUsd,
      envio_ves: envioVes,
      subtotal_usd: subtotal,
      total_usd: totalUSD,
      tasa: tasa,
      total_ves: totalVES,
      nota: String(datos.nota || '').trim(),
      estado_pedido: 'pendiente'
    });
    try {
      enviarNotificacionPedido({ id: id, cliente: cliente, totalUSD: totalUSD, items: detalle });
    } catch (e) {}
    return { ok: true, id: id, totalUSD: totalUSD, totalVES: totalVES, tasa: tasa };
  } finally {
    lock.releaseLock();
  }
}

function enviarNotificacionPedido(pedido) {
  const cfg = getConfig();
  const emailAdmin = cfg.email_admin || cfg.email_notificacion || '';
  if (emailAdmin) {
    try {
      const asunto = 'Nuevo pedido Frugulletty - ' + pedido.id;
      const cuerpo = 'Se ha recibido un nuevo pedido.\n\nPedido: ' + pedido.id + '\nCliente: ' + (pedido.cliente.nombre || '') + '\nTeléfono: ' + (pedido.cliente.telefono || '') + '\nTotal: $' + pedido.totalUSD + '\n\nProductos:\n' + (pedido.items || []).map(function (it) { return '- ' + it.nombre + ' Talla:' + (it.talla||'') + ' x' + it.cantidad; }).join('\n');
      MailApp.sendEmail(emailAdmin, asunto, cuerpo);
    } catch (e) {}
  }
  return true;
}

function listarVentas(token, filtros) {
  requireAuth(token);
  const f = filtros || {};
  let filas = leerFilas('Ventas').reverse();
  if (f.desde) filas = filas.filter(function (v) { return fechaTxt(v.fecha).slice(0, 10) >= String(f.desde); });
  if (f.hasta) filas = filas.filter(function (v) { return fechaTxt(v.fecha).slice(0, 10) <= String(f.hasta); });
  if (f.vendedor) filas = filas.filter(function (v) { return String(v.vendedor) === String(f.vendedor); });
  return empaquetar(filas);
}

/* ================= GASTOS ================= */

function listarGastos(token, filtros) {
  requirePermiso(token, 'gastos', 'ver');
  const f = filtros || {};
  let filas = leerFilas('Gastos').reverse();
  if (f.desde) filas = filas.filter(function (g) { return fechaTxt(g.fecha).slice(0, 10) >= String(f.desde); });
  if (f.hasta) filas = filas.filter(function (g) { return fechaTxt(g.fecha).slice(0, 10) <= String(f.hasta); });
  return empaquetar(filas);
}

function guardarGasto(token, g) {
  requirePermiso(token, 'gastos', 'editar');
  const fila = {
    id: 'G' + Date.now(),
    fecha: g.fecha || hoy(),
    concepto: String(g.concepto || '').trim(),
    categoria: String(g.categoria || '').trim() || 'General',
    monto_usd: parseFloat(g.monto_usd) || 0,
    responsable: String(g.responsable || '').trim(),
    nota: String(g.nota || '').trim()
  };
  if (!fila.concepto || fila.monto_usd <= 0) throw new Error('Concepto y monto son obligatorios.');
  escribirFila('Gastos', fila);
  return fila;
}

function eliminarGasto(token, id) {
  requirePermiso(token, 'gastos', 'editar');
  borrarFilaPorId('Gastos', 'id', id);
  return { ok: true };
}

/* ================= REPORTES COMPARATIVOS (admin) =================
   Compara dos periodos (día vs día, semana vs semana, mes vs mes o
   año vs año): cuánto se ingresó (ventas), cuánto se egresó (gastos +
   sueldos pagados + gastos de obras) y cuánto quedó libre, en $ y Bs.
   El Bs de las ventas es el real con el que se cobró (total_ves); el Bs
   de los egresos se convierte con la tasa media del periodo. */

var MESES_NOMBRE = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Convierte la referencia del usuario en un rango { desde, hasta, etiqueta }.
function rangoPeriodo(tipo, ref) {
  tipo = String(tipo || '');
  ref = String(ref == null ? '' : ref).trim();
  var fechaCortaEtiqueta = function (d) { return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4); };
  if (tipo === 'dia') {
    var d = ref.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Indica la fecha del día (AAAA-MM-DD).');
    return { desde: d, hasta: d, etiqueta: 'Día ' + fechaCortaEtiqueta(d) };
  }
  if (tipo === 'semana') {
    // ref puede ser cualquier día dentro de la semana (lunes a domingo)
    var base = new Date(ref.slice(0, 10) + 'T12:00:00');
    if (isNaN(base.getTime())) throw new Error('Indica una fecha dentro de cada semana (AAAA-MM-DD).');
    var ds = base.getDay(); // 0 = domingo
    var off = ds === 0 ? -6 : 1 - ds;
    var lun = new Date(base.getTime() + off * 86400000);
    var dom = new Date(lun.getTime() + 6 * 86400000);
    var d1 = Utilities.formatDate(lun, CARACAS, 'yyyy-MM-dd');
    var d2 = Utilities.formatDate(dom, CARACAS, 'yyyy-MM-dd');
    return { desde: d1, hasta: d2, etiqueta: 'Semana ' + d1.slice(8, 10) + '/' + d1.slice(5, 7) + ' – ' + fechaCortaEtiqueta(d2) };
  }
  if (tipo === 'mes') {
    var m = ref.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('Indica el mes (AAAA-MM).');
    var y = parseInt(m.slice(0, 4), 10), mo = parseInt(m.slice(5, 7), 10);
    if (mo < 1 || mo > 12) throw new Error('Mes inválido.');
    var ult = new Date(y, mo, 0).getDate();
    return { desde: m + '-01', hasta: m + '-' + ('0' + ult).slice(-2), etiqueta: 'Mes ' + MESES_NOMBRE[mo - 1] + ' ' + y };
  }
  if (tipo === 'anio') {
    var an = ref.slice(0, 4);
    if (!/^\d{4}$/.test(an)) throw new Error('Indica el año (AAAA).');
    return { desde: an + '-01-01', hasta: an + '-12-31', etiqueta: 'Año ' + an };
  }
  throw new Error('Tipo de reporte no válido.');
}

// Tasa de referencia de un periodo para mostrar los montos también en Bs:
// 1) la tasa implícita real de las ventas del periodo (total_ves / total_usd);
// 2) si no hay ventas, el promedio de las tasas registradas en el periodo;
// 3) si no hay registro, la última tasa conocida antes del fin del periodo.
function tasaMediaPeriodo(desde, hasta) {
  var ventas = leerFilas('Ventas').filter(function (v) {
    var f = fechaTxt(v.fecha).slice(0, 10);
    return f >= desde && f <= hasta;
  });
  var su = 0, sv = 0;
  ventas.forEach(function (v) { su += parseFloat(v.total_usd) || 0; sv += parseFloat(v.total_ves) || 0; });
  if (su > 0 && sv > 0) return +(sv / su).toFixed(4);
  var tcs = leerFilas('TasaCambio').filter(function (t) {
    var f = fechaPub(t.fecha_publicacion);
    return f >= desde && f <= hasta;
  });
  if (tcs.length) {
    var s = tcs.reduce(function (acc, t) { return acc + (parseFloat(t.tasa) || 0); }, 0);
    return +(s / tcs.length).toFixed(4);
  }
  var prev = leerFilas('TasaCambio').filter(function (t) { return fechaPub(t.fecha_publicacion) <= hasta; });
  if (prev.length) return parseFloat(prev[prev.length - 1].tasa) || 0;
  return 0;
}

function reporteComparativo(token, tipo, a, b) {
  requirePermiso(token, 'reportes', 'ver');
  var pA = rangoPeriodo(tipo, a);
  var pB = rangoPeriodo(tipo, b);
  function calcular(p) {
    var ventas = leerFilas('Ventas').filter(function (v) {
      var f = fechaTxt(v.fecha).slice(0, 10);
      return f >= p.desde && f <= p.hasta;
    });
    var gastos = leerFilas('Gastos').filter(function (g) {
      var f = fechaTxt(g.fecha).slice(0, 10);
      return f >= p.desde && f <= p.hasta;
    });
    var sueldos = leerFilas('Sueldos').filter(function (s) {
      if (String(s.estado) !== 'pagado') return false;
      // La celda puede venir como fecha real (Sheets) o como texto; fechaTxt
      // la normaliza a yyyy-MM-dd antes de recortar, para que el rango funcione.
      var f = fechaTxt(s.fecha_pago || s.periodo || '').slice(0, 10);
      return f >= p.desde && f <= p.hasta;
    });
    // Cada pago cubre varios días: se cuentan los pagos (empleado+fecha), no los días.
    var setPagSueldo = {};
    sueldos.forEach(function (s) { setPagSueldo[fechaTxt(s.fecha_pago || '').slice(0, 10) + '|' + String(s.empleado_id)] = 1; });
    var nPagosSueldo = Object.keys(setPagSueldo).length;
    var obras = leerFilas('RemodGastos').filter(function (g) {
      var f = fechaTxt(g.fecha).slice(0, 10);
      return f >= p.desde && f <= p.hasta;
    });
    var suma = function (arr, c) { return arr.reduce(function (s, x) { return s + (parseFloat(x[c]) || 0); }, 0); };
    var ingUSD = +suma(ventas, 'total_usd').toFixed(2);
    var ingVES = +suma(ventas, 'total_ves').toFixed(2);
    var gasUSD = +suma(gastos, 'monto_usd').toFixed(2);
    var sueUSD = +suma(sueldos, 'monto_usd').toFixed(2);
    var obrUSD = +suma(obras, 'monto_usd').toFixed(2);
    var egreUSD = +(gasUSD + sueUSD + obrUSD).toFixed(2);
    var tasa = tasaMediaPeriodo(p.desde, p.hasta);
    if (!ingVES && tasa) ingVES = +(ingUSD * tasa).toFixed(2);
    var egreVES = +(egreUSD * tasa).toFixed(2);
    var libreUSD = +(ingUSD - egreUSD).toFixed(2);
    var libreVES = +(ingVES - egreVES).toFixed(2);
    return {
      desde: p.desde, hasta: p.hasta, etiqueta: p.etiqueta,
      ventas: ventas.length, ingreso_usd: ingUSD, ingreso_ves: ingVES,
      gastos: gastos.length, gastos_usd: gasUSD,
      sueldos: nPagosSueldo, sueldos_usd: sueUSD,
      obras: obras.length, obras_usd: obrUSD,
      egreso_usd: egreUSD, egreso_ves: egreVES,
      libre_usd: libreUSD, libre_ves: libreVES,
      tasa: tasa
    };
  }
  return { tipo: tipo, A: calcular(pA), B: calcular(pB) };
}

/* ================= EMPLEADOS Y NÓMINA =================
   Nómina con SUELDO DIARIO: el empleado gana un monto por día y trabaja ciertos
   DÍAS de la semana. Una "corrida" (proceso automático, mañana y tarde) registra
   cada día que le toca trabajar como un apunte PENDIENTE en la hoja "Sueldos".
   Al pagar, el admin elige los días: los desmarcados quedan como "falta" (no se
   cobran). Así el pendiente nunca deja diferencias. */

const DIAS_NOMBRE = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function diasSemanaArr(v) {
  return String(v == null ? '' : v).split(',')
    .map(function (x) { return parseInt(x, 10); })
    .filter(function (n) { return n >= 1 && n <= 7; });
}
function sueldoDiarioEmpleado(e) {
  return (parseFloat(e && e.sueldo_diario) || parseFloat(e && e.salario_usd) || 0);
}
function etiquetaDias(v) {
  const a = diasSemanaArr(v);
  if (!a.length) return '—';
  return a.map(function (n) { return DIAS_NOMBRE[n].slice(0, 3); }).join(' · ');
}
function _esPendienteSueldo(s) {
  const e = String(s && s.estado);
  return e !== 'pagado' && e !== 'falta';
}
function esquemaNomina() {
  asegurarEsquema('Empleados', ESQ_EMPLEADOS);
  asegurarEsquema('Sueldos', ESQ_SUELDOS);
}

function listarEmpleados(token) {
  requirePermiso(token, 'nomina', 'ver');
  esquemaNomina();
  return empaquetar(leerFilas('Empleados'));
}

function guardarEmpleado(token, emp) {
  requirePermiso(token, 'nomina', 'editar');
  esquemaNomina();
  const dia = parseFloat(emp.sueldo_diario);
  const diaOk = isNaN(dia) ? (parseFloat(emp.salario_usd) || 0) : dia;
  const fila = {
    id: emp.id || 'E' + Date.now(),
    nombre: String(emp.nombre || '').trim(),
    cargo: String(emp.cargo || '').trim() || 'Empleado',
    salario_usd: diaOk,
    sueldo_diario: diaOk,
    dias_semana: diasSemanaArr(emp.dias_semana).join(','),
    fecha_ingreso: emp.fecha_ingreso || hoy(),
    activo: emp.activo === false || emp.activo === 0 || emp.activo === '0' ? 0 : 1
  };
  if (!fila.nombre) throw new Error('El nombre es obligatorio.');
  const exist = leerFilas('Empleados').some(function (f) { return String(f.id) === String(fila.id); });
  if (exist) actualizarFila('Empleados', 'id', fila.id, fila);
  else escribirFila('Empleados', fila);
  return fila;
}

function listarSueldos(token, filtros) {
  requirePermiso(token, 'nomina', 'ver');
  esquemaNomina();
  const f = filtros || {};
  let filas = leerFilas('Sueldos').reverse();
  if (f.periodo) filas = filas.filter(function (s) { return fechaTxt(s.periodo || s.fecha_dia || '').slice(0, 7) === String(f.periodo); });
  if (f.empleado_id) filas = filas.filter(function (s) { return String(s.empleado_id) === String(f.empleado_id); });
  return empaquetar(filas);
}

// Días pendientes de un empleado (para el formulario de pago).
function diasPendientes(token, empleado_id) {
  requirePermiso(token, 'nomina', 'ver');
  esquemaNomina();
  const filas = leerFilas('Sueldos')
    .filter(function (s) { return String(s.empleado_id) === String(empleado_id) && _esPendienteSueldo(s); })
    .map(function (s) {
      const fd = fechaTxt(s.fecha_dia || '').slice(0, 10);
      return {
        id: s.id,
        fecha_dia: fd,
        periodo: String(s.periodo || (fd ? fd.slice(0, 7) : '')).slice(0, 7),
        monto_usd: parseFloat(s.monto_usd) || 0,
        nota: s.nota || ''
      };
    });
  filas.sort(function (a, b) { return a.fecha_dia < b.fecha_dia ? -1 : a.fecha_dia > b.fecha_dia ? 1 : 0; });
  return empaquetar(filas);
}

// Pago de nómina: marca los días elegidos como "pagado" (hoy) y los desmarcados
// como "falta" (no trabajó: no se cobra). Devuelve el total pagado.
function registrarPagoSueldo(token, data) {
  requirePermiso(token, 'nomina', 'editar');
  return registrarPagoSueldoCore(data);
}
// Lógica de pago (sin token, para poder probarla desde el diagnóstico).
function registrarPagoSueldoCore(data) {
  esquemaNomina();
  data = data || {};
  const pagar = Array.isArray(data.pagar) ? data.pagar.map(String) : [];
  const falta = Array.isArray(data.falta) ? data.falta.map(String) : [];
  const mapa = {};
  leerFilas('Sueldos').forEach(function (s) { mapa[String(s.id)] = s; });
  const hoyTxt = hoy();
  let total = 0;
  pagar.forEach(function (id) {
    const s = mapa[id];
    if (s) total += parseFloat(s.monto_usd) || 0;
    actualizarFila('Sueldos', 'id', id, { estado: 'pagado', fecha_pago: hoyTxt });
  });
  falta.forEach(function (id) {
    actualizarFila('Sueldos', 'id', id, { estado: 'falta', fecha_pago: '', nota: 'No trabajó' });
  });
  return { ok: true, pagados: pagar.length, faltas: falta.length, total_usd: +total.toFixed(2) };
}

// Compatibilidad con versiones anteriores (pago manual suelto).
function registrarSueldo(token, s) {
  requirePermiso(token, 'nomina', 'editar');
  esquemaNomina();
  const emp = leerFilas('Empleados').find(function (f) { return String(f.id) === String(s.empleado_id); });
  const fila = {
    id: 'S' + Date.now(),
    empleado_id: String(s.empleado_id || ''),
    empleado_nombre: emp ? emp.nombre : String(s.empleado_nombre || ''),
    periodo: String(s.periodo || '').slice(0, 7),
    fecha_dia: String(s.fecha_dia || '').slice(0, 10),
    fecha_pago: s.fecha_pago || hoy(),
    monto_usd: parseFloat(s.monto_usd) || 0,
    estado: s.estado === 'pendiente' ? 'pendiente' : 'pagado',
    nota: String(s.nota || '').trim()
  };
  if (!fila.empleado_id || !fila.periodo || fila.monto_usd <= 0) throw new Error('Complete empleado, periodo y monto.');
  escribirFila('Sueldos', fila);
  return fila;
}

function cambiarEstadoSueldo(token, id, estado) {
  requirePermiso(token, 'nomina', 'editar');
  actualizarFila('Sueldos', 'id', id, { estado: estado === 'pagado' ? 'pagado' : 'pendiente' });
  return { ok: true };
}

// Resumen de nómina para la pantalla: pendientes por empleado, KPIs e historial.
function getNomina(token) {
  const ses = requirePermiso(token, 'nomina', 'ver');
  esquemaNomina();
  const emps = leerFilas('Empleados');
  const sueldos = leerFilas('Sueldos');
  const mes = hoy().slice(0, 7);
  const suma = function (arr) { return +arr.reduce(function (s, x) { return s + (parseFloat(x.monto_usd) || 0); }, 0).toFixed(2); };
  const porEmp = {};
  const pendTodos = sueldos.filter(_esPendienteSueldo);
  pendTodos.forEach(function (x) {
    const k = String(x.empleado_id);
    if (!porEmp[k]) porEmp[k] = { dias: 0, usd: 0 };
    porEmp[k].dias++;
    porEmp[k].usd += parseFloat(x.monto_usd) || 0;
  });
  const empleados = emps.map(function (e) {
    const p = porEmp[String(e.id)] || { dias: 0, usd: 0 };
    return {
      id: e.id, nombre: e.nombre, cargo: e.cargo, activo: e.activo,
      sueldo_diario: sueldoDiarioEmpleado(e),
      dias_semana: String(e.dias_semana || ''),
      dias_txt: etiquetaDias(e.dias_semana),
      fecha_ingreso: fechaTxt(e.fecha_ingreso || '').slice(0, 10),
      pend_dias: p.dias, pend_usd: +p.usd.toFixed(2)
    };
  });
  const pagMes = sueldos.filter(function (x) {
    return String(x.estado) === 'pagado' && fechaTxt(x.fecha_pago || x.periodo || '').slice(0, 7) === mes;
  });
  const grupos = {};
  pagMes.forEach(function (x) {
    const f = fechaTxt(x.fecha_pago || '').slice(0, 10);
    const k = f + '|' + String(x.empleado_id);
    if (!grupos[k]) grupos[k] = { fecha: f, empleado: x.empleado_nombre, dias: 0, usd: 0 };
    grupos[k].dias++;
    grupos[k].usd += parseFloat(x.monto_usd) || 0;
  });
  const pagos = Object.keys(grupos).map(function (k) {
    const g = grupos[k];
    return { fecha: g.fecha, empleado: g.empleado, dias: g.dias, usd: +g.usd.toFixed(2) };
  }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });
  return empaquetar({
    esAdmin: ses.rol === 'admin',
    mes: mes,
    empleados: empleados,
    kpis: { pend_usd: suma(pendTodos), pend_dias: pendTodos.length, pag_mes_usd: suma(pagMes), pag_mes_dias: pagMes.length },
    pagos: pagos
  });
}

// La CORRIDA: registra como pendientes los días que le tocaron a cada empleado
// activo (desde su ingreso, hasta hoy), sin repetir los que ya existen.
function corridaNomina() {
  esquemaNomina();
  const emps = leerFilas('Empleados');
  const existentes = {};
  leerFilas('Sueldos').forEach(function (s) {
    const fd = fechaTxt(s.fecha_dia || '').slice(0, 10);
    if (fd) existentes[String(s.empleado_id) + '|' + fd] = true;
  });
  const hoyTxt = hoy();
  const cap = sumarDiasFecha(hoyTxt, -92); // no rellenar más de ~3 meses hacia atrás
  const nuevas = [];
  emps.forEach(function (e) {
    if (String(e.activo) !== '1') return;
    const dias = diasSemanaArr(e.dias_semana);
    if (!dias.length) return;
    const monto = sueldoDiarioEmpleado(e);
    if (monto <= 0) return;
    let ini = fechaTxt(e.fecha_ingreso || '').slice(0, 10);
    if (!ini || ini < cap) ini = cap;
    if (ini > hoyTxt) return;
    for (let d = ini; d <= hoyTxt; d = sumarDiasFecha(d, 1)) {
      if (dias.indexOf(diaSemanaIso(d)) < 0) continue;
      const k = String(e.id) + '|' + d;
      if (existentes[k]) continue;
      existentes[k] = true;
      nuevas.push({
        id: 'S' + Date.now() + '-' + nuevas.length,
        empleado_id: e.id,
        empleado_nombre: e.nombre,
        periodo: d.slice(0, 7),
        fecha_dia: d,
        fecha_pago: '',
        monto_usd: monto,
        estado: 'pendiente',
        nota: ''
      });
    }
  });
  if (nuevas.length) escribirFilas('Sueldos', nuevas);
  setConfig('nomina_corrida_ts', String(Date.now()), 'Última corrida de nómina');
  return { creadas: nuevas.length, revisadas: emps.length };
}

// Corre la corrida como máximo cada 30 min (para que el pendiente esté al día
// aunque nadie abra la app, sin recargar de más). Nunca rompe el panel.
function corridaNominaTick() {
  try {
    const ts = parseInt(getConfig().nomina_corrida_ts || '0', 10);
    if (Date.now() - ts < 30 * 60 * 1000) return;
    corridaNomina();
  } catch (e) { /* silencio: el panel debe seguir funcionando */ }
}

function corridaNominaManual(token) {
  requirePermiso(token, 'nomina', 'editar');
  return corridaNomina();
}

/* ---------- Avisos automáticos (8:00 y 16:00) ---------- */
function listaTriggersNomina() {
  return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'corridaNomina'; });
}
function instalarTriggersNominaCore() {
  listaTriggersNomina().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('corridaNomina').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('corridaNomina').timeBased().everyDays(1).atHour(16).create();
  return { total: listaTriggersNomina().length };
}
// Se ejecuta desde el editor de Apps Script (una vez) si el botón de la app
// pide autorización para crear los avisos.
function instalarTriggersNominaEditor() {
  return instalarTriggersNominaCore();
}
function instalarTriggersNomina(token) {
  requirePermiso(token, 'nomina', 'editar');
  try { return instalarTriggersNominaCore(); }
  catch (e) {
    throw new Error('No se pudieron crear los avisos automáticos. Abre el editor de Apps Script y ejecuta instalarTriggersNominaEditor() una vez. Detalle: ' + ((e && e.message) || e));
  }
}
function estadoTriggersNomina(token) {
  requirePermiso(token, 'nomina', 'ver');
  try { return { total: listaTriggersNomina().length }; }
  catch (e) { return { total: 0, error: String((e && e.message) || e) }; }
}

/* ================= REMODELACIONES / OBRAS ================= */

function listarRemodelaciones(token) {
  requirePermiso(token, 'remodelaciones', 'ver');
  return empaquetar(leerFilas('Remodelaciones'));
}

function guardarRemodelacion(token, r) {
  requirePermiso(token, 'remodelaciones', 'editar');
  const fila = {
    id: r.id || 'R' + Date.now(),
    nombre: String(r.nombre || '').trim(),
    tipo: String(r.tipo || '').trim() || 'Remodelación',
    descripcion: String(r.descripcion || '').trim(),
    estado: String(r.estado || '').trim() || 'En progreso',
    progreso: parseInt(r.progreso, 10) || 0,
    fecha_inicio: r.fecha_inicio || hoy(),
    fecha_fin_estimada: r.fecha_fin_estimada || ''
  };
  if (!fila.nombre) throw new Error('El nombre del proyecto es obligatorio.');
  const exist = leerFilas('Remodelaciones').some(function (f) { return String(f.id) === String(fila.id); });
  if (exist) actualizarFila('Remodelaciones', 'id', fila.id, fila);
  else escribirFila('Remodelaciones', fila);
  return fila;
}

function listarRemodGastos(token, remodId) {
  requirePermiso(token, 'remodelaciones', 'ver');
  return empaquetar(leerFilas('RemodGastos').filter(function (g) { return String(g.remod_id) === String(remodId); }).reverse());
}

function guardarRemodGasto(token, rg) {
  requirePermiso(token, 'remodelaciones', 'editar');
  const fila = {
    id: 'RG' + Date.now(),
    remod_id: String(rg.remod_id || ''),
    fecha: rg.fecha || hoy(),
    concepto: String(rg.concepto || '').trim(),
    tipo: String(rg.tipo || '').trim() || 'material',
    monto_usd: parseFloat(rg.monto_usd) || 0,
    nota: String(rg.nota || '').trim()
  };
  if (!fila.remod_id || !fila.concepto || fila.monto_usd <= 0) throw new Error('Complete proyecto, concepto y monto.');
  escribirFila('RemodGastos', fila);
  return fila;
}

function eliminarRemodGasto(token, id) {
  requirePermiso(token, 'remodelaciones', 'editar');
  borrarFilaPorId('RemodGastos', 'id', id);
  return { ok: true };
}

/* ================= PANEL / RESUMEN ================= */

function getDashboard(token) {
  requireAuth(token);
  corridaNominaTick(); // deja al día los días pendientes de nómina (con límite de frecuencia)
  return resumenNegocio();
}

function resumenNegocio() {
  const hoyTxt = hoy();
  const mes = hoyTxt.slice(0, 7);
  const ventas = leerFilas('Ventas');
  const gastos = leerFilas('Gastos');
  const sueldos = leerFilas('Sueldos');
  const prods = leerFilas('Productos');
  const vHoy = ventas.filter(function (v) { return fechaTxt(v.fecha).slice(0, 10) === hoyTxt; });
  const vMes = ventas.filter(function (v) { return fechaTxt(v.fecha).slice(0, 7) === mes; });
  const gMes = gastos.filter(function (g) { return fechaTxt(g.fecha).slice(0, 7) === mes; });
  const sPend = sueldos.filter(_esPendienteSueldo); // días pendientes (pueden ser de meses anteriores)
  // Egresos del mes = gastos + sueldos pagados + gastos de obras (igual que Reportes).
  const sPagMes = sueldos.filter(function (s) { return String(s.estado) === 'pagado' && fechaTxt(s.fecha_pago || s.periodo || '').slice(0, 7) === mes; });
  // Cada pago cubre varios días: se cuentan los pagos (empleado+fecha), no los días.
  const pagosSet = {};
  sPagMes.forEach(function (s) { pagosSet[fechaTxt(s.fecha_pago || '').slice(0, 10) + '|' + String(s.empleado_id)] = 1; });
  const nPagosSueldo = Object.keys(pagosSet).length;
  const oMes = leerFilas('RemodGastos').filter(function (g) { return fechaTxt(g.fecha).slice(0, 7) === mes; });
  const stockBajo = prods.filter(function (p) {
    return String(p.activo) === '1' && (parseFloat(p.stock) || 0) <= (parseFloat(p.stock_min) || 0);
  }).slice(0, 8);
  const suma = function (arr, campo) { return +arr.reduce(function (s, x) { return s + (parseFloat(x[campo]) || 0); }, 0).toFixed(2); };
  return {
    tasa: getTasaVigenteObj(),
    ventasHoy: { cantidad: vHoy.length, usd: suma(vHoy, 'total_usd'), ves: suma(vHoy, 'total_ves') },
    ventasMes: { cantidad: vMes.length, usd: suma(vMes, 'total_usd'), ves: suma(vMes, 'total_ves') },
    gastosMes: { cantidad: gMes.length, usd: suma(gMes, 'monto_usd') },
    sueldosPagadosMes: { cantidad: nPagosSueldo, usd: suma(sPagMes, 'monto_usd') },
    egresosMes: {
      cantidad: gMes.length + nPagosSueldo + oMes.length,
      usd: +(suma(gMes, 'monto_usd') + suma(sPagMes, 'monto_usd') + suma(oMes, 'monto_usd')).toFixed(2)
    },
    sueldosPendientes: { dias: sPend.length, usd: suma(sPend, 'monto_usd') },
    stockBajo: stockBajo,
    totalProductos: prods.filter(function (p) { return String(p.activo) === '1'; }).length
  };
}

/* ================= INICIALIZACIÓN (ejecutar 1 vez en el editor) ================= */

function inicializar() {
  // Un solo clic: crea todo y deja listo el administrador admin / TuClaveFuerte2026.
  return inicializarCon('admin', 'TuClaveFuerte2026');
}

function inicializarCon(adminUsuario, adminPassword) {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) ss = SpreadsheetApp.create('Frugulletty - Tienda Online');
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());

  asegurarTab('Config', ['clave', 'valor', 'descripcion']);
  asegurarTab('Usuarios', ['usuario', 'nombre', 'rol', 'salt', 'hash', 'activo', 'perfil']);
  asegurarEsquema('Usuarios', ['usuario', 'nombre', 'rol', 'salt', 'hash', 'activo', 'perfil']);
  asegurarTab('TasaCambio', ['fecha_publicacion', 'tasa', 'fuente', 'actualizado']);
  asegurarTab('Productos', ESQ_PRODUCTOS);
  asegurarTab('Ventas', ESQ_VENTAS);
  asegurarTab('Gastos', ['id', 'fecha', 'concepto', 'categoria', 'monto_usd', 'responsable', 'nota']);
  asegurarTab('Empleados', ESQ_EMPLEADOS);
  asegurarTab('Sueldos', ESQ_SUELDOS);
  asegurarTab('Remodelaciones', ['id', 'nombre', 'tipo', 'descripcion', 'estado', 'progreso', 'fecha_inicio', 'fecha_fin_estimada']);
  asegurarTab('RemodGastos', ['id', 'remod_id', 'fecha', 'concepto', 'tipo', 'monto_usd', 'nota']);
  asegurarTab('Perfiles', ESQ_PERFILES);
  asegurarEsquema('Perfiles', ESQ_PERFILES);
  leerPerfiles();

  setConfig('tasa_vigente_regla', 'auto', 'Auto: tasa oficial BCV.');
  setConfig('stock_negativo', 'no', 'Permitir vender sin stock (si/no)');
  setConfig('precio_envio_nacional', '5', 'Precio de envío nacional por defecto');
  setConfig('zonas_delivery', JSON.stringify([
    { nombre: 'Caracas', precio_usd: 0, aplica_delivery: true },
    { nombre: 'Miranda', precio_usd: 0, aplica_delivery: true },
    { nombre: 'Vargas', precio_usd: 0, aplica_delivery: true },
    { nombre: 'Interior', precio_usd: 5, aplica_delivery: false }
  ]), 'Zonas de entrega');

  if (!buscarUsuario(adminUsuario)) {
    agregarUsuarioInterno(adminUsuario, 'Administrador', 'admin', adminPassword);
  }
  return '¡Listo! Base de datos Frugulletty creada. Administrador configurado.';
}