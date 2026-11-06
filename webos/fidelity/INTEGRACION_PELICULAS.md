# Catálogo y fichas en la versión web

La edición HTML conserva las pantallas de `index.html` y consulta el servicio
del portal desde `config/api.js`. No incluye títulos, pósteres ni fichas de
demostración como contenido de respaldo. Si el servicio no entrega datos, la
lista queda vacía y el error se conserva en `window.__xuper.api.error` y
`window.__xuper.portal.error` para diagnóstico.

## Flujo de datos

- Inicio consulta las raíces `featured`, `movies`, `series`, `anime`, `kids` y
  `free` mediante `home`.
- Búsqueda consulta `search`; las fichas usan `detail`.
- `detail` devuelve `{ item, episodes, seasons }`. El cliente conserva las
  temporadas y episodios recibidos y permite escoger la temporada desde la
  ficha.
- TV en vivo consulta `liveCategories` y `liveChannels`. Los canales se cargan
  en páginas de 20 y el cliente continúa mientras `hasMore` sea verdadero.
- Las rutas del portal se ejecutan en el servidor porque el portal no habilita
  CORS para llamadas directas desde la página.

## Diagnóstico en el navegador

```js
window.__xuper.api       // loading, source y error del catálogo
window.__xuper.portal    // estado de actualización y error de sesión/portal
window.__xuper.vod       // títulos entregados por el servicio
window.__xuper.channels  // canales cargados
window.__xuper.refreshPortal()
```

`portal100024` indica que el portal rechazó la sesión del servidor. La interfaz
no sustituye ese error con un catálogo antiguo ni intenta cargar títulos de
prueba.

## Reproducción

La página solicita `mediaInfo`, `resolve` o `resolveLive` al servidor. Los
resolvers de reproducción (`resolve` y `resolveLive`) entregan URLs del proxy
de medios. La página no debe abrir directamente las URLs del CDN del portal.
Los cambios al reproductor y al Modo Fluido se documentan en `player.md` y
están sujetos a las reglas de protección del proyecto.

## Límites

- Que la interfaz funcione en el navegador no garantiza que el portal permita
  iniciar sesión desde cualquier ubicación o proveedor de alojamiento.
- Compatibilidad de códecs, HLS, subtítulos y reproducción prolongada debe
  verificarse con contenido autorizado en el dispositivo objetivo.
- La carpeta `assets/original/` contiene recursos visuales de la aplicación;
  no representa títulos del catálogo.
