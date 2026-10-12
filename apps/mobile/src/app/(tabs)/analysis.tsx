import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import type { ReactNode } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Failure, Loading, Notice, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Arabic, Body, Meta, Title } from "@/components/ui/text";
import { errorMessage } from "@/lib/http";
import { toast } from "@/lib/toast";
import { getAnalysis, refreshAnalysis, type AnalysisResponse, type PostReport, type ReelReport, type YoutubeVideoReport } from "@/services/veogen";

const count = (value: number) => value.toLocaleString("en-US");
const ago = (moment: string) => formatDistanceToNow(new Date(moment), { addSuffix: true });

export default function AnalysisScreen() {
  const queryClient = useQueryClient();
  const { data, error, refetch, isRefetching } = useQuery({ queryKey: ["analysis"], queryFn: getAnalysis, refetchInterval: 5 * 60_000 });
  const record = useMutation({
    mutationFn: refreshAnalysis,
    onSuccess: (fresh) => {
      queryClient.setQueryData(["analysis"], fresh);
      toast("Recorded");
    },
    onError: (failure) => toast(errorMessage(failure)),
  });

  if (!data) return error ? <Failure message={errorMessage(error)} onRetry={() => void refetch()} /> : <Loading />;

  const { latest, dayBefore } = data;
  const youtube = latest?.youtube;
  // The same part carries the same title on both platforms, which is how a Reel finds its YouTube upload.
  const onYoutube = (reel: ReelReport) => youtube?.videos.find((video) => video.title.trim() === reel.title.trim());
  const youtubeOnly = (youtube?.videos ?? []).filter((video) => !latest?.reels.some((reel) => reel.title.trim() === video.title.trim()));
  const recordButton = (
    <Button label={record.isPending ? "Recording" : "Record now"} variant="outline" size="sm" busy={record.isPending} disabled={!data.facebookConnected} onPress={() => record.mutate()} className="self-start" />
  );

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <View className="gap-3">
        <Title>Analysis</Title>
        <Body>Numbers from the Page and the YouTube channel are recorded four times a day (02:00, 08:00, 14:00 and 20:00) and every record is kept, so changes can be traced later.</Body>
        {!data.facebookConnected && (
          <Notice title="Facebook is not connected" body="Numbers are read with FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN in the server's .env. The token needs the read_insights permission." />
        )}
        {latest && (
          <View className="flex-row items-center justify-between gap-3">
            <Meta className="flex-1">Recorded {ago(latest.takenAt)}</Meta>
            {recordButton}
          </View>
        )}
      </View>

      {!latest && data.facebookConnected && (
        <Notice title="Nothing recorded yet" body="The first record is taken at the next scheduled hour, or now if you ask for it.">
          <View className="mt-3">{recordButton}</View>
        </Notice>
      )}

      {latest && (
        <>
          <View className="gap-4">
            <View className="flex-row gap-3">
              <Figure label="Facebook followers" value={latest.page.followers} before={dayBefore?.page.followers} />
              <Figure label="Reel plays" value={plays(latest.reels)} before={dayBefore ? plays(dayBefore.reels) : undefined} />
            </View>
            {youtube && (
              <View className="flex-row gap-3">
                <Figure label="YouTube subscribers" value={youtube.channel.subscribers} before={dayBefore?.youtube?.channel.subscribers} />
                <Figure label="YouTube views" value={views(youtube.videos)} before={dayBefore?.youtube ? views(dayBefore.youtube.videos) : undefined} />
              </View>
            )}
            {!youtube && data.youtubeConnected && <Meta className="leading-5">YouTube joins the numbers at the next record. Tap Record now to see it straight away.</Meta>}
            <PlaysOverTime history={data.history} />
          </View>

          <View className="gap-3">
            <Title className="text-2xl text-muted-foreground">Parts</Title>
            {latest.reels.length === 0 && <Body>No Reels on the Page yet.</Body>}
            {latest.reels.map((reel) => {
              const video = onYoutube(reel);
              return (
                <ReelCard
                  key={reel.id}
                  reel={reel}
                  before={dayBefore?.reels.find((candidate) => candidate.id === reel.id)}
                  video={video}
                  videoBefore={video ? dayBefore?.youtube?.videos.find((candidate) => candidate.id === video.id) : undefined}
                />
              );
            })}
          </View>

          {youtubeOnly.length > 0 && (
            <View className="gap-3">
              <Title className="text-2xl text-muted-foreground">Only on YouTube</Title>
              {youtubeOnly.map((video) => (
                <View key={video.id} className="gap-3 rounded-lg border border-border bg-card p-4">
                  <Arabic className="text-2xl leading-9">{video.title}</Arabic>
                  <YoutubeStats video={video} before={dayBefore?.youtube?.videos.find((candidate) => candidate.id === video.id)} />
                </View>
              ))}
            </View>
          )}

          <View className="gap-3">
            <Title className="text-2xl text-muted-foreground">Posts</Title>
            {latest.posts.length === 0 && <Body>No posts on the Page yet.</Body>}
            <View className="gap-2">
              {latest.posts.map((post) => (
                <PostRow key={post.id} post={post} />
              ))}
            </View>
          </View>
        </>
      )}
    </Screen>
  );
}

