// One-off setup: turns the three temporary FB_* values in .env into FACEBOOK_PAGE_ID and
// FACEBOOK_PAGE_TOKEN, then removes the temporary values. Never prints a token.
import { exchangeUserToken, listManagedPages } from "./services/facebook";

const ENV_PATH = ".env";
const TEMPORARY = ["FB_APP_ID", "FB_APP_SECRET", "FB_USER_TOKEN"];

const { FB_APP_ID, FB_APP_SECRET, FB_USER_TOKEN } = process.env;
if (!FB_APP_ID || !FB_APP_SECRET || !FB_USER_TOKEN) {
  console.error(`Add ${TEMPORARY.join(", ")} to .env first.`);
  process.exit(1);
}

const longLived = await exchangeUserToken({ appId: FB_APP_ID, appSecret: FB_APP_SECRET, userToken: FB_USER_TOKEN });
const pages = await listManagedPages(longLived);
if (pages.length === 0) {
  console.error("The token gives access to no Pages. Generate it again and tick the Page when Facebook asks.");
  process.exit(1);
}

// With several Pages, pass part of the name: bun run facebook-connect حواديت
const wanted = process.argv[2];
const matches = wanted ? pages.filter((page) => page.name.includes(wanted)) : pages;
if (matches.length !== 1) {
  console.error(`Pick one Page by passing part of its name:\n${pages.map((page) => `  ${page.name} (${page.id})`).join("\n")}`);
  process.exit(1);
}
const page = matches[0]!;

const dropped = [...TEMPORARY, "FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN"];
const kept = (await Bun.file(ENV_PATH).text())
  .split("\n")
  .filter((line) => !dropped.some((key) => line.startsWith(`${key}=`)));
while (kept.at(-1) === "") kept.pop();
await Bun.write(ENV_PATH, `${kept.join("\n")}\nFACEBOOK_PAGE_ID=${page.id}\nFACEBOOK_PAGE_TOKEN=${page.access_token}\n`);

console.log(`Connected "${page.name}" (${page.id}). Restart the server: systemctl --user restart veogen-server`);
