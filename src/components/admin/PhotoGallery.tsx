"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";

const ImageViewer = dynamic(() => import("@/components/ImageViewer"), { ssr: false });

export type GalleryPhoto = { id: number | string; src: string; name: string };

/**
 * Fotos de un reporte en el admin: miniaturas que abren el visor con zoom (se pasa entre las fotos
 * del mismo reporte deslizando o con las flechas). `big` muestra la foto grande en vez de miniatura.
 * `children` va después de las fotos (videos, archivos que no son imagen).
 */
export default function PhotoGallery({ photos, big = false, children }: { photos: GalleryPhoto[]; big?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      {photos.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setOpen(i)}
          className="block cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F5DA8]"
          aria-label={`Ver foto ${p.name}`}
          data-testid="admin-photo"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.src}
            alt={p.name}
            loading="lazy"
            className={big ? "max-h-64 max-w-full rounded-lg ring-1 ring-slate-200" : "h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200"}
          />
        </button>
      ))}
      {children}
      {open !== null && (
        <ImageViewer images={photos.map((p) => ({ src: p.src, alt: p.name, caption: p.name }))} index={open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
