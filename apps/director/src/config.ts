import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  VEOGEN_URL: z.url().default("http://127.0.0.1:4527"),
  CLAUDE_BIN: z.string().min(1).default("claude"),
  CLAUDE_MODEL: z.string().min(1).default("claude-opus-5-5"),
  POLL_SECONDS: z.coerce.number().int().min(10).default(60),
  MAX_REJECTIONS: z.coerce.number().int().min(1).default(3),
});

// Empty strings in .env mean "not set".
const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ""));

export const config = envSchema.parse(raw);

// The director's own folder on this machine: the files under review are downloaded here (the server may
// be another machine), and the decisions and held steps are kept here.
export const DATA_DIR = resolve(homedir(), ".local/share/veogen-director");
export const MEDIA_DIR = resolve(DATA_DIR, "media");
// Every decision, one JSON object per line, so the owner can see what was approved and why.
export const LOG_PATH = resolve(DATA_DIR, "director-log.jsonl");

export const flags = {
  // Decide and log, but never approve, reject or change anything on the server.
  dryRun: process.argv.includes("--dry-run"),
  // Look once, then exit, instead of watching.
  once: process.argv.includes("--once"),
};
