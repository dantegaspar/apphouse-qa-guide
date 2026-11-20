# Avisos y ventanas (`@/components/feedback`)

Sistema compartido para dar feedback al usuario. Ya está montado en `src/app/layout.tsx`
(`<FeedbackProviders>`), así que **cualquier componente cliente** de cualquier página lo puede usar
sin configurar nada. Sin dependencias nuevas; textos en español; pensado para teléfono.

```ts
import { toast, useConfirm, Banner, useOnlineStatus, Coachmark, downloadFile } from "@/components/feedback";
```

## 1. Avisos flotantes (toasts)

```ts
toast.success("Respuesta guardada");
toast.error("No se pudo enviar la foto", {
  title: "Error",
  action: { label: "Reintentar", onClick: () => retry() },
});
toast.info("Puedes seguir sin conexión", { duration: 8000 });
toast.warning("Te falta un paso", { title: "Revisa" });

// Progreso: mismo `id` = reemplaza el aviso en su lugar
toast.loading("Subiendo foto…", { id: "upload" });
toast.success("Foto subida", { id: "upload" });

toast.dismiss("upload"); // uno
toast.dismiss();         // todos
```

- `toast.success|error|info|warning|loading(message: ReactNode, opts?) => id`
- `opts`: `{ id?, title?, action?: { label, onClick }, duration?, onDismiss? }`
- Duración por defecto: éxito 4 s, info 5 s, advertencia 7 s, error 9 s, `loading` no se cierra.
  Con `action`, mínimo 8 s. `duration: 0` o `Infinity` = no se cierra solo. El tiempo se pausa
  con el mouse encima, con foco, mientras se arrastra y con la pestaña oculta.
- Máximo 3 a la vez (salen los más viejos). Abajo al centro en teléfono, abajo a la derecha en
  escritorio, respeta `safe-area`. Se cierran tocándolos, deslizándolos o con la X / Esc.
- Lectores de pantalla: errores con `aria-live="assertive"`, el resto `polite`.
- `useToast()` devuelve el mismo objeto `toast` (por si prefieres un hook).
- `useToastOffset(px)`: sube la pila mientras el componente esté montado (p. ej. para no tapar
  una barra de botones fija abajo): `useToastOffset(72)`.

## 2. Confirmación

```tsx
const confirm = useConfirm();

async function onDelete() {
  const ok = await confirm({
    title: "¿Borrar esta foto?",
    message: "No se puede deshacer.",
    confirmLabel: "Sí, borrar",
    cancelLabel: "Cancelar",
    tone: "danger", // "danger" | "default"
  });
  if (!ok) return;
  // …
}
```

Devuelve `Promise<boolean>`. Modal accesible (`<dialog>` nativo): foco atrapado, Esc o tocar
fuera = cancelar, devuelve el foco al botón que lo abrió. Hoja desde abajo en teléfono, centrado
en escritorio. Con `tone: "danger"` el botón es rojo y el foco inicial va a "Cancelar".
`confirm` también se puede importar directo. Si se llama varias veces, se encolan.

## 3. Banner (aviso fijo dentro de la página)

```tsx
<Banner tone="success">Guardado</Banner>
<Banner tone="warning" title="Falta la foto" action={{ label: "Agregar", onClick: openCamera }}>
  Toma una captura antes de seguir.
</Banner>
<Banner tone="offline" onClose={() => setHidden(true)}>Sin conexión…</Banner>
```

Props: `tone` (`success | error | warning | info | offline`), `title?`, `children`, `action?`,
`onClose?` (muestra X), `icon?` (`null` = sin ícono), `role?`, `compact?`, `className?`.

## 4. Conexión

- `<ConnectionBanner />` ya está montado: cuando el navegador pierde la red aparece arriba
  "Sin conexión: tus respuestas se guardan y se enviarán al volver la señal." (se puede
  minimizar a un chip) y al volver sale el aviso "Conexión recuperada".
- `useOnlineStatus(): boolean` para tu propia lógica (en el servidor devuelve `true`):

```tsx
const online = useOnlineStatus();
<button disabled={!online}>Enviar</button>
```

## 5. Consejos de primera vez (Coachmark / Tip)

```tsx
<Coachmark id="captura-zoom" message="Toca la captura para verla en grande">
  <img src={shot} alt="" />
</Coachmark>

// En línea (span inline-block) y arriba del elemento
<Coachmark id="boton-ayuda" inline placement="top" title="¿Te trabaste?" message="Pide ayuda aquí.">
  <Button>Pedir ayuda</Button>
</Coachmark>

// Con un ref existente, sin envolver
<Coachmark id="menu" targetRef={menuRef} message="Aquí cambias de guía" />
```

Props: `id` (obligatorio, se recuerda en `localStorage` como `apphouse:tip:<id>`), `message`,
`title?`, `placement?` (`"bottom"` por defecto, se voltea si no cabe), `buttonLabel?`
(`"Entendido"`), `delay?` (600 ms), `when?` (condición extra), `dismissOnAnchorClick?` (true:
tocar el elemento también cuenta como visto), `onDismiss?`, `inline?`, `className?`
(del envoltorio), `targetRef?`. Si hay varios en pantalla aparecen de a uno.
`Tip` es alias de `Coachmark`. Extras: `useCoachmark(id) => { seen, dismiss }` y
`resetCoachmarks(ids?)` para volver a mostrarlos.

## 6. Descargas con aviso

```ts
await downloadFile("/api/admin/export/xlsx", { label: "Excel" });
// "Preparando Excel…" → "Listo · Excel descargado" (o error con "Reintentar")
```

En admin está envuelto en `<ExportButton href label>` (`src/components/admin/ExportButton.tsx`).

## Reglas de uso

- Textos cortos, en español y en positivo: qué pasó y qué hacer ("Revisa tu internet e intenta
  de nuevo"), nunca códigos técnicos.
- Toast para confirmar acciones o errores pasajeros; Banner para estados que siguen vigentes;
  `confirm` solo para acciones que no se pueden deshacer o que sacan al usuario del flujo.
- Las animaciones respetan `prefers-reduced-motion`. Todo es solo cliente (`"use client"`).
