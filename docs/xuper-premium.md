# Xuper Premium para TVVIDAA

La portada de TVVIDAA usa el módulo en `/xuper/` con la misma sesión del servidor.
Al ingresar desde el dominio, la aplicación abre Inicio. Inicio, Películas,
Series, TV y las demás secciones comparten cabecera y navegación.
La vista clásica sigue disponible en `/tv/`. Desde esa vista, Inicio, Alt+P
o el botón amarillo del mando vuelven a la portada.


La referencia se inspeccionó sin ejecutarla. Véase
[la auditoría REA](xuper-reference-audit.md) para su identidad, funciones,
licencias y límites. La interfaz reproduce la distribución y los colores del
desktop con código propio y sin reutilizar su arte excluido. No se afirma
equivalencia completa con Electron ni comparación píxel a píxel de su ejecución.

## Funciones y límites

- Catálogos reales de películas, series, canales, radio y música, con búsqueda,
  categorías, temporadas y episodios. Películas y Series muestran destacados,
  una selección inicial de diez títulos y un Top 10 local cuando el perfil tiene
  progreso guardado. La cuadrícula agrega páginas al desplazarse y ofrece el
  botón Cargar más para el mando.
- Favoritos, historial, reanudación, listas y perfiles guardados por dispositivo.
  Los perfiles son preferencias locales; no son usuarios ni aislamiento de acceso.
  No se guardan contraseñas, tokens ni URLs privadas en el almacenamiento local.
- Reproducción HTML5 y HLS.js local con enlaces cifrados temporales al relay
  existente. La compatibilidad de códecs depende del navegador/televisor.
- Guía y señales alternativas cuando el proveedor las entrega. Selección de
  calidad, audio y subtítulos cuando el medio la permite.
- El proveedor denominado `xuper_premium` permanece **pendiente de verificación**:
  no se conoce una API autorizada ni se han validado suscripción y credenciales.
  El nombre del módulo no concede acceso a contenido de pago.
- YouTube Music abre su sitio oficial. No se extraen sus flujos de audio.
- Descargas, transcodificación MKV/AVI, integración con archivos/carpetas del
  escritorio, ventana siempre visible y funciones nativas de Electron no se
  habilitan como si fueran capacidades web disponibles.

Para investigar el catálogo de Magis/Xuper, sin presumir acceso al servicio, seguir [REA y VOD Magis](rea-magis-vod.md).

### Fuente experimental de metadatos con estructura Magis

El nuevo formato `magis-metadata` es un adaptador para un JSON HTTPS **exportado con autorización** que conserve la estructura de datos del port comunitario. Permite mostrar películas, series y episodios, sin extraer credenciales, iniciar sesión en Magis ni resolver streams. La interfaz indica «Solo catálogo» cuando no existe reproducción. Se configura con `authorized: true` en `XUPER_PROVIDERS_JSON`; ver [investigación REA](rea-magis-vod.md). **No equivale a tener acceso a películas premium de Magis.**

## Proveedores incluidos

- **Radio Browser:** mismo directorio publico del desktop; busca por pais y texto, guarda favoritos por UUID y reproduce la URL que entrega el proveedor.
- **IPTV-org:** fuente complementaria ya existente de TVVIDAA, claramente identificada.
- **Internet Archive:** fuente heredada empaquetada, opt-in con XUPER_ENABLE_ARCHIVE=true; no reemplaza LaMovie.
- **Videoteca:** reúne películas y series de los proveedores autorizados activos.
  LaMovie queda identificado como fuente del cliente de escritorio pendiente de
  una integración autorizada.
- **YouMusic:** abre YouTube Music oficial.
- **Portal Xuper/Magis:** pendiente de API autorizada y cuenta valida; no se migran sesiones ni claves del instalador.

La tabla de evidencia y el detalle de cada mecanismo estan en [la auditoria REA](xuper-reference-audit.md).

## Configurar proveedores autorizados

La configuración actual `M3U_BASE_URL`, `M3U_USERNAME`, `M3U_PASSWORD` y
`M3U_TYPE` se reutiliza sin modificarla. El módulo puede leer
el catálogo guardado existente, pero no lo sobrescribe. Se conservan los
catálogos y funciones anteriores de TVVIDAA.

