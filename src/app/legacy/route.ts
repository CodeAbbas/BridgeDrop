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
    return new NextResponse("<h1>Config Error</h1><p>Missing API Keys</p>", { status: 500, headers: {'content-type':'text/html'} });
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>BridgeDrop Lite</title>
    <style>
        /* Legacy CSS for iOS 12 Compatibility */
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f4f7f9; padding: 15px; color: #333; margin: 0; }
        .container { background: #ffffff; border-radius: 15px; padding: 25px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 400px; margin: 20px auto; text-align: center; border: 1px solid #eee; }
        h1 { margin: 0 0 10px 0; font-size: 22px; color: #222; }
        #status { font-size: 12px; font-weight: bold; color: #888; text-transform: uppercase; margin-bottom: 20px; }
        
        button { width: 100%; padding: 16px; margin: 8px 0; border: none; border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; -webkit-appearance: none; }
        .btn-blue { background: #007bff; color: white; }
        .btn-green { background: #28a745; color: white; }
        .btn-outline-red { background: transparent; color: #dc3545; border: 2px solid #dc3545; margin-top: 15px; }
        
        input[type="text"] { width: 90%; padding: 12px; font-size: 28px; text-align: center; border: 2px solid #ddd; border-radius: 10px; margin-bottom: 10px; font-family: monospace; text-transform: uppercase; }
        .room-box { background: #f8f9fa; padding: 15px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #e9ecef; }
        .room-label { font-size: 10px; color: #999; display: block; margin-bottom: 5px; }
        .room-id { font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #333; }
        
        .file-item { background: #eef9f1; padding: 12px; margin-bottom: 8px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #d4edda; }
        .file-name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; text-align: left; padding-right: 10px; }
        .open-btn { width: auto; padding: 6px 12px; margin: 0; font-size: 12px; background: #28a745; color: white; }
        
        .hidden { display: none; }
        #debug { font-size: 9px; color: #aaa; text-align: left; margin-top: 25px; border-top: 1px solid #eee; padding-top: 10px; max-height: 100px; overflow-y: auto; font-family: monospace; }
        
        /* Progress Bar */
        #progress-wrap { width: 100%; bg: #eee; height: 6px; border-radius: 3px; overflow: hidden; margin: 10px 0; display: none; }
        #progress-bar { width: 0%; height: 100%; background: #007bff; transition: width 0.3s; }
    </style>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js"></script>
</head>
<body>
<div class="container">
    <h1>🍏 BridgeDrop Lite</h1>
    <div id="status">Connecting...</div>

    <div id="view-home" class="hidden">
        <button class="btn-blue" onclick="startReceive()">⬇️ Receive Files</button>
        <button class="btn-green" onclick="startSend()">⬆️ Send Files</button>
    </div>

    <div id="view-receive" class="hidden">
        <p style="font-size: 14px; color: #666;">Enter 6-digit code:</p>
        <input type="text" id="code-input" maxlength="6" placeholder="------">
        <button class="btn-blue" onclick="joinRoom()">Connect</button>
        <button style="background:none; color:#999; font-size:13px;" onclick="show('view-home')">Cancel</button>
    </div>

    <div id="view-transfer" class="hidden">
        <div class="room-box">
            <span class="room-label">ROOM CODE</span>
            <div id="room-display" class="room-id"></div>
        </div>
        
        <div id="progress-wrap"><div id="progress-bar"></div></div>
        
        <div id="file-list"></div>
        
        <div id="sender-area" class="hidden" style="margin-top: 20px; border-top: 1px solid #eee; pt: 15px;">
            <input type="file" id="file-input" multiple style="font-size: 12px; margin-bottom: 10px;">
            <button class="btn-blue" onclick="handleSend()">Send Selected Files</button>
        </div>

        <button id="download-all-btn" class="hidden btn-blue" onclick="downloadAllFiles()">Download All</button>
        <button id="clear-btn" class="hidden btn-outline-red" onclick="clearFiles()">🗑 Wipe Memory</button>
    </div>

    <div id="debug"></div>
</div>

<script>
    /* Core Logic with iOS 12 Polyfill Support */
    const firebaseConfig = ${JSON.stringify(firebaseConfig)};
    let db, auth, peerConnection, dataChannel, roomId, fileChunks=[], fileMeta=null;
    let receivedFiles = [];
    const rtcConfig = { iceServers: [{ urls: 'stun:stun1.l.google.com:19302' }] };

    function log(m) { 
        var d = document.getElementById('debug');
        d.innerHTML += "<div>> " + m + "</div>"; 
        d.scrollTop = d.scrollHeight;
    }

    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
        auth.signInAnonymously().catch(function(e) { log("Auth Error: " + e.message); });
        auth.onAuthStateChanged(function(u) {
            if(u) {
                document.getElementById('status').innerText = "System Ready";
                show('view-home');
            }
        });
    } catch(e) { log("Init Error: " + e.message); }

    function show(id) {
        var views = ['view-home','view-receive','view-transfer'];
        for(var i=0; i<views.length; i++) { document.getElementById(views[i]).style.display = 'none'; }
        document.getElementById(id).style.display = 'block';
    }

    function startSend() {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        setupPeer(true);
        show('view-transfer');
        document.getElementById('room-display').innerText = roomId;
        document.getElementById('sender-area').style.display = 'block';
    }

    function joinRoom() {
        roomId = document.getElementById('code-input').value.toUpperCase();
        if(roomId.length !== 6) return;
        setupPeer(false);
        show('view-transfer');
        document.getElementById('room-display').innerText = roomId;
    }

    function setupPeer(isInit) {
        peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnection.onicecandidate = function(e) {
            if(e.candidate) db.collection('rooms').doc(roomId).collection(isInit?'callerCandidates':'calleeCandidates').add(e.candidate.toJSON());
        };
        peerConnection.onconnectionstatechange = function() {
            document.getElementById('status').innerText = peerConnection.connectionState;
        };

        if(isInit) {
            dataChannel = peerConnection.createDataChannel("bridge-drop");
            setupDataHandlers();
            peerConnection.createOffer().then(function(o) { return peerConnection.setLocalDescription(o); }).then(function() {
                db.collection('rooms').doc(roomId).set({ offer: {type: 'offer', sdp: peerConnection.localDescription.sdp}, createdAt: Date.now() });
            });
            db.collection('rooms').doc(roomId).onSnapshot(function(s) {
                var d = s.data();
                if(!peerConnection.currentRemoteDescription && d && d.answer) peerConnection.setRemoteDescription(new RTCSessionDescription(d.answer));
            });
            listenCandidates('calleeCandidates');
        } else {
            peerConnection.ondatachannel = function(e) { dataChannel = e.channel; setupDataHandlers(); };
            db.collection('rooms').doc(roomId).onSnapshot(function(s) {
                var d = s.data();
                if (d && d.offer && !peerConnection.currentRemoteDescription) {
                    peerConnection.setRemoteDescription(new RTCSessionDescription(d.offer))
                        .then(function() { return peerConnection.createAnswer(); })
                        .then(function(a) { return peerConnection.setLocalDescription(a); })
                        .then(function() { db.collection('rooms').doc(roomId).update({answer: {type:'answer', sdp: peerConnection.localDescription.sdp}}); });
                    listenCandidates('callerCandidates');
                }
            });
        }
    }

    function listenCandidates(col) {
        db.collection('rooms').doc(roomId).collection(col).onSnapshot(function(s) {
            s.docChanges().forEach(function(c) { if(c.type==='added') peerConnection.addIceCandidate(new RTCIceCandidate(c.doc.data())); });
        });
    }

    function setupDataHandlers() {
        dataChannel.onmessage = function(e) {
            if (typeof e.data === 'string') {
                var m = JSON.parse(e.data);
                if (m.type === 'meta') { fileMeta = m; fileChunks = []; log("Rx: " + m.name); }
                else if (m.type === 'end') { finalizeFile(); }
            } else { fileChunks.push(e.data); }
        };
    }

    function finalizeFile() {
        var blob = new Blob(fileChunks, { type: fileMeta.mime });
        var url = URL.createObjectURL(blob);
        receivedFiles.push({ name: fileMeta.name, url: url });
        
        var div = document.createElement('div');
        div.className = "file-item";
        div.innerHTML = '<span class="file-name">' + fileMeta.name + '</span><button class="open-btn">Open</button>';
        div.querySelector('button').onclick = function() { window.open(url); };
        
        document.getElementById('file-list').appendChild(div);
        document.getElementById('download-all-btn').style.display = 'block';
        document.getElementById('clear-btn').style.display = 'block';
    }

    async function handleSend() {
        var files = document.getElementById('file-input').files;
        if(!files.length || !dataChannel) return;

        for (var i=0; i<files.length; i++) {
            var f = files[i];
            log("Sending: " + f.name);
            dataChannel.send(JSON.stringify({type:'meta', name:f.name, mime:f.type}));
            
            var CHUNK_SIZE = 16384;
            var buffer = await f.arrayBuffer();
            
            for (var offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
                while (dataChannel.bufferedAmount > 1000000) {
                    await new Promise(function(r) { setTimeout(r, 100); });
                }
                dataChannel.send(buffer.slice(offset, offset + CHUNK_SIZE));
            }
            dataChannel.send(JSON.stringify({type:'end'}));
            log("Sent: " + f.name);
        }
    }

    function clearFiles() {
        receivedFiles.forEach(function(f) { URL.revokeObjectURL(f.url); });
        receivedFiles = [];
        document.getElementById('file-list').innerHTML = '';
        document.getElementById('download-all-btn').style.display = 'none';
        document.getElementById('clear-btn').style.display = 'none';
        log("Memory Cleared.");
    }

    function downloadAllFiles() {
        receivedFiles.forEach(function(f, i) {
            setTimeout(function() {
                var a = document.createElement('a');
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
