/**
 * Client-side image compression utility.
 * Resizes any image file to maximum dimensions and compresses to JPEG,
 * keeping the base64 string lightweight (< 60KB) for seamless IndexedDB storage.
 */
export function compressImage(
  file: File,
  maxWidth = 500,
  maxHeight = 500,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('الملف المختار ليس صورة صالحة'))
      return
    }

    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        let width = img.width
        let height = img.height

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width)
            width = maxWidth
          } else {
            width = Math.round((width * maxHeight) / height)
            height = maxHeight
          }
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          resolve(e.target?.result as string)
          return
        }

        ctx.drawImage(img, 0, 0, width, height)
        const compressed = canvas.toDataURL('image/jpeg', quality)
        resolve(compressed)
      }
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  })
}
