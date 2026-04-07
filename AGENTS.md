call serena activate_project 
call serena-check_onboarding_performed
call serena-initial_instructions


IMPORTANT: When debugging, prefer using intellij-debugger MCP tools to interact with the IDE debugger.
IMPORTANT: When applicable, prefer using intellij-index MCP tools for code search 

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
