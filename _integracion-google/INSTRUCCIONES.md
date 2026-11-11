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

## Cotización automática (tarifas)

Cada solicitud nueva se guarda con la cotización calculada y el email de aviso la incluye.

**Cómo se calcula** (con los valores de la pestaña **Tarifas** de la planilla):

- **Tarifa por noche** = tarifa hasta 3 personas + adicional por cada persona extra. Con 1 o 2 personas se paga lo mismo que con 3.
- **Promo 7x5:** cada 7 noches completas se pagan 5, y las noches que sobran se cobran a tarifa normal. Ejemplos: 7 noches → se pagan 5; 10 noches → 8; 14 noches → 10. Con 6 noches se pagan las 6.
- **Total** = tarifa por noche × noches a pagar.
- **Seña** = 30 % del total.
- **Más de 6 personas:** no se calcula automáticamente y en la planilla aparece "cotizar aparte".
- **"Sin preferencia":** el email y el mensaje de WhatsApp incluyen el precio de todas las unidades.

**Columnas que se agregan a la planilla:** Noches · Tarifa por noche · Noches a pagar · Total estimado · Seña · Enviar cotización.
La última es un enlace: al tocarlo se abre WhatsApp con el mensaje para el huésped ya escrito.
**Revisá la disponibilidad antes de enviarlo.**

### Instalación (una sola vez)

1. Pegá el código nuevo de `CODIGO-PARA-COPIAR.txt` en Apps Script, igual que la primera vez, y guardá con Ctrl + S.
2. Elegí la función **`prepararTarifas`** y tocá **▶ Ejecutar**. Si te vuelve a pedir permisos, aceptalos.
   Se crea la pestaña **Tarifas** con los precios iniciales y se agregan las columnas nuevas.
3. **Implementar → Gestionar implementaciones → ✏️ Editar → Versión: Nueva versión → Implementar.**
   Sin este paso, la web sigue usando el código anterior. La dirección del script no cambia.
4. Recargá la planilla (F5): arriba aparece el menú **Las Sierras**.

### Cambiar precios

Editá los números de la pestaña **Tarifas**. No modifiques la columna **Clave**.
Los precios nuevos se usan en las solicitudes que lleguen desde ese momento.
Para desactivar la promo, poné **7** en "Promo: cada 7 noches se pagan".

### Recalcular una solicitud

Si cambiaste a mano las fechas, la unidad o la cantidad de personas de una fila (o querés cotizar solicitudes viejas):
seleccioná esas filas y entrá a **Las Sierras → Recalcular cotización de las filas seleccionadas**.

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

---

## Enviar la reserva con los datos para la seña (WhatsApp y mail)

Cuando el huésped confirma que quiere reservar, le mandás los datos de la reserva y de la cuenta para la seña.

1. En la pestaña de solicitudes, hacé clic en cualquier celda de la fila del huésped.
2. Menú **Las Sierras → 1) Enviar reserva y datos para la seña (fila seleccionada)**.
3. Se abre una ventana con todo precargado. Podés corregir **unidad** (obligatorio si pidió "Sin preferencia"), **personas**, **total**, **seña**, **vencimiento de la seña** (por defecto, 48 hs desde que abrís la ventana), WhatsApp y email.
   - Si cambiás la unidad o las personas, el total y la seña se recalculan con la pestaña **Tarifas**.
   - Si cambiás el total a mano, la seña se recalcula al 30 %; también la podés escribir a mano.
4. Revisá la **vista previa** (pestañas WhatsApp y mail) y elegí:
   - **Enviar por WhatsApp:** abre WhatsApp con el mensaje escrito; lo enviás vos desde ahí.
   - **Enviar por mail:** tocá dos veces (la segunda confirma). El mail sale con el nombre "Complejo Las Sierras", con copia oculta a lassierrascamping@gmail.com y, si el huésped responde, la respuesta llega a ese correo.
5. Cada envío queda anotado en las columnas **Reserva enviada** (canal, fecha y hora) y **Vence la seña**. Se crean solas la primera vez.

El mail sale desde la cuenta de Google de quien usa el menú. Conviene usarlo con la cuenta del complejo.

**Instalación:** pegá el código nuevo de `CODIGO-PARA-COPIAR.txt`, guardá (Ctrl + S) y recargá la planilla (F5). La primera vez que uses la opción, Google pide permiso para mostrar ventanas en la planilla: aceptalo. Este cambio no afecta a la web, pero si querés mantener todo al día hacé igual **Implementar → Gestionar implementaciones → Editar → Nueva versión**.

**Textos editables** (al final de `Code.gs`): `CUENTA_SENA` (datos bancarios), `PLAZO_SENA_HORAS` y `POLITICA_CANCELACION`.

## Confirmar la reserva cuando llega la seña

Cuando verificás en el homebanking que la seña se acreditó:

1. Hacé clic en la fila del huésped.
2. Menú **Las Sierras → 2) Enviar confirmación de reserva: seña recibida (fila seleccionada)**.
3. Revisá la unidad, las personas, el total y la **seña recibida**. Si recibiste otro importe, corregilo: el saldo se recalcula.
4. Elegí **Enviar confirmación por WhatsApp** y/o **Enviar confirmación por mail**.
5. Queda anotado en la columna **Confirmación enviada** (canal, fecha, hora e importe de la seña).

Si en la fila no figura que se enviaron los datos para la seña, la ventana muestra un aviso para que lo verifiques antes de confirmar.

## Columna Estado (automática)

- **No enviada:** llegó la solicitud y todavía no se mandaron los datos para la seña.
- **Enviada:** se mandaron los datos para la seña (paso 1).
- **Confirmada:** se recibió la seña y se mandó la confirmación (paso 2).

Se usa la columna **Estado** (o **Status**) que ya tengas. Si no existe, se crea una con lista desplegable y colores (gris, amarillo y verde).
Una reserva confirmada no vuelve a "Enviada" aunque reenvíes los datos de la seña.

Para completar las filas que ya tenías: menú **Las Sierras → Actualizar la columna Estado de todas las filas**. Los estados escritos a mano que no sean estos tres (por ejemplo, "Cancelada") no se tocan.

Si tu columna tiene una lista desplegable con otras opciones, agregale "No enviada", "Enviada" y "Confirmada" (clic derecho en la columna → Validación de datos).
