import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  angleOf,
  clampPan,
  clampZoom,
  folderFor,
  frameFromDrag,
  frameFromKey,
  glideStep,
  keyColumnsOf,
  loadPercent,
  modelsIn,
  nextFrame,
  sizesOf,
  filterFor,
  spinProblem,
  stepModel,
  wrapFrame,
} from '../../lib/spin360'
import { useSpinFrames } from '../../hooks/useSpinFrames'

/**
 * A vehicle you can turn round with the pointer.
 *
 * Twelve photographs and a rule for which one to show. There is no 3D here
 * and there should not be -- the photographs already are the model, lit and
 * finished, and nothing built in a browser will look more like the bike
 * than the bike does. What IS built is the disc it stands on, because that
 * is the one thing a photographer cannot supply: it has to sit under
 * whatever vehicle the row happens to name.
 *
 * The frame count is never assumed. Twelve is what this set happens to
 * have; eight, sixteen and thirty-six are all normal.
 */
/** The small square buttons over the stage. */
function IconBtn({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        // The stage under it turns the vehicle on pointer-down; without
        // this, zooming in also spins it.
        e.stopPropagation()
        onClick()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      disabled={disabled}
      className="rounded-md border border-white/15 bg-black/40 p-1 text-white/60 backdrop-blur transition-colors hover:bg-black/60 hover:text-white disabled:opacity-30"
    >
      {children}
    </button>
  )
}

