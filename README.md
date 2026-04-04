# Budget Optimizer

A secure desktop application for managing income, tracking bills, and optimizing payment schedules to avoid budget shortfalls.

## Features

- **Secure Data Storage**: All financial data is encrypted using AES-256-GCM encryption
- **Master Password Protection**: Your data is protected by a master password with PBKDF2 key derivation
- **Biometric Unlock**: Support for Touch ID (macOS) and Windows Hello for quick, secure access
- **Income Management**: Track multiple income sources with various payment cadences (weekly, bi-weekly, semi-monthly, monthly)
- **Bill Tracking**: Manage recurring bills with priority levels and categories
- **Payment Optimization**: Automatically generates optimized payment schedules to avoid shortfalls
- **Visual Dashboard**: Overview of your financial health with balance projections
- **Export Options**: 
  - Export to PDF for printing
  - Export to Google Sheets for collaborative editing

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

## Security

### Data Protection

- **Encryption**: All sensitive data (income amounts, bill details, creditor names) is encrypted using AES-256-GCM before storage
- **Key Derivation**: Your master password is used to derive an encryption key via PBKDF2 with 100,000 iterations
- **No Password Storage**: Your actual password is never stored; only a hash is kept for verification
- **Local Storage Only**: All data stays on your device - nothing is sent to external servers (except Google Sheets exports if you choose)

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
2. Choose PDF or Google Sheets
3. For Google Sheets, you'll need to authorize the app with your Google account

## Google Sheets Integration

To enable Google Sheets export:

1. Create a project in Google Cloud Console
2. Enable the Google Sheets API
3. Create OAuth 2.0 credentials (Desktop application)
4. The app will prompt you to authorize when you first try to export

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
│   │   └── google.service.ts
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

Contributions are welcome! Please read our contributing guidelines before submitting a PR.
