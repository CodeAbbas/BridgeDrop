import React from 'react';
import { Metadata, Viewport } from 'next';

// 1. Force Dynamic Rendering (Critical for Env Vars & No Caching issues)
export const dynamic = 'force-dynamic';

// 2. Metadata & Viewport for iOS 12 Optimization
export const metadata: Metadata = {
  title: 'BridgeDrop Legacy',
  description: 'Legacy P2P File Transfer for iOS 12+',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function LegacyPage() {
  // 3. Server-Side Configuration (Securely injects into Client Script)
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!apiKey || !projectId) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
        <h1>Config Error</h1>
        <p>Missing API Keys in Environment Variables.</p>
      </div>
    );
  }

  const firebaseConfig = {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId
  };

  // 4. Styles (Ported exactly from route.ts)
  const styles = `
    /* RESET & BASE */
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body { 
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: #f8fafc;
        color: #1e293b;
        margin: 0;
        padding: 20px;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    /* UTILS */
    .hidden { display: none; }
    .flex { display: flex; }
    .text-center { text-align: center; }
    .mb-4 { margin-bottom: 16px; }
    .mt-4 { margin-top: 16px; }

    /* CARD - Responsive Width (Up to 900px for iPad) */
    .card { 
        background: rgba(255, 255, 255, 0.95);
        width: 100%;
        max-width: 900px;
        border-radius: 24px;
        padding: 32px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.5);
        transition: max-width 0.3s ease;
    }

    /* Constrain Home/Input Views so they don't stretch too wide */
    #view-home, #view-receive { max-width: 400px; margin: 0 auto; }

    /* STATUS BADGE */
    .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 6px 16px;
        border-radius: 9999px;
        background: #f1f5f9;
        color: #475569;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 24px;
    }
    .status-badge.connected { background: rgba(16, 185, 129, 0.1); color: #047857; }
    .status-badge.error { background: rgba(239, 68, 68, 0.1); color: #b91c1c; }

    /* ACTION BUTTONS */
    .action-btn {
        width: 100%;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 20px;
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        transition: background 0.2s ease;
        box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    }
    .action-btn:active { transform: scale(0.98); background: #f8fafc; }
    
    .icon-box {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 16px;
    }
    .icon-box.blue { background: rgba(219, 234, 254, 0.5); color: #2563eb; }
    .icon-box.green { background: rgba(209, 250, 229, 0.5); color: #059669; }
    
    .btn-text { text-align: left; flex: 1; }
    .btn-title { font-weight: 700; color: #1e293b; font-size: 16px; display: block; }
    .btn-subtitle { font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; margin-top: 2px; display: block; }

    /* INPUTS */
    .code-input {
        width: 100%;
        font-family: monospace;
        font-size: 32px;
        text-align: center;
        border: 2px solid #e2e8f0;
        border-radius: 16px;
        padding: 16px;
        margin: 20px 0;
        background: #f8fafc;
        color: #1e293b;
        text-transform: uppercase;
        outline: none;
    }
    .code-input:focus { border-color: #3b82f6; background: white; }

    .primary-btn {
        width: 100%;
        background: #3b82f6;
        color: white;
        font-weight: 700;
        padding: 16px;
        border-radius: 12px;
        border: none;
        font-size: 16px;
        cursor: pointer;
    }
    .primary-btn:active { background: #2563eb; }

    /* FILE LIST GRID */
    #file-list {
        display: flex;
        flex-wrap: wrap;
        margin: 20px -8px 0 -8px;
        align-items: flex-start;
    }

    .file-item {
        background: rgba(16, 185, 129, 0.1);
        border: 1px solid rgba(16, 185, 129, 0.2);
        border-radius: 12px;
        padding: 12px 16px;
        margin: 0 8px 16px 8px;
        width: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
    }

    @media (min-width: 640px) {
        .file-item { width: calc(50% - 16px); }
    }

    .file-item button {
        background: #10b981;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
    }
  `;

  // 5. Logic (Ported exactly, injected securely)
  const scriptLogic = `
    const firebaseConfig = ${JSON.stringify(firebaseConfig)};
    function log(m) { console.log(m); }
    let db, auth, peerConnection, dataChannel, roomId, fileChunks=[], fileMeta=null;
    let receivedFiles = []; 
    let isConnected = false; 

    const rtcConfig = { iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }] };
    const ROOM_TTL = 24 * 60 * 60 * 1000;

    function triggerDownload(url, filename) {
        var win = window.open(url, '_blank');
        if (!win) { window.location.href = url; }
    }

    function setStatus(state) {
        const el = document.getElementById('status-badge');
        const txt = document.getElementById('status');
        if(!el || !txt) return;
        
        el.className = 'status-badge';
        
        if (isConnected && (state !== 'error' && state !== 'Expired')) return;

        if(state === 'connected') { 
            el.classList.add('connected'); 
            txt.innerText = "Connected"; 
            isConnected = true;
        }
        else if(state === 'error') { 
            el.classList.add('error'); 
            txt.innerText = "Error"; 
            isConnected = false;
        }
        else { 
            txt.innerText = state; 
        }
    }

    function downloadAllFiles() {
        if (receivedFiles.length === 0) return;
        let i = 0;
        function next() {
            if (i >= receivedFiles.length) return;
            const file = receivedFiles[i];
            triggerDownload(file.url, file.name);
            i++;
            setTimeout(next, 1500); 
        }
        next();
    }

    function clearFiles() {
        document.getElementById('file-list').innerHTML = '';
        receivedFiles = [];
        document.getElementById('download-all-btn').style.display = 'none';
        document.getElementById('clear-btn').style.display = 'none';
    }

    // Initialize Firebase
    if (typeof firebase !== 'undefined') {
        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            db = firebase.firestore();
            auth = firebase.auth();
            auth.setPersistence(firebase.auth.Auth.Persistence.NONE)
                .then(() => auth.signInAnonymously())
                .catch(e => log("Auth Error: "+e.message));
            auth.onAuthStateChanged(u => {
                if(u) {
                    setStatus('Ready');
                    show('view-home');
                    log("Auth: "+u.uid.slice(0,4));
                }
            });
        } catch(e) { log("Init Err: "+e.message); }
    }

    function show(id) {
        ['view-home','view-receive','view-transfer'].forEach(v => {
            const el = document.getElementById(v);
            if(el) el.style.display = 'none';
        });
        const target = document.getElementById(id);
        if(target) target.style.display = 'block';
    }
    
    // Expose functions to global scope for HTML buttons
    window.startReceive = function() { show('view-receive'); }
    window.startSend = function() {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        setupPeer(true);
        show('view-transfer');
        document.getElementById('room-display').innerText = roomId;
        document.getElementById('sender-area').style.display = 'block';
    }
    window.joinRoom = function() {
        roomId = document.getElementById('code-input').value.toUpperCase();
        if(roomId.length!==6) return;
        setupPeer(false);
        show('view-transfer');
        document.getElementById('room-display').innerText = roomId;
    }
    window.downloadAllFiles = downloadAllFiles;
    window.clearFiles = clearFiles;

    function setupPeer(isInit) {
        if(peerConnection) {
            try { peerConnection.close(); } catch(e) {}
        }
        isConnected = false; 
        log("Peer Init...");
        setStatus('Connecting...');
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        peerConnection.onicecandidate = e => {
            if(e.candidate) db.collection('rooms').doc(roomId).collection(isInit?'callerCandidates':'calleeCandidates').add(e.candidate.toJSON());
        };

        // RELAXED LISTENERS
        peerConnection.oniceconnectionstatechange = () => {
            if(peerConnection.iceConnectionState === 'failed') setStatus('error');
        };
        peerConnection.onconnectionstatechange = () => {
             if(peerConnection.connectionState === 'failed') setStatus('error');
        };

        if(isInit) {
            dataChannel = peerConnection.createDataChannel("file");
            setupData(); 
            peerConnection.createOffer().then(o => peerConnection.setLocalDescription(o)).then(() => {
                db.collection('rooms').doc(roomId).set({
                    offer:{type:peerConnection.localDescription.type, sdp:peerConnection.localDescription.sdp},
                    createdAt: Date.now()
                });
            });
            db.collection('rooms').doc(roomId).onSnapshot(s => {
                const d = s.data();
                if(!peerConnection.currentRemoteDescription && d && d.answer) peerConnection.setRemoteDescription(new RTCSessionDescription(d.answer));
            });
            listenCandidates('calleeCandidates');
        } else {
            peerConnection.ondatachannel = e => { dataChannel = e.channel; setupData(); };
            db.collection('rooms').doc(roomId).onSnapshot(s => {
                if(s.exists) {
                    const d = s.data();
                    if (d.createdAt && (Date.now() - d.createdAt > ROOM_TTL)) {
                        setStatus('Expired');
                        return;
                    }
                    if (!peerConnection.currentRemoteDescription && d.offer) {
                        peerConnection.setRemoteDescription(new RTCSessionDescription(d.offer))
                            .then(() => peerConnection.createAnswer())
                            .then(a => peerConnection.setLocalDescription(a))
                            .then(() => db.collection('rooms').doc(roomId).update({answer:{type:peerConnection.localDescription.type, sdp:peerConnection.localDescription.sdp}}));
                        listenCandidates('callerCandidates');
                    }
                } else {
                    setStatus('Invalid Code');
                }
            });
        }
    }

    function listenCandidates(col) {
        db.collection('rooms').doc(roomId).collection(col).onSnapshot(s => {
            s.docChanges().forEach(c => { if(c.type==='added') peerConnection.addIceCandidate(new RTCIceCandidate(c.doc.data())); });
        });
    }

    function setupData() {
        dataChannel.onopen = () => { 
            setStatus('connected'); 
            log("P2P Open"); 
        };
        
        dataChannel.onmessage = e => {
            const d = e.data;
            if(typeof d === 'string') {
                const m = JSON.parse(d);
                if(m.type==='meta') { fileMeta=m; fileChunks=[]; log("Rx: "+m.name); }
                else if(m.type==='end') {
                    const blob = new Blob(fileChunks, {type:fileMeta.mime});
                    const url = URL.createObjectURL(blob);
                    
                    receivedFiles.push({ name: fileMeta.name, url: url });
                    
                    if (receivedFiles.length > 1) document.getElementById('download-all-btn').style.display = 'block';
                    document.getElementById('clear-btn').style.display = 'block';

                    const div = document.createElement('div');
                    div.className = 'file-item';
                    const isImage = fileMeta.mime.startsWith('image/');

                    const headerDiv = document.createElement('div');
                    headerDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; width:100%;";

                    const nameSpan = document.createElement('span');
                    nameSpan.style.cssText = "font-size:12px; overflow:hidden; text-overflow:ellipsis; max-width: 60%; font-weight:bold; color:#064e3b;";
                    nameSpan.innerText = fileMeta.name;

                    const btn = document.createElement('button');
                    btn.innerText = isImage ? 'Open Tab' : 'Save';
                    btn.onclick = function() { triggerDownload(url, fileMeta.name); };

                    headerDiv.appendChild(nameSpan);
                    headerDiv.appendChild(btn);
                    div.appendChild(headerDiv);

                    if (isImage) {
                        div.style.flexDirection = 'column'; 
                        
                        const imgContainer = document.createElement('div');
                        imgContainer.style.cssText = "margin-top:12px; text-align:center; width:100%; min-height:50px;";
                        imgContainer.innerText = "Loading preview...";
                        div.appendChild(imgContainer);

                        const reader = new FileReader();
                        reader.onload = function(e) {
                            imgContainer.innerText = "";
                            const img = document.createElement('img');
                            img.src = e.target.result; 
                            img.style.cssText = "max-width:100%; border-radius:8px; box-shadow:0 2px 4px rgba(0,0,0,0.1); display:block; margin:0 auto;";
                            const hint = document.createElement('p');
                            hint.style.cssText = "font-size:11px; color:#64748b; margin-top:8px; font-weight:500;";
                            hint.innerText = "Long press image to Save to Photos";
                            imgContainer.appendChild(img);
                            imgContainer.appendChild(hint);
                        };
                        reader.readAsDataURL(blob);
                    }
                    document.getElementById('file-list').appendChild(div);
                }
            } else fileChunks.push(d);
        };
    }

    async function sendFiles() {
        const input = document.getElementById('file-input');
        if(!input || !input.files.length || !dataChannel) return;
        const files = input.files;

        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            log("Sending: " + f.name);
            dataChannel.send(JSON.stringify({type:'meta', name:f.name, mime:f.type}));
            
            const reader = new FileReader();
            const CHUNK = 16384;
            let offset = 0;
            
            await new Promise((resolve) => {
                reader.onload = e => {
                    dataChannel.send(e.target.result);
                    offset += e.target.result.byteLength;
                    if(offset < f.size) {
                        readSlice(offset);
                    } else {
                        dataChannel.send(JSON.stringify({type:'end'}));
                        setTimeout(resolve, 500); 
                    }
                };
                const readSlice = o => reader.readAsArrayBuffer(f.slice(o, o+CHUNK));
                readSlice(0);
            });
        }
    }
  `;

  return (
    <>
      {/* 6. Raw Styles and Scripts injection */}
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      
      {/* External Firebase SDKs (Synchronous-like loading for Legacy) */}
      <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
      <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js"></script>
      <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>

      {/* 7. HTML Structure (No <html> or <body> tags, handled by Layout) */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
                <span style={{ fontWeight: 600, fontSize: '18px' }}>BridgeDrop</span>
            </div>
            <button onClick={() => typeof window !== 'undefined' && window.location.reload()} style={{ background: 'transparent', border: 'none', padding: '8px', width: 'auto', cursor: 'pointer' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
            </button>
        </div>

        <div className="text-center">
            <div id="status-badge" className="status-badge">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></svg>
                <span id="status">Connecting...</span>
            </div>
        </div>

        <div id="view-home" className="hidden">
            <div className="text-center mb-4">
                <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#1e293b', margin: 0 }}>Legacy Mode</h1>
                <p style={{ marginTop: '4px' }}>Compatible with iOS 12+</p>
            </div>

            <div className="action-btn" onClick={() => (window as any).startSend()}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="icon-box blue">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>
                    </div>
                    <div className="btn-text">
                        <span className="btn-title">Send</span>
                        <span className="btn-subtitle">Create Room</span>
                    </div>
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </div>

            <div className="action-btn" onClick={() => (window as any).startReceive()}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div className="icon-box green">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>
                    </div>
                    <div className="btn-text">
                        <span className="btn-title">Receive</span>
                        <span className="btn-subtitle">Enter Code</span>
                    </div>
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </div>
        </div>

        <div id="view-receive" className="hidden text-center">
            <h2 style={{ color: '#334155', marginBottom: '8px' }}>Enter Room Code</h2>
            <input type="text" id="code-input" className="code-input" maxLength={6} placeholder="XXXXXX" />
            <button className="primary-btn" onClick={() => (window as any).joinRoom()}>Connect</button>
            <button onClick={() => (window as any).show('view-home')} style={{ background: 'none', border: 'none', color: '#64748b', marginTop: '16px', fontSize: '14px', textDecoration: 'underline', cursor: 'pointer' }}>Cancel</button>
        </div>

        <div id="view-transfer" className="hidden">
            <div className="text-center">
                <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>Room ID</span>
                <div id="room-display" style={{ fontFamily: 'monospace', fontSize: '32px', fontWeight: 700, color: '#1e293b', margin: '4px 0 20px 0' }}></div>
            </div>
            
            <div id="file-list"></div>
            
            <button id="download-all-btn" className="primary-btn mt-4 hidden" onClick={() => (window as any).downloadAllFiles()}>Download All</button>
            
            <button id="clear-btn" className="hidden" onClick={() => (window as any).clearFiles()} style={{ width: '100%', padding: '12px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '12px', fontWeight: 700, marginTop: '12px', cursor: 'pointer' }}>
                Clear List
            </button>
            
            <div id="sender-area" className="hidden mt-4">
                <label style={{ display: 'block', border: '2px dashed #cbd5e1', borderRadius: '16px', padding: '32px 16px', textAlign: 'center', cursor: 'pointer', background: '#f8fafc' }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '8px', display: 'inline-block' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    <span style={{ display: 'block', fontWeight: 600, color: '#334155' }}>Tap to Send Files</span>
                    <input type="file" id="file-input" multiple style={{ display: 'none' }} onChange={() => (window as any).sendFiles()} />
                </label>
            </div>
        </div>
      </div>

      {/* 8. Logic Script */}
      <script dangerouslySetInnerHTML={{ __html: scriptLogic }} />
    </>
  );
}