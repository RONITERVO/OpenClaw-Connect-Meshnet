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
- Open **Advanced settings** only when you need exact schedule fields, job name/description, enabled state, session-key override, cron session target, agent/model override, tools, webhook URL, stagger/exact cron timing, wake mode, or system-event mode.
- Watch the **Safety check** panel. It warns when the agent reads one chat/session but the answer goes somewhere else, even when that setup is technically valid.
- Use **Step plan controller** for scheduled jobs that should move through a precise list of steps. Fill the row grid with Step name, Next action, Done when, and State note; use **Add from previous** or row-level **Copy down** when the next row only needs small edits. It creates one repeating cron that advances through configured steps only after the agent reports the current step complete. Step controller jobs need the Automator backend running on `127.0.0.1:18890` when the agent reports progress.
- Step controller prompts intentionally include only the active row. Previous and future rows are not injected into the cron message. The backend writes a read-only past-events log from controller transitions and matching local OpenClaw transcript/trajectory artifacts, so the agent can inspect focused history only when it needs more context.
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