Los nuevos imports y fuentes del módulo requieren HTTPS público con TLS válido.
El proveedor M3U existente puede actualizar su lista y resolver VOD del mismo
origen HTTP cuando `VIDAA_HTTP_VOD_ACK=yes` y el host y puerto exactos figuran
en `VIDAA_HTTP_VOD_HOSTS`. El navegador recibe únicamente referencias opacas
del relay HTTPS. Si el proveedor rechaza los medios, confirma con ese proveedor
el permiso de reproducción desde el VPS. Un catálogo accesible o guardado
puede contener títulos cuya reproducción no esté autorizada.

En la comprobación del 18 de noviembre de 2026, la lista M3U activa
respondió HTTP 200. El mismo proveedor respondió HTTP 401 a una película
MP4 y a un episodio MP4 de esa lista recién descargada. El diagnóstico
distingue la descarga del catálogo del permiso de reproducción.

Se pueden añadir hasta ocho proveedores en `XUPER_PROVIDERS_JSON`, únicamente
en las variables privadas del servidor. La interfaz muestra sus estados y permite
validar/actualizar; no recibe ni almacena credenciales de proveedores.

```json
[
  {
    "id": "mi_lista",
    "name": "Mi proveedor autorizado",
    "format": "m3u",
    "authorized": true,
    "url": "https://proveedor.example/catalogo.m3u",
    "streamHosts": ["cdn.proveedor.example"]
  }
]
```

Valores de ejemplo: deben sustituirse por un proveedor propio autorizado.
`authorized: true` registra la decisión del administrador; no verifica por sí
mismo derechos, titularidad ni una suscripción.

`format: "xtream"` utiliza `baseUrl`, `username`, `password` y el listado
M3U de Xtream (`get.php`); no se anuncia una implementación completa de todas
las acciones de `player_api.php`. `format: "json"` admite un catálogo como:

```json
{
  "movies": [{"id":"m1","title":"Título autorizado","url":"https://cdn.proveedor.example/1.mp4"}],
  "series": [{"id":"s1","title":"Serie autorizada","seasons":[
    {"number":1,"episodes":[{"id":"e1","title":"Episodio 1","url":"https://cdn.proveedor.example/e1.mp4"}]}
  ]}],
  "live": [{"id":"c1","title":"Canal autorizado","url":"https://cdn.proveedor.example/live.m3u8",
    "signals":[{"url":"https://cdn.proveedor.example/live.m3u8"}],
    "programmes":[{"title":"Programa","start":"2026-11-17T12:00:00Z","end":"2026-11-17T13:00:00Z"}]}],
  "radio": [{"id":"r1","title":"Radio autorizada","country":"Colombia","url":"https://cdn.proveedor.example/radio.mp3"}],
  "music": [{"id":"a1","title":"Audio autorizado","url":"https://cdn.proveedor.example/audio.mp3"}]
}
```

Los identificadores de títulos y episodios deben ser únicos. Metadata opcional:
`poster`, `backdrop`, `synopsis`, `category`, `genre`, `year`, `duration`,
`country`; subtítulos WebVTT mediante `subtitles: [{url,label,language}]`.
El proveedor JSON puede configurar `authorization` para autenticar la descarga
del catálogo. Las fuentes multimedia deben ser reproducibles con sus URLs
autorizadas; no se reenvía ese secreto de catálogo a otros hosts.

`streamHosts` autoriza hosts adicionales para manifiestos, segmentos y subtítulos.
Los destinos privados, locales, puertos distintos de 443 y redirecciones en
imports se rechazan. Un proveedor que redirige su lista debe suministrar al
administrador su URL HTTPS final. Los límites de descarga son 32 MiB para M3U
y 16 MiB para JSON; hay timeout, comprobación DNS y fijación de la IP de conexión.

## API y seguridad

`GET /api/xuper/bootstrap`, `providers`, `catalog`, `detail`, `resolve`, `guide`;
`POST /api/xuper/refresh`. Los filtros están en el código y las pruebas del
módulo. Las rutas requieren la cookie de sesión existente, verifican el origen
y no aceptan URLs arbitrarias del navegador para importar o retransmitir.

El catálogo público usa campos permitidos. Los enlaces de reproducción utilizan
el cifrado autenticado y la caducidad del relay existente (`/api/media`). El
secreto `MEDIA_TOKEN_SECRET` y las credenciales de sesión existentes se conservan.
Hay un límite de 120 solicitudes por minuto/IP en el módulo y una actualización
forzada por minuto/proveedor. Los contadores son locales al proceso; varios
procesos necesitan una cuota compartida antes de escalar horizontalmente.

