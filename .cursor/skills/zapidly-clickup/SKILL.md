---
name: zapidly-clickup
description: >-
  Files and updates Zapidly tasks in the Wave.ai Solutions ClickUp workspace
  (space Zapidly). Use when the repo is leady-project, or the user mentions
  Zapidly ClickUp, Wave.ai, a CU- task reference, small tasks, or the v0.1
  product list. Do not use the AI Coach workspace or the clickup-task-flow skill.
---

# Zapidly ClickUp

Follow these steps in order. Do not skip a step because a later one is the visible part of the request.

1. we open a task on clickup with full details
2. we add the measurements/data we gathered and relevant task details
3. we add the expected change in measurements after this change.
4. we update the task's status
5. we update the description in case of a divergance or in case I added some new inputs on that.
6. we add a commit messages with task reference

## Where the work lives

- ClickUp workspace **Wave.ai Solutions**, team `1100360000008003`. Space **Zapidly**, id `1100360000038974`.
- Lists:
  - `small tasks` `1100360000102863` — a bugfix or a change that fits in one PR. Statuses: `to do`, `in progress`, `in review`, `complete`.
  - `v0.1 product` `1100360000049779` — roadmap and larger product work. Statuses: `to do`, `in progress`, `in review`, `on hold`, `complete`.
- Use the `zapidly-clickup` MCP (`user-zapidly-clickup`: `searchTasks`, `getTaskById`, `getListInfo`, `createTask`, `updateTask`, `addComment`). Read the tool schema before calling it. Task URLs are `https://app.clickup.com/t/{id}`.
- The API key is `CLICK_UP_TOKEN` in `/Users/naveeiny/leady-project/.env`. Never print it. If the MCP is down, call `https://api.clickup.com/api/v2/` with that raw `pk_` token as `Authorization` (not `Bearer`). Create and replace descriptions with `markdown_description`.
- Product code is this repo, `/Users/naveeiny/leady-project`.
- Never file Zapidly work on the AI Coach workspace, team `90181603740`, or the `user-clickup` MCP.

## Open or pick up

Search the Zapidly space before creating a task. If one already matches, update it.

A new task's description has: why it matters, what the data says (numbers and the source), what we will do and why, and done-when.

## Measurements

Put both of these on the task. A comment is the right place when the description is already the spec. Use the description itself when filing a new task.

- Measurements now: the numbers already gathered, with the population they describe. Do not invent a baseline split the data does not have.
- Expected change after this ships: the same metrics, the subset this change affects, and the control that should stay put. Name how to count it (table, column, or event).

## Status

`to do` when filed. `in progress` while reading the code or implementing. `in review` once the change is committed and waiting on a real run. `complete` only when the user says the check passed. `on hold` only on `v0.1 product`, and only when the user pauses the work.

## Description

Replace the description when the implementation diverges from it, or when the user adds a constraint. Read the current description first and keep every part that is still true. Say what changed and why. Do not append a second copy of the old plan.

## Commit

After making the code change, commit it in the same turn. Write the message. Do not leave the change uncommitted for the user to describe.

The ClickUp reference is `CU-{task_id}`, for example `CU-z8rp3f4yy0`. Use that form in the message. Do not write `ClickUp {id}` or a bare id.

Commit only the files for this task. The message says why. Do not commit secrets, `.env`, or unrelated staged files. Do not push unless asked.
