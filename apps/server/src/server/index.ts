import { config } from "../config";
import { app } from "./api";
import { authEnabled } from "./auth";
import { tick } from "./engine";

const TICK_MS = 20_000;

// Without a login the API must not be reachable from the network.
if (!authEnabled && !["127.0.0.1", "localhost", "::1"].includes(config.HOST)) {
  throw new Error("Set AUTH_PASSWORD and JWT_SECRET in .env before listening on anything but 127.0.0.1");
}

Bun.serve({ hostname: config.HOST, port: config.SERVER_PORT, fetch: app.fetch, idleTimeout: 120 });
console.log(`veogen server on http://${config.HOST}:${config.SERVER_PORT}${authEnabled ? " (login required)" : ""}`);

void tick();
setInterval(() => void tick(), TICK_MS);
