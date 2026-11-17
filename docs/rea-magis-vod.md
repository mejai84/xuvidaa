# REA — estudio verificable de Magis/Xuper para TVVIDAA

**Fecha:** 2026-11-17  
**Objetivo:** documentar cómo obtener evidencia técnica sobre catálogo y navegación de películas y series y qué debe aportar un proveedor **autorizado** antes de habilitar una conexión real.  
**Producción de TVVIDAA:** Docker en VPS Hostinger; este trabajo de investigación no se despliega a producción y no requiere modificar secretos.

## Herramienta

Repositorio oficial: https://github.com/morluto/rea — **REA (Reverse Engineer Anything)**.

La herramienta publica un flujo MCP para inspección estática de aplicaciones Electron/JavaScript y APK Android. Para JavaScript/Electron, su documentación indica:

```sh
npx -y rea-agents@latest analyze-javascript-application /ruta/absoluta/a/resources/app --json
```

Requisitos del lanzamiento consultado: Node 22.23.4+ (serie 22), 24.22.1+ (serie 24), o una versión de 26 admitida por la documentación oficial. Ejecutar **en estación de desarrollo aislada**, desde un directorio ajeno al repositorio; no instalar REA ni JADX en el VPS de producción. Verificar procedencia y versión del paquete antes de ejecutar. El analizador inspecciona estructura, módulos y rutas de ejecución; no concede acceso a servidores, contenido ni cuentas.

## Evidencia conservada de análisis anteriores

1. **Xuper Desktop 0.2.0 Portable**: análisis estático del archivo portable proporcionado por el usuario (SHA-256 `55359a6b3785fb990b42c9d229af0aab951dbd03ec00290a7eae954e1c076a8b`). El resultado corresponde a Electron/Node y ubica `resources/app/service/magis.js`, `desktop/service.cjs`, `desktop/account-store.cjs`, `ui/js/app.js` y `service/proxy.js`. El análisis no ejecutó el EXE ni comprobó servicios remotos. Fuente: informe técnico del 17/11/2026 aportado a la conversación.
2. **APK Android de Xuper/Magis**: informe REA v6.4.0 con JADX headless 0.7.1. Identificó clases y referencias; la capa nativa `com.titan.ranger` y las licencias/direcciones firmadas no fueron reconstruidas completamente. No demuestra que un endpoint esté operativo ni que su respuesta sea accesible legalmente. Fuente: `INFORME-ANALISIS.md` del 13/10/2026 aportado a la conversación.
3. **Código fuente comunitario webOS**: https://github.com/cristianco7/XUPER-HYDRA-PORT-WEBOS. La lectura del servicio `magis.js` permite identificar métodos declarados para búsqueda, catálogo, detalle, VOD y TV en vivo. No son necesariamente endpoints públicos documentados ni garantías de soporte.

## Flujo funcional observado

```text
Interfaz (búsqueda / detalle / temporada / episodio)
  → servicio Node del cliente (operaciones home, search, detail, resolve)
  → sesión validada por portal remoto (si existe autorización)
  → metadatos del catálogo (películas, series, episodios)
  → resolución de reproducción y autorización del CDN
  → player y relay local bajo reglas del proveedor
```

En la implementación comunitaria se observan identificadores de métodos como `v3/searchByName`, `v4/getItemData`, `v10/startPlayVOD`, `v14/getSlbInfo` y `v15/getSlbInfo`. La existencia del método en el cliente no acredita que esté disponible para nuevos usuarios, ni que el cliente tenga un contrato de API.

## Plan de análisis reproducible con REA

**Ámbito permitido: código local y paquetes obtenidos legítimamente.** No intentar usurpar identidad de dispositivo, extraer claves de terceros, eludir sesiones, reutilizar licencias o desactivar restricciones técnicas.

