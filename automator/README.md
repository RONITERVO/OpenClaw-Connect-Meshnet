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
- Choose now, later, repeat, daily, or advanced.
- Let the backend fill reply targets for Telegram sessions.

For a selected Telegram direct session, the immediate command is equivalent to:

```powershell
openclaw agent `
  --session-key "agent:main:telegram:direct:8910901726" `
  --message "Your automated message here" `
  --deliver `
  --reply-channel telegram `
  --reply-to 8910901726
```

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
