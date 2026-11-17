# Auditoría estática de Xuper Desktop para el módulo premium

Fecha: 2026-11-17. Alcance: instalador proporcionado por el usuario, inspeccionado con REA y extracción estática. **No se ejecutó el portable, Electron, FFmpeg, yt-dlp ni JavaScript del paquete. No se consultaron los servicios del paquete ni se incorporaron credenciales.**

## Identidad y trazabilidad

| Elemento | Resultado observado |
| --- | --- |
| Archivo suministrado | `C:\vidaa\Xuper Desktop 0.2.0 Portable.exe` |
| Tamaño | 189076262 bytes |
| SHA-256 original | `55359a6b3785fb990b42c9d229af0aab951dbd03ec00290a7eae954e1c076a8b` (coincide con el proporcionado) |
| REA `open_binary` | PE32, x86; identifica el lanzador portable, no la arquitectura de todos sus componentes |
| REA recursos PE | `ev_fb7492fa1664ed50f4ff3cdb414d7850ad7edfe0e9ead58347cff3d3910b0676`; 31 entradas examinadas, 13 recursos, árbol de recursos completo dentro del perfil del analizador |
| Contenedor interno | Firma NSIS y archivo 7z en offset 184142; longitud 188604122 bytes obtenida de la cabecera 7z |
| SHA-256 del 7z separado | `0898b3e10e079258cedf2e788343ac739bae12484a1db91e00114163826592b9` |
| Extracción | `C:\vidaa\outputs\xuper-audit-20261117\extracted\resources\app`, mediante `tar`/bsdtar 3.8.9 del sistema; no ejecuta el instalador |
| Disposición real | Árbol `resources/app`; no se encontró un `app.asar` en el inventario de miembros |
| Identidad REA del árbol | `505daa92a4883780e1f8ad44a4849bb5ed4a85237ffdc32869a2361f01487184` |
| Análisis REA JavaScript | `ev_d56b15ccf13756090f49f82d559a1c9c9c471cf1678c78478a11994a50725dfb` |
| Resumen REA | `ev_9c4cf5c29a263142408911a4ecce73fc5de9bbb8cf2f574bfad4e0f1bdb4b51c` |
| Vista del módulo principal | `ev_e309603b8237590bee06f20917056075767c4be2197d0f02b96ea98b30de3ed0` (`desktop/main.cjs`) |

`package.json` identifica `xuper-desktop` 0.2.0, entrada `desktop/main.cjs`, Node >=22.12.0 y dependencia `hls.js` 1.7.4. Declara como referencia upstream el commit `8c81b29550de72c4aa175f54f669597796bb73f4` de `cristianco7/XUPER-HYDRA-PORT-WEBOS`. Esto es metadata declarada por el paquete, no una verificación del repositorio remoto. Existen textos antiguos: README titula 0.1.7 y la portada HTML muestra 0.1.9; la versión del manifiesto es 0.2.0.

## Cobertura y límites de REA

Se seleccionaron exactamente `package.json`, `desktop/main.cjs`, `desktop/preload.cjs`, `desktop/music-preload.cjs`, `desktop/service.cjs`, `desktop/account-store.cjs`, `desktop/download-manager.cjs`, `desktop/download-history.cjs`, `desktop/download-window.cjs`, `service/index.js`, `service/m3u.js`, `service/radio.js`, `service/videoteca-api.js` y `ui/js/app.js`. REA contabilizó 207 archivos relevantes, 981755 bytes de texto, 13 archivos JavaScript analizados, 139713 nodos AST, 249 hallazgos y cero fallos de parseo.

El inventario conserva la identidad del árbol completo; 193 archivos quedaron fuera del análisis de fuentes. La cobertura de aplicación es **parcial** por esa selección. La cobertura semántica también es parcial y truncada por límites de 18000 nodos por archivo y 65000 globales; quedan 193 incógnitas de aplicación y 28831 semánticas. Una vista de resumen o de un módulo agotada no convierte esa cobertura en completa. El análisis estático no demuestra ejecución, accesibilidad de un servidor, validez de una sesión, autorización de contenidos ni equivalencia total de comportamiento.

## Matriz funcional de referencia

Las rutas y funciones siguientes son observaciones del código empaquetado. La columna web es la estrategia de adaptación, no una afirmación de que se haya probado la función contra un proveedor real.

