# OpenClaw Automator

Windows-only local automation desk for OpenClaw chat/session flows.

It runs a local Node backend on `127.0.0.1:18890` and opens a browser UI. The backend discovers OpenClaw sessions and cron jobs, then runs OpenClaw CLI commands with argument arrays instead of shell-built strings.

## Start

Double-click:

```text
Start-OpenClaw-Automator.cmd
```

## Main Use

- Pick a chat session.
- Write the message the agent should receive.
- Choose a schedule preset: now, in 30 minutes, every 2 hours, morning, weekdays, or hourly.
- Choose whether the answer should message you back, POST to a webhook, or run quietly.
- Let the backend fill reply targets for Telegram sessions.
- Open **Advanced settings** only when you need exact schedule fields, job name/description, enabled state, session-key override, cron session target, agent/model override, subagent coordination, tools, webhook URL, stagger/exact cron timing, wake mode, or system-event mode.
- Watch the **Safety check** panel. It warns when the agent reads one chat/session but the answer goes somewhere else, even when that setup is technically valid.
- Use **Step plan controller** for scheduled jobs that should move through a precise list of steps. Fill the row grid with Step name, Next action, Done when, and State note; use **Add from previous** or row-level **Copy down** when the next row only needs small edits. It creates one repeating cron that advances through configured steps only after the agent reports the current step complete. Step controller jobs need the Automator backend running on `127.0.0.1:18890` when the agent reports progress.
- Step controller prompts intentionally include only the active row. Previous and future rows are not injected into the cron message. The prompt uses a bounded `/goal`-style contract: preserve the active-row scope, work from current evidence, and report complete only when the row's `Done when` condition is proven. The backend writes a read-only past-events log from controller transitions and matching local OpenClaw transcript/trajectory artifacts, so the agent can inspect focused history only when it needs more context.
- Hover on a control for 5 seconds to show contextual labels.
- Use **Simple** labels for plain-language explanations, or **Detailed** labels to see the exact OpenClaw behavior before acting.
- Click OpenClaw flag names inside Detailed labels, such as `--light-context`, to open the relevant official documentation page.
- Open labels stay visible while you move the mouse to their links; click `x`, click elsewhere, or press Escape to close them.

For a selected Telegram direct session, the immediate command is equivalent to:

```powershell
openclaw agent `
  --session-key "agent:main:telegram:direct:8910901726" `
  --message "Your automated message here" `
  --deliver `
  --reply-channel telegram `
  --reply-to 8910901726
```

For a repeating quiet cron job, the command shape is:

```powershell
openclaw cron add `
  --session-key "agent:main:telegram:direct:8910901726" `
  --session isolated `
  --every 2h `
  --message "Your automated message here" `
  --thinking xhigh `
  --expect-final `
  --no-deliver
```

Advanced cron controls mirror the useful Gateway `/cron` fields: `--disabled`, `--description`, `--agent`, `--model`, `--webhook`, `--best-effort-deliver`, `--stagger`, `--exact`, `--delete-after-run`, and `--keep-after-run`.

For a subagent-ready scheduled agent job, turn on **Enable subagents** in Advanced settings. Automator keeps the job as an agent-turn cron and appends prompt guidance so the scheduled agent can spawn advisory helper work and synthesize the result. Subagents are side-effect-free advisors: they may research, critique, fact-check, brainstorm, compare, inspect context, or review draft output. The parent agent validates their findings, fixes valid critique, owns all file/config/scheduler/message mutations, and reports COMPLETE or PROGRESS only after that review.

Leave **Tools** blank to keep OpenClaw's configured tool profile/defaults. If you fill **Tools**, Automator treats it as an explicit allow-list and merges in the subagent coordination tools:

```powershell
openclaw cron add `
  --session-key "agent:main:telegram:direct:8910901726" `
  --session isolated `
  --every 2h `
  --message "Research the topic and report back." `
  --thinking xhigh `
  --expect-final `
  --announce `
  --tools agents_list,sessions_spawn,sessions_yield,subagents
```

Named subagent target agents are OpenClaw config, not cron flags. If you fill **Subagent agents**, those IDs are included as preferred advisory targets in the prompt, but the requester agent must still allow them through `subagents.allowAgents`. Avoid nested subagents for normal Automator jobs. Nested advisory delegation requires `agents.defaults.subagents.maxSpawnDepth >= 2`.

Tool availability still follows OpenClaw tool policy. The `coding` and `full` profiles expose `sessions_spawn` by default; messaging or custom profiles may need `tools.alsoAllow: ["sessions_spawn", "sessions_yield", "subagents", "agents_list"]`. For safer deployments, configure `tools.subagents.tools` so spawned helper agents stay research/review scoped. Avoid child `exec` access unless shell access is intentionally needed.

## Requirements

- Windows 10/11.
- Node.js installed.
- OpenClaw installed and configured.
- OpenClaw Gateway running for live execution.

## State

Settings and local audit logs are written under:

```text
%USERPROFILE%\.openclaw\automator
```

Workflow event logs are available from the cron job list in the app and at:

```text
http://127.0.0.1:18890/workflows/<workflow-id>/events.txt
```

The agent does not write these log entries. Automator records controller events itself and passively reads matching OpenClaw session artifacts when the log is opened.

## Agent Workflow Intake

Agents should read:

```text
http://127.0.0.1:18890/agent-tools/workflow-intake
```

The preview response includes `activation`, `addCommandPreview`, `enableCommandPreview`, and `createRequestTemplate`.

Agents can request subagent-ready workflow controllers with `useSubagents: true` and optional `subagentAgents` as an array or comma-separated string. Those fields affect advisory prompt guidance and, when an explicit `tools` allow-list is supplied, merge in the coordination tools. OpenClaw config still controls tool profiles, spawned-agent tool policy, named target access, and nested subagent access.

For fresh-context reliability, use `createRequestTemplate` for the create call after the user replies with `approval.phrase`. Preserve its schedule, delivery, step rows, and `enabled`/`disabled`/`allowEnable` fields. Workflow controllers intentionally create the cron job disabled first, rewrite the prompt with the real workflow/job ids, then run the enable command when activation was explicitly requested and approved.
