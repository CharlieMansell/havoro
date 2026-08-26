import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// First-run walkthrough for the on-device build.
//
// The desktop and self-hosted builds don't need this: you arrive at them
// having already decided to install a server, and the Dashboard's
// GettingStartedCard checklist is enough of a nudge. On a phone the app is
// just there, with an empty dashboard and no explanation of where anything
// comes from — and the two questions that actually block a new person
// ("where does my data live?" and "how do I get a statement onto a phone?")
// are answered nowhere in the interface.
//
// Shown once. The flag is in localStorage rather than the database on
// purpose: it describes this install, not this ledger, and importing a
// database from a laptop shouldn't make the welcome screen reappear.

const SEEN_KEY = 'hl_onboarding_seen_v1';

export function hasSeenOnboarding() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false; // private mode or blocked storage — show it, harmlessly
  }
}

export function markOnboardingSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* nothing to do */ }
}

export function resetOnboarding() {
  try { localStorage.removeItem(SEEN_KEY); } catch { /* nothing to do */ }
}

const STEPS = [
  {
    title: 'Your money, on your phone',
    body: (
      <>
        <p>
          Havoro tracks your spending, budgets and net worth. Everything lives in a
          database <strong>on this iPhone</strong> — there's no account to create, no
          server to sign in to, and nothing is uploaded anywhere.
        </p>
        <p className="text-slate-400 dark:text-slate-500">
          That also means nobody can recover it for you. Take an export now and then:
          Settings → Database backups → Export a copy.
        </p>
      </>
    ),
  },
  {
    title: 'Already use Havoro on a computer?',
    body: (
      <>
        <p>
          Bring your data across instead of starting again. On the desktop app go to
          <strong> Settings → Database backups → Back up now</strong>, then get that
          file onto your phone — iCloud Drive, AirDrop or email all work.
        </p>
        <p>
          Here, open <strong>Settings → Import a backup file</strong> and pick it. Your
          accounts, transactions, budgets and rules all come with it.
        </p>
        <p className="text-slate-400 dark:text-slate-500">
          The two don't sync afterwards — each device keeps its own copy, and you move a
          file across when you want them to match.
        </p>
      </>
    ),
  },
  {
    title: 'Starting fresh',
    body: (
      <>
        <p>Three things, in this order:</p>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li><strong>Add your accounts</strong> — everyday, savings, offset, credit cards, super, property.</li>
          <li><strong>Import a bank statement</strong> so there's something to work with.</li>
          <li><strong>Categorise</strong> what comes in. Rules learn as you go, so you only tag a shop once.</li>
        </ol>
        <p className="text-slate-400 dark:text-slate-500">
          The Dashboard keeps a checklist of this until you're done.
        </p>
      </>
    ),
  },
  {
    title: 'Getting a statement onto your phone',
    body: (
      <>
        <p>
          This is the fiddly bit on iOS, because banks hand you a file rather than
          opening it. Either way works:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong>In Safari</strong> — log in to your bank, export the statement, and when
            the download finishes tap it in the Downloads list and choose
            <em> Save to Files</em>.
          </li>
          <li>
            <strong>By email</strong> — send the export to yourself from a computer, then long-press
            the attachment and choose <em>Save to Files</em>.
          </li>
        </ul>
        <p>
          Then in Havoro: <strong>Import</strong>, pick your bank, choose the account, and tap the
          file box to select it from Files. Check the preview before confirming — dates
          should read as dates and money coming in should be positive.
        </p>
        <p className="text-slate-400 dark:text-slate-500">
          Most banks export CSV. American Express is the exception: choose its
          <strong> Excel</strong> download, which is the one carrying the merchant and category
          columns.
        </p>
      </>
    ),
  },
];

export default function Onboarding({ onClose }) {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const isLast = step === STEPS.length - 1;

  const finish = (destination) => {
    markOnboardingSeen();
    onClose?.();
    if (destination) navigate(destination);
  };

  const current = STEPS[step];

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      {/* Bottom sheet on a phone, centred card on anything larger. The safe-area
          padding keeps the buttons clear of the home indicator. */}
      <div className="bg-white dark:bg-slate-800 w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl flex flex-col max-h-[88dvh] pb-[env(safe-area-inset-bottom)]">
        <div className="px-6 pt-6 pb-2 flex items-start gap-3">
          <img src="/icon.svg" alt="" className="w-9 h-9 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 id="onboarding-title" className="font-serif text-lg font-semibold text-slate-800 dark:text-slate-100">
              {current.title}
            </h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              Step {step + 1} of {STEPS.length}
            </p>
          </div>
          <button
            onClick={() => finish()}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 p-1 -mr-1 shrink-0"
            aria-label="Skip the walkthrough"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-3 overflow-y-auto text-sm text-slate-600 dark:text-slate-300 space-y-3 leading-relaxed">
          {current.body}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex items-center gap-3">
          <div className="flex gap-1.5 flex-1" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? 'w-5 bg-emerald-600 dark:bg-emerald-500' : 'w-1.5 bg-slate-200 dark:bg-slate-600'
                }`}
              />
            ))}
          </div>

          {step > 0 && (
            <button className="btn-secondary text-sm" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {isLast ? (
            <button className="btn-primary text-sm" onClick={() => finish('/accounts')}>
              Add my accounts
            </button>
          ) : (
            <button className="btn-primary text-sm" onClick={() => setStep(step + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