const plays = (reels: ReelReport[]) => reels.reduce((sum, reel) => sum + reel.plays, 0);
const views = (videos: YoutubeVideoReport[]) => videos.reduce((sum, video) => sum + video.views, 0);

// What moved since the record from about a day earlier; nothing is shown when there is no earlier record.
function Change({ value, before }: { value: number; before?: number }) {
  if (before === undefined) return null;
  const change = value - before;
  return <Text className={`font-mono text-xs ${change > 0 ? "text-ok" : change < 0 ? "text-destructive" : "text-muted-foreground"}`}>{change > 0 ? `+${count(change)}` : count(change)} in a day</Text>;
}

function Figure({ label, value, before }: { label: string; value: number; before?: number }) {
  return (
    <View className="flex-1 gap-1 rounded-lg border border-border bg-card px-4 py-3">
      <Meta>{label}</Meta>
      <Text className="font-display text-5xl text-foreground">{count(value)}</Text>
      <Change value={value} before={before} />
    </View>
  );
}

// Total Reel plays at each record, oldest on the left. Needs two records before it says anything.
function PlaysOverTime({ history }: { history: AnalysisResponse["history"] }) {
  if (history.length < 2) return <Meta className="leading-5">The trend appears here once there are two records to compare.</Meta>;
  const points = history.slice(-48);
  const top = Math.max(1, ...points.map((point) => point.plays));
  const first = points[0];
  return (
    <View className="gap-2" accessible accessibilityLabel={`Reel plays over the last ${points.length} records, from ${first?.plays ?? 0} to ${points.at(-1)?.plays ?? 0}`}>
      <Meta>Reel plays at each record</Meta>
      <View className="h-12 flex-row items-end gap-px">
        {points.map((point) => (
          <View key={point.takenAt} className="flex-1 rounded-t-sm bg-primary/70" style={{ height: `${Math.max(4, (point.plays / top) * 100)}%` }} />
        ))}
      </View>
      <View className="flex-row justify-between">
        <Meta>{first ? ago(first.takenAt) : ""}</Meta>
        <Meta>now</Meta>
      </View>
    </View>
  );
}

// The share of viewers still watching, from the first frame on the left to the last on the right.
function Retention({ points, lengthSeconds }: { points: number[]; lengthSeconds: number }) {
  if (points.length === 0) return null;
  const end = Math.round((points.at(-1) ?? 0) * 100);
  return (
    <View className="gap-1.5" accessible accessibilityLabel={`Viewers still watching falls to ${end} percent by the end`}>
      <View className="h-14 flex-row items-end gap-px rounded-sm bg-strip px-1 pt-1">
        {points.map((share, index) => (
          <View key={index} className="flex-1 bg-primary" style={{ height: `${Math.max(2, share * 100)}%`, opacity: 0.35 + share * 0.65 }} />
        ))}
      </View>
      <View className="flex-row justify-between">
        <Meta>0 s</Meta>
        <Meta>still watching</Meta>
        <Meta>{Math.round(lengthSeconds)} s</Meta>
      </View>
    </View>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <View className="flex-1 gap-0.5">
      <Meta>{label}</Meta>
      <Text className="font-sans-semibold text-lg text-foreground">{value}</Text>
      {children}
    </View>
  );
}

