"use client";

import { useEffect, useRef, useState } from "react";
import Lightbox, { type ZoomRef } from "yet-another-react-lightbox";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";

export type ViewerImage = { src: string; alt?: string; caption?: string };

/** Textos del visor en español (la librería los trae en inglés). */
const LABELS = {
  Previous: "Anterior",
  Next: "Siguiente",
  Close: "Cerrar",
  "Zoom in": "Acercar",
  "Zoom out": "Alejar",
  "Enter Fullscreen": "Pantalla completa",
  "Exit Fullscreen": "Salir de pantalla completa",
  Lightbox: "Visor de imágenes",
  Carousel: "Imágenes",
  Slide: "Imagen",
  "{index} of {total}": "{index} de {total}",
};

/** Etiqueta del nivel de zoom: «100 %» al ajustar a la pantalla, «250 %» al acercar. */
export function zoomLabel(zoom: number) {
  return `${Math.round(Math.max(1, zoom) * 100)} %`;
}

const btn = "yarl__button flex items-center justify-center !px-2.5 text-xl leading-none disabled:opacity-40";

/**
 * Visor de imágenes en modal (yet-another-react-lightbox + Zoom). Gestos: pellizcar o tocar dos
 * veces para acercar, arrastrar para recorrer, deslizar hacia abajo o tocar el fondo para cerrar,
 * deslizar a los lados para pasar de imagen. En computadora: rueda o doble clic acercan, botones
 * − / + y el porcentaje (vuelve a ajustar). Esc cierra el visor antes que una hoja que esté abajo.
 */
export default function ImageViewer({
  images,
  index = 0,
  onClose,
  nativeFullscreen = false,
}: {
  images: ViewerImage[];
  index?: number;
  onClose: () => void;
  /** Además pide el modo pantalla completa del navegador (si existe; en iOS basta con el visor). */
  nativeFullscreen?: boolean;
}) {
  const zoomRef = useRef<ZoomRef>(null);
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [hint, setHint] = useState(true);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // En captura: se cierra el visor antes que una hoja (Sheet) que esté abajo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // La ayuda de gestos se oculta sola o en cuanto la persona acerca la imagen
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 4500);
    return () => clearTimeout(t);
  }, []);

  const single = images.length <= 1;
  const [current, setCurrent] = useState(index);
  const caption = images[current]?.caption;
  const anyCaption = images.some((im) => im.caption);
  const syncZoom = () => {
    const z = zoomRef.current;
    if (z) {
      setZoom(z.zoom);
      setMaxZoom(z.maxZoom);
    }
  };

  return (
    <Lightbox
      open
      close={onClose}
      index={index}
      slides={images.map((im) => ({ src: im.src, alt: im.alt || im.caption || "" }))}
      plugins={[Zoom, Fullscreen, ...(single ? [] : [Counter])]}
      labels={LABELS}
      carousel={{ finite: true, padding: 8, spacing: "10%" }}
      animation={{ fade: 200, swipe: 250, zoom: 250 }}
      controller={{ closeOnPullDown: true, closeOnBackdropClick: true, closeOnEscape: false }}
      zoom={{
        ref: zoomRef,
        maxZoomPixelRatio: 3,
        zoomInMultiplier: 1.6,
        doubleClickMaxStops: 2,
        scrollToZoom: true,
        pinchZoomV4: true,
      }}
      fullscreen={{ auto: nativeFullscreen }}
      styles={{
        root: { "--yarl__portal_zindex": 70 },
        // Franja arriba (botones) y abajo (leyenda): la imagen ajustada no queda debajo de ellos
        container: { backgroundColor: "rgba(2, 6, 23, 0.96)", paddingTop: 56, paddingBottom: anyCaption ? 52 : 8 },
        toolbar: { left: 0, right: 0, alignItems: "center", gap: 2, backgroundColor: "rgba(2, 6, 23, 0.85)", padding: "4px 8px" },
      }}
      on={{
        zoom: ({ zoom: z }) => {
          setZoom(z);
          if (z > 1) setHint(false);
          if (zoomRef.current) setMaxZoom(zoomRef.current.maxZoom);
        },
        view: ({ index: i }) => {
          setCurrent(i);
          setTimeout(syncZoom, 0);
        },
        entered: syncZoom,
      }}
      toolbar={{
        buttons: [
          <button key="out" type="button" className={btn} aria-label="Alejar" title="Alejar" disabled={zoom <= 1.01} onClick={() => zoomRef.current?.zoomOut()}>
            −
          </button>,
          <button
            key="pct"
            type="button"
            className={`${btn} !px-1 min-w-[4.25rem] text-sm font-semibold tabular-nums`}
            title="Ajustar a la pantalla"
            aria-label={`Zoom ${zoomLabel(zoom)}. Toca para ajustar a la pantalla`}
            data-testid="viewer-zoom"
            onClick={() => zoomRef.current?.changeZoom(1)}
          >
            {zoomLabel(zoom)}
          </button>,
          <button
            key="in"
            type="button"
            className={btn}
            aria-label="Acercar"
            title="Acercar"
            disabled={maxZoom > 1 && zoom >= maxZoom - 0.01}
            onClick={() => zoomRef.current?.zoomIn()}
          >
            +
          </button>,
          "fullscreen",
          "close",
        ],
      }}
      render={{
        buttonZoom: () => null,
        ...(single ? { buttonPrev: () => null, buttonNext: () => null } : {}),
        controls: () => (
          <>
            {hint && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center px-4"
                aria-hidden="true"
                data-testid="viewer-hint"
              >
                <span className="rounded-full bg-black/75 px-4 py-2 text-center text-sm text-white shadow-lg">
                  <span className="lg:hidden">Pellizca o toca dos veces para acercar · desliza abajo para cerrar</span>
                  <span className="hidden lg:inline">Rueda del ratón o doble clic para acercar · arrastra para mover · Esc cierra</span>
                </span>
              </div>
            )}
            {anyCaption && (
              <p
                className="pb-safe absolute inset-x-0 bottom-0 flex min-h-[52px] items-center justify-center bg-slate-950/85 px-4 py-2 text-center text-sm leading-snug text-white/85"
                data-testid="viewer-caption"
              >
                <span className="line-clamp-2">{caption}</span>
              </p>
            )}
          </>
        ),
      }}
    />
  );
}
