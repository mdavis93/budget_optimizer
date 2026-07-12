import { useState } from 'react';
import { Copy, Check, AlertTriangle, Download } from 'lucide-react';

interface RecoveryKeyDisplayProps {
  recoveryKey: string;
  onConfirm: () => void;
  title?: string;
  description?: string;
}

export default function RecoveryKeyDisplay({ 
  recoveryKey, 
  onConfirm,
  title = "Save Your Recovery Key",
  description = "Write down or save this recovery key in a safe place. You'll need it if you forget your master password."
}: RecoveryKeyDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const content = `Budget Optimizer Recovery Key
================================
Generated: ${new Date().toLocaleString()}

Your Recovery Key:
${recoveryKey}

================================
IMPORTANT:
- Keep this key in a safe place
- Anyone with this key can reset your password
- You cannot recover your data without this key
- This key works only for this installation
`;
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'budget-optimizer-recovery-key.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const words = recoveryKey.split(' ');

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-warning-200 dark:bg-warning-800 mb-3">
          <AlertTriangle className="w-6 h-6 text-warning-700 dark:text-warning-200" />
        </div>
        <h2 className="text-xl font-semibold mb-2">{title}</h2>
        <p className="text-(--color-text-secondary) text-sm">
          {description}
        </p>
      </div>

      <div className="bg-(--color-bg-tertiary) rounded-lg p-4 border border-(--color-border)">
        <div className="grid grid-cols-3 gap-2 mb-4">
          {words.map((word, index) => (
            <div 
              key={index}
              className="flex items-center gap-2 bg-(--color-bg-primary) rounded-sm px-2 py-1.5"
            >
              <span className="text-xs text-(--color-text-muted) w-4">{index + 1}.</span>
              <span className="font-mono text-sm">{word}</span>
            </div>
          ))}
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="btn-secondary flex-1 text-sm"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-1" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-1" />
                Copy to Clipboard
              </>
            )}
          </button>
          <button
            onClick={handleDownload}
            className="btn-secondary flex-1 text-sm"
          >
            <Download className="w-4 h-4 mr-1" />
            Download
          </button>
        </div>
      </div>

      <div className="bg-danger-100 dark:bg-danger-900 rounded-lg p-4 border border-danger-300 dark:border-danger-700">
        <p className="text-sm text-danger-800 dark:text-danger-200 font-medium mb-2">
          Important Warning
        </p>
        <ul className="text-sm text-danger-700 dark:text-danger-200 space-y-1">
          <li>• This is the ONLY way to recover your password</li>
          <li>• Without this key, your data cannot be recovered</li>
          <li>• Store it somewhere safe and separate from your computer</li>
          <li>• Never share this key with anyone</li>
        </ul>
      </div>

      <div className="flex items-center gap-3 p-3 rounded-lg bg-(--color-bg-tertiary)">
        <input
          type="checkbox"
          id="confirmSaved"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="w-4 h-4 rounded-sm border-(--color-border)"
        />
        <label htmlFor="confirmSaved" className="text-sm">
          I have saved my recovery key in a safe place
        </label>
      </div>

      <button
        onClick={onConfirm}
        disabled={!confirmed}
        className="btn-primary w-full"
      >
        Continue
      </button>
    </div>
  );
}
