# Mobile app (not started)

Planned: React Native with Expo, sharing types and logic with `@wm/shared`.

The mobile app is a separate product from the desktop web app. It is built for
triage, approvals, quick capture, timers and offline use, not as a smaller copy
of the desktop UI. See `docs/adr/0001-stack.md`.

Before starting:

- iOS builds need macOS with Xcode, or a hosted build service such as Expo EAS.
  Cloud Claude Code sessions run on Linux and cannot build or run iOS apps.
- Version the sync protocol before the first release: released app versions
  stay on people's phones and must keep working when the API changes.
