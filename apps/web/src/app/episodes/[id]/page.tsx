import { Suspense } from "react";
import { EpisodeView } from "@/components/episode-view";

async function Episode({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EpisodeView episodeId={Number(id)} />;
}

export default function EpisodePage({ params }: PageProps<"/episodes/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading the part…</p>}>
      <Episode params={params} />
    </Suspense>
  );
}
