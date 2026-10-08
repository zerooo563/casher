import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type CameraDevice,
} from 'html5-qrcode'
import { X, Camera, SwitchCamera, AlertTriangle, CheckCircle2, Volume2, VolumeX } from 'lucide-react'

interface CameraBarcodeScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onScan: (barcode: string) => void
  title?: string
  continuous?: boolean
}

// Play a short pleasant beep using the Web Audio API without needing external sound files
function playBeepSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const ctx = new AudioContextClass()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(1760, ctx.currentTime) // A6 note
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
  } catch {
    // Ignore audio failures if browser blocks autoplay audio context
  }
}

export function CameraBarcodeScannerModal({
  isOpen,
  onClose,
  onScan,
  title = 'مسح الباركود بكاميرا الهاتف أو الجهاز',
  continuous = false,
}: CameraBarcodeScannerModalProps) {
  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(true)

  const scannerRef = useRef<Html5Qrcode | null>(null)
  const isScanningRef = useRef(false)
  const lastScanTimeRef = useRef(0)
  const containerId = 'interactive-camera-barcode-scanner'

  // Safe scanner stopper
  const stopScannerSafely = useCallback(async () => {
    if (scannerRef.current && isScanningRef.current) {
      try {
        await scannerRef.current.stop()
      } catch {
        // already stopped or failed
      } finally {
        isScanningRef.current = false
      }
    }
  }, [])

  // Handle successful scan
  const handleScanSuccess = useCallback(
    (decodedText: string) => {
      const trimmed = decodedText.trim()
      if (!trimmed) return

      // Debounce consecutive identical scans within 1.5 seconds to avoid duplicates
      const now = Date.now()
      if (lastScannedCode === trimmed && now - lastScanTimeRef.current < 1500) {
        return
      }

      lastScanTimeRef.current = now
      setLastScannedCode(trimmed)

      // Audio & haptic feedback
      if (soundEnabled) {
        playBeepSound()
      }
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.(60)
      }

      onScan(trimmed)

      if (!continuous) {
        stopScannerSafely().then(onClose)
      }
    },
    [continuous, lastScannedCode, onClose, onScan, soundEnabled, stopScannerSafely]
  )

  // Start scanner with specific camera
  const startCamera = useCallback(
    async (cameraId?: string) => {
      setErrorMessage(null)
      setIsInitializing(true)
      await stopScannerSafely()

      try {
        if (!scannerRef.current) {
          scannerRef.current = new Html5Qrcode(containerId, {
            verbose: false,
            formatsToSupport: [
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.QR_CODE,
              Html5QrcodeSupportedFormats.ITF,
              Html5QrcodeSupportedFormats.CODABAR,
            ],
          })
        }

        const cameraConfig = cameraId
          ? { deviceId: { exact: cameraId } }
          : { facingMode: 'environment' }

        await scannerRef.current.start(
          cameraConfig,
          {
            fps: 15,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              // Wide aspect ratio box ideal for horizontal barcodes
              const minEdge = Math.min(viewfinderWidth, viewfinderHeight)
              const width = Math.floor(minEdge * 0.85)
              const height = Math.floor(minEdge * 0.55)
              return { width: Math.max(width, 220), height: Math.max(height, 140) }
            },
            aspectRatio: 1.3333,
          },
          handleScanSuccess,
          () => {
            // Periodic scan frame without result - ignore
          }
        )

        isScanningRef.current = true
      } catch (err: unknown) {
        const errStr = String(err)
        if (errStr.includes('NotAllowedError') || errStr.includes('Permission')) {
          setErrorMessage('تم رفض إذن الوصول إلى الكاميرا. يرجى السماح بالوصول من إعدادات المتصفح.')
        } else if (errStr.includes('NotFoundError') || errStr.includes('DevicesNotFoundError')) {
          setErrorMessage('لم يتم العثور على أي كاميرا متصلة بهذا الجهاز.')
        } else {
          setErrorMessage(`تعذر تشغيل الكاميرا: ${errStr}`)
        }
      } finally {
        setIsInitializing(false)
      }
    },
    [handleScanSuccess, stopScannerSafely]
  )

  // Initialization lifecycle
  useEffect(() => {
    if (!isOpen) return

    let isMounted = true

    async function init() {
      try {
        const availableDevices = await Html5Qrcode.getCameras()
        if (!isMounted) return

        setCameras(availableDevices)
        if (availableDevices.length > 0) {
          // Prefer back camera if found in device label
          const backCam = availableDevices.find((d) =>
            /back|rear|environment|خلف/i.test(d.label)
          )
          const chosenId = backCam?.id || availableDevices[0].id
          setSelectedCameraId(chosenId)
          await startCamera(chosenId)
        } else {
          // Try standard environment facing
          await startCamera()
        }
      } catch {
        if (!isMounted) return
        await startCamera()
      }
    }

    // Short timeout to guarantee container is rendered in DOM
    const timer = setTimeout(init, 100)

    return () => {
      isMounted = false
      clearTimeout(timer)
      stopScannerSafely()
    }
  }, [isOpen, startCamera, stopScannerSafely])

  // Switch camera toggle
  const handleSwitchCamera = () => {
    if (cameras.length <= 1) return
    const currentIndex = cameras.findIndex((c) => c.id === selectedCameraId)
    const nextIndex = (currentIndex + 1) % cameras.length
    const nextCamera = cameras[nextIndex]
    setSelectedCameraId(nextCamera.id)
    startCamera(nextCamera.id)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col"
        dir="rtl"
      >
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-muted/40">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-primary/10 text-primary rounded-xl">
              <Camera className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-bold text-foreground text-sm">{title}</h2>
              <p className="text-xs text-muted-foreground">وجّه الكاميرا نحو الباركود مباشرة</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Audio toggle button */}
            <button
              type="button"
              onClick={() => setSoundEnabled((prev) => !prev)}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors"
              title={soundEnabled ? 'كتم صوت التنبيه' : 'تشغيل صوت التنبيه'}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>

            {/* Switch camera button (if multiple cameras available) */}
            {cameras.length > 1 && (
              <button
                type="button"
                onClick={handleSwitchCamera}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors"
                title="تبديل الكاميرا"
              >
                <SwitchCamera className="h-4 w-4" />
              </button>
            )}

            {/* Close button */}
            <button
              type="button"
              onClick={() => {
                stopScannerSafely().then(onClose)
              }}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors"
              title="إغلاق"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Video Viewport Area */}
        <div className="relative bg-black aspect-[4/3] flex items-center justify-center overflow-hidden">
          {/* HTML5 QR Code Mount Element */}
          <div
            id={containerId}
            className="w-full h-full [&_video]:object-cover [&_video]:w-full [&_video]:h-full"
          />

          {/* Aiming Overlay */}
          {!errorMessage && !isInitializing && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative w-64 h-36 border-2 border-primary/80 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                {/* Corner markers */}
                <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-primary rounded-tr" />
                <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-primary rounded-tl" />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-primary rounded-br" />
                <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-primary rounded-bl" />

                {/* Laser animation line */}
                <div className="absolute inset-x-0 top-1/2 h-0.5 bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.7)] animate-pulse" />
              </div>
            </div>
          )}

          {/* Loading Indicator */}
          {isInitializing && !errorMessage && (
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 text-white text-xs">
              <div className="h-7 w-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span>جارٍ تشغيل الكاميرا...</span>
            </div>
          )}

          {/* Error View */}
          {errorMessage && (
            <div className="absolute inset-0 bg-card p-6 flex flex-col items-center justify-center text-center gap-3">
              <div className="p-3 bg-red-500/10 text-red-600 rounded-full">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">{errorMessage}</p>
              <button
                type="button"
                onClick={() => startCamera(selectedCameraId || undefined)}
                className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-xl hover:bg-primary/90 transition-colors"
              >
                إعادة المحاولة
              </button>
            </div>
          )}
        </div>

        {/* Footer feedback */}
        <div className="p-3 bg-muted/30 border-t border-border flex items-center justify-between text-xs">
          {lastScannedCode ? (
            <div className="flex items-center gap-1.5 text-emerald-600 font-mono font-medium truncate">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="truncate">آخر كود تم مسحه: {lastScannedCode}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">
              {continuous ? 'وضع المسح المستمر مفعل (أضف منتجات متتالية)' : 'سيُغلق تلقائياً بعد المسح'}
            </span>
          )}

          <button
            type="button"
            onClick={() => stopScannerSafely().then(onClose)}
            className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground text-xs font-medium"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  )
}
