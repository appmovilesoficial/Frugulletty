# 💄 MakeupKarelys — Sistema de gestión (Apps Script + Google Sheets)

Aplicación que funciona en **Android, iPhone y PC** (desde el navegador) con base de datos en **Google Sheets** alojada en **tu Google Drive**.

## Módulos incluidos

- 🔐 Acceso con usuario/contraseña (roles: **admin** y **empleado**)
- 🛒 Punto de venta con escaneo de código (cámara) y totales automáticos en **$ y Bs**
- 📦 Inventario con alta por cámara o manual, ajustes de stock y stock mínimo
- 🧾 Historial de ventas, corte del día y desglose por método de pago
- 💸 Gastos con categorías y totales mensuales
- 👥 Nómina: empleados con salario y registro de pagos (pendiente/pagado)
- 🏗️ Remodelaciones: proyectos con % de avance y gastos por obra
- 💱 Tasa BCV automática (ve.dolarapi.com, refleja la tasa oficial del BCV) con historial y opción manual de emergencia

## 📁 Archivos de este proyecto

| Archivo | Para pegarlo en Apps Script como |
|---|---|
| `Codigo.gs` | archivo `.gs` (pestaña de código) |
| `Index.html` | archivo `Index.html` (trae estilos y lógica de la app **incluidos**) |

> `app.js`, `styles.css` e `Index.esqueleto.html` son las **fuentes internas**: `Index.html` se genera automáticamente con `_build_inline.ps1`. No se pegan por separado.

---

## 🔧 Instalación paso a paso (hazlo 1 sola vez)

