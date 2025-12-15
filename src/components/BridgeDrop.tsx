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
  ArrowRight, X, Copy 
} from 'lucide-react';

const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  ],
};

export default function BridgeDrop() {
  const [user, setUser] = useState<any>(null);
  const [mode, setMode] = useState<'home' | 'sender' | 'receiver' | 'receiver_input'>('home');
  const [roomId, setRoomId] = useState('');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [fileMeta, setFileMeta] = useState<any>(null);
  const [receivedBlobUrl, setReceivedBlobUrl] = useState<string | null>(null);

  // Refs
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const fileChunks = useRef<any[]>([]);
  const fileSizeReceived = useRef(0);

  // Authentication
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

  // Updated Function: Now accepts activeRoomId as an argument
  const setupPeerConnection = async (isInitiator: boolean, activeRoomId: string) => {
    if (!activeRoomId) {
      console.error("Cannot start connection without a Room ID");
      return;
    }

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

    if (isInitiator) {
      // Sender Logic
      dataChannel.current = peerConnection.current.createDataChannel("fileTransfer");
      setupDataListeners();
      
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      
      // Use activeRoomId here
      const roomRef = doc(db, 'rooms', activeRoomId);
      await setDoc(roomRef, { offer: { type: offer.type, sdp: offer.sdp } });

      onSnapshot(roomRef, (snap) => {
        const data = snap.data();
        if (!peerConnection.current?.currentRemoteDescription && data?.answer) {
          peerConnection.current?.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      });
      listenCandidates(activeRoomId, 'calleeCandidates', peerConnection.current);

    } else {
      // Receiver Logic
      peerConnection.current.ondatachannel = (e) => {
        dataChannel.current = e.channel;
        setupDataListeners();
      };

      // Use activeRoomId here
      const roomRef = doc(db, 'rooms', activeRoomId);
      const roomSnap = await getDoc(roomRef);
      
      if (roomSnap.exists()) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(roomSnap.data().offer));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        await updateDoc(roomRef, { answer: { type: answer.type, sdp: answer.sdp } });
        listenCandidates(activeRoomId, 'callerCandidates', peerConnection.current);
      } else {
        setStatus('error');
        console.error("Room does not exist");
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
          setFileMeta(msg);
          fileChunks.current = [];
          fileSizeReceived.current = 0;
          setStatus('transferring');
        } else if (msg.type === 'end') finalizeDownload();
      } else {
        fileChunks.current.push(data);
        fileSizeReceived.current += data.byteLength;
        if (fileMeta) setProgress(Math.min(100, Math.round((fileSizeReceived.current / fileMeta.size) * 100)));
      }
    };
  };

  const sendFile = async (file: File) => {
    if (!dataChannel.current || dataChannel.current.readyState !== 'open') return;
    setStatus('transferring');
    dataChannel.current.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size, mime: file.type }));
    
    const CHUNK = 16 * 1024;
    const buf = await file.arrayBuffer();
    let offset = 0;
    while (offset < buf.byteLength) {
      const chunk = buf.slice(offset, offset + CHUNK);
      while (dataChannel.current.bufferedAmount > 65536) await new Promise(r => setTimeout(r, 5));
      dataChannel.current.send(chunk);
      offset += chunk.byteLength;
      setProgress(Math.min(100, Math.round((offset / buf.byteLength) * 100)));
    }
    dataChannel.current.send(JSON.stringify({ type: 'end' }));
    setStatus('completed');
  };

  const finalizeDownload = () => {
    if (!fileMeta) return;
    const blob = new Blob(fileChunks.current, { type: fileMeta.mime });
    setReceivedBlobUrl(URL.createObjectURL(blob));
    setStatus('completed');
  };

  const reset = () => {
    setMode('home');
    setRoomId('');
    setStatus('idle');
    setProgress(0);
    setFileMeta(null);
    setReceivedBlobUrl(null);
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
        <div className="w-full max-w-md bg-white/40 backdrop-blur-2xl border border-white/50 shadow-2xl rounded-[2.5rem] p-8 overflow-hidden transition-all duration-500">
          
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
                      setRoomId(newCode); // Update state (async)
                      setMode('sender');
                      setupPeerConnection(true, newCode); // Pass explicit value immediately
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
                           setupPeerConnection(false, v); // Pass explicit value
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
                      <span className="text-xs font-bold uppercase tracking-widest">{status}</span>
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
                                <Send className="w-6 h-6 text-blue-600" />
                              </div>
                              <span className="font-semibold text-slate-700">Tap to Send</span>
                              <span className="text-xs text-slate-400 mt-1">Photos or Videos</span>
                           </div>
                           <input type="file" className="hidden" onChange={(e) => e.target.files && e.target.files[0] && sendFile(e.target.files[0])} />
                         </label>
                       ) : (
                         <div className="p-8 text-center text-slate-400 bg-slate-50/50 rounded-[2rem]">
                            <p className="animate-pulse">Waiting for receiver...</p>
                         </div>
                       )}
                    </div>
                  )}

                  {mode === 'receiver' && (
                    <div className="pt-2">
                      {status === 'completed' && receivedBlobUrl ? (
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-[2rem] p-6 text-center animate-in zoom-in duration-300">
                          <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/30">
                            <Check className="w-6 h-6 text-white" />
                          </div>
                          <h3 className="font-bold text-emerald-900 mb-1">Received</h3>
                          <p className="text-xs text-emerald-700/70 mb-6 truncate px-4">{fileMeta?.name}</p>
                          <a 
                            href={receivedBlobUrl}
                            download={fileMeta?.name} 
                            className="block w-full bg-emerald-500 text-white font-bold py-4 rounded-2xl shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 active:scale-95 transition-all"
                          >
                            Save to Files
                          </a>
                        </div>
                      ) : (
                        <div className="h-32 flex items-center justify-center">
                          {status === 'transferring' ? (
                            <div className="text-center">
                               <div className="w-16 h-16 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin mx-auto mb-3"></div>
                               <p className="text-blue-600 font-bold">Receiving...</p>
                            </div>
                          ) : (
                            <p className="text-slate-400">Ready to accept...</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {(status === 'transferring' || status === 'completed') && (
                    <div className="bg-white/40 p-1.5 rounded-full backdrop-blur-md shadow-inner">
                      <div 
                        className="h-3 rounded-full bg-gradient-to-r from-blue-400 to-purple-400 shadow-[0_0_10px_rgba(96,165,250,0.5)] transition-all duration-300 ease-out relative overflow-hidden"
                        style={{ width: `${progress}%` }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
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