| Área | Referencia observada | Dependencia | Adaptación web / condición |
| --- | --- | --- | --- |
| Inicio y categorías | `buildHome`, `buildTabs`, `buildFeaturedPageDesktop`, `buildRootPageDesktop` en `ui/js/app.js`; carruseles, recomendaciones y rankings dependen de datos | Catálogo remoto o snapshot empaquetado | Usar exclusivamente catálogos configurados; no presentar el snapshot incluido como contenido disponible |
| Películas y series | `buildMoviesPage`, `buildSeriesPage`, `openDetail`, `buildDetail`, selector de temporadas y episodios | Operaciones `home`, `search`, `detail` | Metadatos y reproducción únicamente desde adaptadores autorizados |
| Infantil / anime / explorar | `buildKidsPage`, `buildAnimePage`, `buildExplorePage`; existen filtros de géneros y raíces | Clasificación que devuelve el catálogo | Filtrar datos reales; una categoría vacía debe mostrar su estado |
| Búsqueda | `buildSearch`, `buildHotTabs`, `buildFilterPanel`, `renderSearchResults` | Backend para resultados y tendencias | Búsqueda sobre catálogo disponible, con estados de carga y error |
| Favoritos e historial | `toggleFavorite`, `loadLocalProfile`, `buildHistoryDrawer`, `openHistoryRecord`, `updateVodProgress` | Perfil/almacenamiento local del desktop | Persistencia del módulo y reanudación por título/episodio; separar del perfil original |
| TV en vivo | `buildLivePage`, `buildLiveSearch`, `loadLiveCategories`, `loadLiveChannels`, `renderLiveRows`; métodos `liveCategories`, `liveChannels`, `resolveLive` | Señales/categorías del proveedor | Categorías, favoritos y cambio de canal, sin inventar EPG ni señales alternativas |
| IPTV / Mis listas | `buildMyListsPage`; métodos `myListsIndex/Add/Refresh/Remove/Rename/Channels/Favorite/Settings/Check/CheckStatus/CheckStop/Epg/Guide/Play` | M3U, archivos del PC, proxy local y XMLTV; lecturas de carpeta | Adaptadores del servidor; credenciales fuera del navegador. Los diálogos de Windows y la vigilancia de carpetas requieren una alternativa explícita |
| Videoteca | `buildVideotecaPage`, `desktop:videoteca-folder`, `service/videoteca-api.js` | Carpetas locales y lectura del sistema de archivos | No puede acceder libremente al disco del usuario desde un sitio; biblioteca autorizada del servidor o selección de archivos con consentimiento |
| Radio | `buildRadioPage`, favoritos, barra y minirreproductor; métodos `radioStations`, `radioClick` | Directorio Radio Browser y señales de emisoras | Proveedor público separado, país/búsqueda/favoritos; validar cada URL y no asumir disponibilidad |
| YouMusic | `buildMusicPage`; `desktop.music` y `WebContentsView` | Vista Electron de YouTube Music, sesión de Google | Enlace oficial o integración oficial permitida; no trasladar automatización del sitio ni extracción de streams |
| Reproductor | `resolve`, `resolveSmooth`, `mediaInfo`, `audioInfo`, `mediaDuration`, subtítulos, calidad, velocidad, pantalla completa | HLS.js, proxy Node y FFmpeg para compatibilidad | HLS/MP4 según navegador. TS depende de códecs. HEVC/MKV/AVI y transcodificación requieren servicio aislado y pruebas; no prometerlos por extensión |
| Ventana flotante | `desktop:mini`, `desktop:mini-title`, controles de ventana | `BrowserWindow`, always-on-top y APIs nativas | PiP solo cuando el navegador lo soporte; no equivalencia garantizada en VIDAA |
| Cuenta | Métodos `accountLogin`, `accountStatus`, `accountLogout`; `account-store.cjs` guarda una sesión con Electron `safeStorage` | API externa y cifrado por usuario del SO | No importar sesiones ni secretos del portable. Reutilizar autenticación web; proveedor Xuper pendiente de acceso autorizado |
| Descargas | `desktop/download-manager.cjs`, `download-history.cjs`, `download-window.cjs`, binarios de herramientas | Escritura en disco, herramientas externas y permisos del contenido | Mantener condicional/deshabilitado hasta disponer de permiso de descarga, cuotas, límites y validación |
| Ajustes / diagnóstico | Paneles playback/profile/account/history/parent/feedback/upgrade/netdiag | Parte de las opciones son UI o dependen del backend | Mostrar únicamente opciones implementadas. No interpretar el README histórico como prueba de una sesión real |

REA observó dos construcciones `BrowserWindow`, un punto de entrada preload, dos APIs `contextBridge`, 29 miembros expuestos y 22 canales IPC literales. De 31 transmisiones renderer, 28 tienen emparejamiento estático y tres quedan sin emparejar. Estas cifras describen sintaxis y relaciones inferidas, no políticas de seguridad ejecutadas.

