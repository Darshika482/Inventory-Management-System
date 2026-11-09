package in.akshaytraders.whatsapp;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.widget.Toast;

/** Tapping the app icon: what the helper does, and a way to change the WhatsApp app it uses. */
public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String chosen = WhatsAppApps.chosen(this);
        String message = "This helper sends bills from the Akshay Traders app straight to the customer's WhatsApp chat.\n\n"
                + "Nothing to do here: in the app, open a bill, tap Share, then Send PDF or Send image."
                + (chosen != null ? "\n\nBills go with " + WhatsAppApps.label(chosen) + "." : "");
        AlertDialog.Builder dialog = new AlertDialog.Builder(this, android.R.style.Theme_Material_Light_Dialog_Alert)
                .setTitle("Akshay WhatsApp")
                .setMessage(message)
                .setPositiveButton("OK", (d, w) -> finish())
                .setOnCancelListener(d -> finish());
        if (chosen != null) {
            dialog.setNeutralButton("Change WhatsApp app", (d, w) -> {
                WhatsAppApps.forgetChoice(this);
                Toast.makeText(this, "You will be asked on the next bill.", Toast.LENGTH_LONG).show();
                finish();
            });
        }
        dialog.show();
    }
}
