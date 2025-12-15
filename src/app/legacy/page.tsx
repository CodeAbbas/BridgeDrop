'use client';

import React, { useState, useEffect, useRef } from 'react';
// We do NOT import Firebase at the top. This prevents the "White Screen" crash if the SDK is incompatible.
// import { ... } from 'firebase/auth'; <--- Removed

export default function LegacyBridgeDrop() {
  const [logs, setLogs] = useState<string[]>(["System Ready..."]);
  const [isClient, setIsClient] = useState(false);

  // 1. Safe Logger that works even if React State fails (writes to a global variable)
  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    const fullMsg = `[${time}] ${msg}`;
    console.log(fullMsg);
    setLogs(prev => [fullMsg, ...prev]);
  };

  // 2. Global Error Handler (The "Black Box" Recorder)
  useEffect(() => {
    setIsClient(true);
    
    const errorHandler = (msg: any, url: any, lineNo: any, columnNo: any, error: any) => {
      addLog(`CRASH: ${msg} (Line: ${lineNo})`);
      return false;
    };
    
    window.onerror = errorHandler;
    window.addEventListener('unhandledrejection', (e) => {
      addLog(`PROMISE FAIL: ${e.reason}`);
    });

    // Start the Logic
    initApp();

    return () => {
      window.onerror = null;
    };
  }, []);

  const initApp = async () => {
    addLog("Starting Dynamic Import...");
    
    try {
      // 3. Dynamic Import: Load Firebase only when needed
      const { initializeApp, getApps, getApp } = await import('firebase/app');
      const { getAuth, signInAnonymously, setPersistence, inMemoryPersistence, onAuthStateChanged } = await import('firebase/auth');
      const { getFirestore, collection, doc, setDoc, onSnapshot, addDoc, updateDoc, getDoc } = await import('firebase/firestore');
      
      addLog("SDK Loaded. Config...");
      
      // Manually recreate config to avoid import issues
      const firebaseConfig = {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
      };

      if (!firebaseConfig.apiKey) throw new Error("Missing API Key");

      const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      const auth = getAuth(app);
      const db = getFirestore(app);

      addLog("Firebase Init. Auth...");

      // Force Memory Persistence for iOS 12
      await setPersistence(auth, inMemoryPersistence);
      await signInAnonymously(auth);
      
      onAuthStateChanged(auth, (u) => {
        if (u) addLog(`✅ AUTH SUCCESS: ${u.uid.slice(0,4)}`);
        else addLog("Auth State: Signed Out");
      });

    } catch (err: any) {
      addLog(`❌ INIT ERROR: ${err.message}`);
      if (err.stack) addLog(err.stack.substring(0, 100));
    }
  };

  if (!isClient) return <div className="p-10 text-center">Loading Diagnostics...</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-mono text-sm">
      <div className="max-w-md mx-auto bg-white border-2 border-slate-300 rounded-xl overflow-hidden">
        <div className="bg-slate-800 text-white p-4 font-bold flex justify-between">
          <span>🛠 DIAGNOSTICS MODE</span>
          <span className="text-green-400">ONLINE</span>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 p-3 rounded text-xs text-yellow-800">
             If you see this, the Page Component mounted successfully.
             Watch the logs below.
          </div>
        </div>

        <div className="bg-black text-green-400 p-4 min-h-[300px] overflow-y-auto border-t-2 border-slate-300">
          <div className="mb-2 border-b border-gray-700 pb-1 text-gray-500">CONSOLE OUTPUT:</div>
          {logs.map((log, i) => (
            <div key={i} className="mb-1 border-b border-gray-800 pb-1 last:border-0 break-words">
              {log}
            </div>
          ))}
        </div>
        
        {/* 4. Simple Polyfill Injection for older Safari */}
        <script 
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof globalThis === 'undefined') { window.globalThis = window; }
            `
          }} 
        />
      </div>
    </div>
  );
}