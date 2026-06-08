# OpenClaw Tunnel Click-Start

Small Android localhost tunnel plus a Windows launcher for reaching a PC-hosted OpenClaw Gateway from a phone over a private Meshnet/Tailnet address.

The Android app forwards:

```text
phone 127.0.0.1:18789 -> PC Meshnet/Tailnet host:18789
```

The Windows launcher starts OpenClaw Gateway in the foreground on port `18789` and refreshes OpenClaw's `gateway.remote.url` to the detected private overlay-network address. It also starts a local TCP proxy from `127.0.0.1:18789` to the detected overlay address so Telegram/native helpers that expect localhost can still connect when the Gateway is bound to the Meshnet/Tailnet interface.

## Layout

- `android/` - Android source for the OpenClaw Tunnel APK.
- `scripts/Build-OpenClawTunnel.ps1` - local debug APK build script using the Android SDK command-line tools.
- `Start-OpenClaw-Agent.cmd` - double-click Windows launcher.
- `Start-OpenClaw-Agent.ps1` - elevated launcher implementation.
- `openclaw-loopback-proxy.js` - local TCP proxy used by the launcher for localhost-only OpenClaw helpers.
- `OpenClawTunnel-README.md` - usage notes for the built APK and PC launcher.

Generated APKs, idsig files, source zips, build folders, and keystores are intentionally ignored by Git.

## Phone Use

1. Install or build the tunnel APK.
2. Open **OpenClaw Tunnel**.
3. Enter the PC Meshnet/Tailnet host or IP in the remote host field.
4. Tap **Start & Open Agent**.
5. Use `http://127.0.0.1:18789/` on the phone.

Keep the private overlay network active on both devices. The PC must be awake and running the gateway launcher.

## PC Use

Double-click:

```text
Start-OpenClaw-Agent.cmd
```

Approve the administrator prompt and leave the elevated terminal open. Closing it stops the foreground Gateway.

If automatic Meshnet/Tailnet address detection cannot find the right address, set `OPENCLAW_MESH_IP` before running the launcher.

The localhost proxy writes diagnostics to:

```text
%USERPROFILE%\.openclaw\logs\loopback-proxy.log
```

## Build

From PowerShell:

```powershell
.\scripts\Build-OpenClawTunnel.ps1
```

The debug APK is written to `dist\OpenClawTunnel-debug.apk`.
