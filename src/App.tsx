import { Editor } from "./board/Editor";

function boardIdFromUrl(): string {
	const id = new URLSearchParams(window.location.search).get("board") ?? "main";
	return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : "main";
}

function App() {
	return <Editor boardId={boardIdFromUrl()} />;
}

export default App;
