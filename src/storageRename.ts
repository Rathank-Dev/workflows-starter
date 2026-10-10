/**
 * Browser storage used to be named "linework:…" (the app's old name). Move
 * anything saved under the old names to "flowyard:…" once, keeping a newer
 * value if both exist, so saved boards and settings carry over.
 */
const OLD = "linework:";
const NEW = "flowyard:";

export function renameLegacyStorage() {
	try {
		for (const key of Object.keys(localStorage)) {
			if (!key.startsWith(OLD)) continue;
			const target = NEW + key.slice(OLD.length);
			const value = localStorage.getItem(key);
			if (value !== null && localStorage.getItem(target) === null) localStorage.setItem(target, value);
			localStorage.removeItem(key);
		}
	} catch {
		// Storage blocked or full: the old keys stay, and nothing is lost
	}
}