## Servicios externos y autenticación

| Clase de servicio | Evidencia empaquetada | Requisito / estado |
| --- | --- | --- |
| Portal Xuper/Magis | `service/magis.js`, métodos account/home/search/detail/live/resolve; el servicio comenta un protocolo cifrado y limitaciones CORS | Propietario, API permitida, licencia/suscripción y credenciales autorizadas **sin verificar**. Ningún endpoint privado se habilita por haber sido encontrado |
| Listas de usuarios | `service/m3u.js` y operaciones `myLists*` | URL o archivo facilitado legítimamente; tokens y cabeceras únicamente en servidor |
| Radio Browser | `service/radio.js` identifica el directorio público `radio-browser.info` y espejos HTTPS | El código describe servicio sin claves y envío de clics; no se verificó la política actual ni se llamó al servicio |
| YouTube Music / Google | `desktop/main.cjs`, `desktop/music-preload.cjs` y `desktop.music` | Cuenta y condiciones del servicio; usar acceso oficial. No trasladar cookies ni sesiones de Electron |
| Bibliotecas / proveedores auxiliares | `service/videoteca*`, `lamovie-api.json`, `nf-protocol.js`, `ranger-protocol.js`, `ranger-slb.js` | Inventariados por presencia; fuentes y relaciones fuera de la selección quedan sin validar. No habilitar por defecto |
| DNS y CDN | `dnsx.js`, `cachefly.js`, `proxy.js` | Código no prueba operación ni autorización de un CDN. No importar excepciones TLS o rutas privadas al nuevo módulo |

Se omiten deliberadamente valores de autenticación, URLs de reproducción, consultas privadas y secretos. No se contactó ninguno de estos destinos. Un error CORS no es una autorización para el servicio ni justifica un proxy abierto.

## Licencias y reutilización

| Material | Declaración incluida | Resultado para la integración |
| --- | --- | --- |
| Código de integración desktop | `LICENSE`, MIT, copyright 2026 Contributors to the desktop adaptation; limita su alcance al código nuevo desktop | Código reutilizable bajo esas condiciones, conservando el aviso si se copian partes sustanciales |
| Código original del port | `licenses/upstream-LICENSE`, MIT, copyright 2026 cristianco7; excluye expresamente recursos gráficos, marca, contenido y FFmpeg | El código/CSS puede servir de base con atribución y aviso MIT; la exclusión no permite copiar bitmaps originales |
| Arte / logo / nombre / catálogo remoto | Exclusiones de ambas licencias y `licenses/upstream-THIRD_PARTY.md` | Derechos separados no acreditados. No importar `assets/original`, `assets/xuper`, logos ni pósteres guardados como catálogo real |
| HLS.js 1.7.4 del portable | Apache-2.0; aviso Dailymotion 2017 y Brightcove 2013–2015 en `node_modules/hls.js/LICENSE` y `licenses/HLS.js-LICENSE` | No sustituir silenciosamente la versión del proyecto; cualquier copia requiere licencia/avisos y versión verificada |
| FFmpeg | Avisos GPLv3, archivos de fuentes/build y FFprobe en `licenses/` | No trasladar el binario Windows al servidor Linux; evaluar por separado obligaciones y pruebas si se incorpora transcodificación |
| Electron / Chromium | `LICENSE.electron.txt` y `LICENSES.chromium.html` en el archivo 7z | Dependencias del desktop, innecesarias para el frontend web |
| yt-dlp y auxiliares | `licenses/yt-dlp-LICENSE.txt`, `DescargarY-tools.json`, `bin/yt-dlp/**` | No se ejecutaron ni integraron; no autorizan descargas de contenido ajeno |

Hashes de documentos inspeccionados: `LICENSE` = `e369c410eda8725278dc57eea00b57733390c7fde07e3cc22dc45df61ebab239`; `licenses/upstream-LICENSE` = `b385d92a4c8dc7b764044ab6512c3a31c201bde54782b517940eb8a8d8807583`.

## Apariencia observada y fidelidad

La apariencia efectiva del desktop carga, en este orden, `ui/css/style.css`, `ui/desktop/desktop.css` y `ui/desktop/modern.css`. La última capa sobrescribe el diseño webOS antiguo; no corresponde usar su barra expandida azul/púrpura como referencia final. SHA-256 de `modern.css`: `0eaa9d7bc39c51a5f134c87dc885de859c7d2687c3fd6635cbb399904ffec46a`.

