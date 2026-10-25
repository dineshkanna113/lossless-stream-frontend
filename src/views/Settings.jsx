import { useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog, promptDialog } from "../components/Dialog";
import { PageHeader } from "../components/Grid";
import { TrashIcon, UploadIcon } from "../components/Icons";
import { api, API_BASE, auth } from "../lib/api";
import { usePlayer, useSession } from "../lib/hooks";
import { library } from "../lib/library";
import { player } from "../lib/player";
import { toast, toastError } from "../lib/toast";

function Card({ title, description, children }) {
  return (
    <section className="mb-6 rounded-xl border border-line bg-surface-1 p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      auth.set(await api("/api/auth/password", { method: "POST", body: { current_password: current, new_password: next } }));
      setCurrent("");
      setNext("");
      toast("Password changed. Other devices have been signed out.");
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid max-w-md gap-3">
      <input className="input" type="password" autoComplete="current-password" placeholder="Current password"
        value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <input className="input" type="password" autoComplete="new-password" placeholder="New password (8+ characters)"
        minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
      <div><button className="btn-primary" disabled={busy}>Change password</button></div>
    </form>
  );
}

function OutputDevice() {
  const { outputDevice } = usePlayer();
  const [devices, setDevices] = useState([]);
  const supported = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

  const refresh = useCallback(async () => {
    const all = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
    setDevices((all ?? []).filter((d) => d.kind === "audiooutput"));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!supported) return <p className="text-sm text-muted">This browser can’t choose an output device (Safari). Use the system sound settings.</p>;
  const unlabeled = devices.length > 0 && devices.every((d) => !d.label);

  const reveal = async () => {
    try {
      if (navigator.mediaDevices.selectAudioOutput) {
        const d = await navigator.mediaDevices.selectAudioOutput();
        await player.setOutputDevice(d.deviceId);
      } else {
        // Chrome only reveals device names after a media permission grant.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      }
      refresh();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select value={outputDevice} onChange={(e) => player.setOutputDevice(e.target.value).catch(toastError)}
        className="rounded-md border border-line bg-surface-2 px-2 py-2 text-sm">
        <option value="">System default</option>
        {devices.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>
        ))}
      </select>
      {unlabeled && <button type="button" className="btn-ghost" onClick={reveal}>Show device names</button>}
    </div>
  );
}

function SubsonicCard({ username }) {
  const [password, setPassword] = useState(undefined);
  const [shown, setShown] = useState(false);
  const server = API_BASE || window.location.origin;

  useEffect(() => {
    api("/api/auth/app-password").then((d) => setPassword(d.app_password)).catch(() => setPassword(null));
  }, []);

  const generate = async () => {
    if (password && !(await confirmDialog({ title: "Generate a new app password?", message: "Apps using the current one will need the new password.", confirmLabel: "Generate" }))) return;
    const d = await api("/api/auth/app-password", { method: "POST" }).catch(toastError);
    if (d) {
      setPassword(d.app_password);
      setShown(true);
    }
  };
  const revoke = async () => {
    await api("/api/auth/app-password", { method: "DELETE" }).catch(toastError);
    setPassword(null);
  };
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast("Copied"));

  return (
    <Card
      title="Subsonic apps"
      description="Use native apps on your phone or desktop: Symfonium, Tempo, DSub, play:Sub, Feishin, Substreamer and others. They get offline sync, CarPlay/Android Auto and lock-screen controls. Files are always served untouched."
    >
      <dl className="grid max-w-xl grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted">Server</dt>
        <dd className="flex items-center gap-2 truncate font-mono">{server}<button type="button" className="text-xs text-accent" onClick={() => copy(server)}>Copy</button></dd>
        <dt className="text-muted">Username</dt>
        <dd className="font-mono">{username}</dd>
        <dt className="text-muted">App password</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {password === undefined ? "…" : password ? (
            <>
              <span className="font-mono">{shown ? password : "••••••••••••"}</span>
              <button type="button" className="text-xs text-accent" onClick={() => setShown((v) => !v)}>{shown ? "Hide" : "Show"}</button>
              <button type="button" className="text-xs text-accent" onClick={() => copy(password)}>Copy</button>
            </>
          ) : <span className="text-muted">None</span>}
        </dd>
      </dl>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-primary" onClick={generate}>{password ? "Generate new" : "Create app password"}</button>
        {password && <button type="button" className="btn-ghost" onClick={revoke}>Revoke</button>}
      </div>
      <p className="mt-3 text-xs text-muted">Your account password never works in third-party apps, so a leaked app password can be revoked without changing it.</p>
    </Card>
  );
}

