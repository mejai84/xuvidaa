# Reglas de desarrollo — TVVIDAA web + Hisense VIDAA

## Arquitectura vigente
- Interfaz: `web/index.html`, `web/js/app.js`, `web/css/app.css`.
- HTTP, sesiones y archivos estáticos: `server/http-server.cjs`.
- Catálogos y resolución: `server/api/vidaa-api.cjs`.
- Media relay: `server/api/media.cjs` y `server/api/lib/media-token.js`.
- Fuentes: `server/providers/iptvOrgProvider.cjs` y `server/providers/m3uProvider.cjs`.
- Docker: `deploy/hostinger`.
- **No usar** Luna, LG webOS, Magis, XuperTV, proxy de evasión de bloqueos ni FFmpeg local.
- Antes de la limpieza, el código histórico quedó respaldado en `archive/xuper-webos-20261111`.

## Seguridad obligatoria
- Contraseñas, M3U upstream y secretos exclusivamente en variables del servidor; jamás en Git, navegador, logs ni screenshots.
- No habilitar reproducción VOD sin pruebas de referencias opacas, autenticación, expiración, `Range` y SSRF.
- No convertir `/api/media` en proxy abierto; validar destinos HTTPS, IP pública y DNS, mantener `Host` y SNI correctos.
- Proteger APIs con sesión o una alternativa expresamente autorizada; desactivar clave solo con aviso de exposición pública.
- La capa web debe funcionar con control remoto D-pad, OK, Back, foco visible y teclado VIDAA.

## Comprobaciones antes de desplegar
1. Revisar `git status`, diff y referencias a archivos eliminados.
2. `node --check` de todos los archivos JS/CJS modificados.
3. `node --test server/*.test.cjs server/providers/*.test.cjs`.
4. `docker build -f deploy/hostinger/Dockerfile -t tvvidaa-web .`.
5. `docker compose -f deploy/hostinger/compose.yaml config --quiet`.
6. Smoke test HTTP: `/healthz`, HTML, CSS, JS, sesión, APIs del catálogo.
7. Validación real en Hisense VIDAA de navegación, HLS, audio y control remoto; HTTP 200 solo no basta.
8. No publicar ni borrar volúmenes o sobrescribir secretos del VPS sin validar rollback. El servicio anterior puede seguir en Docker Compose fuera de Dokploy.

## Alcance de tests
- El test suite debe referirse exclusivamente al servidor web actual, codecs actuales y proveedores.
- No mantener pruebas que pasen ejercitando funciones o reproductores de la aplicación eliminada.
