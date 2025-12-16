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
    <title>BridgeDrop</title>
    <style>
        /* --- TAILWIND RECREATION --- */
        :root {
            --slate-50: #f8fafc;
            --slate-100: #f1f5f9;
            --slate-200: #e2e8f0;
            --slate-400: #94a3b8;
            --slate-500: #64748b;
            --slate-600: #475569;
            --slate-800: #1e293b;
            --blue-50: #eff6ff;
            --blue-100: #dbeafe;
            --blue-500: #3b82f6;
            --blue-600: #2563eb;
            --emerald-50: #ecfdf5;
            --emerald-100: #d1fae5;
            --emerald-500: #10b981;
            --emerald-600: #059669;
            --red-500: #ef4444;
            --red-600: #dc2626;
        }

        body { 
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: var(--slate-50);
            margin: 0; 
            padding: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            color: var(--slate-800);
            overflow-x: hidden;
        }

        /* Background Blobs */
        body::before {
            content: '';
            position: fixed;
            top: -10%; left: -10%; width: 80%; height: 80%;
            background: radial-gradient(circle, rgba(168,85,247,0.15) 0%, rgba(255,255,255,0) 70%);
            z-index: -1;
            pointer-events: none;
        }
        body::after {
            content: '';
            position: fixed;
            bottom: -10%; right: -10%; width: 80%; height: 80%;
            background: radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(255,255,255,0) 70%);
            z-index: -1;
            pointer-events: none;
        }

        .card { 
            width: 100%;
            max-width: 480px;
            background: rgba(255, 255, 255, 0.4); 
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.5);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            border-radius: 40px;
            padding: 32px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }

        /* Header */
        .subtitle { font-size: 14px; color: #64748b; margin-bottom: 24px; }
        
        #status { 
            display: inline-block;
            margin: 0 auto 24px auto; 
            padding: 6px 16px;
            background: rgba(255,255,255,0.5);
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            color: var(--slate-600);
            text-transform: uppercase;
            letter-spacing: 1px;
            border: 1px solid rgba(255,255,255,0.5);
        }

        /* Home View Buttons */
        .action-card {
            width: 100%;
            background: rgba(255,255,255,0.6);
            border: 1px solid rgba(255,255,255,0.6);
            border-radius: 24px;
            padding: 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
            cursor: pointer;
            transition: all 0.2s;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            text-decoration: none;
            color: inherit;
            appearance: none;
            font-family: inherit;
        }
        .action-card:active { transform: scale(0.98); background: rgba(255,255,255,0.8); }
        .action-left { display: flex; align-items: center; gap: 16px; }
        .icon-circle { 
            padding: 12px; border-radius: 9999px; display: flex; align-items: center; justify-content: center; 
        }
        .icon-blue { background: rgba(59, 130, 246, 0.1); color: var(--blue-600); }
        .icon-green { background: rgba(16, 185, 129, 0.1); color: var(--emerald-600); }
        
        .action-text { text-align: left; }
        .action-title { font-weight: 700; color: var(--slate-800); display: block; font-size: 16px; }
        .action-subtitle { font-size: 12px; color: var(--slate-500); font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
        
        /* Input View */
        .code-input {
            width: 100%;
            background: rgba(255,255,255,0.4);
            border: 2px solid rgba(255,255,255,0.5);
            text-align: center;
            font-size: 36px;
            font-family: monospace;
            font-weight: 700;
            padding: 24px 0;
            border-radius: 32px;
            outline: none;
            text-transform: uppercase;
            letter-spacing: 0.2em;
            color: var(--slate-800);
            margin-bottom: 24px;
            transition: all 0.2s;
        }
        .code-input:focus { border-color: var(--blue-500); background: white; }

        /* Transfer View */
        .room-badge {
            display: block;
            padding: 16px;
            background: rgba(255,255,255,0.4);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 24px;
            margin-bottom: 24px;
        }
        .room-label { font-size: 10px; text-transform:uppercase; color:var(--slate-500); font-weight:700; letter-spacing:1px; margin-bottom: 4px; }
        .room-code-text { font-family: monospace; font-size: 32px; font-weight: 700; color: var(--slate-800); letter-spacing: 0.1em; }
        
        .sender-box {
            margin-top: 20px;
            background: rgba(255,255,255,0.4);
            border: 2px dashed rgba(59,130,246,0.3);
            border-radius: 32px;
            padding: 32px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            position: relative;
        }
        .sender-box:active { background: rgba(255,255,255,0.6); border-color: var(--blue-500); }
        .upload-icon-bg { background: rgba(255,255,255,0.6); padding: 16px; border-radius: 9999px; margin-bottom: 12px; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05); }

        /* File List */
        .file-list-container { max-height: 240px; overflow-y: auto; margin-top: 24px; -webkit-overflow-scrolling: touch; }
        .file-item {
            background: rgba(16,185,129,0.1);
            border: 1px solid rgba(16,185,129,0.2);
            border-radius: 16px;
            padding: 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
            animation: slideUp 0.3s ease-out;
        }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        
        .file-name { font-size: 13px; font-weight: 600; color: var(--emerald-600); max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        
        /* Buttons */
        .btn-base {
            width: 100%;
            padding: 16px;
            border-radius: 20px;
            border: none;
            font-weight: 700;
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: all 0.2s;
            font-family: inherit;
            margin-bottom: 12px;
        }
        .btn-base:active { transform: scale(0.96); }
        
        .btn-primary { background: var(--blue-600); color: white; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3); }
        .btn-success { background: var(--emerald-500); color: white; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); }
        .btn-danger { background: var(--slate-100); color: var(--slate-600); }
        .btn-danger:active { background: var(--red-500); color: white; }
        .btn-ghost { background: transparent; color: var(--slate-400); font-size: 14px; }

        .btn-sm { padding: 8px 16px; border-radius: 12px; font-size: 12px; width: auto; margin: 0; }

        .hidden { display: none !important; }
        #debug { display: none; } 
    </style>
    
    <!-- Icons (Inline SVG) -->
    <svg style="display:none;">
        <symbol id="icon-share" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></symbol>
        <symbol id="icon-smartphone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></symbol>
        <symbol id="icon-tablet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></symbol>
        <symbol id="icon-arrow-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></symbol>
        <symbol id="icon-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></symbol>
        <symbol id="icon-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></symbol>
        <symbol id="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></symbol>
    </svg>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