export default function Spin360Widget({ widget, rows, tab, targets, onFilter }) {
  const keyColumns = keyColumnsOf(widget)
  const models = useMemo(
    () => modelsIn(rows, keyColumns, widget.folderColumn, widget.labelColumn),
    [rows, keyColumns.join('|'), widget.folderColumn, widget.labelColumn]
  )

  const [pick, setPick] = useState(0)
  const goto = (step) => setPick((i) => stepModel(i, step, models.length))
  // A filter that narrows the table underneath must not leave the viewer
  // pointing at a model that is no longer in it.
  const model = models[Math.min(pick, Math.max(0, models.length - 1))]
  const folderId = folderFor(widget, model)

  const { imageWidth, platformWidth, platformDepth } = sizesOf(widget)
  const { frames, loading, error } = useSpinFrames(folderId, imageWidth)
  const count = frames.length

  const [frame, setFrame] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [full, setFull] = useState(false)
  const [loaded, setLoaded] = useState(0)
  const boxRef = useRef(null)
  const drag = useRef(null)
  const glide = useRef(0)

  const zoomed = zoom > MIN_ZOOM
  const ready = count > 0 && loaded >= count
  const percent = loadPercent(loaded, count)

  // A new set starts at its first frame. Without this, moving from a
  // twelve-frame vehicle to an eight-frame one leaves the index past the
  // end and the viewer blank.
  useEffect(() => {
    setFrame(0)
    setLoaded(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [folderId, count])

  // --- turning it -------------------------------------------------------
  useEffect(() => {
    if (!dragging) return undefined

    function move(e) {
      const start = drag.current
      if (!start) return
      const x = e.touches ? e.touches[0].clientX : e.clientX
      const y = e.touches ? e.touches[0].clientY : e.clientY
      const box = boxRef.current?.getBoundingClientRect()

      // Zoomed in, the drag moves the PHOTOGRAPH. Turning the vehicle while
      // somebody is trying to look at the exhaust is the one thing a zoom
      // must not do.
      if (start.zoomed) {
        setPan({
          x: clampPan(start.pan.x + (x - start.x), box?.width || imageWidth, zoom),
          y: clampPan(start.pan.y + (y - start.y), box?.height || imageWidth, zoom),
        })
        return
      }

      const next = frameFromDrag(start.frame, x - start.x, box?.width || imageWidth, count, widget.reverse)
      // Remembered for the flick: the last movement is what it coasts on.
      start.velocity = next - start.last
      start.last = next
      setFrame(next)
    }
    function up() {
      const start = drag.current
      // A flick keeps turning. Below a frame of travel it was a click, not
      // a throw, and coasting from that would feel like a twitch.
      if (start && !start.zoomed && Math.abs(start.velocity || 0) >= 1 && widget.glide !== false) {
        glide.current = start.velocity
      }
      drag.current = null
      setDragging(false)
    }

    // On the window, not the element: a pointer that leaves the widget
    // mid-drag must keep turning the bike, and must still stop when it is
    // released somewhere else entirely.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('touchmove', move, { passive: true })
    window.addEventListener('touchend', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', up)
    }
  }, [dragging, count, imageWidth, widget.reverse])

  // Auto-spin, and only while nobody is holding it: a bike that keeps
  // turning under the finger is one that cannot be pointed at anything.
  useEffect(() => {
    if (!widget.autoSpin || dragging || count < 2) return undefined
    const timer = setInterval(
      () => setFrame((f) => nextFrame(f, count, widget.reverse)),
      Math.max(40, Number(widget.spinMs) || 90)
    )
    return () => clearInterval(timer)
  }, [widget.autoSpin, widget.spinMs, widget.reverse, dragging, count])

  // The coast. One timer that ends itself, rather than one that runs for
  // the life of the widget checking whether anything is moving.
  useEffect(() => {
    if (!glide.current || dragging) return undefined
    const timer = setInterval(() => {
      const step = glideStep(frameRef.current, glide.current, count)
      glide.current = step.velocity
      setFrame(step.index)
      if (!step.velocity) clearInterval(timer)
    }, 45)
    return () => clearInterval(timer)
  }, [dragging, count, frame])

  // Read inside the interval without making it a dependency, which would
  // tear the timer down and build it again on every single frame.
  const frameRef = useRef(0)
  frameRef.current = frame

  // --- what the rest of the page should be looking at -------------------
  // Announced whenever the vehicle changes, so a KPI card beside this one
  // shows that vehicle's numbers without knowing a 360° viewer exists.
  const filterId = `spin360:${widget.id}`
  useEffect(() => {
    if (!onFilter) return undefined
    onFilter(filterId, filterFor(widget, model, tab, targets))
    // Cleared on the way out: a filter left behind by a widget that is no
    // longer on the page is one nobody can find to switch off.
    return () => onFilter(filterId, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filterId,
    model?.key,
    widget.driveFilter,
    widget.keyColumns?.join('|'),
    tab,
    onFilter,
    // A widget added to the page, or one that has just been told which of
    // its columns to match on, has to reach the filter without waiting for
    // somebody to press Next.
    JSON.stringify(targets || []),
  ])

  const problem = spinProblem(widget, { models, frames, loading })

  function onWheel(e) {
    if (widget.zoom === false || count === 0) return
    e.preventDefault()
    setZoom((z) => {
      const next = clampZoom(z - e.deltaY * 0.002)
      // Back to 1×, back to the middle: leaving a pan behind means the
      // vehicle is off-centre the next time somebody zooms in.
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 })
      return next
    })
  }

  function onKeyDown(e) {
    const next = frameFromKey(e.key, frame, count, widget.reverse)
    if (next !== null) {
      e.preventDefault()
      glide.current = 0
      setFrame(next)
      return
    }
    // Up and down walk the VEHICLES, because left and right already turn
    // the one on screen. Two lists, two axes.
    if (models.length > 1 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      goto(e.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (e.key === 'Escape' && full) setFull(false)
  }

  function startDrag(e) {
    if (count < 2 && !zoomed) return
    const x = e.touches ? e.touches[0].clientX : e.clientX
    const y = e.touches ? e.touches[0].clientY : e.clientY
    // A new grab kills the coast. Catching a spinning wheel stops it.
    glide.current = 0
    drag.current = { x, y, frame, last: frame, velocity: 0, zoomed, pan }
    setDragging(true)
  }

  return (
    // A `.card` like every other widget, which is the whole mechanism by
    // which an admin restyles anything: `.card` reads the custom properties
    // the page publishes on the wrapper (see lib/widgetStyle.js). Without
    // one this was the single widget on the dashboard whose Look tab did
    // nothing at all.
    //
    // "Bare" drops it, which is the only way a vehicle can stand on the
    // page itself rather than in a box -- the whole point of a showcase
    // page, and of the transparent photographs that go on one.
    <div className={`flex h-full min-h-0 flex-col ${widget.bare ? '' : 'card'}`}>
      {/* Which vehicle. Only when there is a choice -- a picker over one
          set is a control that cannot do anything.

          Next and Previous rather than a chip each: a table of forty bikes
          is forty chips wrapped over four lines, and the thing somebody
          actually does is look at them one after another. The name is
          between the two buttons because that is where the eye already is. */}
      {models.length > 1 && (
        <div className="mb-2 flex items-center gap-1">
          <button
            onClick={() => goto(-1)}
            title="Previous vehicle"
            aria-label="Previous vehicle"
            className="rounded-lg border border-white/15 p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft size={14} />
          </button>

          <span className="min-w-0 flex-1 text-center">
            <span className="block truncate text-[12px] font-semibold text-white/90">
              {model?.key}
            </span>
            <span className="block text-[9px] tabular-nums text-white/35">
              {pick + 1} of {models.length}
            </span>
          </span>

          <button
            onClick={() => goto(1)}
            title="Next vehicle"
            aria-label="Next vehicle"
            className="rounded-lg border border-white/15 p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      <div
        ref={boxRef}
        onPointerDown={startDrag}
        onTouchStart={startDrag}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        // Reachable and drivable from the keyboard: a control that only
        // answers to a mouse is one half the people cannot use at all.
        tabIndex={count > 1 ? 0 : -1}
        role={count > 1 ? 'slider' : undefined}
        aria-label={count > 1 ? 'Turn the vehicle' : undefined}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, count - 1)}
        aria-valuenow={wrapFrame(frame, count)}
        aria-valuetext={`${angleOf(frame, count)} degrees`}
        className={`relative flex min-h-0 flex-1 select-none items-end justify-center overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60 ${
          zoomed ? (dragging ? 'cursor-grabbing' : 'cursor-move') : count > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
        } ${full ? 'fixed inset-0 z-[9998] bg-black/95 p-8' : ''}`}
        style={{
          // The browser's own horizontal pan would fight the drag on a
          // touchscreen, and the bike would turn while the page scrolled.
          touchAction: count > 1 ? 'pan-y' : 'auto',
          // The ground the photograph sits on. Product shots come on white,
          // which on a dark page is a white rectangle -- a light stage
          // makes that look deliberate instead.
          background: widget.stageBg && widget.stageBg !== 'transparent' ? widget.stageBg : undefined,
          padding: Number(widget.padding) >= 0 ? Number(widget.padding) : undefined,
        }}
      >
        {/* --- the platform ------------------------------------------
            An ellipse, not a circle: a disc seen from a low angle is what
            makes the vehicle look stood ON something rather than pasted
            over it. Depth is set free of width, because how far above it
            you stand is a different question from how big it is. */}
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            bottom: '6%',
            width: platformWidth,
            height: platformDepth,
            borderRadius: '50%',
            background: `radial-gradient(ellipse at 50% 40%, ${widget.platformColor || '#1e293b'} 0%, rgba(0,0,0,0.55) 62%, rgba(0,0,0,0) 78%)`,
            boxShadow: `0 0 ${Math.round(platformDepth * 0.9)}px rgba(255,255,255,0.06) inset`,
          }}
        />
        {/* The rim. A thin bright edge is the whole difference between a
            disc and a smudge. */}
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            bottom: '6%',
            width: platformWidth,
            height: platformDepth,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.16)',
            maskImage: 'linear-gradient(to bottom, transparent 35%, #000 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 35%, #000 100%)',
          }}
        />

        {/* --- the vehicle -------------------------------------------
            Every frame is rendered and all but one hidden, so turning it
            costs nothing after the first pass. Swapping one `src` would
            re-request on every frame and the bike would flicker as it
            turned. */}
        {frames.map((f, i) => (
          <img
            key={f.id}
            src={f.url}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            // EVERY frame is fetched, not just the visible one: a lazy
            // frame is one that starts downloading at the moment somebody
            // drags onto it, which is a gap in the turn every single time.
            // The counter below is what makes that wait honest.
            loading="eager"
            decoding="async"
            onLoad={() => setLoaded((n) => n + 1)}
            // A frame that will not load must not stall the counter for
            // ever -- the viewer would sit at 11/12 and never start.
            onError={() => setLoaded((n) => n + 1)}
            className={`pointer-events-none relative max-h-full ${
              widget.fit === 'cover' ? 'object-cover' : 'object-contain'
            }`}
            style={{
              width: imageWidth,
              maxWidth: '100%',
              marginBottom: Math.round(platformDepth * 0.42),
              display: i === frame ? 'block' : 'none',
              // One transform for zoom and pan together: two would fight
              // over the same property and the last one written would win.
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: dragging ? 'none' : 'transform 120ms ease-out',
              mixBlendMode: widget.blend && widget.blend !== 'none' ? widget.blend : undefined,
              filter: widget.shadow === false ? 'none' : 'drop-shadow(0 18px 22px rgba(0,0,0,0.55))',
            }}
          />
        ))}

        {/* How far through the download. Twelve photographs at retina
            width is a real wait on a phone, and a viewer that sits blank
            for four seconds is one people press again. */}
        {!loading && count > 0 && !ready && (
          <span className="absolute inset-x-0 bottom-3 mx-auto flex w-40 flex-col items-center gap-1">
            <span className="h-0.5 w-full overflow-hidden rounded-full bg-white/15">
              <span
                className="block h-full rounded-full bg-white/60 transition-all"
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="text-[9px] tabular-nums text-white/40">
              {loaded}/{count} frames
            </span>
          </span>
        )}

        {/* --- what to do with the image ---------------------------- */}
        {count > 0 && (
          <div className="absolute right-2 top-2 flex flex-col gap-1">
            {widget.zoom !== false && (
              <>
                <IconBtn
                  label="Zoom in"
                  onClick={() => setZoom((z) => clampZoom(z + 0.5))}
                  disabled={zoom >= MAX_ZOOM}
                >
                  <ZoomIn size={13} />
                </IconBtn>
                <IconBtn
                  label="Zoom out"
                  onClick={() =>
                    setZoom((z) => {
                      const next = clampZoom(z - 0.5)
                      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 })
                      return next
                    })
                  }
                  disabled={zoom <= MIN_ZOOM}
                >
                  <ZoomOut size={13} />
                </IconBtn>
              </>
            )}
            {widget.fullscreen !== false && (
              <IconBtn label={full ? 'Leave fullscreen' : 'Fullscreen'} onClick={() => setFull((v) => !v)}>
                {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </IconBtn>
            )}
          </div>
        )}

        {loading && (
          <span className="absolute inset-0 flex items-center justify-center text-white/40">
            <Loader2 size={20} className="animate-spin" />
          </span>
        )}

        {problem && !loading && (
          <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] leading-snug text-white/40">
            {problem}
          </span>
        )}
        {error && !loading && (
          <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-[11px] leading-snug text-rose-300/80">
            {error}
          </span>
        )}
      </div>

      {/* --- what to do with it ------------------------------------- */}
      {count > 1 && (
        <div className="mt-1 flex items-center justify-center gap-3 text-white/40">
          <button
            onClick={() => setFrame((f) => nextFrame(f, count, !widget.reverse))}
            aria-label="Turn left"
            className="rounded p-1 hover:bg-white/10 hover:text-white/80"
          >
            <RotateCcw size={13} />
          </button>
          {/* A scrubber as well as the two buttons: somebody who wants
              the far side does not want to press an arrow six times. */}
          <input
            type="range"
            min={0}
            max={count - 1}
            value={wrapFrame(frame, count)}
            onChange={(e) => {
              glide.current = 0
              setFrame(Number(e.target.value))
            }}
            aria-label="Frame"
            className="h-1 w-28 cursor-pointer accent-indigo-400"
          />
          <span className="w-16 text-center text-[10px] tabular-nums">
            {angleOf(frame, count)}° · {wrapFrame(frame, count) + 1}/{count}
          </span>
          <button
            onClick={() => setFrame((f) => nextFrame(f, count, widget.reverse))}
            aria-label="Turn right"
            className="rounded p-1 hover:bg-white/10 hover:text-white/80"
          >
            <RotateCw size={13} />
          </button>
        </div>
      )}
      {count > 1 && !dragging && (
        <p className="text-center text-[9px] uppercase tracking-widest text-white/25">drag to turn</p>
      )}
    </div>
  )
}
