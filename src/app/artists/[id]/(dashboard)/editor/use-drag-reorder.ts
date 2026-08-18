import { useRef, useState } from 'react'

/**
 * The panels' DRAG-TO-REORDER gesture, extracted (2026-08-18 consolidation) — it had
 * been hand-copied four times (tour rows, music cards, merch cards, link rows),
 * character-identical each time.
 *
 * HTML5 drag, id-keyed: `dragProps(id)` spreads onto each draggable element,
 * `isOver(id)` styles the drop target (the panels all use `ring-2 ring-accent`).
 * The drop calls `onReorder(fromId, toId)`; persistence and optimistic state stay
 * with the caller — this hook owns only the gesture.
 */
export function useDragReorder(onReorder: (fromId: string, toId: string) => void): {
  dragProps: (id: string) => {
    draggable: true
    onDragStart: () => void
    onDragEnter: () => void
    onDragOver: (e: React.DragEvent) => void
    onDrop: () => void
    onDragEnd: () => void
  }
  isOver: (id: string) => boolean
} {
  const dragFrom = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  function drop(toId: string) {
    const fromId = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (fromId && fromId !== toId) onReorder(fromId, toId)
  }

  return {
    dragProps: (id: string) => ({
      draggable: true,
      onDragStart: () => (dragFrom.current = id),
      onDragEnter: () => setDragOver(id),
      onDragOver: (e: React.DragEvent) => e.preventDefault(),
      onDrop: () => drop(id),
      onDragEnd: () => {
        dragFrom.current = null
        setDragOver(null)
      },
    }),
    isOver: (id: string) => dragOver === id,
  }
}
