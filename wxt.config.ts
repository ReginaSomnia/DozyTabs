import { defineConfig } from "wxt";

export default defineConfig({
	srcDir: "src",
	imports: false,
	manifestVersion: 3,
	manifest: ({ browser }) => ({
		name: "__MSG_extName__",
		description: "__MSG_extDescription__",
		default_locale: "en",
		permissions: ["storage", "alarms", "scripting", "contextMenus"],
		host_permissions: ["*://*.youtube.com/*"],
		...(browser === "firefox" && {
			browser_specific_settings: {
				gecko: {
					id: "dozy-tabs@reginaprojects",
					strict_min_version: "127.0",
					data_collection_permissions: {
						required: ["none"],
					},
				},
			},
		}),
	}),
});