</head>
<body>
<div class="card">
    
    <!-- Header -->
    <div style="margin-bottom: 32px;">
        <div style="width: 56px; height: 56px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
            <svg width="28" height="28" style="color:#2563eb"><use href="#icon-share"/></svg>
        </div>
        <h1 style="margin:0; font-size:24px; font-weight:700; color:var(--slate-800);">BridgeDrop</h1>
        <div class="subtitle">Secure P2P Transfer (Legacy)</div>
    </div>

    <div id="status">Connecting...</div>

    <!-- HOME -->
    <div id="view-home" class="hidden">
        <button class="action-card" onclick="startSend()">
            <div class="action-left">
                <div class="icon-circle icon-blue">
                    <svg width="24" height="24"><use href="#icon-smartphone"/></svg>
                </div>
                <div class="action-text">
                    <span class="action-title">Send Files</span>
                    <span class="action-subtitle">Create Room</span>
                </div>
            </div>
            <svg width="20" height="20" style="color:#cbd5e1"><use href="#icon-arrow-right"/></svg>
        </button>

        <button class="action-card" onclick="startReceive()">
            <div class="action-left">
                <div class="icon-circle icon-green">
                    <svg width="24" height="24"><use href="#icon-tablet"/></svg>
                </div>
                <div class="action-text">
                    <span class="action-title">Receive Files</span>
                    <span class="action-subtitle">Join Room</span>
                </div>
            </div>
            <svg width="20" height="20" style="color:#cbd5e1"><use href="#icon-arrow-right"/></svg>
        </button>
    </div>

    <!-- RECEIVE -->
    <div id="view-receive" class="hidden">
        <div style="margin-bottom:24px;">
            <h2 style="font-size:18px; margin-bottom:8px; color:var(--slate-800);">Enter Connection Code</h2>
            <p style="font-size:14px; color:var(--slate-500);">Ask the sender for the 6-digit code</p>
        </div>
        <input type="text" id="code-input" class="code-input" maxlength="6" placeholder="CODE">
        <button class="btn-base btn-primary" onclick="joinRoom()">Connect</button>
        <button class="btn-base btn-ghost" onclick="location.reload()">Cancel</button>
    </div>

    <!-- TRANSFER -->
    <div id="view-transfer" class="hidden">
        <div class="room-badge">
            <div class="room-label">Secure Room</div>
            <div id="room-display" class="room-code-text"></div>
        </div>
        
        <!-- Files List -->
        <div id="file-list" class="file-list-container"></div>
        
        <!-- Actions -->
        <button id="download-all-btn" class="hidden btn-base btn-primary" onclick="downloadAllFiles()">
            <svg width="20" height="20"><use href="#icon-download"/></svg>
            Download All (Sequential)
        </button>
        
        <button id="clear-btn" class="hidden btn-base btn-danger" onclick="clearFiles()">
            <svg width="20" height="20"><use href="#icon-refresh"/></svg>
            Clear & Ready Next
        </button>
        
        <div id="sender-area" class="hidden">
            <label class="sender-box" for="file-input">
                <div class="upload-icon-bg">
                    <svg width="32" height="32" style="color:#3b82f6"><use href="#icon-send"/></svg>
                </div>
                <span style="font-weight:700; color:var(--slate-800); margin-bottom:4px;">Tap to Send Files</span>
                <span style="font-size:12px; color:var(--slate-500);">Select Multiple</span>
            </label>
            <input type="file" id="file-input" multiple style="display:none;" onchange="sendFiles()">
        </div>
    </div>
    
    <div id="debug"></div>
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
        if (!win) window.location.href = url;
    }

    function downloadAllFiles() {
        if (receivedFiles.length === 0) return;
        alert("Starting sequential download. Please allow popups if asked.");
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
        // Revoke to free memory
        receivedFiles.forEach(f => {
            if (f.url) URL.revokeObjectURL(f.url);
        });
        receivedFiles = []; 

        document.getElementById('file-list').innerHTML = '';
        document.getElementById('download-all-btn').style.display = 'none';
        document.getElementById('clear-btn').style.display = 'none';
        
        // Ensure status reset
        if (peerConnection && peerConnection.connectionState === 'connected') {
             document.getElementById('status').innerText = "CONNECTED";
        }
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
                document.getElementById('status').innerText = "SYSTEM SECURE";
                document.getElementById('view-home').style.display = 'block';
                log("Auth: "+u.uid.slice(0,4));
            }
        });
    } catch(e) { log("Init Err: "+e.message); }

    function show(id) {
        ['view-home','view-receive','view-transfer'].forEach(v => document.getElementById(v).style.display='none');
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
        peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnection.onicecandidate = e => {
            if(e.candidate) db.collection('rooms').doc(roomId).collection(isInit?'callerCandidates':'calleeCandidates').add(e.candidate.toJSON());
        };
        peerConnection.onconnectionstatechange = () => {
             const state = peerConnection.connectionState;
             if(state === 'connected') document.getElementById('status').innerText = "CONNECTED";
             else if(state === 'failed') document.getElementById('status').innerText = "ERROR";
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
                        document.getElementById('status').innerText = "EXPIRED";
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
        dataChannel.onopen = () => { document.getElementById('status').innerText = "CONNECTED"; log("P2P Open"); };
        dataChannel.onmessage = e => {
            const d = e.data;
            if(typeof d === 'string') {
                const m = JSON.parse(d);
                if(m.type==='meta') { fileMeta=m; fileChunks=[]; log("Rx: "+m.name); }
                else if(m.type==='end') {
                    const blob = new Blob(fileChunks, {type:fileMeta.mime});
                    const url = URL.createObjectURL(blob);
                    
                    receivedFiles.push({ name: fileMeta.name, url: url });
                    
                    document.getElementById('download-all-btn').style.display = 'flex';
                    document.getElementById('clear-btn').style.display = 'flex';

                    const div = document.createElement('div');
                    div.className = 'file-item';
                    
                    const btnHtml = '<button class="btn-sm btn-success" onclick="triggerDownload(\\'' + url + '\\', \\'' + fileMeta.name + '\\')">Save</button>';
                    
                    div.innerHTML = '<span class="file-name">' + fileMeta.name + '</span> ' + btnHtml;
                    
                    document.getElementById('file-list').appendChild(div);
                    log("Done");
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