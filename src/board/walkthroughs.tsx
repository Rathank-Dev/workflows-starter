import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "./account";

/** Matches the server's limits in worker/recordings.ts. */
const MAX_MS = 5 * 60 * 1000;
const MAX_BYTES = 80 * 1024 * 1024;

export interface Recording {
	id: string;
	title: string;
	durationMs: number;
	createdAt: string;
	authorName: string;
	canDelete: boolean;
}

interface Library {
	items: Recording[];
	remaining: number | null;
	limit: number;
	canRecord: boolean;
}

export interface Take {
	blob: Blob;
	type: string;
	durationMs: number;
}

const clock = (ms: number) => {
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** First container/codec this browser can record. Safari records MP4. */
function pickType(): string | null {
	if (typeof MediaRecorder === "undefined") return null;
	for (const t of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]) {
		if (MediaRecorder.isTypeSupported(t)) return t;
	}
	return null;
}

/**
 * Records the screen (the person picks this tab, a window, or a screen) with
 * their microphone. Stops at 5 minutes, or when they end screen sharing.
 */
// eslint-disable-next-line react-refresh/only-export-components -- a hook used only alongside these components
export function useRecorder(onTake: (take: Take) => void, onError: (message: string) => void) {
	const [recording, setRecording] = useState(false);
	const [elapsed, setElapsed] = useState(0);
	const stopRef = useRef<(() => void) | null>(null);

	const start = useCallback(async () => {
		const type = pickType();
		if (!type || !navigator.mediaDevices?.getDisplayMedia) {
			onError("This browser can't record the screen. Try Chrome, Edge, or Firefox on a computer.");
			return;
		}
		let screen: MediaStream;
		try {
			screen = await navigator.mediaDevices.getDisplayMedia({
				video: { frameRate: 24 },
				audio: false,
				// Offer this tab first in Chrome's picker
				preferCurrentTab: true,
			} as DisplayMediaStreamOptions);
		} catch {
			return; // Cancelled the picker
		}
		let mic: MediaStream | null = null;
		try {
			mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
		} catch {
			onError("Recording without sound: microphone access was blocked.");
		}
		const stream = new MediaStream([...screen.getVideoTracks(), ...(mic?.getAudioTracks() ?? [])]);
		const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_500_000 });
		const chunks: Blob[] = [];
		let size = 0;
		const began = Date.now();
		const tick = window.setInterval(() => {
			const ms = Date.now() - began;
			setElapsed(ms);
			if (ms >= MAX_MS) stop();
		}, 250);

		function stop() {
			if (recorder.state !== "inactive") recorder.stop();
		}
		recorder.ondataavailable = (e) => {
			if (!e.data.size) return;
			chunks.push(e.data);
			size += e.data.size;
			if (size >= MAX_BYTES * 0.95) stop();
		};
		recorder.onstop = () => {
			window.clearInterval(tick);
			for (const t of [...screen.getTracks(), ...(mic?.getTracks() ?? [])]) t.stop();
			stopRef.current = null;
			setRecording(false);
			const durationMs = Math.min(MAX_MS, Date.now() - began);
			if (durationMs >= 1000 && chunks.length) {
				const base = type.split(";")[0];
				onTake({ blob: new Blob(chunks, { type: base }), type: base, durationMs });
			}
		};
		// Ending the share from the browser's own bar also stops the recording
		screen.getVideoTracks()[0]?.addEventListener("ended", stop);
		stopRef.current = stop;
		recorder.start(1000);
		setElapsed(0);
		setRecording(true);
	}, [onTake, onError]);

	const stop = useCallback(() => stopRef.current?.(), []);
	return { recording, elapsed, start, stop };
}

/** Floating bar while recording: time used and a stop button. */
export function RecordingBar({ elapsed, onStop }: { elapsed: number; onStop: () => void }) {
	return (
		<div className="panel recording-bar" role="status">
			<span className="rec-dot" aria-hidden="true" />
			<span className="rec-time">
				{clock(elapsed)} <span className="muted">/ {clock(MAX_MS)}</span>
			</span>
			<button type="button" className="primary-btn rec-stop" onClick={onStop}>
				Stop
			</button>
		</div>
	);
}

