/*
 * VOD catalog configuration for the webOS port.
 *
 * PORTAL MODE (real XuperTV catalog from the server API)
 * -------------------------------------------
 *   mode: 'portal'
 *   - The API loads current catalog roots and answers search / detail / resolve.
 *     The portal sends no CORS headers, so its encrypted protocol must run in
 *     the server service, never in the browser.
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

  /* Browser transport. Same-origin server API in HTML mode. */
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
  browserTimeoutMs: 65000,

  /* 'xuper' mode (generic session-based endpoint, not the portal service). */
  session: {
    userId: '',
    userToken: '',
    portalCode: '',
    homePageCode: '',
    version: '4.34.4'
  }
};
