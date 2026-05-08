'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Wifi, Smartphone, Tablet, Check, Loader2, Share2, ArrowRight, X, Copy, Files, RefreshCw, ScanLine } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { FileCard } from './FileCard';
import { getAppInsights } from '@/lib/appInsights';

// AZURE API ENDPOINT (To be configured in Azure API Management)
const API_BASE_URL = '/api';

interface FileMeta {
  id?: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  blobUrl?: string;
  uploadedAt?: string;
}
// --- API response contracts (src/app/api/...) ---------------------
interface SasResponse {
  sasUrl: string;
  blobUrl: string;
  blobName: string;
  expiresAt: string;
}

interface FinaliseResponse {
  id: string;
  roomId: string;
  name: string;
  blobUrl: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

interface RoomFile {
  id: string;
  name: string;
  blobUrl: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: string;
}

interface RoomResponse {
  files: RoomFile[];
}
async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error.length > 0) {
      return body.error;
    }
  } catch {
    /* response wasn't JSON — fall through */
  }
  return fallback;
}
export default function BridgeDrop() {
  const appInsights = getAppInsights();
  const [mode, setMode] = useState<'home' | 'sender' | 'receiver' | 'receiver_input'>('home');
  const [roomId, setRoomId] = useState('');

  // Simplified HTTP States instead of WebRTC states
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const [sentFiles, setSentFiles] = useState<FileMeta[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<FileMeta[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [receiverTab, setReceiverTab] = useState<'code' | 'scan'>('code');
  const qrScannerRef = useRef<import('html5-qrcode').Html5Qrcode | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const hasFiles = (mode === 'sender' && sentFiles.length > 0) || (mode === 'receiver' && receivedFiles.length > 0);

  // Handle URL auto-join
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const roomParam = urlParams.get('room');
      if (roomParam && roomParam.length === 6) {
        setRoomId(roomParam.toUpperCase());
        setMode('receiver');
        fetchRoomMetadata(roomParam.toUpperCase());
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, []);

  // QR Scanner Logic (Unchanged)
  useEffect(() => {
    if (mode !== 'receiver_input' || receiverTab !== 'scan') {
      qrScannerRef.current?.stop().catch(() => { });
      qrScannerRef.current = null;
      setScanError(null);
      return;
    }
    let cancelled = false;
    const startScanner = async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (cancelled) return;
      const scanner = new Html5Qrcode('qr-reader');
      qrScannerRef.current = scanner;
      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            scanner.stop().catch(() => { });
            qrScannerRef.current = null;
            let code = decodedText.trim().toUpperCase();
            try {
              const url = new URL(decodedText);
              const param = url.searchParams.get('room');
              if (param) code = param.toUpperCase();
            } catch { /* not a URL */ }

            if (code.length === 6) {
              setRoomId(code);
              setMode('receiver');
              fetchRoomMetadata(code);
            } else {
              setScanError('Invalid QR code.');
            }
          },
          () => { }
        );
      } catch (err) {
        setScanError('Camera access denied.');
      }
    };
    startScanner();
    return () => {
      cancelled = true;
      qrScannerRef.current?.stop().catch(() => { });
      qrScannerRef.current = null;
    };
  }, [mode, receiverTab]);
  // polling logic for receiver to update file list in real-time (every 4 seconds)
  useEffect(() => {
    if (mode !== 'receiver' || !roomId) return;

    const POLL_INTERVAL_MS = 4000;

    const refresh = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/room/${roomId}`, {
          cache: 'no-store',
        });
        if (!response.ok) return; // silent — initial fetch handles the loud errors

        const data = (await response.json()) as RoomResponse;

        setReceivedFiles((prev) => {
          const next: FileMeta[] = data.files.map((f) => ({
            id: f.id,
            name: f.name,
            sizeBytes: f.sizeBytes,
            mimeType: f.mimeType,
            blobUrl: f.blobUrl,
            uploadedAt: f.uploadedAt,
          }));
          // Bail out early when nothing changed — preserves referential
          // equality so React skips re-rendering the file list entirely.
          if (
            prev.length === next.length &&
            prev.every((p, i) => p.id === next[i].id)
          ) {
            return prev;
          }
          return next;
        });
      } catch (err) {
        console.warn('[room-poll] silent failure:', err);
      }
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void refresh();
    }, POLL_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [mode, roomId]);

  // ==========================================
  // AZURE INTEGRATION: RECEIVER LOGIC
  // ==========================================
  const fetchRoomMetadata = async (code: string) => {
    setStatus('loading');
    setErrorMsg(null);

    try {
      const response = await fetch(`${API_BASE_URL}/room/${code}`, {
        // Always hit the server; never serve stale Cosmos data from the cache.
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'Room not found or expired'));
      }

      const data = (await response.json()) as RoomResponse;

      // Map server shape → local FileMeta. Names already align, but the
      // explicit map keeps the contract obvious if either side changes.
      setReceivedFiles(
        data.files.map((f) => ({
          id: f.id,
          name: f.name,
          sizeBytes: f.sizeBytes,
          mimeType: f.mimeType,
          blobUrl: f.blobUrl, // already carries a 1-hour read SAS
          uploadedAt: f.uploadedAt,
        })),
      );
      setStatus('success');

      // Telemetry — only fires on the manual join, not on the polling refresh
      appInsights.trackEvent('RoomJoined', {
        roomId: code,
        fileCount: data.files.length,
      });

    } catch (err) {
      console.error('[fetchRoomMetadata]', err);
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch files');
      appInsights.trackException(err as Error, { context: 'fetchRoomMetadata', roomId: code });
    }
  };

  // ==========================================
  // AZURE INTEGRATION: SENDER LOGIC (Valet Key Pattern)
  // ==========================================
  const handleUploadToAzure = async (files: FileList) => {
    if (files.length === 0) return;

    setStatus('loading');
    setErrorMsg(null);
    setProgress(0);

    try {
      const uploadedMeta: FileMeta[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Some browsers/OS combos leave file.type empty (e.g. unknown extensions).
        // Default to a generic binary type so the SAS contentType pin still works.
        const mimeType = file.type || 'application/octet-stream';

        // -- 1. Mint a write-only SAS URL via our Next.js route ---------------
        const sasResponse = await fetch(`${API_BASE_URL}/upload/generate-sas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            fileName: file.name,
            mimeType,
          }),
        });

        if (!sasResponse.ok) {
          throw new Error(
            await readApiError(sasResponse, 'Failed to generate secure upload token'),
          );
        }
        const { sasUrl, blobUrl } = (await sasResponse.json()) as SasResponse;

        // -- 2. PUT the bytes directly to Azure Blob Storage ------------------
        // Content-Type MUST match the value pinned in the SAS — Storage will
        // reject the PUT with 403 otherwise.
        const putResponse = await fetch(sasUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'x-ms-blob-type': 'BlockBlob',
            'Content-Type': mimeType,
          },
        });

        if (!putResponse.ok) {
          throw new Error(
            `Azure Blob Storage rejected "${file.name}" (HTTP ${putResponse.status})`,
          );
        }

        // -- 3. Register the upload in Cosmos DB ------------------------------
        const finaliseResponse = await fetch(`${API_BASE_URL}/upload/finalise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            fileName: file.name,
            blobUrl,           // clean URL, no SAS — server validates the prefix
            sizeBytes: file.size,
            mimeType,
          }),
        });

        if (!finaliseResponse.ok) {
          throw new Error(
            await readApiError(finaliseResponse, 'Failed to save file metadata'),
          );
        }
        const finalised = (await finaliseResponse.json()) as FinaliseResponse;

        uploadedMeta.push({
          id: finalised.id,
          name: file.name,
          sizeBytes: file.size,
          mimeType,
          blobUrl: URL.createObjectURL(file), //blobUrl, 
          uploadedAt: finalised.uploadedAt,
        });

        // Telemetry — fires once per successful file
        appInsights.trackEvent('FileUploaded', {
          roomId,
          fileId: finalised.id,
          sizeBytes: file.size,
          mimeType,
        });

        setProgress(Math.round(((i + 1) / files.length) * 100));
      }

      setSentFiles((prev) => [...prev, ...uploadedMeta]);
      setStatus('success');
    } catch (err) {
      console.error('[handleUploadToAzure]', err);
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed.');
      appInsights.trackException(err as Error, { context: 'handleUploadToAzure', roomId });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  // ==========================================
  // AZURE INTEGRATION: SENDER LOGIC (Update)
  // ==========================================
  // Optimistic rename — flip the local UI immediately, send the PATCH, revert
  // on failure. The receiver sees the new name within ~4s via polling.
  const handleRenameFile = async (id: string, newName: string) => {
    // Capture the pre-update value so we can revert if the API call fails.
    const target = sentFiles.find((f) => f.id === id);
    if (!target) return;
    const previousName = target.name;

    // Optimistic update.
    setSentFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name: newName } : f)),
    );

    try {
      const response = await fetch(
        `${API_BASE_URL}/file/${id}?roomId=${roomId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Failed to rename file'));
      }

      appInsights.trackEvent('FileRenamed', {
        roomId,
        fileId: id,
        oldNameLength: previousName.length,
        newNameLength: newName.length,
      });

    } catch (err) {
      // Revert on failure.
      setSentFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, name: previousName } : f)),
      );
      setErrorMsg(err instanceof Error ? err.message : 'Rename failed');
      // Re-throw so the FileCard knows the rename was rejected and can exit
      // its saving state cleanly.
      appInsights.trackException(err as Error, { context: 'handleRenameFile', fileId: id });
      throw err;
    }
  };

  // ==========================================
  // AZURE INTEGRATION: SENDER LOGIC (Delete)
  // ==========================================
  // Optimistic delete — remove from local state first, send DELETE, restore
  // on failure. The receiver sees the file disappear within ~4s via polling.
  const handleDeleteFile = async (id: string) => {
    // Snapshot the file we're about to remove, so we can restore it on error.
    const target = sentFiles.find((f) => f.id === id);
    if (!target) return;

    // Optimistic update.
    setSentFiles((prev) => prev.filter((f) => f.id !== id));

    try {
      const response = await fetch(
        `${API_BASE_URL}/file/${id}?roomId=${roomId}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response, 'Failed to delete file'));
      }

      appInsights.trackEvent('FileDeleted', {
        roomId,
        fileId: id,
        sizeBytes: target.sizeBytes,
        mimeType: target.mimeType,
      });

    } catch (err) {
      // Revert on failure — re-insert the file in its original position.
      setSentFiles((prev) => {
        const idx = sentFiles.findIndex((f) => f.id === id);
        const next = [...prev];
        next.splice(Math.max(0, idx), 0, target);
        return next;
      });
      setErrorMsg(err instanceof Error ? err.message : 'Delete failed');
      appInsights.trackException(err as Error, { context: 'handleDeleteFile', fileId: id });
      throw err;
    }
  };

  const reset = () => {
    setMode('home');
    setRoomId('');
    setReceiverTab('code');
    setStatus('idle');
    setProgress(0);
    setSentFiles([]);
    setReceivedFiles([]);
    setErrorMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const blobStyle = "absolute rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob pointer-events-none";

  return (
    <div className="min-h-screen relative overflow-hidden bg-slate-50 font-sans selection:bg-blue-500 selection:text-white flex items-center justify-center p-4">
      {/* Ambient Background Blobs */}
      <div className="absolute inset-0 w-full h-full overflow-hidden z-0">
        <div className={`top-0 -left-4 w-72 h-72 bg-purple-300 ${blobStyle}`}></div>
        <div className={`top-0 -right-4 w-72 h-72 bg-blue-300 ${blobStyle} delay-2000`}></div>
        <div className={`-bottom-8 left-20 w-72 h-72 bg-indigo-300 ${blobStyle} delay-4000`}></div>
      </div>

      <div className={`relative z-10 w-full bg-white/40 backdrop-blur-2xl border border-white/50 shadow-2xl rounded-[2.5rem] p-6 lg:p-8 flex flex-col transition-all duration-700 ease-in-out max-h-[90vh] ${hasFiles ? 'max-w-md lg:max-w-5xl' : 'max-w-md'}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="bg-white/50 p-2.5 rounded-full shadow-sm backdrop-blur-md">
              <Share2 className="text-blue-600 w-5 h-5" />
            </div>
            <span className="font-semibold text-slate-800 tracking-tight text-lg">BridgeDrop</span>
          </div>
          {mode !== 'home' && (
            <button onClick={reset} className="p-2 bg-white/30 hover:bg-white/50 rounded-full transition-colors">
              <X className="w-5 h-5 text-slate-600" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className={`flex flex-col ${hasFiles ? 'lg:flex-row lg:gap-8' : ''} flex-1 min-h-0`}>

          {/* Controls */}
          <div className={`flex flex-col w-full ${hasFiles ? 'lg:w-[380px] lg:shrink-0' : ''} overflow-y-auto custom-scrollbar pb-2 pr-2`}>

            {mode === 'home' && (
              <div className="space-y-4 pt-2 animate-in fade-in">
                <div className="text-center mb-8">
                  <h1 className="text-3xl font-bold text-slate-800 tracking-tight mb-2">Cloud Share</h1>
                  <p className="text-slate-500 font-medium">Azure Serverless Transfer</p>
                </div>
                <button onClick={() => {
                  const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
                  setRoomId(newRoomId);
                  setMode('sender');
                  appInsights.trackEvent('RoomCreated', { roomId: newRoomId });
                }} className="w-full bg-white/60 hover:bg-white/80 border border-white/60 rounded-[1.5rem] p-5 flex items-center justify-between group transition-all shadow-sm">
                  <div className="flex items-center space-x-4">
                    <div className="bg-blue-100/50 p-3 rounded-full"><Smartphone className="w-6 h-6 text-blue-600" /></div>
                    <div className="text-left">
                      <h3 className="font-bold text-slate-800">Send</h3>
                      <p className="text-xs text-slate-500 uppercase tracking-wide">Create Room</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600" />
                </button>
                <button onClick={() => setMode('receiver_input')} className="w-full bg-white/60 hover:bg-white/80 border border-white/60 rounded-[1.5rem] p-5 flex items-center justify-between group transition-all shadow-sm">
                  <div className="flex items-center space-x-4">
                    <div className="bg-emerald-100/50 p-3 rounded-full"><Tablet className="w-6 h-6 text-emerald-600" /></div>
                    <div className="text-left">
                      <h3 className="font-bold text-slate-800">Receive</h3>
                      <p className="text-xs text-slate-500 uppercase tracking-wide">Enter Code</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600" />
                </button>
              </div>
            )}

            {mode === 'receiver_input' && (
              <div className="space-y-5 pt-4 animate-in fade-in">
                <div className="flex bg-white/40 border border-white/50 rounded-2xl p-1 gap-1">
                  <button onClick={() => setReceiverTab('code')} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${receiverTab === 'code' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>Enter Code</button>
                  <button onClick={() => setReceiverTab('scan')} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${receiverTab === 'scan' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}><ScanLine className="w-4 h-4" /> Scan QR</button>
                </div>
                {receiverTab === 'code' && (
                  <div className="text-center space-y-4">
                    <input autoFocus placeholder="XXXXXX" maxLength={6} className="w-full bg-white/40 border border-white/50 text-center text-4xl font-mono font-bold tracking-[0.2em] py-6 rounded-[2rem] outline-none focus:ring-4 ring-blue-500/10 uppercase"
                      onChange={(e) => {
                        const v = e.target.value.toUpperCase();
                        if (v.length === 6) { setRoomId(v); setMode('receiver'); fetchRoomMetadata(v); }
                      }}
                    />
                  </div>
                )}
                {receiverTab === 'scan' && (
                  <div className="relative overflow-hidden rounded-[2rem] bg-black/5 border border-white/40">
                    <div id="qr-reader" className="w-full" />
                  </div>
                )}
              </div>
            )}

            {(mode === 'sender' || mode === 'receiver') && (
              <div className="space-y-6 animate-in fade-in">
                <div className="flex justify-center">
                  <div className={`px-5 py-2 rounded-full backdrop-blur-md border border-white/20 flex items-center space-x-2 shadow-sm ${status === 'error' ? 'bg-red-500/10 text-red-700' : 'bg-blue-500/10 text-blue-700'}`}>
                    {status === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
                    <span className="text-xs font-bold uppercase tracking-widest">{status === 'loading' ? 'Processing...' : status}</span>
                  </div>
                </div>

                <div className="text-center">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-1">Room ID</span>
                  <div className="text-4xl font-mono font-bold text-slate-800 tracking-wider flex items-center justify-center gap-2">
                    {roomId} <Copy className="w-4 h-4 text-slate-300 cursor-pointer" onClick={() => navigator.clipboard.writeText(roomId)} />
                  </div>
                  {mode === 'sender' && (
                    <div className="flex justify-center mt-4">
                      <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200">
                        <QRCodeSVG value={`${typeof window !== 'undefined' ? window.location.origin : ''}?room=${roomId}`} size={120} level={"M"} className="rounded-lg" />
                      </div>
                    </div>
                  )}
                </div>

                {mode === 'sender' && (
                  <div className="pt-2">
                    <label className={`block group relative cursor-pointer ${status === 'loading' ? 'opacity-50 pointer-events-none' : ''}`}>
                      <div className="relative h-48 bg-white/40 border-2 border-dashed border-white/60 hover:border-blue-400/50 rounded-[2rem] flex flex-col items-center justify-center transition-all hover:scale-[1.02] active:scale-95">
                        <div className="bg-white/60 p-4 rounded-full mb-3 shadow-sm"><Files className="w-6 h-6 text-blue-600" /></div>
                        <span className="font-semibold text-slate-700">Tap to Upload</span>
                      </div>
                      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && handleUploadToAzure(e.target.files)} />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Render Files List */}
          {hasFiles && (
            <>
              <div className="hidden lg:block w-px bg-white/40 rounded-full shrink-0"></div>
              <div className="block lg:hidden h-px w-full bg-white/40 my-6 rounded-full shrink-0"></div>

              <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar pb-2 pr-2 animate-in slide-in-from-right-4">
                <div className="sticky top-0 bg-slate-50/80 backdrop-blur-xl py-3 z-10 rounded-2xl px-4 flex justify-between items-center shadow-sm border border-white/50 mb-3">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Files</p>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {(mode === 'sender' ? sentFiles : receivedFiles).map((file, idx) => (
                    <FileCard
                      key={file.id ?? `${file.name}-${idx}`}
                      file={file}
                      mode={mode === 'sender' ? 'sender' : 'receiver'}
                      onRename={mode === 'sender' ? handleRenameFile : undefined}
                      onDelete={mode === 'sender' ? handleDeleteFile : undefined}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
