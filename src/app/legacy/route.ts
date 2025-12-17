import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic'; 

export async function GET() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!apiKey || !projectId) {
    return new NextResponse("<h1>Config Error</h1><p>Missing API Keys</p>", { status: 500, headers: {'content-type':'text/html'} });
  }

  const firebaseConfig = { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>BridgeDrop Legacy</title>
    <style>
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

        /* UTILS - REMOVED !important TO FIX VISIBILITY BUG */
        .hidden { display: none; }
        .block { display: block; }
        
        .flex { display: flex; }
        .text-center { text-align: center; }
        .mb-4 { margin-bottom: 16px; }
        .mt-4 { margin-top: 16px; }

        /* CARD */
        .card { 
            background: rgba(255, 255, 255, 0.95);
            width: 100%;
            max-width: 420px;
            border-radius: 24px;
            padding: 32px;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.5);
        }

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
        .status-badge svg { margin-right: 6px; width: 14px; height: 14px; }
        .status-badge.connected { background: rgba(16, 185, 129, 0.1); color: #047857; }
        .status-badge.error { background: rgba(239, 68, 68, 0.1); color: #b91c1c; }

        /* ACTION BUTTONS (HOME) */
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
            /* Force visibility */
            visibility: visible;
            opacity: 1;
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

        /* FILE LIST */
        .file-item {
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.2);
            border-radius: 12px;
            padding: 12px 16px;
            margin-bottom: 8px;
        }

        .debug-log { 
            margin-top: 24px; 
            padding-top: 12px; 
            border-top: 1px solid #f1f5f9; 
            font-family: monospace; 
            font-size: 10px; 
            color: #94a3b8; 
            text-align: left;
            max-height: 100px;
            overflow-y: auto;
        }
    </style>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
</head>
<body>

<div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div style="display:flex; align-items:center;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            <span style="font-weight:600; font-size:18px;">BridgeDrop</span>
        </div>
        <button onclick="window.location.reload()" style="background:transparent; border:none; padding:8px; width:auto; cursor:pointer;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
    </div>

    <div class="text-center">
        <div id="status-badge" class="status-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
            <span id="status">Connecting...</span>
        </div>
    </div>

    <div id="view-home" class="hidden">
        <div class="text-center mb-4">
            <h1 style="font-size:28px; font-weight:800; color:#1e293b; margin:0;">Legacy Mode</h1>
            <p style="margin-top:4px;">Compatible with iOS 12+</p>
        </div>

        <div class="action-btn" onclick="startSend()">
            <div style="display:flex; align-items:center;">
                <div class="icon-box blue">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                </div>
                <div class="btn-text">
                    <span class="btn-title">Send</span>
                    <span class="btn-subtitle">Create Room</span>
                </div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </div>

        <div class="action-btn" onclick="startReceive()">
            <div style="display:flex; align-items:center;">
                <div class="icon-box green">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                </div>
                <div class="btn-text">
                    <span class="btn-title">Receive</span>
                    <span class="btn-subtitle">Enter Code</span>
                </div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </div>
    </div>

    <div id="view-receive" class="hidden text-center">
        <h2 style="color:#334155; margin-bottom:8px;">Enter Room Code</h2>
        <input type="text" id="code-input" class="code-input" maxlength="6" placeholder="XXXXXX">
        <button class="primary-btn" onclick="joinRoom()">Connect</button>
        <button onclick="show('view-home')" style="background:none; border:none; color:#64748b; margin-top:16px; font-size:14px; text-decoration:underline; cursor:pointer;">Cancel</button>
    </div>

    <div id="view-transfer" class="hidden">
        <div class="text-center">
            <span style="font-size:10px; color:#94a3b8; font-weight:700; text-transform:uppercase; letter-spacing:1px;">Room ID</span>
            <div id="room-display" style="font-family:monospace; font-size:32px; font-weight:700; color:#1e293b; margin:4px 0 20px 0;"></div>
        </div>
        
        <div id="file-list" style="margin-top:20px;"></div>
        
        <button id="download-all-btn" class="primary-btn mt-4 hidden" onclick="downloadAllFiles()">Download All</button>
        
        <button id="clear-btn" class="hidden" onclick="clearFiles()" style="width:100%; padding:12px; background:#f1f5f9; color:#475569; border:none; border-radius:12px; font-weight:700; margin-top:12px; cursor:pointer;">
            Clear List
        </button>
        
        <div id="sender-area" class="hidden mt-4">
            <label style="display:block; border:2px dashed #cbd5e1; border-radius:16px; padding:32px 16px; text-align:center; cursor:pointer; background:#f8fafc;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span style="display:block; font-weight:600; color:#334155;">Tap to Send Files</span>
                <input type="file" id="file-input" multiple style="display:none;" onchange="sendFiles()">
            </label>
        </div>
    </div>

    <div id="debug" class="debug-log"></div>
</div>

<script>
    const firebaseConfig = ${JSON.stringify(firebaseConfig)};
    function log(m) { console.log(m); document.getElementById('debug').innerHTML += "<div>"+m+"</div>"; }
    let db, auth, peerConnection, dataChannel, roomId, fileChunks=[], fileMeta=null;
    let receivedFiles = []; 
    const rtcConfig = { iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }] };
    const ROOM_TTL = 24 * 60 * 60 * 1000;

    function triggerDownload(url, filename) {
        var win = window.open(url, '_blank');
        if (!win) { window.location.href = url; }
    }

    function setStatus(state) {
        const el = document.getElementById('status-badge');
        const txt = document.getElementById('status');
        el.className = 'status-badge';
        if(state === 'connected') { el.classList.add('connected'); txt.innerText = "Connected"; }
        else if(state === 'error') { el.classList.add('error'); txt.innerText = "Error"; }
        else { txt.innerText = state; }
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
        log("Cleared.");
    }

    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
        auth.setPersistence(firebase.auth.Auth.Persistence.NONE)
            .then(() => auth.signInAnonymously())
            .catch(e => log("Auth Error: "+e.message));
        auth.onAuthStateChanged(u => {
            if(u) {
                setStatus('Ready');
                show('view-home'); // Use helper function to ensure cleaner class toggling
                log("Auth: "+u.uid.slice(0,4));
            }
        });
    } catch(e) { log("Init Err: "+e.message); }

    function show(id) {
        ['view-home','view-receive','view-transfer'].forEach(v => {
            document.getElementById(v).style.display = 'none';
        });
        document.getElementById(id).style.display = 'block';
    }
    
    function startReceive() { show('view-receive'); }
    function startSend() {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        setupPeer(true);
        show('view-transfer');
        document.getElementById('room-display').innerText = roomId;
        document.getElementById('sender-area').style.display = 'block';
    }
    function joinRoom() {
        roomId = document.getElementById('code-input').value.toUpperCase();
        if(roomId.length!==6) return;
        setupPeer(false);
        show('view-transfer');
        document.getElementById('room-display').innerText = roomId;
    }

    function setupPeer(isInit) {
        log("Peer Init...");
        setStatus('Connecting...');
        peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnection.onicecandidate = e => {
            if(e.candidate) db.collection('rooms').doc(roomId).collection(isInit?'callerCandidates':'calleeCandidates').add(e.candidate.toJSON());
        };
        peerConnection.onconnectionstatechange = () => {
            if(peerConnection.connectionState === 'connected') setStatus('connected');
            else if(peerConnection.connectionState === 'failed') setStatus('error');
            else setStatus(peerConnection.connectionState);
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
                        setStatus('error');
                        return;
                    }
                    if (!peerConnection.currentRemoteDescription && d.offer) {
                        peerConnection.setRemoteDescription(new RTCSessionDescription(d.offer))
                            .then(() => peerConnection.createAnswer())
                            .then(a => peerConnection.setLocalDescription(a))
                            .then(() => db.collection('rooms').doc(roomId).update({answer:{type:peerConnection.localDescription.type, sdp:peerConnection.localDescription.sdp}}));
                        listenCandidates('callerCandidates');
                    }
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
        dataChannel.onopen = () => { setStatus('connected'); log("P2P Open"); };
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

                    /* --- LEGACY IMAGE FIX: BASE64 RENDER --- */
                    const div = document.createElement('div');
                    div.className = 'file-item';
                    const isImage = fileMeta.mime.startsWith('image/');

                    // 1. Create Header Row (Name + Button)
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

                    // 2. If Image: Convert Blob to Base64 and Append
                    if (isImage) {
                        div.style.flexDirection = 'column'; // Stack vertically
                        
                        const imgContainer = document.createElement('div');
                        imgContainer.style.cssText = "margin-top:12px; text-align:center; width:100%; min-height:50px;";
                        imgContainer.innerText = "Loading preview...";
                        div.appendChild(imgContainer);

                        // Use FileReader to get Base64 Data URL (Bypasses blob: network check on iOS)
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
                    /* --- END FIX --- */
                    
                    document.getElementById('file-list').appendChild(div);
                    log("Done: " + fileMeta.name);
                }
            } else fileChunks.push(d);
        };
    }

    async function sendFiles() {
        const files = document.getElementById('file-input').files;
        if(!files.length || !dataChannel) return;

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
                        log("Sent: " + f.name);
                        setTimeout(resolve, 500); 
                    }
                };
                const readSlice = o => reader.readAsArrayBuffer(f.slice(o, o+CHUNK));
                readSlice(0);
            });
        }
    }
</script>
</body>
</html>
  `;

  return new NextResponse(html, {
    headers: { 'content-type': 'text/html' },
  });
}