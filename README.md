# KJT Invest (Knowing Jesus Today)

A private tracker for what you own, for Android and Linux (PCs and Linux phones):
precious metals (coins, bars, rounds; live prices and price history), real estate (rent periods, costs,
co-owners and the real yearly return), cash and bank accounts, and other assets such as cars and boats.

No accounts, no analytics, no tracking. All data stays in one SQLite database file on the device,
which can be exported and imported. An optional passcode encrypts it (AES-256-GCM), with fingerprint unlock.
The only network use is the price update: metal prices from gold-api.com, exchange rates from the
European Central Bank, past prices from DataHub and Frankfurter.

## Layout
- `src/www/` the app screens, shared by both apps (SQLite runs inside: sql.js, MIT licence).
- `src/kjt_invest.py` the Linux app (Python, GTK 4 + WebKitGTK 6), `today.knowingjesus.Invest.yml` its Flatpak.
- `android/` the Android app (Java, no libraries); `tools/build-android.sh` builds the APK
  (the signing key is private and is never in this repository).
- `tools/install-zip.sh` the installer used in the Linux zip.
- `.github/workflows/channel.yml` builds the Linux app (PC and ARM): signed update channel on GitHub Pages
  (when the secret FLATPAK_GPG_KEY is set) and the one-file installers in the branch `bundle`.
- Branch `releases`: `latest.json` (newest versions) and the signed Android app the Android version updates itself from.

## Licence
GPL-2.0-or-later. By Knowing Jesus Today (knowingjesus.today).
