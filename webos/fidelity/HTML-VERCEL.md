# Ejecución HTML en navegador / Vercel

El Root Directory de Vercel debe ser `webos/fidelity`. La página conserva la
interfaz y recursos del port de webOS; en modo HTML el cliente llama a las
Functions `api/[method].js` y `api/media.js`.

## Variables de entorno

- `MEDIA_TOKEN_SECRET`: secreto aleatorio largo para firmar tokens temporales
del relay de medios. Guárdalo como variable privada en Vercel Production y
Preview.
- `MEDIA_ALLOWED_HOSTS` es opcional y puede quedar sin configurar. El servidor
firma los hosts HTTPS exactos que devuelve el portal para cada reproducción;
el navegador no puede elegir hosts arbitrarios. Si se configura como lista
fija, esos hosts se agregan a los autorizados para medios.

Al añadir o cambiar estas variables, crea un nuevo deployment.

## Funciones disponibles

- Inicio usa el snapshot real `data/portal.js`; el refresco pide `home` al
backend. Búsqueda y fichas usan `search` y `detail`.
- VOD solicita autorización al portal en el servidor y reproduce por
`/api/media` con token HMAC temporal y solicitudes HTTP Range. No entrega la URL
firmada ni los headers del portal al JavaScript de página.
- HLS.js se usa en navegador cuando no existe soporte HLS nativo. El relay
reescribe manifiestos y entrega segmentos y subtítulos mediante el token
firmado, evitando CORS del CDN.
- TV en vivo usa el resolvedor real del portal y las Functions para solicitar
manifiestos y segmentos HLS por separado. No deja conexiones abiertas en una
Function entre solicitudes.
- El usuario de Vercel debe tener autorización para acceder al portal y al
contenido que reproduzca.

## Límites actuales del port HTML

- Modo Fluido requiere FFmpeg persistente y no está disponible en Functions;
el control se oculta en HTML. El port webOS original continúa usando su
servicio nativo.
- El relay de video depende del límite de duración, ancho de banda y tamaño de
respuesta del plan de Vercel. Para sesiones largas y estables, aloja el relay
de medios en un servicio persistente.
- El diagnóstico detallado de DNS y CDN pertenece al servicio LG y no se
ejecuta en modo HTML.

## Desarrollo local

Sirve esta carpeta como sitio estático para comprobar la interfaz y el snapshot.
Las búsquedas, fichas y reproducción requieren las Functions de Vercel y
`MEDIA_TOKEN_SECRET`; abrir `index.html` con `file://` no puede ejecutar `/api`.
