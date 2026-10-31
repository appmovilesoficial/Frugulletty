# 🚀 Instalación automatizada con clasp

Este archivo convierte los 4 archivos de la carpeta en un **proyecto de Apps Script** con su **hoja de cálculo** en tu Google Drive, y genera la **URL de la aplicación web**.

## Qué necesitas (una sola vez)

1. **Node.js** (ya lo tienes: v24.19 ✓). Si alguien más lo necesita: https://nodejs.org
2. Tu cuenta de Google (la misma donde quieres los datos).

## Cómo ejecutarlo

Doble clic en `INSTALAR.cmd` (Windows). El instalador hará lo siguiente:

| Paso | Qué hace |
|---|---|
| 1/6 | Te recuerda **activar la API de Apps Script** en https://script.google.com/home/usersettings (interruptor superior) |
| 2/6 | `clasp login` → abre el navegador, elige tu cuenta y acepta |
| 3/6 | `clasp create-script --type sheets` → **crea la hoja "MakeupKarelys" en tu Drive** y le vincula el proyecto |
| 4/6 | `clasp push -f` → sube `Codigo.gs`, `Index.html`, `appsscript.json` (`Index.html` trae estilos y lógica incluidos) |
| 5/6 | `clasp create-deployment` → genera la **URL pública** de la app |
| 6/6 | `clasp open-script` → abre el editor para el último paso |

## El ÚNICO paso manual (2 minutos)

Al final, en el editor abierto:

1. Selecciona la función **`inicializar`** en el desplegable de arriba.
2. Botón **Ejecutar** ▶️ (no pide argumentos: crea `admin` con la clave `TuClaveFuerte2026`).
3. Acepta los permisos que pida Google.
4. Dentro de la app: **Ajustes → Cambiar mi contraseña** para poner tu clave personal.
4. Si el paso 5 no generó la URL (por ejemplo porque faltaba autorización):
   - Botón **Implementar → Nueva implementación → Aplicación web**
   - *Ejecutar como:* **Yo** · *Quién tiene acceso:* **Cualquier persona**
   - Copia la URL.

## Después

- La hoja **"MakeupKarelys"** queda en tu Drive con las pestañas ya creadas.
- Entra a la URL desde tu teléfono o PC con `admin` y tu contraseña.
- Crea usuarios para tus empleados en **Ajustes → Usuarios**.

## Comandos sueltos (si quieres hacerlo a mano)

```sh
npm i -g @google/clasp          # o usa npx -y @google/clasp
clasp login                     # login con tu Google
clasp create-script --type sheets --title "MakeupKarelys"
clasp push -f
clasp create-deployment --description "v1"
clasp open-script
```

## Actualizar la app después (si cambias el código)

1. Regenera `Index.html`: ejecuta `_build_inline.ps1` desde la carpeta `clasp`
   (arma la página con `app.js` y `styles.css` ya incluidos).
2. Sube y crea una URL nueva:
   ```sh
   echo y| npx -y @google/clasp push
   echo y| npx -y @google/clasp create-deployment --description "vN"
   ```
3. Cada implementación genera una **URL nueva** — esa es la que se usa
   (la anterior queda intacta con la versión anterior).

> Nota: requiere activar la API de Apps Script en https://script.google.com/home/usersettings
> y una versión de Node ≥ 22 (tú tienes la 24.19 ✓).