# WHATSAPP-BOT-SESSION-ID
A simple and reliable web-based tool for generating WhatsApp creds.json session files for your WhatsApp bot.


### Step 1: Create the Project Folder
Open your terminal (Command Prompt or PowerShell) on your laptop and run these commands:
```bash
mkdir wa-pairing
cd wa-pairing
npm init -y
npm install @whiskeysockets/baileys express pino
```

### Step 2: Create the Backend (`server.js`)
Create a file named `server.js` in your main folder and paste this exact code:

```javascript
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Helper to check if pairing was successful (creds.json exists)
function isPaired(authDir) {
    return fs.existsSync(path.join(authDir, 'creds.json'));
}

async function connectAndSend(authDir, cleanNumber, isAlreadyPaired) {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }) // Keep terminal clean, we use custom logs
    });

    sock.ev.on('creds.update', () => {
        console.log(`🔑 [EVENT] Credentials updated! (creds.json generated/updated)`);
        saveCreds();
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        console.log(`📡 [EVENT] Connection state changed to: "${connection}"`);

        if (connection === 'open') {
            console.log(`✅ [SUCCESS] WhatsApp device is now LINKED and connected!`);
            
            const credsPath = path.join(authDir, 'creds.json');
            if (fs.existsSync(credsPath)) {
                const userJid = cleanNumber + '@s.whatsapp.net';

                                try {
                    console.log(`📤 [SENDING] Sending success notification to WhatsApp...`);
                    await sock.sendMessage(userJid, { 
                        text: "✅ *Successfully Connected!*\n\nHere is your session ID (creds.json) file. Keep it safe!" 
                    });
                    console.log(`✅ [INFO] Text message sent successfully.`);

                    console.log(`📎 [SENDING] Sending creds.json file to WhatsApp...`);
                    await sock.sendMessage(userJid, {
                        document: fs.readFileSync(credsPath),
                        fileName: "creds.json",
                        mimetype: "application/json",
                        caption: "Your Session ID (creds.json)"
                    });
                    console.log(`✅ [INFO] creds.json file sent successfully!`);

                } catch (sendError) {
                    console.error(`❌ [ERROR] Failed to send message to WhatsApp:`, sendError.message);
                }

                // 🌟 THE FIX: Wait 12 seconds to ensure WhatsApp fully syncs and delivers the message
                console.log(`⏳ [WAIT] Waiting 12 seconds to ensure WhatsApp fully delivers the message to your phone...`);
                await new Promise(resolve => setTimeout(resolve, 12000)); // 12 seconds

                console.log(`🗑️ [CLEANUP] Deleting local creds.json and auth folder from laptop...`);
                try {
                    fs.rmSync(authDir, { recursive: true, force: true });
                    console.log(`✅ [INFO] Local auth folder deleted securely.`);
                } catch (deleteError) {
                    console.error(`❌ [ERROR] Failed to delete local files:`, deleteError.message);
                }

                console.log(`🛑 [END] Closing socket.\n`);
                sock.end(new Error('Session generation and delivery complete'));
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ [EVENT] Connection closed. Reason:`, lastDisconnect?.error?.message, `| Code: ${statusCode}`);
            
            // THE FIX: If it's a restart required (code 515 or 428) AND we have creds.json, RECONNECT!
            if ((statusCode === DisconnectReason.restartRequired || statusCode === 515 || statusCode === 428) && isPaired(authDir)) {
                console.log(`🔄 [AUTO-RETRY] Stream errored, but pairing was successful! Reconnecting to send file...`);
                setTimeout(() => {
                    connectAndSend(authDir, cleanNumber, true); // true = skip pairing code, just log in
                }, 2000);
            } else if (statusCode === DisconnectReason.loggedOut) {
                console.log(`🗑️ [CLEANUP] Device logged out. Deleting auth folder.`);
                fs.rmSync(authDir, { recursive: true, force: true });
            } else {
                console.log(`❌ [FATAL] Connection closed unexpectedly. Delete the auth_info folder and try again.`);
            }
        }
    });

    // Only request pairing code if this is the first time connecting
    if (!isAlreadyPaired) {
        try {
            console.log(`⏳ [WAIT] Waiting 1.5 seconds for socket to stabilize...`);
            await new Promise(resolve => setTimeout(resolve, 1500));

            console.log(`🔢 [REQUEST] Asking WhatsApp for pairing code for ${cleanNumber}...`);
            const code = await sock.requestPairingCode(cleanNumber);
            const formattedCode = code.match(/.{1,4}/g).join('-');
            
            console.log(`🎉 [SUCCESS] Pairing code generated: ${formattedCode}`);
            console.log(`👀 [WAITING] Waiting for user to enter code on their phone...\n`);
            
            return { success: true, code: formattedCode };
        } catch (err) {
            console.error(`❌ [FATAL ERROR] Failed to generate pairing code:`);
            console.error(err);
            throw err;
        }
    }
}

