# Budget Optimizer

A secure desktop application for managing income, tracking bills, and optimizing payment schedules to avoid budget shortfalls.

## Features

- **Secure Data Storage**: Financial records are encrypted at rest using SQLCipher plus AES-256-GCM payloads
- **Master Password Protection**: Your data is protected by a master password with PBKDF2 key derivation (310,000 iterations); passwords must be at least 12 characters
- **Biometric Unlock**: Support for Touch ID (macOS) and Windows Hello for quick, secure access
- **Auto-Lock**: Automatically locks after configurable inactivity; resets on user activity
- **Income Management**: Track multiple income sources with weekly, bi-weekly, semi-monthly, or monthly cadences, optional end dates, paid or unpaid leave, and a savings-and-goals-only purpose that never pays bills
- **Bill Tracking**: Manage recurring bills with priority levels (Critical, High, Normal, Low) and categories
- **Savings Goals**: Fund goals as early as savings rules allow, in priority order, without dropping below the per-paycheck savings floor
- **Debts**: Track payoff alongside the schedule. Accelerated (avalanche) payoff is opt-in per budget and off by default; Debts shows projected interest saved and can turn it on
- **Payment Scheduling**: Greedy assignment places bills in the 20-day prepay window, or the latest paycheck on or before the due date within 31 days when that window is empty. Each paycycle is its own envelope (petty cash is spent each cycle). Shortfalls are reduced, not guaranteed zero. Break-Glass plans are suggestions you accept or decline
- **Draft / Unsaved Changes**: Named budgets stage edits in a draft overlay until you Save Changes (Quick Budget persists immediately)
- **Visual Dashboard**: Overview of your financial health with balance projections
- **Export Options**: Export schedules to PDF, HTML, or spreadsheet formats, including goal deposits and debt paydown when present

## Tech Stack

- **Framework**: Electron 42
- **UI**: React 19, TypeScript 6, Vite 8, Tailwind CSS 4 (`@tailwindcss/vite`)
- **Package manager**: pnpm 9.15.9 (pinned in `package.json`)
- **Local Database**: SQLite with SQLCipher (`better-sqlite3` aliased to `better-sqlite3-multiple-ciphers`)
- **Encryption**: Node.js crypto module (AES-256-GCM, PBKDF2)
- **Charts**: Recharts
- **Icons**: Lucide React
- **Quality**: Vitest 5, Playwright (Electron e2e), ESLint 10 (flat config)

## Getting Started

### Prerequisites

