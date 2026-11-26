# AppHouse QA Guide

Guía interactiva de pruebas QA de AppHouse. El tester:

- Se identifica (nombre, correo, rol y datos de su celular).
- Sigue cada actividad por pantallas de 3 o 4 pasos en una sola tarjeta, cada paso con su captura. «Listo, siguiente» se habilita cuando el tester ya bajó por todos los pasos (antes, el botón lo lleva al siguiente paso). Cada paso tiene «Tuve un problema» (y «No me apareció» en los pasos «Si…»). «Datos» muestra solo lo de la actividad en curso (`activities` / `rowActivities` en las tablas de `reference`). Los pasos se agrupan solos (`screensOf` en `src/lib/guide-utils.ts`) o con el campo `screen` de cada paso.
- Reporta fallas con descripción y captura de pantalla (o video corto).
- Hace las actividades **en orden**: solo puede abrir la actividad actual y las ya guardadas quedan cerradas.
- Si una falla le impide seguir, la actividad queda en pausa y pide ayuda al guía de la prueba. El guía la desbloquea o termina la prueba con su contraseña (`GUIDE_PASSWORD`). Las solicitudes abiertas aparecen arriba en **/admin**.
- Ve un resumen de sus resultados y contesta una encuesta al final (al terminar la última actividad o si el guía terminó la prueba).

Todo se guarda en SQLite. El panel **/admin**, protegido con contraseña, muestra los resultados y permite exportarlos a CSV.

## Requisitos

- Node.js 22 o superior
- npm (incluido con Node.js)
- Para producción: Docker y Docker Compose (opcional)

## Correr en desarrollo

```bash
git clone https://github.com/dantegaspar/apphouse-qa-guide
cd apphouse-qa-guide
npm install
cp .env.example .env.local
```

Edita `.env.local` y define `ADMIN_PASSWORD`. Luego:

```bash
npm run dev
```

- App del tester: http://localhost:3000
- Panel de administración: http://localhost:3000/admin

Para probar desde un celular conectado al mismo Wi‑Fi:

```bash
npm run dev -- -H 0.0.0.0
```

Después abre en el celular `http://<IP-de-tu-computadora>:3000`, usando la IP local de tu computadora en la red (por ejemplo `192.168.1.20`). Las IP locales `192.168.x.x`, `10.x.x.x` y `172.x.x.x` ya están permitidas; si usas un túnel u otro dominio, agrégalo en `DEV_ORIGINS` (separado por comas).

La base de datos se guarda en `./data/qa.sqlite` y las subidas en `./uploads/`. Para reiniciar la prueba desde cero, detén el servidor y borra la carpeta `./data` (borra también `./uploads` si quieres eliminar las capturas).

## Simular testers (para probar la Mesa de control)

`node scripts/simular-clientes.mjs` y `node scripts/simular-establecimientos.mjs` contestan la guía como testers simulados, con avance gradual, fallas con foto, ayudas y encuesta final. Instrucciones en [scripts/simulador/README.md](scripts/simulador/README.md).

## Producción con Docker

1. Crea el archivo de variables:

   ```bash
   cp .env.example .env
   ```

   Edita `.env` y define al menos `ADMIN_PASSWORD`. Se recomienda también un `SESSION_SECRET` largo (`openssl rand -hex 32`).

2. Construye y levanta el servicio:

   ```bash
   docker compose up -d --build
   ```

3. Verifica que esté sano:

   ```bash
   curl http://localhost:3000/api/health
   ```

Detalles del despliegue:

- **Datos en carpetas del servidor:** todo vive en `./qa-data/` junto al `docker-compose.yml` (o en la ruta de `QA_DATA_PATH`): `data/` (base `qa.sqlite`), `uploads/` (capturas y videos) y `backups/` (respaldos automáticos). Son carpetas normales, no volúmenes de Docker, así que **ningún comando de Docker las borra**: ni `docker compose down -v`, ni `docker volume prune`, ni `docker system prune -a --volumes`, ni reconstruir la imagen. Solo se pierden si alguien borra la carpeta en el servidor.
- **Permisos:** el contenedor arranca como root solo para crear esas carpetas y darles dueño `node`, y luego corre la app como `node`.
- **Una sola instancia:** SQLite no admite varias réplicas del servicio. Mantén `app` con una sola instancia.
- **Reinicio:** el contenedor usa `restart: unless-stopped`.

### Respaldos

**Automáticos:** la app copia la base completa cada 10 minutos a `qa-data/backups/qa-<fecha>.sqlite` y guarda las últimas 144 copias (24 h). Se ajusta con `BACKUP_EVERY_MIN` y `BACKUP_KEEP`. Cada copia es consistente (usa la API de respaldo de SQLite, incluye lo que está en el WAL).

**Restaurar un respaldo:**

```bash
docker compose stop app
cp qa-data/backups/qa-<fecha>.sqlite qa-data/data/qa.sqlite
rm -f qa-data/data/qa.sqlite-wal qa-data/data/qa.sqlite-shm
docker compose start app
```

**Copia completa a otro lugar** (base + fotos): `tar czf apphouse-qa-$(date +%F).tar.gz qa-data/`. Para que sea consistente, hazlo con la app detenida o usa el respaldo más reciente de `qa-data/backups/`.

SQLite usa modo WAL: además de `qa.sqlite` existen `qa.sqlite-wal` y `qa.sqlite-shm`; copiar solo `qa.sqlite` con la app encendida puede dejar un respaldo incompleto.

