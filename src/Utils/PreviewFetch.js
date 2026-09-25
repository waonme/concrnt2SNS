const REQUEST_TIMEOUT_MS = 3000

// Shared bounds for the optional summary, HTML and image reads in a link preview.
export async function fetchPreviewBytes(url, { maxBytes, signal, ...options }) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Unsupported preview URL protocol')
  }

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const response = await fetch(parsed.href, {
    ...options,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Preview request failed with status ${response.status}`)
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    throw new Error('Preview response exceeds size limit')
  }

  const chunks = []
  let length = 0
  const reader = response.body?.getReader()
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > maxBytes) {
          await reader.cancel()
          throw new Error('Preview response exceeds size limit')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  return {
    bytes: Buffer.concat(chunks, length),
    contentType: response.headers.get('content-type') || '',
  }
}