- Node.js 22+ (CI uses Node 22)
- [pnpm](https://pnpm.io/) 9.x (this repo pins `packageManager` in `package.json`)

Do not use npm (`npm install` / `package-lock.json`). This repository is pnpm-only.

### Installation

1. Clone the repository:
```bash
git clone https://github.com/mdavis93/budget_optimizer.git
cd budget_optimizer
```

2. Install dependencies:
```bash
pnpm install
```

3. Start the development app:
```bash
pnpm electron:dev
```

### Building for Production

```bash
pnpm electron:build
```

This will create distributable packages in the `release` directory.

### Development checks

Local quality gates (also run by Husky on push) are documented in [CONTRIBUTING.md](CONTRIBUTING.md). Common commands:

```bash
pnpm lint
pnpm typecheck
pnpm typecheck:electron
pnpm test:coverage:check
pnpm test:e2e
pnpm prepush
```

### Troubleshooting

#### "Failed to initialize database" / NODE_MODULE_VERSION mismatch

Native modules (`better-sqlite3` aliased to `better-sqlite3-multiple-ciphers`, `keytar`) must be compiled for the bundled Electron ABI (Electron 42 currently uses MODULE_VERSION **146**). If unlock fails with a message about a binary compiled against a different Node.js `NODE_MODULE_VERSION` than Electron expects:

```bash
pnpm install
pnpm electron:build
```

Launch the app from the **new** build in `release/` (not an older copy). The build should end with `Packaged SQLite verification passed.` The post-build SQLite check runs headlessly — it should not open the app window. The same verifier also smokes a greedy schedule-worker solve.

Use `pnpm electron:build` for production packages — not `pnpm build`, which skips native dependency sync steps.

For local development, `pnpm test*` / `pnpm electron:dev` / `pnpm test:e2e` auto-swap the `better-sqlite3` ABI via `scripts/use-native.cjs` (always load-probes under the target runtime; refreshes a cache marker only after a successful probe). If a swap looks stuck, delete `.cache/native/` and re-run. Always use the `pnpm` scripts (bare `vitest` / `playwright` skip the helper).

#### Repeated macOS Keychain prompts after rebuilding

After each rebuild, macOS may ask for Keychain access again until you choose **Always Allow**. The login screen only accesses Keychain when you click **Fill from Keychain** (not on startup).

## Security

### Data Protection

- **Encryption at rest**: SQLite is SQLCipher-encrypted (SQLCipher 4 compatibility). Income payloads, bill payloads, budget metadata, savings goals, debt details, settings, and schedule junction data are also encrypted with AES-256-GCM inside that file.
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
2. Create a master password (minimum 12 characters)
3. Optionally enable fingerprint unlock
4. Create a named budget (or use Quick Budget for throwaway what-if sessions)

### Adding Income

1. Navigate to "Income" in the sidebar
2. Click "Add Income"
3. Enter the source name, amount, and payment frequency
4. Set the start date for when payments begin
5. Optionally set an end date when the income stops
6. Optionally mark the source as savings-and-goals only (it will not pay bills)
7. Optionally add paid or unpaid leave windows on that income

Named-budget edits stay unsaved until **Save Changes** on that page (or **Save All** when multiple domains are dirty).

### Adding Bills

1. Navigate to "Bills" in the sidebar
2. Click "Add Bill"
3. Enter the creditor name, amount, and due day
4. Set the priority level (Critical, High, Normal, Low)
5. Optionally add a category

Bills due before the first paycheck they may use are treated as already paid. If the schedule starts with unpaid leave and no income in that first billing cycle, those bills stay unpayable.

### Generating a Schedule

1. Set starting balance, cash targets (target / minimum cash on hand), minimum savings per paycheck, and the optional **Accelerate debt payoff** flag on **Budgets** or Settings
2. Navigate to "Schedule"
3. Choose a viewport (fixed months or Through-goal); the schedule rebuilds automatically when start date, balance, or budget inputs change (use **Refresh** to force an immediate rebuild)
4. Review the payment timeline, reconciliation prompts, and any Break-Glass suggestions. Accepting a plan is optional; the solver never auto-applies those moves

Schedule compute runs in an Electron `utilityProcess`. Each paycheck is planned as its own envelope: leftover opening petty cash rolls into the first paycheck, and petty cash is spent each cycle. Remaining shortfalls can still appear when bills cannot be paid.

### Goals and debts

- **Goals** are funded from surplus above the savings comfort band, then from planned late dips toward the floor. Higher-priority goals are filled first. The Goals page reads projections from the same schedule build.
- **Debts** amortize from the schedule start date. With acceleration off, the assigned schedule does not add extra debt payments; Debts still shows interest you could save. With acceleration on, extra cash pays highest APR first without making any goal's funded date later.

### Exporting

1. Navigate to "Export"
2. Choose PDF, HTML, or spreadsheet format
3. Select a save location when prompted

## Project Structure

```
budget_optimizer/
├── electron/                 # Electron main process
│   ├── main.ts
│   ├── preload.ts
│   ├── ipc/                  # IPC handlers + guards
│   ├── workers/              # Schedule compute utilityProcess
│   └── services/
│       ├── *.service.ts      # Auth, crypto, DB, budgets, export, …
│       └── scheduler/        # Greedy assignment, cash-flow allocator, debt, Break-Glass
├── shared/                   # Types and constants shared by renderer + Electron
├── src/                      # React renderer
│   ├── components/           # UI (schedule, debts, goals, budgets, settings, …)
│   ├── context/              # Auth, Budget, Draft, Theme providers
│   ├── hooks/                # Schedule mutations, drag-assign, exit guard
│   ├── pages/
│   └── …
├── tests/                    # Vitest unit/component tests + Playwright e2e
├── scripts/                  # ABI swap, audits, packaging helpers
└── build/                    # Packaged-app icon / entitlements
```

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.
