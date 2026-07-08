import * as tus from 'tus-js-client'

/**
 * Resumable upload to Supabase Storage over the TUS protocol — for large video files
 * where a single PUT gives no progress and a dropped connection means starting over.
 * tus reports real byte progress and (via its fingerprint) can resume an interrupted
 * upload of the same file. Returns an error message, or null on success. Kept out of
 * lib/upload.ts so that module (and its tests) stay tus-free; performUpload takes this
 * as an injected `transfer`.
 *
 * Supabase requires 6 MB chunks (except the last) and goes through the same bucket
 * policies (RLS folder-scope, allowed_mime_types, file_size_limit) as .upload().
 */
export function resumableUpload(opts: {
  supabaseUrl: string
  accessToken: string
  bucket: string
  path: string
  file: File
  contentType?: string
  onProgress?: (fraction: number) => void
}): Promise<string | null> {
  return new Promise((resolve) => {
    const upload = new tus.Upload(opts.file, {
      endpoint: `${opts.supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${opts.accessToken}`,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: {
        bucketName: opts.bucket,
        objectName: opts.path,
        contentType: opts.contentType ?? '',
        cacheControl: '3600',
      },
      onError: (error) => resolve(error.message || 'Upload failed.'),
      onProgress: (bytesUploaded, bytesTotal) => opts.onProgress?.(bytesTotal ? bytesUploaded / bytesTotal : 0),
      onSuccess: () => resolve(null),
    })

    // Resume an interrupted upload of the same file if one is fingerprinted locally.
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0])
      upload.start()
    })
  })
}
