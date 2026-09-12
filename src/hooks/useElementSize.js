import { useEffect, useRef, useState } from 'react'

/**
 * How big an element actually is, live.
 *
 * A ResizeObserver rather than CSS container queries, and the reason is
 * not browser support -- it is that `container-type: size` makes an
 * element size-contained on BOTH axes, so its content stops
 * contributing to its height. On the canvas, where every card has a
 * height it was dragged to, that is fine. Anywhere a card is
 * auto-height -- the widget preview in the admin panel, a phone
 * stacking cards at their own proportions -- it collapses the card to
 * nothing. A dashboard that works on the canvas and is empty in the
 * editor is not a trade worth making for a few lines.
 *
 * Returns `{ ref, width, height }`, with the size zero until the first
 * observation -- which callers are expected to treat as "no opinion"
 * and fall back on whatever they would have drawn anyway. A component
 * that rendered tiny for one frame and then jumped would flicker on
 * every load.
 *
 * An object rather than the `[ref, size]` tuple this started as. The
 * tuple reads well at the call site and hides what the hook actually
 * hands over: with an object, the names a caller uses are the names it
 * destructured, which is a rule this project checks (imports.test.js)
 * precisely because a hook whose shape changed and a caller that did
 * not is a silent undefined.
 */
export function useElementSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box) return
      setSize((current) => {
        // Rounded, and only when it actually moved. A resize observer
        // fires on sub-pixel changes during a drag, and every one of
        // those would be a re-render of a card whose numbers are being
        // animated -- for a size that rounds to what it already was.
        const width = Math.round(box.width)
        const height = Math.round(box.height)
        if (width === current.width && height === current.height) return current
        return { width, height }
      })
    })

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { ref, width: size.width, height: size.height }
}
