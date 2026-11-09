package in.akshaytraders.whatsapp;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.io.File;
import java.io.IOException;

/**
 * Opened by the shop app with a link to the bill file and the customer's
 * number. Downloads the file and opens WhatsApp straight on that customer's
 * chat with the file attached (only the file, no message); the shop just taps
 * Send. Without a number, WhatsApp asks which chat to send it to.
 */
public class SendActivity extends Activity {
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
        String phone = Files.digitsOnly(data.getQueryParameter("phone"));
        String type = Files.orDefault(data.getQueryParameter("type"), "application/pdf");
        String name = Files.safeName(Files.orDefault(data.getQueryParameter("name"), type.startsWith("image/") ? "bill.png" : "bill.pdf"));

        String fileUrl = url;
        WhatsAppApps.pick(this, pkg -> {
            Toast.makeText(this, "Opening WhatsApp…", Toast.LENGTH_SHORT).show();
            new Thread(() -> {
                try {
                    File file = Files.download(fileUrl, new File(Files.freshCacheFolder(this, "bills"), name), Files.MAX_FILE_BYTES);
                    main.post(() -> openChat(pkg, file, type, phone));
                } catch (IOException e) {
                    main.post(() -> fail("The bill could not be downloaded. Check the internet and try again."));
                }
            }).start();
        }, () -> fail(WhatsAppApps.installed(this).isEmpty() ? "WhatsApp is not installed on this phone." : "Not sent."));
    }

    private void openChat(String pkg, File file, String type, String phone) {
        try {
            startActivity(Files.whatsAppIntent(this, pkg, file, type, phone));
            finish();
        } catch (ActivityNotFoundException e) {
            fail("WhatsApp could not be opened.");
        }
    }

    private void fail(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        finish();
    }
}
