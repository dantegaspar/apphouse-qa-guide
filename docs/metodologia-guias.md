# Cómo escribimos las guías de prueba

Este documento explica por qué la guía del establecimiento (panel web, versión 5.0.0) está armada como está, de dónde salen las reglas y cómo mantenerla. Sirve también para rehacer la guía de clientes y la de la app móvil con el mismo método.

## 1. El problema que resolvimos

En la ronda del 24 de noviembre de 2026 los testers siguieron la guía con el panel abierto al lado. Dante observó que la guía no se parecía al panel. Por ejemplo, en el panel el horario se configura en **una sola pantalla**, pero la guía lo partía en dos páginas: una para la hora de apertura y otra para la de cierre.

Las causas estaban en la estructura, no en una actividad suelta:

| Causa | Efecto en el tester |
|---|---|
| Los pasos se agrupaban solos de 4 en 4 (o al llegar a 650 caracteres), sin importar en qué pantalla del panel estaban. | Una pantalla del panel quedaba repartida en varias páginas de la guía, o una página mezclaba dos pantallas. |
| Cada paso traía su captura, aunque fuera la misma pantalla. | La misma imagen salía varias veces seguidas y la página crecía. |
| Al final había una página aparte para «cerrar» la actividad: volver a verificar, elegir el resultado y anotar datos. | El tester tenía que recordar lo que ya había visto y contestar dos veces lo mismo. |
| 8 pasos pedían «toma una captura» y había casillas de confirmación a media actividad. | Trabajo extra que no prueba nada del panel. |

Con la versión 4.1.0, las 13 actividades sumaban **42 páginas**. Con la 5.0.0 son **17** (ver la tabla de la sección 5).

## 2. Qué dice la investigación y qué regla sacamos

