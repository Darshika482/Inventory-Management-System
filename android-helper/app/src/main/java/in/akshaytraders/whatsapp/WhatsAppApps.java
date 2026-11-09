package in.akshaytraders.whatsapp;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;

import java.util.ArrayList;
import java.util.List;

/** The WhatsApp apps on this phone, and which one the shop chose when both are there. */
final class WhatsAppApps {
    static final String PERSONAL = "com.whatsapp";
    static final String BUSINESS = "com.whatsapp.w4b";

    private static final String PREFS = "helper";
    private static final String KEY_CHOICE = "whatsapp_package";

    private WhatsAppApps() {}

    static List<String> installed(Context context) {
        List<String> found = new ArrayList<>();
        for (String pkg : new String[] {BUSINESS, PERSONAL}) {
            if (isInstalled(context, pkg)) found.add(pkg);
        }
        return found;
    }

    private static boolean isInstalled(Context context, String pkg) {
        try {
            context.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    static String label(String pkg) {
        return BUSINESS.equals(pkg) ? "WhatsApp Business" : "WhatsApp";
    }

    /** The remembered choice, if that app is still installed. */
    static String chosen(Context context) {
        String pkg = prefs(context).getString(KEY_CHOICE, null);
        return pkg != null && isInstalled(context, pkg) ? pkg : null;
    }

    static void choose(Context context, String pkg) {
        prefs(context).edit().putString(KEY_CHOICE, pkg).apply();
    }

    static void forgetChoice(Context context) {
        prefs(context).edit().remove(KEY_CHOICE).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
