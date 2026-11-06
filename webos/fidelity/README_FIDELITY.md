# XuperTV Fidelity Port — estado real

Port de reconstrucción de XuperTV 4.34.4 para LG webOS 4.10.2-29
(Chromium 53), 1920×1080.

> Este documento describía una "Fase 1" con una maqueta inspirada en la APK.
> Ese contenido ya no refleja el proyecto y se ha sustituido. El estado real
> está aquí y en los documentos enlazados.

## Base de la reconstrucción

- APK de origen: `analysis/xuppertv/apk/Xuper.apk`, `com.xuper.netxxus`
  4.34.4 (`43404`), SHA-256
  `e70ce12782eec9f43393b69d88e2d243d8812ae38d2acf08856baa877c1ab856`.
- Layouts, drawables, mipmaps, estilos, colores, dimens y strings decodificados
  con JADX en `analysis/xuppertv/decoded/resources/`.
- Actividades analizadas: `WelcomeActivity`, `HomeActivity`,
  `LiveFreeActivity`, `VodDetailsActivity`, `VodSearchActivity`,
  `SettingActivity`.
- Reproductor Android: `IjkVideoView` + `IjkMediaPlayer` (wrappers `yc.*`); sin
  MediaDrm/Widevine/ExoPlayer detectado.
- Navegación Android: TheRouter.

## Estructura

```
webos/fidelity/
├── appinfo.json
├── index.html
├── css/style.css
├── js/app.js
├── config/api.js              modo portal / estático / backend autorizado
├── assets/original/           141 recursos de la APK por categoría
└── *.md                       documentación del port
```

El IPK que puede aparecer en esta carpeta es un artefacto **anterior**; no
contiene este código. Ver `AUDITORIA_IPK.md`.

## Implementado

- **Bienvenida** (`activity_welcome.xml`): fondo, nombre, versión `v4.99.2` y
  animación de carga de 16 fotogramas.
- **Inicio** (`activity_home.xml`): 7 pestañas con geometría XML, scrim sobre el
  pager, logo de reserva, notificaciones y mosaicos de pósters.
- **TV en vivo** (`fragment_home_live.xml`, `frag_live_channel.xml`): vídeo,
  lista de canales **real** del portal (`v6/getLiveData`, 1 000+ canales),
  panel lateral con rail de categorías, selector a pantalla completa con las 38
  columnas y filtrado real. El canal en reproducción no se corta al filtrar.
- **Gratis** (`fragment_freefragment.xml`): cabeceras live/VOD y rejilla de 6
  columnas.
- **Detalle VOD** (`activity_voddetails.xml`): panel izquierdo, ventana de
  vídeo, botones y relacionados.
- **Búsqueda** (`activity_vodsearch.xml` + teclado): teclado, populares,
  resultados y estado vacío.
- **Ajustes** (`activity_setting.xml`): 7 paneles (cuenta, mi lista, compartir,
  bloqueo, configuración global, ayuda y sobre nosotros).
- **Reproductor**: barra live y `<video>` real para VOD.
- **Series**: navegador de episodios tipo Netflix dentro del reproductor
  (temporadas a la izquierda, episodios a la derecha, `T10 E1 · Elegir`);
  elegir el episodio 6 reproduce el 6 y el detalle se sincroniza al volver.
- **Catálogo**: se carga desde el portal mediante la API/servicio en cada inicio;
  la página no usa catálogos empaquetados como respaldo. Búsqueda, detalle y
  `resolve` consultan el portal.

## Panel del reproductor y "Ajuste de reproducir"

El panel que abre la tecla **Abajo** dentro del reproductor y el diálogo
**Ajuste de reproducir** (también accesible desde `Idioma` en el detalle) se
construyen con los datos reales del portal, no con una maqueta:

- `mediaInfo` del servicio llama a `v10/startPlayVOD` + `v14/getSlbInfo` y
  devuelve `audio` (lista de idiomas del TS), `subtitles` (archivos reales),
  `tracks` (rendiciones) y `moreAudio`/`moreSubtitle`.
- El panel muestra IDIOMA (`Configuración`), RESOLUCIÓN, FORMATO DE PANTALLA,
  OPCIONES DE REPRODUCTOR y FEEDBACK; las filas sin datos se ocultan.
- RESOLUCIÓN replica el mapeo de `ud/n1.dd()`: `480p`→`480P`, `720p`→`1080P`,
  `1080p`→`4K`, con el pill `4K` sintético cuando solo existe la copia 720p.
- El diálogo abre con subtítulos **ON** y Español seleccionado cuando el portal
  devuelve archivos (comportamiento observado en la app real); la elección del
  usuario se conserva (`vodSubChosen`).
- Cambiar de idioma de audio obliga a pasar por el relay FFmpeg (`&a=<índice>`),
  porque HTML5 no puede seleccionar PIDs de audio dentro de un TS.
