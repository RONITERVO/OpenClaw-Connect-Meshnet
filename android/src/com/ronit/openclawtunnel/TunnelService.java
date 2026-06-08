package com.ronit.openclawtunnel;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TunnelService extends Service {
    static final String ACTION_START = "com.ronit.openclawtunnel.START";
    static final String ACTION_STOP = "com.ronit.openclawtunnel.STOP";
    private static final String CHANNEL_ID = "tunnel";
    private static final int NOTIFICATION_ID = 18789;
    private static final int HEARTBEAT_INTERVAL_MS = 12000;
    private static final int HEARTBEAT_NOTIFY_MIN_MS = 30000;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private volatile boolean running;
    private ServerSocket serverSocket;
    private Thread acceptThread;
    private Thread heartbeatThread;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private long lastNotificationAt;

    static Intent startIntent(Context context) {
        return new Intent(context, TunnelService.class).setAction(ACTION_START);
    }

    static Intent stopIntent(Context context) {
        return new Intent(context, TunnelService.class).setAction(ACTION_STOP);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopTunnel();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        startTunnel(ProxyConfig.load(this));
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopTunnel();
        executor.shutdownNow();
        super.onDestroy();
    }

    private synchronized void startTunnel(ProxyConfig config) {
        stopTunnel();
        running = true;
        lastNotificationAt = 0;
        startForeground(NOTIFICATION_ID, notification("Forwarding 127.0.0.1:" + config.localPort + " to " + config.hostSummary() + ":" + config.remotePort));
        acquireWakeLock();
        acquireWifiLock();
        final ProxyConfig selectedConfig = config;
        acceptThread = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop(selectedConfig);
            }
        }, "openclaw-tunnel-accept");
        acceptThread.start();
        startHeartbeat(selectedConfig);
    }

    private synchronized void stopTunnel() {
        running = false;
        closeQuietly(serverSocket);
        serverSocket = null;
        if (heartbeatThread != null) {
            heartbeatThread.interrupt();
            heartbeatThread = null;
        }
        if (acceptThread != null) {
            acceptThread.interrupt();
            acceptThread = null;
        }
        releaseWifiLock();
        releaseWakeLock();
    }

    private void acceptLoop(final ProxyConfig config) {
        try {
            ServerSocket socket = new ServerSocket();
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), config.localPort));
            serverSocket = socket;
            while (running) {
                final Socket client = socket.accept();
                executor.execute(new Runnable() {
                    @Override
                    public void run() {
                        handleClient(client, config);
                    }
                });
            }
        } catch (IOException ex) {
            if (running) {
                NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                manager.notify(NOTIFICATION_ID, notification("Tunnel stopped: " + ex.getMessage()));
            }
            stopSelf();
        }
    }

    private void handleClient(Socket client, ProxyConfig config) {
        Socket remote = null;
        try {
            remote = connectRemote(config);
            remote.setKeepAlive(true);
            remote.setTcpNoDelay(true);
            client.setKeepAlive(true);
            client.setTcpNoDelay(true);
            final Socket upstreamClient = client;
            final Socket upstreamRemote = remote;
            executor.execute(new Runnable() {
                @Override
                public void run() {
                    pump(upstreamClient, upstreamRemote);
                }
            });
            pump(remote, client);
        } catch (IOException ignored) {
        } finally {
            closeQuietly(client);
            closeQuietly(remote);
        }
    }

    private Socket connectRemote(ProxyConfig config) throws IOException {
        return connectRemote(config, 8000);
    }

    private Socket connectRemote(ProxyConfig config, int timeoutMs) throws IOException {
        IOException last = null;
        for (int i = 0; i < config.remoteHosts.length; i++) {
            Socket socket = new Socket();
            try {
                socket.connect(new InetSocketAddress(config.remoteHosts[i], config.remotePort), timeoutMs);
                return socket;
            } catch (IOException ex) {
                last = ex;
                closeQuietly(socket);
            }
        }
        throw last == null ? new IOException("No remote hosts configured") : last;
    }

    private void startHeartbeat(final ProxyConfig config) {
        heartbeatThread = new Thread(new Runnable() {
            @Override
            public void run() {
                heartbeatLoop(config);
            }
        }, "openclaw-tunnel-heartbeat");
        heartbeatThread.start();
    }

    private void heartbeatLoop(ProxyConfig config) {
        while (running) {
            Socket socket = null;
            String message;
            try {
                socket = connectRemote(config, 2500);
                socket.setKeepAlive(true);
                message = "Keepalive ok: " + socket.getInetAddress().getHostAddress() + ":" + config.remotePort;
            } catch (IOException ex) {
                String detail = ex.getMessage();
                message = "Keepalive waiting for PC: " + (detail == null ? "not reachable" : detail);
            } finally {
                closeQuietly(socket);
            }
            maybeUpdateNotification(message);
            try {
                Thread.sleep(HEARTBEAT_INTERVAL_MS);
            } catch (InterruptedException ex) {
                return;
            }
        }
    }

    private void maybeUpdateNotification(String text) {
        long now = System.currentTimeMillis();
        if (now - lastNotificationAt < HEARTBEAT_NOTIFY_MIN_MS) return;
        lastNotificationAt = now;
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, notification(text));
    }

    private void pump(Socket from, Socket to) {
        byte[] buffer = new byte[16 * 1024];
        try {
            InputStream input = from.getInputStream();
            OutputStream output = to.getOutputStream();
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                output.flush();
            }
        } catch (IOException ignored) {
        } finally {
            try {
                to.shutdownOutput();
            } catch (IOException ignored) {
            }
        }
    }

    private Notification notification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, pendingFlags());
        Intent stop = stopIntent(this);
        PendingIntent stopAction = PendingIntent.getService(this, 1, stop, pendingFlags());

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(com.ronit.openclawtunnel.R.drawable.ic_stat_tunnel)
                .setContentTitle("OpenClaw Tunnel")
                .setContentText(text)
                .setOngoing(true)
                .setContentIntent(content)
                .addAction(com.ronit.openclawtunnel.R.drawable.ic_stat_tunnel, "Stop", stopAction)
                .build();
    }

    private int pendingFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Tunnel",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps the OpenClaw localhost tunnel running");
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        manager.createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OpenClawTunnel:proxy");
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private void acquireWifiLock() {
        if (wifiLock != null && wifiLock.isHeld()) return;
        WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wifi == null) return;
        wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "OpenClawTunnel:wifi");
        wifiLock.acquire();
    }

    private void releaseWifiLock() {
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        wifiLock = null;
    }

    private void closeQuietly(ServerSocket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }

    private void closeQuietly(Socket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }
}
