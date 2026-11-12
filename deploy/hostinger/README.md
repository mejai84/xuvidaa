# TVVIDAA — aplicación HTML5 web para Hisense VIDAA

## Arquitectura actual (sin Luna ni webOS en ejecución)

- **Interfaz:** `web/index.html`, `web/js/app.js`, `web/css/app.css`.
- **Servidor:** `server/http-server.cjs` (Node.js 22), que sirve el directorio `web/`.
- **API propia:** `server/api/vidaa-api.cjs`, accesible por `POST /api/{metodo}`.
- **Fuentes:** IPTV-org para TV en vivo; M3U privada configurada en el VPS para películas/series.
- **Medios:** `server/api/media.cjs`, relay HTTPS con referencias temporales cifradas. La UI nunca recibe la contraseña del proveedor.
- **Seguridad:** sesiones con cookies HttpOnly, limitación de intentos, cabeceras de seguridad, tokens multimedia cifrados y protección SSRF/DNS.
- **Compatibilidad:** HTML5/JavaScript sin Luna, sin servicio de LG ni paquetes IPK; control D-pad por eventos de teclado (Arriba, Abajo, Izquierda, Derecha, OK y Back).
- **Diseño:** TV a pantalla completa y vista adaptable al móvil; tres secciones con búsqueda propia.

El directorio histórico `webos/` permanece en el repositorio únicamente como referencia y posible rollback; **no se copia al Docker ni se utiliza para servir esta nueva interfaz**. No borrar los archivos antiguos hasta validar el despliegue en el televisor físico.

## Despliegue Dokploy

Servicio exclusivo `xuvidaa-tv`, repositorio `mejai84/xuvidaa`, rama `hostinger-vps`, archivo `deploy/hostinger/compose.yaml`, dominio `https://tv.rfcsas.com/`.

No tocar los demás servicios o redes del VPS. El Compose mantiene la red `xuvidaa-tv-private` y monta el volumen persistente `xuvidaa-catalog-cache` para `server/.cache`. Traefik entrega HTTPS.

### Variables de entorno (en Dokploy, no en Git)

| Variable | Función |
| --- | --- |
| `PUBLIC_BASE_URL` | `https://tv.rfcsas.com` |
| `MEDIA_TOKEN_SECRET` | Secreto aleatorio de al menos 32 caracteres |
| `VIDAA_WEB_PASSWORD` | Contraseña web de al menos 14 caracteres |
| `VIDAA_SESSION_SECRET` | Secreto de sesión diferente, al menos 32 caracteres |
| `IPTV_COUNTRY` | `CO` |
| `IPTV_LANG` | `spa` |
| `IPTV_EXCLUDE_NSFW` | `true` |
| `M3U_BASE_URL`, `M3U_USERNAME`, `M3U_PASSWORD`, `M3U_TYPE` | Datos privados del proveedor M3U |

Temporalmente, la configuración acepta `XUPER_WEB_PASSWORD` y `XUPER_SESSION_SECRET` ya existentes, de forma que no es necesario exponer ni volver a escribir secretos durante la transición. Renombrarlos en Dokploy tras validar el despliegue, y eliminar entonces las variables antiguas.

El modo sin contraseña es **opcional y no está activado por defecto**. Requiere configurar explícitamente `VIDAA_PASSWORDLESS=true` y `VIDAA_PUBLIC_ACCESS_ACK=yes`, lo que permite que cualquiera con acceso al sitio consulte los catálogos; si el uso es familiar, se recomienda mantener la autenticación u otra barrera de acceso.

## Pruebas

```sh
node --test server/*.test.cjs server/providers/*.test.cjs tools/*.test.cjs
docker build -f deploy/hostinger/Dockerfile -t tvvidaa-web .
docker compose -f deploy/hostinger/compose.yaml config --quiet
```

Antes de publicar: ejecutar CI, verificar `/healthz`, `/api/session`, `/api/liveCategories`, `/api/liveChannels`, `/api/m3uMovies`, `/api/m3uSeries` con sesión autorizada, y probar señal HLS/sonido en un dispositivo VIDAA real.

**Estado de reproducción VOD:** el catálogo M3U muestra películas, series, temporadas y episodios, pero `POST /api/resolve` devuelve HTTP 501 intencionalmente. Activarlo requiere completar las verificaciones de seguridad de reproducción y recuperación del índice privado en frío. No confundir portada/catálogo disponible con reproducción verificada.

## Rollback

Si un despliegue falla en VIDAA, restaurar la revisión anterior del contenedor `xuvidaa-tv` desde Dokploy. No borrar volúmenes, secretos ni datos de catálogo. El código heredado permanece en Git como referencia de rollback.

## Instalación como app nativa de la tienda VIDAA

Esta versión funciona como **sitio web HTML5 por HTTPS en el navegador del televisor**. Publicarla en una tienda oficial VIDAA requiere un proceso adicional con el programa de desarrolladores/partners; no se presupone que abrir la URL la instale en el sistema.
