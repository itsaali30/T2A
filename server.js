const express = require('express');
const gtts = require('node-gtts');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// Middleware to parse JSON
app.use(express.json({ limit: '10mb' }));

// Language mapping
const LANGUAGE_MAP = {
    'hindi': 'hi',
    'english': 'en',
    'hi': 'hi',
    'en': 'en'
};

// Supported formats
const SUPPORTED_FORMATS = ['mp3', 'wav'];

// Ensure temp directory exists
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// Counter for generating sequential filenames
let fileIndex = 1;

// Helper function to get audio duration
function getAudioDuration(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                reject(err);
            } else {
                const duration = metadata.format.duration;
                resolve(duration);
            }
        });
    });
}

// Helper function to convert MP3 to WAV
function convertToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('wav')
            .audioCodec('pcm_s16le')
            .audioChannels(2)
            .audioFrequency(44100)
            .on('end', () => {
                console.log('WAV conversion complete');
                resolve();
            })
            .on('error', (err) => {
                console.error('WAV conversion error:', err);
                reject(err);
            })
            .save(outputPath);
    });
}

// Helper function to generate speech
function generateSpeech(text, langCode, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            gtts(langCode).save(outputPath, text, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

// POST /api/tts - Text to Speech endpoint
app.post('/api/tts', async (req, res) => {
    const tempFiles = [];
    
    try {
        const { text, lang, file } = req.body;

        // Validation
        if (!text || text.trim() === '') {
            return res.status(400).json({ 
                error: 'Text field is required and cannot be empty' 
            });
        }

        const language = (lang || 'english').toLowerCase();
        const format = (file || 'mp3').toLowerCase();

        if (!LANGUAGE_MAP[language]) {
            return res.status(400).json({
                error: `Unsupported language: ${language}`,
                supported_languages: Object.keys(LANGUAGE_MAP)
            });
        }

        if (!SUPPORTED_FORMATS.includes(format)) {
            return res.status(400).json({
                error: `Unsupported file format: ${format}`,
                supported_formats: SUPPORTED_FORMATS
            });
        }

        const langCode = LANGUAGE_MAP[language];
        const fileId = uuidv4();
        const currentIndex = fileIndex++;
        const filename = `t2a_${currentIndex}.${format}`;

        console.log(`Processing text (${text.length} characters)...`);

        // Generate MP3
        const mp3Path = path.join(TEMP_DIR, `${fileId}.mp3`);
        tempFiles.push(mp3Path);

        await generateSpeech(text, langCode, mp3Path);
        console.log('MP3 generated successfully');

        let outputPath = mp3Path;
        let mimeType = 'audio/mpeg';

        // Convert to WAV if requested
        if (format === 'wav') {
            const wavPath = path.join(TEMP_DIR, `${fileId}.wav`);
            tempFiles.push(wavPath);
            
            await convertToWav(mp3Path, wavPath);
            outputPath = wavPath;
            mimeType = 'audio/wav';
        }

        // Check if file exists
        if (!fs.existsSync(outputPath)) {
            throw new Error('Output file was not created');
        }

        // Get audio duration
        const duration = await getAudioDuration(outputPath);
        console.log(`Audio duration: ${duration} seconds`);

        console.log(`Sending file: ${outputPath}`);

        // Set response headers
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Audio-Duration', duration);
        res.setHeader('X-Filename', filename);
        res.setHeader('X-File-Index', currentIndex);

        // Send file
        const fileStream = fs.createReadStream(outputPath);
        
        fileStream.on('error', (err) => {
            console.error('File stream error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Error reading file' });
            }
        });

        fileStream.pipe(res);

        // Clean up temp files after sending
        res.on('finish', () => {
            setTimeout(() => {
                tempFiles.forEach(file => {
                    try {
                        if (fs.existsSync(file)) {
                            fs.unlinkSync(file);
                            console.log(`Deleted temp file: ${file}`);
                        }
                    } catch (err) {
                        console.error(`Error deleting ${file}:`, err);
                    }
                });
            }, 1000);
        });

    } catch (error) {
        console.error('Error:', error);
        
        // Clean up temp files on error
        tempFiles.forEach(file => {
            try {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            } catch (err) {
                console.error(`Error cleaning up ${file}:`, err);
            }
        });
        
        if (!res.headersSent) {
            res.status(500).json({ 
                error: error.message || 'Internal server error',
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }
});

// Alternative endpoint that returns JSON with file info and base64 encoded audio
app.post('/api/tts/json', async (req, res) => {
    const tempFiles = [];
    
    try {
        const { text, lang, file } = req.body;

        // Validation
        if (!text || text.trim() === '') {
            return res.status(400).json({ 
                error: 'Text field is required and cannot be empty' 
            });
        }

        const language = (lang || 'english').toLowerCase();
        const format = (file || 'mp3').toLowerCase();

        if (!LANGUAGE_MAP[language]) {
            return res.status(400).json({
                error: `Unsupported language: ${language}`,
                supported_languages: Object.keys(LANGUAGE_MAP)
            });
        }

        if (!SUPPORTED_FORMATS.includes(format)) {
            return res.status(400).json({
                error: `Unsupported file format: ${format}`,
                supported_formats: SUPPORTED_FORMATS
            });
        }

        const langCode = LANGUAGE_MAP[language];
        const fileId = uuidv4();
        const currentIndex = fileIndex++;
        const filename = `t2a_${currentIndex}.${format}`;

        console.log(`Processing text (${text.length} characters)...`);

        // Generate MP3
        const mp3Path = path.join(TEMP_DIR, `${fileId}.mp3`);
        tempFiles.push(mp3Path);

        await generateSpeech(text, langCode, mp3Path);
        console.log('MP3 generated successfully');

        let outputPath = mp3Path;
        let mimeType = 'audio/mpeg';

        // Convert to WAV if requested
        if (format === 'wav') {
            const wavPath = path.join(TEMP_DIR, `${fileId}.wav`);
            tempFiles.push(wavPath);
            
            await convertToWav(mp3Path, wavPath);
            outputPath = wavPath;
            mimeType = 'audio/wav';
        }

        // Check if file exists
        if (!fs.existsSync(outputPath)) {
            throw new Error('Output file was not created');
        }

        // Get audio duration
        const duration = await getAudioDuration(outputPath);
        console.log(`Audio duration: ${duration} seconds`);

        // Read file as base64
        const audioBuffer = fs.readFileSync(outputPath);
        const base64Audio = audioBuffer.toString('base64');

        // Send JSON response
        res.json({
            success: true,
            filename: filename,
            duration: duration,
            format: format,
            size: audioBuffer.length,
            audio: `data:${mimeType};base64,${base64Audio}`,
            download_url: `/api/tts/download/${currentIndex}`
        });

        // Clean up temp files
        setTimeout(() => {
            tempFiles.forEach(file => {
                try {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                        console.log(`Deleted temp file: ${file}`);
                    }
                } catch (err) {
                    console.error(`Error deleting ${file}:`, err);
                }
            });
        }, 1000);

    } catch (error) {
        console.error('Error:', error);
        
        // Clean up temp files on error
        tempFiles.forEach(file => {
            try {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            } catch (err) {
                console.error(`Error cleaning up ${file}:`, err);
            }
        });
        
        res.status(500).json({ 
            success: false,
            error: error.message || 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// GET /api/tts/info - API information
app.get('/api/tts/info', (req, res) => {
    res.json({
        endpoint: '/api/tts',
        method: 'POST',
        supported_languages: {
            'hindi': 'hi',
            'english': 'en'
        },
        supported_formats: SUPPORTED_FORMATS,
        request_format: {
            text: 'string (required) - Text to convert to speech (supports long text)',
            lang: 'string (required) - Language: hindi/english/hi/en',
            file: 'string (required) - Output format: mp3/wav'
        },
        example_request: {
            text: 'Hello, how are you? This is a test of the text to speech system.',
            lang: 'english',
            file: 'mp3'
        },
        response_headers: {
            'X-Audio-Duration': 'Duration of audio in seconds',
            'X-Filename': 'Filename in format t2a_[index]',
            'X-File-Index': 'Sequential file index'
        },
        notes: [
            'Supports long text (no length limit)',
            'Automatically handles text chunking',
            'Returns complete audio file',
            'Filename format: t2a_[sequential_index]'
        ]
    });
});

// GET /health - Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'Text-to-Speech API',
        temp_dir: TEMP_DIR,
        temp_files: fs.readdirSync(TEMP_DIR).length,
        current_file_index: fileIndex
    });
});

// Clean up old temp files periodically
setInterval(() => {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        
        files.forEach(file => {
            const filePath = path.join(TEMP_DIR, file);
            const stats = fs.statSync(filePath);
            const age = now - stats.mtimeMs;
            
            // Delete files older than 1 hour
            if (age > 3600000) {
                fs.unlinkSync(filePath);
                console.log(`Cleaned up old file: ${file}`);
            }
        });
    } catch (err) {
        console.error('Error cleaning up temp files:', err);
    }
}, 600000); // Run every 10 minutes

// Start server
app.listen(PORT, () => {
    console.log(`Text-to-Speech API running on http://localhost:${PORT}`);
    console.log(`API endpoint: POST http://localhost:${PORT}/api/tts`);
    console.log(`JSON endpoint: POST http://localhost:${PORT}/api/tts/json`);
    console.log(`API info: GET http://localhost:${PORT}/api/tts/info`);
    console.log(`Temp directory: ${TEMP_DIR}`);
});

// Clean up temp directory on exit
process.on('exit', () => {
    try {
        if (fs.existsSync(TEMP_DIR)) {
            const files = fs.readdirSync(TEMP_DIR);
            files.forEach(file => {
                fs.unlinkSync(path.join(TEMP_DIR, file));
            });
        }
    } catch (err) {
        console.error('Error cleaning up on exit:', err);
    }
});
