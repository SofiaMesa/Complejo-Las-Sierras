# Conectar el formulario de reservas con Google Sheets

Guía paso a paso para que cada solicitud enviada desde
`complejolassierras.com/reserva.html` se guarde como una **fila nueva** en la planilla:

https://docs.google.com/spreadsheets/d/1gR65kacWQUSL1XJBRGj_l9oFHcVRvEW7qxmdVCOsiGw/edit#gid=0

> Esta carpeta (`_integracion-google`) **no se publica** en la web: GitHub Pages
> ignora las carpetas que empiezan con guion bajo. Podés subirla al repositorio sin problema.

## Cómo funciona

```
Formulario web ──(valida)──► Google Apps Script ──(valida de nuevo)──► Nueva fila en la planilla
      ▲                                  │
      └──── confirmación en pantalla ◄───┘   + email de aviso a lassierrascamping@gmail.com
```

- La web no guarda contraseñas ni claves: solo conoce la URL pública del script.
- El script revisa todos los datos antes de guardarlos. Además:
  - frena envíos automáticos (bots);
  - evita filas duplicadas si alguien toca "Enviar" dos veces;
  - limita la cantidad de envíos por hora.
- Las columnas se buscan **por nombre** en la fila 1, así que podés moverlas o
  agregar columnas propias (por ejemplo, "Estado") sin romper nada.

Tiempo estimado: **15 minutos**. Usá la cuenta de Google dueña de la planilla.

---

## Paso 1 · Desvincular el Formulario de Google viejo

La planilla todavía está vinculada a un Formulario de Google que ya no usás. Conviene
desvincularlo para que no interfiera con las filas nuevas:

1. Abrí la planilla.
2. En el menú de arriba, entrá en **Formularios** (o **Formulario**) → **Desvincular formulario**.
3. Confirmá. Los datos que ya están en la hoja **no se borran**.

> Si no ves la opción **Desvincular formulario**, la planilla ya no está vinculada y podés seguir.

## Paso 2 · Crear el script

1. En la planilla, andá a **Extensiones → Apps Script**. Se abre el editor en otra pestaña.
2. Arriba a la izquierda, hacé clic en "Proyecto sin título" y ponele de nombre
   **Reservas web Las Sierras**.
3. A la izquierda vas a ver el archivo **Código.gs**. Borrá todo su contenido.
4. Abrí el archivo **`Code.gs`** de esta carpeta, copiá **todo** y pegalo en el editor.
5. Guardá con **Ctrl + S** (o el ícono del disquete).

**Opcional, recomendado:** en el engranaje **⚙ Configuración del proyecto**, elegí la
zona horaria **(GMT-03:00) Buenos Aires**.

## Paso 3 · Dar permisos y probar

1. Arriba, en el desplegable de funciones, elegí **`verificarConfiguracion`** y tocá **▶ Ejecutar**.
2. Google te va a pedir permisos:
   1. **Revisar permisos** → elegí tu cuenta.
   2. Si aparece *"Google no verificó esta app"*, tocá **Configuración avanzada** → **Ir a Reservas web Las Sierras (no seguro)**.
      Es normal: la app la creaste vos y solo la usás vos.
   3. Tocá **Permitir**. El script pide acceso a tus planillas (para agregar filas) y permiso para enviar emails (para el aviso de cada solicitud nueva).
3. Abajo, en el **Registro de ejecución**, tenés que ver las 10 columnas con ✓.
   Si alguna dice ✗ FALTA, revisá que el nombre en la fila 1 de la planilla sea
   igual. Si no la corregís, el script crea esa columna al final de la fila 1.
4. Ahora elegí **`probarSolicitud`** y tocá **▶ Ejecutar**.
   - En la planilla tiene que aparecer una fila nueva a nombre de **"PRUEBA Borrar Esta Fila"**.
   - En `lassierrascamping@gmail.com` tiene que llegar el email de aviso (revisá Spam).
   - **Borrá esa fila de prueba** de la planilla.

## Paso 4 · Publicar el script como aplicación web

1. Arriba a la derecha: **Implementar → Nueva implementación**.
2. En **Seleccionar tipo** (ícono ⚙), elegí **Aplicación web**.
3. Completá:
   - **Descripción:** `Formulario de reservas v1`
   - **Ejecutar como:** **Yo** (tu cuenta)
   - **Quién tiene acceso:** **Cualquier usuario** ⚠️ *(no "Cualquier usuario con cuenta de Google")*
4. Tocá **Implementar** y copiá la **URL de la aplicación web**. Tiene esta forma:
   `https://script.google.com/macros/s/AKfy…larguísimo…/exec`
5. Pegá esa URL en una pestaña nueva del navegador. Tenés que ver:
   `{"ok":true,"service":"reservas-complejo-las-sierras","status":"online"}`

## Paso 5 · Conectar la web

1. En la carpeta de la web, abrí **`config.js`** con el Bloc de notas o VS Code.
2. Reemplazá `PEGAR_AQUI_LA_URL_DE_APPS_SCRIPT` por la URL que copiaste
   (dejá las comillas simples):

   ```js
   reservasEndpoint: 'https://script.google.com/macros/s/AKfy.../exec',
   ```
3. Guardá el archivo.
4. Ejecutá **`actualizar.bat`** para subir los cambios a GitHub.
   GitHub Pages tarda entre 1 y 3 minutos en publicar.

## Paso 6 · Prueba final en la web real

1. Entrá a https://complejolassierras.com/reserva.html (si no ves los cambios, recargá con **Ctrl + F5**).
2. Completá una solicitud de prueba con tus datos y envíala.
3. Tenés que ver **"¡Solicitud de reserva recibida correctamente!"**.
4. Confirmá que apareció la fila en la planilla y que llegó el email. Después borrá esa fila.

