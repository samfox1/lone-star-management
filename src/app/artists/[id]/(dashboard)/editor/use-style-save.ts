import { cleanClassText } from '@/lib/site-editor/save'
import { type SaveStatus } from './inspector-shared'
import { useDebouncedFieldSave } from './use-debounced-field-save'
import { saveEditorStyleAction } from '../actions'

/**
 * The debounced style-region save, shared by the section Style panel and the per-item
 * editor. A thin binding of the generic `useDebouncedFieldSave` machinery to the style
 * write path:
 *
 *  • validate with the SAME `cleanClassText` the server uses (as the hook's `normalize`),
 *    so a panel can never claim "Saved" on a write the server would reject — a rejected
 *    string paints nothing, queues nothing, and `save` returns false;
 *  • optimistic repaint via `onApplyStyle` (the frame bridge);
 *  • per-key 500ms debounce + serialized persistence + unmount flush all live in the hook.
 */
export function useStyleRegionSave(
  artistId: string,
  onApplyStyle?: (key: string, className: string) => void,
): { status: SaveStatus; save: (key: string, raw: string) => boolean } {
  const { status, save } = useDebouncedFieldSave<string>({
    persist: (key, className) => saveEditorStyleAction(artistId, key, className),
    normalize: cleanClassText,
    onApply: onApplyStyle,
  })
  return { status, save }
}
