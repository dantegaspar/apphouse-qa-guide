"use client";

import { useEffect, useState } from "react";
import type { Guide, GuideVariant } from "@/lib/types";
import GuideApp from "./GuideApp";
import { hasStoredRun, isPhone } from "./store";

const prefKey = (guideId: string) => `apphouse-qa:variant:${guideId}`;

/**
 * Elige entre la guía de escritorio y su variante para celular (otra guía, `mobileGuideId`).
 * Orden: corrida ya empezada en este navegador › elección manual del tester › tipo de dispositivo.
 */
export default function GuideVariantPicker({
  guide,
  mobileGuide,
  maxUploadMb,
}: {
  guide: Guide;
  mobileGuide?: Guide;
  maxUploadMb: number;
}) {
  const [variant, setVariant] = useState<GuideVariant | null>(null);

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
    let v: GuideVariant;
    if (runDesktop !== runMobile) v = runMobile ? "mobile" : "desktop";
    else if (pref === "mobile" || pref === "desktop") v = pref;
    else v = isPhone() ? "mobile" : "desktop";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el dispositivo y localStorage solo existen en el cliente
    setVariant(v);
  }, [guide.id, mobileGuide]);

  if (!mobileGuide) return <GuideApp guide={guide} maxUploadMb={maxUploadMb} />;
  if (!variant) return <div className="flex flex-1 items-center justify-center text-slate-500">Cargando…</div>;

  const switchTo = () => {
    const next: GuideVariant = variant === "mobile" ? "desktop" : "mobile";
    try {
      localStorage.setItem(prefKey(guide.id), next);
    } catch {
      /* modo privado */
    }
    setVariant(next);
    window.scrollTo({ top: 0 });
  };

  const chosen = variant === "mobile" ? mobileGuide : guide;
  return <GuideApp key={chosen.id} guide={chosen} maxUploadMb={maxUploadMb} variant={variant} onSwitchVariant={switchTo} />;
}
