# VidLift desktop

The VidLift app for Windows and Mac: its window, tray icon and install wizard.
It installs VidLift (from the private releases, with a licence key and a GitHub
sign-in) and then runs it; the video pipeline itself is not in this repository.

```bash
npm install
npm start          # build, then run the app from source
npm test           # unit tests (after npm run build:main)
npm run dist:win   # release/VidLift-Setup.exe  (dist:mac makes release/VidLift.dmg on a Mac)
```

Pushing a `desktop-v<version>` tag builds both installers on GitHub Actions.
