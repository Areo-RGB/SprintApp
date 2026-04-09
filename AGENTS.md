## Code Exploration Policy
Always use jCodemunch-MCP tools — never fall back to Read, Grep, Glob, or Bash for code exploration.
- Before reading a file: use get_file_outline or get_file_content
- Before searching: use search_symbols or search_text
- Before exploring structure: use get_file_tree or get_repo_outline
- Call resolve_repo with the current directory first; if not indexed, call index_folder.
- Call get_session_stats at end 


IMPORTANT: After any file edit, immediately refresh jCodemunch context for changed files (use `register_edit` with `reindex=true`, or `index_file`) before further symbol reads/patching to avoid stale tool results.

## Release & In-App Updater Process

This project includes an in-app auto-updater for Android that does not rely on the Play Store.
The updater checks the GitHub Releases API (`Areo-RGB/SprintApp`) on app launch to see if a newer version is available.
* The GitHub Release **tag name** must match the format `v<versionCode>` (e.g., `v4` for `versionCode = 4`).
* The release must contain the compiled `app-release.apk` as an attached asset.

### Creating a New Release

To automatically bump the version, build the release APK, commit the changes, push to the remote repository, and publish a new GitHub Release, simply run:
```bash
npm run release:android
```
*(Note: This requires the GitHub CLI `gh` to be installed and authenticated via `gh auth login`)*

### Testing Release Builds Locally

If you need to deploy the release APK directly to connected ADB devices (bypassing the auto-updater for testing purposes):
```bash
# Build and deploy the release APK
npm run rebuild:release:devices:adb

# Or, if the release APK is already built, just deploy it:
npm run install:release:devices:adb
```

