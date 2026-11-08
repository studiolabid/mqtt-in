/**
 * Native HTML5 drag & drop reordering of sidebar items within their group. The drop indicator
 * is only shown where dropping would actually change the order.
 */
import { ref, type Ref } from 'vue'
import { moveId, sameOrder, type DropPosition } from '../utils/order'

const DRAG_TYPE = 'application/x-mqtey-connection'

export interface DropTarget {
  id: string
  position: DropPosition
}

export interface ConnectionDndOptions {
  /** Dragging is off while the list is filtered. */
  enabled: () => boolean
  /** Persisted order of every profile id. */
  order: () => string[]
  /** Group of a profile (`''` = ungrouped). */
  groupOf: (id: string) => string | undefined
  reorder: (ids: string[]) => void
}

export interface ConnectionDnd {
  draggingId: Ref<string | null>
  dropTarget: Ref<DropTarget | null>
  onDragStart(id: string, event: DragEvent): void
  onDragOver(id: string, event: DragEvent): void
  onDrop(id: string, event: DragEvent): void
  onDragEnd(): void
  /** Bind on the list container: hides the indicator when the pointer leaves the list. */
  onDragLeave(event: DragEvent): void
}

export function useConnectionDnd(options: ConnectionDndOptions): ConnectionDnd {
  const draggingId = ref<string | null>(null)
  const dropTarget = ref<DropTarget | null>(null)

  function setTarget(next: DropTarget | null): void {
    const current = dropTarget.value
    if (current?.id === next?.id && current?.position === next?.position) return
    dropTarget.value = next
  }

  function reset(): void {
    draggingId.value = null
    dropTarget.value = null
  }

  function positionOf(event: DragEvent): DropPosition {
    const element = event.currentTarget
    if (!(element instanceof HTMLElement)) return 'after'
    const rect = element.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  /** Where the dragged item would land, or null when its group would look the same. */
  function resolve(id: string, event: DragEvent): DropTarget | null {
    const dragged = draggingId.value
    const group = dragged ? options.groupOf(dragged) : undefined
    if (!dragged || dragged === id || group !== options.groupOf(id)) return null
    const position = positionOf(event)
    const order = options.order()
    const inGroup = (ids: readonly string[]): string[] =>
      ids.filter((other) => options.groupOf(other) === group)
    const changed = !sameOrder(inGroup(order), inGroup(moveId(order, dragged, id, position)))
    return changed ? { id, position } : null
  }

  function onDragStart(id: string, event: DragEvent): void {
    if (!options.enabled() || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    draggingId.value = id
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(DRAG_TYPE, id)
  }

  function onDragOver(id: string, event: DragEvent): void {
    const dragged = draggingId.value
    // Foreign drags (files, text) and other groups are not accepted.
    if (!dragged || options.groupOf(dragged) !== options.groupOf(id)) {
      setTarget(null)
      return
    }
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setTarget(resolve(id, event))
  }

  function onDrop(id: string, event: DragEvent): void {
    const dragged = draggingId.value
    if (!dragged) return
    event.preventDefault()
    const target = resolve(id, event)
    reset()
    if (target) options.reorder(moveId(options.order(), dragged, target.id, target.position))
  }

  function onDragLeave(event: DragEvent): void {
    const list = event.currentTarget
    const next = event.relatedTarget
    if (list instanceof Node && next instanceof Node && list.contains(next)) return
    setTarget(null)
  }

  return { draggingId, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd: reset, onDragLeave }
}