¡Listo! El formulario ya funciona de punta a punta.

---

## Cambios futuros en el script

Si modificás `Code.gs` (por ejemplo, para agregar una unidad nueva):

1. Pegá el código nuevo y guardá.
2. **Implementar → Gestionar implementaciones** → ✏️ **Editar** →
   en **Versión** elegí **Nueva versión** → **Implementar**.

Así la URL **no cambia** y no hace falta tocar `config.js`.
Si en cambio hacés otra "Nueva implementación", se genera una URL distinta y tenés que actualizarla en `config.js`.

### Agregar o renombrar una unidad

Hay que cambiarla en **tres lugares** con la misma clave (por ejemplo `cabana-familiar`):

1. `Code.gs` → objeto `UNITS` (el texto de la derecha es lo que se guarda en la planilla).
2. `reserva.html` → lista `<select id="f-unidad">`.
3. `index.html` → lista `<select id="qb-unidad">` del buscador rápido.

### Otras opciones de `Code.gs` (bloque `CONFIG`)

| Opción | Para qué sirve |
|---|---|
| `NOTIFY_EMAIL` | Email que recibe el aviso de cada solicitud. Dejalo en `''` para no recibir avisos. |
| `SEND_GUEST_CONFIRMATION` | Si lo ponés en `true`, el huésped recibe un email automático de "recibimos tu solicitud". |
| `MAX_GUESTS`, `MAX_NIGHTS`, `MAX_DAYS_AHEAD` | Límites de huéspedes, noches y anticipación. Si los cambiás, cambialos también en `config.js`. |
| `MAX_PER_EMAIL_PER_HOUR`, `MAX_TOTAL_PER_HOUR` | Límites contra envíos masivos. |

---

## Si algo no funciona

| Qué pasa | Causa probable | Solución |
|---|---|---|
| La web dice *"El formulario no está disponible en este momento"* | Falta la URL en `config.js` o está mal copiada | Revisá el paso 5: la URL tiene que terminar en `/exec`. |
| La web dice *"No pudimos enviar tu solicitud"* (problema de conexión) | El acceso no es "Cualquier usuario", o la URL es la de prueba (`/dev`) | Paso 4: revisá **Quién tiene acceso** en *Gestionar implementaciones*. |
| La web dice *"No pudimos confirmar el envío"* | El script tiene un error o no se volvió a publicar tras un cambio | En Apps Script, mirá **Ejecuciones** (ícono ☰ a la izquierda) y publicá una **Nueva versión**. |
| No aparecen filas nuevas | Pestaña equivocada | En `Code.gs`, `SHEET_GID` tiene que coincidir con el número `#gid=` de la URL de la pestaña. |
| No llegan los emails | Filtro de spam o límite diario de Gmail (100 por día) | Revisá Spam. Las filas se guardan igual aunque falle el email. |
| Las fechas se ven como números | Formato de la columna | Seleccioná la columna → **Formato → Número → Fecha**. |
| Cuenta de Google Workspace (empresa) | La organización puede bloquear "Cualquier usuario" | Usá una cuenta de Gmail personal o pedí al administrador que lo habilite. |

### Scripts viejos

La web anterior usaba dos Apps Script distintos (reservas y contacto). La web nueva
**ya no los usa**. Cuando la integración nueva esté funcionando, podés archivar esas
implementaciones desde *Implementar → Gestionar implementaciones* en cada proyecto viejo.

---

# Mantenimiento del sitio

## Estructura

```
index.html            Inicio (con buscador rápido que lleva al formulario)
cabanas.html          Cabañas
bungalows.html        Bungalows
acampe.html           Acampe
contacto.html         Contacto + preguntas frecuentes
reserva.html          Formulario de solicitud de reserva
404.html              Página de error "no encontrada"
style.css             Todos los estilos (colores y tipografías al principio)
script.js             Menú, carruseles, galería y buscador rápido
formulario-reserva.js Validación y envío del formulario
config.js             ← URL del Apps Script y número de WhatsApp
img/fotos/            Fotos optimizadas (WebP) que usa la web
img/marca/            Logo, íconos e imagen para compartir en redes
_integracion-google/  Apps Script + estas instrucciones (no se publica)
```

## Tareas frecuentes

- **Cambiar el menú o el footer:** el header y el footer están escritos directamente
  en cada página (sin archivos externos, para que la web cargue más rápido y funcione aunque falle JavaScript).
  Si cambiás un enlace, hacelo en las 7 páginas `.html`. Tip: en VS Code usá
  *Buscar y reemplazar en archivos* (Ctrl + Shift + H).
- **Cambiar el número de WhatsApp:** buscá y reemplazá `5491160248224` en todos los archivos
  (incluido `config.js` y `Code.gs`), y `+54 9 11 6024-8224` en los `.html`.
- **Agregar fotos:** exportalas en formato **WebP** en dos tamaños (600 y 1000 px de ancho
  para fotos verticales; 800 y 1600 para horizontales) con nombres sin espacios ni tildes,
  y guardalas en `img/fotos/`. Herramienta gratuita: https://squoosh.app
- **Ver los cambios de CSS/JS en celulares que ya visitaron la web:** los archivos se
  cargan con `?v=20260915`. Si cambiás `style.css` o un `.js`, cambiá ese número en las páginas.

## Archivos que ya no se usan

Podés borrar estos archivos. La web nueva no los necesita:

- `header.html`
- `footer.html`
- `includes.js`
- `partial-formulario.html`

La carpeta `img/` conserva las fotos originales. La web usa solo las versiones optimizadas
de `img/fotos/` y `img/marca/`, así que las originales podés guardarlas como respaldo.
