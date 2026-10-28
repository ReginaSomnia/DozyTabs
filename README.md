# Dozy Tabs

A browser extension that puts idle YouTube tabs to sleep, stopping them from using memory and CPU in the background, because YouTube has that habit of not disabling its tabs ever. Keeping lots of YouTube tabs in a few windows can be too much, because the browser's native implementation to put inactive tabs to sleep is ignoring YouTube as it's constantly changing the title and favicon of the tab (at least on Chrome that keeps it active, it might have something else working there, maybe a worker, maybe something, that could keep it alive even without that... I need to investigate a bit more)

Dozy Tabs uses the browser's own tab discarding, sleeping tabs keeps their title and URL, and reloads when you click them. When you come back, the video should pick up at the same spot, tho... so that's nice to have just in case you paused something and forgot about it

## Current features

- Paused or finished videos in background tabs go to sleep in 30 minutes (you can set the timer to whatever you want, up to a day)
- Videos opened in the background (middle click, open in new tab, etc) go to sleep a couple of seconds after they load
- Coming back to a sleeping tab, should reload the video at the right time with the `t=` param in the url (except if it's a short)
    - Although for livestreams, it should come back without timestamp to go at live, livestreams are trickier
- We keep awake:
    - Active tab in each window
    - Anything playing, muted or not
    - Pinned tabs
    - YouTube Music videos (because that's the point of background music after all)
    - Tabs where you wrote a comment but didn't submit it yet
    - Every tab while you're offline (off by default), because it could mess up with your videos if you just lost connection for half an hour or so
- The popup shows how many YouTube tabs are asleep, idle and playing. It has a sleep all idle button, a keep-awake toggle for the current tab, and an on/off switch to disable/enable the extension globally
- The right-click menu on a YouTube tab has the per-tab keep-awake toggle and the sleep all idle YouTube tabs button, just in case
- Settings sync between computers through your browser account (if you have it configured, that is)
- After a browser restart, YouTube tabs that aren't active go to sleep immediately
    - The active one in each window stays awake, but if its video starts playing by itself, it gets paused (you can turn this off)

So far it's been tested on Chromium and Firefox, both with end-to-end tests on YouTube (see [Development](#development)), but the restart behaviour still needs more checking on everywhere. Also, it should work in all Chromium-based (Chrome, Edge, Vivaldi, Brave, etc) and Firefox-based (Zen, Librewolf, etc) browsers, but again, it should be tested

It only asks for access to youtube.com for now, so there's no "read your browsing history" warning at install. Still, the whole thing is designed having in mind that we could use it for more domains, but for now I keep it for the worst offender, which is YouTube

## Privacy

Dozy Tabs doesn't collect, send or sell anything. There's no analytics, no tracking and no server, it never makes a network request of its own. It looks at YouTube pages only to know if a video is playing, where it's at, and if there's a comment you didn't send yet, and none of that leaves your browser. The settings are saved in the browser's own storage, and if you have sync turned on, your browser syncs them between your computers like with any other extension

All the code is here, so you can check it yourself

## Install

It's not on the extension stores yet, for now you have to build it from source. You'll need [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io) (you could use npm, too, I just switched to pnpm when the full supply-chain boom started... but that would use whatever versions you get from the packages resolved that day, instead of what I used)

```sh
pnpm install
pnpm build          # Chrome, Edge, Vivaldi, Brave and other Chromium-based browsers (Chromium included)
pnpm build:firefox  # Firefox, Zen, Librewolf, and other Firefox-based browsers
```

**Chromium family:** open `chrome://extensions` (or `BROWSER_OWN_SCHEME://extensions`, each browser can change it sometimes, although MAYBE `chrome://` will resolve into `edge://`, `vivaldi://`, etc... didn't check it yet, tho), turn on developer mode, click `Load unpacked` and pick the `.output/chrome-mv3` folder

**Firefox:** open `about:debugging#/runtime/this-firefox`, click `Load Temporary Add-on` and pick `.output/firefox-mv3/manifest.json`. Firefox removes temporary add-ons when closed, so you'll need to load it again after a restart (sorry, when I publish it into the extension stores, it will be easier...)

The settings are in the popup's settings link, or in the extension's options from the extensions page

## Development

```sh
pnpm dev            # Chrome with live reload
pnpm dev:firefox    # same on Firefox
pnpm test           # unit tests
pnpm test:e2e       # end-to-end tests on Chromium
pnpm test:e2e:firefox  # same on Firefox
pnpm typecheck
pnpm format
pnpm release        # build the store zips and upload them, with the keys from `pnpm exec wxt submit init`
```

### End-to-end tests

They open YouTube in a real browser via Playwright, building the browser's extension first. The browsers go into `e2e/browsers` (gitignored), so before the first run do the following:

```sh
pnpm e2e:install
```

That downloads Playwright's Chromium and the latest Firefox release from Mozilla. The Firefox part only works on Windows for now (but I'll do the same system agnostic soon-ish, I was just on my Windows while making this, but it should be easily adaptable to any Linux distro), it grabs the installer from [archive.mozilla.org](https://archive.mozilla.org/pub/firefox/releases/), checks it against Mozilla's `SHA256SUMS` and unpacks it without installing anything. To do it by hand, download `Firefox Setup <version>.exe` from there and run

```sh
"Firefox Setup <version>.exe" /ExtractDir=<repo>\e2e\browsers\firefox
```

So `firefox.exe` ends up in `e2e\browsers\firefox\core` with that. Playwright's own Firefox can't be used here, it always reports pages as visible, even in background tabs, and unfortunately that's what the extension checks

Profiles and temp files stay inside `e2e/` (if you follow this steps), but the browsers still write a few things of their own outside it, just FYI. It's inside the project folders mostly for an easier cleanup, but on Windows it writes some registry keys

## License

MIT, see [LICENSE](LICENSE)
