const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');


const whatsAppHelper = {};

whatsAppHelper.detectMessagemediaType = function(message,jid = null,fileBuffer = null) {
    if (!message?.message) {
        return { isMedia: false, mediaType: 'unknown' };
    }

    // Mapping of WhatsApp message keys to simple categories
    const typeMap = {
        imageMessage: 'image',
        videoMessage: 'video',
        audioMessage: 'audio',
        stickerMessage: 'sticker',
        documentMessage: 'document',
        contactMessage: 'contact',
        locationMessage: 'location',
    };

    // Find which type exists
    const foundType = Object.keys(typeMap).find(
        key => !!message.message[key]
    );

    if (foundType) {
      const fileType = typeMap[foundType];

      // Here you’d normally decode/download the actual file buffer from WhatsApp message
      // For now, assume you already have the buffer + extension
      const extension =
        message.extension ||
        (fileType === "image"
          ? "jpg"
          : fileType === "video"
          ? "mp4"
          : fileType === "audio"
          ? "mp3"
          : fileType === "document"
          ? "pdf"
          : "bin");
      let savedPath = null;
      if (fileBuffer) {
        savedPath = saveMediaFile(fileBuffer, jid, fileType, extension);
      }

      return { isMedia: true, mediaType: fileType, savedPath };
    }

    // If no media type matched → treat as text
    const textContent =
        message.message.conversation ||
        message.message.extendedTextMessage?.text ||
        '';

    if (textContent.trim()) {
        const linkedinRegex = /(https?:\/\/(www\.)?linkedin\.com\/[^\s]+)/i;
        if (linkedinRegex.test(textContent)) {
          return { isMedia: true, mediaType: 'linkedinUrl' };
        }

        const urlRegex = /(https?:\/\/[^\s]+)/gi;
        if (urlRegex.test(textContent)) {
            return { isMedia: true, mediaType: 'url' };
        }
        return { isMedia: false, mediaType: 'null' };
    }

    return { isMedia: false, mediaType: 'unknown' };
}

whatsAppHelper.extractDocumentText = async function (
  message,
  downloadContentFromMessage,
  charLimit = 5000
) {
  if (!message?.message?.documentMessage) return "";

  const docMsg = message.message.documentMessage;
  let extractedText = "";

  try {
    const stream = await downloadContentFromMessage(docMsg, "document");
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const mime = (docMsg.mimetype || "").toLowerCase();

    if (mime.includes("pdf")) {
      const data = await pdfParse(buffer);
      extractedText = data.text || "";
    } else if (
      mime.includes("wordprocessingml") ||
      mime.includes("officedocument")
    ) {
      const { value } = await mammoth.extractRawText({ buffer });
      extractedText = value || "";
    } else if (mime.includes("text")) {
      extractedText = buffer.toString("utf8");
    }

    if (extractedText.length > charLimit) {
      extractedText = extractedText.slice(0, charLimit) + "... [truncated]";
    }
  } catch (err) {
    console.error("❌ Failed to extract document text:", err.message);
  }

  return extractedText;
};


/**
 * Generate a random file name with extension
 */
function generateRandomFileName(extension = "") {
  const randomStr = crypto.randomBytes(8).toString("hex");
  return extension ? `${randomStr}.${extension}` : randomStr;
}

/**
 * Saves a file buffer into static/whatsapp/{jid}/{file_type}/random_name.ext
 * Returns the relative file path.
 *
 * @param {Buffer} fileBuffer - binary data
 * @param {string} jid - WhatsApp JID
 * @param {string} fileType - e.g. 'image', 'video', 'document'
 * @param {string} extension - file extension without dot
 * @returns {string} relative file path
 */
function saveMediaFile(fileBuffer, jid, fileType, extension) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    console.error("❌ saveMediaFile: fileBuffer invalid", {
      receivedType: typeof fileBuffer,
      isBuffer: Buffer.isBuffer(fileBuffer),
    });
    throw new Error("saveMediaFile: fileBuffer must be a Buffer");
  }
  if (!jid) {
    console.error("❌ saveMediaFile: jid missing");
    throw new Error("saveMediaFile: jid is required");
  }

  const baseDir = path.join("static", "whatsapp", jid, fileType);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
    console.log(`📂 Created directory: ${baseDir}`);
  }

  const filename = generateRandomFileName(extension);
  const filePath = path.join(baseDir, filename);

  try {
    fs.writeFileSync(filePath, fileBuffer);
    console.log(
      `✅ File saved: ${filePath} (${fileBuffer.length} bytes, type=${fileType}, ext=${extension})`
    );
  } catch (err) {
    console.error("❌ Failed to save file:", {
      path: filePath,
      error: err.message,
    });
    throw err;
  }

  return filePath; // relative path
}



module.exports = whatsAppHelper;