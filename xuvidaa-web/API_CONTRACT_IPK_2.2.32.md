# Contrato del servicio XuperTV IPK 2.2.32

Este resumen se contrastó estáticamente con la IPK compartida. La app no llama
al portal desde el HTML: `webOSTV.js` transporta llamadas Luna al servicio Node
instalado en webOS; ese servicio consulta el portal y devuelve objetos JSON.
El navegador no tiene Luna, por eso la edición web llama rutas HTTP del mismo
origen que adaptan el contrato.

## Respuestas

El servicio Luna responde con `returnValue: true` junto a los datos, o con
`returnValue: false`, `errorText` y `errorCode`. Las rutas web conservan esa
envoltura para que la interfaz pueda distinguir un resultado válido de un
fallo. Los errores de HTTP también llevan esos campos y un código `error` para
que el navegador presente mensajes concretos.

## Métodos del IPK

| Método Luna | Datos que espera | Adaptación web |
| --- | --- | --- |
| `home` | `root`, `pageNum` | `POST /api/home`; el cliente web actual solicita por raíz. |
| `search` | `value` | `POST /api/search` |
| `detail` | `contentId` | `POST /api/detail` |
| `mediaInfo` | `contentId`, `seriesContentId` | `POST /api/media-info` |
| `resolve` | `contentId`, `seriesContentId`, `trackIndex` | `POST /api/resolve`; devuelve una ruta protegida del proxy web. |
| `resolveSmooth` | los datos de `resolve` | No adaptado: depende del FFmpeg armhf local de webOS. |
| `liveCategories` | ninguno | `POST /api/live/categories` |
| `liveChannels` | `columnId`, `pageNum`, `pageSize` | `POST /api/live/channels` |
| `resolveLive` | `channelCode` o `streamUrl` | El código del canal usa `POST /api/live/resolve`; las URLs externas M3U se rechazan en esta edición. |
| `fetchM3u` | `url` | No habilitado hasta tener una lista de hosts permitidos para evitar que el servidor descargue URLs internas o arbitrarias. |
| `ping` | ninguno | `POST /api/ping` |
| `netdiag` | capacidades y estado de pantalla | `POST /api/netdiag`; solo verifica la sesión desde el servidor, no los códecs ni DNS del TV. |
| `abortMedia` | ninguno | No adaptado todavía. |
| `prewarm` | ninguno | No hace falta: el servidor web inicia la sesión al recibir la primera consulta. |
| `keepAlive`, `heartbeat` | ninguno | No se trasladan: el backend web no es un servicio Luna residente en el televisor. |
| `setProxy` | URL de proxy de salida | No se expone como método público de la web. |

## Límite actual del catálogo

El adaptador llama al mismo módulo Magis del servicio y no descarga semillas de
sesión. Si el portal rechaza el inicio de sesión con `portal100024`, el sitio
debe mostrar ese rechazo; CORS y la biblioteca Luna no pueden corregirlo. Se
requiere acceso autorizado del proveedor desde la región y la infraestructura
que ejecutará el backend.

## Diferencias de versión

El código fuente local usado para reconstruir la interfaz indica 2.2.2; la IPK
compartida indica 2.2.32, y la rama pública actual puede tener otra versión.
Antes de llamar a la edición web una réplica fiel, hay que comparar cada cambio
de la IPK objetivo con el código fuente que se tome como base. Este documento
refleja el contrato del IPK 2.2.32 compartido, no promete equivalencia de todas
las funciones de reproducción.
