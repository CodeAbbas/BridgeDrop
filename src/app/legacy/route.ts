import { NextResponse } from 'next/server';

// CRITICAL: This ensures the route runs at request time to read Env Vars securely
export const dynamic = 'force-dynamic'; 

export async function GET() {
  // 1. Read keys from the Server Environment
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
  };

  // 2. Construct the HTML string (The "Lite" App)
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
        input { width: 90%; padding: 10px; font-size: 24px; text-align: center; border: 2px solid #ccc; border-radius: 8px; margin-bottom: 10px; text-transform: uppercase; }
        #status { font-weight: bold; margin: 10px 0; color: #666; }
        .hidden { display: none; }
        .log-box { font-size: 10px; color: #999; text-align: left; margin-top: 20px; border-top: 1px solid #eee; padding-top: 5px; }
    </style>
    
    <!-- Load Firebase Compat (Safe for iOS 12) -->
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
</head>
<body>

<div class="card">
    <h1>🍏 BridgeDrop Lite (Secure)</h1>
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
        <div id="dl-area" class="hidden">
            <h3>✅ File Ready!</h3>
            <a id="dl-link" href="#" class="btn-green" style="display:block; text-decoration:none;">Download</a>
        </div>
        <div id="sender-area" class="hidden">
            <input type="file" id="file-input">
            <button class="btn-blue" onclick="sendFile()">Send File</button>
        </div>
    </div>
    
    <div id="debug" class="log-box"></div>
</div>

<script>
    // INJECTED CONFIG FROM SERVER
    const firebaseConfig = ${JSON.stringify(firebaseConfig)};

    function log(m) { console.log(m); document.getElementById('debug').innerHTML += "<div>"+m+"</div>"; }

    let db, auth, peerConnection, dataChannel, roomId, fileChunks=[], fileMeta=null;
    const rtcConfig = { iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }] };

    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
        
        // Force Memory Persistence for iOS 12
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
                db.collection('rooms').doc(roomId).set({offer:{type:peerConnection.localDescription.type, sdp:peerConnection.localDescription.sdp}});
            });
            db.collection('rooms').doc(roomId).onSnapshot(s => {
                const d = s.data();
                if(!peerConnection.currentRemoteDescription && d && d.answer) peerConnection.setRemoteDescription(new RTCSessionDescription(d.answer));
            });
            listenCandidates('calleeCandidates');
        } else {
            peerConnection.ondatachannel = e => { dataChannel = e.channel; setupData(); };
            db.collection('rooms').doc(roomId).get().then(s => {
                if(s.exists) {
                    peerConnection.setRemoteDescription(new RTCSessionDescription(s.data().offer))
                        .then(() => peerConnection.createAnswer())
                        .then(a => peerConnection.setLocalDescription(a))
                        .then(() => db.collection('rooms').doc(roomId).update({answer:{type:peerConnection.localDescription.type, sdp:peerConnection.localDescription.sdp}}));
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
                    const lnk = document.getElementById('dl-link');
                    lnk.href = url; lnk.download = fileMeta.name;
                    document.getElementById('dl-area').style.display='block';
                    log("Done");
                }
            } else fileChunks.push(d);
        };
    }

    function sendFile() {
        const f = document.getElementById('file-input').files[0];
        if(!f || !dataChannel) return;
        dataChannel.send(JSON.stringify({type:'meta', name:f.name, mime:f.type}));
        const reader = new FileReader();
        let offset = 0;
        reader.onload = e => {
            dataChannel.send(e.target.result);
            offset += e.target.result.byteLength;
            if(offset < f.size) readSlice(offset);
            else { dataChannel.send(JSON.stringify({type:'end'})); log("Sent"); }
        };
        const readSlice = o => reader.readAsArrayBuffer(f.slice(o, o+16384));
        readSlice(0);
    }
</script>
</body>
</html>
  `;

  return new NextResponse(html, {
    headers: { 'content-type': 'text/html' },
  });
}