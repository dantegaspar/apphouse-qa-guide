"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Guide, GuideVariant } from "@/lib/types";
import GuideApp, { type IdentifyDraft, type VariantCtl } from "./GuideApp";
import { hasStoredRun, isPhone } from "./store";

const prefKey = (guideId: string) => `apphouse-qa:variant:${guideId}`;

/**
 * Elige entre la guía de computadora y su variante para celular (otra guía, `mobileGuideId`).
 * Orden al cargar: prueba ya empezada en este navegador › elección del tester › tipo de dispositivo.
 * Cada variante guarda su propia prueba en localStorage, así que cambiar no borra el avance.
 */
export default function GuideVariantPicker({
  guide,
  mobileGuide,
  maxUploadMb,
  allowedMime,
}: {
  guide: Guide;
  mobileGuide?: Guide;
  maxUploadMb: number;
  allowedMime?: string[];
}) {
  const [variant, setVariant] = useState<GuideVariant | null>(null);
  const [detected, setDetected] = useState<GuideVariant>("desktop");
  const [draft, setDraft] = useState<IdentifyDraft | null>(null);
  const [carriedFrom, setCarriedFrom] = useState<GuideVariant | null>(null);

  useEffect(() => {
    if (!mobileGuide) return;
    let pref: string | null = null;
    try {
      pref = localStorage.getItem(prefKey(guide.id));
    } catch {
      /* modo privado */
    }
    const runDesktop = hasStoredRun(guide.id);
    const runMobile = hasStoredRun(mobileGuide.id);
    const det: GuideVariant = isPhone() ? "mobile" : "desktop";
    let v: GuideVariant;
    if (runDesktop !== runMobile) v = runMobile ? "mobile" : "desktop";
    else if (pref === "mobile" || pref === "desktop") v = pref;
    else v = det;
    /* eslint-disable react-hooks/set-state-in-effect -- el dispositivo y localStorage solo existen en el cliente */
    setDetected(det);
    setVariant(v);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [guide.id, mobileGuide]);

  const choose = useCallback(
    (next: GuideVariant, carry?: IdentifyDraft) => {
      try {
        localStorage.setItem(prefKey(guide.id), next);
      } catch {
        /* modo privado */
      }
      // Viene de una prueba ya empezada: se llevan sus datos al formulario de la otra versión
      setCarriedFrom(carry ? variant : null);
      if (carry) setDraft(carry);
      setVariant(next);
      window.scrollTo({ top: 0 });
    },
    [guide.id, variant]
  );

  const ctl = useMemo<VariantCtl | undefined>(() => {
    if (!mobileGuide || !variant) return undefined;
    const other = variant === "mobile" ? guide : mobileGuide;
    return { variant, detected, otherHasRun: hasStoredRun(other.id), choose, draft, setDraft, carriedFrom };
  }, [mobileGuide, variant, guide, detected, choose, draft, carriedFrom]);

  if (!mobileGuide) return <GuideApp guide={guide} maxUploadMb={maxUploadMb} allowedMime={allowedMime} />;
  if (!variant || !ctl) return <div className="flex flex-1 items-center justify-center text-slate-600">Cargando…</div>;

  const chosen = variant === "mobile" ? mobileGuide : guide;
  return <GuideApp key={chosen.id} guide={chosen} maxUploadMb={maxUploadMb} allowedMime={allowedMime} variantCtl={ctl} />;
}
