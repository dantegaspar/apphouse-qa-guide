# Simulador de testers (para probar la Mesa de control)

Dos scripts que contestan la guía como lo haría un tester, por la misma API que usa la página.
Todo se ve en vivo en `/admin` y en la Mesa: avance actividad por actividad, fallas (algunas con
foto), solicitudes de ayuda, «No me tocó» y la encuesta final.

```bash
node scripts/simular-clientes.mjs            # prueba de clientes
node scripts/simular-establecimientos.mjs    # prueba de establecimientos (panel web)
node scripts/simular-establecimientos.mjs --variante app   # establecimientos, app móvil
```

Requisitos: Node.js 22 y el repositorio con `npm install` (los scripts leen las guías de `content/guides`).

## Escenarios

Cada tester toma un escenario, en orden, y se reparten entre `--testers`:

| Escenario | Qué hace |
|---|---|
| `completa` | Todo «Todo salió bien» y encuesta final con calificación alta. |
| `fallas` | Dos actividades con falla (severidad media o baja, una con foto). |
| `no-me-toco` | Dos actividades «No me tocó» y los pasos «Si…» como «No me apareció». |
| `ayuda` | Una falla que le impide seguir: pide ayuda y **espera a que Mesa la resuelva**; luego termina la prueba. |
| `bloqueo` | Igual que `ayuda`, pero si nadie la resuelve a tiempo, el guía termina la prueba por bloqueo (`GUIDE_PASSWORD`). Sin esa variable queda en pausa. |
| `abandona` | Se queda a la mitad, sin encuesta. |

## Opciones

| Opción | Por omisión | Para qué |
|---|---|---|
| `--url <url>` (o `QA_URL`) | `http://localhost:3000` | Servidor. Docker local suele ser `http://localhost:8082`. |
| `--testers <n>` | 4 | Testers a la vez. |
| `--ritmo <seg>` | 6 | Segundos promedio por actividad (±50 %). Súbelo para ver el avance con calma. |
| `--escenarios a,b,…` | todos | Escenarios a repartir. |
| `--espera-ayuda <seg>` | 600 | Cuánto espera un tester a que Mesa resuelva su ayuda. |
| `--nueva-encuesta [nombre]` | — | Abre una encuesta (ronda) nueva antes de empezar. Pide `ADMIN_PASSWORD`. |
| `--si` | — | Obligatoria para escribir en un servidor que no es local. |

## Datos de prueba y limpieza

- Nombres «… Sim xxxx-n» y correos `qa+cliente-…@example.com` / `qa+establecimiento-…@example.com`.
- Usa `--nueva-encuesta "Prueba de Mesa"` para que lo simulado quede en su propia encuesta. Después
  vuelve a la encuesta real desde el selector del panel, o abre otra con «Nueva encuesta».
- En local también puedes borrar todo con `npm run limpiar -- --si` (guarda un respaldo antes).

## Ejemplos

```bash
# Local con Docker, 6 clientes con calma, en una encuesta aparte
ADMIN_PASSWORD=… node scripts/simular-clientes.mjs --url http://localhost:8082 --testers 6 --ritmo 10 --nueva-encuesta "Prueba de Mesa"

# Solo ayudas, para practicar resolverlas en la Mesa
node scripts/simular-establecimientos.mjs --url http://localhost:8082 --escenarios ayuda,bloqueo --testers 2

# Servidor desplegado (escribe datos ahí: usa una encuesta aparte)
ADMIN_PASSWORD=… node scripts/simular-clientes.mjs --url https://qa-apphouse.tupide.mx --si --nueva-encuesta "Simulación Mesa"
```
