# TVVIDAA

Aplicación **HTML5 web para televisores Hisense VIDAA**, accesible por HTTPS y adaptable a navegadores móviles y de escritorio.

Esta es una aplicación propia, **no una réplica de XuperTV ni un cliente Luna/webOS**.

## Interfaz

- TV en vivo: canales IPTV-org con filtros y búsqueda de canales.
- Películas: catálogo privado M3U y buscador de películas.
- Series: catálogo privado M3U, buscador de series, temporadas y episodios.
- Navegación con control remoto: flechas, OK, Back y controles de reproducción.
- Búsqueda por sección activa: no mezcla canales, películas y series.
- Diseño a pantalla completa en TV y adaptable a teléfonos.

## Arquitectura activa

| Componente | Ubicación |
| --- | --- |
| HTML5 | `web/index.html` |
| JavaScript VIDAA | `web/js/app.js` |
| Estilos | `web/css/app.css` |
| HTTP + sesiones | `server/http-server.cjs` |
| API TVVIDAA | `server/api/vidaa-api.cjs` |
| Medios HTTPS | `server/api/media.cjs` |
| Catálogo IPTV-org | `server/providers/iptvOrgProvider.cjs` |
| Catálogo M3U privado | `server/providers/m3uProvider.cjs` |
| Docker/Dokploy | `deploy/hostinger/` |

No se necesitan servicios Luna, aplicaciones LG, IPK o FFmpeg local. El servidor aloja directamente la web y las rutas `/api/*` en el mismo dominio. Las credenciales de las fuentes viven únicamente en las variables privadas del servidor.

**Importante:** la nueva arquitectura no habilita por defecto la reproducción de películas/episodios M3U; su resolución requiere pasar las verificaciones de seguridad y recuperación del índice. No se debe prometer reproducción VOD hasta completar esas pruebas. La TV en vivo utiliza la resolución IPTV-org con token y relay HTTPS.

## Despliegue y variables

Consultar [Instrucciones para Hostinger/Dokploy](deploy/hostinger/README.md).

Para desarrollo local y pruebas:

```sh
node --test server/*.test.cjs server/providers/*.test.cjs tools/*.test.cjs
docker build -f deploy/hostinger/Dockerfile -t tvvidaa-web .
```

## Código histórico

El directorio `webos/` conserva la implementación anterior como **archivo de referencia y rollback**, pero no se utiliza en el Docker ni en la interfaz web nueva. Se eliminará después de verificar la experiencia y la reproducción en el Hisense real, sin perder el mecanismo de restauración.

El objetivo de esta etapa es que la versión distribuida funcione completamente en el navegador HTML5 de VIDAA. La publicación en la tienda oficial de aplicaciones VIDAA es una fase distinta.
