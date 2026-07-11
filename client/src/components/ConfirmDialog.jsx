import { createContext, useContext, useState, useCallback } from 'react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = useCallback(({ title, message, confirmLabel = 'Delete', danger = true }) =>
    new Promise(resolve => {
      setState({ title, message, confirmLabel, danger, resolve });
    }),
  []);

  const handleClose = (result) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => handleClose(false)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-2">{state.title}</h2>
            {state.message && <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{state.message}</p>}
            <div className="flex gap-3 justify-end">
              <button
                className="btn-secondary"
                onClick={() => handleClose(false)}
              >
                Cancel
              </button>
              <button
                className={state.danger ? 'btn btn-danger bg-red-600 text-white hover:bg-red-700' : 'btn-primary'}
                onClick={() => handleClose(true)}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext).confirm;
}
