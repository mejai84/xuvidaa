# Diferencias y pendientes

Registro de todo lo que **no** está cerrado, con su motivo y la condición para
darlo por resuelto. Se separa lo que depende de una referencia visual de lo que
depende de implementación y de lo que está bloqueado por factores externos.

Estados:

- **Pendiente de referencia visual** — no hay captura verificable de Android TV.
- **Pendiente de implementación** — el layout se conoce, falta el código.
- **Bloqueado** — depende de autorización, red o del televisor.
- **Documentado** — diferencia consciente, con evidencia; no se va a "arreglar".

---

## A. Fidelidad visual pendiente de referencia

| ID | Pantalla | Diferencia | Motivo | Cómo cerrarla |
| --- | --- | --- | --- | --- |
| A1 | Todas | Comparación píxel a píxel global | **Parcial:** capturadas las pantallas de referencia reales en WSA 1920×1080 (`scratch/xuper-*.png`, `ui-*.xml`). El panel del reproductor y el diálogo *Ajuste de reproducir* ya coinciden en geometría; el resto de pantallas sigue sin comparación completa | Capturar el resto de pantallas y comparar a 1920×1080 |
| A2 | Todas | Métrica tipográfica distinta | La APK usa `sans-serif` del sistema Android; el port usa `Roboto, Helvetica, Arial` | Igualar con una fuente métricamente compatible o aceptar la diferencia tras la referencia A1 |
| A3 | Bienvenida | Altura de las cajas de nombre/versión | `wrap_content` depende de la fuente; el port fija `line-height` | Ajustar tras A1/A2 |
| A4 | Inicio | Logo de la home | Es dinámico; los hijos estáticos están `gone` | Usar el logo real del backend o confirmar el fallback con A1 |
| A5 | Inicio | Iconos de pestaña | Se generan en runtime (`xa.l.d(context, title)`) | Recursos del backend o captura de referencia |
| A6 | Inicio | Orden y número de pestañas | Lo define el backend | Catálogo autorizado |
| A7 | Inicio | Pósteres y fondos | Contenido del backend | Catálogo autorizado |
| A8 | Inicio | Logos de canal y datos live | **Resuelto:** `v6/getLiveData` entrega nombre, logo y EPG de los canales reales (1 000+), con 38 categorías | — |
| A9 | Inicio | Etiqueta de la entrada *Perfil* | El layout no muestra texto estático para esa entrada | Referencia visual |
| A10 | Detalle | Marquesina del texto de los botones | `MarqueTextView`/`marquee` no se anima en el port | Implementar animación CSS o confirmar que no se ve en la referencia |
| A11 | Detalle | Lista de episodios/temporadas | **Resuelto (desviación consciente):** el detalle conserva temporada + grupos de episodios; el reproductor abre un navegador tipo Netflix a pantalla completa en lugar de las píldoras apretadas del panel original | — |
| A12 | Detalle | Aviso de suscripción (`mLayoutNotice`) | Está `gone` en el XML | Solo si el backend lo activa |
| A13 | Búsqueda | Barra de navegación y filtros | Fuera del alcance de esta pasada | `layout_vod_search_result.xml` completo |
| A14 | Búsqueda | Búsqueda de canales en vivo | Fuera de alcance | `fragment_search_live.xml` |
| A15 | Ajustes | Paneles *Account* y *Purchase* | Dependen de sesión y recursos servidos | `fragment_account.xml`, `fragment_purchase.xml` + backend autorizado |
| A16 | Ajustes | QR de feedback | Lo sirve el backend; no hay bitmap | Endpoint autorizado |
| A17 | Ajustes | Indicador de opción a `left:16px` | El XML lo centra; se movió para no tapar el texto de 255 px | Confirmar con A1 y, si procede, volver al centrado |
| A18 | Reproductor | Barra VOD real (`MFInfoBar`) | El port reutiliza la barra live | Reconstruir `layout_mf_infobar.xml` |
| A19 | Reproductor | Etiqueta del botón de cambio de reproductor | Es dinámica; se usa *Reproductor 1* | Referencia o backend |
| A20 | Reproductor | Superficie de vídeo en capturas headless | No hay fotograma decodificado en headless | Probar en el televisor |
| A21 | Inicio | Aviso de texto `mTextNotice` | Está `gone` y lo activa el backend | Fuente de avisos autorizada |
| A22 | Reproductor | Tiempo de auto-ocultado de la barra | El recurso no expone la constante; el port usa 5 s | Medir en la app real y ajustar |
| A23 | Reproductor | Diálogo de FEEDBACK | El botón existe y es enfocable, pero no abre nada. La APK real usa un diálogo de 920×784 con motivos y envío | Reconstruir `dialog_feedback*.xml` y su envío |
| A24 | Inicio | Franja de logos de marca en EXPLORAR | Los logos no están en la APK; se muestran tiles grises | Recursos del backend o captura de referencia |

