package today.knowingjesus.invest;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import java.security.MessageDigest;
import android.net.Uri;
import android.database.Cursor;
import android.provider.DocumentsContract;
import org.json.JSONArray;
import android.os.Bundle;
import android.util.Base64;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * KJT Finance (Knowing Jesus Today) for Android: a window that shows the app screens (assets/www) and gives them
 * a few native abilities: keep the database file, fetch prices, export and import the database.
 * No analytics, no accounts, no other network use.
 */
public class MainActivity extends Activity {
    private static final int REQ_EXPORT = 41;
    private static final int REQ_IMPORT = 42;
    private static final int REQ_SYNC = 43;
    private static final String ACTION_INSTALLED = "today.knowingjesus.invest.INSTALL_RESULT";
    /* long-press the app icon: "Add transaction" opens the app straight on a new transaction */
    private static final String ACTION_ADD_TX = "today.knowingjesus.invest.ADD_TX";
    /* an update that is ready and waits until you leave the app, so it never interrupts you */
    private int waitingSession = -1;
    private boolean inBackground = false;

    private WebView web;
    private File dbFile;
    private String exportId, importId, syncId;
    private byte[] exportBytes;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        dbFile = new File(getFilesDir(), "portfolio.sqlite");
        WebView.setWebContentsDebuggingEnabled(false);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setDomStorageEnabled(false);
        s.setGeolocationEnabled(false);
        s.setSaveFormData(false);
        s.setSupportZoom(false);
        web.addJavascriptInterface(new Bridge(), "AndroidNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return url == null || !url.startsWith("file:///android_asset/");
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                quickAddIfAsked(getIntent());   /* opened from the "Add transaction" shortcut */
            }
        });
        web.loadUrl("file:///android_asset/www/index.html");
        setContentView(web);
        addShortcut();
    }

    private void commitUpdate(int sid) {
        try {
            PackageInstaller.Session sess = getPackageManager().getPackageInstaller().openSession(sid);
            Intent back = new Intent(this, MainActivity.class).setAction(ACTION_INSTALLED).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? 0x02000000 : 0);   // FLAG_MUTABLE: the installer adds its result
            PendingIntent pend = PendingIntent.getActivity(this, sid, back, flags);
            sess.commit(pend.getIntentSender());
            sess.close();
        } catch (Throwable ignored) { }
    }

    /* the app was left: a waiting update installs now, quietly */
    @Override
    protected void onStop() {
        super.onStop();
        inBackground = true;
        if (waitingSession >= 0) { int sid = waitingSession; waitingSession = -1; commitUpdate(sid); }
    }

    @Override
    protected void onStart() {
        super.onStart();
        inBackground = false;
    }

    /* back in the app: it looks for a new version again (at most every half hour) */
    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.__onResume && window.__onResume()", null);
    }

    /* the result of an update: the phone may first need you to confirm it */
    /* the shortcut shown when you long-press the app icon (Android 7.1 and newer) */
    private void addShortcut() {
        if (Build.VERSION.SDK_INT < 25) return;
        try {
            Class<?> smC = Class.forName("android.content.pm.ShortcutManager");
            Object sm = getSystemService(smC);
            Class<?> bC = Class.forName("android.content.pm.ShortcutInfo$Builder");
            Object b = bC.getConstructor(android.content.Context.class, String.class).newInstance(this, "add_tx");
            bC.getMethod("setShortLabel", CharSequence.class).invoke(b, "Add transaction");
            bC.getMethod("setLongLabel", CharSequence.class).invoke(b, "Add a transaction");
            int icon = getResources().getIdentifier("ic_shortcut_add", "mipmap", getPackageName());
            if (icon != 0) bC.getMethod("setIcon", android.graphics.drawable.Icon.class).invoke(b, android.graphics.drawable.Icon.createWithResource(this, icon));
            Intent i = new Intent(this, MainActivity.class).setAction(ACTION_ADD_TX);
            bC.getMethod("setIntent", Intent.class).invoke(b, i);
            Object info = bC.getMethod("build").invoke(b);
            smC.getMethod("setDynamicShortcuts", java.util.List.class).invoke(sm, java.util.Collections.singletonList(info));
        } catch (Throwable ignored) { }
    }

    private void quickAddIfAsked(Intent intent) {
        if (intent != null && ACTION_ADD_TX.equals(intent.getAction()) && web != null) {
            intent.setAction(Intent.ACTION_MAIN);
            web.evaluateJavascript("window.__quickAdd && window.__quickAdd()", null);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        quickAddIfAsked(intent);
        if (intent == null || !ACTION_INSTALLED.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = (Intent) intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) startActivity(confirm);
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            web.evaluateJavascript("window.__updateStatus && window.__updateStatus(" + JSONObject.quote("Update not installed" + (msg != null ? ": " + msg : "")) + ")", null);
        }
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__onBack ? window.__onBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) finish();
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    /* ---------- replies to the screens ---------- */
    private void reply(final String id, final JSONObject data) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript("window.__nativeReply(" + JSONObject.quote(id) + "," + JSONObject.quote(data.toString()) + ")", null);
            }
        });
    }

    private void replyError(String id, Throwable e) {
        JSONObject o = new JSONObject();
        try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        reply(id, o);
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    private static void copy(File from, File to) throws Exception {
        InputStream in = new FileInputStream(from);
        OutputStream out = new FileOutputStream(to);
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        out.close();
    }

    /* ---------- abilities the screens can use ---------- */
    private class Bridge {
        @JavascriptInterface
        public void call(final String id, final String cmd, final String argsJson) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        handle(id, cmd, new JSONObject(argsJson == null ? "{}" : argsJson));
                    } catch (Throwable e) {
                        replyError(id, e);
                    }
                }
            }).start();
        }
    }

    private void handle(final String id, String cmd, JSONObject a) throws Exception {
        JSONObject o = new JSONObject();
        if ("loadDb".equals(cmd)) {
            if (dbFile.exists() && dbFile.length() > 0) {
                /* a copy of the database as it was when the app opened: one step back if something goes wrong */
                copy(dbFile, new File(getFilesDir(), "portfolio.backup.sqlite"));
                o.put("b64", Base64.encodeToString(readAll(new FileInputStream(dbFile)), Base64.NO_WRAP));
            }
            reply(id, o);
        } else if ("saveDb".equals(cmd)) {
            byte[] data = Base64.decode(a.getString("b64"), Base64.DEFAULT);
            File tmp = new File(getFilesDir(), "portfolio.sqlite.tmp");
            FileOutputStream out = new FileOutputStream(tmp);
            out.write(data);
            out.getFD().sync();
            out.close();
            if (!tmp.renameTo(dbFile)) throw new Exception("could not write the database");
            o.put("ok", true);
            reply(id, o);
        } else if ("httpGet".equals(cmd)) {
            String url = a.getString("url");
            if (!url.startsWith("https://")) throw new Exception("only https");
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setRequestProperty("User-Agent", a.optString("ua", "KJTFinance/1.19"));
            c.setRequestProperty("Accept", "application/json, application/xml, text/xml");
            int status = c.getResponseCode();
            InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream();
            String body = in == null ? "" : new String(readAll(in), "UTF-8");
            c.disconnect();
            o.put("status", status);
            o.put("body", body);
            reply(id, o);
        } else if ("getPrefs".equals(cmd)) {
            /* small settings that must be readable before unlocking (look, passcode length, fingerprint) */
            File f = new File(getFilesDir(), "prefs.json");
            o.put("json", f.exists() ? new String(readAll(new FileInputStream(f)), "UTF-8") : "{}");
            reply(id, o);
        } else if ("setPrefs".equals(cmd)) {
            FileOutputStream out = new FileOutputStream(new File(getFilesDir(), "prefs.json"));
            out.write(a.getString("json").getBytes("UTF-8"));
            out.close();
            o.put("ok", true);
            reply(id, o);
        } else if ("secure".equals(cmd)) {
            /* with a passcode, the app's screen is hidden in the recent-apps view and from screenshots */
            final boolean on = a.optBoolean("on");
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
            });
            o.put("ok", true);
            reply(id, o);
        } else if ("appInfo".equals(cmd)) {
            o.put("platform", "android");
            String inst = null;
            try { inst = getPackageManager().getInstallerPackageName(getPackageName()); } catch (Throwable ignored) { }
            o.put("silentUpdate", Build.VERSION.SDK_INT >= 31 && getPackageName().equals(inst));
            o.put("version", getPackageManager().getPackageInfo(getPackageName(), 0).versionName);
            reply(id, o);
        } else if ("print".equals(cmd)) {
            /* the printable report: Android's print screen, where "Save as PDF" is one of the printers */
            final String title = a.optString("title", "KJT Finance report");
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    android.print.PrintManager pm = (android.print.PrintManager) getSystemService(PRINT_SERVICE);
                    pm.print(title, web.createPrintDocumentAdapter(title), new android.print.PrintAttributes.Builder().build());
                }
            });
            o.put("ok", true);
            reply(id, o);
        } else if ("openUrl".equals(cmd)) {
            final String u = a.getString("url");
            if (!u.startsWith("https://")) throw new Exception("only https");
            runOnUiThread(new Runnable() {
                @Override
                public void run() { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u))); }
            });
            o.put("ok", true);
            reply(id, o);
        } else if ("installUpdate".equals(cmd)) {
            /* the new app file comes only from the project's GitHub, is checked against its published fingerprint,
               and Android itself refuses it unless it is signed with the same key as this app; the phone asks to confirm */
            String url = a.getString("url"), sha = a.optString("sha256", "");
            if (!url.startsWith("https://raw.githubusercontent.com/BibleCorner-KJT/kjt-invest/") && !url.startsWith("https://github.com/BibleCorner-KJT/kjt-invest/"))
                throw new Exception("not from the KJT Finance project");
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            if (c.getResponseCode() != 200) throw new Exception("download failed (" + c.getResponseCode() + ")");
            byte[] apk = readAll(c.getInputStream());
            c.disconnect();
            if (sha.length() > 0) {
                byte[] d = MessageDigest.getInstance("SHA-256").digest(apk);
                StringBuilder hx = new StringBuilder();
                for (byte x : d) hx.append(String.format("%02x", x & 0xff));
                if (!hx.toString().equalsIgnoreCase(sha)) throw new Exception("the downloaded file does not match; nothing was installed");
            }
            PackageInstaller pi = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            sp.setAppPackageName(getPackageName());
            /* Android 12 and newer: once this app installed itself, its next updates need no tap (USER_ACTION_NOT_REQUIRED) */
            if (Build.VERSION.SDK_INT >= 31) {
                try { sp.getClass().getMethod("setRequireUserAction", int.class).invoke(sp, 2); } catch (Throwable ignored) { }
            }
            int sid = pi.createSession(sp);
            PackageInstaller.Session sess = pi.openSession(sid);
            OutputStream out = sess.openWrite("kjt-invest", 0, apk.length);
            out.write(apk);
            sess.fsync(out);
            out.close();
            sess.close();
            if (a.optBoolean("background") && !inBackground) {
                if (waitingSession >= 0) try { pi.abandonSession(waitingSession); } catch (Throwable ignored) { }
                waitingSession = sid;
                o.put("waiting", true);
            } else commitUpdate(sid);
            o.put("ok", true);
            reply(id, o);
        } else if ("statusBar".equals(cmd)) {
            /* the phone's top and bottom bars take the colours of the chosen theme */
            final String top = a.optString("color", ""), bottom = a.optString("nav", "");
            final boolean dark = a.optBoolean("dark");
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        getWindow().setStatusBarColor(android.graphics.Color.parseColor(top));
                        getWindow().setNavigationBarColor(android.graphics.Color.parseColor(bottom));
                        int flags = getWindow().getDecorView().getSystemUiVisibility();
                        if (Build.VERSION.SDK_INT >= 26) flags = dark ? (flags & ~0x10) : (flags | 0x10);   // dark buttons on a light bottom bar
                        getWindow().getDecorView().setSystemUiVisibility(flags);
                    } catch (Throwable ignored) { }
                }
            });
            o.put("ok", true);
            reply(id, o);
        } else if ("bioAvailable".equals(cmd)) {
            boolean av = Build.VERSION.SDK_INT >= 28 && Bio.available(this);
            o.put("available", av);
            o.put("kind", "fingerprint or face");
            reply(id, o);
        } else if ("bioDisable".equals(cmd)) {
            if (Build.VERSION.SDK_INT >= 28) Bio.disable(this);
            o.put("ok", true);
            reply(id, o);
        } else if ("bioEnable".equals(cmd) || "bioUnlock".equals(cmd)) {
            if (Build.VERSION.SDK_INT < 28) { o.put("error", "needs Android 9 or later"); reply(id, o); return; }
            Bio.Done cb = new Bio.Done() {
                @Override
                public void result(String dek, String error) {
                    JSONObject r = new JSONObject();
                    try {
                        if (error != null) r.put("error", error);
                        else if (dek.length() > 0) r.put("dek", dek);
                        else r.put("ok", true);
                    } catch (Exception ignored) { }
                    reply(id, r);
                }
            };
            if ("bioEnable".equals(cmd)) Bio.enable(this, Base64.decode(a.getString("dek"), Base64.DEFAULT), cb);
            else Bio.unlock(this, cb);
        } else if ("exportDb".equals(cmd)) {
            exportBytes = Base64.decode(a.getString("b64"), Base64.DEFAULT);
            exportId = id;
            final Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/octet-stream");
            i.putExtra(Intent.EXTRA_TITLE, a.optString("name", "kjt-invest.sqlite"));
            runOnUiThread(new Runnable() {
                @Override
                public void run() { startActivityForResult(i, REQ_EXPORT); }
            });
        } else if ("syncPick".equals(cmd)) {
            /* sync between devices: you choose a folder (for example one shared by Syncthing); the app keeps a copy of its data there */
            syncId = id;
            final Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            runOnUiThread(new Runnable() {
                @Override
                public void run() { startActivityForResult(i, REQ_SYNC); }
            });
        } else if ("syncInfo".equals(cmd)) {
            Uri t = syncTree();
            o.put("set", t != null);
            if (t != null) o.put("label", treeLabel(t));
            reply(id, o);
        } else if ("syncForget".equals(cmd)) {
            Uri t = syncTree();
            if (t != null) try { getContentResolver().releasePersistableUriPermission(t, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Throwable ignored) { }
            new File(getFilesDir(), "sync.txt").delete();
            o.put("ok", true);
            reply(id, o);
        } else if ("syncList".equals(cmd)) {
            Uri t = syncTree();
            if (t == null) throw new Exception("no sync folder");
            JSONArray files = new JSONArray();
            Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(t, DocumentsContract.getTreeDocumentId(t));
            Cursor c = getContentResolver().query(kids, new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED, DocumentsContract.Document.COLUMN_SIZE }, null, null, null);
            if (c != null) {
                while (c.moveToNext()) {
                    JSONObject f = new JSONObject();
                    f.put("name", c.getString(1)); f.put("mtime", c.getLong(2)); f.put("size", c.getLong(3));
                    files.put(f);
                }
                c.close();
            }
            o.put("files", files);
            reply(id, o);
        } else if ("syncRead".equals(cmd)) {
            Uri d = syncDoc(a.getString("name"));
            if (d == null) { o.put("missing", true); reply(id, o); return; }
            byte[] b = readAll(getContentResolver().openInputStream(d));
            o.put("b64", Base64.encodeToString(b, Base64.NO_WRAP));
            reply(id, o);
        } else if ("syncWrite".equals(cmd)) {
            Uri t = syncTree();
            if (t == null) throw new Exception("no sync folder");
            String name = a.getString("name");
            Uri d = syncDoc(name);
            if (d == null) d = DocumentsContract.createDocument(getContentResolver(), DocumentsContract.buildDocumentUriUsingTree(t, DocumentsContract.getTreeDocumentId(t)), "application/octet-stream", name);
            if (d == null) throw new Exception("could not create the file in the folder");
            OutputStream out = getContentResolver().openOutputStream(d, "wt");
            out.write(Base64.decode(a.getString("b64"), Base64.DEFAULT));
            out.close();
            o.put("ok", true);
            reply(id, o);
        } else if ("syncDelete".equals(cmd)) {
            Uri d = syncDoc(a.getString("name"));
            if (d != null) DocumentsContract.deleteDocument(getContentResolver(), d);
            o.put("ok", true);
            reply(id, o);
        } else if ("importDb".equals(cmd)) {
            importId = id;
            final Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            runOnUiThread(new Runnable() {
                @Override
                public void run() { startActivityForResult(i, REQ_IMPORT); }
            });
        } else {
            o.put("error", "unknown command");
            reply(id, o);
        }
    }

    /* the sync folder you chose (kept across restarts) */
    private Uri syncTree() {
        try {
            File f = new File(getFilesDir(), "sync.txt");
            if (!f.exists()) return null;
            return Uri.parse(new String(readAll(new FileInputStream(f)), "UTF-8").trim());
        } catch (Throwable e) { return null; }
    }

    private String treeLabel(Uri t) {
        String docId = DocumentsContract.getTreeDocumentId(t);
        int c = docId.indexOf(':');
        return c >= 0 ? docId.substring(c + 1) : docId;
    }

    private Uri syncDoc(String name) throws Exception {
        Uri t = syncTree();
        if (t == null) throw new Exception("no sync folder");
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(t, DocumentsContract.getTreeDocumentId(t));
        Cursor c = getContentResolver().query(kids, new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null);
        Uri found = null;
        if (c != null) {
            while (c.moveToNext()) if (name.equals(c.getString(1))) { found = DocumentsContract.buildDocumentUriUsingTree(t, c.getString(0)); break; }
            c.close();
        }
        return found;
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        final Uri uri = (result == RESULT_OK && data != null) ? data.getData() : null;
        if (req == REQ_SYNC && syncId != null) {
            final String id = syncId;
            syncId = null;
            try {
                JSONObject o = new JSONObject();
                if (uri != null) {
                    getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    FileOutputStream out = new FileOutputStream(new File(getFilesDir(), "sync.txt"));
                    out.write(uri.toString().getBytes("UTF-8"));
                    out.close();
                    o.put("ok", true);
                    o.put("label", treeLabel(uri));
                }
                reply(id, o);
            } catch (Throwable e) { replyError(id, e); }
            return;
        }
        if (req == REQ_EXPORT && exportId != null) {
            final String id = exportId;
            final byte[] bytes = exportBytes;
            exportId = null;
            exportBytes = null;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        JSONObject o = new JSONObject();
                        if (uri != null) {
                            OutputStream out = getContentResolver().openOutputStream(uri, "wt");
                            out.write(bytes);
                            out.close();
                            o.put("ok", true);
                        }
                        reply(id, o);
                    } catch (Throwable e) { replyError(id, e); }
                }
            }).start();
        } else if (req == REQ_IMPORT && importId != null) {
            final String id = importId;
            importId = null;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        JSONObject o = new JSONObject();
                        if (uri != null) {
                            byte[] b = readAll(getContentResolver().openInputStream(uri));
                            if (b.length > 200 * 1024 * 1024) throw new Exception("file too large");
                            o.put("b64", Base64.encodeToString(b, Base64.NO_WRAP));
                        }
                        reply(id, o);
                    } catch (Throwable e) { replyError(id, e); }
                }
            }).start();
        }
    }
}
