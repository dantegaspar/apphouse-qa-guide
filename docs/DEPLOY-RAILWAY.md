# Despliegue en Railway (alternativa de respaldo)

Guía paso a paso para publicar AppHouse QA Guide en [Railway](https://railway.com) durante los días de la prueba. Todo el repositorio ya está preparado (`Dockerfile`, `railway.json`); solo hay que hacer clic en el panel de Railway.

> **Importante:** la app usa SQLite. Debe haber **una sola réplica** y **un solo volumen**. No escales el servicio.

## 1. Antes de empezar

- Cuenta de Railway (https://railway.com) con acceso a GitHub. Un plan **Trial** (crédito único de US$5, volumen de 0.5 GB) alcanza para pruebas cortas; para 5 días con capturas y videos conviene el plan **Hobby** (US$5/mes, volumen hasta 5 GB).
- Que los cambios estén subidos a `dantegaspar/apphouse-qa-guide` en GitHub (rama `main`).

## 2. Crear el proyecto desde GitHub

1. Entra a https://railway.com/dashboard y pulsa **New Project**.
2. Elige **Deploy from GitHub repo**.
3. Si es la primera vez, pulsa **Configure GitHub App** y da acceso al repositorio `dantegaspar/apphouse-qa-guide`.
4. Selecciona `dantegaspar/apphouse-qa-guide`. Railway detecta el `Dockerfile` y lee `railway.json` (builder Dockerfile, healthcheck `/api/health`, reinicio en fallo).
5. El primer despliegue fallará o quedará sin datos hasta configurar variables y volumen: es normal. Continúa con los pasos siguientes.

## 3. Agregar el volumen (datos persistentes)

1. En el lienzo del proyecto, haz clic derecho sobre el servicio (o pulsa **+ Create** arriba a la derecha) y elige **Volume**.
2. Asócialo al servicio de la app.
3. **Mount path:** `/app/data`
4. Confirma / **Deploy** los cambios pendientes.

Railway permite **un solo volumen por servicio**, por eso base de datos y subidas van juntas en `/app/data` (las subidas en `/app/data/uploads`). La app crea esa carpeta sola si no existe.

## 4. Variables de entorno

Abre el servicio, pestaña **Variables**, **New Variable** (o **Raw Editor** y pega todo):

| Variable | Valor |
| --- | --- |
| `ADMIN_PASSWORD` | Contraseña del panel `/admin` (larga, única) |
| `GUIDE_PASSWORD` | Contraseña del guía de la prueba (distinta de la anterior) |
| `SESSION_SECRET` | Texto aleatorio largo (ver abajo) |
| `MAX_UPLOAD_MB` | `15` |
| `DATA_DIR` | `/app/data` |
| `UPLOAD_DIR` | `/app/data/uploads` |
| `RAILWAY_RUN_UID` | `0` |

- **Generar `SESSION_SECRET`** en tu computadora: `openssl rand -hex 32` (o en Node: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Pega el resultado.
- **`RAILWAY_RUN_UID=0`:** la imagen corre como usuario `node`, pero Railway monta el volumen como `root`; sin esto la app no puede escribir en `/app/data` (error de permisos al abrir SQLite). Es la solución que indica la documentación de Railway.
- **No definas `PORT`:** Railway lo inyecta y el servidor de Next.js (standalone) lo respeta; el `Dockerfile` ya fija `HOSTNAME=0.0.0.0`.

Pulsa **Deploy** para aplicar los cambios.

## 5. Generar el dominio público

1. Servicio -> **Settings** -> **Networking** -> **Public Networking**.
2. Pulsa **Generate Domain**. Obtendrás algo como `apphouse-qa-guide-production.up.railway.app`.
3. Si te pide el puerto, deja el que Railway detecta (el valor de `PORT`).

## 6. Prueba de humo

1. En **Deployments** espera a que el último despliegue diga **Active** (el healthcheck `/api/health` debe pasar; tiempo máximo configurado: 120 s).
2. Abre `https://TU-DOMINIO/api/health`: debe responder con un JSON de estado correcto.
3. Abre `https://TU-DOMINIO/`: se ve la portada de la guía.
4. Abre `https://TU-DOMINIO/admin` e ingresa con `ADMIN_PASSWORD`.
5. Haz una corrida de prueba como tester, sube una captura en un reporte y verifica que aparece en `/admin`.
6. Fuerza un nuevo despliegue (**Redeploy**) y comprueba que los datos de la corrida de prueba siguen ahí (el volumen funciona).

Si falla, revisa **Deployments -> View Logs**. Errores típicos: `SQLITE_CANTOPEN` / `EACCES` (falta `RAILWAY_RUN_UID=0` o el volumen no está en `/app/data`), healthcheck fallido (falta `ADMIN_PASSWORD` no afecta; revisa el log de arranque).

## 7. Descargar los datos

En `https://TU-DOMINIO/admin`, sección **Descargar datos**, usa el botón **Excel** (un archivo con una hoja por tabla) o los CSV sueltos. Las capturas y videos se abren desde cada reporte en `/admin`. **Descarga todo antes de borrar el servicio.**

## 8. Borrar el servicio después de los 5 días

1. Verifica que ya descargaste los CSV/Excel y las evidencias que necesites.
2. Servicio -> **Settings** -> baja hasta **Danger** -> **Delete Service**.
3. Elimina también el volumen: clic derecho sobre el volumen en el lienzo -> **Delete Volume** (si no, se sigue cobrando).
4. Para cerrar todo: proyecto -> **Settings** -> **Danger** -> **Delete Project**.
5. Opcional: en GitHub, revoca el acceso de la app de Railway (Settings -> Applications).

## 9. Costo aproximado (precios de Railway, verificados en docs.railway.com)

- Plan Hobby: US$5/mes con US$5 de uso incluido. Trial: crédito único de US$5.
- Memoria US$10/GB/mes, CPU US$20/vCPU/mes, volumen US$0.15/GB/mes, salida de red US$0.05/GB.
- Esta app consume poco (aprox. 150-300 MB de RAM y CPU casi nula). Estimado: **menos de US$0.50 por 5 días** de uso, normalmente cubierto por el crédito. Los videos grandes suman egreso y almacenamiento (centavos).
- Los precios pueden cambiar; confirma en https://docs.railway.com/reference/pricing/plans.

## Notas

- Mantén **una réplica** (es el valor por defecto; no la cambies). Los volúmenes tampoco admiten réplicas.
- Cada redespliegue causa una breve interrupción (limitación de Railway con volúmenes).
- El `Dockerfile` no usa `VOLUME` (Railway no lo admite); `docker-compose.yml` conserva sus volúmenes para uso local.
