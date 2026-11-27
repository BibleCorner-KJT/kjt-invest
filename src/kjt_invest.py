#!/usr/bin/env python3
"""KJT Finance for Linux (desktop and Linux phones such as postmarketOS). By Knowing Jesus Today (knowingjesus.today).

A window that shows the app screens (www/) and gives them a few native abilities:
keep the database file, fetch prices, export and import the database.
No analytics, no accounts, no other network use. Works with GTK 4 + WebKitGTK 6.0,
or GTK 3 + WebKit2GTK 4.1 / 4.0.
"""
import base64
import hashlib
import platform
import json
import os
import shutil
import subprocess
import sys
import threading
import urllib.request

import gi

APP_ID = 'today.knowingjesus.Invest'
VERSION = '1.23'
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.environ.get('XDG_DATA_HOME') or os.path.expanduser('~/.local/share'), 'kjt-invest')
OLD_DIR = os.path.join(os.path.expanduser('~/.local/share'), 'investment-tracker')   # where 1.0-1.2 (Investment Tracker) kept the data
IN_FLATPAK = os.path.exists('/.flatpak-info')
DB = os.path.join(DATA_DIR, 'portfolio.sqlite')
PREFS = os.path.join(DATA_DIR, 'prefs.json')
SECRET = ['app', 'kjt-invest', 'key', 'unlock']   # where the keyring keeps the fingerprint-unlock copy of the data key

GTK4 = True
try:
    gi.require_version('Gtk', '4.0')
    gi.require_version('WebKit', '6.0')
    from gi.repository import Gtk, GLib, Gio, WebKit
except (ValueError, ImportError):
    GTK4 = False
    gi.require_version('Gtk', '3.0')
    try:
        gi.require_version('WebKit2', '4.1')
    except ValueError:
        gi.require_version('WebKit2', '4.0')
    from gi.repository import Gtk, GLib, Gio, WebKit2 as WebKit


