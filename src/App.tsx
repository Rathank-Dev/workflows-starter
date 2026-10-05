import { useEffect, useState } from "react";
import { Editor } from "./board/Editor";
import { Landing } from "./landing/Landing";
import { useSession } from "./session";

/** Shared boards have a 32-character hex id in ?board=. Anything else is the browser-only board. */
function boardIdFromUrl(): string | null {
	const id = new URLSearchParams(window.location.search).get("board");
	return id && /^[a-f0-9]{32}$/.test(id) ? id : null;
}

// Links from before the board moved to /board ("/?board=…") still work.
if (window.location.pathname === "/" && new URLSearchParams(window.location.search).has("board")) {
	window.history.replaceState(null, "", `/board${window.location.search}${window.location.hash}`);
}

function isBoardRoute() {
	return window.location.pathname === "/board" || window.location.pathname.startsWith("/board/");
}

function BoardApp() {
	const session = useSession();
	const [boardId, setBoardId] = useState(boardIdFromUrl);
	const [justShared, setJustShared] = useState(false);

	useEffect(() => {
		const onPop = () => {
			setJustShared(false);
			setBoardId(boardIdFromUrl());
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	return (
		<Editor
			key={boardId ?? "local"}
			boardId={boardId}
			session={session}
			justShared={justShared}
			onShared={(id) => {
				window.history.pushState(null, "", `/board?board=${id}`);
				setJustShared(true);
				setBoardId(id);
			}}
		/>
	);
}

function App() {
	return isBoardRoute() ? <BoardApp /> : <Landing />;
}

export default App;
