# PROMPT PARA REPLICAR "BODEGON EVOLUTION" EN UNA SESIÓN NUEVA

Pega el bloque marcado abajo como primer mensaje de la sesión nueva de OpenCode.
No hace falta exportar nada en RAR/ZIP: los archivos ya están en el disco y la
sesión nueva puede leerlos por ruta. Si aun así quieres un respaldo portátil,
copia la carpeta origen a un ZIP (clic derecho → Comprimir en ZIP) y en el
prompt cambia la ruta origen por la del ZIP indicando que la extraiga.

-------------------------------------------------------------------
## ⌨️ PROMPT (copia desde aquí)

Eres un agente de OpenCode. Tu tarea es **replicar el proyecto "Bodegon Evolution"**
en una carpeta nueva e independiente, sin tocar el proyecto original ni sus datos.

### 1) Qué es el proyecto
Es un sistema de ventas/inventario en español ("Bodegon Evolution", v40):
- **Cliente**: página web (UI) servida desde GitHub Pages.
- **Servidor**: Apps Script (Google) que guarda todo en una hoja de cálculo de Google Drive.
- El escáner físico, login interno, reportes, tasas BCV, inventario, gastos, nómina, etc.
El código del servidor NO debe publicarse en GitHub (es privado); solo se publica la UI.

### 2) Dónde están los archivos ORIGEN (NO modificar estos)
Carpeta raíz del proyecto (Windows):
`C:\Users\ROSGOD\Documents\Default Project\AppControlNegocio`

Archivos/contenido a copiar:
- `app.js` → cliente completo (v40). Contiene el check de versión 'v40'.
- `Codigo.gs` → servidor Apps Script (v40). Misma versión que app.js.
- `Index.esqueleto.html` → plantilla de la página (etiquetas v40).
- `Index.html` → página ya construida (para previsualizar local).
- `styles.css`, `Preview.html`, `README.md` → estilos y docs.
- `clasp/` → carpeta de despliegue Google Apps Script:
  - `Codigo.gs`, `Index.html`, `appsscript.json` (los 3 se suben con clasp),
  - `appsscript.correcto.json` (referencia), `.clasp.json` (tiene el scriptId del
    deployment actual: al replicar de forma independiente habrá que crear un
    script nuevo y actualizar ese scriptId), `.claspignore`,
  - `_build_inline.ps1` (script que inyecta app.js+styles.css en la plantilla y
    regenera Index.html, clasp/Index.html y para-publicar/index.html),
  - `INSTRUCCIONES.md`, `INSTALAR.cmd` (manual de instalación, repasa su contenido).
- `para-publicar/` → index.html ya construido (es lo que se sube a GitHub Pages)
  y `LEEME.txt`.
- `tests/escaneo.test.js` → pruebas unitarias del cliente (node).

### 3) Enlaces de referencia del proyecto actual (para entender el funcionamiento)
- API/servidor Apps Script:
  `https://script.google.com/macros/s/AKfycbypNC0VMhXxpn-6GxUdd7LsRNovAxpj1IzLJdNBJD18blGBxNcUKtkLrgbG62JAtBVZzA/exec`
  (deployment @45, versión v40; responde `?accion=infoServidor` → `{version:'v40'}`).
- Página en vivo (GitHub Pages):
  `https://evolutionbodegon-hue.github.io/mi-negocio/` (v40).
- La hoja de cálculo con los datos del negocio es REAL (ventas, productos, gastos…).
  Su ID está guardado en las propiedades del script desplegado (NO está en los
  archivos). NO escribir datos de prueba en la hoja real sin permiso explícito.

### 4) Cómo se estructura internamente
- Flujo de construcción: la plantilla `Index.esqueleto.html` + `app.js` + `styles.css`
  → `_build_inline.ps1` genera los 3 index (raíz, clasp y para-publicar).
- Cliente ↔ servidor: la UI llama al URL exec con `?accion=<función>&args=<JSON>`
  (`doGet` en Codigo.gs despacha; cada función valida su token).
