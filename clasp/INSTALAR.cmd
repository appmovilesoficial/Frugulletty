@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   MAKEUPKARELYS - Instalador automatico
echo   Crea: hoja de calculo + proyecto + URL de la app
echo ============================================================
echo.

rem ---------- 1) Buscar Node.js ----------
set "NODE_FOUND="
set "NODE_DIR="
where node >nul 2>nul
if not errorlevel 1 set "NODE_FOUND=si"
if not defined NODE_FOUND if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"
if not defined NODE_FOUND if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles%\nodejs"
if not defined NODE_FOUND if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles(x86)%\nodejs"
if not defined NODE_FOUND if exist "%APPDATA%\nvm\node.exe" set "NODE_DIR=%APPDATA%\nvm"
if not defined NODE_FOUND if defined NODE_DIR set "NODE_FOUND=disco"

if defined NODE_FOUND goto node_listo

echo  [ERROR] No se encuentra Node.js en este equipo.
echo.
echo  DIAGNOSTICO - copia esto y mandalo si el error se repite:
echo.
echo   LOCALAPPDATA = %LOCALAPPDATA%
echo   ProgramFiles = %ProgramFiles%
echo   APPDATA      = %APPDATA%
echo.
echo   Rutas que revise:
echo    %LOCALAPPDATA%\Programs\nodejs\node.exe
echo    %ProgramFiles%\nodejs\node.exe
echo    %ProgramFiles(x86)%\nodejs\node.exe
echo    %APPDATA%\nvm\node.exe
echo.
echo  Soluciones rapidas:
echo   1. Descarga Node.js en https://nodejs.org  version LTS
echo      e instalalo. Luego reinicia la PC y vuelve a ejecutar.
echo   2. O abre PowerShell desde el menu Inicio, escribe:
echo        cd "%CD%"
echo      y luego:
echo        .\INSTALAR.cmd
pause
exit /b 1

:node_listo
if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"
for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo  Node.js listo: %NODE_VER%
echo.

echo  [PASO 1 de 6] Activar la API de Apps Script
echo.
echo   IMPORTANTE: en tu navegador abre esta pagina y activa
echo   la opcion "Google Apps Script API" - el interruptor superior:
echo.
echo       https://script.google.com/home/usersettings
echo.
echo   Cuando lo hagas, presiona una tecla para continuar...
pause >nul
echo.

echo  [PASO 2 de 6] Login con tu cuenta de Google
echo   Va a aparecer una URL larga en la consola.
echo   Debes copiarla, abrirla en tu navegador, iniciar sesion,
echo   aceptar los permisos, copiar el CODIGO que te muestre
echo   y pegarlo aqui. Al final presiona Enter.
call npx -y @google/clasp login --no-localhost
if errorlevel 1 goto error_login
echo.
echo  Login OK
echo.
goto paso3

:error_login
echo.
echo  [ERROR] El login no se completo. Revisa que hayas
echo        activado la API en el paso 1 y vuelve a intentar.
pause
exit /b 1

:paso3
echo  [PASO 3 de 6] Creando hoja de calculo + proyecto en tu Drive
call npx -y @google/clasp create-script --type sheets --title "MakeupKarelys"
if errorlevel 1 goto error_crear
echo.
echo  Proyecto creado. Si te pregunta algo por consola, responde "y".
echo  Restaurando la configuracion correcta de la app...
copy /y appsscript.correcto.json appsscript.json >nul
echo.
goto paso4

:error_crear
echo.
echo  [ERROR] No se pudo crear el proyecto.
echo   Copia este texto y mandalo para revisarlo.
pause
exit /b 1

:paso4
echo  [PASO 4 de 6] Subiendo el codigo de la aplicacion
echo y| call npx -y @google/clasp push -f
if errorlevel 1 goto error_subir
echo.
echo  Codigo subido OK
echo.
goto paso5

:error_subir
echo.
echo  [ERROR] No se pudo subir el codigo.
echo   Copia este texto y mandalo para revisarlo.
pause
exit /b 1

:paso5
echo  [PASO 5 de 6] Creando la aplicacion web - URL publica
echo y| call npx -y @google/clasp create-deployment --description "version 1"
if errorlevel 1 goto aviso5
echo.
echo  Aplicacion web creada - tu URL quedo arriba.
echo.
goto paso6

:aviso5
echo.
echo  [AVISO] El paso 5 no genero la URL. No te preocupes:
echo         lo crearemos en el paso 6 desde el editor.
echo.

:paso6
echo  [PASO 6 de 6] Abriendo el editor de Apps Script
echo   Ahi haras el ultimo paso manual - el administrador.
call npx -y @google/clasp open-script

echo.
echo ============================================================
echo   CASI LISTO. FALTA UN UNICO PASO MANUAL:
echo.
echo   1. En el editor, arriba elige la funcion:  inicializar
echo   2. Teclea los dos argumentos:
echo        adminUsuario  =  "admin"
echo        adminPassword =  "TuClaveFuerte2026"
echo   3. Presiona EJECUTAR y acepta los permisos de Google.
echo   4. Cuando te diga "Listo", cierra la hoja.
echo   5. Si el paso 5 no genero la URL, hazlo aqui:
echo        - Boton IMPLEMENTAR - Nueva implementacion
echo        - Tipo: Aplicacion web
echo        - Ejecutar como: Yo
echo        - Acceso: Cualquier persona
echo        - Copia la URL y abrela en tu telefono o PC.
echo.
echo   La hoja de calculo "MakeupKarelys" estara en tu Drive
echo   con todas las pestanas ya creadas.
echo ============================================================
pause