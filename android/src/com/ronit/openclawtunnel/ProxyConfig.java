package com.ronit.openclawtunnel;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.List;

final class ProxyConfig {
    static final String PREFS = "openclaw_tunnel";
    static final String KEY_REMOTE_HOST = "remote_host";
    static final String KEY_REMOTE_PORT = "remote_port";
    static final String KEY_LOCAL_PORT = "local_port";
    static final String KEY_START_ON_BOOT = "start_on_boot";
    static final String DEFAULT_REMOTE_HOST = "pc-meshnet-host";
    static final int DEFAULT_PORT = 18789;

    final String remoteHost;
    final String[] remoteHosts;
    final int remotePort;
    final int localPort;

    private ProxyConfig(String remoteHost, int remotePort, int localPort) {
        this.remoteHost = remoteHost;
        this.remoteHosts = splitHosts(remoteHost);
        this.remotePort = remotePort;
        this.localPort = localPort;
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static ProxyConfig load(Context context) {
        SharedPreferences prefs = prefs(context);
        String host = prefs.getString(KEY_REMOTE_HOST, DEFAULT_REMOTE_HOST);
        int remote = prefs.getInt(KEY_REMOTE_PORT, DEFAULT_PORT);
        int local = prefs.getInt(KEY_LOCAL_PORT, DEFAULT_PORT);
        return new ProxyConfig(safeHost(host), safePort(remote), safePort(local));
    }

    static void save(Context context, String host, int remotePort, int localPort, boolean startOnBoot) {
        prefs(context).edit()
                .putString(KEY_REMOTE_HOST, safeHost(host))
                .putInt(KEY_REMOTE_PORT, safePort(remotePort))
                .putInt(KEY_LOCAL_PORT, safePort(localPort))
                .putBoolean(KEY_START_ON_BOOT, startOnBoot)
                .apply();
    }

    static boolean startOnBoot(Context context) {
        return prefs(context).getBoolean(KEY_START_ON_BOOT, false);
    }

    String hostSummary() {
        if (remoteHosts.length == 1) return remoteHosts[0];
        return remoteHosts[0] + " +" + (remoteHosts.length - 1);
    }

    private static String safeHost(String host) {
        if (host == null) return DEFAULT_REMOTE_HOST;
        String trimmed = host.trim().replace('\n', ',').replace('\r', ',');
        return trimmed.isEmpty() ? DEFAULT_REMOTE_HOST : trimmed;
    }

    private static String[] splitHosts(String hosts) {
        String source = safeHost(hosts);
        String[] parts = source.split("[,; ]+");
        List<String> clean = new ArrayList<String>();
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i] == null ? "" : parts[i].trim();
            if (part.length() == 0) continue;
            if (!clean.contains(part)) clean.add(part);
        }
        if (clean.isEmpty()) clean.add(DEFAULT_REMOTE_HOST);
        return clean.toArray(new String[clean.size()]);
    }

    private static int safePort(int port) {
        return port > 0 && port <= 65535 ? port : DEFAULT_PORT;
    }
}
