// python.helper.js
require('dotenv').config();
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const pythonHelper = {};

pythonHelper.index_map = {
  "candidate_index" : "1",
  "freelancer_index" : "2",
  "test_index" : "3",
}

const BASE_URL = process.env.BASE_URL;
const ENDPOINT = process.env.SINGLE_FILE_UPLOAD_API_ENDPOINT;
const API_KEY = process.env.X_API_KEY;

if (!BASE_URL || !ENDPOINT || !API_KEY) {
  console.warn('[python.helper] Warning: BASE_URL, SINGLE_FILE_UPLOAD_API_ENDPOINT or X_API_KEY not set in env.');
}

/**
 * Uploads a single file to the Python server multipart endpoint.
 *
 * @param {Object} opts
 * @param {string} opts.filePath - local path to file (required)
 * @param {boolean} [opts.isCandidate] - isCandidate form field (optional)
 * @param {Object} [opts.extraFields] - other form fields to include (optional)
 * @param {number} [opts.timeoutMs] - axios timeout in ms (optional)
 * @returns {Object} - parsed JSON response from remote server
 *
 * Example:
 * await uploadSingleFile({ filePath: './ARYAN_BANWALA_RESUME.pdf', keyword: 'string', isCandidate: true });
 */
pythonHelper.uploadSingleFile = async function ({
  filePath,
  index_id,
  keyword = "string",
  extraFields = {},
  timeoutMs = 60000,
} = {}) {
  if (!filePath) throw new Error('filePath is required');

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const url = `${BASE_URL.replace(/\/+$/, '')}${ENDPOINT.startsWith('/') ? ENDPOINT : '/' + ENDPOINT}`;

  const form = new FormData();
  // add file
  form.append('file', fs.createReadStream(resolved), {
    filename: path.basename(resolved),
    contentType: mimeTypeFromFilename(resolved) || 'application/octet-stream',
  });

  // standard fields (based on example curl)
  if (typeof keyword !== 'undefined') form.append('keyword', String(keyword));
  if (typeof index_id !== 'undefined') form.append('index_id', String(index_id));

  // add any other fields
  for (const [k, v] of Object.entries(extraFields || {})) {
    if (typeof v !== 'undefined' && v !== null) form.append(k, String(v));
  }

  const headers = {
    ...form.getHeaders(),
    'accept': 'application/json',
    'x-api-key': API_KEY,
  };

  try {
    const resp = await axios.post(url, form, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: timeoutMs,
      validateStatus: status => status < 500, // allow 4xx to reach response for better errors
    });
    if ( resp.status == 200 ){
        await fsp.unlink(resolved);
        console.log(`File deleted: ${filePath}`);
    }
    // Return the body (attempt to parse JSON)
    return {
      status: resp.status,
      headers: resp.headers,
      data: resp.data,
    };
  } catch (err) {
    // Axios error formatting
    if (err.response) {
      // server responded with non-2xx
      throw new Error(`Upload failed: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
    } else if (err.request) {
      throw new Error(`No response from server when calling ${url}: ${err.message}`);
    } else {
      throw new Error(`Error preparing request: ${err.message}`);
    }
  }
}

/**
 * Very small helper to guess mime-type from filename extension.
 * For production you can use the 'mime' package instead.
 */
function mimeTypeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.doc': return 'application/msword';
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.txt': return 'text/plain';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return null;
  }
}

module.exports = pythonHelper;