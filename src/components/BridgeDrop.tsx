'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Wifi, Smartphone, Tablet, Check, Loader2, Share2, ArrowRight, X, Copy, Files, RefreshCw, ScanLine } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

// AZURE API ENDPOINT (To be configured in Azure API Management)
const API_BASE_URL = process.env.NEXT_PUBLIC_AZURE_API_URL || '/api';

interface FileMeta {
  name: string;
  sizeBytes: number;
  mimeType: string;
  blobUrl?: string;
}

export default function BridgeDrop() {
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
      qrScannerRef.current?.stop().catch(() => {});
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
            scanner.stop().catch(() => {});
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
          () => {}
        );
      } catch (err) {
        setScanError('Camera access denied.');
      }
    };
    startScanner();
    return () => {
      cancelled = true;
      qrScannerRef.current?.stop().catch(() => {});
      qrScannerRef.current = null;
    };
  }, [mode, receiverTab]);

  // ==========================================
  // AZURE INTEGRATION: RECEIVER LOGIC
  // ==========================================
  const fetchRoomMetadata = async (code: string) => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      // CW1 Workflow: GET request to Azure Logic Apps/API Management
      // This retrieves the Cosmos DB metadata and Blob Storage URLs
      const response = await fetch(`${API_BASE_URL}/room/${code}`);
      
      if (!response.ok) throw new Error('Room not found or expired');
      
      const data = await response.json();
      setReceivedFiles(data.files); // Assuming Azure returns { files: [{name, blobUrl, mimeType}] }
      setStatus('success');
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err.message || 'Failed to fetch files');
    }
  };

  // ==========================================
  // AZURE INTEGRATION: SENDER LOGIC (Valet Key Pattern)
  // ==========================================
  const handleUploadToAzure = async (files: FileList) => {
    setStatus('loading');
    setErrorMsg(null);
    setProgress(0);

    try {
      const uploadedMeta: FileMeta[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // 1. Request SAS Token from our Next.js API
        const sasResponse = await fetch(`${API_BASE_URL}/upload/generate-sas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: roomId, fileName: file.name, mimeType: file.type })
        });

        if (!sasResponse.ok) {
          const errBody = await sasResponse.json().catch(() => ({}));
          console.error('[generate-sas] failed:', sasResponse.status, errBody);
          throw new Error('Failed to generate secure upload token');
        }
        const { sasUrl, blobUrl } = await sasResponse.json();
        console.log('[generate-sas] received sasUrl:', sasUrl, 'blobUrl:', blobUrl);

        // 2. Upload heavy file DIRECTLY to Azure Blob Storage using PUT (Bypasses server limits)
        const uploadResponse = await fetch(sasUrl, {
          method: 'PUT',
          body: file,
          headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': file.type }
        });

        if (!uploadResponse.ok) throw new Error(`Azure Blob Storage rejected the file: ${file.name}`);

        // 3. Notify Cosmos DB that upload is complete
        const finalizeResponse = await fetch(`${API_BASE_URL}/upload/finalise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: roomId,
            fileName: file.name,
            blobUrl: blobUrl, // The clean URL without the SAS signature
            sizeBytes: file.size,
            mimeType: file.type
          })
        });

        if (!finalizeResponse.ok) throw new Error('Failed to save file metadata to database');

        // Update progress and local state
        setProgress(Math.round(((i + 1) / files.length) * 100));
        uploadedMeta.push({ name: file.name, sizeBytes: file.size, mimeType: file.type, blobUrl: blobUrl });
      }

      setSentFiles(prev => [...prev, ...uploadedMeta]);
      setStatus('success');

    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err.message || 'Upload failed.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
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
                  setRoomId(Math.random().toString(36).substring(2, 8).toUpperCase()); 
                  setMode('sender');
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
                    {status === 'loading' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wifi className="w-3 h-3"/>}
                    <span className="text-xs font-bold uppercase tracking-widest">{status === 'loading' ? 'Processing...' : status}</span>
                  </div>
                </div>

                <div className="text-center">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-1">Room ID</span>
                  <div className="text-4xl font-mono font-bold text-slate-800 tracking-wider flex items-center justify-center gap-2">
                    {roomId} <Copy className="w-4 h-4 text-slate-300 cursor-pointer" onClick={() => navigator.clipboard.writeText(roomId)}/>
                  </div>
                  {mode === 'sender' && (
                    <div className="flex justify-center mt-4">
                      <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200">
                        <QRCodeSVG value={`${typeof window !== 'undefined' ? window.location.origin : ''}?room=${roomId}`} size={120} level={"M"} className="rounded-lg"/>
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
                    <div key={idx} className="bg-white/60 border border-blue-500/20 rounded-[1.5rem] p-4 flex flex-col gap-3 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="bg-blue-100 p-2 rounded-full text-blue-600 shrink-0"><Check size={16} /></div>
                        <span className="text-sm text-slate-700 font-semibold truncate">{file.name}</span>
                      </div>
                      {mode === 'receiver' && file.blobUrl && (
                        <a href={file.blobUrl} target="_blank" rel="noreferrer" className="mt-2 bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-xl text-center hover:bg-blue-600 transition-colors">
                          Download from Azure
                        </a>
                      )}
                    </div>
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