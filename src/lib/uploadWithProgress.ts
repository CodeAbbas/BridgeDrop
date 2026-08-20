/**
 * uploadWithProgress — PUT a File to Azure Blob Storage with byte-level progress.
 *
 * Why XHR and not fetch: as of 2026 `fetch` still has no upload progress event.
 * Request-body streaming (`duplex: 'half'`) exists in Chromium but is unsupported
 * in Safari and unavailable over HTTP/1.1, which rules it out for a tool whose
 * whole premise is working on older iOS. XMLHttpRequest's `upload.onprogress`
 * is the only option with universal support, so we keep it isolated here rather
 * than letting XHR leak into the component.
 *
 * Contract:
 *   - Resolves on 2xx.
 *   - Rejects with UploadError on any non-2xx or network failure.
 *   - Rejects with a DOMException named 'AbortError' when cancelled via `signal`,
 *     matching fetch's behaviour so callers can branch on `err.name` uniformly.
 *
 * The Content-Type header MUST match the value pinned into the SAS at mint time
 * or Storage rejects the PUT with 403.
 */

export interface UploadProgress {
  /** Bytes transferred so far. */
  loaded: number;
  /** Total bytes for this file. */
  total: number;
  /** Integer 0–100. */
  percent: number;
}

export interface UploadWithProgressOptions {
  /** The write-scoped SAS URL from /api/upload/generate-sas. */
  url: string;
  file: File;
  /** Must match the mimeType sent to generate-sas. */
  mimeType: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export class UploadError extends Error {
  /** HTTP status, or 0 for a transport-level failure. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

function abortError(): DOMException {
  return new DOMException('Upload cancelled.', 'AbortError');
}

export function uploadWithProgress({
  url,
  file,
  mimeType,
  onProgress,
  signal,
}: UploadWithProgressOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
    xhr.setRequestHeader('Content-Type', mimeType);

    const handleAbort = () => xhr.abort();
    signal?.addEventListener('abort', handleAbort, { once: true });
    const cleanup = () => signal?.removeEventListener('abort', handleAbort);

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      // `lengthComputable` is false in rare cases (some proxies); fall back to
      // the File's own size, which we always know.
      const total = event.lengthComputable ? event.total : file.size;
      if (total <= 0) return;
      onProgress({
        loaded: event.loaded,
        total,
        percent: Math.min(100, Math.round((event.loaded / total) * 100)),
      });
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        // The final progress event can arrive a beat before onload, and can
        // stop short of 100 on small files. Snap it closed so the bar never
        // sits at 97% on a finished upload.
        onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
        resolve();
        return;
      }
      reject(
        new UploadError(
          `Storage rejected "${file.name}" (HTTP ${xhr.status}).`,
          xhr.status,
        ),
      );
    };

    xhr.onerror = () => {
      cleanup();
      reject(new UploadError(`Connection lost while uploading "${file.name}".`, 0));
    };

    xhr.onabort = () => {
      cleanup();
      reject(abortError());
    };

    xhr.send(file);
  });
}
