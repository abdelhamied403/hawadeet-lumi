import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MEDIA_DIR } from "./config";
import { getMediaFile, type ReviewPacket } from "./services/veogen";

// Downloads every file a packet points to into this machine's media folder (fresh each time, since a
// redone scene keeps its name) and returns the packet with local paths the reviewer can open.
export async function download(packet: ReviewPacket): Promise<ReviewPacket> {
  const local = async (path: string) => {
    const target = resolve(MEDIA_DIR, path);
    if (!target.startsWith(`${MEDIA_DIR}/`)) throw new Error(`Unexpected file path from the server: ${path}`);
    await mkdir(dirname(target), { recursive: true });
    await rm(target, { force: true });
    await Bun.write(target, await getMediaFile(path));
    return target;
  };
  const scenes = [];
  for (const scene of packet.scenes) {
    const files = [];
    for (const file of scene.files) files.push(await local(file));
    scenes.push({ ...scene, files });
  }
  const files = [];
  for (const file of packet.files) files.push(await local(file));
  return { ...packet, scenes, files };
}