// One video's numbers on YouTube. Watch time arrives a day or two after the views do.
function YoutubeStats({ video, before }: { video: YoutubeVideoReport; before?: YoutubeVideoReport }) {
  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        <Stat label="Views" value={count(video.views)}>
          <Change value={video.views} before={before?.views} />
        </Stat>
        <Stat label="Average watch" value={video.averageWatchSeconds === null ? "not in yet" : `${video.averageWatchSeconds.toFixed(1)} s`} />
        <Stat label="Watched" value={video.averageWatchedShare === null ? "not in yet" : `${Math.round(video.averageWatchedShare * 100)}%`} />
      </View>
      <View className="flex-row gap-3">
        <Stat label="Likes" value={count(video.likes)} />
        <Stat label="Comments" value={count(video.comments)} />
        <Stat label="Subscribers" value={video.subscribersGained === null ? "not in yet" : count(video.subscribersGained)} />
      </View>
      <OpenLink url={video.url} label="View on YouTube" />
    </View>
  );
}

function ReelCard({ reel, before, video, videoBefore }: { reel: ReelReport; before?: ReelReport; video?: YoutubeVideoReport; videoBefore?: YoutubeVideoReport }) {
  const reachedEnd = reel.retention.length > 0 ? `${Math.round((reel.retention.at(-1) ?? 0) * 100)}%` : "n/a";
  return (
    <View className="gap-4 rounded-lg border border-border bg-card p-4">
      <View className="gap-1">
        <Arabic className="text-2xl leading-9">{reel.title}</Arabic>
        <Meta className="text-right">Published {ago(reel.publishedAt)}</Meta>
      </View>

      <Meta className="text-primary">FACEBOOK</Meta>
      <Retention points={reel.retention} lengthSeconds={reel.lengthSeconds} />

      <View className="gap-3">
        <View className="flex-row gap-3">
          <Stat label="Plays" value={count(reel.plays)}>
            <Change value={reel.plays} before={before?.plays} />
          </Stat>
          <Stat label="Average watch" value={`${reel.averageWatchSeconds.toFixed(1)} s`} />
          <Stat label="Reached end" value={reachedEnd} />
        </View>
        <View className="flex-row gap-3">
          <Stat label="Reactions" value={count(reel.reactions)} />
          <Stat label="Comments" value={count(reel.comments)} />
          <Stat label="Follows" value={count(reel.follows)} />
        </View>
      </View>

      <OpenLink url={reel.url} label="View the reel" />

      {video && (
        <View className="gap-4 border-t border-border pt-4">
          <Meta className="text-primary">YOUTUBE</Meta>
          <YoutubeStats video={video} before={videoBefore} />
        </View>
      )}
    </View>
  );
}

function PostRow({ post }: { post: PostReport }) {
  return (
    <View className="gap-2 rounded-lg border border-border bg-card px-4 py-3">
      {post.excerpt ? (
        <Arabic numberOfLines={1} className="text-xl leading-8">
          {post.excerpt}
        </Arabic>
      ) : (
        <Body>{post.kind === "photo" ? "A picture with no text" : "A post with no text"}</Body>
      )}
      <Meta className="leading-5">
        {post.kind === "photo" ? "Picture" : "Text"} · {count(post.views)} views · {count(post.reactions)} reactions · {count(post.comments)} comments · {count(post.shares)} shares
      </Meta>
      <View className="flex-row items-center justify-between gap-3">
        <Meta className="flex-1">{ago(post.publishedAt)}</Meta>
        <OpenLink url={post.url} label="View the post" />
      </View>
    </View>
  );
}

function OpenLink({ url, label }: { url: string; label: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)} className="min-h-11 flex-row items-center gap-1.5 self-start">
      <Text className="font-sans-medium text-sm text-primary">{label}</Text>
      <Feather name="external-link" size={14} color="#e9a23b" />
    </Pressable>
  );
}
