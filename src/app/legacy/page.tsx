'use client';

import React, { useState, useEffect, useRef } from 'react';
import { collection, doc, setDoc, onSnapshot, addDoc, updateDoc, getDoc } from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { Wifi, Smartphone, Tablet, Send, Check, Loader2, Share2, ArrowRight, X, Copy } from 'lucide-react';

/* LEGACY MODE: iOS 12 / Safari 12 Support
  - No Optional Chaining (?.)
  - No Backdrop Blur
  - Safe Clipboard usage
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

  // Refs
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const fileChunks = useRef<any[]>([]);
  const fileSizeReceived = useRef(0);

  useEffect(() => {
    signInAnonymously(auth).catch((err) => console.error(err));
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  const setupPeerConnection = async (isInitiator: boolean, activeRoomId: string) => {
    if (!activeRoomId || typeof window === 'undefined') return;

    setStatus('connecting');
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

    if (isInitiator) {
      const dc = pc.createDataChannel("fileTransfer");
      dataChannel.current = dc;
      setupDataListeners(dc);
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      const roomRef = doc(db, 'rooms', activeRoomId);
      await setDoc(roomRef, { offer: { type: offer.type, sdp: offer.sdp } });

      onSnapshot(roomRef, (snap) => {
        const data = snap.data();
        if (!pc.currentRemoteDescription && data && data.answer) {
          pc.setRemoteDescription(new RTCSessionDescription(data.answer));
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
      } else {
        setStatus('error');
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

  const setupDataListeners = (dc: RTCDataChannel) => {
    dc.onopen = () => setStatus('connected');
    dc.onmessage = (e) => {
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
    if(peerConnection.current) peerConnection.current.close();
  };

  // Plain background for legacy (Low CPU usage)
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans text-slate-800">
      <div className="w-full max-w-md bg-white border border-slate-200 shadow-xl rounded-xl p-6">
        
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Share2 className="text-blue-600 w-6 h-6" />
            <span className="font-bold text-lg">BridgeDrop Lite</span>
          </div>
          {mode !== 'home' && (
            <button onClick={reset} className="p-2 bg-slate-100 rounded-full">
              <X className="w-5 h-5 text-slate-600" />
            </button>
          )}
        </div>

        {!user ? (
          <div className="text-center py-10">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-2" />
            <p>Connecting securely...</p>
          </div>
        ) : (
          <div>
            {mode === 'home' && (
               <div className="space-y-4">
                 <button onClick={() => setMode('receiver_input')} className="w-full bg-blue-100 p-4 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-3">
                       <Tablet className="text-blue-600"/>
                       <div className="text-left">
                         <div className="font-bold text-blue-900">Receive Files</div>
                         <div className="text-xs text-blue-700">Optimized for this iPad</div>
                       </div>
                    </div>
                    <ArrowRight className="text-blue-500"/>
                 </button>

                 <button onClick={() => {
                     const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                     setRoomId(code);
                     setMode('sender');
                     setupPeerConnection(true, code);
                 }} className="w-full bg-white border border-slate-200 p-4 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-3">
                       <Smartphone className="text-slate-500"/>
                       <div className="font-bold text-slate-700">Send Files</div>
                    </div>
                    <ArrowRight className="text-slate-400"/>
                 </button>
               </div>
            )}

            {mode === 'receiver_input' && (
              <div className="text-center">
                <h2 className="text-xl font-bold mb-4">Enter Code</h2>
                <input 
                  autoFocus
                  placeholder="CODE"
                  className="w-full text-center text-3xl font-mono border-2 border-slate-300 rounded-lg py-4 mb-4 uppercase"
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
                <p className="text-sm text-slate-500">Check your Android phone</p>
              </div>
            )}

            {(mode === 'sender' || mode === 'receiver') && (
               <div className="text-center pt-4">
                  <div className="mb-6">
                    <div className="text-xs font-bold uppercase text-slate-400">Room Code</div>
                    <div className="text-4xl font-mono font-bold">{roomId}</div>
                    <div className={`mt-2 inline-block px-3 py-1 rounded-full text-xs font-bold uppercase ${status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {status}
                    </div>
                  </div>

                  {mode === 'sender' && (
                     <div className="border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl p-8 relative">
                        <Send className="w-8 h-8 mx-auto text-slate-400 mb-2"/>
                        <p className="font-bold text-slate-600">Tap to Send</p>
                        <input type="file" className="absolute inset-0 opacity-0" onChange={(e) => e.target.files && e.target.files[0] && sendFile(e.target.files[0])} />
                     </div>
                  )}

                  {mode === 'receiver' && status === 'completed' && receivedBlobUrl && (
                     <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                        <Check className="w-10 h-10 text-green-500 mx-auto mb-2"/>
                        <p className="font-bold text-green-800 mb-4">Transfer Complete!</p>
                        <a href={receivedBlobUrl} download={fileMeta?.name || 'download'} className="block w-full bg-green-600 text-white font-bold py-3 rounded-lg">
                           Download Now
                        </a>
                     </div>
                  )}

                  {(status === 'transferring' || status === 'completed') && (
                     <div className="mt-6 bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div className="bg-blue-500 h-full transition-all" style={{width: `${progress}%`}}></div>
                     </div>
                  )}
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

