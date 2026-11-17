# Producción de TVVIDAA — Hostinger VPS / Docker

> **Fuente de verdad operativa.** Confirmado por el responsable del proyecto el 17 de noviembre de 2026. TVVIDAA se publica en **Docker en un VPS de Hostinger**, no en Vercel.

## Entorno de producción

| Elemento | Valor |
| --- | --- |
| Aplicación | TVVIDAA (independiente de RFC Enterprise y demás proyectos del servidor) |
| Dominio público | `https://tv.rfcsas.com` |
| Repositorio Git | `mejai84/xuvidaa` |
| Rama de despliegue | `hostinger-vps` (verificar el ref configurado en el despliegue antes de publicar) |
| Servidor | VPS de Hostinger |
| Directorio de trabajo reportado | `/opt/xuvidaa-tv` |
| Ejecución | Docker, con Docker Compose y/o Dokploy según el servicio vigente |
| Archivo Compose del proyecto | `deploy/hostinger/compose.yaml` |
| Servicio Compose | `vidaa` |
| Contenedor reportado | `xuvidaa-tv-vidaa-1` (confirmar que siga siendo el activo) |
| Red Docker | `xuvidaa-tv-private` |
| Caché persistente | Volumen montado en `/app/server/.cache` |
| Entrada HTTP de la aplicación | Contenedor puerto `3000`, HTTPS publicado por Traefik |

La configuración del proyecto está documentada en [`deploy/hostinger/README.md`](../deploy/hostinger/README.md) y su Compose. La identidad del contenedor, la imagen, el digest y el commit **se deben comprobar en el VPS en cada despliegue**; no se deducen del último commit de GitHub ni de que el dominio responda.

## Regla explícita sobre Vercel

- **Vercel NO es el entorno de producción, NO es el objetivo de despliegue y NO es la fuente para determinar si TVVIDAA está actualizado.**
- No solicitar despliegues, variables ni diagnósticos de Vercel para este proyecto.
- Un estado de Vercel correcto o fallido **no prueba** que la producción en Hostinger esté funcionando o haya fallado.
- Si aparece una integración heredada de Vercel en GitHub, tratarla como ajena a la operación de producción. No modificarla ni eliminarla sin solicitud expresa.

## Reglas para Codex, Antigravity y otros agentes

1. Trabajar sobre el repositorio `mejai84/xuvidaa`; revisar rama, diff y pruebas antes de proponer publicación.
2. **No anunciar un despliegue por haber hecho push, merge o por ver un CI correcto.** Confirmar la imagen/commit realmente ejecutado en Hostinger y el estado del contenedor.
3. Antes de desplegar: identificar el servicio Docker/Dokploy realmente activo, su Compose o configuración efectiva, imagen actual, digest, variables requeridas sin imprimir valores, volumen de caché y punto de rollback.
4. Validar pruebas Node, build Docker, configuración Compose con variables suministradas por el mecanismo de despliegue y smoke tests de HTTP, autenticación, catálogos y reproducción donde proceda.
5. Publicar solo a través del mecanismo **vigente en Hostinger**. No inventar o reemplazar la configuración si aún no se confirmó si el servicio concreto lo gestiona Dokploy o Compose en el host.
6. Tras publicar: comprobar estado `running`/`healthy` según la definición del contenedor, versión/imagen nueva, HTTPS en `tv.rfcsas.com`, inicio de sesión, catálogos y pruebas de video/sonido en el dispositivo pertinente. Un HTTP 200 no acredita reproducción.
7. Mantener la capacidad de rollback a la imagen/commit anterior y revertir si hay una regresión grave.
8. Nunca ejecutar `docker compose down -v`, `docker volume prune`, `--remove-orphans`, borrados de caché ni reinicios globales del daemon Docker. No modificar redes, contenedores, bases de datos o servicios ajenos a TVVIDAA.
9. Mantener secretos y credenciales M3U únicamente en las variables del entorno del servidor; nunca copiarlos a Git, reportes, pantallas ni chats.

## Evidencia mínima de un despliegue

El informe de un agente debe incluir: **rama y commit origen, imagen/digest anterior y nuevo (si se dispone), hora del despliegue, contenedor y estado de salud, pruebas ejecutadas, resultado de autenticación/catálogos, estado de reproducción y procedimiento de rollback disponible**. Indicar claramente lo no verificado. Si no se tiene acceso al VPS o Dokploy, declarar **«producción no verificada»**, no «desplegado».

## Comprobaciones operativas de solo lectura

En el VPS, sin imprimir credenciales:

```sh
docker ps --filter 'name=xuvidaa-tv-vidaa-1' --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect xuvidaa-tv-vidaa-1 --format 'Imagen={{.Config.Image}} Estado={{.State.Status}} Salud={{if .State.Health}}{{.State.Health.Status}}{{else}}sin healthcheck{{end}}'
```

La mera existencia de un contenedor no demuestra qué commit contiene. Obtener identificación de versión del despliegue o imagen antes de atribuir una revisión.

**Nota:** algunos comandos Compose ejecutados en la sesión SSH sin las variables privadas de Dokploy pueden fallar por variables obligatorias ausentes; eso no demuestra un error de la aplicación. No imprimir `.env` ni credenciales al diagnosticar.