### 1. Crea la hoja de cálculo
1. Ve a [sheets.google.com](https://sheets.google.com) → **+ Nuevo** → **Hoja de cálculo en blanco**.
2. Ponle nombre, por ejemplo: **MakeupKarelys — Base de datos**.

### 2. Abre Apps Script
1. En la hoja: menú **Extensiones → Apps Script**.
2. Borra el contenido del archivo `Código.gs` que viene por defecto y **pega el contenido de `Codigo.gs`**.
3. Crea el archivo de la página con el botón **＋ → HTML** → nómbralo `Index` → **pega el contenido completo de `Index.html`** (trae los estilos y la lógica de la app ya incluidos, sin marcadores).

### 3. Zona horaria (importante para las fechas y la tasa)
1. En el editor: **Configuración del proyecto** (engranaje ⚙️).
2. **Zona horaria:** `(GMT-04:00) America/Caracas`.

### 4. Crea el administrador
1. En el editor, en el selector de funciones elige `inicializar` y **pulsa Ejecutar** (no pide parámetros: crea `admin` con la clave `TuClaveFuerte2026`).
2. **Autoriza** cuando Google lo pida (tu cuenta). Esto crea todas las pestañas y el primer usuario admin.
3. Después, dentro de la app: **Ajustes → Cambiar mi contraseña** para poner tu clave personal.

> ⚠️ Cambia esa contraseña luego dentro de la app (Ajustes → Mi contraseña).

### 5. Publica la aplicación web
1. Botón **Implementar → Nueva implementación** → tipo **Aplicación web**.
2. Configura así:
   - **Descripción:** `MakeupKarelys v1`
   - **Ejecutar como:** *Yo* ✅
   - **Quién tiene acceso:** *Cualquier persona* ✅
3. **Implementar** → copia la **URL de la aplicación web** (empieza con `https://script.google.com/macros/s/...`).
4. Cada vez que cambies el código, usa **Implementar → Administrar implementaciones → ✏️ → Nueva versión**.

### 6. ¡A usarla!
- Abre la URL en el teléfono o PC.
- Entra con `admin` y tu contraseña.
- En **Ajustes → Usuarios** crea cuentas para tus empleados (rol **Empleado**).
- Empieza por **Inventario → ＋ Nuevo producto**, escanea con la cámara 📷 o escribe el código, y pon precio en **$**.

---

## 📱 Ponerla como "app" en el teléfono

- **Android (Chrome):** abre la URL → menú ⋮ → **Instalar aplicación** → Añadir a pantalla de inicio.
- **iPhone (Safari):** abre la URL → botón Compartir → **Añadir a pantalla de inicio**.

## 📷 Escanear códigos

- La app ofrece **dos formas** de leer códigos de barras y QR:
  1. **Tomar foto del código** (recomendada): abre la cámara de tu teléfono, toma una foto al código y la app lo lee. Funciona en todos los navegadores.
  2. **Escanear en vivo**: apunta la cámara directamente. Depende del navegador; si está bloqueado, la app te avisa y puedes usar la foto.
- Si el escáner no funciona en algún navegador, siempre puedes **escribir el código a mano** en el campo de texto.

---

## 💱 Cómo funciona la tasa BCV

- La app lee la **tasa oficial del BCV** desde `https://ve.dolarapi.com/v1/dolares/oficial` (comunidad que publica la tasa oficial).
- El BCV publica en **días hábiles** (casi siempre ~1:00 pm). La app guarda cada tasa nueva en la pestaña **TasaCambio** (historial).
- **Sábado y domingo** (y lunes de mañana mientras no haya publicación nueva) se usa automáticamente la **última tasa publicada** (la del viernes), tal como funciona el mercado.
- Si el API no responde, la app sigue usando la última tasa conocida.
- **Respaldo manual:** en **Ajustes → Tasa de cambio → Fijar manual** puedes escribir la tasa a mano. La siguiente sincronización automática la reemplaza.

## 🔐 Seguridad (importante)

- Las contraseñas se guardan **encriptadas** (hash SHA-256 + sal aleatoria); nadie puede leerlas, ni tú.
- La app sola no envía datos a terceros; la tasa se consulta al API público de dolarapi.
- Para un negocio pequeño esto es aceptable. **No guardes en la hoja** información bancaria sensible ni claves de cuentas.
- Quien tenga la URL puede ver el login, pero **no puede entrar** sin usuario y contraseña.

## ⚠️ Límites razonables

- Se necesita **internet** para cargar/guardar (todo vive en la nube).
- Pensada para negocios con cientos de ventas al día. Si algún día vendieras miles por minuto, habría que migrar a otra base de datos.
- Con varios usuarios trabajando a la vez Google Sheets se comporta bien; las ventas usan un bloqueo para evitar choques.

## 🛠️ Mantenimiento / datos

- Todos los datos viven en tu hoja de cálculo: **Productos, Ventas, Gastos, Empleados, Sueldos, Remodelaciones, RemodGastos, TasaCambio, Usuarios, Config**.
- Puedes abrir la hoja en Drive, editarla, hacer tus propias fórmulas o exportar a Excel.
- **No borres ni renombres las pestañas** (la app las necesita). Los cambios de config (como permitir vender sin stock) se hacen en la pestaña `Config`.

## 🔄 Actualizar la app tras cambios de código

1. Regenera la página: ejecuta `clasp\_build_inline.ps1` (PowerShell). Reconstruye `Index.html` con el CSS y el JS **incluidos** (no se pegan sueltos).
2. Sube los cambios y crea una versión nueva (desde la carpeta `clasp`, en cmd):
   ```sh
   echo y| npx -y @google/clasp push
   echo y| npx -y @google/clasp create-deployment --description "vN"
   ```
3. Cada implementación nueva genera una **URL nueva**: usa la que imprime el paso 2 (la anterior queda funcionando con la versión vieja).

## ❓ Si algo falla

1. Revisa **Ajustes → Tasa** (que haya tasa cargada).
2. Revisa que la implementación de la web app esté en una versión reciente.
3. Revisa la pestaña `Config`: `stock_negativo` en `si` permite vender aunque no haya stock.
4. Para dudas de la consola: menú **Ejecutar → Ver registros** en Apps Script (muestra errores del servidor).