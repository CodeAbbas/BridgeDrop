'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, doc, setDoc, onSnapshot, addDoc, updateDoc, getDoc 
} from 'firebase/firestore';
import { 
  signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { 
  Wifi, Smartphone, Tablet, Send, Check, Loader2, Share2, 
  ArrowRight, X, Copy, Files
} from 'lucide-react';

const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  ],
};

const ROOM_TTL = 24 * 60 * 60 * 1000;

export default function BridgeDrop() {
  const [user, setUser] = useState<any>(null);
  const [mode, setMode] = useState<'home' | 'sender' | 'receiver' | 'receiver_input'>('home');
  const [roomId, setRoomId] = useState('');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  
  // Track multiple files
  const [fileQueue, setFileQueue] = useState<any[]>([]); // For receiver
  const [currentFileIndex, setCurrentFileIndex] = useState(0); // For sender & receiver UI
  const [totalFiles, setTotalFiles] = useState(0); // For sender UI
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Refs
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  
  // Receiver state tracking
  const incomingFileMeta = useRef<any>(null);
  const incomingFileChunks = useRef<any[]>([]);
  const incomingFileSize = useRef(0);

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

  const setupPeerConnection = async (isInitiator: boolean, activeRoomId: string) => {
    if (!activeRoomId) return;
    setErrorMsg(null);
    setStatus('connecting');
    
    if (typeof window === 'undefined') return;

    peerConnection.current = new RTCPeerConnection(rtcConfig);

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate && activeRoomId) {
        const type = isInitiator ? 'callerCandidates' : 'calleeCandidates';
        addDoc(collection(db, 'rooms', activeRoomId, type), event.candidate.toJSON());
      }
    };

    peerConnection.current.onconnectionstatechange = () => {
      const state = peerConnection.current?.connectionState;
      if (state === 'connected') setStatus('connected');
      if (state === 'disconnected' || state === 'failed') setStatus('error');
    };

    const roomRef = doc(db, 'rooms', activeRoomId);

    if (isInitiator) {
      dataChannel.current = peerConnection.current.createDataChannel("fileTransfer");
      setupDataListeners();
      
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      
      await setDoc(roomRef, { 
        offer: { type: offer.type, sdp: offer.sdp },
        createdAt: Date.now()
      });

      onSnapshot(roomRef, (snap) => {
        const data = snap.data();
        if (!peerConnection.current?.currentRemoteDescription && data?.answer) {
          peerConnection.current?.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      });
      listenCandidates(activeRoomId, 'calleeCandidates', peerConnection.current);

    } else {
      peerConnection.current.ondatachannel = (e) => {
        dataChannel.current = e.channel;
        setupDataListeners();
      };

      const roomSnap = await getDoc(roomRef);
      
      if (roomSnap.exists()) {
        const data = roomSnap.data();
        if (data.createdAt && (Date.now() - data.createdAt > ROOM_TTL)) {
           setStatus('error');
           setErrorMsg("Room Expired");
           peerConnection.current.close();
           return;
        }

        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        await updateDoc(roomRef, { answer: { type: answer.type, sdp: answer.sdp } });
        listenCandidates(activeRoomId, 'callerCandidates', peerConnection.current);
      } else {
        setStatus('error');
        setErrorMsg("Room not found");
      }
    }
  };

  const listenCandidates = (rId: string, type: string, pc: RTCPeerConnection) => {
    onSnapshot(collection(db, 'rooms', rId, type), (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      });
    });
  };

  const setupDataListeners = () => {
    if (!dataChannel.current) return;
    dataChannel.current.onopen = () => setStatus('connected');
    
    dataChannel.current.onmessage = (e) => {
      const data = e.data;
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'meta') {
          // Start of a new file
          incomingFileMeta.current = msg;
          incomingFileChunks.current = [];
          incomingFileSize.current = 0;
          setStatus('transferring');
          // Update UI to show we are receiving something
          setCurrentFileIndex(prev => prev + 1); 
        } else if (msg.type === 'end') {
          // End of current file
          const blob = new Blob(incomingFileChunks.current, { type: incomingFileMeta.current.mime });
          const url = URL.createObjectURL(blob);
          
          setFileQueue(prev => [...prev, {
            name: incomingFileMeta.current.name,
            url: url
          }]);
          
          // If this was the last file in a batch, status might change, but usually we stay 'connected' or 'transferring' if more are coming.
          // We'll set to 'completed' briefly or keep it 'transferring' if we knew the total count. 
          // For simplicity, we just keep receiving.
          setStatus('file_received'); // Custom status to show animation
          setTimeout(() => setStatus('connected'), 2000); // Reset to connected to await more
        }
      } else {
        // Chunk Data
        incomingFileChunks.current.push(data);
        incomingFileSize.current += data.byteLength;
        if (incomingFileMeta.current) {
           const pct = Math.min(100, Math.round((incomingFileSize.current / incomingFileMeta.current.size) * 100));
           setProgress(pct);
        }
      }
    };
  };

  const sendFiles = async (files: FileList) => {
    if (!dataChannel.current || dataChannel.current.readyState !== 'open') return;
    
    setTotalFiles(files.length);
    setCurrentFileIndex(0);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setCurrentFileIndex(i + 1); // 1-based index for UI
      setStatus('transferring');
      setProgress(0);

      // 1. Send Meta
      dataChannel.current.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size, mime: file.type }));
      
      // 2. Send Chunks
      const CHUNK = 16 * 1024;
      const buf = await file.arrayBuffer();
      let offset = 0;
      while (offset < buf.byteLength) {
        const chunk = buf.slice(offset, offset + CHUNK);
        while (dataChannel.current.bufferedAmount > 65536 * 2) await new Promise(r => setTimeout(r, 5));
        dataChannel.current.send(chunk);
        offset += chunk.byteLength;
        setProgress(Math.min(100, Math.round((offset / buf.byteLength) * 100)));
      }

      // 3. Send End
      dataChannel.current.send(JSON.stringify({ type: 'end' }));
      
      // Small delay between files to ensure receiver processes 'end' message
      await new Promise(r => setTimeout(r, 500));
    }
    
    setStatus('completed');
  };

  const reset = () => {
    setMode('home');
    setRoomId('');
    setStatus('idle');
    setProgress(0);
    setFileQueue([]);
    setTotalFiles(0);
    setCurrentFileIndex(0);
    setErrorMsg(null);
    peerConnection.current?.close();
  };

  const blobStyle = "absolute rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob";

  return (
    <div className="min-h-screen relative overflow-hidden bg-slate-50 font-sans selection:bg-blue-500 selection:text-white">
      <div className="absolute inset-0 w-full h-full overflow-hidden z-0 pointer-events-none">
         <div className={`top-0 -left-4 w-72 h-72 bg-purple-300 ${blobStyle}`}></div>
         <div className={`top-0 -right-4 w-72 h-72 bg-blue-300 ${blobStyle} delay-2000`}></div>
         <div className={`-bottom-8 left-20 w-72 h-72 bg-indigo-300 ${blobStyle} delay-4000`}></div>
      </div>

      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white/40 backdrop-blur-2xl border border-white/50 shadow-2xl rounded-[2.5rem] p-8 overflow-hidden transition-all duration-500 max-h-[80vh] overflow-y-auto">
          
          <div className="flex items-center justify-between mb-8">
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

          {!user ? (
            <div className="h-64 flex flex-col items-center justify-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 opacity-80" />
              <p className="text-sm font-medium text-slate-500">Secure Handshake...</p>
            </div>
          ) : (
            <div className="animate-in fade-in duration-700">
              
              {mode === 'home' && (
                <div className="space-y-4">
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
                  
                  {/* Status / Error Display */}
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
                       {status === 'connected' || status === 'completed' || status === 'transferring' ? (
                         <label className={`block group relative cursor-pointer ${status === 'transferring' ? 'opacity-50 pointer-events-none' : ''}`}>
                           <div className="absolute inset-0 bg-blue-400/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                           <div className="relative h-48 bg-white/40 border-2 border-dashed border-white/60 hover:border-blue-400/50 rounded-[2rem] flex flex-col items-center justify-center transition-all duration-300 hover:scale-[1.02] active:scale-95">
                              <div className="bg-white/60 p-4 rounded-full mb-3 shadow-sm backdrop-blur-sm">
                                <Files className="w-6 h-6 text-blue-600" />
                              </div>
                              <span className="font-semibold text-slate-700">Tap to Send</span>
                              <span className="text-xs text-slate-400 mt-1">Select Multiple Files</span>
                           </div>
                           <input type="file" multiple className="hidden" onChange={(e) => e.target.files && e.target.files.length > 0 && sendFiles(e.target.files)} />
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
                        {/* Current Transfer Progress */}
                        {status === 'transferring' && (
                           <div className="text-center">
                              <p className="text-blue-600 font-bold mb-2">Receiving File {currentFileIndex}...</p>
                              <div className="bg-white/40 p-1.5 rounded-full backdrop-blur-md shadow-inner">
                                <div 
                                  className="h-3 rounded-full bg-gradient-to-r from-blue-400 to-purple-400 transition-all duration-300"
                                  style={{ width: `${progress}%` }}
                                ></div>
                              </div>
                           </div>
                        )}

                        {/* Received Files List */}
                        {fileQueue.length > 0 && (
                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider text-center">Received Files</p>
                            {fileQueue.map((file, idx) => (
                              <div key={idx} className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-center justify-between animate-in slide-in-from-bottom-2">
                                <div className="flex items-center gap-3 overflow-hidden">
                                  <div className="bg-emerald-500 p-2 rounded-full text-white">
                                    <Check size={14} />
                                  </div>
                                  <span className="text-xs text-emerald-900 font-medium truncate">{file.name}</span>
                                </div>
                                <a 
                                  href={file.url}
                                  download={file.name} 
                                  className="bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-emerald-600 transition-colors"
                                >
                                  Save
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {fileQueue.length === 0 && status !== 'transferring' && (
                           <div className="h-32 flex items-center justify-center text-slate-400">
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
      </div>
    </div>
  );
}