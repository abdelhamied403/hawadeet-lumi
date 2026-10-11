#!/usr/bin/env python3
"""veogen-widget: floating desktop widget + tray icon showing where each part of the series is.

Reads the local Veogen server, so it shows the same state as the dashboard.

  veogen_widget.py           start the widget (single instance; running it again shows the widget)
  veogen_widget.py --print   fetch once and print the status to the terminal
"""
import json
from datetime import datetime
import os
import subprocess
import sys
import threading
import urllib.request

STATUS_URL = "http://127.0.0.1:4517/api/status"
CONFIG_DIR = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "veogen-widget")
CACHE_DIR = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "veogen-widget")
STATE_FILE = os.path.join(CONFIG_DIR, "state.json")
POLL_SECONDS = 15

STEPS = [("story", "Script"), ("voice", "Voice"), ("images", "Images"), ("clips", "Motion"), ("video", "Final cut"),
         ("publish", "Publish")]
LABELS = dict(STEPS)
# How a step's state reads, and which of the four looks it gets.
IDLE, WORKING, NEEDS_YOU, FAILED, DONE = "idle", "working", "needs", "failed", "done"
LOOK = {"waiting": IDLE, "queued": WORKING, "running": WORKING, "review": NEEDS_YOU, "approved": DONE, "failed": FAILED}
WORDS = {"waiting": "not started", "queued": "starting", "running": "working", "review": "needs you",
         "approved": "approved", "failed": "failed"}
COLORS = {IDLE: "#5c7178", WORKING: "#6fb7c9", NEEDS_YOU: "#e9a23b", FAILED: "#e0635a", DONE: "#62b89b"}


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def fetch_status():
    """The server's status, or None when it is not running."""
    try:
        with urllib.request.urlopen(STATUS_URL, timeout=6) as response:
            return json.load(response)
    except Exception:  # noqa: BLE001
        return None


def current_step(episode):
    """The step a part is on: the first one that is not approved."""
    for step in episode["steps"]:
        if step["status"] != "approved":
            return step
    return None


def overall(status):
    """One look for everything: what the tray icon and subtitle show."""
    if status is None:
        return IDLE
    looks = [LOOK[step["status"]] for episode in status["episodes"] for step in [current_step(episode)] if step]
    for look in (FAILED, NEEDS_YOU, WORKING):
        if look in looks:
            return look
    return IDLE


def timing(step):
    """What to say about a step's time: when it should be done, or how long it will take."""
    if step.get("endsAt"):
        ends = datetime.fromisoformat(step["endsAt"].replace("Z", "+00:00")).astimezone()
        if ends < datetime.now().astimezone():
            return "should finish any minute"
        return "done about " + ends.strftime("%-I:%M %p")
    seconds = step.get("estimateSeconds")
    if not seconds:
        return ""
    minutes = max(1, round(seconds / 300) * 5 or round(seconds / 60))
    hours, rest = divmod(minutes, 60)
    return "about " + " ".join(part for part in (f"{hours} h" if hours else "", f"{rest} min" if rest else "") if part)


def print_status():
    status = fetch_status()
    if status is None:
        print("The Veogen server is not running.")
        return 1
    if not status["episodes"]:
        print("No part in production.")
    for episode in status["episodes"]:
        print(f"{episode['seriesTitle']}  part {episode['partNumber']} of {episode['totalParts']}")
        for step in episode["steps"]:
            print(f"  {LABELS[step['name']]:<10} {WORDS[step['status']]:<12} {timing(step)}")
    return 0


if "--print" in sys.argv:
    sys.exit(print_status())

import gi  # noqa: E402

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("XApp", "1.0")
gi.require_version("Notify", "0.7")
from gi.repository import Gdk, GLib, Gtk, Notify, Pango, XApp  # noqa: E402

