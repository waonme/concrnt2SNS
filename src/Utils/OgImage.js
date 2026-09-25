import sharp from "sharp";
import MetaTagExtractor from './MetaTagExtractor.js';
import { fetchPreviewBytes } from './PreviewFetch.js';

const GOOGLE_FAVICON_URL = "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=256&url="
const MAX_IMAGE_ATTEMPTS = 3
const PREVIEW_TIMEOUT_MS = 8000

class OgImage {
  static async getOgImage(url, ccClient = undefined) {
    const signal = AbortSignal.timeout(PREVIEW_TIMEOUT_MS)
    try {
      const metadata = await this.getOgp(url, ccClient, signal)
      const attempted = new Set()
      const tryImages = async candidates => {
        for (const candidate of candidates) {
          if (signal.aborted || attempted.size >= MAX_IMAGE_ATTEMPTS) break
          const imageUrl = this.resolveImageUrl(candidate, url)
          if (!imageUrl || attempted.has(imageUrl)) continue
          attempted.add(imageUrl)
          const bytes = await this.getImage(imageUrl, signal)
          if (bytes) return { imageUrl, bytes }
        }
      }

      let image = await tryImages(metadata.imageUrls)
      if (!image && metadata.fromSummary && !signal.aborted) {
        // Fetch HTML only after the preferred summary image failed.
        const page = await this.getPageOgp(url, signal)
        image = await tryImages(page.imageUrls)
        metadata.title ||= page.title
        metadata.description ||= page.description
      }

      return {
        imageUrl: image?.imageUrl || metadata.ogImageUrl,
        type: "image/jpeg",
        url: url,
        description: metadata.description,
        title: metadata.title,
        uint8Array: new Uint8Array(image?.bytes),
      }
    } catch {
      console.warn('Link preview: metadata unavailable')
      return undefined
    }
  }

  static resolveImageUrl(candidate, pageUrl) {
    if (typeof candidate !== 'string' || !candidate.trim()) return undefined
    try {
      const resolved = new URL(candidate, pageUrl)
      return ['http:', 'https:'].includes(resolved.protocol) ? resolved.href : undefined
    } catch {
      return undefined
    }
  }

