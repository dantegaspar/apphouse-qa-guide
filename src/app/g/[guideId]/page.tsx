import { notFound } from "next/navigation";
import { getGuide } from "@/lib/guides";
import { MAX_UPLOAD_MB } from "@/lib/http";
import GuideApp from "@/components/tester/GuideApp";

export default async function GuidePage({ params }: { params: Promise<{ guideId: string }> }) {
  const { guideId } = await params;
  const guide = getGuide(guideId);
  if (!guide) notFound();
  return <GuideApp guide={guide} maxUploadMb={MAX_UPLOAD_MB} />;
}
