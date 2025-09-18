// const {
//     default: makeWASocket,
//     useMultiFileAuthState,
//     DisconnectReason,
//     fetchLatestBaileysVersion
//} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const TypingManager = require('./typing.manager');
const whatsAppHelper = require('../helpers/whatsapp.helpers');

let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage;

async function loadBaileys() {
    const baileys = await import('@whiskeysockets/baileys');
    makeWASocket = baileys.default;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    downloadContentFromMessage = baileys.downloadContentFromMessage;
}
class WhatsAppService {
    /**
     * This service is a dedicated connector to the WhatsApp platform.
     * It handles all the specifics of the Baileys library, including connection,
     * authentication, and message parsing. Its sole responsibility is to act
     * as a bridge between WhatsApp and the application's core logic.
     * @param {OutreachService} outreachService - The core service that handles business logic.
     */
    constructor(outreachService) {
        this.sock = null;
        this.outreachService = outreachService;
    }

    /**
     * Initializes the Baileys client, sets up event listeners, and connects to WhatsApp.
     */
    async initialize() {
        if (!makeWASocket) await loadBaileys();

        const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
        const { version } = await fetchLatestBaileysVersion();

        this.sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
        });

        this.setupEventListeners(saveCreds);
        this.typing = new TypingManager(this.sock, { heartbeatMs: 4000 });
    }

    /**
     * Centralizes all Baileys event listeners for clean initialization.
     */
    setupEventListeners(saveCreds) {
        this.sock.ev.on('connection.update', this.handleConnectionUpdate.bind(this));
        this.sock.ev.on('creds.update', saveCreds);
        this.sock.ev.on('messages.upsert', this.handleMessagesUpsert.bind(this));
    }

    /**
     * Handles connection status changes, including QR code generation and reconnection logic.
     */
    handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('⚡ Scan this QR code with your WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) this.initialize();
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connection established.');
        }
    }

    async streamToBuffer(stream) {
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return Buffer.concat(chunks);
    }

    /**
     * This is the main listener for incoming messages. It parses the raw Baileys message,
     * creates a clean data object, and hands it off to the OutreachService for processing.
     */
    async handleMessagesUpsert(m) {
        const message = m.messages[0];
        // Ignore notifications, status updates, and messages sent by the bot itself.
        if (!message.message || message.key.fromMe) return;
        const jid = message.key.remoteJid;
        const content = message.message.conversation || message.message.extendedTextMessage?.text || '';
        const pushName = message.pushName || 'User';
        
        if (!jid || jid != "226894582694036@lid" ) return;

        console.log(`\n📥 [${new Date().toLocaleTimeString()}] Message from ${pushName} (${jid}): "${content}"`);

        // If it's a document message, download first so we can parse/save it
        let fileBuffer = null;
        if (message.message.documentMessage) {
            try {
            const stream = await downloadContentFromMessage(message.message.documentMessage, 'document');
            fileBuffer = await this.streamToBuffer(stream);
            console.log('✅ Document downloaded, bytes:', fileBuffer.length);
            } catch (err) {
            console.error('❌ downloadContentFromMessage failed:', err);
            }
        }

        const {isMedia,mediaType,savedPath} = whatsAppHelper.detectMessagemediaType(message,jid,fileBuffer);
        let retrievedText = "";
        if ( isMedia && mediaType == "document" ) retrievedText = await whatsAppHelper.extractDocumentText(message,downloadContentFromMessage,3000);
        // more for audio and all
        // Pass the clean message data to the core logic handler.
        await this.markLastMessageRead(message);
        await this.typing.startTyping(jid);
        const replyText = await this.outreachService.handleIncomingMessage({ jid, content, pushName, isMedia, mediaType, retrievedText, filePath: savedPath });
        await this.typing.stopTyping(jid);
        // If the handler returns a reply, send it back to the user.
        if (replyText) {
            await this.sendMessage(jid, replyText);
        }
    }

    /**
     * A simple method to send a text message to a specified JID.
     * @param {string} jid - The recipient's JID.
     * @param {string} text - The message content.
     */
    async sendMessage(jid, text) {
        try {
            await this.sock.sendMessage(jid, { text });
            console.log(`📤 [${new Date().toLocaleTimeString()}] Sent reply to ${jid}: "${text}"`);
        } catch (error) {
            console.error(`❌ Failed to send message to ${jid}:`, error);
        }
    }

    async markLastMessageRead(message) {
        try {
            await this.sock.readMessages([message.key]);
            console.log(`✅ Marked message from ${message.key.remoteJid} as read`);
        } catch (err) {
            console.error("❌ Failed to mark last message as read", err);
        }
    }

}

module.exports = WhatsAppService;