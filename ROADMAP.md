# Roadmap

Goal: the TaskFlow panel is a polished sidebar + list UI for task management, backed by plain markdown. This revises the original Milestone 3 scope (agreed 2026-07-18).

## Milestone 3 — Sidebar shell, remaining views, recurrence (branch: `m3-sidebar-shell`)

**Navigation (the sidebar):**

- Six fixed lists with distinct icons, accent colors, and count badges:
  **Inbox** (tray), **Today** (star, count badge), **Upcoming** (calendar), **Whenever** (stack), **Someday** (box), **History** (check).
- Below a divider, **Areas and projects**: projects with `area: <name>` frontmatter group under collapsible area headers; projects without an area list standalone. Each project row shows a circular progress pie (done ÷ total) and opens a per-project view grouped by heading.
- Someday-status projects appear dimmed at the bottom of the project list (and their content in Someday).
- Layout adapts: in the narrow right sidebar the nav is a collapsible panel above the list; opened as a workspace tab it becomes a true two-pane sidebar + content layout.
- **Removed:** the This Week / Future tabs from M2 — Upcoming covers both, date-grouped.

**Views:**

- **Upcoming** — tasks dated after today, grouped with friendly headers: Tomorrow, weekday names for the rest of this week, then `Mon DD`. Placement by the earlier of scheduled/due.
- **Today** — overdue items surface at the top, visually flagged.
- **Whenever** — tasks in active projects with no scheduled date.
- **Someday** — tasks in `status: someday` projects.
- **History** — completed/cancelled tasks from the index completion log, grouped by completion day, newest first, with project labels.

**Recurrence:** completing a `🔁` task computes the next occurrence via rrule (anchor: scheduled → due → today), rewrites the line as a fresh todo with advanced date(s), and appends a completion entry to the index log. Minimum coverage: `every day`, `every week`, `every 3rd friday`, `every weekday`.

**Tests:** recurrence advancement (incl. month boundary, `every 3rd friday`), Upcoming grouping, area/project grouping. Tag `v0.3.0`.

## Milestone 4 — Visual fidelity + interactions (branch: `m4-visual-polish`)

- Pixel-fidelity pass: typography, spacing, checkbox styling, and the list color system mapped onto Obsidian theme variables (works in light and dark).
- Completion micro-interaction: checkbox fill animation and a brief linger before the task leaves the list.
- Floating "magic plus" button: quick capture pre-targeted at the current list/project.
- Keyboard navigation: arrow-key selection, Space to complete, Cmd/Ctrl+1–6 to switch lists.
- Drag-and-drop manual reordering, persisted through the index `order` map.
- Deadline proximity badges ("3 days left") on due tasks.
- Tag `v0.4.0`.

## Milestone 5 — Pinned filters + daily-note sync (branch: `m5-filters-daily-sync`)

Power features (agreed 2026-07-19):

- **Pinned filters (smart lists):** saved filters — tags (all must match), project, area, date window (overdue / today / this week / no date / has date), title text — stored in data.json, pinned to the sidebar below the six lists with live counts. Created/edited via a form modal; open tasks only. A query syntax can layer on later.
- **Daily-note sync:** completing a task appends a journal line (`- ✅ 14:32 Title ([[Project]])` + hidden ID marker) under a configurable `## Completed` heading in that day's daily note (folder/format read from the Daily Notes core plugin). Non-checkbox format so the indexer ignores it. Uncompleting removes the line — same day it was logged to, even days later. On/off + heading name in settings; a backfill command syncs today's completions on demand. Tag `v0.5.0`.

## Milestone 6 — Core-workflow completeness pass (branch: `m6-parity`)

In order: task-level Someday → Tonight section → checklists (child checkboxes rendered inside the parent with progress count) → after-completion repeats (`every week after done`) → clickable Areas (area = view over its projects' tasks) → Quick search (fuzzy task/project search in-panel).

## Later / candidates

- "Tonight" section in Today (🌙 token).
- Checklists: indented child checkboxes rendered inside the parent task with progress count.
- After-completion repeat variant (`🔁 every week after done`).
- Global (system-wide) quick-capture hotkey on desktop.
- Tag filter bar and vault-wide task search.
- List virtualization for large Historys.
- Due-task reminders via OS notifications — desktop only, and only while Obsidian is running (plugins have no background scheduler and no mobile local-notification API; in-app `Notice` is the only universal channel).
- Drag tasks onto sidebar lists (drop on Today/project to schedule/move); multi-select batch actions; undo toast; complete-whole-project flow.
- Completion stats view (streaks/heatmap from the completion log); weekly review mode; project templates.
