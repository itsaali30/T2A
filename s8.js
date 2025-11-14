const express = require('express');
const gtts = require('node-gtts');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 4000;

app.use(express.json({ limit: '10mb' }));

/* ---------------------------- Language Settings ---------------------------- */
const LANGUAGE_MAP = {
  english: 'en', hindi: 'hi', arabic: 'ar', telugu: 'te',
  bengali: 'bn', urdu: 'ur', spanish: 'es',
  en: 'en', hi: 'hi', ar: 'ar', te: 'te', bn: 'bn', ur: 'ur', es: 'es'
};

const LANGUAGE_NAMES = {
  en: 'English', hi: 'Hindi', ar: 'Arabic', te: 'Telugu',
  bn: 'Bengali', ur: 'Urdu', es: 'Spanish'
};

const SUPPORTED_FORMATS = ['mp3', 'wav'];

/* ------------------------------- Directories ------------------------------- */
const TEMP_DIR = path.join(__dirname, 'temp');
const SAVED_DIR = path.join(__dirname, 'saved_audio');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(SAVED_DIR)) fs.mkdirSync(SAVED_DIR, { recursive: true });

let fileIndex = 1;

/* ----------------------------- Helper Functions ---------------------------- */

// ✅ Get duration of any audio file
function getAudioDuration(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.warn('Error reading duration, defaulting to 5s:', err);
        return resolve(5);
      }
      const duration = metadata?.format?.duration || 5;
      resolve(duration);
    });
  });
}

// ✅ Convert MP3 → WAV
function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('wav')
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(22050)
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

// ✅ Generate speech file
function generateSpeech(text, langCode, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const tts = gtts(langCode);
      tts.save(outputPath, text, (err) => {
        if (err) reject(err);
        else resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

// ✅ Validate text input
function validateText(text) {
  if (!text || typeof text !== 'string' || !text.trim()) return 'Invalid text';
  if (text.length > 5000) return 'Text too long (max 5000 chars)';
  return null;
}

/* ------------------------------ API Endpoints ------------------------------ */

// 🔹 POST /api/tts → Generate & save file permanently
app.post('/api/tts', async (req, res) => {
  try {
    const { text, lang, file } = req.body;
    const textError = validateText(text);
    if (textError) return res.status(400).json({ error: textError });

    const language = (lang || 'english').toLowerCase();
    const format = (file || 'mp3').toLowerCase();

    if (!LANGUAGE_MAP[language]) return res.status(400).json({ error: 'Unsupported language' });
    if (!SUPPORTED_FORMATS.includes(format)) return res.status(400).json({ error: 'Unsupported format' });

    const langCode = LANGUAGE_MAP[language];
    const langName = LANGUAGE_NAMES[langCode];
    const fileId = uuidv4();
    const filename = `tts_${fileIndex++}.${format}`;
    const tempMp3 = path.join(TEMP_DIR, `${fileId}.mp3`);

    await generateSpeech(text, langCode, tempMp3);

    let finalPath = tempMp3;
    if (format === 'wav') {
      const wavPath = path.join(TEMP_DIR, `${fileId}.wav`);
      await convertToWav(tempMp3, wavPath);
      finalPath = wavPath;
      fs.unlinkSync(tempMp3);
    }

    const savePath = path.join(SAVED_DIR, filename);
    fs.copyFileSync(finalPath, savePath);
    fs.unlinkSync(finalPath);

    const duration = await getAudioDuration(savePath);
    const stats = fs.statSync(savePath);

    res.json({
      success: true,
      message: 'Audio file generated and saved successfully',
      file_info: {
        filename,
        url: `/audio/${filename}`,
        format,
        duration: parseFloat(duration.toFixed(2)),
        size: stats.size,
        language: langCode,
        language_name: langName,
        text_length: text.length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Error in /api/tts:', err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 GET /audio/:filename → Stream saved audio
app.get('/audio/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(SAVED_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeType = ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
  res.setHeader('Content-Type', mimeType);

  fs.createReadStream(filePath).pipe(res);
});

// 🔹 GET /api/tts/languages → Supported languages
app.get('/api/tts/languages', (req, res) => {
  const langs = {};
  for (const [key, code] of Object.entries(LANGUAGE_MAP)) {
    if (key.length > 2) langs[key] = { code, name: LANGUAGE_NAMES[code] || key };
  }
  res.json({ success: true, supported_languages: langs });
});

// 🔹 GET /api/duration/:filename → Get duration of saved file
app.get('/api/duration/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(SAVED_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const duration = await getAudioDuration(filePath);
    res.json({
      success: true,
      filename,
      duration_seconds: parseFloat(duration.toFixed(2)),
      duration_formatted: `${Math.floor(duration)}s`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/* ------------------------------- Start Server ------------------------------ */
app.listen(PORT, () => {
  console.log(`🚀 TTS API running on http://localhost:${PORT}`);
  console.log(`🎧 Audio saved in: ${SAVED_DIR}`);
  console.log(`📂 Stream saved files via: http://localhost:${PORT}/audio/<filename>`);
});