/** Library popover: record a new walkthrough, or watch the board's existing ones. */
export function WalkthroughPanel({
	boardId,
	refreshKey,
	signedIn,
	onRecord,
	onPlay,
	onSignIn,
	onClose,
}: {
	boardId: string | null;
	refreshKey: number;
	signedIn: boolean;
	onRecord: () => void;
	onPlay: (r: Recording) => void;
	onSignIn: () => void;
	onClose: () => void;
}) {
	const [lib, setLib] = useState<Library | null>(null);
	const [error, setError] = useState<string | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!boardId) return;
		fetch(`/api/boards/${boardId}/recordings`)
			.then(async (res) => {
				const data = await res.json();
				if (!res.ok) throw new Error(data?.error ?? "Couldn't load walkthroughs.");
				setLib(data as Library);
			})
			.catch((e: Error) => setError(e.message));
	}, [boardId, refreshKey]);

	useEffect(() => {
		const close = (e: PointerEvent) => {
			const t = e.target as Element;
			if (!ref.current?.contains(t) && !t.closest?.("[data-walkthrough-toggle]")) onClose();
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("pointerdown", close);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("keydown", onKey);
		};
	}, [onClose]);

	const left = lib?.remaining ?? null;
	return (
		<div className="panel walkthrough-panel" ref={ref} role="dialog" aria-label="Walkthroughs">
			<section className="walkthrough-record">
				<span className="rec-dot rec-dot-idle" aria-hidden="true" />
				<h3>Record a walkthrough</h3>
				<p>Talk through this board on video, then share it with your team for feedback.</p>
				{!boardId ? (
					<p className="walkthrough-note">Share the board first; walkthroughs are saved with shared boards.</p>
				) : !signedIn ? (
					<button type="button" className="primary-btn" onClick={onSignIn}>
						Sign in to record
					</button>
				) : (
					<button type="button" className="primary-btn" onClick={onRecord} disabled={!lib?.canRecord || left === 0}>
						Record
					</button>
				)}
				{lib && !lib.canRecord && signedIn && (
					<p className="walkthrough-note">You can watch walkthroughs here; only editors can record them.</p>
				)}
			</section>
			{left !== null && lib && (
				<p className="walkthrough-quota" data-empty={left === 0 || undefined}>
					<strong>
						{left} of {lib.limit} walkthroughs left
					</strong>
					<span>
						{left === 0 ? "Delete one to record another. " : ""}Unlimited walkthroughs come with paid plans.{" "}
						<span className="soon">Soon</span>
					</span>
				</p>
			)}
			{error && <p className="walkthrough-note dash-error">{error}</p>}
			{lib && lib.items.length > 0 && (
				<>
					<div className="menu-sep" />
					<h3 className="walkthrough-lib-title">Library</h3>
					<ul className="walkthrough-list">
						{lib.items.map((r) => (
							<li key={r.id}>
								<button type="button" onClick={() => onPlay(r)}>
									<span className="walkthrough-play" aria-hidden="true">
										<svg width="12" height="12" viewBox="0 0 12 12">
											<path d="M3 1.5v9l7.5-4.5z" fill="currentColor" />
										</svg>
									</span>
									<span className="walkthrough-meta">
										<strong>{r.title}</strong>
										<span>
											{r.authorName} · {clock(r.durationMs)}
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	);
}

/** After recording: watch it back, name it, and save it to the board. */
export function SaveTakeDialog({
	take,
	boardId,
	defaultTitle,
	onSaved,
	onClose,
}: {
	take: Take;
	boardId: string;
	defaultTitle: string;
	onSaved: () => void;
	onClose: () => void;
}) {
	const [title, setTitle] = useState(defaultTitle);
	const [progress, setProgress] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [url] = useState(() => URL.createObjectURL(take.blob));
	useEffect(() => () => URL.revokeObjectURL(url), [url]);

	const save = () => {
		if (take.blob.size > MAX_BYTES) {
			setError("This recording is too large to save. Try a shorter walkthrough.");
			return;
		}
		// XHR rather than fetch, for upload progress
		const xhr = new XMLHttpRequest();
		const q = new URLSearchParams({ title: title.trim() || defaultTitle, duration: String(Math.round(take.durationMs)) });
		xhr.open("POST", `/api/boards/${boardId}/recordings?${q}`);
		xhr.setRequestHeader("Content-Type", take.type);
		xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
		xhr.onload = () => {
			if (xhr.status === 201) {
				onSaved();
				return;
			}
			let message = "Couldn't save the walkthrough. Try again.";
			try {
				message = JSON.parse(xhr.responseText).error ?? message;
			} catch {
				// Keep the generic message
			}
			setError(message);
			setProgress(null);
		};
		xhr.onerror = () => {
			setError("Couldn't reach the server. Check your connection and try again.");
			setProgress(null);
		};
		setError(null);
		setProgress(0);
		xhr.send(take.blob);
	};

	return (
		<Dialog title="Save walkthrough" labelledBy="take-title" onClose={progress === null ? onClose : () => {}} className="video-dialog">
			<video className="video-frame" src={url} controls playsInline />
			<label className="field">
				<span>Title</span>
				<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} disabled={progress !== null} />
			</label>
			<p className="dialog-note">
				{clock(take.durationMs)} · {(take.blob.size / 1024 / 1024).toFixed(1)} MB · Anyone who can open this board can watch it.
			</p>
			{error && <p className="dialog-note dash-error">{error}</p>}
			<div className="dialog-actions">
				<button type="button" className="ghost-btn" onClick={onClose} disabled={progress !== null}>
					Discard
				</button>
				<button type="button" className="primary-btn" onClick={save} disabled={progress !== null}>
					{progress === null ? "Save to board" : `Saving ${Math.round(progress * 100)}%`}
				</button>
			</div>
		</Dialog>
	);
}

/** Watch a saved walkthrough. */
export function PlayerDialog({
	recording,
	onDeleted,
	onClose,
}: {
	recording: Recording;
	onDeleted: () => void;
	onClose: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const remove = async () => {
		const res = await fetch(`/api/recordings/${recording.id}`, { method: "DELETE" });
		if (res.ok) onDeleted();
		else setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't delete it.");
	};
	return (
		<Dialog title={recording.title} labelledBy="player-title" onClose={onClose} className="video-dialog">
			<video className="video-frame" src={`/api/recordings/${recording.id}`} controls autoPlay playsInline />
			<p className="dialog-note">
				{recording.authorName} · {clock(recording.durationMs)} ·{" "}
				{new Date(recording.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
			</p>
			{error && <p className="dialog-note dash-error">{error}</p>}
			{recording.canDelete && (
				<div className="dialog-actions">
					{confirming ? (
						<>
							<span className="muted">Delete this walkthrough for everyone?</span>
							<button type="button" className="ghost-btn" onClick={() => setConfirming(false)}>
								Keep
							</button>
							<button type="button" className="danger-btn" onClick={remove}>
								Delete
							</button>
						</>
					) : (
						<button type="button" className="text-btn danger-link" onClick={() => setConfirming(true)}>
							Delete walkthrough
						</button>
					)}
				</div>
			)}
		</Dialog>
	);
}
