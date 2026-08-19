import { InactiveReason, INACTIVE_REASON_LABELS } from '../../types';

interface Props {
  /** Shop name, shown so the user can confirm they picked the right account. */
  shopName: string;
  reason: InactiveReason | '';
  note: string;
  saving: boolean;
  error: string | null;
  onReasonChange: (reason: InactiveReason) => void;
  onNoteChange: (note: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Captures why an account is being parked before it is archived.
 *
 * Archiving is reversible and non-destructive, but it removes the account from
 * everyone's working lists — so the reason is mandatory and ends up both on the
 * account record and in its notes, where the next rep will actually see it.
 */
export default function InactivateModal({
  shopName, reason, note, saving, error,
  onReasonChange, onNoteChange, onCancel, onConfirm,
}: Props) {
  const needsNote = reason === 'other' && !note.trim();
  const canSubmit = !!reason && !needsNote && !saving;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={() => !saving && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-label={`Mark ${shopName} inactive`}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold text-navy-900">Mark inactive</h3>
          <p className="text-sm text-navy-500 mt-1">{shopName}</p>
        </div>

        <div className="bg-navy-50 border border-navy-100 rounded-xl p-3 text-xs text-navy-600 leading-relaxed">
          This account comes off the account lists, follow-ups, dormant alerts, digests
          and weekly reports. Nothing is deleted &mdash; its notes and history are kept,
          its past sales still count in revenue reporting, and anyone can bring it back
          from the <strong>Show inactive</strong> filter.
        </div>

        <fieldset>
          <legend className="block text-sm font-medium text-navy-700 mb-1.5">
            Reason <span className="text-red-500">*</span>
          </legend>
          <div className="space-y-1.5">
            {(Object.keys(INACTIVE_REASON_LABELS) as InactiveReason[]).map(key => (
              <label
                key={key}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                  reason === key
                    ? 'bg-brand-50 border-brand-300 text-navy-900'
                    : 'bg-white border-navy-200 text-navy-600 hover:bg-navy-50'
                }`}
              >
                <input
                  type="radio"
                  name="inactive-reason"
                  value={key}
                  checked={reason === key}
                  onChange={() => onReasonChange(key)}
                  className="accent-brand-600"
                />
                {INACTIVE_REASON_LABELS[key]}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1" htmlFor="inactive-note">
            Note {reason === 'other' && <span className="text-red-500">*</span>}
            <span className="font-normal text-navy-400"> (added to the account&rsquo;s notes)</span>
          </label>
          <textarea
            id="inactive-note"
            value={note}
            maxLength={2000}
            rows={3}
            onChange={e => onNoteChange(e.target.value)}
            placeholder="Anything the next person should know."
            className="input-field resize-none"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="flex gap-3 pt-1">
          <button type="button" disabled={saving} onClick={onCancel} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onConfirm}
            className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Mark inactive'}
          </button>
        </div>
      </div>
    </div>
  );
}
