// Prints the kept Page reports for a quick read in a terminal: bun run reports [how many]
// One line per report (newest first), then every Reel and post of the newest one.
import { format } from "date-fns";
import { totalPlays } from "./stages/analytics";
import { listReports } from "./server/store";

const reports = listReports(Number(process.argv[2]) || 12);
if (reports.length === 0) {
  console.log("No reports yet.");
  process.exit(0);
}

for (const report of reports) {
  const reels = report.reels.map((reel) => `${reel.title.split("|").at(-1)?.trim()}=${reel.plays}`).join(", ");
  console.log(`${format(new Date(report.takenAt), "yyyy-MM-dd HH:mm")}  followers ${report.page.followers}  plays ${totalPlays(report)}  [${reels}]`);
}

const latest = reports[0]!;
console.log("\nReels in the newest report:");
for (const reel of latest.reels) {
  const end = reel.retention.length ? `${Math.round((reel.retention.at(-1) ?? 0) * 100)}%` : "n/a";
  console.log(
    `  ${reel.title} (${Math.round(reel.lengthSeconds)}s, ${format(new Date(reel.publishedAt), "MM-dd HH:mm")}): ${reel.plays} plays, ${reel.replays} replays, ${reel.averageWatchSeconds.toFixed(1)}s avg, ${end} reached end, ${reel.reactions} reactions, ${reel.comments} comments, ${reel.follows} follows`,
  );
  console.log(`    retention ${reel.retention.map((share) => Math.round(share * 100)).join(" ")}`);
}
console.log("\nPosts in the newest report:");
for (const post of latest.posts) {
  console.log(`  ${format(new Date(post.publishedAt), "MM-dd HH:mm")} ${post.kind}: ${post.views} views, ${post.reactions} reactions, ${post.comments} comments, ${post.shares} shares | ${post.excerpt.slice(0, 50)}`);
}
