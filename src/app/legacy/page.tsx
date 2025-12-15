'use client';

import React, { useState, useEffect, useRef } from 'react';
import { collection, doc, setDoc, onSnapshot, addDoc, updateDoc, getDoc } from 'firebase/firestore';
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  setPersistence, 
  browserSessionPersistence,
  inMemoryPersistence 
} from 'firebase/auth';
import { db, auth } from '@/lib/firebase';

/* LEGACY MODE V2: "Bulletproof"
  - No Icon Libraries (Emojis only)
  - Forces Session Persistence (Fixes iOS 12 Storage Bug)
  - On-screen Debugging
*/

const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  ],
};

export default function LegacyBridgeDrop() {
  const [user, setUser] = useState<any>(null);
  const [mode, setMode] = useState<'home' | 'sender' | 'receiver' | 'receiver_input'>('home');
  const [roomId, setRoomId] = useState('');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [fileMeta, setFileMeta] = useState<any>(null);
  const [receivedBlobUrl, setReceivedBlobUrl] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  // Refs
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const fileChunks = useRef<any[]>([]);
  const fileSizeReceived = useRef(0);

  // Custom Logger for iPad Screen
  const log = (msg: string) => {
    console.log(msg);
    setDebugLog(prev => [msg, ...prev].slice(0, 5));
  };

  useEffect(() => {
    const init = async () => {
      try {
        log("Initializing Auth...");
        // CRITICAL FIX: Force session persistence to avoid iOS 12 IndexedDB bugs
        await setPersistence(auth, inMemoryPersistence); 
        await signInAnonymously(auth);
        log("Signed in anonymously");
      } catch (err: any) {
        log("Auth Error: " + err.message);
      }
    };
    init();

    return onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        log("User Authenticated: " + u.uid.slice(0,4));
      }
    });
  }, []);

  const setupPeerConnection = async (isInitiator: boolean, activeRoomId: string) => {
    if (!activeRoomId) return;

    setStatus('connecting');
    log("Starting P2P...");

    try {
      const pc = new RTCPeerConnection(rtcConfig);
      peerConnection.current = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const type = isInitiator ? 'callerCandidates' : 'calleeCandidates';
          addDoc(collection(db, 'rooms', activeRoomId, type), event.candidate.toJSON());
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        log("Conn State: " + state);
        if (state === 'connected') setStatus('connected');
        if (state === 'disconnected' || state === 'failed') setStatus('error');
      };

      if (isInitiator) {
        const dc = pc.createDataChannel("fileTransfer");
        dataChannel.current = dc;
        setupDataListeners(dc);
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        await setDoc(doc(db, 'rooms', activeRoomId), { offer: { type: offer.type, sdp: offer.sdp } });

        onSnapshot(doc(db, 'rooms', activeRoomId), (snap) => {
          const data = snap.data();
          if (!pc.currentRemoteDescription && data && data.answer) {
            pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            log("Remote description set");
          }
        });
        listenCandidates(activeRoomId, 'calleeCandidates', pc);

      } else {
        pc.ondatachannel = (e) => {
          dataChannel.current = e.channel;
          setupDataListeners(e.channel);
        };

        const roomRef = doc(db, 'rooms', activeRoomId);
        const roomSnap = await getDoc(roomRef);
        
        if (roomSnap.exists()) {
          const data = roomSnap.data();
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await updateDoc(roomRef, { answer: { type: answer.type, sdp: answer.sdp } });
          listenCandidates(activeRoomId, 'callerCandidates', pc);
          log("Joined room, sent answer");
        } else {
          setStatus('error');
          log("Room not found");
        }
      }
    } catch (e: any) {
      log("WebRTC Error: " + e.message);
    }
  };

  const listenCandidates = (rId: string, type: string, pc: RTCPeerConnection) => {
    onSnapshot(collection(db, 'rooms', rId, type), (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === 'added') pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      });
    });
  };

  const setupDataListeners = (dc: RTCDataChannel) => {
    dc.onopen = () => { setStatus('connected'); log("Data Channel Open"); };
    dc.onmessage = (e) => {
      const data = e.data;
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'meta') {
          setFileMeta(msg);
          fileChunks.current = [];
          fileSizeReceived.current = 0;
          setStatus('transferring');
          log("Receiving " + msg.name);
        } else if (msg.type === 'end') finalizeDownload();
      } else {
        fileChunks.current.push(data);
        fileSizeReceived.current += data.byteLength;
        if (fileMeta) {
             const pct = Math.min(100, Math.round((fileSizeReceived.current / fileMeta.size) * 100));
             setProgress(pct);
        }
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
    log("File sent");
  };

  const finalizeDownload = () => {
    if (!fileMeta) return;
    const blob = new Blob(fileChunks.current, { type: fileMeta.mime });
    setReceivedBlobUrl(URL.createObjectURL(blob));
    setStatus('completed');
    log("Download Ready");
  };

  const reset = () => {
    setMode('home');
    setRoomId('');
    setStatus('idle');
    setProgress(0);
    setFileMeta(null);
    setReceivedBlobUrl(null);
    if(peerConnection.current) peerConnection.current.close();
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center p-4 font-sans text-slate-800">
      <div className="w-full max-w-md border border-slate-300 shadow-xl rounded-xl p-6 mt-4">
        
        <div className="flex items-center justify-between mb-6 border-b pb-4">
          <div className="font-bold text-lg">🍏 BridgeDrop Legacy</div>
          {mode !== 'home' && (
            <button onClick={reset} className="px-3 py-1 bg-slate-200 rounded">Back</button>
          )}
        </div>

        {!user ? (
          <div className="text-center py-10">
             <div className="animate-spin text-4xl mb-4">⚙️</div>
             <p>Initializing...</p>
          </div>
        ) : (
          <div>
            {mode === 'home' && (
               <div className="space-y-4">
                 <button onClick={() => setMode('receiver_input')} className="w-full bg-blue-100 p-6 rounded-lg text-left">
                    <div className="font-bold text-blue-900 text-xl">⬇️ Receive Files</div>
                    <div className="text-sm text-blue-700">Get files on this iPad</div>
                 </button>

                 <button onClick={() => {
                     const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                     setRoomId(code);
                     setMode('sender');
                     setupPeerConnection(true, code);
                 }} className="w-full bg-slate-100 border border-slate-300 p-6 rounded-lg text-left">
                    <div className="font-bold text-slate-700 text-xl">⬆️ Send Files</div>
                 </button>
               </div>
            )}

            {mode === 'receiver_input' && (
              <div className="text-center">
                <h2 className="text-xl font-bold mb-4">Enter Room Code</h2>
                <input 
                  autoFocus
                  placeholder="CODE"
                  className="w-full text-center text-4xl font-mono border-2 border-slate-400 rounded-lg py-4 mb-4 uppercase"
                  maxLength={6}
                  onChange={(e) => {
                     const v = e.target.value.toUpperCase();
                     if(v.length === 6) {
                       setRoomId(v);
                       setMode('receiver');
                       setupPeerConnection(false, v);
                     }
                  }}
                />
              </div>
            )}

            {(mode === 'sender' || mode === 'receiver') && (
               <div className="text-center pt-4">
                  <div className="mb-6 bg-slate-100 p-4 rounded-lg">
                    <div className="text-xs font-bold uppercase text-slate-500">Room Code</div>
                    <div className="text-4xl font-mono font-bold tracking-widest">{roomId}</div>
                    <div className="mt-2 font-bold uppercase text-sm">{status}</div>
                  </div>

                  {mode === 'sender' && (
                     <div className="border-4 border-dashed border-slate-300 bg-slate-50 rounded-xl p-10 relative">
                        <div className="text-4xl mb-2">📤</div>
                        <p className="font-bold text-slate-600">Tap to Send</p>
                        <input type="file" className="absolute inset-0 opacity-0" onChange={(e) => e.target.files && e.target.files[0] && sendFile(e.target.files[0])} />
                     </div>
                  )}

                  {mode === 'receiver' && status === 'completed' && receivedBlobUrl && (
                     <div className="bg-green-100 border border-green-300 rounded-xl p-6">
                        <div className="text-4xl mb-2">✅</div>
                        <p className="font-bold text-green-900 mb-4">Complete!</p>
                        <a href={receivedBlobUrl} download={fileMeta?.name || 'download'} className="block w-full bg-green-600 text-white font-bold py-4 rounded-lg">
                           Download File
                        </a>
                     </div>
                  )}

                  {(status === 'transferring' || status === 'completed') && (
                     <div className="mt-6 bg-slate-200 h-4 rounded-full overflow-hidden border border-slate-300">
                        <div className="bg-blue-600 h-full transition-all" style={{width: `${progress}%`}}></div>
                     </div>
                  )}
               </div>
            )}
          </div>
        )}

        {/* Debug Console for iPad */}
        <div className="mt-8 pt-4 border-t border-slate-200">
           <p className="text-xs font-bold text-slate-400 mb-2">DEBUG LOG:</p>
           {debugLog.map((l, i) => (
             <div key={i} className="text-[10px] font-mono text-slate-500">{l}</div>
           ))}
        </div>

      </div>
    </div>
  );
}


