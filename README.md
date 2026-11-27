# Expences

Personal expense tracker for iPhone (UAE / AED). Apple Pay taps are logged
automatically through an iOS Shortcuts "Transaction" automation, so you never
have to type in card payments.

## How auto-logging works

```
Apple Pay tap → Wallet → Shortcuts "Transaction" automation
             → opens expences://add?auto=1&merchant=…&amount=…&card=…
             → app saves the expense (even if it was closed)
```

iOS does not let apps read Apple Pay / NFC directly; Shortcuts is the only bridge.
Setup steps are inside the app (Home → "Set up auto-logging for Apple Pay taps").

## Features

- Automatic logging of Apple Pay payments (merchant, amount, card)
- Automatic categories for common UAE merchants (Carrefour, ENOC, Careem, DEWA, Talabat…)
- Month-by-month view with totals per category, plus a monthly history screen
- Add, edit and delete expenses manually (tap to edit, long-press to delete)
- Export a month as CSV (••• menu)
- Clear one month or all history (••• menu)
- All data stays on the phone (SQLite, no account, no server)

## Accounts and sign-in

Users create an account with **email and password**, and sign in with email and password, **Apple** or
**Google** (Apple and Google appear only on the Sign in tab; a first Apple/Google sign-in creates the account).
The app sends the provider's ID token to the backend (`../MY-EXPENCES-BACKEND`), which returns its own
access token (15 min, kept in memory) and refresh token (single use, rotated, kept in the iOS Keychain).
Expenses still live only on the phone; the Apple Pay automation writes them even while signed out.

### Sign-in setup

1. **Backend**: run it (`npm run start:dev` in `MY-EXPENCES-BACKEND`). The simulator reaches it at
   `http://localhost:3000`; set the production URL as `API_URL` in `.env` (copy `.env.example`).
2. **Apple**: the entitlement is in `ios/Expences/Expences.entitlements`. In the Apple Developer portal,
   enable *Sign in with Apple* for the App ID `com.arunjith.expences` (Xcode's automatic signing does this
   when you build to a device). The backend already accepts this bundle ID (`APPLE_CLIENT_IDS`).
3. **Google** (Google Cloud Console → APIs & Services → Credentials):
   - Create an OAuth client of type **Web application** → put its ID in `.env`
     (`GOOGLE_WEB_CLIENT_ID`) and in the backend's `.env` (`GOOGLE_CLIENT_IDS`).
   - Create an OAuth client of type **iOS** with bundle ID `com.arunjith.expences` → put its ID in
     `.env` (`GOOGLE_IOS_CLIENT_ID`), and add its *reversed* form
     (`com.googleusercontent.apps.XXXX`) as a URL scheme in `ios/Expences/Info.plist` under
     `CFBundleURLTypes`.
   - For Android, also create an **Android** client with your signing key's SHA-1.
4. Set `TERMS_URL` and `PRIVACY_POLICY_URL` in `.env` (the App Store requires a privacy policy).

The account screen (tap your avatar on the dashboard) has sign out and **Delete account**, which the
App Store requires for apps with sign-in.

## Development

Requirements: Node ≥ 22, Yarn, Xcode, CocoaPods.

```sh
yarn install
cd ios && pod install && cd ..
yarn ios                                   # simulator, debug
yarn ios --device                          # connected iPhone, debug
yarn ios --mode Release --device           # connected iPhone, release (no Metro needed)
yarn test && yarn lint && npx tsc --noEmit # checks
```

Test auto-logging on the simulator:

```sh
xcrun simctl openurl booted 'expences://add?auto=1&merchant=CARREFOUR%20MOE&amount=AED%2042.50&card=ENBD'
```

## Project layout

```
App.tsx                 navigation, deep-link config, error handling
src/lib/db.ts           SQLite (op-sqlite) schema and queries
src/lib/parse.ts        amount/currency parsing, merchant → category rules
src/lib/months.ts       month keys and date ranges
src/screens/            Home, Add/Edit, Monthly history, Setup guide
__tests__/              unit tests
```

## Release

- Bundle ID: `com.arunjith.expences` (change in Xcode → Signing & Capabilities if needed)
- Set your Apple Developer team in Xcode → Signing & Capabilities
- Free Apple ID: installs expire after 7 days. Paid account: TestFlight / App Store.
