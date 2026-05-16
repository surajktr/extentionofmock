importScripts('idb.js', 'lib/supabase.js', 'supabase_config.js');

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

// ─── Alarm-based Keep-Alive ────────────────────────────────────────────────────
// Chrome MV3 service workers are killed after ~30s of inactivity.
// An alarm fires every 20 seconds to keep the SW awake. Even if the SW
// was killed, Chrome will restart it to handle the alarm event.
function ensureAlarm() {
  chrome.alarms.get("keepAlive", (alarm) => {
    if (!alarm) {
      chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 }); // every ~24s
    }
  });
}

// Ensure alarm is set on all lifecycle events
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.runtime.onInstalled.addListener(ensureAlarm);
ensureAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    ensureAlarm();
  }
});

// ─── Data Migration to IndexedDB ─────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  ensureAlarm();
  try {
    const existing = await chrome.storage.local.get(['savemockQuestions']);
    if (existing.savemockQuestions) {
      console.log('Migrating data to IndexedDB...');
      const dbObj = existing.savemockQuestions;
      for (const subject of Object.keys(dbObj)) {
        await idbSet(`savemock_${subject}`, dbObj[subject]);
      }
      await chrome.storage.local.remove(['savemockQuestions']);
      console.log('Migration complete. Removed from local storage.');
    }
  } catch (e) {
    console.error('Migration failed:', e);
  }
});

// ─── Port-based Keep-Alive ─────────────────────────────────────────────────────
// Dashboard and content scripts connect on a named port.
// When they disconnect the SW will stay alive due to the alarm above.
const ports = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "keepAlive") return;
  ports.add(port);
  
  port.onDisconnect.addListener(() => {
    ports.delete(port);
  });
  
  port.onMessage.addListener((msg) => {
    // Respond to heartbeat pings so the other side knows the SW is alive
    // This bidirectional communication resets the 5-minute idle timer for the port.
    if (msg.type === "keepAlive" || msg.type === "ping") {
      try { 
        port.postMessage({ type: "ack", time: Date.now() }); 
      } catch (_) { }
    }
  });
});

// ─── Handle messages from content/dashboard scripts ───────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ping") {
    sendResponse({ alive: true, time: Date.now() });
    return false;
  }

  if (msg.type === "FETCH_IMAGE") {
    (async () => {
      try {
        const resp = await fetch(msg.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buffer = await resp.arrayBuffer();
        const contentType = resp.headers.get('content-type') || 'image/png';

        // ⚡ Fast base64 encoding: process in 8KB chunks to avoid
        // blocking the service worker with a single massive string concat.
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const b64 = btoa(binary);
        sendResponse({ base64: `data:${contentType};base64,${b64}` });
      } catch (err) {
        console.error("Background image fetch failed:", err);
        sendResponse({ error: err.message });
      }
    })();
    return true; // Keep channel open
  }

  if (msg.type === "SAVE_TO_SUPABASE") {
    (async () => {
      try {
        const sub = (msg.question.subject || "").toLowerCase();
        let tableName = "math"; // default
        if (sub.includes("reasoning")) tableName = "reasoning";
        else if (sub.includes("english")) tableName = "english";
        else if (sub.includes("gk") || sub.includes("gs")) tableName = "gk";
        else if (sub.includes("math") || sub.includes("quant")) tableName = "math";

        const { error } = await supabaseClient
          .from(tableName)
          .upsert([msg.question], { onConflict: 'fingerprint' });
        
        if (error) throw error;
        sendResponse({ success: true });
      } catch (err) {
        console.error("[Supabase Direct Save Error]", err);
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === "SAVE_QUESTION_LOCAL") {
    (async () => {
      try {
        const { subject, actualNew } = msg;
        const subjectArray = (await idbGet(`savemock_${subject}`)) || [];
        const newArray = [...actualNew, ...subjectArray];
        await idbSet(`savemock_${subject}`, newArray);
        chrome.runtime.sendMessage({ type: "NEW_QUESTION_SAVED", subject, actualNew });
        sendResponse({ success: true });
      } catch (err) {
        console.error("Local save failed:", err);
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});