---

## B. Funcionalidad pendiente de implementación

| ID | Área | Qué falta | Estado actual | Cómo cerrarlo |
| --- | --- | --- | --- | --- |
| B1 | Control parental | Captura numérica y validación de los 4 dígitos | Cajas dibujadas; `_activate` vacío | Implementar teclado/entrada y reglas del backend |
| B2 | Control parental | Diálogo de cambio de contraseña | Botón sin destino | `dialog_password_setting.xml` / `dialog_modify_parent_pwd.xml` |
| B3 | Contenido adulto | Persistencia del interruptor | Cambia en memoria | Guardar estado y aplicar bloqueo |
| B4 | Feedback | Centro de ayuda | Enlace sin destino | `fragment_aboutus.xml` / web autorizada |
| B5 | Actualización | Comprobación de versión y descarga | Solo UI | Endpoint de upgrade |
| B6 | Actualización | Borrado de caché | Botón sin efecto | API de almacenamiento de webOS |
| B7 | Búsqueda | Teclado numérico completo | Alterna etiquetas | Completar mapa de teclas |
| B8 | Búsqueda | Filtros por categoría | Chips sin destino | `activity_filter.xml` |
| B9 | Detalle | Chips de género / director / actores | Enfocables sin destino | `activity_vodcategory.xml`, `activity_actor_details.xml` |
| B10 | Inicio | PARTIDOS / Match* | Excluido | `activity_match*.xml` |
| B11 | Inicio | `LiveFreeActivity` como pantalla propia | Solo se reconstruyó la rejilla gratis | Identificar el fragmento hijo de `activity_live.xml` |
| B12 | Navegación | Historial real (back multinivel) | Back simple por pantalla | Modelo de pila equivalente a TheRouter |

---

## C. Diferencias documentadas (no son fallos)

| ID | Diferencia | Evidencia | Por qué se mantiene |
| --- | --- | --- | --- |
| C1 | Etiquetas de acción del reproductor se solapan | `layout_live_infobar.xml` usa cajas de `67dp/90dp` con textos largos | Es el comportamiento real del layout; se recorta igual que un TextView |
| C2 | Foco de póster con escala `1.05` y trazo azul interior | `wd.a` + `xa.b` en `PosterView` | Reproduce el `dispatchDraw()` real |
| C3 | Ítems gratis/búsqueda/relacionados sin escala y con borde dorado | `sel_poster_nohalo` + `poster_focus_nohalo.9.png` | Selector original distinto al de la home |
| C4 | Títulos de póster ocultos salvo al enfocar | `view_poster.xml` | Comportamiento del `PosterView` |
| C5 | Pestañas superpuestas al arte | `mGridTabBg` se dibuja sobre el pager | Verificado con sonda de píxeles |
| C6 | Interacción live: Arriba/Abajo cambia de canal; Derecha va al primer botón rápido | No hay referencia de vídeo | **Pendiente de referencia** (se documenta como suposición) |
| C7 | El nombre del canal live va a la derecha | `layout_toLeftOf` del icono de pantalla completa | Corregido en esta pasada |
| C8 | Barra VOD oculta *ahora/después* | No aplica a VOD | Coherente con el contenido |
| C9 | Gradiente Android `angle=315` → CSS `135deg` | Conversión geométrica estándar | Equivalencia de ángulo |

---

## D. Bloqueos externos

| ID | Bloqueo | Detalle | Qué haría falta |
| --- | --- | --- | --- |
| D1 | Catálogo real de XuperTV | El protocolo Magis (`portalCore`, 3DES) carga las seis raíces desde el servicio. El cliente HTML no debe usar un snapshot empaquetado. | El portal debe aceptar la sesión desde el servidor configurado. |
| D2 | Extracción de sesión/tokens | Prohibido por las reglas del proyecto | No se hará |
| D3 | Interceptación TLS | Prohibida | No se hará |
| D4 | Instalación en el LG 43LM6300PDB | **Resuelto:** `ares-install` falla en el paso `ls` posterior a la subida, pero el servicio Luna `com.webos.appInstallService/dev/install` instala correctamente | Usar `tools/tv_deploy.mjs` (subida SFTP + instalación Luna) |
| D5 | Pruebas de códec/HLS en webOS 4 | **Resuelto:** H.264 directo; HEVC/TS con tirones en el camino nativo, fluido al remuxear a MP4 fragmentado. TV en vivo reproduce HLS real del portal | Validar casos 4K y cambios de audio en vivo |
| D6 | IPK | **Resuelto:** `dist/com.webosflux.xuptertv.fidelity_1.5.9_all.ipk` incluye app + servicio + FFmpeg 7.0.2 armhf y se instala en un paso | Cerrar A/B pendientes antes de publicar como release |

