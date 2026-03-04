# Patient Flutter App (ZEGO)

Flutter patient-side app for joining a telemedicine room without Safari media limitations.

This app does **not** replace existing web flow. It is added as an additional channel for patient testing.

## What this app does

- Accepts a patient invite link from doctor UI (`/patient/join?meeting_id=...&invite_token=...`)
- Calls backend endpoint `POST /meetings/video/patient/token`
- Joins ZEGO conference room with patient display name and media preferences

## Prerequisites

- Flutter SDK installed on your machine
- Backend API running and reachable from phone via LAN IP

For iPhone build/run, you still need macOS + Xcode.
For Windows flow below, target is Android.

## First-time bootstrap

From repository root:

```bash
./scripts/bootstrap-patient-flutter.sh
```

That command will:

- Generate missing Flutter platform files (`ios`, `android`) if needed
- Run `flutter pub get`

## Run on iPhone

```bash
cd mobile/patient_flutter_app
flutter run \
  --dart-define=ZEGO_APP_ID=1477525628 \
  --dart-define=ZEGO_APP_SIGN=<YOUR_ZEGO_APP_SIGN> \
  --dart-define=TELEMED_API_BASE_URL=http://192.168.1.219:8000
```

Notes:

- Use `TELEMED_API_BASE_URL` as LAN IP (not `localhost`) for physical iPhone.
- `ZEGO_APP_SIGN` should be your project AppSign from ZEGO console.

## Windows quick start (Android)

1) Bootstrap project:

```powershell
cd C:\path\to\telemed-monorepo
powershell -ExecutionPolicy Bypass -File .\scripts\windows\bootstrap-patient-flutter.ps1
```

2) Create local defines file:

```powershell
copy .\mobile\patient_flutter_app\config\dart_defines.example.json .\mobile\patient_flutter_app\config\dart_defines.local.json
```

Edit `dart_defines.local.json` and set real values for:

- `ZEGO_APP_SIGN`
- `TELEMED_API_BASE_URL`

3) Run on Android device/emulator:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\run-patient-flutter.ps1
```

4) Build installable APK:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\build-patient-apk.ps1
```

5) Install APK to connected Android phone:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-patient-apk.ps1
```

## App usage flow

1. Paste `Invite link` copied from doctor call page.
2. Enter patient display name.
3. Toggle camera/mic on/off before joining.
4. Tap `Join Call`.

## Current architecture choice

This starter uses `zego_uikit_prebuilt_video_conference` for speed of integration.

- Fast to validate real mobile call flow now.
- For stricter server-side token-only auth on mobile, next step is a custom client using `zego_express_engine` and backend-issued ZEGO token as the primary auth source.
