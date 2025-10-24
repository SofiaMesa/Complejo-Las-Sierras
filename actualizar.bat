@echo off
echo =============================
echo  SUBIENDO CAMBIOS A GITHUB...
echo =============================

git add .
git commit -m "Actualizacion automatica desde script"
git push origin main

echo =============================
echo      ¡LISTO! ✅ Sitio subido.
echo =============================
pause