1. Confirmar identidad y SHA-256 del instalador o APK de referencia. Conservar únicamente inventario de módulos, llamadas y pruebas técnicas no sensibles.
2. Inspeccionar la aplicación Electron extraída con REA: módulos, dependencias, operaciones `home/search/detail/resolve`, división entre UI y servicio, serialización de las respuestas y límites de caché.
3. Trazar desde la selección de una película o episodio hasta la operación de resolución. Registrar **esquemas de datos** (identificadores, temporada, episodio, duración, pistas, errores y caducidad), nunca tokens o URLs firmadas.
4. Cuando sea necesario y se disponga de un APK propio/de evaluación, usar JADX mediante REA para comparar solo los modelos de catálogo y las transiciones de pantalla. Marcar los métodos nativos no analizados.
5. Etiquetar cada resultado como `observado_en_fuente`, `inferido` o `verificado_en_ejecución_autorizada`. No convertir una inferencia en promesa de servicio activo.
6. Construir tests con respuestas **sintéticas** y sin credenciales reales: catálogo, búsqueda, detalle, temporadas, episodios, selección de pista, renovación autorizada de sesión y estados de error.
7. Solo habilitar una integración remota cuando exista documentación/contrato del proveedor y credenciales válidas emitidas para ese uso. No publicar secretos, cookies, direcciones firmadas ni headers de autorización en Git o cliente web.

## Contrato esperado para integración autorizada en TVVIDAA

El módulo `web/xuper` y `server/api/xuper` ya exponen operaciones web de `catalog`, `detail` y `resolve`. La futura implementación debe adaptarse a esos contratos y comportarse como los proveedores existentes:

- `load()`: retorna exclusivamente metadatos permitidos de títulos y episodios.
- `resolve(id, signal)`: retorna un recurso temporal autorizado del proveedor y metadatos compatibles con `/api/media`.
- Configuración por variables privadas de Hostinger; errores controlados; jamás secretos o URLs del proveedor en navegador, logs ni repositorio.
- Habilitación explícita, **desactivada por defecto** hasta que el proveedor confirme permisos y mecanismos de autenticación.
- No entregar una señal falsa ni atribuir al portal un catálogo de pruebas.
- Probar compatibilidad del navegador VIDAA, caducidad de enlaces, reproducción y audio con cuenta autorizada.

### Qué falta para acceso real a Magis

**No se dispone de un contrato de API autorizado, sesión válida ni credenciales emitidas para TVVIDAA, ni de licencias multimedia verificadas.** REA permite comprender cómo opera el cliente, pero no suministra esos derechos ni constituye una llave universal. El repositorio comunitario bajo MIT licencia **su código original**, no las películas, series, marcas ni servicios externos.

## Adaptador de metadatos y REA verificable (nueva implementación)

La rama de investigación incluye `server/providers/xuper/magis-metadata.cjs`, que transforma **únicamente metadatos** con la estructura `recommendList`, `searchItemList` y `assetData/simpleProgramList` encontrada en el cliente público. **No implementa inicio de sesión en Magis, resolución de enlaces, DRM ni reproducción.** El adaptador rechaza obtener streams y no almacena credenciales del portal. Las películas y episodios se identifican como `Solo catálogo` en la interfaz.

Se puede incorporar un **JSON exportado por un proveedor que haya autorizado ese uso**. Configuración de ejemplo para `XUPER_PROVIDERS_JSON` (solo en las variables privadas de Hostinger, nunca en Git):

```json
[
  {
    "id": "mis_metadatos",
    "name": "Metadatos autorizados",
    "authorized": true,
    "format": "magis-metadata",
    "url": "https://catalogo-autorizado.example/export.json"
  }
]
```

El formato solo procesa datos de catálogo. No crea una conexión directa con Magis; la dirección es ilustrativa. Si no existe un export permitido, el proveedor se mantiene sin configurar.

Se agregó `.github/workflows/rea-magis-audit.yml` para intentar ejecutar **REA 6.9.0** en un runner GitHub Actions aislado, sobre la revisión pública fija `8c81b29550de72c4aa175f54f669597796bb73f4` del port comunitario. El workflow no usa contraseñas ni consulta el portal; tampoco publica el análisis crudo. Su presencia en Git **no acredita que haya ejecutado o pasado**: consultar estado en Actions.

## Estado y trazabilidad de este trabajo

- Investigación estática previa: **existente** (informes y código fuente).
- Ejecución nueva de REA en esta sesión: **no realizada**. La herramienta no está instalada; el intento de consulta de `rea-agents` al registro npm falló por `EAI_AGAIN`, y el runtime local Node era 22.16.0, por debajo del mínimo observado en la documentación oficial.
- Conexión real con Magis: **no ejecutada**.
- API Magis autorizada: **no verificada**.
- Producción Hostinger: **sin cambios**.

El agente que ejecute la investigación debe adjuntar su versión exacta de REA, comandos, hashes, evidencias saneadas, pruebas y resultados, sin datos de sesión, contraseñas o medios protegidos.
