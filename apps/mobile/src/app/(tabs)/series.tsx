import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { FilmstripMini } from "@/components/filmstrip";
import { Failure, Loading, Screen } from "@/components/screen";
import { SeriesPlanEditor } from "@/components/series-plan-editor";
import { Button } from "@/components/ui/button";
import { Arabic, Body, Meta, Title } from "@/components/ui/text";
import { errorMessage } from "@/lib/http";
import { getOverview, getSeries, type SeriesDetail } from "@/services/veogen";

export default function SeriesScreen() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: getOverview });
  const [picked, setPicked] = useState<number | null>(null);
  const seriesId = picked ?? overview.data?.series[0]?.id ?? null;
  const series = useQuery({
    queryKey: ["series", seriesId],
    queryFn: () => getSeries(seriesId as number),
    enabled: seriesId !== null,
    refetchInterval: 15_000,
  });

  if (!overview.data) return overview.error ? <Failure message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} /> : <Loading />;
  if (overview.data.series.length === 0) {
    return (
      <Screen>
        <Title>No series yet</Title>
        <Body>Start one from the Desk tab: the first part you write begins a new series.</Body>
      </Screen>
    );
  }

  return (
    <Screen refreshing={series.isRefetching} onRefresh={() => void series.refetch()}>
      {overview.data.series.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" accessibilityRole="tablist">
          {overview.data.series.map((item) => {
            const selected = item.id === seriesId;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setPicked(item.id)}
                className={`min-h-11 max-w-56 justify-center rounded-md border px-3 py-2 ${selected ? "border-primary bg-secondary" : "border-border bg-card"}`}
              >
                <Arabic numberOfLines={1} className="text-lg">
                  {item.title}
                </Arabic>
                <Meta>
                  {item.publishedParts} of {item.totalParts} published · {item.status}
                </Meta>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {series.data ? (
        <SeriesView key={series.data.id} series={series.data} />
      ) : series.error ? (
        <Text className="font-sans text-sm text-destructive">{errorMessage(series.error)}</Text>
      ) : (
        <Body>Loading the series</Body>
      )}
    </Screen>
  );
}

function SeriesView({ series }: { series: SeriesDetail }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <View className="gap-5">
        <Title>Edit the plan</Title>
        <SeriesPlanEditor series={series} onDone={() => setEditing(false)} />
      </View>
    );
  }

  return (
    <View className="gap-5">
      <View className="gap-3">
        <Arabic accessibilityRole="header" className="font-script-bold text-4xl leading-[56px]">
          {series.title}
        </Arabic>
        <Button label="Edit plan" variant="outline" className="self-start" onPress={() => setEditing(true)} />
        <Body>
          <Text className="text-foreground">The whole story (never shown to viewers): </Text>
          {series.premise}
        </Body>
        <Body>
          <Text className="text-foreground">Main character (narrates): </Text>
          {series.characterSheet}
        </Body>
        {series.cast.map((member) => (
          <Body key={member.name}>
            <Text className="text-foreground">
              {member.nameArabic || member.name} (voice: {member.voice}):{" "}
            </Text>
            {member.role} {member.look}
          </Body>
        ))}
      </View>

      <View className="gap-2">
        {series.parts.map((part) => {
          const episode = series.episodes.find((candidate) => candidate.partNumber === part.number && candidate.status !== "cancelled");
          return (
            <View key={part.number} className="gap-2 rounded-lg border border-border bg-card p-4">
              <Meta className="text-sm">Part {String(part.number).padStart(2, "0")}</Meta>
              <Text className="font-sans text-sm leading-5 text-foreground">{part.summary}</Text>
              <Body>
                <Text className="text-foreground">Ends on: </Text>
                {part.cliffhanger}
              </Body>
              {episode ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open part ${part.number}, ${episode.status === "published" ? "published" : "in production"}`}
                  onPress={() => router.push({ pathname: "/episodes/[id]", params: { id: String(episode.id) } })}
                  className="min-h-11 flex-row items-center gap-3 self-start"
                >
                  <FilmstripMini steps={episode.steps} />
                  <Text className="font-sans-medium text-sm text-primary">{episode.status === "published" ? "Published" : "Open"}</Text>
                </Pressable>
              ) : (
                <Meta>Not started</Meta>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}
