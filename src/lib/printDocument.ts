export function printDocument(html: string, onBlocked: () => void): void {
  const frame = document.createElement('iframe')
  frame.title = 'مستند الطباعة'
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    right: '0',
    bottom: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  })

  let finished = false
  const removeFrame = () => {
    if (finished) return
    finished = true
    window.clearTimeout(fallbackTimer)
    frame.remove()
  }
  const fallbackTimer = window.setTimeout(removeFrame, 60_000)

  frame.addEventListener('load', () => {
    const printWindow = frame.contentWindow
    const printDocument = frame.contentDocument
    if (!printWindow || !printDocument) {
      removeFrame()
      onBlocked()
      return
    }

    void (async () => {
      try {
        const images = Array.from(printDocument.images)
        await Promise.all(images.map((image) => {
          if (image.complete) return Promise.resolve()
          return new Promise<void>((resolve) => {
            const finish = () => {
              window.clearTimeout(timeout)
              resolve()
            }
            const timeout = window.setTimeout(finish, 10_000)
            image.addEventListener('load', finish, { once: true })
            image.addEventListener('error', finish, { once: true })
          })
        }))
        await printDocument.fonts?.ready
        if (finished) return

        printWindow.addEventListener('afterprint', removeFrame, { once: true })
        printWindow.focus()
        printWindow.print()
      } catch {
        removeFrame()
        onBlocked()
      }
    })()
  }, { once: true })

  try {
    frame.srcdoc = html
    document.body.appendChild(frame)
  } catch {
    removeFrame()
    onBlocked()
  }
}
