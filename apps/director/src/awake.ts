import { readdir } from "node:fs/promises";
import type { Subprocess } from "bun";

// While a story is being made and the laptop is on mains power, the laptop is kept from going to sleep,
// so the director keeps reviewing with the screen locked. On battery, or with no story in progress, it
// sleeps as usual. Closing the lid still sleeps it.
let lock: Subprocess | null = null;

async function onMainsPower(): Promise<boolean> {
  const supplies = await readdir("/sys/class/power_supply").catch(() => [] as string[]);
  for (const supply of supplies) {
    const type = await Bun.file(`/sys/class/power_supply/${supply}/type`).text().catch(() => "");
    if (type.trim() !== "Mains") continue;
    if ((await Bun.file(`/sys/class/power_supply/${supply}/online`).text().catch(() => "0")).trim() === "1") return true;
  }
  return false;
}

export async function keepAwake(storyInProgress: boolean): Promise<void> {
  const wanted = storyInProgress && (await onMainsPower());
  if (wanted && !lock) {
    lock = Bun.spawn(["systemd-inhibit", "--what=sleep:idle", "--who=Veogen director", "--why=A kids story is being made", "sleep", "infinity"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    console.log("keeping the laptop awake while the story is being made");
  } else if (!wanted && lock) {
    lock.kill();
    lock = null;
    console.log("the laptop may sleep again");
  }
}

export function releaseAwake(): void {
  lock?.kill();
  lock = null;
}
