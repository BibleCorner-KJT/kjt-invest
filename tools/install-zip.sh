#!/bin/sh
# KJT Finance (Knowing Jesus Today) for Linux - installs (or updates) the app for the current user.
# Your data is kept in ~/.local/share/kjt-invest and is never touched by an update.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/kjt-invest-app"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor"

check() {
python3 - <<'PY' 2>/dev/null
import gi
try:
    gi.require_version('Gtk', '4.0'); gi.require_version('WebKit', '6.0')
    from gi.repository import Gtk, WebKit
except (ValueError, ImportError):
    gi.require_version('Gtk', '3.0')
    try:
        gi.require_version('WebKit2', '4.1')
    except ValueError:
        gi.require_version('WebKit2', '4.0')
    from gi.repository import Gtk, WebKit2
PY
}

if ! check; then
  echo "The app needs GTK and WebKit; installing them now (you may be asked for your password)..."
  SU=sudo; command -v sudo >/dev/null 2>&1 || SU=doas
  if command -v dnf >/dev/null 2>&1; then $SU dnf install -y python3-gobject gtk4 webkitgtk6.0
  elif command -v apk >/dev/null 2>&1; then $SU apk add python3 py3-gobject3 gtk4.0 webkit2gtk-6.0
  elif command -v apt-get >/dev/null 2>&1; then $SU apt-get install -y python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0
  elif command -v pacman >/dev/null 2>&1; then $SU pacman -S --needed --noconfirm python-gobject gtk4 webkitgtk-6.0
  elif command -v zypper >/dev/null 2>&1; then $SU zypper install -y python3-gobject typelib-1_0-Gtk-4_0 typelib-1_0-WebKit-6_0
  fi
  if ! check; then echo "Could not find GTK and WebKit for Python. Please install python3-gobject and webkitgtk 6.0, then run this again."; exit 1; fi
fi

rm -rf "$DEST"
mkdir -p "$DEST" "$APPS" "$ICONS/256x256/apps" "$ICONS/512x512/apps" "$ICONS/scalable/apps"
cp -r "$SRC/www" "$SRC/kjt_invest.py" "$SRC/LICENSE.txt" "$DEST/"
cp "$SRC/icons/icon-256.png" "$ICONS/256x256/apps/today.knowingjesus.Invest.png"
cp "$SRC/icons/icon-512.png" "$ICONS/512x512/apps/today.knowingjesus.Invest.png"
cp "$SRC/icons/icon.svg" "$ICONS/scalable/apps/today.knowingjesus.Invest.svg"
# the earlier "Investment Tracker" program (1.0-1.2) is replaced; its data is copied over on the first start
rm -rf "$HOME/.local/share/investment-tracker-app"; rm -f "$APPS/app.investmenttracker.desktop" "$ICONS"/*/apps/app.investmenttracker.*
cat > "$APPS/today.knowingjesus.Invest.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=KJT Finance
Comment=Private tracker for precious metals, real estate, cash and other assets
Exec=python3 "$DEST/kjt_invest.py"
Icon=today.knowingjesus.Invest
Terminal=false
Categories=Office;Finance;
Keywords=gold;silver;metals;property;real estate;rent;portfolio;
StartupNotify=true
StartupWMClass=today.knowingjesus.Invest
X-Purism-FormFactor=Workstation;Mobile;
Actions=add;

[Desktop Action add]
Name=Add a transaction
Exec=python3 "$DEST/kjt_invest.py" --add
DESK
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$ICONS" >/dev/null 2>&1 || true
echo "KJT Finance $(sed -n "s/^VERSION = '\(.*\)'/\1/p" "$DEST/kjt_invest.py") is installed. Open it from your apps."
