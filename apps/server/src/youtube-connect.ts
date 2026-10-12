// One-off setup: connects the YouTube channel that finished videos are uploaded to.
// Needs YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env (an OAuth client of type "Desktop app" from
// Google Cloud). Opens Google's consent page, then stores YOUTUBE_REFRESH_TOKEN in .env. Never prints a token.
import { exchangeCode, getOwnChannel } from "./services/youtube";

const ENV_PATH = ".env";
const PORT = 4519;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
// Upload videos, read the channel and its videos' counts, and read watch time for the Analysis tab.
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET } = process.env;
if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
  console.error("Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to .env first.");
  process.exit(1);
}

const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
consent.search = new URLSearchParams({
  client_id: YOUTUBE_CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPES.join(" "),
  // Both are needed for Google to hand back a refresh token.
  access_type: "offline",
  prompt: "consent",
}).toString();

console.log(`Open this address in the browser where you are signed in to the channel's Google account:\n\n${consent}\n\nWaiting for you to allow access…`);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/callback") return new Response("Not found", { status: 404 });
    const code = url.searchParams.get("code");
    if (!code) return finish(`Google did not allow access: ${url.searchParams.get("error") ?? "no code returned"}`, false);
    try {
      const tokens = await exchangeCode({ clientId: YOUTUBE_CLIENT_ID, clientSecret: YOUTUBE_CLIENT_SECRET, code, redirectUri: REDIRECT });
      const channel = await getOwnChannel(tokens.accessToken);
      const kept = (await Bun.file(ENV_PATH).text()).split("\n").filter((line) => !line.startsWith("YOUTUBE_REFRESH_TOKEN="));
      while (kept.at(-1) === "") kept.pop();
      await Bun.write(ENV_PATH, `${kept.join("\n")}\nYOUTUBE_REFRESH_TOKEN=${tokens.refreshToken}\n`);
      return finish(`Connected the channel "${channel.title}" (${channel.url}).`, true);
    } catch (error) {
      return finish(error instanceof Error ? error.message : String(error), false);
    }
  },
});

function finish(message: string, ok: boolean): Response {
  console[ok ? "log" : "error"](message);
  // Let the page reach the browser before the script ends.
  setTimeout(() => {
    void server.stop();
    process.exit(ok ? 0 : 1);
  }, 500);
  return new Response(`${message}\n\nYou can close this tab.`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
