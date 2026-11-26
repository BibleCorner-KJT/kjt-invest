package today.knowingjesus.invest;

import android.app.Activity;
import android.content.Context;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;
import java.util.concurrent.Executor;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Fingerprint / face unlock (Android 9 and later). The app's data key is kept encrypted with a key
 * that lives in the phone's secure hardware (Android Keystore) and can only be used right after a
 * successful fingerprint or face check. The data key itself never leaves the app unencrypted.
 * Only loaded on Android 9+, so older phones never touch these classes.
 */
final class Bio {
    interface Done { void result(String dekB64, String error); }

    private static final String KEY = "it_bio_key";
    private static final String PREFS = "bio";

    static boolean available(Context c) {
        if (Build.VERSION.SDK_INT < 28) return false;
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                BiometricManager bm = (BiometricManager) c.getSystemService(BiometricManager.class);
                return bm != null && bm.canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS;
            }
            FingerprintManager fm = (FingerprintManager) c.getSystemService(Context.FINGERPRINT_SERVICE);
            return fm != null && fm.isHardwareDetected() && fm.hasEnrolledFingerprints();
        } catch (Throwable t) {
            return false;
        }
    }

    private static SecretKey key(boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (create || !ks.containsAlias(KEY)) {
            if (ks.containsAlias(KEY)) ks.deleteEntry(KEY);
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setUserAuthenticationRequired(true)
                    .build());
            return kg.generateKey();
        }
        return (SecretKey) ks.getKey(KEY, null);
    }

    static void disable(Context c) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(KEY)) ks.deleteEntry(KEY);
        } catch (Throwable ignored) { }
    }

    /** Asks for the fingerprint, then stores the data key encrypted. */
    static void enable(final Activity a, final byte[] dek, final Done done) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key(true));
            prompt(a, c, "Turn on fingerprint unlock", new Done() {
                @Override
                public void result(String ignored, String error) {
                    if (error != null) { done.result(null, error); return; }
                    try {
                        Cipher ok = lastCipher;
                        byte[] ct = ok.doFinal(dek);
                        a.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                                .putString("iv", Base64.encodeToString(ok.getIV(), Base64.NO_WRAP))
                                .putString("ct", Base64.encodeToString(ct, Base64.NO_WRAP)).apply();
                        done.result("", null);
                    } catch (Throwable e) { done.result(null, String.valueOf(e.getMessage())); }
                }
            });
        } catch (Throwable e) {
            done.result(null, String.valueOf(e.getMessage()));
        }
    }

    /** Asks for the fingerprint, then gives back the data key. */
    static void unlock(final Activity a, final Done done) {
        SharedPreferences p = a.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        final String iv = p.getString("iv", null), ct = p.getString("ct", null);
        if (iv == null || ct == null) { done.result(null, "not set up"); return; }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Base64.decode(iv, Base64.DEFAULT)));
            prompt(a, c, "Unlock KJT Invest", new Done() {
                @Override
                public void result(String ignored, String error) {
                    if (error != null) { done.result(null, error); return; }
                    try {
                        byte[] dek = lastCipher.doFinal(Base64.decode(ct, Base64.DEFAULT));
                        done.result(Base64.encodeToString(dek, Base64.NO_WRAP), null);
                    } catch (Throwable e) { done.result(null, String.valueOf(e.getMessage())); }
                }
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            disable(a);           // fingerprints were added or removed: the passcode is needed, then turn it on again
            done.result(null, "changed");
        } catch (Throwable e) {
            done.result(null, String.valueOf(e.getMessage()));
        }
    }

    private static Cipher lastCipher;

    private static void prompt(final Activity a, final Cipher cipher, final String title, final Done done) {
        final Handler h = new Handler(Looper.getMainLooper());
        final Executor ex = new Executor() {
            @Override
            public void execute(Runnable r) { h.post(r); }
        };
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    BiometricPrompt bp = new BiometricPrompt.Builder(a)
                            .setTitle(title)
                            .setNegativeButton("Use passcode", ex, new DialogInterface.OnClickListener() {
                                @Override
                                public void onClick(DialogInterface d, int w) { done.result(null, "cancelled"); }
                            })
                            .build();
                    bp.authenticate(new BiometricPrompt.CryptoObject(cipher), new CancellationSignal(), ex,
                            new BiometricPrompt.AuthenticationCallback() {
                                @Override
                                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) {
                                    lastCipher = r.getCryptoObject().getCipher();
                                    done.result("", null);
                                }

                                @Override
                                public void onAuthenticationError(int code, CharSequence msg) {
                                    done.result(null, code == 10 || code == 13 || code == 5 ? "cancelled" : String.valueOf(msg));
                                }
                            });
                } catch (Throwable e) {
                    done.result(null, String.valueOf(e.getMessage()));
                }
            }
        });
    }
}
