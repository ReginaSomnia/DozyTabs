import type { PageState } from "@/core/messages";

export type ButtonActions = {
	getState(): Promise<PageState | null>;
	setKeepAwake(keepAwake: boolean): Promise<void>;
	sleepAll(): Promise<number | null>;
	openOptions(): Promise<void>;
	text(key: string, substitutions?: string[]): string;
};

const HOST_ID = "dozy-tabs-button";
const BUTTONS_SELECTOR = "ytd-masthead #end #buttons";
const SVG_NS = "http://www.w3.org/2000/svg";

type Shape = [tag: "path" | "circle", className: "line" | "dot", attributes: Record<string, string>];

const CRESCENT: Shape = ["path", "line", { d: "M9.62 5.12A8 8 0 1 0 18.88 14.38A7 7 0 0 1 9.62 5.12Z" }];
const MOON: Shape[] = [
	CRESCENT,
	["circle", "dot", { cx: "18.5", cy: "4.5", r: "1.1" }],
	["circle", "dot", { cx: "21", cy: "9", r: "0.9" }],
];
const MOON_SLASHED: Shape[] = [CRESCENT, ["path", "line", { d: "M3.5 3.5l17 17" }]];
const SLIDERS: Shape[] = [
	["path", "line", { d: "M4 7h9M19 7h1M4 17h3M13 17h7" }],
	["circle", "line", { cx: "16", cy: "7", r: "2.25" }],
	["circle", "line", { cx: "10", cy: "17", r: "2.25" }],
];

// Sizes and colors copy YouTube's own top bar buttons and menus. YouTube
// already renamed its color variables once (--yt-spec-* went away), so the
// button keeps its own copy of both themes and follows <html dark> instead
const STYLE = `
:host {
	display: inline-flex; position: relative; margin-right: 8px;
	--text: #0f0f0f; --text-secondary: #606060; --menu: #fff; --hover: rgba(0, 0, 0, 0.1);
	--pressed: rgba(0, 0, 0, 0.2); --track: #909090; --accent: #065fd4; --shadow: rgba(0, 0, 0, 0.1);
}
:host([dark]) {
	--text: #f1f1f1; --text-secondary: #aaa; --menu: #282828; --hover: rgba(255, 255, 255, 0.1);
	--pressed: rgba(255, 255, 255, 0.2); --track: #717171; --accent: #3ea6ff; --shadow: rgba(0, 0, 0, 0.5);
}
* { box-sizing: border-box; }
svg { width: 24px; height: 24px; display: block; flex: none; }
.line { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.dot { fill: currentColor; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
.toggle {
	width: 40px; height: 40px; border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	color: var(--text);
}
.toggle:hover { background: var(--hover); }
.toggle:active, .toggle[aria-expanded="true"] { background: var(--pressed); }
.toggle.off { opacity: 0.5; }
.tip {
	position: absolute; top: 48px; left: 50%; transform: translateX(-50%);
	padding: 8px; border-radius: 4px; white-space: nowrap; pointer-events: none;
	background: rgba(97, 97, 97, 0.92); color: #fff;
	font: 12px/1.33 "Roboto", "Arial", sans-serif;
	opacity: 0; transition: opacity 0.1s;
}
.toggle:hover + .tip { opacity: 1; transition-delay: 0.5s; }
.toggle[aria-expanded="true"] + .tip { display: none; }
.menu {
	position: absolute; top: 44px; right: 0; z-index: 2300; width: 300px;
	padding: 8px 0; border-radius: 12px;
	background: var(--menu);
	color: var(--text);
	box-shadow: 0 4px 32px 0 var(--shadow);
	font-family: "Roboto", "Arial", sans-serif;
}
.head { display: flex; gap: 16px; align-items: center; padding: 8px 16px 12px; }
.head svg { width: 40px; height: 40px; }
.title { font-size: 16px; line-height: 22px; font-weight: 500; }
.status { font-size: 14px; line-height: 20px; color: var(--text-secondary); }
hr { border: 0; border-top: 1px solid var(--hover); margin: 8px 0; }
.item {
	display: flex; align-items: center; gap: 16px; width: 100%; min-height: 40px; padding: 8px 16px;
	font-size: 14px; line-height: 20px; text-align: left;
}
.item:hover, .item:focus-visible { background: var(--hover); outline: none; }
.label { flex: 1; }
.switch { position: relative; width: 36px; height: 14px; flex: none; border-radius: 7px; background: var(--track); }
.switch::after {
	content: ""; position: absolute; top: -3px; left: -2px; width: 20px; height: 20px; border-radius: 50%;
	background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); transition: left 0.15s;
}
[aria-checked="true"] .switch { background: var(--accent); opacity: 0.6; }
[aria-checked="true"] .switch::after { left: 18px; background: var(--accent); }
[hidden] { display: none !important; }
`;

