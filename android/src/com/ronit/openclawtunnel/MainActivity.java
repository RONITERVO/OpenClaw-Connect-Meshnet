package com.ronit.openclawtunnel;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;

public class MainActivity extends Activity {
    private static final int OPEN_RETRY_DELAY_MS = 500;
    private static final int OPEN_RETRY_MAX = 30;

    private EditText remoteHost;
    private EditText remotePort;
    private EditText localPort;
    private CheckBox startOnBoot;
    private TextView status;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable statusTick = new Runnable() {
        @Override
        public void run() {
            refreshStatus();
            handler.postDelayed(this, 3000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestNotifications();
        setContentView(buildUi());
        loadPrefs();
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(statusTick);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(statusTick);
        super.onPause();
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(24), dp(20), dp(24));
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("OpenClaw Tunnel");
        title.setTextSize(24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Keeps phone localhost pointed at your PC over NordVPN Meshnet, even when the phone changes networks.");
        subtitle.setTextSize(14);
        subtitle.setPadding(0, dp(6), 0, dp(18));
        root.addView(subtitle);

        remoteHost = field("Remote host or fallbacks", InputType.TYPE_CLASS_TEXT);
        root.addView(label("PC Meshnet host(s), comma separated"));
        root.addView(remoteHost);

        LinearLayout ports = new LinearLayout(this);
        ports.setOrientation(LinearLayout.HORIZONTAL);
        ports.setPadding(0, dp(12), 0, 0);
        remotePort = field("Remote port", InputType.TYPE_CLASS_NUMBER);
        localPort = field("Local port", InputType.TYPE_CLASS_NUMBER);
        ports.addView(column("Remote port", remotePort), new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        ports.addView(space(dp(12), 1));
        ports.addView(column("Phone local port", localPort), new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        root.addView(ports);

        startOnBoot = new CheckBox(this);
        startOnBoot.setText("Start tunnel after reboot");
        startOnBoot.setPadding(0, dp(12), 0, dp(8));
        root.addView(startOnBoot);

        Button battery = button("Allow Background Run");
        battery.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                requestBatteryExemption();
            }
        });
        root.addView(battery);

        Button nordBattery = button("Open NordVPN App Settings");
        nordBattery.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openPackageSettings("com.nordvpn.android");
            }
        });
        root.addView(nordBattery);

        status = new TextView(this);
        status.setTextSize(14);
        status.setPadding(dp(12), dp(12), dp(12), dp(12));
        status.setBackgroundColor(0xFFF3F3F3);
        root.addView(status);

        Button quick = button("Start & Open Agent");
        quick.setTextSize(18);
        quick.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startTunnelAndOpen();
            }
        });
        root.addView(quick);

        Button start = button("Start Tunnel Only");
        start.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startTunnel();
            }
        });
        root.addView(start);

        Button stop = button("Stop Tunnel");
        stop.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                stopTunnel();
            }
        });
        root.addView(stop);

        Button browser = button("Open in Browser");
        browser.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openBrowser();
            }
        });
        root.addView(browser);

        Button inApp = button("Open In App");
        inApp.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                savePrefs();
                startActivity(new Intent(MainActivity.this, DashboardActivity.class));
            }
        });
        root.addView(inApp);

        TextView help = new TextView(this);
        help.setText("Use http://127.0.0.1:18789 on the phone. Keep NordVPN Meshnet active on both devices. This app handles Wi-Fi/cellular changes, but the PC must be awake, online, and running OpenClaw.");
        help.setTextSize(13);
        help.setPadding(0, dp(18), 0, 0);
        root.addView(help);

        return scroll;
    }

    private void loadPrefs() {
        SharedPreferences prefs = ProxyConfig.prefs(this);
        ProxyConfig config = ProxyConfig.load(this);
        remoteHost.setText(config.remoteHost);
        remotePort.setText(String.valueOf(config.remotePort));
        localPort.setText(String.valueOf(config.localPort));
        startOnBoot.setChecked(prefs.getBoolean(ProxyConfig.KEY_START_ON_BOOT, false));
        refreshStatus();
    }

    private void savePrefs() {
        ProxyConfig.save(this, remoteHost.getText().toString(), parsePort(remotePort), parsePort(localPort), startOnBoot.isChecked());
    }

    private void startTunnel() {
        savePrefs();
        Intent intent = TunnelService.startIntent(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
        Toast.makeText(this, "Tunnel starting", Toast.LENGTH_SHORT).show();
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                refreshStatus();
            }
        }, 800);
    }

    private void startTunnelAndOpen() {
        savePrefs();
        Intent intent = TunnelService.startIntent(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
        Toast.makeText(this, "Starting tunnel", Toast.LENGTH_SHORT).show();
        waitForTunnelAndOpen(0);
    }

    private void waitForTunnelAndOpen(final int attempt) {
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                ProxyConfig config = ProxyConfig.load(MainActivity.this);
                int port = parsePort(localPort);
                boolean localReady = canConnect("127.0.0.1", port, 350);
                String reachable = firstReachable(config, 450);
                refreshStatus();
                if (localReady && reachable.length() > 0) {
                    Toast.makeText(MainActivity.this, "Opening OpenClaw", Toast.LENGTH_SHORT).show();
                    openBrowser();
                    return;
                }
                if (attempt + 1 >= OPEN_RETRY_MAX) {
                    String problem = localReady
                            ? "PC target is not reachable. Check NordVPN Meshnet and the PC gateway."
                            : "Tunnel did not start. Check Android battery/network restrictions.";
                    status.setText(problem + "\nForward targets: " + config.remoteHost + ":" + config.remotePort);
                    Toast.makeText(MainActivity.this, problem, Toast.LENGTH_LONG).show();
                    return;
                }
                waitForTunnelAndOpen(attempt + 1);
            }
        }, attempt == 0 ? 700 : OPEN_RETRY_DELAY_MS);
    }

    private void stopTunnel() {
        Intent intent = TunnelService.stopIntent(this);
        startService(intent);
        Toast.makeText(this, "Tunnel stopping", Toast.LENGTH_SHORT).show();
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                refreshStatus();
            }
        }, 800);
    }

    private void openBrowser() {
        savePrefs();
        String url = "http://127.0.0.1:" + parsePort(localPort) + "/";
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        startActivity(intent);
    }

    private void refreshStatus() {
        int port = parsePort(localPort);
        boolean listening = canConnect("127.0.0.1", port, 350);
        ProxyConfig config = ProxyConfig.load(this);
        String text = listening
                ? "Tunnel reachable at http://127.0.0.1:" + port + "/"
                : "Tunnel not listening on 127.0.0.1:" + port;
        text += "\nForward targets: " + config.remoteHost + ":" + config.remotePort;
        String reachable = firstReachable(config, 450);
        if (reachable.length() > 0) {
            text += "\nReachable target: " + reachable + ":" + config.remotePort;
        } else {
            text += "\nNo target reachable right now";
        }
        text += "\nBattery: " + batteryStatus();
        status.setText(text);
    }

    private String batteryStatus() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return "legacy Android";
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        if (power != null && power.isIgnoringBatteryOptimizations(getPackageName())) {
            return "unrestricted for this app";
        }
        return "may sleep; tap Allow Background Run";
    }

    private void requestBatteryExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            if (power != null && !power.isIgnoringBatteryOptimizations(getPackageName())) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                    return;
                } catch (Exception ignored) {
                }
            }
        }
        openPackageSettings(getPackageName());
    }

    private void openPackageSettings(String packageName) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + packageName));
            startActivity(intent);
        } catch (Exception ex) {
            Toast.makeText(this, "Could not open app settings", Toast.LENGTH_LONG).show();
        }
    }

    private String firstReachable(ProxyConfig config, int timeoutMs) {
        for (int i = 0; i < config.remoteHosts.length; i++) {
            String host = config.remoteHosts[i];
            if (canConnect(host, config.remotePort, timeoutMs)) return host;
        }
        return "";
    }

    private boolean canConnect(String host, int port, int timeoutMs) {
        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(host, port), timeoutMs);
            return true;
        } catch (IOException ignored) {
            return false;
        } finally {
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }
    }

    private void requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 10);
        }
    }

    private int parsePort(EditText editText) {
        try {
            int value = Integer.parseInt(editText.getText().toString().trim());
            return value > 0 && value <= 65535 ? value : ProxyConfig.DEFAULT_PORT;
        } catch (NumberFormatException ex) {
            return ProxyConfig.DEFAULT_PORT;
        }
    }

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(13);
        view.setPadding(0, dp(8), 0, dp(4));
        return view;
    }

    private EditText field(String hint, int inputType) {
        EditText view = new EditText(this);
        view.setHint(hint);
        view.setSingleLine(true);
        view.setInputType(inputType);
        view.setPadding(dp(12), 0, dp(12), 0);
        return view;
    }

    private LinearLayout column(String label, EditText field) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.addView(label(label));
        layout.addView(field);
        return layout;
    }

    private View space(int width, int height) {
        View view = new View(this);
        view.setLayoutParams(new LinearLayout.LayoutParams(width, height));
        return view;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(12), 0, 0);
        button.setLayoutParams(params);
        return button;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
