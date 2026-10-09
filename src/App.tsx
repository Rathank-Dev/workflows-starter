import { lazy, Suspense, useEffect, useState } from "react";
import { boardPath } from "./board/linkKey";
import { CookieBanner } from "./consent";
import { useSession } from "./session";

// One chunk per page, so the homepage doesn't download the board editor.
const Editor = lazy(() => import("./board/Editor").then((m) => ({ default: m.Editor })));
const Dashboard = lazy(() => import("./dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
const Profile = lazy(() => import("./dashboard/Profile").then((m) => ({ default: m.Profile })));
const Landing = lazy(() => import("./landing/Landing").then((m) => ({ default: m.Landing })));
const NotFound = lazy(() => import("./notfound/NotFound").then((m) => ({ default: m.NotFound })));
const Privacy = lazy(() => import("./privacy/Privacy").then((m) => ({ default: m.Privacy })));

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
			onShared={(id, key) => {
				window.history.pushState(null, "", boardPath(id, key));
				setJustShared(true);
				setBoardId(id);
			}}
		/>
	);
}

function SessionPage({ page }: { page: "dashboard" | "profile" }) {
	const session = useSession();
	useEffect(() => {
		document.title = page === "dashboard" ? "Your boards · Flowyard" : "Profile · Flowyard";
	}, [page]);
	return page === "dashboard" ? <Dashboard session={session} /> : <Profile session={session} />;
}

function Page() {
	const path = window.location.pathname.replace(/\/+$/, "");
	if (isBoardRoute()) return <BoardApp />;
	if (path === "/dashboard") return <SessionPage page="dashboard" />;
	if (path === "/profile") return <SessionPage page="profile" />;
	if (path === "") return <Landing />;
	if (path === "/privacy") return <Privacy />;
	return <NotFound />;
}

function App() {
	return (
		<>
			<Suspense fallback={null}>
				<Page />
			</Suspense>
			<CookieBanner />
		</>
	);
}

export default App;