- **Modo fluido** es una preferencia por título: activarlo en una película no
  se hereda al abrir otra; una serie conserva el valor entre sus episodios
  (misma clave de serie).
- Los subtítulos se descargan a través del proxy local (`/sub/<token>.srt`),
  ya que el CDN no envía cabeceras CORS.

## Fidelidad

- Geometría derivada de los layouts con la regla AutoLayout
  `design_width 1920 / design_width_in_dp 1280` → **1 dp = 1.5 px**.
- Recursos originales de la APK, con inventario y procedencia
  (`INVENTARIO_RECURSOS.md`).
- Medición real en navegador y comparación documentada en
  `COMPARACION_VISUAL.md`.
- Diálogo y panel medidos contra capturas reales de Android TV (WSA
  1920×1080): caja 1145×775 en y=126, filas en y=281/406/482/592/702 y panel
  con paso de fila de 149 px.
- **No** hay comparación píxel a píxel de toda la app: no se afirma 100 % de
  fidelidad.
- Las piezas dinámicas (logo, iconos de pestaña, pósteres, QR, logos de canal)
  usan placeholder original o quedan pendientes; no se inventan.

## Pendiente

Ver `DIFERENCIAS_PENDIENTES.md`. Lo principal:

- barra VOD `MFInfoBar`,
- marquesina de botones del detalle,
- logos de marca de la franja inferior de EXPLORAR,
- diálogo de FEEDBACK del reproductor (el botón existe pero no abre nada),
- paneles Account/Purchase,
- flujo de contraseña parental,
- `LiveFreeActivity` como pantalla propia,
- reproducción directa de TS/HEVC sin relay (solo el «Modo fluido» va fluido).

## Empaquetado

Build 1.5.9 (app + servicio, con FFmpeg dentro del IPK):

```
dist/com.webosflux.xuptertv.fidelity_1.5.9_all.ipk   22 458 886 B
SHA-256 4C2690A2E450252DC7E4FEDF727B7CDA12B29DAA04CC6168FA4AA6BAD2A6352A
```

Cambios recientes:

- **1.5.9** — TV en vivo: el rail de categorías conserva el foco al filtrar,
  se desplaza solo hasta la categoría activa y **Arriba** abre un selector a
  pantalla completa con las 38 columnas del portal. Se sustituye `gap` por
  márgenes (Chromium 53 no lo soporta). OK con el panel abierto ya no reintenta
  el stream caído en lugar de activar la fila enfocada.
- **1.5.8 y anteriores** — navegador de episodios tipo Netflix, audio y
  subtítulos reales, «Modo fluido» por título, panel del reproductor.

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-ipk.ps1
```

El script ejecuta `ares-package` sobre la app **y** el servicio, y después
`tools/fix_ipk_modes.py` para dejar `ffmpeg` en 0755 (Windows guarda 0666 en el
tar). El resultado se instala en **un solo paso**; no hay que copiar el binario
aparte. FFmpeg 7.0.2 armhf estático (GPLv3) y su licencia viajan en
`usr/palm/services/com.webosflux.xuptertv.fidelity.service/`.

El ejecutable no está en git (31,8 MB). Se restaura desde el archivo
vendorizado, sin red:

```powershell
powershell -ExecutionPolicy Bypass -File tools/setup-ffmpeg.ps1
```

`build-ipk.ps1` lo llama solo si falta. SHA-256 del binario:
`0AFBA4A11110E6E402053E0FC14C33A7EB207D7A588688AE87DBA471A0F06C71`.

> Los JSON de `appinfo.json` y del servicio deben guardarse **sin BOM**: el
> Node 0.12 del televisor falla con `Unexpected token` y el servicio no
> arranca. `Set-Content -Encoding UTF8` de PowerShell 5.1 añade BOM; usar
> `UTF8Encoding($false)`.

Instalación en la TV de pruebas (`ares-install` falla en este equipo tras la
subida; el servicio Luna sí instala):

```powershell
node tools\tv_deploy.mjs dist\com.webosflux.xuptertv.fidelity_1.5.9_all.ipk
```

Contiene la app, sus recursos originales y el servicio Node. Excluye capturas,
documentación y el IPK antiguo. No empaqueta catálogos ni pósteres de muestra.

No es una release final: sigue pendiente `MFInfoBar`, la marquesina, la
contraseña parental, los paneles Account/Purchase y la comparación con
referencia visual. Ver `PLAN_CORRECCION.md` (fases 1–5).

## Documentos

- `MAPA_PANTALLAS.md`
- `COMPARACION_VISUAL.md`
- `DIFERENCIAS_PENDIENTES.md`
- `PLAN_CORRECCION.md`
- `INVENTARIO_RECURSOS.md`
- `INTEGRACION_PELICULAS.md`
- `AUDITORIA_IPK.md`
- `player.md`
- `FASE4_PRUEBAS.md`