function LibraryAdmin() {
  const [upload, setUpload] = useState(null); // { name, pct }
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);

  const send = (files) => {
    if (!files.length) return;
    const form = new FormData();
    [...files].forEach((f) => form.append("files", f));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/library/upload`);
    xhr.setRequestHeader("Authorization", `Bearer ${auth.session.access_token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && setUpload({ count: files.length, pct: e.loaded / e.total });
    xhr.onload = () => {
      setUpload(null);
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error page
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        toast(`Uploaded ${body.saved.length} file(s); ${body.scan.added} new track(s) added`);
        library.load();
      } else {
        toastError(new Error(body?.detail || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => {
      setUpload(null);
      toastError(new Error("Upload failed: connection lost"));
    };
    setUpload({ count: files.length, pct: 0 });
    xhr.send(form);
  };

  const rescan = async () => {
    await api("/api/library/rescan", { method: "POST" }).catch(toastError);
    toast("Rescanning library…");
    setTimeout(() => library.load(), 1500);
  };

  return (
    <Card title="Library" description="FLAC, WAV, AIFF, ALAC/AAC (.m4a), MP3, Ogg and Opus files are indexed from their tags. Add folders on the server, or upload here.">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files); }}
        className={`grid place-items-center rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${dragging ? "border-accent bg-accent/5" : "border-line"}`}
      >
        {upload ? (
          <div className="w-full max-w-xs">
            <p className="mb-2">Uploading {upload.count} file(s)… {Math.round(upload.pct * 100)}%</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full bg-accent" style={{ width: `${upload.pct * 100}%` }} /></div>
          </div>
        ) : (
          <>
            <UploadIcon className="mb-2 h-6 w-6 text-muted" />
            <p>Drop audio files here, or <button type="button" className="text-accent underline" onClick={() => input.current.click()}>browse</button></p>
            <input ref={input} type="file" multiple accept=".flac,.wav,.aif,.aiff,.m4a,.mp3,.ogg,.opus,audio/*" className="hidden"
              onChange={(e) => { send(e.target.files); e.target.value = ""; }} />
          </>
        )}
      </div>
      <button type="button" className="btn-ghost mt-3" onClick={rescan}>Rescan library folder</button>
    </Card>
  );
}

function UsersAdmin({ me }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: "", password: "", is_admin: false });
  const load = () => api("/api/users").then((d) => setUsers(d.users)).catch(toastError);
  useEffect(() => {
    load();
  }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api("/api/users", { method: "POST", body: form });
      toast(`Created ${form.username}`);
      setForm({ username: "", password: "", is_admin: false });
      load();
    } catch (err) {
      toastError(err);
    }
  };
  const patch = async (u, body, message) => {
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", body });
      toast(message);
      load();
    } catch (err) {
      toastError(err);
    }
  };
  const resetPassword = async (u) => {
    const pw = await promptDialog({ title: `New password for ${u.username}`, label: "At least 8 characters", confirmLabel: "Set password" });
    if (pw) patch(u, { password: pw }, `Password reset; ${u.username} was signed out everywhere`);
  };
  const remove = async (u) => {
    if (!(await confirmDialog({ title: `Delete ${u.username}?`, message: "Their playlists, favorites and history are deleted too." }))) return;
    await api(`/api/users/${u.id}`, { method: "DELETE" }).catch(toastError);
    load();
  };

  return (
    <Card title="Users" description="Everyone shares the library; favorites, playlists and history are private per user.">
      <ul className="mb-4 divide-y divide-line">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{u.username}{u.id === me.id && <span className="ml-2 text-xs text-muted">(you)</span>}</span>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={u.is_admin} disabled={u.id === me.id}
                onChange={(e) => patch(u, { is_admin: e.target.checked }, `${u.username} is ${e.target.checked ? "now" : "no longer"} an admin`)} />
              Admin
            </label>
            <button type="button" className="btn-ghost text-xs" onClick={() => resetPassword(u)}>Reset password</button>
            {u.id !== me.id && (
              <button type="button" className="grid h-8 w-8 place-items-center text-muted hover:text-danger" aria-label={`Delete ${u.username}`} onClick={() => remove(u)}>
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="flex flex-wrap items-center gap-2">
        <input className="input w-40" placeholder="Username" value={form.username} required minLength={3} maxLength={32}
          pattern="[A-Za-z0-9_.\-]+" onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <input className="input w-48" type="password" autoComplete="new-password" placeholder="Password" value={form.password}
          required minLength={8} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={form.is_admin} onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} /> Admin
        </label>
        <button className="btn-primary">Add user</button>
      </form>
    </Card>
  );
}

const SHORTCUTS = [
  ["Space", "Play / pause"], ["← / →", "Seek 10 s"], ["Shift + ← / →", "Previous / next track"], ["M", "Mute"],
  ["L", "Lyrics"], ["Q", "Queue"], ["/", "Search"], ["F", "Favorite current track"],
];

export default function Settings() {
  const session = useSession();
  const { replayGain } = usePlayer();
  const user = session.user;

  const logoutAll = async () => {
    if (!(await confirmDialog({ title: "Sign out everywhere?", message: "Every device, including this one, will need to sign in again.", confirmLabel: "Sign out" }))) return;
    await api("/api/auth/logout-all", { method: "POST" }).catch(toastError);
    player.reset();
    auth.logout();
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle={`Signed in as ${user.username}${user.is_admin ? " (admin)" : ""}`} />
      <Card title="Playback">
        <div className="grid gap-5">
          <div>
            <p className="mb-2 text-sm font-medium">Output device</p>
            <OutputDevice />
            <p className="mt-2 text-xs text-muted">For an exact sample-rate match, set the device’s format in your OS sound settings to the track’s rate. The signal-path panel shows when resampling happens.</p>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">ReplayGain</p>
            <select value={replayGain} onChange={(e) => player.setReplayGain(e.target.value)}
              className="rounded-md border border-line bg-surface-2 px-2 py-2 text-sm">
              <option value="off">Off (bit-transparent)</option>
              <option value="track">Track gain</option>
              <option value="album">Album gain</option>
            </select>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Keyboard shortcuts</p>
            <dl className="grid max-w-md grid-cols-[9rem_1fr] gap-y-1 text-sm">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="contents"><dt><kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt><dd className="text-muted">{v}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      </Card>
      <SubsonicCard username={user.username} />
      <Card title="Account">
        <PasswordForm />
        <button type="button" className="btn-ghost mt-4" onClick={logoutAll}>Sign out of all devices</button>
      </Card>
      {user.is_admin && <LibraryAdmin />}
      {user.is_admin && <UsersAdmin me={user} />}
    </div>
  );
}
