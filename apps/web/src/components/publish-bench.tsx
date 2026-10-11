"use client";

import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEpisodeActions } from "@/hooks/use-episode-actions";
import { mediaUrl } from "@/lib/http";
import { cn } from "@/lib/utils";
import type { EpisodeDetail, PublishResult } from "@/services/veogen";

const PLATFORMS: { key: string; name: string }[] = [
  { key: "facebook", name: "Facebook Reels" },
  { key: "youtube", name: "YouTube Shorts" },
  { key: "tiktok", name: "TikTok" },
];

const RESULT_COPY: Record<PublishResult["status"], string> = {
  posted: "Posted",
  manual: "Post it yourself",
  failed: "Failed",
};

export function PublishBench({ episode }: { episode: EpisodeDetail }) {
  const { publish } = useEpisodeActions(episode.id);
  const step = episode.steps.find((candidate) => candidate.name === "publish");
  const results = step?.meta.published;
  const ready = step?.status === "review";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(episode.description);
      toast.success("Description copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm text-muted-foreground">Description that goes with the video</h3>
          <Button variant="ghost" size="sm" onClick={copy}>
            <CopyIcon data-icon="inline-start" />
            Copy
          </Button>
        </div>
        <pre dir="auto" className="whitespace-pre-wrap rounded-md border bg-card p-4 font-sans text-sm leading-relaxed">
          {episode.description}
        </pre>
      </section>

      <section className="grid gap-2">
        <h3 className="text-sm text-muted-foreground">Where it goes</h3>
        <ul className="grid gap-2">
          {PLATFORMS.map((platform) => {
            const result = results?.[platform.key];
            return (
              <li key={platform.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border bg-card px-4 py-3">
                <span className="font-medium">{platform.name}</span>
                <span className="flex items-center gap-3 text-sm">
                  {result ? (
                    <span className={cn("text-muted-foreground", result.status === "posted" && "text-ok", result.status === "failed" && "text-destructive")}>
                      {RESULT_COPY[result.status]}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {platform.key === "facebook" ? "Posts automatically once connected" : "You upload it; the page opens for you"}
                    </span>
                  )}
                  {result?.url && (
                    <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                      {result.status === "posted" ? "View" : "Open upload page"}
                      <ExternalLinkIcon className="size-3.5" aria-hidden />
                    </a>
                  )}
                </span>
                {result?.detail && <p className="w-full text-xs text-muted-foreground">{result.detail}</p>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          YouTube and TikTok keep uploads from unreviewed apps private, so those two are posted by hand until their reviews are passed.
          {episode.videoUrl && (
            <>
              {" "}
              <a href={mediaUrl(episode.videoUrl)} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
                Open the video file
              </a>{" "}
              to save it for uploading.
            </>
          )}
        </p>
      </section>

      {ready && (
        <div className="sticky bottom-3 flex items-center justify-between gap-3 rounded-lg border bg-card/95 p-3 shadow-lg backdrop-blur">
          <p className="text-sm text-muted-foreground">Publishing cannot be undone from here.</p>
          <Button size="lg" onClick={() => publish.mutate()} disabled={publish.isPending}>
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        </div>
      )}
    </div>
  );
}
