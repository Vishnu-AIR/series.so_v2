const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const whatsAppHelper = {};

whatsAppHelper.detectMessagemediaType = function(message) {
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
        return { isMedia: true, mediaType: typeMap[foundType] };
    }

    // If no media type matched → treat as text
    const textContent =
        message.message.conversation ||
        message.message.extendedTextMessage?.text ||
        '';

    if (textContent.trim()) {
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

module.exports = whatsAppHelper;