Si la base de datos está accesible en disco (desarrollo o una carpeta montada), puedes respaldarla con la app encendida usando el comando `.backup` de `sqlite3`, que incluye también lo que está en el WAL:

```bash
sqlite3 ./data/qa.sqlite ".backup './respaldo-qa.sqlite'"
```

## Despliegue en Railway (alternativa)

Guía paso a paso para el dueño: [docs/DEPLOY-RAILWAY.md](docs/DEPLOY-RAILWAY.md).

## Estructura del proyecto

```
content/guides/*.json   Contenido versionado de cada guía (texto, actividades, encuesta)
public/guides/<id>/     Imágenes de cada guía (las rutas en el JSON empiezan con /guides/<id>/)
src/lib/db.ts           Conexión a SQLite y migraciones
src/lib/guides.ts       Registro de guías disponibles
src/app/                Páginas y rutas de API (Next.js App Router)
src/components/feedback Avisos (toasts), confirmaciones, banners y consejos compartidos
```

### Avisos y ventanas para el usuario

Todas las páginas tienen avisos flotantes, diálogo de confirmación y un banner automático de "Sin conexión" (montados en `src/app/layout.tsx`). Desde cualquier componente cliente:

```tsx
import { toast, confirm, Banner, Coachmark } from "@/components/feedback";

toast.success("Respuesta guardada");
const ok = await confirm({ title: "¿Borrar la foto?", tone: "danger", confirmLabel: "Sí, borrar" });
```

Uso completo y ejemplos en [`src/components/feedback/README.md`](src/components/feedback/README.md).

### Migraciones de base de datos

Las migraciones se aplican solas la primera vez que la app accede a la base de datos. Están en el arreglo `MIGRATIONS` de `src/lib/db.ts`, y la versión aplicada se guarda en `PRAGMA user_version`.

Para cambiar el esquema, **agrega una nueva migración al final del arreglo**. Nunca edites una migración existente, porque ya pudo aplicarse en bases de datos reales.

## Cómo editar o agregar una guía

Cada guía es un archivo JSON en `content/guides/`, por ejemplo `cliente.json`. Para agregar una guía nueva, crea su JSON y regístrala en `src/lib/guides.ts`.

Resumen del esquema:

- `id`, `version`, `role`, `title`, `subtitle`, `summary`, `notice`, `glossary`.
- `mobileGuideId` (opcional): id de otra guía para celular. En teléfonos (pantalla de hasta 767 px o navegador de celular) se abre esa guía en su lugar; antes de identificarse, el tester puede cambiar entre escritorio y celular. Se registra en el dispositivo como `guideVariant`.
- `hidden` (opcional): con `true` la guía no aparece en la portada (útil para la variante de celular).
- `tester.fields`: datos que se piden al tester al inicio.
- `prep`: antes de empezar (`sections`, `checklist`, `rules` y, opcional, `tour` con imagen).
- `reference`: tablas de referencia (`tables` con `title`, `columns`, `rows`).
- `troubleshooting`: pares `[problema, solución]`.
- `activities[]`: cada una tiene `id`, `title`, `when`, `where`, `warnings`, `steps`, `expected` y `fields` (opcional).
  - `steps[]`: `id`, `text`, y opcionales `image`, `caption` y `evidence`. Con `evidence: true` el manual pide captura en ese paso.
- `finish.checklist`: lista de cierre.
- `survey`: `title`, `intro` y `questions[]`. Cada pregunta tiene `id`, `type` (`scale`, `nps`, `choice` o `text`) y `label`. Las de tipo `scale` usan `min`, `max`, `minLabel` y `maxLabel`; las `choice` usan `options`.

Reglas prácticas:

- Usa `**negritas**` para resaltar texto.
- Cada vez que cambies el contenido, **sube el campo `version`** (por ejemplo de `1.0.0` a `1.1.0`), para que los resultados queden asociados a la versión que se probó.
- Las imágenes van en `public/guides/<id>/` y se referencian como `/guides/<id>/archivo.jpg`.

## Variables de entorno

| Variable | Obligatoria | Por defecto | Descripción |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | Sí (para `/admin`) | — | Contraseña del panel de administración. |
| `GUIDE_PASSWORD` | Recomendada | `ADMIN_PASSWORD` | Contraseña del guía de la prueba: desbloquea una actividad detenida por una falla o termina la prueba por bloqueo. Se verifica solo en el servidor. |
| `SESSION_SECRET` | No | Se deriva de `ADMIN_PASSWORD` | Secreto para firmar la sesión de `/admin`. |
| `MAX_UPLOAD_MB` | No | `15` | Tamaño máximo por archivo subido, en MB. |
| `DATA_DIR` | No | `./data` | Carpeta de `qa.sqlite`. En Docker es `/app/data`. |
| `UPLOAD_DIR` | No | `./uploads` | Carpeta de capturas y videos. En Docker es `/app/uploads`. |
| `PORT` | No | `3000` | Puerto HTTP. En Docker Compose define el puerto publicado en el host. |

Consulta `.env.example` para un ejemplo comentado.

## Límites de subida

- Tamaño máximo por archivo: `MAX_UPLOAD_MB` (15 MB por defecto).
- Máximo 5 archivos por reporte.
- Formatos aceptados:
  - Imágenes: JPG, PNG, WebP, GIF, HEIC y HEIF.
  - Videos: MP4, MOV y WebM.
