# Ejecución HTML en VPS

La versión de navegador entrega la interfaz y la API desde el mismo servicio
Node.js. El portal se consulta desde el servidor para evitar CORS; el navegador
usa rutas del mismo origen para catálogo, detalles y relay de medios.

El despliegue recomendado para este repositorio está documentado en
[`deploy/hostinger/README.md`](../../deploy/hostinger/README.md). No requiere
Vercel: Dokploy construye el contenedor en el VPS y Traefik publica
`tv.rfcsas.com` con HTTPS.

El servicio necesita las variables privadas `PUBLIC_BASE_URL`,
`MEDIA_TOKEN_SECRET`, `XUPER_SESSION_SECRET` y `XUPER_WEB_PASSWORD`. No copies
claves a JavaScript, URLs ni archivos estáticos.

La sesión del portal y la resolución de medios se ejecutan en el VPS. Modo
Fluido sigue sin estar disponible porque requiere el relay FFmpeg del televisor
LG; TV VIDAA y otros navegadores dependen de los formatos compatibles con su
reproductor.