| Fuente | Qué dice | Regla en la guía |
|---|---|---|
| ISO/IEC/IEEE 29119-3:2021, *Test documentation* ([vista previa](https://www.vde-verlag.de/iec-normen/preview-pdf/info_isoiecieee29119-3%7Bed2.0%7Den.pdf)) | Un caso de prueba tiene objetivo, precondiciones, entradas, pasos en orden y un **resultado esperado** que se puede comparar; el procedimiento agrupa casos con su preparación y su cierre. Cada caso debe poder rastrearse. | Cada actividad es un caso: 🎯 objetivo, **Cuándo** (precondición), **Dónde**, pasos con «Debe pasar» y «Comprueba» al final. Los ids (E01…E10) no cambian para no romper la trazabilidad ni el veredicto. |
| Nielsen Norman Group, [Turn User Goals into Task Scenarios](https://www.nngroup.com/articles/task-scenarios-usability-testing/) y [Write Better Qualitative Usability Tasks](https://www.nngroup.com/articles/better-usability-tasks/) | Las tareas deben ser realistas, partir de una meta del usuario y usar sus palabras, no las de la interfaz. | Cada actividad abre con una meta en una línea («Que tu sucursal abra sola hoy de 2:00 a 5:00 p.m.»). Los títulos dicen qué logra el tester, no qué botón toca. |
| MeasuringU, [Seven Tips for Writing Usability Task Scenarios](https://measuringu.com/task-tips/) y Userfocus, [Writing usability task scenarios](https://userfocus.co.uk/articles/writing-usability-task-scenarios.html) | Cada tarea necesita un criterio claro de éxito, datos concretos y un piloto antes de la prueba real. | Los datos exactos viven en «Datos para tu sucursal»; cada «Debe pasar» describe lo que se ve en pantalla. Antes de cada ronda, una o dos personas corren la guía completa (sección 7). |
| J. Carroll, Minimalismo ([resumen](https://www.instructionaldesign.org/theories/minimalism/)) | Instrucciones orientadas a la acción, ancladas en la tarea real, que ayuden a **reconocer y recuperarse de errores** y que se lean mientras se hace. | Una página de la guía = una pantalla del panel. Los avisos ⚠️ solo aparecen cuando evitan un error que ya vimos. «Tuve un problema» está en cada pantalla. |
| MeasuringU, [10 Things to Know About the Single Ease Question](https://measuringu.com/single-question/) y [The Evolution of the SEQ](https://measuringu.com/evolution-of-seq) (Sauro y Dumas, 2009) | Una sola pregunta de 7 puntos justo después de cada tarea mide la dificultad casi tan bien como cuestionarios largos y se relaciona con el éxito y el tiempo. El promedio histórico ronda 5.5. | Al cerrar cada actividad: «¿Qué tan fácil o difícil fue hacer esta actividad?» (1 = muy difícil, 7 = muy fácil). En Admin › Gráficas, una actividad con promedio menor que 5 se marca como «costó trabajo». |
| Pew Research Center, [Writing Survey Questions](https://www.pewresearch.org/our-methods/u-s-surveys/writing-survey-questions/) | Una idea por pregunta, opciones claras, misma escala para lo que se compara y cuestionarios cortos. | La encuesta final quedó en 4 preguntas obligatorias y un comentario opcional (1 minuto). Se quitó «¿Qué fue lo más difícil?» porque la SEQ por actividad ya lo mide con más detalle. Se agregó una pregunta aparte sobre la guía. |

**Una decisión que va contra la recomendación de NN/g.** NN/g aconseja no decirle al usuario dónde hacer clic. Aquí sí damos pasos, porque esto es una **prueba de aceptación**: queremos saber si cada función del panel hace lo que debe, no si el tester la encuentra solo. Para no perder la señal de usabilidad, la medimos aparte con la SEQ de cada actividad y con UMUX-Lite al final.

**Separar el instrumento del producto.** Si la guía es confusa, el tester califica peor al panel aunque el panel no tenga la culpa. Por eso la encuesta pregunta por separado qué tan fácil fue el panel (UMUX-Lite, `umux1` y `umux2`, que ya usa el veredicto) y qué tan fácil fue seguir la guía (`guia`, de 1 a 7). Si `guia` sale baja y UMUX-Lite alta, hay que arreglar la guía, no el panel.

## 3. Mapa del panel (lo que recorre la guía)

Recorrido del 23 y del 26 de noviembre de 2026, sucursales de desarrollo, solo lectura.

**Menú izquierdo**

- **Inicio**: estado de la sucursal (arriba, en todas las pantallas), sucursal elegida, campana de avisos y resumen del día.
- **PEDIDOS**
  - **Pedidos de hoy**: lista con filtros, búsqueda, «Crear pedido» y «Envío y zona de entrega». Al tocar el folio se abre el **Detalle del pedido**: Confirmar (con tiempo de preparación 10/15/20/30/Otro), Marcar listo, Rechazar, Cancelar (con motivo obligatorio), Asignar o Reasignar, Código de entrega y «Autorizar entrega sin código», Estado, Productos, Cobro, Entrega y Repartidor.
  - **Historial y búsqueda**.
- **REPARTO**: Monitoreo en vivo (mapa e indicadores), **Repartidores** (lista, Activos, Disponibles ahora y «Nuevo repartidor») y Calificaciones.
- **MI APP**: **Menú** (pestañas Menú de la marca, En esta sucursal, Variaciones y Complementos; «Agregar producto»; la primera vez pide crear una categoría), **Promociones y banners** (ventana «Nueva promoción») y Marca y apariencia (solo consulta).
- **REPORTES**: Estadísticas.
- **DINERO**: Pagos con tarjeta, Cuenta de depósito y Plan y facturación (solo consulta).
- **CONFIGURACIÓN DE SUCURSAL**: **Horario** (una pantalla: estado de hoy, «Cerrar ahora», horario por día con tramos, «Así se lee tu horario», «Guardar horario» y «Días que no abres»), **Envío y zona de entrega** (tarifas, radio y vista previa, «Guardar tarifas») y **Reglas de pedidos y pagos** (formas de pago, montos máximos y tiempo para responder).

**Flujos que prueba la guía, en orden**

| Actividad | Flujo en el panel | Pantallas del panel |
|---|---|---|
| E01 Entra al panel | Inicio de sesión › (contraseña nueva) › (avisos y sonido) › Inicio | 1 |
| E02 Pon el horario de hoy | Horario › renglón de hoy › horas › Guardar horario › recargar | 1 |
| E03 Da de alta a tus repartidores | Repartidores › Nuevo repartidor › Dar de alta (vacío y lleno) › lista | 1 (lista y formulario) |
| E04-A Crea tu menú | Menú › Categoría › Nuevo producto (Hawaiana: tamaños y extras) › Nuevo producto (Pepperoni: reusa grupos) | 3 |
| E04-B Crea la promoción | Promociones y banners › Nueva promoción › lista | 2 |
| E04-C Pon el costo de envío | Envío y zona de entrega › tarifas › Guardar tarifas | 1 |
| E04-D Revisa las reglas de pedidos y pagos | Reglas de pedidos y pagos › revisar y guardar | 1 |
| E05 Revisa que la sucursal abra sola | Estado de la sucursal (arriba) | 1 |
| E06 Recibe cada pedido | Pedidos de hoy › aviso y sonido › pedido nuevo | 1 |
| E07 Confirma y marca listo cada pedido | Detalle del pedido › Confirmar › Marcar listo | 1 |
| E08 Rechaza un pedido y cancela otro | Detalle › Rechazar (motivo) · Detalle › Cancelar (motivo) | 2 |
| E09 Deja un pedido sin responder | Pedidos de hoy › rechazo automático | 1 |
| E10 Revisa la asignación de repartidor | Detalle del pedido › Repartidor | 1 |

## 4. Cómo se escribe una actividad

En `content/guides/<guía>.json`:

```jsonc
{
  "id": "E02",                          // no se cambia: lo usan el veredicto y las rondas anteriores
  "title": "Pon el horario de hoy",     // verbo + lo que logra el tester
  "goal": "Que tu sucursal abra sola hoy de **2:00 a 5:00 p.m.**, el horario de la prueba.",
  "when": "Justo después de E01.",
  "where": "Menú izquierdo › **CONFIGURACIÓN DE SUCURSAL › Horario**",
  "warnings": ["Cambia solo el renglón de **hoy**…"],   // solo si evita un error real
  "steps": [
    {
      "id": "1",
      "screen": "Horario (una sola pantalla)",   // una pantalla del panel = una página de la guía
      "text": "En el menú izquierdo toca **Horario (1)**.",
      "image": "/guides/establecimiento/w2-e02-horario.jpg",  // la misma captura se muestra una vez
      "caption": "1 = Horario · 2 = el día de hoy · …"
    },
    { "id": "4", "screen": "Horario (una sola pantalla)", "text": "Toca **Guardar horario (4)**.",
      "check": "Sale «Horario guardado…» y desaparece «Cambios sin guardar»." }  // «Debe pasar»
  ],
  "expected": ["Hoy quedó Abierto de 2:00 p.m. a 5:00 p.m., sin otros tramos.", "…"],  // «Comprueba»
  "fields": [{ "id": "tuesdaySchedule", "label": "Horario de hoy que quedó guardado", "type": "timeRange", "required": true }]
}
```

Reglas:

1. **Una página = una pantalla del panel.** Todos los pasos que pasan en la misma pantalla llevan el mismo `screen`. Si la actividad cambia de pantalla (de la lista a una ventana, por ejemplo), cambia el `screen`.
2. **Meta primero.** `goal` en una línea y en palabras del tester.
3. **Cada paso es una acción.** Si el panel debe reaccionar, va en `check` («Debe pasar»), no mezclado con la acción.
4. **Una captura por pantalla**, con números o letras que el texto cita en **negritas** «(1)», «(A)». Si un paso usa la misma captura, se repite el `image` y la guía la muestra una sola vez.
5. **«Comprueba» (`expected`) solo con lo que se puede ver al terminar**, una idea por renglón y sin repetir los «Debe pasar» uno por uno. Los renglones que no siempre aplican llevan `"conditional": true` y muestran «No aplica».
6. **«Anota» (`fields`) solo con datos que se usan después**: en el veredicto (E07, E08, E09, E10), en la Mesa de control o para cruzar con el panel. Nada de «toma una captura» como paso: el tester adjunta fotos solo al reportar una falla.
7. **No cambies los ids** de actividades ni de los campos que usa `src/lib/verdict.ts` (`ordersDelivered`, `ordersFailed`, `orders`, los folios de E08 y E09, `assignMinutes`) ni las preguntas `umux1`, `umux2` y `logistica`.
8. Con `"seq": true` en la guía, cada actividad termina con la pregunta de facilidad (1 a 7). Se guarda como el campo `seq` de la actividad.

## 5. Cómo se ve ahora una actividad

- **Una sola página por pantalla del panel**, con «Pantalla 1 de 3» arriba solo cuando hay más de una.
- En pantallas de 1280 px o más, si la pantalla tiene una o dos capturas, las capturas quedan fijas a la izquierda y los pasos a la derecha, para que el tester compare sin desplazarse. En pantallas más angostas cada captura va debajo de su paso.
- En la **última pantalla**, debajo de los pasos y en la misma página: ✅ Comprueba (Sí / No / No aplica; un «No» abre el reporte de falla), ✍️ Anota, la pregunta de facilidad (1 a 7) y el resultado. El resultado **se marca solo** según «Comprueba» y se puede cambiar.
- El botón de abajo dice «✓ Listo, siguiente pantalla» o, al final, «Guardar y continuar».

| | v4.1.0 | v5.0.0 |
|---|---|---|
| Páginas para las 13 actividades | 42 | 17 |
| Pasos | 80 | 64 |
| Capturas mostradas | 50 | 30 (una por pantalla) |
| Casillas de confirmación a media actividad | 4 | 0 |
| Pasos que piden «toma una captura» | 8 | 0 |
| Preguntas de la encuesta final | 4 obligatorias + 1 opcional | 4 obligatorias + 1 opcional, con `guia` en lugar de `hardest` |

Por actividad, páginas antes → ahora: E01 3→1, E02 3→1, E03 3→1, E04-A 7→3, E04-B 4→2, E04-C 3→1, E04-D 3→1, E05 3→1, E06 2→1, E07 3→1, E08 3→2, E09 2→1, E10 3→1.

## 6. Capturas de pantalla

- Se toman del panel real a 1512 px de ancho, con una sucursal de desarrollo, y se guardan en `public/guides/establecimiento/` con el prefijo `w2-`.
- **Sin datos personales**: antes de capturar se reemplazan en pantalla los nombres, correos y teléfonos de repartidores y clientes por datos de ejemplo. El panel no se modifica.
- Si hace falta ver un formulario lleno, se escribe en él **sin guardar** y se deshace al terminar (recargando sin guardar los cambios). El panel queda como estaba.
- Los marcadores (1, 2, 3… o A, B, C…) se dibujan después sobre la imagen y el `caption` explica cada uno.

## 7. Antes de cada ronda

1. **Piloto**: una o dos personas que no hicieron la guía la corren completa con el panel al lado. Se anota dónde dudaron y cuánto tardaron por actividad.
2. Se revisa que cada «Debe pasar» y cada captura coincidan con la versión del panel desplegada ese día. Si el panel cambió, se toma la captura otra vez.
3. Se corre `npm test` (veredicto) y el simulador (`node scripts/simular-establecimientos.mjs --testers 3 --ritmo 0`) contra un servidor local.
4. Después de fusionar, se vuelve a desplegar https://qa-apphouse.tupide.mx/.

## 8. Cómo leer los resultados nuevos

- **Admin › Gráficas › «Facilidad de cada tarea»**: promedio de la SEQ por actividad. Menos de 5 = la tarea costó trabajo. Hay que cruzarlo con las fallas reportadas en la misma actividad: SEQ baja sin fallas suele ser un problema de la guía o de diseño, y SEQ baja con fallas apunta al panel.
- **Encuesta final, `guia`**: facilidad de seguir la guía. Si es baja y UMUX-Lite es alta, se ajusta la guía antes de culpar al panel.
- El veredicto no cambia: usa las mismas actividades, prioridades y campos que antes.

## 9. Compatibilidad y pendientes

- Las rondas anteriores se siguen viendo. Cambió la lista de «Comprueba» de algunas actividades (por ejemplo E04-A pasó de 1 a 3 renglones), así que en rondas viejas las marcas por renglón pueden aparecer junto a un texto que ya no es el mismo. Los resultados (Todo salió bien, Tuvo alguna falla…) y los campos del veredicto no cambian.
- `firstOrderTime` pasó de E05 a E06, donde de verdad llega el primer pedido.
- E02 dice «hoy» en lugar de una fecha fija, para no editar la guía en cada ronda.
- **Pendiente**: rehacer con este método la guía de la app móvil del establecimiento (`establecimiento-app.json`) y la del cliente (`cliente.json`). Ya usan la nueva forma de cerrar cada actividad en la misma página, pero sus pasos siguen agrupándose solos.
