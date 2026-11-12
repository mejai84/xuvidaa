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

**VOD privado habilitado en el código:** `POST /api/resolve` acepta exclusivamente IDs internos de películas y episodios. El origen queda solo en la memoria del servidor y el navegador recibe una referencia opaca, de duración limitada. El relay HTTPS respeta `Range`/206 y reescribe manifiestos y segmentos HLS con referencias opacas. Los formatos admitidos son MP4, HLS y TS; MKV/AVI y codecs no compatibles requieren una solución de transcodificación separada. Las pruebas automatizadas usan proveedores simulados: **el streaming real, audio y control remoto deben verificarse en el Hisense antes de considerarlo operativo en producción**.

## Despliegue y variables

Consultar [Instrucciones para Hostinger/Dokploy](deploy/hostinger/README.md).

Para desarrollo local y pruebas:

```sh
node --test server/*.test.cjs server/providers/*.test.cjs
docker build -f deploy/hostinger/Dockerfile -t tvvidaa-web .
```

## Código histórico

La versión anterior de LG webOS/XuperTV está preservada en la rama `archive/xuper-webos-20261111` para revisión o restauración. Los archivos de esa implementación fueron retirados de la rama web activa y nunca se copian al Docker.

El objetivo de esta etapa es que la versión distribuida funcione completamente en el navegador HTML5 de VIDAA. La publicación en la tienda oficial de aplicaciones VIDAA es una fase distinta.

## Mejoras de experiencia familiar

- Perfiles locales independientes (Principal, Familia, Invitados), favoritos y recientes por dispositivo.
- Continuar viendo para videos reproducibles, último canal, cambio de canal y reintento limitado de señal.
- Búsqueda contextual, loader centrado y pantalla de diagnóstico que omite credenciales.
- No confundir perfiles locales con controles parentales seguros: **PIN familiar, EPG y acceso por código desde el celular aún requieren diseño y verificación adicional**.
