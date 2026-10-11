import { Feather } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Controller, useForm } from "react-hook-form";
import { Linking, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { ANGLE_COPY, PostSlip } from "@/components/post-slip";
import { Failure, Loading, Notice, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Arabic, Body, FieldError, Meta, Title } from "@/components/ui/text";
import { errorMessage } from "@/lib/http";
import { toast } from "@/lib/toast";
import { createPost, getPosts, type PagePost } from "@/services/veogen";

// Same limit as the server.
const newPostSchema = z.object({ idea: z.string().trim().max(500, "Keep the idea under 500 characters") });
type NewPostForm = z.infer<typeof newPostSchema>;

export default function PostsScreen() {
  const { data, error, refetch, isRefetching } = useQuery({ queryKey: ["posts"], queryFn: getPosts, refetchInterval: 15000 });

  if (!data) return error ? <Failure message={errorMessage(error)} onRetry={() => void refetch()} /> : <Loading />;

  const count = data.drafts.length;

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <View className="gap-3">
        <Title>{count === 0 ? "No posts waiting" : `${count} ${count === 1 ? "post" : "posts"} to review`}</Title>
        <Body>Short posts that keep followers talking between videos. Nothing reaches the Page until you publish it.</Body>
        {!data.facebookConnected && (
          <Notice title="Facebook is not connected" body="Drafts are still written, but publishing needs FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN in the server's .env." />
        )}
      </View>

      {count > 0 && (
        <View className="gap-4">
          {data.drafts.map((post) => (
            <PostSlip key={post.id} post={post} canPublish={data.facebookConnected} />
          ))}
        </View>
      )}

      <NewPost />

      {data.published.length > 0 && (
        <View className="gap-3">
          <Title className="text-2xl text-muted-foreground">Published</Title>
          <View className="gap-2">
            {data.published.map((post) => (
              <PublishedPost key={post.id} post={post} />
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}

function NewPost() {
  const queryClient = useQueryClient();
  const form = useForm<NewPostForm>({ resolver: zodResolver(newPostSchema), defaultValues: { idea: "" } });
  const create = useMutation({
    mutationFn: (values: NewPostForm) => createPost({ idea: values.idea || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      form.reset();
      toast("Draft written");
    },
    onError: (error) => toast(errorMessage(error)),
  });

  return (
    <View className="gap-3 rounded-lg border border-dashed border-border p-4">
      <Text className="font-sans-medium text-lg text-foreground">Write a post now</Text>
      <Body>Drafts are also written every day, as many as you set in Settings. Each one only uses what followers have already watched.</Body>
      <Controller
        control={form.control}
        name="idea"
        render={({ field }) => (
          <View className="gap-1.5">
            <Field
              label="What should it be about? (optional)"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              multiline
              className="min-h-16"
              placeholder="For example: ask who would open the door"
            />
            <FieldError message={form.formState.errors.idea?.message} />
          </View>
        )}
      />
      <Button label={create.isPending ? "Writing the post" : "Write a post"} busy={create.isPending} onPress={form.handleSubmit((values) => create.mutate(values))} className="self-start" />
    </View>
  );
}

function PublishedPost({ post }: { post: PagePost }) {
  const url = post.url;
  return (
    <View className="gap-2 rounded-lg border border-border bg-card px-4 py-3">
      <Arabic numberOfLines={2} className="text-xl leading-8">
        {post.text}
      </Arabic>
      <View className="flex-row items-center justify-between gap-3">
        <Meta className="flex-1">
          {ANGLE_COPY[post.angle]}
          {post.publishedAt ? ` · ${formatDistanceToNow(new Date(post.publishedAt), { addSuffix: true })}` : ""}
        </Meta>
        {url && (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)} className="min-h-11 flex-row items-center gap-1.5">
            <Text className="font-sans-medium text-sm text-primary">View the post</Text>
            <Feather name="external-link" size={14} color="#e9a23b" />
          </Pressable>
        )}
      </View>
    </View>
  );
}
