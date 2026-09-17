package com.carecircle.tv;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * CareCircle on Fire TV - the "shared display" surface.
 *
 * The living-room TV is where the whole family sees the assembled care picture.
 * This activity hosts the 10-foot care board (a WebView over the same /api/state
 * the voice console reads), and - the TV-native part - lets that board raise a
 * heads-up notification when something important has no owner, so a care gap can
 * slide in over whatever is playing rather than waiting for someone to look.
 */
public class MainActivity extends Activity {

    // The live care board, served by the CareCircle simulator (backed by the MCP server).
    // Points at the React /tv route, not the legacy static tv.html.
    private static final String BOARD_URL = "https://krqi2tpsif.us-east-1.awsapprunner.com/tv";

    private static final String CHANNEL_ID = "care_gaps";
    private static final int NOTIF_PERMISSION_REQUEST = 1;

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        createNotificationChannel();
        requestNotificationPermission();

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setWebViewClient(new WebViewClient());

        // The board (JS) calls AndroidBridge.notify(title, body) when a gap needs
        // attention. Everything the bridge does is a real Fire TV notification.
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        setContentView(web);
        web.loadUrl(BOARD_URL);
    }

    /** A high-importance channel so gap alerts surface as heads-up notifications. */
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Care gaps", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Alerts when something in the care circle has no owner.");
        NotificationManager mgr = getSystemService(NotificationManager.class);
        if (mgr != null) mgr.createNotificationChannel(channel);
    }

    /** Fire OS 8 / Android 13+ gate notifications behind a runtime permission. */
    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    NOTIF_PERMISSION_REQUEST);
        }
    }

    /** Bridge exposed to the WebView's JavaScript as `AndroidBridge`. */
    private final class Bridge {
        /**
         * Post (or update) a heads-up notification for a care gap. Keyed by title
         * so the same gap refreshes rather than stacking a duplicate.
         */
        @JavascriptInterface
        public void notify(String title, String body) {
            if (title == null || title.isEmpty()) return;
            NotificationManager mgr = getSystemService(NotificationManager.class);
            if (mgr == null) return;

            Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                    ? new Notification.Builder(MainActivity.this, CHANNEL_ID)
                    : new Notification.Builder(MainActivity.this);
            b.setSmallIcon(R.drawable.ic_launcher)
                    .setContentTitle(title)
                    .setContentText(body == null ? "" : body)
                    .setAutoCancel(true)
                    .setPriority(Notification.PRIORITY_HIGH);

            mgr.notify(title.hashCode(), b.build());
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // D-pad back navigates the web view before leaving the app.
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
