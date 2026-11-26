# Frontier Fieldbook | RDR2

An unofficial public, browser-based companion for Red Dead Redemption 2. The original Fieldbook design, chapter 1–3 guides, controls, artwork, journal, discoveries, gallery and profile are included.

## Publish with GitHub Pages

Open repository **Settings → Pages → Build and deployment → Deploy from a branch**. Choose **main**, **/ (root)** and Save. After GitHub deploys, use the URL shown under Pages (expected: https://rbndchsn.github.io/frontier_fieldbook/). This setting is separate from committing files.

## Public journal and dashboard

Visitors can read the guide and public data with no account. On the hosted page, the app reads the latest `data/state.json` from the GitHub API, or the deployed snapshot if the anonymous API is temporarily unavailable. All dashboard data is deliberately public, including earlier versions in Git history. Do not include credentials or private personal details.

### One-time token creation; reconnect on each session

Create a fine-grained personal access token at https://github.com/settings/personal-access-tokens/new. Select only **rbndchsn/frontier_fieldbook**, grant **Contents: Read and write** and leave Metadata read access enabled. Choose a short expiration. Never send the token in chat or store it in Git. In the web app, select **Character & backups → GitHub editor access**, paste the token in the password field, acknowledge public data and connect. The token remains in memory until reload/close/disconnect. It authenticates requests to the GitHub Contents API. Read access is checked on connection; write permission is exercised on the first save. Revoke the token if needed.

### Daily use

Journal entries, mission checkboxes, notes, photos, objectives, character profile and imports all pass through the same save operation. A successful write updates `data/state.json` and creates a Git commit. The current blob SHA is required, so an intervening change rejects a stale save rather than silently overwriting another edit. Refresh published data before retrying. The full JSON state is limited to 900 KB, including photos. Export backups periodically. Public viewers have no write credentials. The frontend has no embedded token or external JS library. A connected token is accessible to JavaScript executing in the origin, so review code changes before connecting.

### Migrate your original browser entries

Open the original Google Drive Fieldbook bookmark, use Character & backups → Download complete JSON backup, then connect as editor on the hosted site and choose Restore / import backup. Import replaces the current public snapshot after confirmation and commits it. Export first if there are already remote entries you need to keep. The original browser's local storage is not available to a different website origin. The initial public data file is empty because the Drive copy contains no live state.

## Local use

The original local server and launch scripts are retained for reference. Prefer the existing Drive copy for independent offline work. File mode stores data in the browser; local server mode uses JSON on disk. Do not serve or edit the working Git clone locally at the same time as remote writes without managing conflicts. The GitHub site does not modify game saves.

All Markdown sources are in content/; build_content.py regenerates content.js (see the script's dependency requirements). Reference updates should not overwrite data/state.json. Original artwork is illustrative rather than an official gameplay screenshot.
