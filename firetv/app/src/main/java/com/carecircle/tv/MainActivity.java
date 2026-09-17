package com.carecircle.tv;

import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * CareCircle on Fire TV - the "shared display" surface.
 *
 * The living-room TV is not an input; it is where the whole family sees the
 * assembled care picture. This activity hosts the 10-foot care board, which reads
 * the same MCP resource (/api/state) the voice console reads - one responsibility
 * layer, a fourth surface onto it. No new backend.
 */
public class MainActivity extends Activity {

    // The live care board, served by the CareCircle simulator (backed by the MCP server).
    private static final String BOARD_URL = "https://krqi2tpsif.us-east-1.awsapprunner.com/tv.html";

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setWebViewClient(new WebViewClient());

        setContentView(web);
        web.loadUrl(BOARD_URL);
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