---

## I. Resuelto en 1.5.9

| ID | Qué | Evidencia |
| --- | --- | --- |
| G10 | TV en vivo: rail de categorías navegable. Filtrar ya no reconstruye las 39 píldoras (que dejaban el foco fuera del DOM) | `renderPlayerCategories` reutiliza nodos, conserva el foco por id y desplaza la píldora activa; sonda `scratch/probe-live-nav.mjs` (`OK-CAT-FOCUS inDom:true`, 105 canales de Deportes) |
| G11 | Selector a pantalla completa con las 38 columnas del portal (Arriba en el rail) | `#player-categories` + `renderCategoryPicker`; sonda: 39 tiles, grid con scroll y filtrado a «Chile» (38 canales) |
| G12 | OK con el panel abierto activa la fila/píldora enfocada aunque el canal actual esté caído | El reintento de stream queda limitado a la superficie de vídeo (`!closest(state.focus, '.player-channels')`) |
| G13 | Chromium 53: se sustituye `gap` por `margin-right` en `.pc-categories` | `scrollWidth` 5 046 px, píldoras correctamente separadas |

---

## G. Resuelto en 1.4.6

| ID | Qué | Evidencia |
| --- | --- | --- |
| G9 | «Modo fluido» es una preferencia **por título**: no se hereda entre películas y sí se conserva entre episodios de una misma serie | `smoothModeByTitle` + `restoreSmoothMode` en `openDetail`/`expandToFullscreen`/`openPlayer`; sonda `scratch/probe-panel.mjs` (`MODE initial No` → `Sí` → otra película `No` → misma película `Sí`) |

---

## H. Resuelto en 1.4.5

| ID | Qué | Evidencia |
| --- | --- | --- |
| G1 | Panel del reproductor con datos reales (IDIOMA/RESOLUCIÓN/FORMATO/OPCIONES/FEEDBACK) | `mediaInfo` real (`por,spa,eng`, 2 subtítulos, 1 pista 720p) y sonda `scratch/probe-panel.mjs` |
| G2 | Diálogo *Ajuste de reproducir* con audio e idioma de subtítulos del portal | Filas en y=281/406/482/592/702, caja 1145×775 en y=126 |
| G3 | Subtítulos reales visibles en el reproductor | Cues SRT cargados por el proxy `/sub/<token>.srt` y renderizados al instante de tiempo |
| G4 | Subtítulos ON con Español por defecto, respetando la elección del usuario | `applySubtitleDefaults` + `vodSubChosen` |
| G5 | Cambio de idioma de audio mediante relay (`&a=<índice>`) | `switchAudioTrack` + `restartCurrentPlayback` |
| G6 | RESOLUCIÓN con el mapeo real de la APK (`720p`→1080P, `1080p`→4K, 4K sintético) | `ud/n1.dd()` + `qualityChoices` |
| G7 | Orden de Tamaño (Normal, Grande, Pequeño) y sin fila SUBTÍTULO en el panel | Captura real `scratch/xuper-idioma-dialog.png`, `scratch/panel-crop.png` |
| G8 | El panel/diálogo ya no se cierran al cambiar audio o calidad | `stopPlayerVideo` conserva panel y cues; `back()` y cambio de pantalla los cierran |

---

## E. Riesgos si se publica ahora

1. El IPK antiguo de `webos/fidelity/` muestra el prototipo; el artefacto
   válido es `dist/com.webosflux.xuptertv.fidelity_1.5.9_all.ipk`.
2. La build 1.5.9 contiene el port, el servicio y FFmpeg, y está verificada en
   la TV, pero **no es una release**: le faltan los flujos B1–B8 y A18.
3. `assets/original/` viaja en el IPK; sin él no se reproduce la estética real.
4. Afirmar "100 % fidelidad" sin A1 (referencia visual completa) sería falso.
5. El TV en vivo ya usa canales reales, pero la reproducción directa de
   TS/HEVC sigue necesitando el «Modo fluido» para ir sin tirones.

**Recomendación:** usar la build 1.5.9 para probar en el televisor. No
publicarla como release hasta cerrar A1/A2, A18 y los flujos B1–B8, y volver a
capturar todas las pantallas con la referencia al lado.

---

## F. Orden sugerido de cierre

1. **A1** — conseguir capturas de referencia autorizadas.
2. **A2/A3** — ajustar tipografía y alturas de texto.
3. **A18** — reconstruir `MFInfoBar` para VOD.
4. **A10/A24** — marquesina del detalle y logos de EXPLORAR.
5. **B1/B2** — flujo de contraseña parental.
6. **A23** — diálogo de FEEDBACK del reproductor.
7. Recién entonces, empaquetar y comparar de nuevo.
