# Per-User settings writes are last-writer-wins

Status: accepted

`PUT /api/me/slot-cooking-times` and `PUT /api/me/preferences` replace the whole set and take no precondition. A User can be signed in on several devices at once (one Device session each), so two devices can each load the set, and when both save, the later save silently overwrites what the earlier one stored, including slots or fields the later device never touched. The settings screen widens the window: a User with no saved Slot cooking times starts from the default set, and a save from that screen sends those defaults for every slot it did not edit, even if another device saved real values in between (issue #104). We decided to keep it that way: the last write wins, and it is documented rather than prevented (decided 2026-10-14).

The reason is how little it costs the User against how much a fix would change. It needs two devices of the same User and a save on one of them between the load and the save on the other. Nothing is lost that the User cannot set again in the same screen. A precondition would change the contract of both routes, and the app's handling of them, for that rare case.

## Considered options

- **Conditional write.** The read returns a version (or `updatedAt`), the write sends it back, and a stale write is refused with a code the app answers by reloading. It prevents the overwrite, at the price of a contract change on both routes and a new error path in the app.
- **Write per slot.** The app sends only the slot it edited and the API merges it. It turns the `PUT` from "replace the three slots" into a partial write, which the onboarding and preferences spec (issue #2) ruled out.

## Consequences

- A save from one device can bring back values the User changed on another device moments before. The app does not detect it, and the API returns `200` with the set it stored.
- The frontend integration guide states the rule next to both routes, so a client does not assume a save merges with the stored set.
- Revisit when several Users can edit the same settings (family Accounts, v3): an overwrite would then undo another person's change, which they did not see and may not notice.
