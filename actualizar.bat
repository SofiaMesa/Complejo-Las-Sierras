@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo =============================
echo  SUBIENDO CAMBIOS A GITHUB...
echo =============================

git add -A
git commit -m "Actualizacion automatica desde script"

rem Trae primero los cambios que haya en GitHub para evitar rechazos al subir
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo ERROR: no se pudieron traer los cambios de GitHub. Revisa los mensajes de arriba.
  pause
  exit /b 1
)

git push origin main
if errorlevel 1 (
  echo.
  echo ERROR: no se pudo subir. Revisa tu conexion a internet o tus credenciales de GitHub.
  pause
  exit /b 1
)

echo =============================
echo      LISTO! Sitio subido.
echo =============================
pause
