# OpenClaw Tunnel

`OpenClawTunnel-debug.apk` is a small Android app that keeps a phone-local TCP tunnel open:

```text
127.0.0.1:18789 on the phone -> PC Meshnet/Tailnet host:18789
```

It is meant for roaming. Your phone can move between Wi-Fi and mobile data as long as the private overlay network stays connected on both the phone and the PC.

## Use

1. Install `OpenClawTunnel-debug.apk` on the Android phone.
2. Open **OpenClaw Tunnel**.
3. Enter the PC Meshnet/Tailnet host or IP in the remote host field.
   - Multiple fallbacks can be separated by commas.
4. Tap **Start & Open Agent**.

Or manually open:

```text
http://127.0.0.1:18789/
```

The browser sees the Gateway as phone-localhost, so OpenClaw can create device identity instead of failing on remote plain HTTP.

Build `1.3` and later waits until both the phone-local tunnel and the PC Gateway target are reachable before it opens Chrome. If it cannot reach the PC within about 15 seconds, it stays in the app and shows the failed condition instead of opening a dead browser tab.

Build `1.4` adds a service heartbeat. While the tunnel is running, the app periodically pings the PC Gateway over Meshnet/Tailnet so Android and the VPN are less likely to let the path go stale.

## Phone Battery Settings

Set both the tunnel app and your VPN/Meshnet app to unrestricted background use:

1. Open **OpenClaw Tunnel**.
2. Tap **Allow Background Run** and allow or disable battery optimization.
3. Tap **Open NordVPN App Settings** if using NordVPN Meshnet.
4. Allow background activity and disable automatic battery management if your Android vendor offers that option.
5. Keep the OpenClaw Tunnel notification visible while you want remote access.

If messages only flush when you plug in USB, the phone is still sleeping the tunnel app, the VPN app, or the VPN network path.

## PC Side

Keep OpenClaw reachable on the PC at port `18789`. For one-click PC startup, double-click:

```text
Start-OpenClaw-Agent.cmd
```

Approve the Windows administrator prompt and leave the elevated terminal open. The script stops the background Scheduled Task first, then runs:

```powershell
openclaw gateway run --force --bind tailnet --port 18789 --compact
```

The launcher also creates a temporary local compatibility forwarder:

```text
127.0.0.1:18789 -> detected Meshnet/Tailnet host:18789
```

That is for local OpenClaw helpers that expect the Gateway on localhost. The forwarder is removed when the foreground Gateway exits normally.

If you rerun the launcher while an older launcher window is still closing, the newest run owns the forwarder so an older cleanup should not remove the new local route.

The launcher also refreshes `gateway.remote.url` to the current PC Meshnet/Tailnet address on startup.

Closing that elevated terminal stops the Gateway. This foreground mode is useful when OpenClaw workflows need an interactive or elevated Windows context.

To check status from another terminal:

```powershell
openclaw gateway status
```

If the private overlay IP changes, update the remote host in the app. If your Meshnet/Tailnet provider gives you a stable hostname for the PC, put that before the IP.

## Limits

This app cannot make OpenClaw reachable if:

- The private overlay network is off on either device.
- The PC is asleep, offline, or disconnected from the internet.
- OpenClaw Gateway is stopped.
- The PC firewall blocks port `18789` on the overlay-network interface.

## Notes

- The app uses a foreground service notification to stay alive.
- Optional **Start tunnel after reboot** is included, but Android battery settings can still restrict background startup.
- This APK is debug-signed locally.
