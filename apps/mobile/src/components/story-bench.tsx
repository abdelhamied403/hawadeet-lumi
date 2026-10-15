import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Text, View } from "react-native";
import { StoryEditor } from "@/components/story-editor";
import { Button } from "@/components/ui/button";
import { Body } from "@/components/ui/text";
import { HERO, NARRATOR, type CastMember, type EpisodeDetail } from "@/services/veogen";

export const WORD_LIMIT = 9;
export const countWords = (text: string) => text.split(/\s+/).filter((token) => /[ء-ي]/.test(token)).length;

export function speakerName(speaker: string, cast: CastMember[]): string {
  if (speaker === NARRATOR) return "Narrator";
  if (speaker === HERO) return "He says";
  const member = cast.find((candidate) => candidate.name === speaker);
  return member?.nameArabic || speaker;
}

export function personName(who: string, cast: CastMember[]): string {
  if (who === HERO) return "Main character";
  return cast.find((candidate) => candidate.name === who)?.nameArabic || who;
}

const RTL = { writingDirection: "rtl" } as const;

// The script as a typed page: the one light surface on the desk.
export function StoryBench({ episode, editable }: { episode: EpisodeDetail; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const story = episode.story;
  if (!story) return null;
  const flagged = episode.scenes.filter((scene) => scene.lineProblem).length;
  const warnings = [
    ...episode.scriptWarnings,
    ...(flagged > 0 ? [`The proofreader flagged ${flagged} ${flagged === 1 ? "scene" : "scenes"} whose lines may not make sense. Nothing is changed until you edit or reject it.`] : []),
  ];

  return (
    <View className="gap-4">
      {episode.plan && (
        <Body>
          <Text className="text-foreground">Plan for this part: </Text>
          {episode.plan.summary} <Text className="text-foreground">Ends on: </Text>
          {episode.plan.cliffhanger}
        </Body>
      )}
      {warnings.map((warning) => (
        <View key={warning} className="flex-row items-start gap-2 rounded-md border border-primary/40 bg-primary/10 p-3">
          <Feather name="alert-triangle" size={16} color="#e9a23b" style={{ marginTop: 2 }} />
          <Body className="flex-1">{warning}</Body>
        </View>
      ))}
      <View className="rounded-sm bg-paper px-4 py-6">
        {editing ? (
          <StoryEditor episode={episode} onDone={() => setEditing(false)} />
        ) : (
          <>
            <View className="border-b border-paper-ink/20 pb-4">
              <Text accessibilityRole="header" className="text-right font-script-bold text-3xl leading-[46px] text-paper-ink" style={RTL}>
                {story.title}
              </Text>
              {Boolean(story.description) && (
                <Text className="mt-1 text-right font-script text-lg leading-8 text-paper-ink/70" style={RTL}>
                  {story.description}
                </Text>
              )}
            </View>
            {story.scenes.map((scene, index) => {
              const words = countWords(scene.narration);
              const problem = episode.scenes[index]?.lineProblem;
              return (
                <View key={index} className={`gap-2 py-4 ${index < story.scenes.length - 1 ? "border-b border-paper-ink/10" : ""}`}>
                  <Text className="font-mono text-xs text-paper-ink/50">Scene {String(index + 1).padStart(2, "0")}</Text>
                  {scene.lines.map((line, lineIndex) => {
                    const spoken = line.speaker !== NARRATOR;
                    return (
                      <View key={lineIndex} className="gap-1">
                        {spoken && (
                          <Text className="self-end rounded-sm bg-paper-ink/10 px-1.5 py-0.5 font-sans-medium text-xs text-paper-ink">
                            {speakerName(line.speaker, story.cast)}
                          </Text>
                        )}
                        <Text className={`text-right text-2xl leading-[42px] text-paper-ink ${spoken ? "font-script-bold" : "font-script"}`} style={RTL}>
                          {line.text}
                        </Text>
                      </View>
                    );
                  })}
                  <View className="gap-1">
                    <Direction label="Image" text={scene.imagePrompt} />
                    {scene.shows && (
                      <Direction label="In the picture" text={scene.shows.length > 0 ? scene.shows.map((who) => personName(who, story.cast)).join(", ") : "Nobody"} />
                    )}
                    <Direction label="Motion" text={scene.motionPrompt} />
                    {scene.sfx && <Direction label="Sound" text={episode.soundEffects[scene.sfx] ?? scene.sfx} />}
                  </View>
                  {problem && <Text className="font-sans-medium text-xs text-amber-800">Proofreader: {problem}</Text>}
                  {words > WORD_LIMIT && (
                    <Text className="font-sans-medium text-xs text-red-800">
                      {words} words: scenes over {WORD_LIMIT} run longer than the 5-second clip.
                    </Text>
                  )}
                </View>
              );
            })}
          </>
        )}
      </View>
      {editable && !editing && <Button label="Edit script" variant="outline" onPress={() => setEditing(true)} className="self-end" />}
    </View>
  );
}

function Direction({ label, text }: { label: string; text: string }) {
  return (
    <Text className="font-sans text-[13px] leading-[18px] text-paper-ink/65">
      <Text className="font-sans-medium text-paper-ink/85">{label}: </Text>
      {text}
    </Text>
  );
}