- Autenticación: login interno (hoy los usuarios reales son `admin`/`TuClaveFuerte2026`
  con rol admin, y `cajaprincipal`; ya NO existe `rosmel`).
- Versión: hay que mantener el mismo número "vXX" en app.js (3 sitios), esqueleto
  (2 sitios) y `infoServidor` en Codigo.gs; la app avisa si página ≠ servidor.
- Diagnóstico técnico: `?debug=*` exige `clave=m1neg0c1o2026-v31`.
- Las pruebas E2E se ejecutan contra el deployment real (ver sección 6).

### 5) TAREA PRINCIPAL — copiar y aislar
1. Copia la carpeta completa
   `C:\Users\ROSGOD\Documents\Default Project\AppControlNegocio`
   a una carpeta NUEVA, por ejemplo:
   `C:\Users\ROSGOD\Documents\Default Project\AppControlNegocio-Copia`
   (verifica que quede íntegra: app.js, Codigo.gs, Index.esqueleto.html, clasp/,
   para-publicar/, tests/, estilos y README).
2. Trabaja EXCLUSIVAMENTE en la copia. Jamás modifiques la carpeta original.
3. Antes de tocar nada más, repórtame:
   - la estructura de la copia (árbol de archivos),
   - qué hace cada pieza según los comentarios del código y el README,
   - cómo cree que debería desplegarse la réplica.
4. Pregúntame ALCANCE de la réplica antes de desplegar:
   a) **Independiente** (recomendado para experimentar): nueva hoja de Google
      (ejecutar la función `inicializar()` del Apps Script en un script propio),
      nuevo proyecto clasp con su scriptId y su propio deployment/URL,
      y subir su propia UI a GitHub Pages (otra carpeta/repo o la que yo indique).
   b) **Compartida**: réplica que usa el MISMO servidor/hoja reales (útil solo
      para probar cambios de interfaz sin tocar la hoja).
   NO despliegues nada sin confirmar esta elección conmigo.

### 6) Reglas duras (no negociables)
- NO modifiques, borres ni renombres la carpeta original ni sus archivos.
- NO escribas ni borres datos reales de la hoja del proyecto actual. Toda prueba
  debe crear sus propios productos/ventas y limpiarlos al terminar.
- NO subas Codigo.gs/app.js a un repositorio público: el código es privado.
- Mantén la disciplina de versión: si cambias el código, sube vXX en las 3 capas
  (app.js ×3, esqueleto ×2, infoServidor) y repite el ciclo completo:
  construir (`_build_inline.ps1`), probar, desplegar con clasp y subir la UI.
- Antes de cada acción destructiva o de cualquier despliegue: confirma conmigo.
- Los tests E2E viven en `C:\Users\ROSGOD\AppData\Local\Temp\opencode\escaneo-live`
  (servidor local en :8585, `test11-tasafin.js`, `probe-tasa.js`, `test12-...`,
  y regresiones test7–test10). Si me confirmas alcance compartido, pódela usar;
  si es independiente, adapta el URL de la API en los tests a la réplica.

### 7) Para terminar
Cuando la réplica esté armada y (solo si yo lo pido) desplegada, entrégame:
- resumen de lo copiado y del estado de cada pieza,
- qué falta para dejarla lista en producción (si aplica),
- cómo levantar las pruebas localmente,
- y confirma que la carpeta original quedó intacta.

-------------------------------------------------------------------
## 📌 NOTAS PARA EL USUARIO
- El token de GitHub usado para subir la UI vive en los scripts `update_gh*.ps1`
  de `C:\Users\ROSGOD\AppData\Local\Temp\opencode\`; es revocable y el sitio no
  depende de él (si se revoca solo hay que generar uno nuevo para futuras subidas).
- Para "no mezclar historiales" basta con la carpeta copia + esta sesión nueva:
  OpenCode separa el historial por sesión, no por proyecto.