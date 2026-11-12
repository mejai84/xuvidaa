# Auditoría y limpieza de código — TVVIDAA

**Fecha:** 11 de noviembre de 2026 (Colombia). **Base:** rama `hostinger-vps`, commit `2393636`.

## Inventario verificado
El árbol revisado contenía 265 archivos: 199 en `webos/`, 27 en `tools/`, 7 en `docs/`, 16 en `server/`, 3 en `web/` y varios de configuración. Incluía herramientas de LG, Magis, Luna, recursos gráficos de Xuper y un archivo FFmpeg de ~16 MB que la aplicación HTML5 actual no necesita.

## Decisión por módulo
| Grupo | Decisión | Razón |
| --- | --- | --- |
| `web/` | Conservar | Interfaz exclusiva HTML5/VIDAA; TV, Películas, Series y búsqueda contextual |
| `server/http-server.cjs` | Conservar y limpiar | HTTPS detrás de Traefik, sesión, allowlist estática, protección de rutas |
| `server/api/` | Conservar | API y relay propios, tokens cifrados, sin dependencia Luna |
| `server/providers/`, `server/services/` | Conservar | IPTV-org y metadatos del proveedor M3U |
| `deploy/hostinger/` | Conservar | Docker Compose del VPS; red privada y volumen caché |
| `webos/` | Retirar del árbol activo | Cliente IPK, Luna, Magis, scripts y diseño Xuper no usados |
| `tools/` | Retirar del árbol activo | Pruebas y utilidades de Xuper/instalación LG, duplicados |
| `docs/` antiguo, `res/`, instalador BAT | Retirar | Documentación/capturas Xuper sin vigencia |
| Pruebas antiguas del API Magis/webOS | Sustituir | Probar el cliente/codec API nuevos, no código muerto |
| `THIRD_PARTY.md`, `AGENTS.md` | Actualizar | Licencias, restricciones y arquitectura aplicables a la app actual |

## Respaldo
Se creó `archive/xuper-webos-20261111` apuntando al commit base, antes de eliminar los recursos antiguos de la rama de trabajo. La historia de Git sigue disponible para rollback.

## Deuda técnica y riesgos (no confundir con completado)
1. **VOD privado**: se implementó `resolve` con IDs internos, referencias opacas, reinicio desde caché y pruebas simuladas de `Range`/206 y HLS. **Pendiente:** streaming real, codecs/audio del televisor y cualquier origen HTTP que no ofrezca HTTPS.
2. **Reproducción VIDAA real**: compatibilidad HLS/códecs/audio y controles debe verificarse físicamente en el Hisense.
3. **M3U en Dokploy**: no hay constancia de variables reales correctamente pasadas al contenedor. No guardar ni imprimir credenciales en comandos.
4. **Migración de secretos**: los alias `XUPER_*` permanecen temporalmente en configuración para evitar cortar la instalación actual. Rotar los secretos previamente expuestos y luego retirar los alias.
5. **UI**: añadidos perfiles locales, favoritos, recientes, continuar viendo, último canal, cambio de canales y pantalla de diagnóstico. Pendientes: guía EPG fiable, PIN parental, acceso por código desde móvil y recomendaciones avanzadas; no se simulan datos inexistentes.
6. **Producción**: el contenedor anterior seguía mostrando `Xuper HTTP listo`, con gestión Compose externa. No actualizar ni renombrar servicios a ciegas: inspeccionar `/opt/xuvidaa-tv` y hacer despliegue con rollback.

## Criterios de aceptación
- 0 importaciones o rutas de ejecución relativas al cliente antiguo.
- Tests relevantes para la aplicación actual y ejecución CI completamente verde.
- Docker arranca con la portada `TVVIDAA` sin copiar `webos/` ni `tools/`.
- Sesiones, credenciales y tokens nunca salen a una respuesta pública.
- Publicación en producción **solo después de la validación de VPS y TV real**.
