# Componentes de terceros — TVVIDAA

La versión activa es una aplicación HTML5 con código propio para navegación y API del servidor. No incluye bibliotecas ni recursos gráficos extraídos de XuperTV, paquetes LG webOS, FFmpeg local ni servicios Luna.

- **IPTV-org**: únicamente se utiliza su catálogo público de metadatos y enlaces disponibles en el proyecto. La presencia de un canal no garantiza disponibilidad ni derechos de retransmisión.
- **Proveedor M3U privado**: su contenido y sus credenciales no están en este repositorio. Las URLs se obtienen en tiempo de ejecución desde variables de entorno del VPS.
- **HLS.js**: biblioteca opcional cargada de forma diferida desde jsDelivr en navegadores sin reproducción HLS nativa. Revisar licencias y obligaciones de distribución en la dependencia original: https://github.com/video-dev/hls.js

La implementación antigua se conservó en la rama de archivo `archive/xuper-webos-20261111` antes de la limpieza. Sus materiales y las licencias que pudieran requerir permanecen disponibles en esa revisión histórica, pero **no se distribuyen en la nueva aplicación**.

La licencia del código propio se especifica en [LICENSE](LICENSE). La disponibilidad legal de cada stream debe verificarse con su fuente autorizada.
