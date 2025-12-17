import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    return new NextResponse("<h1>Config Error</h1><p>Missing API Keys</p>", { 
      status: 500, 
      headers: { 'content-type': 'text/html' } 
    });
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>BridgeDrop Lite | P2P</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
    <style>
        .log-box::-webkit-scrollbar { width: 4px; }
        .log-box::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
    </style>
</head>
<body class="bg-slate-50 text-slate-900 font-sans min-h-screen flex items-center justify-center p-4">

<div class="max-w-md w-full bg-white rounded-2xl shadow-xl p-6 border border-slate-100">
    <header class="text-center mb-6">
        <h1 class="text-2xl font-bold text-blue-600">🍏 BridgeDrop Lite</h1>
        <div id="status" class="text-sm font-medium text-slate-500 mt-1 uppercase tracking-wider">Initializing...</div>
    </header>

    <div id="view-home" class="hidden space-y-3">
        <button onclick="startReceive()" class="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all transform active:scale-95 shadow-lg shadow-blue-200">⬇️ Receive Files</button>
        <button onclick="startSend()" class="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-all transform active:scale-95 shadow-lg shadow-emerald-200">⬆️ Send Files</button>
    </div>

    <div id="view-receive" class="hidden space-y-4 text-center">
        <p class="text-slate-600">Enter the 6-digit connection code:</p>
        <input type="text" id="code-input" maxlength="6" placeholder="______" 
               class="w-full text-4xl text-center font-mono tracking-widest border-2 border-slate-200 rounded-xl py-3 focus:border-blue-500 focus:outline-none uppercase">
        <button onclick="joinRoom()" class="w-full py-3 bg-blue-600 text-white rounded-xl font-bold">Connect</button>
        <button onclick="show('view-home')" class="text-slate-400 text-sm">Back</button>
    </div>

    <div id="view-transfer" class="hidden space-y-4">
        <div class="bg-slate-100 rounded-lg p-3 text-center">
            <span class="text-xs text-slate-500 block uppercase font-bold">Room Code</span>
            <h2 id="room-display" class="text-3xl font-mono font-bold text-slate-800 tracking-widest"></h2>
        </div>
        
        <div id="progress-container" class="hidden w-full bg-slate-200 rounded-full h-2">
            <div id="progress-bar" class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
        </div>

        <div id="file-list" class="space-y-2 max-h-60 overflow-y-auto"></div>
        
        <div id="actions-area" class="flex flex-col gap-2">
            <button id="download-all-btn" class="hidden w-full py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md" onclick="downloadAllFiles()">Download All</button>
            <button id="clear-btn" class="hidden w-full py-3 border-2 border-rose-500 text-rose-600 hover:bg-rose-50 rounded-xl font-bold" onclick="clearFiles()">🗑 Wipe & Ready Next</button>
        </div>

        <div id="sender-area" class="hidden space-y-3 pt-4 border-t border-slate-100">
            <input type="file" id="file-input" multiple class="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
            <button class="w-full py-3 bg-blue-600 text-white rounded-xl font-bold" onclick="handleSend()">Send Selected Files</button>
        </div>
    </div>

    <div id="debug" class="log-box mt-6 pt-4 border-t border-slate-50 text-[10px] text-slate-400 font-mono h-24 overflow-y-auto bg-slate-50 p-2 rounded"></div>
</div>