El desktop usa un lienzo de 1920×1080 escalado, Segoe UI Variable Text/Segoe UI, fondo `#0b0c10`, superficies `#15171c`/`#1d2027`, texto `#f4f5f7`, secundario `#c9ced6`, gris `#8e95a1` y acento naranja `#ff8a3d`. La barra lateral definitiva es compacta de 180 unidades, once filas de 80, iconos de 33 y rótulos de 17. El foco tiene cápsula de 133×76 con fondo naranja translúcido. Orden: Destacados, TV en vivo, YouMusic, Radio, IPTV, Videoteca, Películas, Series, Infantil, Anime, Historial. Cabecera centrada con marca textual y estado, búsqueda/perfil/reloj a la derecha; pósteres con radio 10 y foco de escala 1.04.

Estos valores son evidencia estática de estilos y estructura. No se dispone de una captura del portable en ejecución para verificar el resultado calculado en Electron ni una comparación píxel a píxel. La adaptación puede reproducir disposición, medidas relativas, colores y controles con código permitido; los recursos de terceros excluidos no quedan licenciados por esta auditoría.

## Preguntas pendientes y condiciones de cierre

- **Resuelto:** identidad del portable, contenedor y estructura de código; inventario de funciones principales y dependencias Electron; lectura de licencias y tokens visuales.
- **Parcial:** recuperación funcional. La selección y los límites REA dejan código no analizado; no equivale a una copia íntegra ni a equivalencia demostrada.
- **Sin verificar:** propietario/API permitida del servicio Xuper Premium, suscripción, autenticación legítima y disponibilidad real del catálogo/señales. Mantener proveedor deshabilitado hasta contar con esa evidencia.
- **Sin verificar:** DRM, reproducción real con proveedor premium, Android y Hisense VIDAA, PiP, códecs y rendimiento de transcodificación. Requieren pruebas en los destinos correspondientes.
- **Separado de esta auditoría:** las pruebas del nuevo módulo web y su staging deben documentarse con sus propios resultados. No se autoriza producción mediante este informe.

Los archivos extraídos permanecen en `outputs` para inspección local. No forman parte del módulo desplegable ni deben añadirse íntegramente al repositorio.

## Conformidad con los mismos proveedores del desktop

Esta ampliación distingue el proveedor conectado por el código de entrada de los módulos que simplemente están presentes en el portable. Se inspeccionaron como texto los archivos exactos siguientes; no se ejecutaron sus instrucciones ni se trasladaron constantes criptográficas, sesiones o claves de aplicación.

