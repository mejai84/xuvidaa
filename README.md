<div align="center">

# XuperTV para LG webOS

**Port nativo de XuperTV 4.34.4 a televisores LG webOS 4** — HTML/CSS/JS sobre
Chromium 53, catálogo real del portal, TV en vivo con categorías y reproducción
con relay FFmpeg integrado.

![webOS 4](https://img.shields.io/badge/webOS-4.x-a50034?style=flat-square&logo=lg&logoColor=white)
![Chromium 53](https://img.shields.io/badge/Chromium-53-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![1920x1080](https://img.shields.io/badge/render-1920%C3%971080-0b7285?style=flat-square)
![versión](https://img.shields.io/badge/IPK-1.6.16-c91923?style=flat-square)
![licencia](https://img.shields.io/badge/c%C3%B3digo-MIT-2ea44f?style=flat-square)

[Instalación](#instalación-en-el-televisor) ·
[Compilar](#compilar-el-ipk) ·
[Arquitectura](#arquitectura) ·
[Desarrollo local](#desarrollo-local) ·
[Problemas frecuentes](#problemas-frecuentes) ·
[Contribuir](#contribuir)

</div>

![Inicio con el catálogo real](docs/screenshots/home.jpg)

---

## Qué es esto

Una reconstrucción del cliente **XuperTV 4.34.4** (`com.xuper.netxxus`) para
televisores LG con webOS 4. No es un emulador ni un wrapper: la interfaz está
reescrita en HTML/CSS/JavaScript pensada para el motor Chromium 53 del
televisor, y un servicio Node propio habla el protocolo cifrado del portal
Magis para traer catálogo, búsqueda, detalle, canales en vivo y URLs de
reproducción.

El objetivo es que en un LG de 2019 se sienta como la app de Android TV:
misma disposición, mismos recursos gráficos, mismo mando a distancia.

| | |
|---|---|
| **Probado en** | LG 43LM6300PDB · webOS 4.10.2-29 · 1920×1080 |
| **ID de paquete** | `com.webosflux.xuptertv.fidelity` |
| **Versión actual** | `1.6.16` |
| **Runtime** | Chromium 53 (web app) + Node antiguo del TV (servicio) |
| **Dependencias en el TV** | ninguna: FFmpeg viaja dentro del IPK |

## Estado actual

| Área | Estado |
|---|---|
| Inicio, 7 pestañas, detalle, búsqueda, ajustes | ✅ funcionando con datos reales |
| TV en vivo (1 000+ canales, 38 categorías) | ✅ funcionando, con filtro por categoría |
| Reproductor VOD (HLS/TS/MP4) | ✅ funcionando |
| Audio y subtítulos reales del portal | ✅ selector en el panel y en «Ajuste de reproducir» |
| Series: temporadas y episodios | ✅ navegador tipo Netflix dentro del reproductor |
| «Modo fluido» (relay FFmpeg local) | ✅ para HEVC/TS; por título, no se filtra entre películas |
| DNS bloqueado por la operadora | ✅ DNS seguro (DoH) + diagnóstico en Ajustes |
| Modo desarrollador / instalación por IPK | ✅ |
| Comparación píxel a píxel con Android TV | ⚠️ pendiente de referencias verificables |
| DRM, geobloqueo, control parental del portal | ❌ fuera de alcance (no se elude nada) |

Detalle fino de lo que falta en
[`DIFERENCIAS_PENDIENTES.md`](webos/fidelity/DIFERENCIAS_PENDIENTES.md).

## Capturas

| TV en vivo · panel de canales | Categorías (38 columnas del portal) |
|---|---|
| ![Panel de canales](docs/screenshots/live-panel.png) | ![Categorías](docs/screenshots/live-categories.png) |

| Canales filtrados por «Deportes» | Búsqueda real |
|---|---|
| ![Deportes](docs/screenshots/live-panel-filtered.png) | ![Búsqueda](docs/screenshots/search.jpg) |

## Funcionalidades

- **Inicio con 7 pestañas** (TV, Destacados, Película, Series, Kids, Anime,
  Explorar) y carrusel destacado, con el catálogo real del portal.
- **TV en vivo**: lista lateral de canales, rail de categorías, selector a
  pantalla completa con las 38 columnas del portal y filtrado real por
  categoría. El canal que suena no se corta al filtrar.
- **Detalle VOD**: sinopsis, reparto, géneros, temporadas, episodios y
  recomendaciones; el botón «Idioma» abre el mismo diálogo de audio/subtítulos
  que el reproductor.
- **Reproductor**: barra con auto-ocultado, seek, pausa, salto ±10 s, panel de
  ajustes, cambio de audio por el relay y subtítulos por el proxy local.
- **Series**: navegador de episodios a pantalla completa; elegir el episodio 6
  reproduce el episodio 6 y el detalle queda sincronizado al volver.
- **«Modo fluido»**: por título (`seriesId || id`), por defecto **No**; una
  película no hereda el modo de otra y una serie lo conserva entre episodios.
- **Búsqueda** con teclado en pantalla, historial y resultados paginados.
- **Ajustes**: cuenta local, mi lista, compartir, bloqueo, configuración global,
  ayuda y «sobre nosotros».
- **Navegación completa con D-pad**, foco visible, botón Back y atajos de mando.
- **Sin dependencias externas en el televisor**: el binario FFmpeg (7.0.2 armhf,
  estático) se instala junto con la app.

## Instalación en el televisor

### La forma fácil (sin comandos)

Pensado para quien solo tiene el archivo y no quiere tocar una terminal:

1. Consigue la carpeta `XuperTV-instalador-<versión>` (o el ZIP
   `dist/XuperTV-instalador-<versión>.zip`, que se genera con
   `tools/make-kit.ps1`).
2. Extráela y haz **doble clic en `INSTALAR-XUPERTV.bat`**.
3. Escribe la **IP** del televisor y la **clave** que muestra la app
   *Developer Mode* (se pide una sola vez: el instalador la comprueba con la TV
   antes de copiar nada).
   Si no sabes la IP —o ha cambiado al reiniciar la TV— escribe **`B`** y el
   instalador la busca solo en tu red local (puerto 9922 o 22).
4. Espera a que diga **LISTO**: la app se abre sola en la TV.

No hace falta Node.js ni `ares-cli`: usa el cliente SSH que ya trae Windows
10/11. El instalador sube el IPK, lo instala con el servicio de webOS, verifica
la versión, comprueba que `ffmpeg` quedó ejecutable y abre la app. También avisa
si el PC y la TV están en redes distintas.

Detalles que resuelve solo, porque son la causa habitual de que falle:

- **Puerto**: las TV LG tienen el SSH del modo desarrollador en el **9922**
  (no en el 22). Prueba 9922 y 22 y usa el que responda.
- **Criptografía antigua**: webOS 4 lleva OpenSSH 6.1, que solo ofrece
  `ssh-rsa`/SHA-1 y OpenSSH 9 de Windows rechaza por defecto. El instalador
  reactiva esos algoritmos **solo para esa conexión**.
- **Copia**: usa el subsistema **SFTP** del modo desarrollador (la TV no trae
  `scp` ni `sftp-server` en el `PATH`); si fallara, reintenta con `scp -O`.
- **Cuenta**: el nombre de usuario cambia según el firmware (`prisoner` en la
  mayoría, `prisioner` en algunas TV). Se prueban los dos y se recuerda el que
  funcione en `tools/instalar-config.json`.
- **KEY SERVER**: si la TV lo tiene activado no acepta la clave como contraseña.
  En ese caso publica una clave privada cifrada en `http://IP:9991/webos_rsa`
  (lo mismo que hace `ares-novacom --getkey`). El instalador la descarga, la
  descifra con la passphrase de Developer Mode y entra con `ssh -i`. Se prueba
  primero la contraseña y, si falla, la llave; la clave se borra al terminar.

- Guía visual paso a paso (se abre sin internet, incluye **modo presentación**
  para grabar): [`docs/instalar/index.html`](docs/instalar/index.html)
- Guion del vídeo tutorial: [`docs/instalar/guion-video.md`](docs/instalar/guion-video.md)

### Instalación manual (ares-cli)

Requisitos:

- LG con **webOS 4.0 o superior** (probado en 4.10.2-29) y 1 GB de RAM.
- PC en la misma red que el televisor.
- [Node.js 18+](https://nodejs.org/) y `@webos-tools/cli`:
  ```bash
  npm i -g @webos-tools/cli
  ```
- Modo desarrollador activado en el televisor (app **Developer Mode** de LG,
  sesión con cuenta LG Developer, reinicio).

### 1. Emparejar el televisor

```bash
ares-setup-device            # añade el TV por IP; usuario: prisoner
ares-novacom --device tv --getkey   # instala la clave SSH
ares-device-info --device tv
```

### 2. Instalar el IPK

```bash
ares-install --device tv dist/com.webosflux.xuptertv.fidelity_1.6.16_all.ipk
ares-launch  --device tv com.webosflux.xuptertv.fidelity
```

Si `ares-install` falla **después** de subir el paquete (pasa en algunos
webOS 4: el `ls`/`md5` posterior al upload no responde), usa el instalador
directo por SSH + Luna que incluye el repo:

```bash
TV_HOST=192.168.1.50 TV_PASS=tu_clave node tools/tv_deploy.mjs dist/com.webosflux.xuptertv.fidelity_1.6.16_all.ipk
```

`tv_deploy.mjs` sube el IPK por SFTP a `/media/developer/temp/` y llama a
`com.webos.appInstallService/dev/install`. Es el camino que se usa a diario en
este proyecto porque es el único estable en el televisor de pruebas.

### 3. Comprobar que el relay quedó ejecutable

El empaquetado en Windows puede perder el bit de ejecución de FFmpeg. El script
de build lo repara (`tools/fix_ipk_modes.py`), pero si el «Modo fluido» no
arranca, verifícalo:

```bash
node tools/tv_exec.mjs "ls -l /media/developer/apps/usr/palm/services/com.webosflux.xuptertv.fidelity.service/ffmpeg"
# esperado: -rwxr-xr-x
```

Si aparece `-rw-r--r--`, reinstala el IPK generado con
`tools/build-ipk.ps1` (o aplica `chmod 755` por SSH).

Guía extendida, desinstalación y notas de red:
[`webos/INSTRUCCIONES_INSTALACION.md`](webos/INSTRUCCIONES_INSTALACION.md).

## Compilar el IPK

```bash
git clone https://github.com/cristianco7/XUPER-HYDRA-PORT-WEBOS.git
cd XUPER-HYDRA-PORT-WEBOS

# Windows (PowerShell): restaura FFmpeg si falta, empaqueta app + servicio y
# reescribe data.tar.gz para conservar el bit 0755 del binario.
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-ipk.ps1

# Linux/macOS
powershell -NoProfile -ExecutionPolicy Bypass -File tools/setup-ffmpeg.ps1 2>/dev/null || \
  tar -xJf tools/vendor/ffmpeg-7.0.2-armhf-static.tar.xz -C /tmp
ares-package webos/fidelity webos/services/com.webosflux.xuptertv.fidelity.service -o dist -e shots -e '*.md'
python3 tools/fix_ipk_modes.py dist/com.webosflux.xuptertv.fidelity_1.6.16_all.ipk
```

Salida de referencia (build 1.6.16):

| Dato | Valor |
|---|---|
| Archivo | `dist/com.webosflux.xuptertv.fidelity_1.6.16_all.ipk` |
| Tamaño | 22 469 306 bytes (21,4 MiB) |
| SHA-256 | `174DC8E9DB58D760EB704BFC13D26BEF7A8663D009746B9F56445C38910D957D` |

El IPK incluye la web app, el servicio Luna, `ffmpeg` (31,8 MB) y
`ffmpeg-LICENSE.txt`. Por eso pesa ~22 MB: es una instalación de un solo paso,
sin descargas en el televisor.

## Arquitectura

```
┌──────────────────────────── televisor LG (webOS 4) ────────────────────────────┐
│                                                                                │
│  com.webosflux.xuptertv.fidelity            (web app · Chromium 53)            │
│  ├─ index.html + css/style.css              pantallas y foco D-pad             │
│  ├─ js/app.js                               navegación, panel, reproductor     │
│  ├─ data/portal.js                          snapshot del catálogo (pinta ya)   │
│  └─ config/api.js                           modo portal / estático / backend   │
│                    │  Luna (webOS.service)                                     │
│                    ▼                                                           │
│  com.webosflux.xuptertv.fidelity.service    (Node del TV · ES5)                │
│  ├─ magis.js        3DES + POST /api/portalCore  (home, search, detail,        │
│  │                  resolve, liveCategories, liveChannels, resolveLive)        │
│  ├─ proxy.js        proxy loopback para HLS/TS y subtítulos                    │
│  ├─ ffmpeg-relay.js relay local: TS/HEVC → fMP4 (hvc1) para «Modo fluido»      │
│  ├─ ts-indexer.js   índice de segmentos para seek                              │
│  └─ ffmpeg          binario 7.0.2 armhf estático (GPLv3)                       │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
                    │ HTTPS (protocolo del portal, sesión anónima)
                    ▼
             portal Magis de XuperTV
```

Puntos clave:

- El portal **no manda cabeceras CORS** y el cuerpo va cifrado
  (`hex(base64(3DES-EDE/ECB/PKCS7(JSON)))`), así que el protocolo vive en el
  servicio Node, nunca en la página.
- La página pinta al instante con `data/portal.js` y luego refresca desde el
  servicio; búsqueda, detalle y `resolve` siempre van en vivo.
- `resolve` devuelve `{base}/vod/{mediaId}_media.{ts|mp4}`. Los TS se sirven a
  través del proxy loopback como HLS; el «Modo fluido» añade el relay FFmpeg
  para que el decodificador del TV reciba fMP4 en lugar de MPEG-TS.
- En el televisor no se descarga nada: FFmpeg y el servicio viajan en el IPK.

## Navegador y servidor persistente

La versión HTML usa `webos/fidelity` y sus rutas `/api`. Para mantener la
interfaz en Vercel y ejecutar el servicio en un VPS, o alojar ambos en el VPS,
consulta la [guía de Hostinger](deploy/hostinger/README.md). El despliegue usa
un contenedor y puerto local propios, conservando los recursos visuales de
la app. Primero comprueba el acceso real al portal con
`node tools/check-portal.cjs`: una respuesta HTTP en la raíz del dominio no
confirma que el proveedor acepte la sesión. El runtime HTTP no incluye
FFmpeg ni el servicio Luna de LG.

## Desarrollo local

La app detecta `?service=http://127.0.0.1:8910` y usa un espejo HTTP del
servicio en lugar de Luna, así que se puede trabajar en el PC con Chromium.

```bash
# terminal 1 — espejo del servicio (catálogo, vivo, resolve, proxy de medios)
node tools/dev_service.mjs 8910

# terminal 2 — web app
cd webos/fidelity
python -m http.server 8899 --bind 127.0.0.1
```

Abre `http://127.0.0.1:8899/index.html?service=http://127.0.0.1:8910`.

Enlaces directos:

```
?screen=welcome
?screen=home&tab=0..6
?screen=detail&vod=1
?screen=search&q=dragon
?screen=settings&panel=0..6
?screen=player                       (TV en vivo)
?screen=player&channels=1            (panel de canales abierto)
?screen=player&mode=vod&vod=3        (VOD)
```

Consola del navegador (`window.__xuper`):

```js
__xuper.state                  // pantalla, foco, canal, episodio, modo…
__xuper.vod                    // catálogo cargado
__xuper.channels               // canales en vivo del portal
__xuper.service('search', {value: 'dragon'}, console.log)
__xuper.key(38)                // simula una tecla del mando
__xuper.show('player')
__xuper.openPlayer('vod', 3)
```

> En Chromium de escritorio no hay decodificador H.265: el vídeo real solo se
> valida en el televisor. Todo lo demás (foco, filtros, listas, paneles) se
> puede probar en el PC.

## Modo fluido (relay FFmpeg)

Algunos VOD del portal llegan en MPEG-TS con HEVC y el reproductor de webOS 4
los entrecorta. El «Modo fluido» arranca un FFmpeg local que copia los streams
(`-c copy`) a un fMP4 con etiqueta `hvc1` y lo sirve en
`http://127.0.0.1:8787/s/<token>.mp4`.

- Se elige **por título**: `smoothModeByTitle[seriesId || id]`, por defecto
  **No**. Una película no hereda el ajuste de otra y una serie lo mantiene
  entre episodios.
- Solo se activa para HEVC/TS; el resto usa el proxy directo.
- El audio se cambia a través del relay (`&a=<índice>`) porque el pipeline
  nativo no permite cambiar de pista en caliente.
- Si FFmpeg no está o no es ejecutable, el modo fluido falla y se ve el aviso
  de stream; revisa el paso 3 de la instalación.

Contrato que **no se debe romper** al tocar la app (está descrito en
[`AGENTS.md`](AGENTS.md)): Normal usa el proxy directo; Modo Fluido usa
obligatoriamente `resolveSmooth` y una URL local `127.0.0.1:8787/s/<token>.mp4`.

## Bloqueos de operador (DNS) y diagnóstico de red

En países como Chile las operadoras bloquean el servicio envenenando el DNS:
el televisor pregunta por el dominio del portal/CDN y recibe una dirección
muerta, así que el vídeo falla aunque los servidores estén funcionando. No es
una VPN ni un bloqueo de puerto, es la respuesta DNS.

El servicio incluye `dnsx.js`, un resolutor **DNS-over-HTTPS**:

- Pregunta a Cloudflare (`1.1.1.1`, `1.0.0.1`), Google (`8.8.8.8`,
  `8.8.4.4`) y AdGuard (`94.140.14.14`, `94.140.15.15`) **por IP**, con el
  `Host`/SNI correcto, así que el DNS de la operadora nunca participa.
- Se consultan los seis a la vez y gana el primero que responde; si ninguno
  responde en 5 s se usa el DNS del televisor (el comportamiento anterior) y
  se deja de insistir durante 5 minutos.
- El resultado se guarda en caché 10 minutos y se usa para el portal, las
  semillas y el proxy de vídeo (`lookup` en las peticiones HTTP/HTTPS), que
  sigue enviando el nombre real para SNI y `Host`.

En **Ajustes → Diagnóstico** la app muestra, por cada dominio, lo que dice el
DNS del televisor, lo que dice el DNS seguro, y si la conexión TCP/HTTPS
funciona. Los estados posibles son: *Correcto*, *DNS alterado* (la operadora
intercepta el nombre pero la app conecta por la dirección real), *Bloqueado*
(el DNS del televisor no resuelve nada y el DNS seguro lo esquiva), *Sin
conexión* (no hay salida a internet) y *DNS seguro bloqueado*. Un CDN rotativo
que no conteste en ese instante se muestra como aviso ámbar, no como fallo
total. La última línea del panel resume
`Pantalla · panel · escala · versión`, útil para diagnosticar recortes de
interfaz con una simple foto.

## Estructura del repositorio

```
webosflux/
├─ INSTALAR-XUPERTV.bat              instalador de doble clic para usuarios
├─ webos/
│  ├─ fidelity/                     app web final (la que se empaqueta)
│  │  ├─ index.html, css/, js/, data/, config/, assets/, images/
│  │  └─ *.md                       auditoría, mapa de pantallas, diferencias…
│  ├─ services/                     servicio Luna + FFmpeg + proxy + relay
│  └─ …                             prototipo antiguo (histórico, no es la app)
├─ tools/
│  ├─ instalar-tv.ps1               motor del instalador (SSH + Luna, sin Node)
│  ├─ make-kit.ps1                  empaqueta el ZIP que se comparte
│  ├─ build-ipk.ps1                 build de un paso (app + servicio + modos)
│  ├─ setup-ffmpeg.ps1              restaura el binario desde tools/vendor
│  ├─ fix_ipk_modes.py              fuerza 0755 en ffmpeg dentro del IPK
│  ├─ dev_service.mjs               espejo HTTP del servicio para el PC
│  ├─ tv_deploy.mjs                 sube e instala el IPK por SFTP + Luna
│  ├─ tv_exec.mjs / tv_luna.mjs     utilidades SSH para depurar el televisor
│  ├─ ssh2-loader.mjs               localiza ssh2 sin rutas absolutas
│  └─ vendor/                       FFmpeg 7.0.2 armhf estático (tar.xz)
├─ docs/
│  ├─ instalar/                     guía visual + guion del vídeo
│  └─ screenshots/                  capturas usadas en este README
└─ dist/                            IPKs y kits generados (no versionados)
```

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/instalar/index.html`](docs/instalar/index.html) | Guía visual de instalación para usuarios (sin comandos) |
| [`docs/instalar/guion-video.md`](docs/instalar/guion-video.md) | Guion del vídeo tutorial, escena por escena |
| [`webos/fidelity/README_FIDELITY.md`](webos/fidelity/README_FIDELITY.md) | Estado del port y estructura interna |
| [`webos/fidelity/MAPA_PANTALLAS.md`](webos/fidelity/MAPA_PANTALLAS.md) | Pantalla → layout del APK → recursos → CSS/JS |
| [`webos/fidelity/COMPARACION_VISUAL.md`](webos/fidelity/COMPARACION_VISUAL.md) | Medidas XML frente al render 1920×1080 |
| [`webos/fidelity/DIFERENCIAS_PENDIENTES.md`](webos/fidelity/DIFERENCIAS_PENDIENTES.md) | Lo que falta, con motivo y condición de cierre |
| [`webos/fidelity/INVENTARIO_RECURSOS.md`](webos/fidelity/INVENTARIO_RECURSOS.md) | Recursos originales y procedencia |
| [`webos/fidelity/AUDITORIA_IPK.md`](webos/fidelity/AUDITORIA_IPK.md) | Auditoría del IPK y del APK |
| [`webos/INSTRUCCIONES_INSTALACION.md`](webos/INSTRUCCIONES_INSTALACION.md) | Instalación paso a paso y desinstalación |
| [`AGENTS.md`](AGENTS.md) | Reglas del proyecto (zona protegida de reproducción) |

## Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `ares-install` termina con error tras subir | `ls`/`md5` posterior al upload falla en webOS 4. Usa `node tools/tv_deploy.mjs <ipk>`. |
| `Bad configuration option: pubkeyacceptedalgorithms` al instalar | Windows 10 20H2 trae OpenSSH 8.1 (solo entiende `PubkeyAcceptedKeyTypes`) y se estaba usando un `instalar-tv.ps1` viejo. El instalador actual detecta el nombre válido con `ssh -G`; extrae el ZIP completo en una carpeta limpia. |
| La interfaz se ve recortada en TV 720p, 2K o 4K | La app escala el lienzo de 1920×1080 al viewport real y, si el panel es menor que la ventana, se ajusta al panel. Revisa **Ajustes → Imagen → Relación de aspecto → Solo escaneo**. Para un modelo concreto, envía una foto de **Ajustes → Diagnóstico** (incluye `Pantalla · panel · escala`). |
| «No se pudo abrir el stream» en todos los canales | El servicio no está corriendo o el portal no responde. Comprueba `node tools/tv_luna.mjs luna://com.webosflux.xuptertv.fidelity.service/ping`. |
| «No se pudo abrir el stream (código 4)» en un país con bloqueos | Abre **Ajustes → Diagnóstico**: si algún dominio dice *DNS alterado*, la operadora envenena el DNS y la app ya usa el DNS seguro. Reinstala la versión 1.6.16 o superior si ese menú no existe. |
| El Modo fluido no arranca | `ffmpeg` sin permiso de ejecución (paso 3) o relay ocupado; mira los logs del servicio. |
| Pantalla en negro al abrir la app | IPK antiguo o instalación a medias: reinstala la versión actual y lanza con `ares-launch`. |
| Los canales no filtran / no se puede ir a las categorías | Versión < 1.5.9. En 1.5.9 el rail conserva el foco y **Arriba** abre el selector de las 38 categorías. |
| «Unexpected token» en el servicio | Algún JSON se guardó con BOM; el Node del televisor no lo tolera. Guarda sin BOM. |
| El TV no aparece en `ares-device-info` | Modo desarrollador caducado (hay que renovarlo cada 50 h) o IP cambiada. |

## Contribuir

Las contribuciones son bienvenidas: informes de fallos en otros modelos LG,
capturas de referencia de Android TV, mejoras de foco/accesibilidad y
correcciones de compatibilidad con Chromium 53.

Antes de enviar un PR:

1. `node --check` sobre cada `.js` tocado.
2. Probar en `http://127.0.0.1:8899` con `?service=http://127.0.0.1:8910`.
3. **No** tocar la zona protegida de reproducción (`streamMode`, `forceRelay`,
   `resolveSmooth`, `restartCurrentPlayback`, `playUrl`, seek, cambio de
   episodio) sin autorización explícita: está documentada en
   [`AGENTS.md`](AGENTS.md).
4. Si cambias versión, sube a la vez `webos/fidelity/appinfo.json` y
   `webos/services/…/package.json` (el build avisa si no coinciden).

## Aviso legal y licencia

- Proyecto **no oficial**, sin relación con XuperTV ni con LG. No incluye ni
  aloja contenido audiovisual: reproduce lo que el portal autorizado del
  usuario devuelve.
- No se elude DRM, geobloqueo, autenticación ni control parental; no se
  extraen tokens ni sesiones de otras apps; no se modifica el APK original.
- Los recursos gráficos reutilizados del APK (`webos/fidelity/assets/original`)
  siguen siendo propiedad de sus autores y se usan aquí con fines de
  interoperabilidad y estudio; **no** están cubiertos por la licencia del
  código.
- El binario FFmpeg se distribuye bajo **GPLv3**; su licencia viaja en
  `ffmpeg-LICENSE.txt` dentro del IPK.
- El código propio de este repositorio se publica bajo **MIT** (ver
  [`LICENSE`](LICENSE)). Detalles de terceros en
  [`THIRD_PARTY.md`](THIRD_PARTY.md).
