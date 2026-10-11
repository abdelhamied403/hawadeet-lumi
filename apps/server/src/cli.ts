import { saveStory } from "./lib/project";
import { sampleStory } from "./sample/story";
import { runAssemble } from "./stages/assemble";
import { fetchRender, MOTION_MODELS, pushRender, type MotionModel } from "./stages/render";
import { runScript } from "./stages/script";
import { runVoice } from "./stages/voice";

const SAMPLE_DIR = "output/sample";

const USAGE = `Usage: bun run veogen <command>

  sample [--model <model>]          Make the sample video end to end (story, voice, render, assemble)
  init-sample                       Write the sample story to ${SAMPLE_DIR}
  script <dir> [--topic <text>] [--scenes <n>]
                                    Write a new story (narration, image and motion prompts)
  voice <dir> [--force]             Generate narration audio and word timings
  render <dir> --model <model> [--reuse-images <model>]
                                    Start the GPU job that makes the images and motion clips
                                    (--reuse-images sends another model's downloaded images
                                    so only the clips are made)
  fetch <dir> --model <model> [--wait]   Check the GPU job and download its clips
  assemble <dir> --model <model>    Build the finished video from clips, voice, captions and music

  Models: ${MOTION_MODELS.join(", ")}`;

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(arg.slice(2), next);
      i++;
    } else {
      flags.set(arg.slice(2), true);
    }
  }
  return { positional, flags };
}

function requireDir(dir: string | undefined): string {
  if (!dir) throw new Error(`Missing project folder.\n\n${USAGE}`);
  return dir;
}

function requireModel(value: string | true | undefined): MotionModel {
  // The assemble stage also accepts any folder name under render/, which is how test clips are used.
  if (typeof value !== "string") throw new Error(`Missing --model. Choose one of: ${MOTION_MODELS.join(", ")}`);
  return value as MotionModel;
}

function requireMotionModel(value: string | true | undefined): MotionModel {
  const model = requireModel(value);
  if (!MOTION_MODELS.includes(model)) throw new Error(`Unknown model "${model}". Choose one of: ${MOTION_MODELS.join(", ")}`);
  return model;
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, dir] = positional;

  switch (command) {
    case "init-sample":
      await saveStory(SAMPLE_DIR, sampleStory);
      console.log(`wrote ${SAMPLE_DIR}/story.json`);
      return;
    case "script":
      await runScript(requireDir(dir), {
        topic: typeof flags.get("topic") === "string" ? (flags.get("topic") as string) : "horror story",
        scenes: Number(flags.get("scenes") ?? 10),
      });
      return;
    case "voice":
      await runVoice(requireDir(dir), { force: flags.has("force") });
      return;
    case "render":
      await pushRender(requireDir(dir), requireMotionModel(flags.get("model")), {
        reuseImagesFrom: typeof flags.get("reuse-images") === "string" ? (flags.get("reuse-images") as string) : undefined,
      });
      return;
    case "fetch":
      await fetchRender(requireDir(dir), requireMotionModel(flags.get("model")), { wait: flags.has("wait") });
      return;
    case "assemble":
      await runAssemble(requireDir(dir), requireModel(flags.get("model")));
      return;
    case "sample": {
      const model = requireMotionModel(flags.get("model") ?? "wan5b");
      await saveStory(SAMPLE_DIR, sampleStory);
      await runVoice(SAMPLE_DIR);
      await pushRender(SAMPLE_DIR, model);
      const { status } = await fetchRender(SAMPLE_DIR, model, { wait: true });
      if (status !== "complete") throw new Error(`The ${model} job ended as "${status}"; see ${SAMPLE_DIR}/render/${model}/job.log`);
      await runAssemble(SAMPLE_DIR, model);
      return;
    }
    default:
      console.log(USAGE);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