<script>
    const firebaseConfig = ${JSON.stringify(firebaseConfig)};
    let db, auth, peerConnection, dataChannel, roomId, fileChunks=[], fileMeta=null;
    let receivedFiles = [];
    const rtcConfig = { iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun2.l.google.com:19302' }] };

    function log(m) {
        const d = document.getElementById('debug');
        d.innerHTML += "<div>> "+m+"</div>";
        d.scrollTop = d.scrollHeight;
    }

    // WebRTC Signaling Logic (Similar to your version but with clean room-close)
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
        auth.signInAnonymously().catch(e => log("Auth Error: "+e.message));
        auth.onAuthStateChanged(u => {
            if(u) {
                document.getElementById('status').innerText = "System Ready";
                show('view-home');
            }
        });
    } catch(e) { log("Init Error: "+e.message); }

    function show(id) {
        ['view-home','view-receive','view-transfer'].forEach(v => document.getElementById(v).classList.add('hidden'));
        document.getElementById(id).classList.remove('hidden');
    }

    function startSend() {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        setupPeer(true);
        show('view-transfer');
        document.getElementById('room-display').innerText = roomId;
        document.getElementById('sender-area').classList.remove('hidden');
    }

    function joinRoom() {
        roomId = document.getElementById('code-input').value.toUpperCase();
        if(roomId.length!==6) return;
        setupPeer(false);
        show('view-transfer');
        document.getElementById('room-display').innerText = roomId;
    }

    function setupPeer(isInit) {
        peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnection.onicecandidate = e => {
            if(e.candidate) db.collection('rooms').doc(roomId).collection(isInit?'callerCandidates':'calleeCandidates').add(e.candidate.toJSON());
        };
        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            document.getElementById('status').innerText = state;
            if(state === 'connected') log("P2P Link Established");
        };

        if(isInit) {
            dataChannel = peerConnection.createDataChannel("bridge-drop", { ordered: true });
            setupDataHandlers();
            peerConnection.createOffer().then(o => peerConnection.setLocalDescription(o)).then(() => {
                db.collection('rooms').doc(roomId).set({ offer: {type: 'offer', sdp: peerConnection.localDescription.sdp}, createdAt: Date.now() });
            });
            db.collection('rooms').doc(roomId).onSnapshot(s => {
                const d = s.data();
                if(!peerConnection.currentRemoteDescription && d?.answer) peerConnection.setRemoteDescription(new RTCSessionDescription(d.answer));
            });
            listenCandidates('calleeCandidates');
        } else {
            peerConnection.ondatachannel = e => { dataChannel = e.channel; setupDataHandlers(); };
            db.collection('rooms').doc(roomId).onSnapshot(s => {
                const d = s.data();
                if (d?.offer && !peerConnection.currentRemoteDescription) {
                    peerConnection.setRemoteDescription(new RTCSessionDescription(d.offer))
                        .then(() => peerConnection.createAnswer())
                        .then(a => peerConnection.setLocalDescription(a))
                        .then(() => db.collection('rooms').doc(roomId).update({answer: {type:'answer', sdp: peerConnection.localDescription.sdp}}));
                    listenCandidates('callerCandidates');
                }
            });
        }
    }

    function listenCandidates(col) {
        db.collection('rooms').doc(roomId).collection(col).onSnapshot(s => {
            s.docChanges().forEach(c => { if(c.type==='added') peerConnection.addIceCandidate(new RTCIceCandidate(c.doc.data())); });
        });
    }

    function setupDataHandlers() {
        dataChannel.binaryType = 'arraybuffer';
        dataChannel.onmessage = e => {
            if (typeof e.data === 'string') {
                const m = JSON.parse(e.data);
                if (m.type === 'meta') {
                    fileMeta = m;
                    fileChunks = [];
                    log("Incoming: " + m.name);
                    updateProgress(0);
                } else if (m.type === 'end') {
                    finalizeFile();
                }
            } else {
                fileChunks.push(e.data);
            }
        };
    }

    function finalizeFile() {
        const blob = new Blob(fileChunks, { type: fileMeta.mime });
        const url = URL.createObjectURL(blob);
        receivedFiles.push({ name: fileMeta.name, url: url });
        
        const div = document.createElement('div');
        div.className = "flex items-center justify-between bg-emerald-50 p-3 rounded-xl border border-emerald-100";
        div.innerHTML = \`<span class="text-xs font-medium truncate w-40 text-emerald-800">\${fileMeta.name}</span>
                        <button onclick="window.open('\${url}')" class="bg-emerald-600 text-white px-3 py-1 rounded-lg text-xs font-bold">Open</button>\`;
        document.getElementById('file-list').appendChild(div);
        
        document.getElementById('download-all-btn').classList.remove('hidden');
        document.getElementById('clear-btn').classList.remove('hidden');
        log("Received: " + fileMeta.name);
        updateProgress(0);
    }

    async function handleSend() {
        const files = document.getElementById('file-input').files;
        if(!files.length || !dataChannel) return;

        for (let f of files) {
            log("Sending: " + f.name);
            dataChannel.send(JSON.stringify({type:'meta', name:f.name, mime:f.type}));
            
            const CHUNK_SIZE = 16384; 
            const buffer = await f.arrayBuffer();
            
            for (let i = 0; i < buffer.byteLength; i += CHUNK_SIZE) {
                // Flow control to prevent memory overflow
                while (dataChannel.bufferedAmount > 1024 * 1024) {
                    await new Promise(r => setTimeout(r, 100));
                }
                dataChannel.send(buffer.slice(i, i + CHUNK_SIZE));
                if (i % (CHUNK_SIZE * 10) === 0) updateProgress((i / buffer.byteLength) * 100);
            }
            dataChannel.send(JSON.stringify({type:'end'}));
            log("Sent: " + f.name);
        }
        updateProgress(0);
    }

    function updateProgress(pct) {
        const container = document.getElementById('progress-container');
        const bar = document.getElementById('progress-bar');
        container.classList.remove('hidden');
        bar.style.width = pct + "%";
        if(pct === 0) container.classList.add('hidden');
    }

    function clearFiles() {
        receivedFiles.forEach(f => URL.revokeObjectURL(f.url));
        receivedFiles = [];
        fileChunks = [];
        document.getElementById('file-list').innerHTML = '';
        document.getElementById('download-all-btn').classList.add('hidden');
        document.getElementById('clear-btn').classList.add('hidden');
        log("Memory Purged. Ready.");
    }

    function downloadAllFiles() {
        receivedFiles.forEach((f, i) => {
            setTimeout(() => {
                const a = document.createElement('a');
                a.href = f.url;
                a.download = f.name;
                a.click();
            }, i * 1500);
        });
    }
</script>
</body>
</html>
  `;

  return new NextResponse(html, { headers: { 'content-type': 'text/html' } });
}