WIDTH = 340
CSS = """
window.vg { background: transparent; }
.vg-card { background: rgba(15, 26, 30, 0.97); border: 1px solid rgba(233, 162, 59, 0.22); border-radius: 12px;
  font-family: "IBM Plex Sans", "Ubuntu Sans", "Ubuntu", sans-serif; }
.vg-header { padding: 11px 6px 9px 14px; }
.vg-title { font-weight: 800; font-size: 14px; letter-spacing: 3px; color: #e9a23b; }
.vg-sub { font-size: 11px; color: #8da3a1; }
.vg-sub.needs { color: #e9a23b; font-weight: 700; }
.vg-sub.failed { color: #e0635a; font-weight: 700; }

button.vg-icon, button.vg-part, button.vg-open { background: none; background-image: none; border: none;
  box-shadow: none; min-height: 0; min-width: 0; }
button.vg-icon { padding: 5px; border-radius: 7px; color: #8da3a1; }
button.vg-icon:hover { background: rgba(255, 255, 255, 0.07); color: #e4ece8; }
button.vg-icon.vg-lock:checked { background: rgba(233, 162, 59, 0.16); color: #e9a23b; }

button.vg-part { margin: 0 10px 10px 10px; padding: 11px 12px 10px 12px; border-radius: 9px;
  background-color: #16252b; border: 1px solid rgba(255, 255, 255, 0.06); }
button.vg-part:hover { background-color: #1d3037; }
button.vg-part.p-needs { border-color: rgba(233, 162, 59, 0.55); }
button.vg-part.p-failed { border-color: rgba(224, 99, 90, 0.6); }
.vg-series { font-size: 15px; font-weight: 700; color: #e4ece8; }
.vg-partno { font-family: "IBM Plex Mono", "Ubuntu Mono", monospace; font-size: 10px; color: #8da3a1; }
.vg-now { font-size: 11px; color: #8da3a1; }
.vg-now.needs { color: #e9a23b; font-weight: 700; }
.vg-now.failed { color: #e0635a; font-weight: 700; }
.vg-now.working { color: #6fb7c9; }

/* The six steps as frames on a strip of film. */
.vg-strip { background: #0a1215; border-radius: 4px; padding: 5px 4px; margin: 8px 0 7px 0; }
.vg-frame { min-height: 20px; border-radius: 2px; background: #1d3037; }
.vg-frame.f-done { background: #62b89b; }
.vg-frame.f-working { background: #6fb7c9; }
.vg-frame.f-needs { background: #e9a23b; }
.vg-frame.f-failed { background: #e0635a; }
.vg-step { font-size: 9px; color: #5c7178; }
.vg-step.on { color: #e4ece8; font-weight: 700; }

.vg-empty { padding: 6px 22px 16px 22px; }
.vg-empty-title { font-size: 13px; font-weight: 700; color: #e4ece8; }
.vg-hint { font-size: 11px; color: #8da3a1; }

.vg-foot { padding: 0 12px 11px 14px; }
.vg-gpu { font-family: "IBM Plex Mono", "Ubuntu Mono", monospace; font-size: 10px; color: #8da3a1; }
.vg-meter { min-height: 3px; border-radius: 2px; background: #1d3037; }
.vg-meter-fill { min-height: 3px; border-radius: 2px; background: #e9a23b; }
button.vg-open { padding: 4px 10px; border-radius: 7px; font-size: 11px; font-weight: 700; color: #1a1304;
  background: #e9a23b; }
button.vg-open:hover { background: #f0b65c; }
"""


def classed(widget, *classes):
    for name in classes:
        widget.get_style_context().add_class(name)
    return widget


def label(text, css, **props):
    w = Gtk.Label(xalign=0, **props)
    w.set_text(text)
    return classed(w, css)


