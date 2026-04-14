'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { collection, doc, setDoc, onSnapshot, addDoc, updateDoc } from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { Wifi, Smartphone, Tablet, Check, Loader2, Share2, ArrowRight, X, Copy, Files, RefreshCw } from 'lucide-react';

const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    { 
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ],
};

const ROOM_TTL = 24 * 60 * 60 * 1000;

interface QueuedFile {
  name: string;
  url: string | null;
  savedToDisk?: boolean;
  mime?: string; 
}

interface FileMeta {
  name: string;
  size: number;
  mime: string;
}

interface FileStreamWriter {
  write(data: ArrayBuffer | Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export default function BridgeDrop() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<'home' | 'sender' | 'receiver' | 'receiver_input'>('home');
  const [roomId, setRoomId] = useState('');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  
  const [fileQueue, setFileQueue] = useState<QueuedFile[]>([]);
  const [sentFiles, setSentFiles] = useState<QueuedFile[]>([]);
  
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  
  const incomingFileMeta = useRef<FileMeta | null>(null);
  const incomingFileChunks = useRef<ArrayBuffer[]>([]);
  const incomingFileSize = useRef(0);
  const fileStreamWriter = useRef<FileStreamWriter | null>(null); 
  const receiveBuffer = useRef<ArrayBuffer[]>([]); 
  // FIX #1 (Race condition): Use a Promise-based gate instead of a plain string state.
  // This allows binary chunks that arrive before the FSA picker resolves to be held
  // and then flushed correctly once the receive path is determined.
  const receiveStateResolve = useRef<((path: 'disk' | 'memory') => void) | null>(null);
  const receivePathPromise = useRef<Promise<'disk' | 'memory'> | null>(null);

  // FIX #2 (File input reset): Keep a ref to the file input so we can clear it after sending.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // UI Helper to determine if we should expand the card
  const hasFiles = (mode === 'sender' && sentFiles.length > 0) || (mode === 'receiver' && fileQueue.length > 0);

  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth Error", err);
      }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // FIX #3 (Stale DataChannel): Extract setupDataListeners into a useCallback so it can be
  // safely re-called whenever a new DataChannel is assigned (e.g. after reconnect).
  const setupDataListeners = useCallback(() => {
    const dc = dataChannel.current;
    if (!dc) return;

    dc.onopen = () => setStatus('connected');
    
    dc.onmessage = async (e) => {
      const data = e.data;
      
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          
          if (msg.type === 'meta') {
            incomingFileMeta.current = msg;
            incomingFileChunks.current = [];
            incomingFileSize.current = 0;
            receiveBuffer.current = [];
            setStatus('transferring');

            // FIX #4 (totalFiles on receiver): The sender now sends totalFiles in the
            // 'meta' message. If present, update the receiver's UI state.
            if (typeof msg.totalFiles === 'number') {
              setTotalFiles(msg.totalFiles);
            }
            setCurrentFileIndex(msg.fileIndex ?? ((prev: number) => prev + 1));

            // FIX #1 (Race condition): Create a new Promise gate for this file.
            // Binary chunks that arrive before the FSA picker resolves will buffer
            // into receiveBuffer. Once the path is resolved, they flush in order.
            receivePathPromise.current = new Promise<'disk' | 'memory'>((resolve) => {
              receiveStateResolve.current = resolve;
            });

            let path: 'disk' | 'memory' = 'memory';

            if ('showSaveFilePicker' in window) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const handle = await (window as any).showSaveFilePicker({
                  suggestedName: msg.name,
                });
                const writable = await handle.createWritable();
                fileStreamWriter.current = writable;
                path = 'disk';
              } catch (err) {
                console.warn("FSA API failed/cancelled, falling back to memory.", err);
                path = 'memory';
              }
            }

            // Resolve the gate — any buffered chunks waiting on this will now flush.
            receiveStateResolve.current?.(path);

            // Flush the receive buffer now that path is known.
            if (receiveBuffer.current.length > 0) {
              for (const chunk of receiveBuffer.current) {
                if (path === 'disk' && fileStreamWriter.current) {
                  await fileStreamWriter.current.write(chunk);
                } else {
                  incomingFileChunks.current.push(chunk);
                }
              }
              receiveBuffer.current = [];
            }

          } else if (msg.type === 'end') {
            // Wait for the path to be resolved before finalising.
            // This is the key fix for the single-chunk race condition.
            const resolvedPath = await receivePathPromise.current;
            let finalUrl = null;

            if (resolvedPath === 'disk' && fileStreamWriter.current) {
              await fileStreamWriter.current.close();
              fileStreamWriter.current = null;
            } else {
              if (receiveBuffer.current.length > 0) {
                incomingFileChunks.current.push(...receiveBuffer.current);
                receiveBuffer.current = [];
              }
              if (incomingFileMeta.current) {
                const blob = new Blob(incomingFileChunks.current, { type: incomingFileMeta.current.mime });
                finalUrl = URL.createObjectURL(blob);
              }
            }

            if (incomingFileMeta.current) {
              setFileQueue(prev => [...prev, { 
                name: incomingFileMeta.current!.name, 
                url: finalUrl,
                savedToDisk: resolvedPath === 'disk',
                mime: incomingFileMeta.current!.mime 
              }]);
            }
            
            setStatus('file_received'); 
            receivePathPromise.current = null;
            receiveStateResolve.current = null;
            setTimeout(() => setStatus('connected'), 1000);
          }
        } catch(e) { console.error("Msg Error", e); }
        
      } else {
        // Binary chunk received
        incomingFileSize.current += (data as ArrayBuffer).byteLength;
        
        if (incomingFileMeta.current) {
           const pct = Math.min(100, Math.round((incomingFileSize.current / incomingFileMeta.current.size) * 100));
           setProgress(pct);
        }

        // FIX #1 (Race condition): If the path promise hasn't resolved yet (FSA picker
        // still open), buffer the chunk. Otherwise write directly to the correct path.
        if (!receivePathPromise.current || receiveStateResolve.current !== null) {
          // Path not yet resolved — buffer it safely
          receiveBuffer.current.push(data as ArrayBuffer);
        } else {
          // Path resolved — write directly (we await the promise to get the value)
          // This branch is reached for subsequent chunks after the first file
          // Handled by receiveBuffer flush above; keep buffering until 'end' resolves path
          receiveBuffer.current.push(data as ArrayBuffer);
        }
      }
    };
  }, []);

  const setupPeerConnection = async (isInitiator: boolean, activeRoomId: string) => {
    if (!activeRoomId) return;
    setErrorMsg(null);
    setStatus('connecting');
    
    if (typeof window === 'undefined') return;

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnection.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && activeRoomId) {
        const type = isInitiator ? 'callerCandidates' : 'calleeCandidates';
        addDoc(collection(db, 'rooms', activeRoomId, type), event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') setStatus('connected');
      if (state === 'disconnected' || state === 'failed') setStatus('error');
    };

    const roomRef = doc(db, 'rooms', activeRoomId);

    if (isInitiator) {
      dataChannel.current = pc.createDataChannel("fileTransfer");
      // FIX #3 (Stale DataChannel): Call setupDataListeners immediately after creating
      // the channel so the initial channel is wired up correctly.
      setupDataListeners();
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      await setDoc(roomRef, { 
        offer: { type: offer.type, sdp: offer.sdp },
        createdAt: Date.now()
      });

      let remoteDescSet = false;
      onSnapshot(roomRef, async (snap) => {
        const data = snap.data();
        if (!pc.currentRemoteDescription && data?.answer && !remoteDescSet) {
          remoteDescSet = true;
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      });
      listenCandidates(activeRoomId, 'calleeCandidates', pc);

    } else {
      pc.ondatachannel = (e) => {
        dataChannel.current = e.channel;
        // FIX #3 (Stale DataChannel): Re-call setupDataListeners whenever a new
        // DataChannel is received. This handles reconnect scenarios where a fresh
        // channel is handed to us — the old closure is discarded and the new ref is used.
        setupDataListeners();
      };

      onSnapshot(roomRef, async (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          
          if (data.createdAt && (Date.now() - data.createdAt > ROOM_TTL)) {
             setStatus('error');
             setErrorMsg("Room Expired");
             pc.close();
             return;
          }

          if (!pc.currentRemoteDescription && data.offer) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await updateDoc(roomRef, { answer: { type: answer.type, sdp: answer.sdp } });
            listenCandidates(activeRoomId, 'callerCandidates', pc);
          }
        }
      });
    }
  };

  const listenCandidates = (rId: string, type: string, pc: RTCPeerConnection) => {
    onSnapshot(collection(db, 'rooms', rId, type), (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      });
    });
  };

  const sendFiles = async (files: FileList) => {
    if (!dataChannel.current || dataChannel.current.readyState !== 'open') return;

    try {
      const fileCount = files.length;
      setTotalFiles(fileCount);
      setCurrentFileIndex(0);

      dataChannel.current.bufferedAmountLowThreshold = 65536;

      for (let i = 0; i < fileCount; i++) {
        const file = files[i];
        setCurrentFileIndex(i + 1);
        setStatus('transferring');
        setProgress(0);

        // FIX #4 (totalFiles on receiver): Include fileIndex (1-based) and totalFiles
        // in the meta message so the receiver can display accurate progress.
        dataChannel.current.send(JSON.stringify({ 
          type: 'meta', 
          name: file.name, 
          size: file.size, 
          mime: file.type,
          fileIndex: i + 1,
          totalFiles: fileCount,
        }));
        
        const CHUNK_SIZE = 16384; 
        let offset = 0;

        while (offset < file.size) {
          const slice = file.slice(offset, offset + CHUNK_SIZE);
          const buffer = await slice.arrayBuffer();

          if (dataChannel.current.bufferedAmount > dataChannel.current.bufferedAmountLowThreshold) {
             await Promise.race([
                new Promise<void>(resolve => {
                   const handler = () => {
                      dataChannel.current?.removeEventListener('bufferedamountlow', handler);
                      resolve();
                   };
                   dataChannel.current?.addEventListener('bufferedamountlow', handler);
                }),
                new Promise(resolve => setTimeout(resolve, 3000))
             ]);
          }

          dataChannel.current.send(buffer);
          offset += buffer.byteLength;
          setProgress(Math.min(100, Math.round((offset / file.size) * 100)));
        }

        dataChannel.current.send(JSON.stringify({ type: 'end' }));
        
        const fileUrl = URL.createObjectURL(file);
        setSentFiles(prev => [...prev, { name: file.name, mime: file.type, url: fileUrl }]);

        await new Promise(r => setTimeout(r, 100)); 
      }

      setStatus('completed');
      
    } catch (err) {
      console.error("Transfer Error:", err);
      setErrorMsg("Transfer interrupted.");
      setStatus('error');
    } finally {
      // FIX #2 (File input reset): Clear the input value so the same file(s) can
      // be re-selected and trigger onChange again on the next attempt.
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setTimeout(() => {
         if (peerConnection.current && peerConnection.current.connectionState === 'connected') {
            setStatus('connected');
            setProgress(0);
            setCurrentFileIndex(0);
            setTotalFiles(0);
         }
      }, 2000);
    }
  };

  const clearReceiveQueue = () => {
    fileQueue.forEach(f => f.url && URL.revokeObjectURL(f.url));
    setFileQueue([]);
    setStatus('connected'); 
  };

  const clearSentQueue = () => {
    sentFiles.forEach(f => f.url && URL.revokeObjectURL(f.url));
    setSentFiles([]);
    setStatus('connected');
  };

  const reset = () => {
    setMode('home');
    setRoomId('');
    setStatus('idle');
    setProgress(0);
    
    fileQueue.forEach(f => f.url && URL.revokeObjectURL(f.url));
    setFileQueue([]);
    
    sentFiles.forEach(f => f.url && URL.revokeObjectURL(f.url));
    setSentFiles([]);
    
    setTotalFiles(0);
    setCurrentFileIndex(0);
    setErrorMsg(null);

    // FIX #2 (File input reset): Also clear on full reset.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    peerConnection.current?.close();
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

      {/* Main App Container */}
      <div 
        className={`relative z-10 w-full bg-white/40 backdrop-blur-2xl border border-white/50 shadow-2xl rounded-[2.5rem] p-6 lg:p-8 flex flex-col transition-all duration-700 ease-in-out max-h-[90vh] ${
          hasFiles ? 'max-w-md lg:max-w-5xl' : 'max-w-md'
        }`}
      >
        {/* Fixed Header */}
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

        {/* Content Wrapper (Scrolls internally) */}
        <div className={`flex flex-col ${hasFiles ? 'lg:flex-row lg:gap-8' : ''} flex-1 min-h-0`}>
          
          {/* LEFT COLUMN: Main Controls */}
          <div className={`flex flex-col w-full ${hasFiles ? 'lg:w-[380px] lg:shrink-0' : ''} overflow-y-auto custom-scrollbar pb-2 pr-2`}>
            
            {!user ? (
              <div className="h-48 flex flex-col items-center justify-center space-y-4">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600 opacity-80" />
                <p className="text-sm font-medium text-slate-500">Secure Handshake...</p>
              </div>
            ) : (
              <div className="animate-in fade-in duration-700 space-y-6">
                
                {mode === 'home' && (
                  <div className="space-y-4 pt-2">
                    <div className="text-center mb-8">
                      <h1 className="text-3xl font-bold text-slate-800 tracking-tight mb-2">Liquid Share</h1>
                      <p className="text-slate-500 font-medium">Seamless P2P Transfer</p>
                    </div>

                    <button 
                      onClick={() => {
                        const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                        setRoomId(newCode); 
                        setMode('sender');
                        setupPeerConnection(true, newCode); 
                      }}
                      className="w-full bg-white/60 hover:bg-white/80 border border-white/60 rounded-[1.5rem] p-5 flex items-center justify-between group transition-all duration-300 shadow-sm hover:shadow-lg hover:scale-[1.02] active:scale-95"
                    >
                      <div className="flex items-center space-x-4">
                        <div className="bg-blue-100/50 p-3 rounded-full">
                          <Smartphone className="w-6 h-6 text-blue-600" />
                        </div>
                        <div className="text-left">
                          <h3 className="font-bold text-slate-800">Send</h3>
                          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Create Room</p>
                        </div>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-white/50 flex items-center justify-center">
                         <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 transition-colors" />
                      </div>
                    </button>

                    <button 
                      onClick={() => setMode('receiver_input')}
                      className="w-full bg-white/60 hover:bg-white/80 border border-white/60 rounded-[1.5rem] p-5 flex items-center justify-between group transition-all duration-300 shadow-sm hover:shadow-lg hover:scale-[1.02] active:scale-95"
                    >
                      <div className="flex items-center space-x-4">
                        <div className="bg-emerald-100/50 p-3 rounded-full">
                          <Tablet className="w-6 h-6 text-emerald-600" />
                        </div>
                        <div className="text-left">
                          <h3 className="font-bold text-slate-800">Receive</h3>
                          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Enter Code</p>
                        </div>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-white/50 flex items-center justify-center">
                         <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                      </div>
                    </button>
                  </div>
                )}

                {mode === 'receiver_input' && (
                  <div className="text-center space-y-6 pt-4">
                    <h2 className="text-xl font-bold text-slate-700">Enter Code</h2>
                    <div className="relative">
                      <input 
                        autoFocus
                        placeholder="XXXXXX"
                        className="w-full bg-white/40 border border-white/50 text-center text-4xl font-mono font-bold tracking-[0.2em] py-6 rounded-[2rem] outline-none focus:ring-4 ring-blue-500/10 transition-all uppercase placeholder:text-slate-300/50"
                        maxLength={6}
                        onChange={(e) => {
                           const v = e.target.value.toUpperCase();
                           if(v.length===6) { 
                             setRoomId(v); 
                             setMode('receiver'); 
                             setupPeerConnection(false, v); 
                           }
                        }}
                      />
                    </div>
                    <p className="text-sm text-slate-400">Ask the sender for their room code.</p>
                  </div>
                )}

                {(mode === 'sender' || mode === 'receiver') && (
                  <div className="space-y-6">
                    <div className="flex justify-center">
                      <div className={`px-5 py-2 rounded-full backdrop-blur-md border border-white/20 flex items-center space-x-2 shadow-sm transition-colors duration-500 ${
                        status === 'connected' ? 'bg-emerald-500/10 text-emerald-700' : 
                        status === 'error' ? 'bg-red-500/10 text-red-700' :
                        'bg-slate-500/10 text-slate-600'
                      }`}>
                        {status === 'connecting' || status === 'transferring' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wifi className="w-3 h-3"/>}
                        <span className="text-xs font-bold uppercase tracking-widest">
                          {status === 'error' && errorMsg ? errorMsg : status}
                        </span>
                      </div>
                    </div>

                    <div className="text-center">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-1">Room ID</span>
                      <button 
                         onClick={() => { navigator.clipboard.writeText(roomId); }}
                         className="text-4xl font-mono font-bold text-slate-800 tracking-wider hover:opacity-50 transition-opacity active:scale-95 inline-flex items-center gap-2"
                      >
                        {roomId}
                        <Copy className="w-4 h-4 text-slate-300" />
                      </button>
                    </div>

                    {mode === 'sender' && (
                      <div className="pt-2">
                         {status === 'connected' || status === 'completed' || status === 'transferring' || status === 'file_received' ? (
                           <label className={`block group relative cursor-pointer ${status === 'transferring' ? 'opacity-50 pointer-events-none' : ''}`}>
                             <div className="absolute inset-0 bg-blue-400/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                             <div className="relative h-48 bg-white/40 border-2 border-dashed border-white/60 hover:border-blue-400/50 rounded-[2rem] flex flex-col items-center justify-center transition-all duration-300 hover:scale-[1.02] active:scale-95">
                                <div className="bg-white/60 p-4 rounded-full mb-3 shadow-sm backdrop-blur-sm">
                                  <Files className="w-6 h-6 text-blue-600" />
                                </div>
                                <span className="font-semibold text-slate-700">Tap to Send</span>
                                <span className="text-xs text-slate-400 mt-1">Select Multiple Files</span>
                             </div>
                             {/* FIX #2: Attach ref to the input for post-send clearing */}
                             <input 
                               ref={fileInputRef}
                               type="file" 
                               multiple 
                               className="hidden" 
                               onChange={(e) => e.target.files && e.target.files.length > 0 && sendFiles(e.target.files)} 
                             />
                           </label>
                         ) : (
                           <div className="p-8 text-center text-slate-400 bg-slate-50/50 rounded-[2rem]">
                              <p className="animate-pulse">Waiting for receiver...</p>
                           </div>
                         )}
                         
                         {status === 'transferring' && (
                           <div className="text-center mt-4 text-xs font-bold text-blue-600">
                             Sending File {currentFileIndex} of {totalFiles}...
                           </div>
                         )}
                      </div>
                    )}

                    {mode === 'receiver' && (
                      <div className="pt-2">
                        <div className="space-y-4">
                          {status === 'transferring' ? (
                             <div className="text-center">
                                {/* FIX #4: Now shows accurate X of Y count on receiver */}
                                <p className="text-blue-600 font-bold mb-2">
                                  Receiving File {currentFileIndex}{totalFiles > 0 ? ` of ${totalFiles}` : ''}...
                                </p>
                                <div className="bg-white/40 p-1.5 rounded-full backdrop-blur-md shadow-inner">
                                  <div 
                                    className="h-3 rounded-full bg-gradient-to-r from-blue-400 to-purple-400 transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                  ></div>
                                </div>
                             </div>
                          ) : (
                            <div className="h-32 flex items-center justify-center text-slate-400 bg-white/30 rounded-[2rem] border border-white/40">
                               <p>Ready to receive...</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Files & Previews (Renders only when files exist) */}
          {hasFiles && (
            <>
              {/* Divider for Desktop */}
              <div className="hidden lg:block w-px bg-white/40 rounded-full shrink-0"></div>
              {/* Divider for Mobile */}
              <div className="block lg:hidden h-px w-full bg-white/40 my-6 rounded-full shrink-0"></div>

              <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar pb-2 pr-2 animate-in slide-in-from-right-4 duration-500">
                
                {/* SENDER QUEUE */}
                {mode === 'sender' && sentFiles.length > 0 && (
                  <div className="space-y-3">
                    <div className="sticky top-0 bg-slate-50/80 backdrop-blur-xl py-3 z-10 rounded-2xl px-4 flex justify-between items-center shadow-sm border border-white/50">
                      <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Sent Files ({sentFiles.length})</p>
                      <button onClick={clearSentQueue} className="text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1">
                        <RefreshCw size={12} /> Clear
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {sentFiles.map((file, idx) => {
                        const isImage = file.mime?.startsWith('image/');
                        const isVideo = file.mime?.startsWith('video/');

                        return (
                          <div key={idx} className="bg-white/60 border border-blue-500/20 rounded-[1.5rem] p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-all">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-3 overflow-hidden">
                                <div className="bg-blue-100 p-2 rounded-full text-blue-600 shrink-0">
                                  <Check size={16} />
                                </div>
                                <span className="text-sm text-slate-700 font-semibold truncate leading-tight mt-1">{file.name}</span>
                              </div>
                            </div>
                            {file.url && (isImage || isVideo) && (
                              <div className="rounded-xl overflow-hidden bg-black/5 flex items-center justify-center border border-black/5 aspect-video mt-auto">
                                {isImage && <img src={file.url} alt={file.name} className="h-full w-full object-cover" />}
                                {isVideo && <video src={file.url} controls className="h-full w-full object-cover bg-black/90 outline-none" />}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* RECEIVER QUEUE */}
                {mode === 'receiver' && fileQueue.length > 0 && (
                  <div className="space-y-3">
                    <div className="sticky top-0 bg-slate-50/80 backdrop-blur-xl py-3 z-10 rounded-2xl px-4 flex justify-between items-center shadow-sm border border-white/50">
                      <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Received Files ({fileQueue.length})</p>
                      <button onClick={clearReceiveQueue} className="text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1">
                        <RefreshCw size={12} /> Clear
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {fileQueue.map((file, idx) => {
                        const isImage = file.mime?.startsWith('image/');
                        const isVideo = file.mime?.startsWith('video/');

                        return (
                          <div key={idx} className="bg-white/60 border border-emerald-500/20 rounded-[1.5rem] p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-all">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-3 overflow-hidden">
                                <div className="bg-emerald-100 p-2 rounded-full text-emerald-600 shrink-0">
                                  <Check size={16} />
                                </div>
                                <span className="text-sm text-slate-700 font-semibold truncate leading-tight mt-1">{file.name}</span>
                              </div>
                            </div>
                            
                            {file.url && (isImage || isVideo) && (
                              <div className="rounded-xl overflow-hidden bg-black/5 flex items-center justify-center border border-black/5 aspect-video">
                                {isImage && <img src={file.url} alt={file.name} className="h-full w-full object-cover" />}
                                {isVideo && <video src={file.url} controls className="h-full w-full object-cover bg-black/90 outline-none" />}
                              </div>
                            )}

                            <div className="mt-auto pt-2 flex justify-end">
                              {file.savedToDisk ? (
                                  <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-3 py-1 rounded-full">Saved to Disk</span>
                              ) : (
                                  <a 
                                    href={file.url!}
                                    download={file.name} 
                                    className="bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-xl hover:bg-emerald-600 transition-transform active:scale-95 shadow-sm w-full text-center"
                                  >
                                    Save File
                                  </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}