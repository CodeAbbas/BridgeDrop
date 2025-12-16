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
    <title>BridgeDrop Lite</title>
    <style>
        /* Modern Reset & Base */
        * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            background: linear-gradient(135deg, #f0f4ff 0%, #e0e7ff 100%);
            margin: 0; 
            padding: 20px; 
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #1e293b;
        }

        /* Glass Card Effect */
        .card { 
            background: rgba(255, 255, 255, 0.9); 
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 24px; 
            padding: 32px; 
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); 
            width: 100%;
            max-width: 420px; 
            text-align: center;
            transition: all 0.3s ease;
        }

        /* Typography */
        h1 { 
            margin: 0 0 8px 0; 
            font-size: 24px; 
            font-weight: 700;
            color: #0f172a;
            letter-spacing: -0.5px;
        }
        
        .subtitle {
            font-size: 14px;
            color: #64748b;
            margin-bottom: 24px;
        }

        /* Buttons (Mimicking Tailwind styles) */
        button { 
            width: 100%; 
            padding: 16px; 
            margin: 8px 0; 
            border: none; 
            border-radius: 16px; 
            font-size: 16px; 
            font-weight: 600; 
            cursor: pointer; 
            transition: transform 0.1s ease, opacity 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        button:active { transform: scale(0.98); }
        
        .btn-blue { 
            background: #2563eb; 
            color: white; 
            box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);
        }
        .btn-green { 
            background: #10b981; 
            color: white; 
            box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2);
        }
        .btn-red { 
            background: #ef4444; 
            color: white; 
            box-shadow: 0 4px 6px -1px rgba(239, 68, 68, 0.2);
        }
        .btn-secondary {
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #e2e8f0;
        }

        /* Inputs */
        input { 
            width: 100%; 
            padding: 16px; 
            font-size: 28px; 
            text-align: center; 
            border: 2px solid #e2e8f0; 
            border-radius: 16px; 
            margin-bottom: 16px; 
            text-transform: uppercase; 
            background: #f8fafc;
            color: #0f172a;
            font-family: monospace;
            letter-spacing: 2px;
            outline: none;
            transition: border-color 0.2s;
        }
        input:focus { border-color: #2563eb; background: white; }

        /* Status Pills */
        #status { 
            display: inline-block;
            margin: 0 auto 24px auto; 
            padding: 6px 16px;
            background: #f1f5f9;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        /* File Items */
        .file-item { 
            background: #f0fdf4; 
            border: 1px solid #bbf7d0;
            padding: 12px 16px; 
            margin-bottom: 8px; 
            border-radius: 12px; 
            text-align: left; 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            animation: fadeIn 0.3s ease;
        }
        .file-item span {
            color: #166534;
            font-weight: 500;
        }
        .file-item button { 
            width: auto; 
            margin: 0; 
            padding: 8px 16px; 
            font-size: 13px; 
            background: #16a34a; 
            border-radius: 8px;
            box-shadow: none;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .hidden { display: none !important; }
        
        /* Debug log hidden by default, can be toggled if needed but removed from view per request */
        #debug { display: none; } 
    </style>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
</head>
<body>
<div class="card">
    <!-- Header with Icon -->
    <div style="margin-bottom: 20px;">
        <div style="width: 48px; height: 48px; background: #dbeafe; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
        </div>
        <h1>BridgeDrop</h1>
        <div class="subtitle">Secure P2P File Transfer (Legacy)</div>
    </div>

    <div id="status">Connecting...</div>

    <!-- HOME -->
    <div id="view-home" class="hidden">
        <button class="btn-secondary" onclick="startReceive()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
            Receive on this iPad
        </button>
        <button class="btn-blue" onclick="startSend()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Send from here
        </button>
    </div>

    <!-- RECEIVE -->
    <div id="view-receive" class="hidden">
        <p style="color:#64748b; margin-bottom:12px; font-weight:500;">Enter Connection Code</p>
        <input type="text" id="code-input" maxlength="6" placeholder="CODE">
        <button class="btn-green" onclick="joinRoom()">Connect</button>
        <button class="btn-secondary" onclick="location.reload()" style="margin-top:16px; background:transparent; border:none; color:#94a3b8;">Cancel</button>
    </div>

    <!-- TRANSFER -->
    <div id="view-transfer" class="hidden">
        <div style="background:#f1f5f9; padding:12px; border-radius:12px; margin-bottom:20px;">
            <div style="font-size:10px; text-transform:uppercase; color:#64748b; font-weight:700; letter-spacing:1px;">Secure Room</div>
            <h2 id="room-display" style="margin:4px 0 0 0; font-size:32px; font-family:monospace; color:#0f172a;"></h2>
        </div>
        
        <!-- Files List -->
        <div id="file-list" style="margin-top:20px;"></div>
        
        <!-- Actions -->
        <button id="download-all-btn" class="hidden btn-blue" onclick="downloadAllFiles()">Download All</button>
        <button id="clear-btn" class="hidden btn-red" onclick="clearFiles()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Clear & Ready
        </button>
        
        <div id="sender-area" class="hidden" style="margin-top:20px; border:2px dashed #cbd5e1; border-radius:16px; padding:24px;">
            <div style="color:#64748b; font-weight:600; margin-bottom:12px;">Select files to send</div>
            <input type="file" id="file-input" multiple style="background:white; font-size:14px; padding:10px; border:1px solid #e2e8f0; width:100%;">
            <button class="btn-blue" onclick="sendFiles()">Send Selected Files</button>
        </div>
    </div>
    
    <!-- Hidden Debug Div (Requested to remove from view) -->
    <div id="debug"></div>
</div>
<script>
    const firebaseConfig = ${JSON.stringify(firebaseConfig)};
    function log(m) { console.log(m); document.getElementById('debug').innerHTML += "<div>"+m+"</div>"; }
    let db, auth, peerConnection, dataChannel, roomId, fileChunks=[], fileMeta=null;
    
    // Store file objects {name, url}
    let receivedFiles = []; 
    
    const rtcConfig = { iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }] };
    const ROOM_TTL = 24 * 60 * 60 * 1000;

    function triggerDownload(url, filename) {
        var win = window.open(url, '_blank');
        if (!win) window.location.href = url;
    }

    function downloadAllFiles() {
        if (receivedFiles.length === 0) return;
        alert("Starting sequential download. Please keep this tab open.");
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
        receivedFiles.forEach(f => {
            if (f.url) URL.revokeObjectURL(f.url);
        });
        receivedFiles = []; 

        document.getElementById('file-list').innerHTML = '';
        document.getElementById('download-all-btn').style.display = 'none';
        document.getElementById('clear-btn').style.display = 'none';
        
        log("Memory cleared.");
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
                document.getElementById('status').innerText = "System Secure";
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
                        log("Room Expired!");
                        document.getElementById('status').innerText = "Expired";
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
                    
                    document.getElementById('download-all-btn').style.display = 'block';
                    document.getElementById('clear-btn').style.display = 'block';

                    const btnId = 'btn-' + Math.random().toString(36).substr(2, 9);
                    const div = document.createElement('div');
                    div.className = 'file-item';
                    div.innerHTML = '<span style="font-size:12px; overflow:hidden; text-overflow:ellipsis; width: 60%;">' + fileMeta.name + '</span> <button id="' + btnId + '">Open</button>';
                    
                    document.getElementById('file-list').appendChild(div);
                    document.getElementById(btnId).onclick = function() { triggerDownload(url, fileMeta.name); };
                    
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