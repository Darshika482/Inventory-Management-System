package in.akshaytraders.whatsapp;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * Udhaar reminders, one customer after another, without going back to the shop
 * app in between. Opened with a link to the list of customers
 * (akshaywa://batch?url=...). For each customer WhatsApp opens on their chat
 * with their reminder picture attached; the shop taps Send and comes Back, and
 * a moment later the next customer's chat opens by itself.
 */
public class BatchActivity extends Activity {
    /** The pause before the next chat opens: time to tap Pause or Send again. */
    private static final long NEXT_AFTER_MS = 1800;
    private static final int MAX_CUSTOMERS = 500;
    private static final long MAX_LIST_BYTES = 1024 * 1024;

    private static final int NAVY = Color.parseColor("#0F172A");
    private static final int SLATE = Color.parseColor("#475569");
    private static final int RED = Color.parseColor("#B91C1C");
    private static final int GREEN = Color.parseColor("#059669");

    private enum Mode { LOADING, OPENING, NEXT, PAUSED, ITEM_FAILED, LIST_FAILED, DONE }

    private static final class Customer {
        final String name;
        final String phone;
        final String url;
        final String type;
        final String file;
        final String amount;

        Customer(String name, String phone, String url, String type, String file, String amount) {
            this.name = name;
            this.phone = phone;
            this.url = url;
            this.type = type;
            this.file = file;
            this.amount = amount;
        }
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    /** Pictures being downloaded or ready, by customer number. */
    private final Map<Integer, Future<File>> pictures = new HashMap<>();
    private final Runnable openNext = this::openCurrent;

    private String listUrl;
    private String listJson;
    private List<Customer> customers = new ArrayList<>();
    private File folder;
    private String pkg;
    /** The customer being sent, or the next one. */
    private int index;
    private int sent;
    private int skipped;
    private boolean paused;
    /** WhatsApp is open for customers[index]; coming back here means it was sent. */
    private boolean awaitingReturn;
    private boolean resumed;
    private Mode mode = Mode.LOADING;
    private String problem = "";

    private TextView stepView;
    private ProgressBar bar;
    private TextView nameView;
    private TextView amountView;
    private TextView messageView;
    private Button primary;
    private Button secondary;
    private Button tertiary;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        if (savedInstanceState != null && savedInstanceState.getString("listJson") != null) {
            restore(savedInstanceState);
        } else {
            start(getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // A new list from the shop app replaces the one in hand.
        setIntent(intent);
        main.removeCallbacks(openNext);
        pictures.clear();
        start(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (awaitingReturn) {
            // Back from WhatsApp: this customer is done.
            awaitingReturn = false;
            sent++;
            index++;
            if (index >= customers.size()) {
                mode = Mode.DONE;
            } else {
                mode = paused ? Mode.PAUSED : Mode.NEXT;
            }
            render();
        }
        if (mode == Mode.NEXT) main.postDelayed(openNext, NEXT_AFTER_MS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        // Nothing opens while the shop is elsewhere.
        main.removeCallbacks(openNext);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        main.removeCallbacks(openNext);
        worker.shutdownNow();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (listJson == null) return;
        out.putString("listUrl", listUrl);
        out.putString("listJson", listJson);
        out.putString("pkg", pkg);
        out.putInt("index", index);
        out.putInt("sent", sent);
        out.putInt("skipped", skipped);
        out.putBoolean("paused", paused);
        out.putBoolean("awaitingReturn", awaitingReturn);
        out.putString("mode", mode.name());
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Back here pauses (Stop is one tap away); it closes only when nothing is going on.
        if (mode == Mode.NEXT || mode == Mode.OPENING) {
            paused = true;
            main.removeCallbacks(openNext);
            mode = Mode.PAUSED;
            render();
            return;
        }
        super.onBackPressed();
    }

    // --- Starting ---

    private void start(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        String url = data == null ? null : data.getQueryParameter("url");
        if (url != null) url = url.replace(" ", "%20");
        listUrl = url;
        listJson = null;
        customers = new ArrayList<>();
        index = 0;
        sent = 0;
        skipped = 0;
        paused = false;
        awaitingReturn = false;
        if (url == null || !url.startsWith("https://")) {
            problem = "No list of customers came from the Akshay Traders app.";
            mode = Mode.LIST_FAILED;
            render();
            return;
        }
        loadList();
    }

    private void loadList() {
        mode = Mode.LOADING;
        render();
        String url = listUrl;
        worker.execute(() -> {
            try {
                String json = Files.downloadText(url, MAX_LIST_BYTES);
                List<Customer> list = parse(json);
                File dir = Files.freshCacheFolder(this, "batch");
                main.post(() -> {
                    listJson = json;
                    customers = list;
                    folder = dir;
                    if (customers.isEmpty()) {
                        problem = "The list has no customers.";
                        mode = Mode.LIST_FAILED;
                        render();
                        return;
                    }
                    WhatsAppApps.pick(this, chosen -> {
                        pkg = chosen;
                        openCurrent();
                    }, () -> {
                        problem = WhatsAppApps.installed(this).isEmpty()
                                ? "WhatsApp is not installed on this phone."
                                : "Choose WhatsApp or WhatsApp Business to send the reminders.";
                        mode = Mode.LIST_FAILED;
                        render();
                    });
                });
            } catch (IOException | JSONException e) {
                main.post(() -> {
                    problem = "The list of customers could not be downloaded. Check the internet and try again.";
                    mode = Mode.LIST_FAILED;
                    render();
                });
            }
        });
    }

    private void restore(Bundle saved) {
        listUrl = saved.getString("listUrl");
        listJson = saved.getString("listJson");
        pkg = saved.getString("pkg");
        index = saved.getInt("index");
        sent = saved.getInt("sent");
        skipped = saved.getInt("skipped");
        paused = saved.getBoolean("paused");
        awaitingReturn = saved.getBoolean("awaitingReturn");
        try {
            mode = Mode.valueOf(saved.getString("mode", Mode.NEXT.name()));
            customers = parse(listJson);
            folder = new File(getCacheDir(), "batch");
            if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("No cache folder");
        } catch (IllegalArgumentException | JSONException | IOException e) {
            problem = "The list of customers was lost. Start again from the Akshay Traders app.";
            mode = Mode.LIST_FAILED;
        }
        // A send that was being opened opens again; onResume handles a return from WhatsApp.
        if (mode == Mode.OPENING) mode = paused ? Mode.PAUSED : Mode.NEXT;
        render();
    }

    private static List<Customer> parse(String json) throws JSONException {
        JSONArray items = new JSONObject(json).getJSONArray("items");
        List<Customer> list = new ArrayList<>();
        for (int i = 0; i < items.length() && list.size() < MAX_CUSTOMERS; i++) {
            JSONObject item = items.getJSONObject(i);
            String url = item.optString("url", "").replace(" ", "%20");
            if (!url.startsWith("https://")) continue;
            String type = Files.orDefault(item.optString("type", ""), "image/png");
            list.add(new Customer(
                    Files.orDefault(item.optString("name", ""), "Customer"),
                    Files.digitsOnly(item.optString("phone", "")),
                    url,
                    type,
                    Files.safeName(Files.orDefault(item.optString("file", ""), type.startsWith("image/") ? "reminder.png" : "reminder.pdf")),
                    item.optString("amount", "")));
        }
        return list;
    }

    // --- Sending, one customer after another ---

    /** The customer's picture: downloading, or ready. */
    private Future<File> picture(int i) {
        Future<File> future = pictures.get(i);
        if (future == null) {
            Customer customer = customers.get(i);
            File target = new File(folder, i + "-" + customer.file);
            future = worker.submit(() -> target.exists() ? target : Files.download(customer.url, target, Files.MAX_FILE_BYTES));
            pictures.put(i, future);
        }
        return future;
    }

    /** Opens WhatsApp on customers[index] with their picture. */
    private void openCurrent() {
        main.removeCallbacks(openNext);
        if (index >= customers.size()) {
            mode = Mode.DONE;
            render();
            return;
        }
        paused = false;
        mode = Mode.OPENING;
        render();
        int i = index;
        Future<File> future = picture(i);
        new Thread(() -> {
            File file;
            try {
                file = future.get();
            } catch (ExecutionException | InterruptedException e) {
                main.post(() -> {
                    pictures.remove(i);
                    if (i != index) return;
                    problem = "The picture for " + customers.get(i).name + " could not be downloaded. Check the internet.";
                    mode = Mode.ITEM_FAILED;
                    render();
                });
                return;
            }
            main.post(() -> launch(i, file));
        }).start();
    }

    private void launch(int i, File file) {
        if (i != index || mode != Mode.OPENING) return;
        if (!resumed) {
            // The shop left this screen meanwhile: open it when they are back.
            mode = Mode.NEXT;
            render();
            return;
        }
        Customer customer = customers.get(i);
        try {
            startActivity(Files.whatsAppIntent(this, pkg, file, customer.type, customer.phone));
        } catch (ActivityNotFoundException | IllegalArgumentException e) {
            problem = "WhatsApp could not be opened for " + customer.name + ".";
            mode = Mode.ITEM_FAILED;
            render();
            return;
        }
        awaitingReturn = true;
        // The first time, say what to do in WhatsApp.
        if (sent + skipped < 2) Toast.makeText(this, "Tap Send, then Back: the next customer opens by itself.", Toast.LENGTH_LONG).show();
        // The next picture downloads while this one is sent.
        if (i + 1 < customers.size()) picture(i + 1);
    }

    private void skip() {
        skipped++;
        index++;
        if (index >= customers.size()) {
            mode = Mode.DONE;
            render();
        } else if (paused) {
            mode = Mode.PAUSED;
            render();
        } else {
            openCurrent();
        }
    }

    private void sendAgainToPrevious() {
        if (index == 0) return;
        index--;
        sent = Math.max(0, sent - 1);
        openCurrent();
    }

    // --- Screen ---

    private void render() {
        int total = customers.size();
        Customer current = index < total ? customers.get(index) : null;
        Customer previous = index > 0 && index - 1 < total ? customers.get(index - 1) : null;

        bar.setMax(Math.max(total, 1));
        bar.setProgress(Math.min(index, total));
        bar.setVisibility(total > 0 ? View.VISIBLE : View.GONE);
        stepView.setText(current != null && mode != Mode.DONE ? "Customer " + (index + 1) + " of " + total : total > 0 ? total + " customers" : "");
        nameView.setText(current != null ? current.name : "");
        amountView.setText(current != null ? current.amount : "");
        show(primary, null, null);
        show(secondary, null, null);
        show(tertiary, null, null);

        switch (mode) {
            case LOADING:
                nameView.setText("Getting the list ready…");
                amountView.setText("");
                messageView.setText("");
                break;
            case OPENING:
                messageView.setText("Opening WhatsApp…");
                show(tertiary, "Pause", v -> onBackPressed());
                break;
            case NEXT:
                messageView.setText("Next customer: WhatsApp opens in a moment.\nIn WhatsApp, tap Send, then Back.");
                show(primary, "Open now", v -> openCurrent());
                show(secondary, "Pause", v -> {
                    paused = true;
                    main.removeCallbacks(openNext);
                    mode = Mode.PAUSED;
                    render();
                });
                if (previous != null) show(tertiary, "Not sent? Send again to " + previous.name, v -> sendAgainToPrevious());
                break;
            case PAUSED:
                messageView.setText("Paused.");
                if (current != null) {
                    show(primary, "Continue: send to " + current.name, v -> openCurrent());
                    show(secondary, "Skip " + current.name, v -> skip());
                }
                show(tertiary, "Stop", v -> finishRound());
                break;
            case ITEM_FAILED:
                messageView.setText(problem);
                show(primary, "Try again", v -> openCurrent());
                show(secondary, "Skip", v -> skip());
                show(tertiary, "Stop", v -> finishRound());
                break;
            case LIST_FAILED:
                nameView.setText("Could not start");
                amountView.setText("");
                messageView.setText(problem);
                if (listUrl != null && listUrl.startsWith("https://")) show(primary, "Try again", v -> loadList());
                show(tertiary, "Close", v -> finish());
                break;
            case DONE:
                nameView.setText("All done");
                amountView.setText("");
                messageView.setText("WhatsApp opened for " + sent + (sent == 1 ? " customer." : " customers.")
                        + (skipped > 0 ? " Skipped " + skipped + "." : ""));
                bar.setProgress(bar.getMax());
                show(primary, "Back to Akshay Traders", v -> finish());
                break;
        }
    }

    private void finishRound() {
        main.removeCallbacks(openNext);
        skipped += Math.max(0, customers.size() - index);
        index = customers.size();
        mode = Mode.DONE;
        render();
    }

    private void show(Button button, String label, View.OnClickListener onClick) {
        button.setVisibility(label == null ? View.GONE : View.VISIBLE);
        button.setText(label == null ? "" : label);
        button.setOnClickListener(onClick);
    }

    @SuppressWarnings("deprecation")
    private void buildUi() {
        // White screen, dark status bar icons.
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setPadding(dp(24), dp(28), dp(24), dp(24));

        TextView title = text(22, true, NAVY);
        title.setText("Udhaar reminders");
        root.addView(title);

        stepView = text(16, false, SLATE);
        root.addView(stepView, margins(0, dp(6), 0, 0));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setProgressTintList(ColorStateList.valueOf(GREEN));
        root.addView(bar, margins(0, dp(10), 0, 0));

        nameView = text(28, true, NAVY);
        root.addView(nameView, margins(0, dp(28), 0, 0));

        amountView = text(26, true, RED);
        root.addView(amountView, margins(0, dp(4), 0, 0));

        messageView = text(18, false, SLATE);
        messageView.setLineSpacing(0, 1.2f);
        root.addView(messageView, margins(0, dp(20), 0, 0));

        primary = button(true);
        root.addView(primary, margins(0, dp(28), 0, 0));
        secondary = button(false);
        root.addView(secondary, margins(0, dp(10), 0, 0));
        tertiary = button(false);
        root.addView(tertiary, margins(0, dp(10), 0, 0));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.addView(root);
        // Newer Android draws under the status and navigation bars: keep clear of them.
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(scroll);
    }

    private TextView text(int sp, boolean bold, int color) {
        TextView view = new TextView(this);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private Button button(boolean filled) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        button.setMinHeight(dp(56));
        if (filled) {
            button.setBackgroundTintList(ColorStateList.valueOf(GREEN));
            button.setTextColor(Color.WHITE);
        } else {
            button.setTextColor(NAVY);
        }
        return button;
    }

    private LinearLayout.LayoutParams margins(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(left, top, right, bottom);
        return params;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }
}