class App(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="local.veogenwidget")
        self.window = None
        self.activated = False
        self.status = None
        self.polling = False
        # Step states already announced, so each "needs you" alerts once.
        self.announced = None
        self.state = {"visible": True, "keep_above": False, "locked": False, **load_json(STATE_FILE, {})}

    # ---- lifecycle -------------------------------------------------------

    def do_startup(self):
        Gtk.Application.do_startup(self)
        Notify.init("Veogen")
        os.makedirs(CONFIG_DIR, exist_ok=True)
        os.makedirs(CACHE_DIR, exist_ok=True)
        self.icons = {}
        for look, color in COLORS.items():
            self.icons[look] = os.path.join(CACHE_DIR, f"{look}.svg")
            with open(self.icons[look], "w") as f:
                # A film frame: a rounded rectangle with a notch of sprocket holes.
                f.write('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22">'
                        f'<rect x="4" y="5" width="14" height="12" rx="2.5" fill="{color}"/>'
                        '<rect x="6" y="7" width="2" height="2" rx="0.6" fill="#0f1a1e"/>'
                        '<rect x="6" y="13" width="2" height="2" rx="0.6" fill="#0f1a1e"/></svg>')

        provider = Gtk.CssProvider()
        provider.load_from_data(CSS.encode())
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        self.build_window()
        self.build_tray()
        self.hold()
        self.poll()
        GLib.timeout_add_seconds(POLL_SECONDS, self.on_timer)

    def do_activate(self):
        # First activation honours the saved visibility; later ones (re-launch) always show.
        first, self.activated = not self.activated, True
        if first and not self.state["visible"]:
            return
        self.show_window()

    def save_state(self):
        with open(STATE_FILE, "w") as f:
            json.dump(self.state, f)

    # ---- UI --------------------------------------------------------------

    def build_window(self):
        win = self.window = classed(Gtk.Window(application=self, title="Veogen"), "vg")
        win.set_decorated(False)
        win.set_skip_taskbar_hint(True)
        win.set_skip_pager_hint(True)
        win.set_type_hint(Gdk.WindowTypeHint.UTILITY)
        win.set_default_size(WIDTH, 1)
        win.set_resizable(False)
        win.stick()
        win.set_keep_above(self.state["keep_above"])
        visual = win.get_screen().get_rgba_visual()
        if visual:
            win.set_visual(visual)
        win.connect("delete-event", lambda *_: self.hide_window() or True)
        win.connect("configure-event", self.on_moved)

        card = classed(Gtk.Box(orientation=Gtk.Orientation.VERTICAL), "vg-card")
        win.add(card)

        header = classed(Gtk.Box(spacing=2), "vg-header")
        titles = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        titles.pack_start(label("VEOGEN", "vg-title"), False, False, 0)
        self.subtitle = label("Connecting…", "vg-sub", ellipsize=Pango.EllipsizeMode.END)
        titles.pack_start(self.subtitle, False, False, 0)
        header.pack_start(titles, True, True, 0)
        self.lock_btn = classed(Gtk.ToggleButton(active=self.state["locked"]), "vg-icon", "vg-lock")
        self.lock_btn.set_valign(Gtk.Align.CENTER)
        self.lock_btn.connect("toggled", self.on_lock)
        self.on_lock(self.lock_btn)
        header.pack_start(self.lock_btn, False, False, 0)
        for icon, tip, handler in (("view-refresh-symbolic", "Refresh now", lambda _: self.poll()),
                                   ("window-close-symbolic", "Hide (the panel icon brings it back)",
                                    lambda _: self.hide_window())):
            btn = classed(Gtk.Button.new_from_icon_name(icon, Gtk.IconSize.MENU), "vg-icon")
            btn.set_tooltip_text(tip)
            btn.set_valign(Gtk.Align.CENTER)
            btn.connect("clicked", handler)
            header.pack_start(btn, False, False, 0)
        drag = Gtk.EventBox()  # the header is the drag handle
        drag.add(header)
        drag.connect("button-press-event", lambda _, e: win.begin_move_drag(
            e.button, int(e.x_root), int(e.y_root), e.time) if e.button == 1 and not self.state["locked"] else None)
        card.pack_start(drag, False, False, 0)

        self.list = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        card.pack_start(self.list, False, False, 0)

        foot = classed(Gtk.Box(spacing=12), "vg-foot")
        gpu = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=3)
        gpu.set_valign(Gtk.Align.CENTER)
        self.gpu_label = label("", "vg-gpu")
        gpu.pack_start(self.gpu_label, False, False, 0)
        self.meter = classed(Gtk.Box(), "vg-meter")
        self.meter_fill = classed(Gtk.Box(), "vg-meter-fill")
        self.meter_fill.set_halign(Gtk.Align.START)
        self.meter.pack_start(self.meter_fill, False, False, 0)
        gpu.pack_start(self.meter, False, False, 0)
        foot.pack_start(gpu, True, True, 0)
        open_btn = classed(Gtk.Button(label="Open dashboard"), "vg-open")
        open_btn.set_valign(Gtk.Align.CENTER)
        open_btn.connect("clicked", lambda _: self.open_dashboard())
        foot.pack_start(open_btn, False, False, 0)
        card.pack_start(foot, False, False, 0)
        card.show_all()

    def build_tray(self):
        self.tray = XApp.StatusIcon()
        self.tray.set_name("veogen-widget")
        self.tray.set_icon_name(self.icons[IDLE])
        self.tray.set_tooltip_text("Veogen")
        self.tray.connect("activate", lambda *_: self.toggle_window())

        menu = Gtk.Menu()
        dashboard = Gtk.MenuItem(label="Open dashboard")
        dashboard.connect("activate", lambda _: self.open_dashboard())
        refresh = Gtk.MenuItem(label="Refresh now")
        refresh.connect("activate", lambda _: self.poll())
        above = Gtk.CheckMenuItem(label="Keep on top", active=self.state["keep_above"])
        above.connect("toggled", self.on_keep_above)
        quit_item = Gtk.MenuItem(label="Quit")
        quit_item.connect("activate", lambda _: self.quit())
        for item in (dashboard, refresh, above, Gtk.SeparatorMenuItem(), quit_item):
            menu.append(item)
        menu.show_all()
        self.tray.set_secondary_menu(menu)

    def show_window(self):
        if "x" in self.state:
            self.window.move(self.state["x"], self.state["y"])
        else:
            area = Gdk.Display.get_default().get_primary_monitor().get_workarea()
            self.window.move(area.x + area.width - WIDTH - 16, area.y + area.height - 320)
        self.window.present()
        self.state["visible"] = True
        self.save_state()

    def hide_window(self):
        self.window.hide()
        self.state["visible"] = False
        self.save_state()

    def toggle_window(self):
        if self.window.get_visible():
            self.hide_window()
        else:
            self.show_window()

    def on_keep_above(self, item):
        self.state["keep_above"] = item.get_active()
        self.window.set_keep_above(self.state["keep_above"])
        self.save_state()

    def on_lock(self, btn):
        locked = self.state["locked"] = btn.get_active()
        btn.set_image(Gtk.Image.new_from_icon_name(
            "changes-prevent-symbolic" if locked else "changes-allow-symbolic", Gtk.IconSize.MENU))
        btn.set_tooltip_text("Locked in place — click to unlock" if locked else "Lock in place")
        self.save_state()

    def on_moved(self, win, _event):
        if win.get_visible():
            x, y = win.get_position()
            if (x, y) != (self.state.get("x"), self.state.get("y")):
                self.state["x"], self.state["y"] = x, y
                self.save_state()

    def open_dashboard(self, path=""):
        base = (self.status or {}).get("dashboardUrl", "http://localhost:4518")
        subprocess.Popen(["xdg-open", base + path])

    # ---- rendering -------------------------------------------------------

    def part_card(self, episode):
        step = current_step(episode)
        look = LOOK[step["status"]] if step else DONE
        card = classed(Gtk.Button(), "vg-part", f"p-{look}")
        card.set_tooltip_text("Open this part in the dashboard")
        card.connect("clicked", lambda _, path=f"/episodes/{episode['id']}": self.open_dashboard(path))
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        card.add(box)

        top = Gtk.Box(spacing=8)
        title = label(episode["seriesTitle"], "vg-series", ellipsize=Pango.EllipsizeMode.END)
        title.set_xalign(1)  # Arabic titles read from the right
        top.pack_start(label(f"PART {episode['partNumber']}/{episode['totalParts']}", "vg-partno"), False, False, 0)
        top.pack_start(title, True, True, 0)
        box.pack_start(top, False, False, 0)

        strip = classed(Gtk.Box(homogeneous=True, spacing=3), "vg-strip")
        names = Gtk.Box(homogeneous=True, spacing=3)
        for item in episode["steps"]:
            strip.pack_start(classed(Gtk.Box(), "vg-frame", f"f-{LOOK[item['status']]}"), True, True, 0)
            name = label(LABELS[item["name"]], "vg-step", ellipsize=Pango.EllipsizeMode.END)
            name.set_xalign(0.5)
            if step and item["name"] == step["name"]:
                classed(name, "on")
            names.pack_start(name, True, True, 0)
        box.pack_start(strip, False, False, 0)
        box.pack_start(names, False, False, 0)

        now = f"{LABELS[step['name']]}: {WORDS[step['status']]}" if step else "Published"
        if step and timing(step):
            now += f"  ·  {timing(step)}"
        line = classed(label(now, "vg-now"), look)
        line.set_margin_top(7)
        box.pack_start(line, False, False, 0)
        return card

    def empty_state(self, title, hint):
        box = classed(Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=3), "vg-empty")
        box.pack_start(label(title, "vg-empty-title"), False, False, 0)
        box.pack_start(label(hint, "vg-hint", wrap=True, max_width_chars=40), False, False, 0)
        return box

    def render(self):
        for child in self.list.get_children():
            self.list.remove(child)
        status = self.status
        look = overall(status)

        if status is None:
            self.list.pack_start(self.empty_state(
                "The Veogen server is not running",
                "Start it with: systemctl --user start veogen-server"), False, False, 0)
            subtitle = "Not connected"
        elif not status["episodes"]:
            self.list.pack_start(self.empty_state(
                "No part in production",
                "A new script is written every day, or start one from the dashboard."), False, False, 0)
            subtitle = "Nothing needs you"
        else:
            for episode in status["episodes"]:
                self.list.pack_start(self.part_card(episode), False, False, 0)
            waiting = status.get("needsYou", 0)
            subtitle = (f"{waiting} waiting for you" if waiting else
                        "Working" if look == WORKING else "Nothing needs you")

        self.subtitle.set_text(subtitle)
        context = self.subtitle.get_style_context()
        for name in (NEEDS_YOU, FAILED):
            (context.add_class if look == name else context.remove_class)(name)

        quota = (status or {}).get("quota")
        if quota and quota.get("allowedSeconds"):
            used, allowed = quota["usedSeconds"] / 3600, quota["allowedSeconds"] / 3600
            self.gpu_label.set_text(f"GPU {used:.1f} / {allowed:.0f} h this week")
            self.meter_fill.set_size_request(int(min(1, used / allowed) * 170), 3)
            self.meter.show()
        else:
            self.gpu_label.set_text("")
            self.meter.hide()

        self.list.show_all()
        self.window.resize(WIDTH, 1)
        self.tray.set_icon_name(self.icons[look])
        self.tray.set_tooltip_text(f"Veogen: {subtitle.lower()}")

    def notify(self):
        """Alerts once for each step that newly needs a decision."""
        seen = set()
        for episode in (self.status or {}).get("episodes", []):
            for step in episode["steps"]:
                if step["status"] in ("review", "failed"):
                    seen.add((episode["id"], step["name"], step["status"], episode["seriesTitle"], episode["partNumber"]))
        if self.announced is not None:
            for _id, name, state, series, part in seen - self.announced:
                Notify.Notification.new(
                    f"Veogen: {LABELS[name].lower()} {WORDS[state]}", f"{series}, part {part}", self.icons[LOOK[state]]).show()
        self.announced = seen

    # ---- polling ---------------------------------------------------------

    def poll(self):
        if self.polling:
            return
        self.polling = True
        threading.Thread(target=self.poll_worker, daemon=True).start()

    def poll_worker(self):
        status = fetch_status()
        GLib.idle_add(self.on_status, status)

    def on_status(self, status):
        self.polling = False
        self.status = status
        self.notify()
        self.render()
        return False

    def on_timer(self):
        self.poll()
        return True


if __name__ == "__main__":
    sys.exit(App().run([sys.argv[0]]))
