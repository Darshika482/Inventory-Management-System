package in.akshaytraders.whatsapp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;

/**
 * Opened by the shop app with a link to the bill file and the customer's
 * number. Downloads the file and opens WhatsApp straight on that customer's
 * chat with the file attached (only the file, no message); the shop just taps
 * Send. Without a number, WhatsApp asks which chat to send it to.
 */
public class SendActivity extends Activity {
    private static final int TIMEOUT_MS = 30_000;
    private static final long MAX_BYTES = 20L * 1024 * 1024;

    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent().getData();
        String url = data == null ? null : data.getQueryParameter("url");
        // A space in the file name must go to the server as %20.
        if (url != null) url = url.replace(" ", "%20");
        if (url == null || !url.startsWith("https://")) {
            fail("No bill was sent to the helper.");
            return;
        }
        String phone = digitsOnly(data.getQueryParameter("phone"));
        String type = orDefault(data.getQueryParameter("type"), "application/pdf");
        String name = safeName(orDefault(data.getQueryParameter("name"), type.startsWith("image/") ? "bill.png" : "bill.pdf"));

        String fileUrl = url;
        pickWhatsApp(pkg -> {
            Toast.makeText(this, "Opening WhatsApp…", Toast.LENGTH_SHORT).show();
            new Thread(() -> {
                try {
                    File file = download(fileUrl, name);
                    main.post(() -> openChat(pkg, file, type, phone));
                } catch (IOException e) {
                    main.post(() -> fail("The bill could not be downloaded. Check the internet and try again."));
                }
            }).start();
        });
    }

    private interface Picked {
        void use(String pkg);
    }

    /** WhatsApp or WhatsApp Business: asked once when both are installed, then remembered. */
    private void pickWhatsApp(Picked picked) {
        List<String> apps = WhatsAppApps.installed(this);
        if (apps.isEmpty()) {
            fail("WhatsApp is not installed on this phone.");
            return;
        }
        String chosen = WhatsAppApps.chosen(this);
        if (chosen != null) {
            picked.use(chosen);
            return;
        }
        if (apps.size() == 1) {
            picked.use(apps.get(0));
            return;
        }
        String[] labels = new String[apps.size()];
        for (int i = 0; i < apps.size(); i++) labels[i] = WhatsAppApps.label(apps.get(i));
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Light_Dialog_Alert)
                .setTitle("Send bills with")
                .setItems(labels, (dialog, which) -> {
                    WhatsAppApps.choose(this, apps.get(which));
                    picked.use(apps.get(which));
                })
                .setOnCancelListener(dialog -> finish())
                .show();
    }

    private void openChat(String pkg, File file, String type, String phone) {
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", file);
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(type);
        send.setPackage(pkg);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        // WhatsApp opens this chat directly instead of its contact list.
        if (phone != null) send.putExtra("jid", phone + "@s.whatsapp.net");
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(send);
            finish();
        } catch (ActivityNotFoundException e) {
            fail("WhatsApp could not be opened.");
        }
    }

    private File download(String url, String name) throws IOException {
        File dir = new File(getCacheDir(), "bills");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No cache folder");
        // Old bills are not kept.
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();

        File file = new File(dir, name);
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(TIMEOUT_MS);
        conn.setReadTimeout(TIMEOUT_MS);
        try {
            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) throw new IOException("HTTP " + conn.getResponseCode());
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(file)) {
                byte[] buffer = new byte[16 * 1024];
                long total = 0;
                int n;
                while ((n = in.read(buffer)) != -1) {
                    total += n;
                    if (total > MAX_BYTES) throw new IOException("File too big");
                    out.write(buffer, 0, n);
                }
            }
        } finally {
            conn.disconnect();
        }
        return file;
    }

    private void fail(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        finish();
    }

    /** "919826012345": digits only, at least 10 of them, else no number. */
    private static String digitsOnly(String value) {
        if (value == null) return null;
        String digits = value.replaceAll("\\D", "");
        return digits.length() >= 10 && digits.length() <= 15 ? digits : null;
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    /** The bill's own file name, without anything that could leave the cache folder. */
    private static String safeName(String name) {
        String clean = name.replaceAll("[^A-Za-z0-9._ -]", "_").trim();
        if (clean.isEmpty() || clean.startsWith(".")) clean = "bill" + clean;
        return clean.length() > 80 ? clean.substring(clean.length() - 80) : clean;
    }
}