function icon(doc: Document, shapes: Shape[]): SVGSVGElement {
	const svg = doc.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	for (const [tag, className, attributes] of shapes) {
		const shape = doc.createElementNS(SVG_NS, tag);
		shape.setAttribute("class", className);
		for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
		svg.append(shape);
	}
	return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(
	doc: Document,
	tag: K,
	className: string,
	...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
	const node = doc.createElement(tag);
	if (className) node.className = className;
	node.append(...children);
	return node;
}

export function mountTopBarButton(doc: Document, actions: ButtonActions): () => void {
	const name = actions.text("extName");
	const host = doc.createElement("div");
	host.id = HOST_ID;
	const root = host.attachShadow({ mode: "open" });

	const toggle = element(doc, "button", "toggle");
	toggle.setAttribute("aria-label", name);
	toggle.setAttribute("aria-haspopup", "menu");
	toggle.setAttribute("aria-expanded", "false");
	const tip = element(doc, "div", "tip", name);
	tip.setAttribute("role", "tooltip");

	const status = element(doc, "div", "status");
	const keep = element(
		doc,
		"button",
		"item",
		icon(doc, MOON_SLASHED),
		element(doc, "span", "label", actions.text("keepAwake")),
		element(doc, "span", "switch"),
	);
	keep.setAttribute("role", "menuitemcheckbox");
	const sleepAll = element(
		doc,
		"button",
		"item",
		icon(doc, MOON),
		element(doc, "span", "label", actions.text("sleepAllIdle")),
	);
	sleepAll.setAttribute("role", "menuitem");
	const settings = element(
		doc,
		"button",
		"item",
		icon(doc, SLIDERS),
		element(doc, "span", "label", actions.text("settings")),
	);
	settings.setAttribute("role", "menuitem");

	const heading = element(doc, "div", "", element(doc, "div", "title", name), status);
	const menu = element(
		doc,
		"div",
		"menu",
		element(doc, "div", "head", icon(doc, MOON), heading),
		element(doc, "hr", ""),
		keep,
		sleepAll,
		element(doc, "hr", ""),
		settings,
	);
	menu.setAttribute("role", "menu");
	menu.hidden = true;

	const style = element(doc, "style", "", STYLE);
	root.append(style, toggle, tip, menu);

	let state: PageState | null = null;

	function render(): void {
		const keptAwake = state?.keepAwake ?? false;
		toggle.replaceChildren(icon(doc, keptAwake ? MOON_SLASHED : MOON));
		toggle.classList.toggle("off", state?.enabled === false);
		keep.setAttribute("aria-checked", String(keptAwake));
		if (!state) status.textContent = "";
		else if (!state.enabled) status.textContent = actions.text("pageStatusOff");
		else status.textContent = actions.text(keptAwake ? "pageStatusKeptAwake" : "pageStatusCanSleep");
	}

	async function refresh(): Promise<void> {
		state = await actions.getState();
		render();
	}

	function close(): void {
		menu.hidden = true;
		toggle.setAttribute("aria-expanded", "false");
	}

	toggle.addEventListener("click", () => {
		if (!menu.hidden) {
			close();
			return;
		}
		menu.hidden = false;
		toggle.setAttribute("aria-expanded", "true");
		void refresh();
	});

	// The page can access this shadow root and dispatch synthetic clicks.
	// Only browser-generated interaction may invoke extension actions.
	keep.addEventListener("click", async (event) => {
		if (!event.isTrusted) return;
		await actions.setKeepAwake(!(state?.keepAwake ?? false));
		await refresh();
	});

	sleepAll.addEventListener("click", async (event) => {
		if (!event.isTrusted) return;
		const count = await actions.sleepAll();
		if (count === null) return;
		if (count === 0) status.textContent = actions.text("pageSleptNone");
		else if (count === 1) status.textContent = actions.text("pageSleptOne");
		else status.textContent = actions.text("pageSleptMany", [String(count)]);
	});

	settings.addEventListener("click", (event) => {
		if (!event.isTrusted) return;
		close();
		void actions.openOptions();
	});

	const onPointerDown = (event: Event) => {
		if (!menu.hidden && !event.composedPath().includes(host)) close();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape" && !menu.hidden) {
			close();
			toggle.focus();
		}
	};
	// the popup or the right-click menu can change the state while I'm away
	const onVisible = () => {
		if (doc.visibilityState === "visible") void refresh();
	};
	doc.addEventListener("pointerdown", onPointerDown, true);
	doc.addEventListener("keydown", onKeyDown, true);
	doc.addEventListener("visibilitychange", onVisible);

	// YouTube builds the top bar after the page loads and sometimes rebuilds it
	// on navigation, so keep putting the button back until the page goes away
	const place = () => {
		if (host.isConnected) return;
		doc.querySelector(BUTTONS_SELECTOR)?.prepend(host);
	};
	const observer = new MutationObserver(place);
	observer.observe(doc.documentElement, { childList: true, subtree: true });
	place();

	const matchTheme = () => {
		host.toggleAttribute("dark", doc.documentElement.hasAttribute("dark"));
	};
	const themeObserver = new MutationObserver(matchTheme);
	themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ["dark"] });
	matchTheme();
	void refresh();

	return () => {
		observer.disconnect();
		themeObserver.disconnect();
		doc.removeEventListener("pointerdown", onPointerDown, true);
		doc.removeEventListener("keydown", onKeyDown, true);
		doc.removeEventListener("visibilitychange", onVisible);
		host.remove();
	};
}
