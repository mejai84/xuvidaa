# Xuper en un VPS Linux con otra aplicación instalada

Este despliegue ejecuta los mismos HTML, CSS, imágenes y handlers del proyecto en un proceso Node persistente. No incluye el servicio Luna de LG ni FFmpeg: Modo Fluido sigue sin estar disponible en este runtime.

Necesitas un VPS Linux con Docker Compose ya instalado y un subdominio HTTPS administrado por el proxy o panel que ya usas. La imagen usa Node.js 22 y solo módulos incluidos en Node; no ejecuta `npm install`.

## 1. Probar el portal antes de publicar

Trabaja en una carpeta nueva dedicada a Xuper, fuera de los archivos de tu otra aplicación:

```bash
git clone https://github.com/mejai84/xuvidaa.git xuvidaa
cd xuvidaa
docker build -f deploy/hostinger/Dockerfile -t xuper-html .
docker run --rm xuper-html node tools/check-portal.cjs
```

La prueba no abre puertos ni monta carpetas del VPS. Si ya tienes Node.js 22 o posterior, también puedes ejecutar `node tools/check-portal.cjs` directamente desde la raíz del repositorio.

Un `404` obtenido con `curl` en la raíz del portal solo confirma que hubo respuesta HTTP. El diagnóstico usa el cliente real de sesión. Si devuelve `portal100024`, el proveedor rechaza la región o IP de ese VPS: desplegar el contenedor no elimina ese rechazo. No continúes suponiendo que habrá reproducción. Se necesita una ruta de acceso aceptada por el proveedor.

Opcionalmente, después de aceptar la sesión, la prueba puede resolver un título real del catálogo y comprobar una pequeña descarga:

```bash
docker run --rm xuper-html node tools/check-portal.cjs --content-id 7371B4BC01274ABA99C6F6957FCDF836 --media
```

Ese identificador corresponde a *Hot Chocolate Holiday* en la ficha existente. El diagnóstico no añade películas ni datos de ejemplo a la app.

## 2. Elegir puerto y configurar secretos

Comprueba primero si el puerto propuesto está ocupado:

```bash
ss -ltn 'sport = :3001'
```

Si aparece un proceso escuchando en ese puerto, elige otro puerto libre mayor que 1023 y cambia tanto `XUPER_PORT` como `proxy_pass` en el ejemplo de nginx. No detengas el proceso que ya lo ocupa. El puerto interno del contenedor permanece en 3000.

```bash
cp deploy/hostinger/.env.example deploy/hostinger/.env
chmod 600 deploy/hostinger/.env
docker run --rm node:22-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarda el valor aleatorio como `MEDIA_TOKEN_SECRET` en el archivo `.env`, y establece `PUBLIC_BASE_URL` con el origen HTTPS de tu nuevo subdominio, por ejemplo `https://xuper.tudominio.com`. No añadas rutas, contraseñas ni parámetros a esa URL. El archivo `.env` está excluido de Git y del contexto de construcción de Docker.

Hay dos formas de servir la interfaz:

- **App completa desde el VPS:** deja `XUPER_BACKEND_TOKEN` vacío y abre el subdominio del VPS. Interfaz y API utilizan el mismo origen.
- **Interfaz en Vercel y API en el VPS:** genera otro valor aleatorio independiente para `XUPER_BACKEND_TOKEN`, y configura el mismo valor en Vercel. En Vercel configura también `XUPER_BACKEND_URL` con el origen HTTPS del VPS. En el VPS, `XUPER_ALLOWED_ORIGINS` debe contener el origen exacto de la interfaz Vercel, como `https://xuvidaa.vercel.app`. Con el token configurado, las rutas JSON del VPS exigen Bearer; abrir la interfaz directamente desde el VPS no habilita ese token en el navegador.

`XUPER_BACKEND_URL` pertenece solo a Vercel. El servidor del VPS se niega a iniciar si esa variable está configurada allí, para evitar un bucle de reenvío. `MEDIA_ALLOWED_HOSTS` puede quedar vacío: los hosts recibidos del portal están incluidos en los tokens firmados. No uses comodines.

## 3. Iniciar el contenedor aislado

Desde la raíz del repositorio:

```bash
docker compose --env-file deploy/hostinger/.env -f deploy/hostinger/compose.yaml up -d --build
docker compose --env-file deploy/hostinger/.env -f deploy/hostinger/compose.yaml ps
curl --fail http://127.0.0.1:3001/healthz
```

La respuesta de salud es `{"ready":true}`. Solo confirma que el proceso HTTP está en marcha; no crea sesiones ni confirma acceso al portal. Adapta el puerto si elegiste otro.

El contenedor tiene usuario sin privilegios, sistema de archivos de solo lectura y límites de memoria, CPU y procesos. Compose crea una red dedicada y publica el puerto exclusivamente en `127.0.0.1`, sin compartir la red del host ni añadir volúmenes compartidos con tu otra app.

## 4. Conectar el nuevo subdominio con HTTPS

Apunta el DNS del nuevo subdominio a tu VPS y crea un sitio HTTPS independiente en el panel que ya usas. Conserva el proxy, los certificados y la configuración de los sitios existentes.

`nginx.conf.example` contiene la ubicación que debe ir dentro del virtual host HTTPS del nuevo subdominio. Sustituye el puerto si corresponde. El panel puede usar nginx, Caddy o Traefik: en ese caso aplica la misma configuración de destino local, Host original, streaming sin buffering y tiempo de lectura, utilizando el panel instalado. No reemplaces la configuración global de nginx ni instales otro proxy sobre los puertos 80/443.

El proxy debe sobrescribir `X-Forwarded-For` con la IP remota real. El runtime solo acepta ese dato cuando la conexión llega desde loopback; nunca confía en encabezados reenviados por una conexión remota. Dentro de la red bridge de Docker usa la IP del socket como identidad: el límite de la API se comparte entre los usuarios de ese contenedor. No registra URLs de video, tokens o cabeceras de acceso.

Comprueba el subdominio con:

```bash
curl --fail https://xuper.tudominio.com/healthz
```

Después abre la interfaz y comprueba un título real. Una sesión aceptada no garantiza que el navegador soporte el códec de cada título ni confirma toda una reproducción larga.

## Actualizar o detener solo Xuper

Para actualizar, primero revisa que no haya cambios locales pendientes y después trae los cambios de tu rama:

```bash
git pull --ff-only
docker compose --env-file deploy/hostinger/.env -f deploy/hostinger/compose.yaml up -d --build
```

Para detener únicamente este despliegue, ejecuta desde esta carpeta:

```bash
docker compose --env-file deploy/hostinger/.env -f deploy/hostinger/compose.yaml stop
```

No es necesario reiniciar el VPS ni detener otros contenedores.
