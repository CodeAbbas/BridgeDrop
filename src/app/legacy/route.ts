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
        body { font-family: -apple-system, sans-serif; background: #f0f2f5; padding: 20px; text-align: center; color: #333; }
        .card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; margin: 0 auto; }
        h1 { margin-top: 0; font-size: 20px; }
        button { width: 100%; padding: 15px; margin: 10px 0; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; }
        .btn-blue { background: #007bff; color: white; }
        .btn-green { background: #28a745; color: white; }
        .btn-gray { background: #6c757d; color: white; margin-top: 10px; }
        input { width: 90%; padding: 10px; font-size: 24px; text-align: center; border: 2px solid #ccc; border-radius: 8px; margin-bottom: 10px; text-transform: uppercase; }
        #status { font-weight: bold; margin: 10px 0; color: #666; }
        .hidden { display: none; }
        .file-item { background: #e8f5e9; padding: 10px; margin-bottom: 5px; border-radius: 8px; text-align: left; display: flex; justify-content: space-between; align-items: center; }
        .file-item button { width: auto; margin: 0; padding: 5px 10px; font-size: 12px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; }
        .log-box { font-size: 10px; color: #999; text-align: left; margin-top: 20px; border-top: 1px solid #eee; padding-top: 5px; }
        #download-all-btn { background: #6f42c1; color: white; margin-top: 15px; display: none; }
    </style>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
</head>
<body>
<div class="card">
    <h1>🍏 BridgeDrop Lite</h1>
    <div id="status">Connecting...</div>
    <div id="view-home" class="hidden">
        <button class="btn-blue" onclick="startReceive()">⬇️ Receive Files</button>
        <button class="btn-green" onclick="startSend()">⬆️ Send Files</button>
    </div>
    <div id="view-receive" class="hidden">
        <p>Enter Code:</p>
        <input type="text" id="code-input" maxlength="6" placeholder="CODE">
        <button class="btn-blue" onclick="joinRoom()">Connect</button>
    </div>
    <div id="view-transfer" class="hidden">
        <h2 id="room-display"></h2>
        
        <div id="file-list" style="margin-top:20px;"></div>
        
        <button id="download-all-btn" onclick="downloadAllFiles()">Download All</button>
        <button id="clear-btn" class="btn-gray hidden" onclick="clearFiles()">Clear List</button>
        
        <div id="sender-area" class="hidden">
            <input type="file" id="file-input" multiple>
            <button class="btn-blue" onclick="sendFiles()">Send Selected Files</button>
        </div>
    </div>
    <div id="debug" class="log-box"></div>
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
        if (!win) {
            window.location.href = url;
        }
    }

    function downloadAllFiles() {
        if (receivedFiles.length === 0) return;
        alert("Starting downloads...");
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

    // NEW: Clear function to reset UI for next batch
    function clearFiles() {
        document.getElementById('file-list').innerHTML = '';
        receivedFiles = [];
        document.getElementById('download-all-btn').style.display = 'none';
        document.getElementById('clear-btn').style.display = 'none';
        log("List cleared. Ready for more.");
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
                document.getElementById('status').innerText = "Ready";
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
        peerConnection.onconnectionstatechange = () => document.getElementById('status').innerText = peerConnection.connectionState;

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
        dataChannel.onopen = () => { document.getElementById('status').innerText = "Connected"; log("P2P Open"); };
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

                    // --- NEW LOGIC FOR INLINE IMAGES ---
                    const div = document.createElement('div');
                    div.className = 'file-item';
                    const isImage = fileMeta.mime.startsWith('image/');

                    // 1. Create Header Row (Name + Button)
                    const headerDiv = document.createElement('div');
                    headerDiv.style.cssText = "display:flex; justify-content:space-between; align-items:center; width:100%;";

                    const nameSpan = document.createElement('span');
                    nameSpan.style.cssText = "font-size:12px; overflow:hidden; text-overflow:ellipsis; max-width: 60%; font-weight:bold;";
                    nameSpan.innerText = fileMeta.name;

                    const btn = document.createElement('button');
                    btn.style.cssText = "width:auto; margin:0; padding:5px 10px; background: #28a745; color: white; border: none; border-radius: 4px;";
                    btn.innerText = isImage ? 'Open Tab' : 'Download';
                    btn.onclick = function() { triggerDownload(url, fileMeta.name); };

                    headerDiv.appendChild(nameSpan);
                    headerDiv.appendChild(btn);
                    div.appendChild(headerDiv);

                    // 2. If Image: Convert Blob to Base64 and Append
                    if (isImage) {
                        div.style.flexDirection = 'column'; 
                        
                        const imgContainer = document.createElement('div');
                        imgContainer.style.cssText = "margin-top:10px; text-align:center; width:100%; min-height: 50px;";
                        imgContainer.innerText = "Loading preview...";
                        div.appendChild(imgContainer);

                        const reader = new FileReader();
                        reader.onload = function(e) {
                            imgContainer.innerText = ""; 
                            
                            const img = document.createElement('img');
                            img.src = e.target.result; // Data URL
                            img.style.cssText = "max-width:100%; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,0.2); display:block; margin: 0 auto;";
                            
                            const hint = document.createElement('p');
                            hint.style.cssText = "font-size:10px; color:#555; margin-top:4px;";
                            hint.innerText = "Long press image to Save";

                            imgContainer.appendChild(img);
                            imgContainer.appendChild(hint);
                        };
                        reader.readAsDataURL(blob);
                    }
                    // --- END NEW LOGIC ---
                    
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