class Tracker:
    def __init__(self, app):
        self.app = app
        if not os.path.exists(DATA_DIR) and os.path.isdir(OLD_DIR):
            try:
                shutil.copytree(OLD_DIR, DATA_DIR)   # the data of the earlier version comes along (the old folder is left as it was)
            except Exception:
                pass
        os.makedirs(DATA_DIR, exist_ok=True)
        self.win = Gtk.ApplicationWindow(application=app, title='KJT Finance')
        self.win.set_default_size(440, 820)
        self.view = self.make_view()
        s = self.view.get_settings()
        for name, val in (('set_allow_file_access_from_file_urls', True), ('set_enable_developer_extras', False),
                          ('set_enable_write_console_messages_to_stdout', False), ('set_javascript_can_access_clipboard', False)):
            try:
                getattr(s, name)(val)
            except Exception:
                pass
        ucm = self.view.get_user_content_manager()
        if GTK4:
            ucm.register_script_message_handler('native', None)
        else:
            ucm.register_script_message_handler('native')
        ucm.connect('script-message-received::native', self.on_message)
        self.view.connect('decide-policy', self.on_policy)
        self.view.connect('context-menu', lambda *a: True)
        self.view.load_uri('file://' + os.path.join(HERE, 'www', 'index.html'))
        if GTK4:
            self.win.set_child(self.view)
            self.win.present()
        else:
            self.win.add(self.view)
            self.win.show_all()

    def make_view(self):
        # no cookies, cache or website data are kept: the app has nothing to store there
        try:
            if GTK4:
                return WebKit.WebView(network_session=WebKit.NetworkSession.new_ephemeral())
            return WebKit.WebView.new_with_context(WebKit.WebContext.new_ephemeral())
        except Exception:
            return WebKit.WebView()

    def on_policy(self, view, decision, kind):
        # the window only ever shows the app's own files
        try:
            if kind == WebKit.PolicyDecisionType.NAVIGATION_ACTION:
                uri = decision.get_navigation_action().get_request().get_uri()
                if not uri.startswith('file://' + HERE):
                    decision.ignore()
                    return True
        except Exception:
            pass
        return False

    # ---------- replies to the screens ----------
    def reply(self, msg_id, data):
        js = 'window.__nativeReply(%s, %s)' % (json.dumps(str(msg_id)), json.dumps(json.dumps(data)))

        def run():
            if GTK4:
                self.view.evaluate_javascript(js, -1, None, None, None, None, None)
            elif hasattr(self.view, 'evaluate_javascript'):
                self.view.evaluate_javascript(js, -1, None, None, None, None, None)
            else:
                self.view.run_javascript(js, None, None, None)
            return False
        GLib.idle_add(run)

    def on_message(self, ucm, value):
        try:
            raw = value.to_string() if GTK4 else value.get_js_value().to_string()
            msg = json.loads(raw)
        except Exception:
            return
        msg_id, cmd, args = msg.get('id'), msg.get('cmd'), msg.get('args') or {}
        try:
            if cmd == 'loadDb':
                out = {}
                if os.path.exists(DB) and os.path.getsize(DB) > 0:
                    # a copy of the database as it was when the app opened: one step back if something goes wrong
                    shutil.copyfile(DB, os.path.join(DATA_DIR, 'portfolio.backup.sqlite'))
                    with open(DB, 'rb') as f:
                        out['b64'] = base64.b64encode(f.read()).decode()
                self.reply(msg_id, out)
            elif cmd == 'saveDb':
                data = base64.b64decode(args['b64'])
                tmp = DB + '.tmp'
                with open(tmp, 'wb') as f:
                    f.write(data)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, DB)
                self.reply(msg_id, {'ok': True})
            elif cmd in ('syncPick', 'syncInfo', 'syncForget', 'syncList', 'syncRead', 'syncWrite', 'syncDelete'):
                self.sync_cmd(msg_id, cmd, args)
            elif cmd == 'copyText':
                self.copy_text(args.get('text', ''))
                self.reply(msg_id, {'ok': True})
            elif cmd == 'getPrefs':
                # small settings readable before unlocking (look, passcode length, fingerprint)
                txt = open(PREFS, encoding='utf-8').read() if os.path.exists(PREFS) else '{}'
                self.reply(msg_id, {'json': txt})
            elif cmd == 'setPrefs':
                with open(PREFS, 'w', encoding='utf-8') as f:
                    f.write(args.get('json', '{}'))
                self.reply(msg_id, {'ok': True})
            elif cmd == 'appInfo':
                self.reply(msg_id, {'platform': 'linux', 'version': VERSION, 'channel': IN_FLATPAK, 'kind': 'flatpak' if IN_FLATPAK else 'zip', 'arch': 'aarch64' if platform.machine() in ('aarch64', 'arm64') else 'x86_64'})
            elif cmd == 'installUpdate':
                threading.Thread(target=self.install_update, args=(msg_id, args), daemon=True).start()
            elif cmd == 'restartApp':
                self.restart_app()
                self.reply(msg_id, {'ok': True})
            elif cmd == 'print':
                # the printable report: the usual print window, where "Print to File" makes a PDF
                op = WebKit.PrintOperation.new(self.view)
                op.run_dialog(self.win)
                self.reply(msg_id, {'ok': True})
            elif cmd == 'openUrl':
                url = args.get('url', '')
                if url.startswith('https://'):
                    Gio.AppInfo.launch_default_for_uri(url, None)
                self.reply(msg_id, {'ok': True})
            elif cmd == 'statusBar':
                self.reply(msg_id, {'ok': True})
            elif cmd == 'secure':
                self.reply(msg_id, {'ok': True})
            elif cmd in ('bioAvailable', 'bioEnable', 'bioUnlock', 'bioDisable'):
                threading.Thread(target=self.bio, args=(msg_id, cmd, args), daemon=True).start()
            elif cmd == 'httpGet':
                threading.Thread(target=self.http_get, args=(msg_id, args.get('url', ''), args.get('ua')), daemon=True).start()
            elif cmd == 'exportDb':
                self.export_db(msg_id, args)
            elif cmd == 'importDb':
                self.import_db(msg_id, args)
            else:
                self.reply(msg_id, {'error': 'unknown command'})
        except Exception as e:
            self.reply(msg_id, {'error': str(e)})

    # ---------- abilities ----------
    def http_get(self, msg_id, url, ua=None):
        if not url.startswith('https://'):
            return self.reply(msg_id, {'error': 'only https'})
        req = urllib.request.Request(url, headers={'User-Agent': ua or ('KJTFinance/' + VERSION),
                                                   'Accept': 'application/json, application/xml, text/xml'})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                self.reply(msg_id, {'status': r.status, 'body': r.read().decode('utf-8', 'replace')})
        except urllib.error.HTTPError as e:
            self.reply(msg_id, {'status': e.code, 'body': ''})
        except Exception as e:
            self.reply(msg_id, {'status': 0, 'body': '', 'error': str(e)})

    # ---------- fingerprint unlock: the fingerprint reader (fprintd) + the desktop keyring (secret-tool) ----------
    @staticmethod
    def run(cmd, data=None, timeout=40):
        r = subprocess.run(cmd, input=data, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or '') + (r.stderr or '')

    # Inside the Flatpak the command-line tools are not there: the fingerprint reader (fprintd) and the
    # keyring (Secret Service) are reached over D-Bus instead.
    def dbus_finger_ok(self, check_only=False):
        bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
        mgr = Gio.DBusProxy.new_sync(bus, 0, None, 'net.reactivated.Fprint', '/net/reactivated/Fprint/Manager', 'net.reactivated.Fprint.Manager', None)
        path = mgr.call_sync('GetDefaultDevice', None, 0, 5000, None).unpack()[0]
        dev = Gio.DBusProxy.new_sync(bus, 0, None, 'net.reactivated.Fprint', path, 'net.reactivated.Fprint.Device', None)
        user = os.environ.get('USER') or ''
        if check_only:
            fingers = dev.call_sync('ListEnrolledFingers', GLib.Variant('(s)', (user,)), 0, 5000, None).unpack()[0]
            return bool(fingers)
        result = {'done': False, 'match': False}
        loop = GLib.MainLoop.new(GLib.MainContext.new(), False)
        def on_signal(proxy, sender, name, params):
            if name == 'VerifyStatus':
                status, done = params.unpack()
                if done:
                    result['match'] = status == 'verify-match'; result['done'] = True
        dev.connect('g-signal', on_signal)
        dev.call_sync('Claim', GLib.Variant('(s)', (user,)), 0, 5000, None)
        try:
            dev.call_sync('VerifyStart', GLib.Variant('(s)', ('any',)), 0, 5000, None)
            ctx = GLib.MainContext.default()
            import time
            end = time.time() + 30
            while not result['done'] and time.time() < end:
                ctx.iteration(False); time.sleep(0.05)
            try:
                dev.call_sync('VerifyStop', None, 0, 5000, None)
            except Exception:
                pass
        finally:
            try:
                dev.call_sync('Release', None, 0, 5000, None)
            except Exception:
                pass
        return result['match']

    def secret(self, op, value=None):
        gi.require_version('Secret', '1')
        from gi.repository import Secret
        schema = Secret.Schema.new('today.knowingjesus.Invest', Secret.SchemaFlags.NONE, {'app': Secret.SchemaAttributeType.STRING, 'key': Secret.SchemaAttributeType.STRING})
        attrs = {'app': 'kjt-invest', 'key': 'unlock'}
        if op == 'store':
            return Secret.password_store_sync(schema, attrs, Secret.COLLECTION_DEFAULT, 'KJT Finance unlock key', value, None)
        if op == 'lookup':
            return Secret.password_lookup_sync(schema, attrs, None)
        return Secret.password_clear_sync(schema, attrs, None)

    def finger_ok(self):
        try:
            code, out = self.run(['fprintd-verify'], timeout=40)
        except Exception:
            return False
        return 'verify-match' in out and 'no-match' not in out

    def bio(self, msg_id, cmd, args):
        if IN_FLATPAK:
            return self.bio_dbus(msg_id, cmd, args)
        tools = shutil.which('fprintd-verify') and shutil.which('fprintd-list') and shutil.which('secret-tool')
        try:
            if cmd == 'bioAvailable':
                ok = False
                if tools:
                    try:
                        code, out = self.run(['fprintd-list', os.environ.get('USER') or os.getlogin()], timeout=8)
                        ok = code == 0 and '#' in out and 'no fingers enrolled' not in out.lower()
                    except Exception:
                        ok = False
                return self.reply(msg_id, {'available': bool(ok), 'kind': 'fingerprint'})
            if cmd == 'bioDisable':
                if shutil.which('secret-tool'):
                    self.run(['secret-tool', 'clear'] + SECRET, timeout=10)
                return self.reply(msg_id, {'ok': True})
            if not tools:
                return self.reply(msg_id, {'error': 'no fingerprint reader set up'})
            if not self.finger_ok():
                return self.reply(msg_id, {'error': 'cancelled'})
            if cmd == 'bioEnable':
                code, out = self.run(['secret-tool', 'store', '--label=KJT Finance unlock key'] + SECRET, data=args.get('dek', ''), timeout=20)
                return self.reply(msg_id, {'ok': True} if code == 0 else {'error': 'the keyring did not accept it'})
            r = subprocess.run(['secret-tool', 'lookup'] + SECRET, capture_output=True, text=True, timeout=20)
            dek = r.stdout.strip() if r.returncode == 0 else ''
            self.reply(msg_id, {'dek': dek} if dek else {'error': 'not set up'})
        except Exception as e:
            self.reply(msg_id, {'error': str(e)})

    def bio_dbus(self, msg_id, cmd, args):
        try:
            if cmd == 'bioAvailable':
                try:
                    ok = self.dbus_finger_ok(check_only=True)
                except Exception:
                    ok = False
                return self.reply(msg_id, {'available': bool(ok), 'kind': 'fingerprint'})
            if cmd == 'bioDisable':
                try:
                    self.secret('clear')
                except Exception:
                    pass
                return self.reply(msg_id, {'ok': True})
            if not self.dbus_finger_ok():
                return self.reply(msg_id, {'error': 'cancelled'})
            if cmd == 'bioEnable':
                return self.reply(msg_id, {'ok': True} if self.secret('store', args.get('dek', '')) else {'error': 'the keyring did not accept it'})
            dek = self.secret('lookup')
            self.reply(msg_id, {'dek': dek} if dek else {'error': 'not set up'})
        except Exception as e:
            self.reply(msg_id, {'error': str(e)})

    # ---------- updates: the new version is downloaded from the project's GitHub, checked against its published
    # fingerprint, and opened in Software (GNOME Software), where you press Install. Your data stays.
    # ---------- updates ----------
    # The new version comes only from the project's GitHub and must match its published SHA-256.
    # Flatpak: installed quietly through Flatpak's update portal (app installed from the KJT Finance channel),
    # otherwise the checked file opens in Software, where you press Install.
    # Zip install: the app's own files in ~/.local/share/kjt-invest-app are replaced. Your data is never touched.
    @staticmethod
    def fetch_checked(url, sha):
        if not url.startswith('https://raw.githubusercontent.com/BibleCorner-KJT/kjt-invest/'):
            raise Exception('not from the KJT Finance project')
        req = urllib.request.Request(url, headers={'User-Agent': 'KJTFinance/' + VERSION})
        with urllib.request.urlopen(req, timeout=180) as r:
            data = r.read()
        if not sha or hashlib.sha256(data).hexdigest().lower() != sha.lower():
            raise Exception('the downloaded file does not match; nothing was installed')
        return data

    def portal_update(self):
        """Flatpak's own update portal: no extra permission; works when the app came from the KJT Finance channel.
        Returns True when the new version was installed."""
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        name, base = 'org.freedesktop.portal.Flatpak', '/org/freedesktop/portal/Flatpak'
        portal = Gio.DBusProxy.new_sync(bus, Gio.DBusProxyFlags.NONE, None, name, base, name, None)
        path = portal.call_sync('CreateUpdateMonitor', GLib.Variant('(a{sv})', ({},)), Gio.DBusCallFlags.NONE, 20000, None).unpack()[0]
        done, result = threading.Event(), {'ok': False}

        def on_progress(conn, sender, obj, iface, signal, params):
            info = params.unpack()[0]
            status = info.get('status', 0)
            if status in (1, 2, 3):   # 1 nothing to do, 2 done, 3 failed
                result['ok'] = status == 2
                done.set()
        sub = bus.signal_subscribe(name, name + '.UpdateMonitor', 'Progress', path, None, Gio.DBusSignalFlags.NONE, on_progress)
        try:
            bus.call_sync(name, path, name + '.UpdateMonitor', 'Update', GLib.Variant('(sa{sv})', ('', {})), None, Gio.DBusCallFlags.NONE, 20000, None)
            done.wait(900)
        finally:
            bus.signal_unsubscribe(sub)
            try:
                bus.call_sync(name, path, name + '.UpdateMonitor', 'Close', None, None, Gio.DBusCallFlags.NONE, 5000, None)
            except Exception:
                pass
        return result['ok']

    def install_update(self, msg_id, args):
        try:
            if IN_FLATPAK:
                if args.get('quiet'):
                    try:
                        if self.portal_update():
                            return self.reply(msg_id, {'ok': True, 'installed': True})
                    except Exception:
                        pass
                f = args.get('flatpak') or {'url': args.get('url', ''), 'sha256': args.get('sha256', '')}
                data = self.fetch_checked(f.get('url', ''), f.get('sha256', ''))
                folder = os.path.join(DATA_DIR, 'update')
                os.makedirs(folder, exist_ok=True)
                path = os.path.join(folder, 'KJT Finance update.flatpak')
                with open(path, 'wb') as fh:
                    fh.write(data)
                # a Flatpak installed from a file cannot replace itself, and Software refuses ("already installed"):
                # the app shows a one-line command (with a Copy button) that reinstalls it, keeping your data
                cmd = "flatpak install --user -y --reinstall '%s'" % path.replace("'", "'\\''")
                return self.reply(msg_id, {'ok': True, 'manual': True, 'path': path, 'command': cmd})
            z = args.get('zip') or {}
            if not z.get('url'):
                return self.reply(msg_id, {'error': 'no update file for this kind of install'})
            if not HERE.startswith(os.path.expanduser('~') + os.sep) or not os.access(os.path.dirname(HERE), os.W_OK):
                return self.reply(msg_id, {'error': 'this copy of the app cannot update itself'})
            data = self.fetch_checked(z['url'], z.get('sha256', ''))
            import io, zipfile
            new, old = HERE + '.new', HERE + '.old'
            shutil.rmtree(new, ignore_errors=True)
            shutil.rmtree(old, ignore_errors=True)
            os.makedirs(new)
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                for m in zf.namelist():
                    parts = m.split('/', 1)
                    if len(parts) < 2 or not parts[1] or '..' in parts[1].split('/') or parts[1].startswith('/'):
                        continue
                    rel = parts[1]
                    if not (rel.startswith('www/') or rel in ('kjt_invest.py', 'LICENSE.txt')):
                        continue
                    target = os.path.join(new, rel)
                    if m.endswith('/'):
                        os.makedirs(target, exist_ok=True)
                        continue
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    with open(target, 'wb') as fh:
                        fh.write(zf.read(m))
            if not os.path.exists(os.path.join(new, 'kjt_invest.py')) or not os.path.exists(os.path.join(new, 'www', 'index.html')):
                shutil.rmtree(new, ignore_errors=True)
                raise Exception('the update file is incomplete; nothing was changed')
            os.rename(HERE, old)
            os.rename(new, HERE)
            shutil.rmtree(old, ignore_errors=True)
            self.reply(msg_id, {'ok': True, 'installed': True})
        except Exception as e:
            self.reply(msg_id, {'error': str(e)})

    def restart_app(self):
        if IN_FLATPAK:
            # the portal's own restart: the sandbox starts the new version of the app
            try:
                bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
                bus.call_sync('org.freedesktop.portal.Flatpak', '/org/freedesktop/portal/Flatpak', 'org.freedesktop.portal.Flatpak', 'Spawn',
                              GLib.Variant('(ayaaya{uh}a{ss}ua{sv})', (b'/\x00', [b'kjt-invest\x00'], {}, {'KJT_WAIT_START': '2'}, 2, {})),   # 2: start the latest version
                              None, Gio.DBusCallFlags.NONE, 10000, None)
            except Exception:
                pass
        else:
            subprocess.Popen([sys.executable, os.path.join(HERE, 'kjt_invest.py')], start_new_session=True,
                             env=dict(os.environ, KJT_WAIT_START='2'))
        GLib.timeout_add(300, lambda: self.app.quit() or False)

    def open_file(self, path):
        gfile = Gio.File.new_for_path(path)
        try:
            if GTK4 and hasattr(Gtk, 'FileLauncher'):
                Gtk.FileLauncher.new(gfile).launch(self.win, None, None, None)   # through the desktop portal inside the Flatpak
            else:
                Gio.AppInfo.launch_default_for_uri(gfile.get_uri(), None)
        except Exception:
            Gio.AppInfo.launch_default_for_uri(gfile.get_uri(), None)
        return False

    def chooser(self, title, save, name=None, filt=None):
        action = Gtk.FileChooserAction.SAVE if save else Gtk.FileChooserAction.OPEN
        dlg = Gtk.FileChooserNative.new(title, self.win, action, 'Save' if save else 'Open', 'Cancel')
        if save:
            dlg.set_current_name(name)
            docs = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS) or os.path.expanduser('~')
            try:
                if GTK4:
                    dlg.set_current_folder(Gio.File.new_for_path(docs))
                else:
                    dlg.set_current_folder(docs)
                    dlg.set_do_overwrite_confirmation(True)
            except Exception:
                pass
        else:
            f = Gtk.FileFilter()
            if filt == 'mmex':   # a Money Manager Ex database
                f.set_name('MMEX database (.mmb)')
                pats = ('*.mmb', '*.MMB')
            elif filt == 'bank':   # files downloaded from online banking
                f.set_name('Bank files (OFX, QFX, QIF, CSV)')
                pats = ('*.ofx', '*.qfx', '*.qbo', '*.qif', '*.csv', '*.OFX', '*.QFX', '*.QBO', '*.QIF', '*.CSV', '*.txt')
            else:
                f.set_name('KJT Finance database')
                pats = ('*.sqlite', '*.db', '*.sqlite3', '*.itdb')
            for pat in pats:
                f.add_pattern(pat)
            dlg.add_filter(f)
            anyf = Gtk.FileFilter()
            anyf.set_name('All files')
            anyf.add_pattern('*')
            dlg.add_filter(anyf)
        return dlg

    def quick_add(self):
        js = 'window.__quickAdd ? window.__quickAdd() : (window.__quickPending = true)'

        def run():
            if hasattr(self.view, 'evaluate_javascript'):
                self.view.evaluate_javascript(js, -1, None, None, None, None, None)
            else:
                self.view.run_javascript(js, None, None, None)
            return False
        GLib.timeout_add(300, run)

    def copy_text(self, text):
        try:
            if GTK4:
                from gi.repository import Gdk
                self.win.get_clipboard().set_content(Gdk.ContentProvider.new_for_value(text))
            else:
                from gi.repository import Gdk
                Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).set_text(text, -1)
        except Exception:
            pass

    # ---------- sync between devices ----------
    # You choose a folder (for example one shared by Syncthing); the app keeps a copy of its data file there,
    # reads the copies other devices write, and merges them. Only that folder is touched.
    SYNC_CONF = os.path.join(DATA_DIR, 'sync.json')

    def sync_dir(self):
        try:
            with open(self.SYNC_CONF, encoding='utf-8') as f:
                d = json.load(f).get('dir')
            return d if d and os.path.isdir(d) else None
        except Exception:
            return None

    def sync_path(self, name):
        d = self.sync_dir()
        if not d:
            raise Exception('no sync folder')
        if '/' in name or name.startswith('.'):
            raise Exception('bad file name')
        return os.path.join(d, name)

    def sync_cmd(self, msg_id, cmd, args):
        try:
            if cmd == 'syncPick':
                return self.sync_pick(msg_id)
            if cmd == 'syncInfo':
                d = self.sync_dir()
                return self.reply(msg_id, {'set': bool(d), 'label': d or ''})
            if cmd == 'syncForget':
                if os.path.exists(self.SYNC_CONF):
                    os.remove(self.SYNC_CONF)
                return self.reply(msg_id, {'ok': True})
            if cmd == 'syncList':
                d = self.sync_dir()
                if not d:
                    raise Exception('no sync folder')
                files = []
                for n in os.listdir(d):
                    pth = os.path.join(d, n)
                    if os.path.isfile(pth):
                        st = os.stat(pth)
                        files.append({'name': n, 'mtime': int(st.st_mtime * 1000), 'size': st.st_size})
                return self.reply(msg_id, {'files': files})
            if cmd == 'syncRead':
                pth = self.sync_path(args['name'])
                if not os.path.exists(pth):
                    return self.reply(msg_id, {'missing': True})
                with open(pth, 'rb') as f:
                    return self.reply(msg_id, {'b64': base64.b64encode(f.read()).decode()})
            if cmd == 'syncWrite':
                pth = self.sync_path(args['name'])
                tmp = os.path.join(os.path.dirname(pth), '.' + os.path.basename(pth) + '.tmp')   # Syncthing ignores dot-tmp files until renamed
                with open(tmp, 'wb') as f:
                    f.write(base64.b64decode(args['b64']))
                os.replace(tmp, pth)
                return self.reply(msg_id, {'ok': True})
            if cmd == 'syncDelete':
                pth = self.sync_path(args['name'])
                if os.path.exists(pth):
                    os.remove(pth)
                return self.reply(msg_id, {'ok': True})
        except Exception as e:
            self.reply(msg_id, {'error': str(e)})

    def sync_pick(self, msg_id):
        dlg = Gtk.FileChooserNative.new('Choose the folder to sync', self.win, Gtk.FileChooserAction.SELECT_FOLDER, 'Choose', 'Cancel')

        def done(d, resp):
            try:
                if resp == Gtk.ResponseType.ACCEPT:
                    path = d.get_file().get_path()
                    with open(self.SYNC_CONF, 'w', encoding='utf-8') as f:
                        json.dump({'dir': path}, f)
                    self.reply(msg_id, {'ok': True, 'label': path})
                else:
                    self.reply(msg_id, {})
            except Exception as e:
                self.reply(msg_id, {'error': str(e)})
            d.destroy()
        dlg.connect('response', done)
        dlg.show()
        self.dialog = dlg

    def export_db(self, msg_id, args):
        data = base64.b64decode(args['b64'])
        dlg = self.chooser('Export database', True, args.get('name') or 'investment-tracker.sqlite')

        def done(d, resp):
            try:
                if resp == Gtk.ResponseType.ACCEPT:
                    path = d.get_file().get_path()
                    with open(path, 'wb') as f:
                        f.write(data)
                    self.reply(msg_id, {'ok': True, 'where': path})
                else:
                    self.reply(msg_id, {})
            except Exception as e:
                self.reply(msg_id, {'error': str(e)})
            d.destroy()
        dlg.connect('response', done)
        dlg.show()
        self.dialog = dlg

    def import_db(self, msg_id, args=None):
        args = args or {}
        dlg = self.chooser(args.get('title') or 'Import database', False, filt=args.get('filter'))

        def done(d, resp):
            try:
                if resp == Gtk.ResponseType.ACCEPT:
                    with open(d.get_file().get_path(), 'rb') as f:
                        self.reply(msg_id, {'b64': base64.b64encode(f.read()).decode()})
                else:
                    self.reply(msg_id, {})
            except Exception as e:
                self.reply(msg_id, {'error': str(e)})
            d.destroy()
        dlg.connect('response', done)
        dlg.show()
        self.dialog = dlg


def main():
    if os.environ.get('KJT_WAIT_START'):   # a restart after an update: let the old window close first
        import time
        time.sleep(float(os.environ.pop('KJT_WAIT_START')))
    app = Gtk.Application(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
    holder = {}

    def activate(a):
        if 'w' in holder:
            holder['w'].win.present()
        else:
            holder['w'] = Tracker(a)

    def command_line(a, cl):
        # "--add" comes from the app's menu (right-click or long-press its icon): open on a new transaction
        activate(a)
        if '--add' in cl.get_arguments()[1:]:
            holder['w'].quick_add()
        return 0
    app.connect('activate', activate)
    app.connect('command-line', command_line)
    return app.run(sys.argv)


if __name__ == '__main__':
    sys.exit(main())