app.post('/get-pairing-code', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });

    const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');

    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
        return res.status(400).json({ error: 'Invalid phone number length.' });
    }

    const sessionId = `session_${Date.now()}`;
    const authDir = path.join(__dirname, 'auth_info', sessionId);
    
    console.log(`\n🚀 [1/6] Initializing new session: ${sessionId}`);
    console.log(`📁 [2/6] Creating auth directory at: ${authDir}`);
    
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }

    try {
        const result = await connectAndSend(authDir, cleanNumber, false);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to generate code.' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🌐 Server running locally at http://localhost:${PORT}`);
    console.log(`👉 Open that URL in your browser to start.\n`);
});
```

### Step 3: Create the Frontend (`public/index.html`)
1. Inside your main `wa-pairing` folder, create a new folder named exactly `public`.
2. Inside the `public` folder, create a file named `index.html`.
3. Paste this code inside `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp Pairing Code</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 600px; margin: 50px auto; text-align: center; padding: 20px; background: #f4f4f9; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
        h2 { color: #075E54; }
        p { color: #555; }
        input { padding: 12px; width: 80%; font-size: 16px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 5px; text-align: center; }
        button { padding: 12px 25px; font-size: 16px; cursor: pointer; background: #25D366; color: white; border: none; border-radius: 5px; font-weight: bold; transition: 0.3s; }
        button:hover { background: #128C7E; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        #result { margin-top: 25px; font-size: 32px; font-weight: bold; color: #075E54; letter-spacing: 3px; min-height: 40px; }
        .info { color: #666; font-size: 14px; margin-top: 20px; background: #fff; padding: 15px; border-radius: 5px; text-align: left; display: inline-block; max-width: 90%; }
        .spinner { border: 4px solid rgba(0, 0, 0, 0.1); width: 36px; height: 36px; border-radius: 50%; border-left-color: #075E54; animation: spin 1s linear infinite; margin: 0 auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <h2>WhatsApp Pairing Code Generator</h2>
    <p>Enter your phone number with country code (e.g., 921234567890)</p>

    <input type="text" id="phone" placeholder="921234567890">
    <br>
    <button id="submitBtn" onclick="getCode()">Get Pairing Code</button>

    <div id="loading" style="display:none; margin-top:20px;"><div class="spinner"></div></div>
    <div id="result"></div>
    <div id="status" class="info" style="display:none;"></div>

    <script>
        async function getCode() {
            const phone = document.getElementById('phone').value;
            const resultDiv = document.getElementById('result');
            const statusDiv = document.getElementById('status');
            const loadingDiv = document.getElementById('loading');
            const btn = document.getElementById('submitBtn');

            if (!phone) {
                alert('Please enter a phone number');
                return;
            }

            btn.disabled = true;
            loadingDiv.style.display = 'block';
            resultDiv.innerText = '';
            statusDiv.style.display = 'none';

            try {
                const response = await fetch('/get-pairing-code', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone })
                });

                const data = await response.json();
                loadingDiv.style.display = 'none';
                btn.disabled = false;

                if (data.success) {
                    resultDiv.innerText = data.code;
                    statusDiv.style.display = 'inline-block';
                    statusDiv.innerHTML = `
                        <p><b>Instructions to connect:</b></p>
                        <p>1. Open WhatsApp on your phone.</p>
                        <p>2. Go to <b>Settings / Menu > Linked Devices > Link a device</b>.</p>
                        <p>3. Tap <b>"Link with phone number instead"</b> at the bottom.</p>
                        <p>4. Select your country, enter your number, and type the code above.</p>
                        <p><i>Wait ~10 seconds after entering the code. The creds.json file will be sent to your WhatsApp automatically!</i></p>
                    `;
                } else {
                    resultDiv.innerText = 'Error';
                    statusDiv.style.display = 'inline-block';
                    statusDiv.innerText = data.error || 'Failed to generate code. Check terminal for details.';
                }
            } catch (error) {
                loadingDiv.style.display = 'none';
                resultDiv.innerText = 'Server Error';
                statusDiv.style.display = 'inline-block';
                statusDiv.innerText = 'Could not connect to the server.';
                btn.disabled = false;
            }
        }
    </script>
</body>
</html>
```

### Step 4: Run it on your laptop
Make sure your terminal is inside the main `wa-pairing` folder (where `server.js` is located) and run:
```bash
node server.js
```

1. Open your browser and go to: `http://localhost:3000`
2. Enter `9212334567689` (without the `+` or spaces).
3. Click **Get Pairing Code**.
4. It will show a loading spinner for a moment, and then display the 8-digit code! 
5. Enter that code into your phone's WhatsApp app. Once you connect, the bot will instantly send you the `creds.json` file in your chat.
