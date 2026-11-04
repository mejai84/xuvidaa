# Terceros y procedencia

Este repositorio contiene, además de código propio (MIT, ver `LICENSE`), dos
tipos de material que **no** se relicencia aquí.

## 1. Recursos gráficos de XuperTV

- Ruta: `webos/fidelity/assets/original/**`, `webos/fidelity/images/**`,
  `webos/fidelity/data/portal.js` (nombres y pósteres remotos del catálogo).
- Origen: APK público `com.xuper.netxxus` versión `4.34.4` (`43404`), sin
  modificar, con SHA-256
  `e70ce12782eec9f43393b69d88e2d243d8812ae38d2acf08856baa877c1ab856`.
- Uso: reconstruir la interfaz para que el port se vea como la app original.
  Los derechos siguen siendo de sus autores. Si eres titular y quieres que se
  retire algún recurso, abre un issue y se elimina.
- Los recursos se extrajeron con `tools/DumpRes.java` / `ares-package` y se
  documentan en `webos/fidelity/INVENTARIO_RECURSOS.md`.

## 2. FFmpeg

- Archivo: `tools/vendor/ffmpeg-7.0.2-armhf-static.tar.xz`
  (SHA-256 `7D41F558CB1F3395B313F8CEABED78B3731C79A0962ABF405EBB5CD393E93991`).
- Binario resultante: `webos/services/com.webosflux.xuptertv.fidelity.service/ffmpeg`
  (SHA-256 `0AFBA4A11110E6E402053E0FC14C33A7EB207D7A588688AE87DBA471A0F06C71`),
  estático para armhf.
- Licencia: **GNU GPL v3**. El texto completo viaja en
  `webos/services/com.webosflux.xuptertv.fidelity.service/ffmpeg-LICENSE.txt`
  y se incluye dentro del IPK.
- El binario no se versiona (`.gitignore`); se restaura con
  `tools/setup-ffmpeg.ps1`, que verifica ambos hashes antes de copiarlo.

## 3. Herramientas de desarrollo

- `@webos-tools/cli` (ares-*), licencia Apache-2.0, dependencia externa: no se
  redistribuye.
- `ssh2` (usado por los scripts de despliegue), licencia MIT: se resuelve desde
  la instalación local o la de ares-cli (`tools/ssh2-loader.mjs`).

## 4. Contenido y servicio

El repositorio no incluye contenido audiovisual ni credenciales. La app
consulta el portal en tiempo de ejecución con una sesión anónima de
dispositivo; la disponibilidad del servicio depende de su proveedor.

## 5. HLS.js (navegador HTML)

- Versión: `1.6.13`, distribución completa de `video-dev/hls.js`, licencia Apache-2.0.
- Se carga desde jsDelivr con versión fija e integridad SHA-384 en
  `webos/fidelity/index.html`.
- Uso: reproducción HLS y conversión de TS (H.264/H.265) a Media Source en el
  navegador; el equipo necesita un decodificador compatible con el códec.
- Fuente y licencia: https://github.com/video-dev/hls.js/tree/v1.6.13