Límites de confianza: navegador no confiable → sesión/origen/validación;
proveedor externo → HTTPS/DNS/cotas/esquema; stream → token cifrado y relay;
preferencias locales → metadata validada, sin secretos. Ni el portable ni sus
servicios se ejecutan para importar la referencia.

## Validación local y staging

No se instala un nuevo framework ni dependencias npm de ejecución. HLS.js
1.6.13 es la versión fija ya utilizada por TVVIDAA, con SRI verificado y avisos
de licencia incluidos. No hay un nuevo manifiesto/lockfile al que aplicar un
audit de paquetes.

```powershell
node --test server/*.test.cjs server/providers/*.test.cjs server/api/xuper/*.test.cjs server/providers/xuper/*.test.cjs
```

En un sandbox que bloquee procesos hijos, Node 24 permite añadir
`--test-isolation=none`; la prueba de persistencia entre procesos necesita
ejecutarse con creación de procesos habilitada.

`tools/xuper-browser-fixture.cjs` es un servidor de **pruebas** ligado solamente
a loopback. Aísla los proveedores reales y usa datos claramente identificados
como pruebas. No es el punto de entrada de producción ni se copia a su imagen.
Las comprobaciones Playwright y sus capturas se documentan con el resultado final.

Pendiente de validación externa: catálogo premium autorizado real, Chrome Windows
interactivo, Android real y Hisense VIDAA real. La emulación de tamaño de pantalla
no demuestra compatibilidad del televisor ni rendimiento con su decodificador.

## Revisión, despliegue y rollback

### Estado verificado el 18 de noviembre de 2026

| Trabajo | Estado | Alcance |
| --- | --- | --- |
| [PR #15](https://github.com/mejai84/xuvidaa/pull/15) | Publicado en Hostinger, revisión `353262d`, contenedor saludable | Avisos de formato incompatible y de catálogo guardado, con reintentos para fallos temporales. |
| [PR #17](https://github.com/mejai84/xuvidaa/pull/17) | Integrado en `hostinger-vps` como `a92c15d`. Despliegue pendiente | Análisis REA del port webOS y adaptador `magis-metadata` para exportaciones JSON autorizadas. Las fichas se muestran como «Solo catálogo». |
| [PR #16](https://github.com/mejai84/xuvidaa/pull/16) | Subido a GitHub y abierto | Selector de temporadas y episodios en el reproductor, avance de episodio, saltos de 10 segundos y velocidad para VOD. |

La revisión del checkout activo y el estado de `xuvidaa-tv-vidaa-1` se comprobaron
en el VPS. Consultar [el procedimiento de producción](PRODUCTION.md) para
verificar qué commit está sirviendo el dominio antes de un despliegue.

El [CI del PR #16](https://github.com/mejai84/xuvidaa/actions/runs/44195995831)
pasó en su propia rama. La revisión de integración identificó tres puntos
pendientes en el reproductor:

- Permitir que el mando mueva el foco desde el selector de temporadas hacia los
  botones de episodios.
- Conservar «Solo catálogo» al normalizar los episodios dentro del reproductor.
- Desactivar los nuevos controles VOD cuando falle la reproducción.

La validación física en Hisense VIDAA está pendiente.

El punto de entrada es `node server/http-server.cjs`. La imagen incluye
`server/api/xuper`, `server/providers/xuper` y `web/xuper` junto a los recursos de TVVIDAA.

Primero se debe validar una instancia staging con secretos propios y las mismas
restricciones de red. Comprobar login, catálogos reales, renovación de tokens,
manifiestos HLS/segmentos, búsqueda, episodios, foco remoto y vuelta a TVVIDAA.
No conectar ni mutar otros servicios del VPS.

Para rollback, restaurar la imagen/commit anterior del mismo servicio y reiniciar
solo ese servicio. No borrar volúmenes ni recrear secretos; el módulo no migra
bases de datos ni escribe sobre la caché existente. El historial/favoritos del
nuevo módulo son locales al navegador. Presupuesto inicial del servicio existente:
1 CPU y 512 MiB; medir memoria, CPU, concurrencia y ancho de banda en staging
antes de aumentar límites o activar cualquier transcodificación.