  static async getImage(ogImageUrl, signal) {
    try {
      const { bytes, contentType } = await fetchPreviewBytes(ogImageUrl, {
        signal,
        maxBytes: 5 * 1024 * 1024,
      })
      const mimeType = contentType.split(';')[0].trim().toLowerCase()
      if (mimeType && !mimeType.startsWith('image/') && mimeType !== 'application/octet-stream') {
        throw new Error('Preview response is not an image')
      }

      return await sharp(bytes, { limitInputPixels: 40_000_000 })
        .resize(800, null, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({
          quality: 80,
          progressive: true,
        })
        .toBuffer()
    } catch {
      console.warn('Link preview: image unavailable')
      return undefined
    }
  }

  static async getOgp(url, ccClient = undefined, signal) {
    let title = ''
    let description = ''
    if (ccClient?.domainServices?.['world.concrnt.hyperproxy.summary']) {
      const summaryUrl = `https://${ccClient.host}${ccClient.domainServices['world.concrnt.hyperproxy.summary'].path}?url=${encodeURIComponent(url)}`
      try {
        const { bytes } = await fetchPreviewBytes(summaryUrl, { signal, maxBytes: 256 * 1024 })
        const data = JSON.parse(bytes.toString('utf8'))
        title = data.title || ''
        description = data.description || ''
        const ogImageUrl = data.thumbnail || (data.icon?.endsWith('.ico')
          ? GOOGLE_FAVICON_URL + url : data.icon)
        if (this.resolveImageUrl(ogImageUrl, url)) {
          return {
            ogImageUrl,
            imageUrls: [ogImageUrl],
            title,
            description,
            fromSummary: true,
          }
        }
      } catch {
        console.warn('Link preview: summary unavailable')
      }
    }

    const page = await this.getPageOgp(url, signal)
    return {
      ...page,
      title: title || page.title,
      description: description || page.description,
    }
  }

  static async getPageOgp(url, signal) {
    const faviconUrl = GOOGLE_FAVICON_URL + url
    try {
      const meta = await new MetaTagExtractor().extractMeta(url, { signal })
      let imageUrls = meta.images || []
      if (this.isAmazonPrimeVideoURL(url)) {
        imageUrls = [faviconUrl]
      } else if (this.containsAmazonShortURL(url)) {
        const amazonImage = this.findTargetAmazonImageFromMeta(meta)
        if (amazonImage) imageUrls = [amazonImage, ...imageUrls]
      }
      if (imageUrls.length === 0) imageUrls = [faviconUrl]

      return {
        ogImageUrl: imageUrls[0],
        imageUrls,
        title: meta.og?.title || meta.title || '',
        description: meta.og?.description || meta.description || '',
      }
    } catch {
      return { ogImageUrl: faviconUrl, imageUrls: [faviconUrl], title: '', description: '' }
    }
  }

  static containsAmazonShortURL(text) {
    const pattern = /https?:\/\/(?:a\.co|amzn\.to|amzn\.asia|amzn\.eu|(?:www\.)?amazon\.co\.jp)\/[^\s]+/i
    return pattern.test(text)
  }

  static isAmazonPrimeVideoURL(text) {
    // Prime VideoのURLはgp/videoを含む
    const pattern = /https?:\/\/(?:www\.)?amazon\.co\.jp\/gp\/video\//i
    return pattern.test(text)
  }

  static findTargetAmazonImage(json) {
    const prefix = "https://m.media-amazon.com/images/I/"

    // 条件に合うURLを探す
    const image = json.ogImage.find(item =>
      item.url &&
      item.url.startsWith(prefix) &&
      item.url.includes("_SX") &&
      item.url.includes("_SY")
    )

    if (!image) return undefined

    const originalUrl = image.url

    // originalUrl例: 
    // https://m.media-amazon.com/images/I/51Di4bc19jL.__AC_SX300_SY300_QL70_ML2_.jpg

    // 画像IDを取り出す（prefixの後ろと、ドット（.）より前まで）
    // 例: "51Di4bc19jL"
    const idMatch = originalUrl.match(/https:\/\/m\.media-amazon\.com\/images\/I\/([^\.]+)\./)

    if (!idMatch || !idMatch[1]) return undefined

    const imageId = idMatch[1]

    // 新しいURLフォーマットに埋め込む
    const newUrl = `https://m.media-amazon.com/images/I/${imageId}.jpg_BO30,255,255,255_UF900,850_SR1910,1000,0,AmazonEmber,50,4,0,0_QL100_.jpg`

    return newUrl
  }

  static findTargetAmazonImageFromMeta(meta) {
    const prefix = "https://m.media-amazon.com/images/I/"

    // 画像が存在しない場合はundefinedを返す
    if (!meta.images || meta.images.length === 0) {
      return undefined
    }

    // 条件に合うURLを探す（_SXまたは_SYのいずれかを含む）
    const imageUrl = meta.images.find(url =>
      url &&
      url.startsWith(prefix) &&
      (url.includes("_SX") || url.includes("_SY"))
    )

    if (!imageUrl) return undefined

    // originalUrl例: 
    // https://m.media-amazon.com/images/I/51Di4bc19jL.__AC_SX300_SY300_QL70_ML2_.jpg

    // 画像IDを取り出す（prefixの後ろと、ドット（.）より前まで）
    // 例: "51Di4bc19jL"
    const idMatch = imageUrl.match(/https:\/\/m\.media-amazon\.com\/images\/I\/([^\.]+)\./)

    if (!idMatch || !idMatch[1]) return undefined

    const imageId = idMatch[1]

    // 新しいURLフォーマットに埋め込む
    const newUrl = `https://m.media-amazon.com/images/I/${imageId}.jpg_BO30,255,255,255_UF900,850_SR1910,1000,0,AmazonEmber,50,4,0,0_QL100_.jpg`

    return newUrl
  }
}

export default OgImage