| Fuente exacta | Evidencia estática y mecanismo | Estado de conformidad web |
| --- | --- | --- |
| **Portal Xuper/Magis** | `service/index.js` registra cuenta, inicio, búsqueda, detalle, canales y resolución contra `magis.js`. Ese archivo contiene nueve hosts de portal, llamadas HTTPS POST con protocolo cifrado, `v3/snToken` y `v8/active` para activación, `v8/login` para cuenta, `v3/searchByName`, `v4/getItemData`, `v6/getLiveData` y SLB v14/v15. `nf-protocol.js` prepara la cuenta y `ranger-protocol.js`/`ranger-slb.js` tratan SLB; no son catálogos independientes. | Es el proveedor central de películas/series/TV de la referencia, pero no existe API oficial permitida, licencia o sesión autorizada verificada en esta investigación. Mantenerlo identificado y pendiente de verificación; un adaptador JSON genérico no constituye equivalencia de ese protocolo. Los hosts privados y valores criptográficos no se publican ni habilitan automáticamente. |
| **IPTV del usuario / M3U** | `service/m3u.js` indica expresamente que no incluye una lista inicial. Admite direcciones y archivos del PC, sincronización de carpeta, XMLTV, favoritos, comprobación de canales y reproducción mediante proxy/FFmpeg. | Reutilizar la lista privada y configuración autorizada actual de TVVIDAA; las listas adicionales deben configurarse en el servidor. Una lista inventada no sustituye al proveedor del usuario. El acceso libre a carpetas de Windows no existe en un sitio web. |
| **Radio Browser** | `service/radio.js:18` fija `de1.api.radio-browser.info`, `de2.api.radio-browser.info`, `all.api.radio-browser.info`; usa HTTPS GET y User-Agent. `stations` consulta `/json/stations/search` con país/idioma/límite o `/json/stations/byuuid`; `click` llama `/json/url/{uuid}`. No se observó una clave de API en ese módulo. | Implementar Radio Browser como el mismo directorio público, conservando país/búsqueda/favoritos y protección del relay. Las emisoras dependen de su señal real; no reutilizar tokens de terceros. |
| **LaMovie — Videoteca activa** | `service/index.js:322–327` registra `videoteca*` contra **`./videoteca-api`**, no contra el archivo legacy de Archive. `lamovie-api.json` declara la base `https://lamoviebot.tvymas.workers.dev/`, las rutas de catálogo `/generos/peliculas/suspense?page=1`, `/generos/series/comedia?page=1` y búsqueda `/buscar`. Las fichas usan `/pelicula/{slug}`, `/serie/{slug}` y `/serie/{slug}/{temporada}/{episodio}`. El código hace GET JSON con Accept/User-Agent; no se observó autenticación HTTP en la función de consulta. | Es la fuente efectiva de la pestaña Videoteca de esa build. El hecho de observar un endpoint sin cabecera de autenticación no acredita derechos de integración ni retransmisión. Preparar únicamente una conexión expresamente autorizada; no presentarla como disponible por defecto ni sustituirla silenciosamente por JSON de otra forma. No se consultó ese host durante la auditoría. |
| **Internet Archive — fuente pública empaquetada** | `service/videoteca.js` contiene `https://archive.org/advancedsearch.php`, `/metadata/`, `/services/img/`, `/download/`, seis colecciones clásicas y carpetas locales. El puente desktop conserva `videotecaAddFolder` de ese archivo, mientras el catálogo registrado usa LaMovie. | `server/providers/xuper/internet-archive.cjs` adapta esta fuente pública **empaquetada**, identificada separadamente como Internet Archive. No afirma reemplazar a la Videoteca activa LaMovie. Solo acepta registros de las colecciones clásicas con URL exacta de CC0, Public Domain Mark o la declaración legacy Public Domain; excluye registros restringidos y otros esquemas de licencia. |
| **YouMusic / YouTube Music** | `desktop/main.cjs` crea un `WebContentsView` para `https://music.youtube.com/`, con acceso de cuenta mediante Google. El preload expone controles de esa vista Electron. | Mantener enlace oficial de YouTube Music o integración oficial permitida. No trasladar su sesión Google, automatización de páginas ni extracción de audio al servidor premium. |
| **IPTV-org de TVVIDAA** | Proveedor ya existente en el proyecto web. No se observó como fuente de catálogo del desktop inspeccionado. | Puede conservarse como fuente adicional identificada de TVVIDAA; no debe describirse como uno de los proveedores originales de Xuper Desktop. |

### Implementación pública de Internet Archive

La API pública de lectura devuelve metadata y archivos por identificador; los campos `d1`, `d2` y `dir` describen nodos de almacenamiento. El adaptador usa esos campos validados para construir una URL HTTPS directa del archivo MP4 que realmente figura en el registro, sin seguir redirecciones del importador. [Documentación oficial de Metadata Read](https://archive.org/developers/md-read.html).

Las lecturas públicas no necesitan importar claves de cuenta; los campos privados y las escrituras requieren autenticación. El módulo no solicita esas operaciones. [Autenticación del Metadata API](https://archive.org/developers/metadata.html).

La búsqueda conserva las colecciones clásicas del código empaquetado y pagina dentro del límite de 10000 resultados del servicio. Se filtran además las licencias recibidas; el total remoto puede incluir registros posteriormente excluidos por esos filtros. [Documentación de búsqueda del portal de Internet Archive](https://doc-tools.readthedocs.io/en/ia-test-gsod/item-search-apis.html).

CC0 y Public Domain Mark tienen funciones diferentes: CC0 es una dedicación y PDM identifica obras declaradas libres de restricciones conocidas. La presencia de cualquiera en metadata es una **declaración del registro**, no una auditoría independiente de derechos del cargador. Se omiten otras licencias CC hasta disponer del flujo correspondiente de atribución/condiciones. [Herramientas de dominio público de Creative Commons](https://creativecommons.org/public-domain/).

El adaptador limita búsquedas a 40 registros por página, descargas JSON a 1 MiB/2 MiB, cuatro consultas pendientes, doce cachés de búsqueda y doscientas fichas. Caduca las fichas a los quince minutos, vuelve a comprobar licencia/restricciones antes de emitir un nuevo medio y usa backoff cuando falla la fuente. No muestra pósteres cuya procedencia no se haya validado. Las nueve pruebas nuevas usan exclusivamente respuestas simuladas y cubren licencias, restricciones, identidad, hosts/directorios/archivos hostiles, selección real de MP4, búsquedas, caché, límites, concurrencia y retirada de licencia. No prueban disponibilidad en vivo ni códecs en un televisor real.
