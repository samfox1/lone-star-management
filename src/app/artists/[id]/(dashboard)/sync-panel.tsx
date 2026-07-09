/**
 * A small integration panel: save the artist's external id/name and pull its
 * catalog into draft rows. Used for every catalog + standalone source — the
 * save/pull server actions are passed in already bound to the artist. Save and
 * pull both confirm with a toast (SaveForm / ActionButton).
 */
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SaveForm } from './save-form'
import { ActionButton } from './action-button'

type SaveAction = (formData: FormData) => Promise<{ error?: string }>
type PullAction = () => Promise<{ ok: boolean; error?: string }>

export function SyncPanel({
  title,
  idName,
  idValue,
  placeholder,
  hasId,
  pullLabel,
  saveAction,
  pullAction,
}: {
  title: string
  idName: string
  idValue: string
  placeholder: string
  hasId: boolean
  pullLabel: string
  saveAction: SaveAction
  pullAction: PullAction
}) {
  return (
    <section className="mb-4 rounded-xl border border-hairline bg-paper p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">{title}</h2>
        <ActionButton
          action={pullAction}
          savedMessage={`${title}: imported`}
          busyLabel="Importing…"
          disabled={!hasId}
          className={buttonClass('ghost', 'disabled:cursor-not-allowed disabled:opacity-40')}
        >
          {pullLabel}
        </ActionButton>
      </div>
      <SaveForm action={saveAction} savedMessage="Saved" className="mt-3 flex items-center gap-2">
        <input
          name={idName}
          defaultValue={idValue}
          placeholder={placeholder}
          className={`${inputClass} flex-1`}
        />
        <button
          type="submit"
          className="rounded-md px-2 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          Save
        </button>
      </SaveForm>
      <p className="mt-2 font-space text-xs text-ink-faint">
        Pulls into draft rows. Your manual edits are never overwritten. Requires API
        credentials configured.
      </p>
    </section>
  )
}
