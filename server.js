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
