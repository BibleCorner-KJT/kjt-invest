package android.hardware.biometrics;
/* Compile-time stand-in for the Android 9+ class (the real one is on the phone). Not packed into the app. */
public class BiometricPrompt {
    public void authenticate(CryptoObject crypto, android.os.CancellationSignal cancel, java.util.concurrent.Executor executor, AuthenticationCallback callback) { throw new RuntimeException("stub"); }
    public static class Builder {
        public Builder(android.content.Context context) { throw new RuntimeException("stub"); }
        public Builder setTitle(CharSequence title) { throw new RuntimeException("stub"); }
        public Builder setSubtitle(CharSequence subtitle) { throw new RuntimeException("stub"); }
        public Builder setNegativeButton(CharSequence text, java.util.concurrent.Executor executor, android.content.DialogInterface.OnClickListener listener) { throw new RuntimeException("stub"); }
        public BiometricPrompt build() { throw new RuntimeException("stub"); }
    }
    public static final class CryptoObject {
        public CryptoObject(javax.crypto.Cipher cipher) { throw new RuntimeException("stub"); }
        public javax.crypto.Cipher getCipher() { throw new RuntimeException("stub"); }
    }
    public static class AuthenticationResult {
        public CryptoObject getCryptoObject() { throw new RuntimeException("stub"); }
    }
    public abstract static class AuthenticationCallback {
        public void onAuthenticationError(int errorCode, CharSequence errString) { }
        public void onAuthenticationHelp(int helpCode, CharSequence helpString) { }
        public void onAuthenticationSucceeded(AuthenticationResult result) { }
        public void onAuthenticationFailed() { }
    }
}
