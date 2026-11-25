import { notFound } from "next/navigation";
import { getGuide } from "@/lib/guides";
import { activeRoundId } from "@/lib/rounds";
import { ALLOWED_MIME, MAX_UPLOAD_MB } from "@/lib/http";
import GuideVariantPicker from "@/components/tester/GuideVariantPicker";

// La ronda activa cambia cuando el admin abre «+ Nueva encuesta»: se lee en cada visita
export const dynamic = "force-dynamic";

export default async function GuidePage({ params }: { params: Promise<{ guideId: string }> }) {
  const { guideId } = await params;
  const guide = getGuide(guideId);
  if (!guide) notFound();
  // Guía con variante para celular (otra guía): el tester elige dónde hará las actividades
  const mobileGuide = guide.mobileGuideId ? getGuide(guide.mobileGuideId) : undefined;
  return (
    <GuideVariantPicker guide={guide} roundId={activeRoundId()} mobileGuide={mobileGuide} maxUploadMb={MAX_UPLOAD_MB} allowedMime={Object.keys(ALLOWED_MIME)} />
  );
}
