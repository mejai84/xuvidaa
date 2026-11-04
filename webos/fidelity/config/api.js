/*
 * VOD catalog configuration for the webOS port.
 *
 * PORTAL MODE (default, real XuperTV catalog)
 * -------------------------------------------
 *   mode: 'portal'
 *   - data/portal.js is the catalog snapshot generated from the Magis portal
 *     with an anonymous device session. It paints the real catalog instantly.
 *   - The bundled service (services/com.webosflux.xuptertv.fidelity.service)
 *     refreshes the same roots at runtime and answers search / detail /
 *     resolve. The portal sends no CORS headers, so the encrypted protocol
 *     has to run in the Node service, never in the page.
 *
 * STATIC MODE (offline)
 * ---------------------
 *   mode: 'static'   -> disabled in the HTML build; no sample content is loaded.
 *
 * GENERIC AUTHORIZED BACKEND
 * --------------------------
 *   mode: 'catalog'
 *   baseUrl = 'https://your-backend.example'
 *   catalogPath = '/v1/catalog'          (GET)
 *   detailPath  = '/v1/items/{id}'       (GET)
 *   searchPath  = '/v1/search?q={query}' (GET)
 *   headers = { Authorization: 'Bearer ...' }   <-- keep out of git
 *   imageBaseUrl = 'https://cdn.example/posters/'
 *
 * The response may be an array or an object with `items`, `movies`,
 * `results`, `data`, `programList`, etc. Each item accepts the aliases
 * normalized in js/app.js (title/name/programName, poster/posterUrl/image,
 * streamUrl/stream_url, category/section, genres/genre, ...).
 */
window.XUPERTV_API = {
  enabled: true,
  mode: 'portal',

  /* Bundle id of the packaged Node service. */
  serviceId: 'com.webosflux.xuptertv.fidelity.service',

  /* Browser build uses the genuine snapshot; configure service calls separately. */
  refresh: false,

  /* Browser transport. Same-origin Vercel Function in HTML mode. */
  devServiceUrl: '/api',

  /* static / catalog modes */
  useBundledCatalog: false,
  baseUrl: '',
  catalogPath: '',
  detailPath: '',
  searchPath: '',
  headers: {},
  imageBaseUrl: '',
  timeoutMs: 20000,

  /* 'xuper' mode (generic session-based endpoint, not the portal service). */
  session: {
    userId: '',
    userToken: '',
    portalCode: '',
    homePageCode: '',
    version: '4.34.4'
  }
};
