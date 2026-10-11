"use client";

import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FilmstripMini } from "@/components/filmstrip";
import { SeriesPlanEditor } from "@/components/series-plan-editor";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/http";
import { cn } from "@/lib/utils";
import { getOverview, getSeries, type EpisodeSummary, type SeriesDetail } from "@/services/veogen";

type PartRow = { number: number; summary: string; cliffhanger: string; episode: EpisodeSummary | null };

const features = tableFeatures({});
const column = createColumnHelper<typeof features, PartRow>();
const columns = column.columns([
  column.accessor("number", {
    header: "Part",
    cell: (info) => <span className="font-mono text-muted-foreground">{String(info.getValue()).padStart(2, "0")}</span>,
  }),
  column.accessor("summary", { header: "What happens", cell: (info) => <span className="whitespace-normal">{info.getValue()}</span> }),
  column.accessor("cliffhanger", {
    header: "Ends on",
    cell: (info) => <span className="whitespace-normal text-muted-foreground">{info.getValue()}</span>,
  }),
  column.accessor("episode", {
    header: "Progress",
    cell: (info) => {
      const episode = info.getValue();
      if (!episode) return <span className="text-muted-foreground">Not started</span>;
      return (
        <Link href={`/episodes/${episode.id}`} className="inline-flex items-center gap-2 text-primary underline-offset-4 hover:underline">
          <FilmstripMini steps={episode.steps} />
          {episode.status === "published" ? "Published" : "Open"}
        </Link>
      );
    },
  }),
]);

export default function SeriesPage() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: getOverview });
  const [picked, setPicked] = useState<number | null>(null);
  const seriesId = picked ?? overview.data?.series[0]?.id ?? null;
  const series = useQuery({
    queryKey: ["series", seriesId],
    queryFn: () => getSeries(seriesId as number),
    enabled: seriesId !== null,
    refetchInterval: 15_000,
  });

  if (overview.error) return <p className="text-destructive">{errorMessage(overview.error)}</p>;
  if (!overview.data) return <p className="text-muted-foreground">Loading…</p>;
  if (overview.data.series.length === 0) {
    return (
      <p className="max-w-xl text-muted-foreground">
        No series yet. Start one from the <Link href="/" className="text-primary underline-offset-4 hover:underline">Desk</Link>.
      </p>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
      <nav aria-label="Series" className="grid content-start gap-1">
        {overview.data.series.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPicked(item.id)}
            className={cn(
              "rounded-md px-3 py-2 text-right outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring",
              item.id === seriesId && "bg-secondary",
            )}
          >
            <span dir="rtl" className="block font-script text-xl">
              {item.title}
            </span>
            <span className="block text-left font-mono text-xs text-muted-foreground">
              {item.publishedParts} of {item.totalParts} published · {item.status}
            </span>
          </button>
        ))}
      </nav>
      {series.data ? <SeriesView key={series.data.id} series={series.data} /> : <p className="text-muted-foreground">Loading the series…</p>}
    </div>
  );
}

function SeriesView({ series }: { series: SeriesDetail }) {
  const rows = useMemo<PartRow[]>(
    () =>
      series.parts.map((part) => ({
        ...part,
        episode: series.episodes.find((episode) => episode.partNumber === part.number && episode.status !== "cancelled") ?? null,
      })),
    [series],
  );
  const table = useTable({ features, columns, data: rows });
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <section className="grid min-w-0 gap-5">
        <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide">Edit the plan</h1>
        <SeriesPlanEditor series={series} onDone={() => setEditing(false)} />
      </section>
    );
  }

  return (
    <section className="grid min-w-0 gap-5">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 dir="rtl" className="font-script text-4xl font-bold">
            {series.title}
          </h1>
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit plan
          </Button>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          <span className="text-foreground">The whole story (never shown to viewers):</span> {series.premise}
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          <span className="text-foreground">Main character (narrates):</span> {series.characterSheet}
        </p>
        {series.cast.map((member) => (
          <p key={member.name} className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            <span className="text-foreground">
              {member.nameArabic || member.name} (voice: {member.voice}):
            </span>{" "}
            {member.role} {member.look}
          </p>
        ))}
      </header>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>{header.isPlaceholder ? null : <table.FlexRender header={header} />}</TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className="align-top">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
