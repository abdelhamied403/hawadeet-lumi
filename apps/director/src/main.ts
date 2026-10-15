import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config, DATA_DIR, flags, LOG_PATH } from "./config";
import { review, type Decision } from "./review";
import { download } from "./media";
import { approveStep, getPacket, getStatus, rejectStep, sendAlert, updateScene, type EpisodeSummary, type StepName } from "./services/veogen";

// Steps handed to the owner (too many rejections, or a job that keeps failing). Kept on disk so a restart
// does not review them again; the key changes once the owner acts on the step.
const HELD_PATH = resolve(DATA_DIR, "director-held.json");
// A failed step is tried again this many times before it is handed to the owner.
const FAILURE_RETRIES = 1;

type State = { held: string[]; retried: Record<string, number> };

async function loadState(): Promise<State> {
  const file = Bun.file(HELD_PATH);
  return (await file.exists()) ? ((await file.json()) as State) : { held: [], retried: {} };
}

async function saveState(state: State): Promise<void> {
  await mkdir(dirname(HELD_PATH), { recursive: true });
  await Bun.write(HELD_PATH, JSON.stringify(state, null, 2));
}

async function log(entry: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(LOG_PATH), { recursive: true });
  await appendFile(LOG_PATH, `${JSON.stringify({ at: new Date().toISOString(), dryRun: flags.dryRun || undefined, ...entry })}\n`);
}

const label = (episode: EpisodeSummary, step: StepName) => `${episode.seriesTitle}, chapter ${episode.partNumber}: ${step}`;

async function hold(state: State, key: string, title: string, message: string): Promise<void> {
  state.held.push(key);
  await saveState(state);
  await log({ key, held: true, message });
  if (!flags.dryRun) await sendAlert({ title, message: message.slice(0, 1000) }).catch((error) => console.error(`alert: ${error}`));
}

async function act(episode: EpisodeSummary, step: StepName, decision: Decision): Promise<void> {
  // Rewritten descriptions are saved first, whether the step is approved (a script whose pictures would
  // otherwise come out wrong) or sent back (the scenes about to be redone).
  for (const fix of decision.promptFixes) {
    const payload = { ...(fix.imagePrompt ? { imagePrompt: fix.imagePrompt } : {}), ...(fix.motionPrompt ? { motionPrompt: fix.motionPrompt } : {}) };
    if (Object.keys(payload).length) await updateScene(episode.id, fix.scene, payload);
  }
  if (decision.approve) {
    await approveStep(episode.id, step);
    return;
  }
  await rejectStep(episode.id, step, { note: (decision.note || "Redo it.").slice(0, 4000), ...(decision.scenes.length ? { scenes: decision.scenes } : {}) });
}

async function reviewStep(state: State, episode: EpisodeSummary, step: StepName): Promise<void> {
  const packet = await download(await getPacket(episode.id, step));
  const key = `${episode.id}:${step}:${packet.attempt}`;
  if (state.held.includes(key)) return;
  console.log(`reviewing ${label(episode, step)} (attempt ${packet.attempt + 1})`);
  const started = Date.now();
  const decision = await review(packet);
  await log({ key, episode: episode.id, chapter: episode.partNumber, step, attempt: packet.attempt, seconds: Math.round((Date.now() - started) / 1000), ...decision });
  console.log(`${decision.approve ? "approved" : "sent back"} ${label(episode, step)}: ${decision.note}`);
  if (!decision.approve && packet.attempt >= config.MAX_REJECTIONS) {
    await hold(state, key, `${label(episode, step)} needs you`, `Sent back ${packet.attempt} times and still not right: ${decision.note}`);
    return;
  }
  if (!flags.dryRun) await act(episode, step, decision);
}

async function retryFailed(state: State, episode: EpisodeSummary, step: StepName): Promise<void> {
  const key = `${episode.id}:${step}:failed`;
  if (state.held.includes(key)) return;
  const tries = state.retried[key] ?? 0;
  if (tries >= FAILURE_RETRIES) {
    await hold(state, key, `${label(episode, step)} keeps failing`, "It failed again after a retry. Open Veogen to see the error.");
    return;
  }
  state.retried[key] = tries + 1;
  await saveState(state);
  await log({ key, retry: tries + 1 });
  console.log(`retrying ${label(episode, step)} after a failure`);
  if (!flags.dryRun) await rejectStep(episode.id, step, { note: "The last run failed; run it again." });
}

// One pass: every step waiting for review is reviewed, one at a time; failed steps are retried once.
async function pass(): Promise<void> {
  const state = await loadState();
  const { episodes } = await getStatus();
  // Earlier chapters first, so the GPU queue is fed in story order.
  for (const episode of [...episodes].sort((a, b) => a.seriesId - b.seriesId || a.partNumber - b.partNumber)) {
    for (const step of episode.steps) {
      // The publish step needs no review: a finished story goes out by itself, scheduled a day ahead.
      if (step.name === "publish") continue;
      // A step that ran again successfully gets its retry back for a later failure.
      const failedKey = `${episode.id}:${step.name}:failed`;
      if (step.status !== "failed" && step.status !== "queued" && step.status !== "running" && state.retried[failedKey] !== undefined) {
        delete state.retried[failedKey];
        await saveState(state);
      }
      try {
        if (step.status === "review") await reviewStep(state, episode, step.name);
        else if (step.status === "failed") await retryFailed(state, episode, step.name);
      } catch (error) {
        console.error(`${label(episode, step.name)}: ${error instanceof Error ? error.message : error}`);
        await log({ episode: episode.id, step: step.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}

console.log(`director watching ${config.VEOGEN_URL}${flags.dryRun ? " (dry run: nothing is changed)" : ""}`);
for (;;) {
  await pass().catch((error) => console.error(`pass: ${error instanceof Error ? error.message : error}`));
  if (flags.once) break;
  await Bun.sleep(config.POLL_SECONDS * 1000);
}
