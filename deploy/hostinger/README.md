# XuperTV en Hostinger con Dokploy

Este despliegue aloja la interfaz y su API en el VPS. La aplicacion corre en
un servicio Docker Compose propio conectado solo a la red privada
`xuvidaa-tv-private`, que debe existir previamente en Dokploy. Traefik recibe
el trafico HTTPS de `tv.rfcsas.com` por esa red y lo dirige al puerto interno
3000 de XuperTV. El Compose no conecta XuperTV a `dokploy-network` ni publica
puertos del VPS.

## Crear el servicio en Dokploy

1. Crea un proyecto y un servicio **Docker Compose** nuevos, llamado
   `xuvidaa-tv`, conectado al repositorio `mejai84/xuvidaa`.
2. Selecciona la rama de despliegue `hostinger-vps` y la ruta Compose
   `deploy/hostinger/compose.yaml`.
3. Usa el modo Docker Compose, no Docker Stack: la imagen se construye desde el
   Dockerfile del repositorio.
4. Confirma que existe la red overlay attachable `xuvidaa-tv-private`; el
   despliegue actual ya la usa. Conecta Traefik a esta red para que pueda
   alcanzar `xuper`.
5. No agregues `dokploy-network` al servicio. Las etiquetas Traefik del
   Compose publican solo `tv.rfcsas.com` por HTTPS.
6. Agrega las variables privadas indicadas abajo y despliega.

La red dedicada mantiene XuperTV separado de Figueroa. No cambies la red,
etiquetas ni configuracion global de los otros servicios. Traefik es el unico
punto compartido y solo enruta la solicitud al contenedor XuperTV.

## Variables privadas de Dokploy

- `PUBLIC_BASE_URL`: `https://tv.rfcsas.com`
- `MEDIA_TOKEN_SECRET`: secreto aleatorio de al menos 32 caracteres.
- `XUPER_SESSION_SECRET`: otro secreto aleatorio independiente de al menos 32
  caracteres.
- `XUPER_WEB_PASSWORD`: clave de acceso de al menos 14 caracteres. Guárdala
  como variable privada del proyecto; no la pongas en Git, en la URL ni en
  archivos servidos al navegador.
- `MEDIA_ALLOWED_HOSTS`: opcional; déjala vacía para permitir solo los hosts
  HTTPS que el portal entrega y que quedan firmados por la API.

Puedes generar los secretos en un equipo confiable con Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Ejecuta el comando por separado para `MEDIA_TOKEN_SECRET` y
`XUPER_SESSION_SECRET`. La contraseña de acceso no debe ser la misma que esos
secretos.

## Verificación

Después de desplegar, comprueba en el navegador:

- `https://tv.rfcsas.com/healthz` responde `{"ready":true}`.
- La página muestra el formulario de acceso; la contraseña se envía por HTTPS
  en el cuerpo de una solicitud POST, nunca en la barra de direcciones.
- Tras ingresar, el catálogo solicita datos reales al portal desde el VPS.
- La reproducción pasa por el relay del VPS. La compatibilidad de video depende
  del formato autorizado que entregue el portal y del navegador del TV.

La comprobación de salud solo confirma que el proceso HTTP está activo. Si la
sesión del portal devuelve `portal100024`, el proveedor está rechazando la IP o
la región del VPS; Dokploy, DNS y CORS no pueden corregir esa respuesta.

Modo Fluido requiere el relay FFmpeg local de webOS y no forma parte de esta
edición web. El contenedor no necesita una base de datos, volúmenes ni acceso a
los contenedores de Figueroa.

## Actualizar o detener XuperTV

Los despliegues se gestionan desde el servicio `xuvidaa-tv` en Dokploy. Para
actualizar, publica los cambios en la rama `hostinger-vps` y usa Redeploy. Para
detener XuperTV, detén solo ese servicio en Dokploy; no hace falta reiniciar el
VPS ni tocar los otros proyectos.
