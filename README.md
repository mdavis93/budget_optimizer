# Budget Optimizer

A secure desktop application for managing income, tracking bills, and optimizing payment schedules to avoid budget shortfalls.

## Features

- **Secure Data Storage**: Financial records are encrypted at rest using AES-256-GCM
- **Master Password Protection**: Your data is protected by a master password with PBKDF2 key derivation (310,000 iterations)
- **Biometric Unlock**: Support for Touch ID (macOS) and Windows Hello for quick, secure access
- **Auto-Lock**: Automatically locks after configurable inactivity; resets on user activity
- **Income Management**: Track multiple income sources with various payment cadences (weekly, bi-weekly, semi-monthly, monthly)
- **Bill Tracking**: Manage recurring bills with priority levels and categories
- **Payment Scheduling**: Generates payment schedules with rebalance recommendations to reduce shortfalls — heuristic, not guaranteed zero shortfalls
- **Visual Dashboard**: Overview of your financial health with balance projections
- **Export Options**: Export schedules to PDF, HTML, or spreadsheet formats

## Tech Stack

- **Framework**: Electron 28+
- **UI**: React 18, TypeScript, Tailwind CSS
- **Local Database**: SQLite with encrypted data storage
- **Encryption**: Node.js crypto module (AES-256-GCM, PBKDF2)
- **Charts**: Recharts
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/budget-optimizer.git
cd budget-optimizer
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run electron:dev
```

### Building for Production

```bash
npm run electron:build
```

This will create distributable packages in the `release` directory.

### Troubleshooting

#### "Failed to initialize database" / NODE_MODULE_VERSION mismatch

Native modules must be compiled for the bundled Electron version. If unlock fails with a message like `compiled against a different Node.js version using NODE_MODULE_VERSION 119` while Electron requires `130`:

```bash
pnpm install
pnpm run electron:build
```

Launch the app from the **new** build in `release/` (not an older copy). The build should end with `Packaged SQLite verification passed.` The post-build SQLite check runs headlessly — it should not open the app window.

Use `pnpm run electron:build` for production packages — not `pnpm run build`, which skips native dependency sync steps.

For local development, `pnpm test*` / `pnpm electron:dev` / `pnpm test:e2e` auto-swap the `better-sqlite3` ABI via `scripts/use-native.cjs` (always load-probes under the target runtime; refreshes a cache marker only after a successful probe). If a swap looks stuck, delete `.cache/native/` and re-run. Always use the `pnpm` scripts (bare `vitest` / `playwright` skip the helper).

#### Repeated macOS Keychain prompts after rebuilding

After each rebuild, macOS may ask for Keychain access again until you choose **Always Allow**. The login screen only accesses Keychain when you click **Fill from Keychain** (not on startup).

## Security

### Data Protection

- **Encryption at rest**: Income payloads, bill payloads, budget metadata, savings goals, debt details, and schedule junction data (bill assignments, skipped bills, income overrides) are encrypted with AES-256-GCM before being written to SQLite
- **Key derivation**: Your master password derives the encryption key via PBKDF2-SHA512 with **310,000** iterations
- **No password storage**: Your master password is never stored; only a salted hash is kept for verification
- **Local storage only**: Data stays on your device. The app does not transmit financial data to external servers
- **Session controls**: Sensitive IPC channels require an unlocked session; exports are limited to user-selected save paths
- **Auth hardening**: Failed unlock/recovery attempts use exponential backoff and temporary lockout

### Development vs production

- DevTools open only in unpackaged development builds
- Production builds use a stricter Content Security Policy (no `unsafe-eval`)

### Biometric Authentication

On supported devices, you can enable fingerprint unlock:
- **macOS**: Touch ID integration
- **Windows**: Windows Hello support

The encryption key is stored in the system's secure keychain and released only after successful biometric authentication.

## Usage

### First Time Setup

1. Launch the app
2. Create a master password (minimum 8 characters)
3. Optionally enable fingerprint unlock

### Adding Income

1. Navigate to "Income" in the sidebar
2. Click "Add Income"
3. Enter the source name, amount, and payment frequency
4. Set the start date for when payments begin

### Adding Bills

1. Navigate to "Bills" in the sidebar
2. Click "Add Bill"
3. Enter the creditor name, amount, and due day
4. Set the priority level (Critical, High, Normal, Low)
5. Optionally add a category

### Generating a Schedule

1. Navigate to "Schedule"
2. Set your starting balance and desired time horizon
3. Click "Generate Schedule"
4. Review the payment timeline and any optimization recommendations

### Exporting

1. Navigate to "Export"
2. Choose PDF, HTML, or spreadsheet format
3. Select a save location when prompted

## Project Structure

```
budget-optimizer/
├── electron/           # Electron main process
│   ├── main.ts         # Main entry point
│   ├── preload.ts      # Secure IPC bridge
│   ├── services/       # Backend services
│   │   ├── auth.service.ts
│   │   ├── crypto.service.ts
│   │   ├── database.service.ts
│   │   ├── scheduler.service.ts
│   │   ├── pdf.service.ts
│   │   └── spreadsheet.service.ts
│   └── ipc/
│       └── handlers.ts
├── src/                # React renderer
│   ├── components/     # Reusable UI components
│   ├── context/        # React context providers
│   ├── pages/          # Page components
│   └── types/          # TypeScript types
├── build/              # Build configuration
└── public/             # Static assets
```

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.
