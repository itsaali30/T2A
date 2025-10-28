const express = require('express');
const gtts = require('node-gtts');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Language map
const LANGUAGE_MAP = {
  english: 'en', hindi: 'hi', arabic: 'ar', telugu: 'te',
  bengali: 'bn', urdu: 'ur', spanish: 'es',
  en: 'en', hi: 'hi', ar: 'ar', te: 'te', bn: 'bn', ur: 'ur', es: 'es'
};

// Display names
const LANGUAGE_NAMES = {
  en: 'English', hi: 'Hindi', ar: 'Arabic', te: 'Telugu',
  bn: 'Bengali', ur: 'Urdu', es: 'Spanish'
};

// Supported formats
const SUPPORTED_FORMATS = ['mp3', 'wav'];

// Temp directory
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

let fileIndex = 1;

/* ---------------------------- Helper Functions ---------------------------- */

// ✅ Use ffmpeg.ffprobe to get duration for any audio file
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

// Convert MP3 → WAV
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

// Generate TTS audio
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

// Validate text
function validateText(text) {
  if (!text || typeof text !== 'string' || !text.trim()) return 'Invalid text';
  if (text.length > 5000) return 'Text too long (max 5000 chars)';
  return null;
}

/* ------------------------------ API Endpoints ----------------------------- */

// POST /api/tts → return audio file directly
app.post('/api/tts', async (req, res) => {
  const tempFiles = [];
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
    const filename = `t2a_${fileIndex++}.${format}`;
    const mp3Path = path.join(TEMP_DIR, `${fileId}.mp3`);
    tempFiles.push(mp3Path);

    await generateSpeech(text, langCode, mp3Path);
    let outputPath = mp3Path;
    let mimeType = 'audio/mpeg';

    if (format === 'wav') {
      const wavPath = path.join(TEMP_DIR, `${fileId}.wav`);
      await convertToWav(mp3Path, wavPath);
      outputPath = wavPath;
      mimeType = 'audio/wav';
      tempFiles.push(wavPath);
    }

    // ✅ Duration via ffprobe
    const duration = await getAudioDuration(outputPath);
    const durationFormatted = `${Math.round(duration)}s`;
    const stats = fs.statSync(outputPath);

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Audio-Duration': duration,
      'X-Audio-Duration-Formatted': durationFormatted,
      'X-File-Size': stats.size
    });

    fs.createReadStream(outputPath).pipe(res);

    res.on('finish', () => {
      setTimeout(() => tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f)), 1000);
    });
  } catch (err) {
    console.error(err);
    tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// POST /api/tts/complete → return JSON + base64 + duration
app.post('/api/tts/complete', async (req, res) => {
  const tempFiles = [];
  try {
    const { text, lang, file } = req.body;
    const textError = validateText(text);
    if (textError) return res.status(400).json({ success: false, error: textError });

    const language = (lang || 'english').toLowerCase();
    const format = (file || 'mp3').toLowerCase();
    const langCode = LANGUAGE_MAP[language];
    const langName = LANGUAGE_NAMES[langCode];
    const fileId = uuidv4();
    const filename = `t2a_${fileIndex++}.${format}`;
    const mp3Path = path.join(TEMP_DIR, `${fileId}.mp3`);
    tempFiles.push(mp3Path);

    await generateSpeech(text, langCode, mp3Path);
    let outputPath = mp3Path;
    let mimeType = 'audio/mpeg';
    if (format === 'wav') {
      const wavPath = path.join(TEMP_DIR, `${fileId}.wav`);
      await convertToWav(mp3Path, wavPath);
      outputPath = wavPath;
      mimeType = 'audio/wav';
      tempFiles.push(wavPath);
    }

    // ✅ Get duration using ffprobe
    const duration = await getAudioDuration(outputPath);
    const durationFormatted = `${Math.round(duration)}s`;
    const stats = fs.statSync(outputPath);
    const base64Audio = fs.readFileSync(outputPath).toString('base64');

    res.json({
      success: true,
      file_info: {
        filename,
        duration: parseFloat(duration.toFixed(2)),
        duration_formatted: durationFormatted,
        format,
        size: stats.size,
        language: langCode,
        language_name: langName,
        text_length: text.length,
        timestamp: new Date().toISOString()
      },
      audio: {
        data: base64Audio,
        content_type: mimeType
      }
    });

    setTimeout(() => tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f)), 1000);
  } catch (err) {
    console.error(err);
    tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ /api/duration/:filename — get duration for mp3 or wav
app.get('/api/duration/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(TEMP_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found', filename });
    }

    // Get duration via ffprobe
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('Error reading duration:', err);
        return res.status(500).json({ success: false, error: 'Could not read duration' });
      }

      const duration = metadata?.format?.duration || 0;
      res.json({
        success: true,
        filename,
        duration_seconds: parseFloat(duration.toFixed(2)),
        duration_formatted: `${Math.floor(duration)}s`,
        file_path: filePath
      });
    });
  } catch (error) {
    console.error('Error in /api/duration:', error);
    res.status(500).json({ success: false, error: 'Internal server error', message: error.message });
  }
});

// GET /api/tts/languages
app.get('/api/tts/languages', (req, res) => {
  const langs = {};
  for (const [key, code] of Object.entries(LANGUAGE_MAP)) {
    if (key.length > 2) langs[key] = { code, name: LANGUAGE_NAMES[code] || key };
  }
  res.json({ success: true, supported_languages: langs });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/* ------------------------------ Server Start ------------------------------ */
app.listen(PORT, () => {
  console.log(`🚀 TTS API running on http://localhost:${PORT}`);
  console.log(`🎧 Duration check: GET /api/duration/:filename`);
});
