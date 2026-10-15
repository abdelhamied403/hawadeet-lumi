# Veogen director

Runs beside the kids' Veogen server (`apps/server`, port 4527) and takes the owner's place in review:
- Every minute it asks the server which steps of which chapters are waiting for review.
- It hands each step to Claude through the Claude Code CLI (`claude -p`, read-only), which approves the step or sends it back with what to fix.

## What it reviews

| Step | What Claude gets |
| --- | --- |
| Script | Every line, the chapter plan, the proofreader's flags |
| Voice | The server's transcription of each scene compared with the script (Claude cannot listen), and each scene's length |
| Images | A sheet of every picture, then each picture, with who and what it should show |
| Clips | Four frames of every clip, start to end |
| Video | Frames every few seconds, plus the loudness |

The publish step needs no review. When every chapter is finished, the server does the following by itself:
1. Joins the chapters into the full story and schedules it on YouTube a day ahead. That day is the owner's window to stop it.
2. Schedules one chapter a day after it as a Short.

## When it hands over to the owner

It stops sending a step back and sends an alert (needs `NTFY_TOPIC` in `apps/server/.env`) in two cases:
- the same step has been sent back `MAX_REJECTIONS` times (default 3)
- a step fails again after one retry

These steps are recorded in `~/.local/share/veogen-director/director-held.json` and left alone until the owner acts on them in the app. Every decision is logged in `~/.local/share/veogen-director/director-log.jsonl`.

The server can be another machine (`VEOGEN_URL`, for example through an SSH tunnel). The files under review are downloaded into `~/.local/share/veogen-director/media` before Claude opens them.

## Run

```sh
bun install
bun run dry-run        # decide and log once, change nothing
bun run director       # watch and act
```

The server runs on an always-on machine (`veogen-kids-server.service`, installed there as a system service). On the laptop, the director and an SSH tunnel to that server run as user services:

```sh
cp systemd/veogen-director.service systemd/veogen-tunnel.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now veogen-tunnel veogen-director
journalctl --user -u veogen-director -f
```

The tunnel needs a `Host oracle` entry in `~/.ssh/config`.

Settings go in `.env`; see `.env.example`.
