package in.akshaytraders.whatsapp;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Downloading what the shop app sends, and handing a file to WhatsApp. */
final class Files {
    private static final int TIMEOUT_MS = 30_000;
    static final long MAX_FILE_BYTES = 20L * 1024 * 1024;

    private Files() {}

    /** Saves the file at `url` (https only) as `target`. */
    static File download(String url, File target, long maxBytes) throws IOException {
        File partial = new File(target.getPath() + ".part");
        try (InputStream in = open(url); OutputStream out = new FileOutputStream(partial)) {
            copy(in, out, maxBytes);
        } catch (IOException e) {
            partial.delete();
            throw e;
        }
        if (target.exists() && !target.delete()) throw new IOException("Old file in the way");
        if (!partial.renameTo(target)) throw new IOException("File could not be saved");
        return target;
    }

    /** The text at `url` (https only), e.g. the list of customers. */
    static String downloadText(String url, long maxBytes) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = open(url)) {
            copy(in, out, maxBytes);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static InputStream open(String url) throws IOException {
        if (url == null || !url.startsWith("https://")) throw new IOException("Not an https link");
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(TIMEOUT_MS);
        conn.setReadTimeout(TIMEOUT_MS);
        int code = conn.getResponseCode();
        if (code != HttpURLConnection.HTTP_OK) {
            conn.disconnect();
            throw new IOException("HTTP " + code);
        }
        return conn.getInputStream();
    }

    private static void copy(InputStream in, OutputStream out, long maxBytes) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        long total = 0;
        int n;
        while ((n = in.read(buffer)) != -1) {
            total += n;
            if (total > maxBytes) throw new IOException("File too big");
            out.write(buffer, 0, n);
        }
    }

    /**
     * WhatsApp (or WhatsApp Business, `pkg`) with only this file attached. With a
     * number, WhatsApp opens that chat directly instead of its contact list.
     */
    static Intent whatsAppIntent(Context context, String pkg, File file, String type, String phone) {
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".files", file);
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(type);
        send.setPackage(pkg);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        if (phone != null) send.putExtra("jid", phone + "@s.whatsapp.net");
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return send;
    }

    /** "919826012345": digits only, at least 10 of them, else no number. */
    static String digitsOnly(String value) {
        if (value == null) return null;
        String digits = value.replaceAll("\\D", "");
        return digits.length() >= 10 && digits.length() <= 15 ? digits : null;
    }

    static String orDefault(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    /** A file name without anything that could leave the cache folder. */
    static String safeName(String name) {
        String clean = (name == null ? "" : name).replaceAll("[^A-Za-z0-9._ -]", "_").trim();
        if (clean.isEmpty() || clean.startsWith(".")) clean = "file" + clean;
        return clean.length() > 80 ? clean.substring(clean.length() - 80) : clean;
    }

    /** An empty folder in the cache (what was there is deleted). */
    static File freshCacheFolder(Context context, String name) throws IOException {
        File dir = new File(context.getCacheDir(), name);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No cache folder");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        return dir;
    }
}
