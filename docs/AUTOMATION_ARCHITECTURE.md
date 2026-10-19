# Shiori Automation — locked architecture (Phase 0)

## Decisions

| Topic | Decision |
|-------|----------|
| Orchestrator | `api.shiori.cloud` owns configs + job rows (Postgres) |
| Heavy work | Windows `softsub-worker` polls bot-auth APIs |
| Telegram edge | `tel-bot` for subtitle channel intake, archive `get_`, draft preview/approve |
| Queue infra | No Redis/Bull in MVP — DB outbox + polling (same pattern as channel drafts) |
| HandBrake | Phase 2 / optional — MVP Path A is remux-only (`mkvmerge`) |
| Large MKV → archive | MVP: worker reaches `READY_FOR_ARCHIVE`; upload via Local Bot API **if** `telegramApiRoot` set, else leave file in `out/` and set job `NEEDS_REVIEW` / `AWAITING_MANUAL_ARCHIVE` for admin handoff. Do not auto-publish. |
| Subtitle channel | `SUBTITLE_CHANNEL_ID` on tel-bot (separate from archive/private) |
| Default automation status | `disabled` |
| Default trigger | subtitle-triggered; new-episode/RSS off |
| Final publish | Always existing channel-draft approve flow |

## Topology

- Linux: API + Postgres
- Separate host: tel-bot
- Windows: softsub-worker + qBittorrent + MKVToolNix (+ optional HandBrake / Local Bot API)

No shared filesystem between API and Windows.
