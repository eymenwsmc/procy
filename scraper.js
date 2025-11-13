require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { searchSubtitles, downloadSubtitle } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - Vercel için ZORUNLU
app.set('trust proxy', true);

// Enable CORS
app.use(cors());

// Rate limiting - Simplified for Vercel
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    // Vercel için: X-Forwarded-For header'ı kullan
    keyGenerator: (req) => {
        return req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.ip || 
               'unknown';
    },
    skip: (req) => {
        return req.path === '/' || req.path === '/manifest.json' || req.path === '/cache/stats';
    }
});

app.use(limiter);

// Cache (15 minutes TTL)
const cache = new NodeCache({ stdTTL: 15 * 60, checkperiod: 120 });

// Logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

/**
 * Health check endpoint
 */
app.get('/', (req, res) => {
    res.json({
        name: 'Turkcealtyazi Subtitle Backend',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            subtitles: '/subtitles/:type/:imdbId.json',
            download: '/download/:idid-:altid.zip'
        }
    });
});

/**
 * Manifest endpoint (for Stremio compatibility)
 */
app.get('/manifest.json', (req, res) => {
    res.json({
        id: 'org.dataflix.turkcealtyazi',
        version: '1.0.0',
        name: 'Turkcealtyazi Backend',
        description: 'Turkish subtitles from turkcealtyazi.org',
        resources: ['subtitles'],
        types: ['movie', 'series'],
        idPrefixes: ['tt']
    });
});

/**
 * Search subtitles endpoint
 * Format: /subtitles/movie/tt1234567.json
 * Format: /subtitles/series/tt1234567:1:5.json (season 1, episode 5)
 */
app.get('/subtitles/:type/:imdbId.json', async (req, res) => {
    try {
        const { type, imdbId } = req.params;
        
        // Parse IMDb ID and season/episode
        const parts = imdbId.split(':');
        const cleanImdbId = parts[0];
        const season = parts[1] ? parseInt(parts[1]) : null;
        const episode = parts[2] ? parseInt(parts[2]) : null;
        
        const cacheKey = `${type}-${imdbId}`;
        
        // Check cache
        if (cache.has(cacheKey)) {
            console.log(`[Cache] Hit: ${cacheKey}`);
            return res.json(cache.get(cacheKey));
        }
        
        // Search subtitles
        console.log(`[API] Searching: ${type} ${cleanImdbId} S${season}E${episode}`);
        
        try {
            const subtitles = await searchSubtitles(cleanImdbId, type, season, episode);
            
            const response = {
                subtitles: subtitles,
                cacheMaxAge: 4 * 60 * 60, // 4 hours
                staleRevalidate: 4 * 60 * 60,
                staleError: 7 * 24 * 60 * 60
            };
            
            // Cache the response
            if (subtitles.length > 0) {
                cache.set(cacheKey, response, 15 * 60); // 15 minutes
            } else {
                cache.set(cacheKey, response, 2 * 60); // 2 minutes for empty results
            }
            
            res.json(response);
        } catch (searchError) {
            console.error(`[API] Search error: ${searchError.message}`);
            
            // Return empty but valid response
            const fallbackResponse = {
                subtitles: [],
                error: 'Service temporarily unavailable - blocked by upstream',
                message: 'Turkcealtyazi.org may be blocking requests. Try again later.',
                cacheMaxAge: 60, // 1 minute
                staleRevalidate: 60,
                staleError: 60
            };
            
            // Cache empty response briefly
            cache.set(cacheKey, fallbackResponse, 60); // 1 minute
            
            res.json(fallbackResponse);
        }
        
    } catch (error) {
        console.error(`[API] Error: ${error.message}`);
        res.status(500).json({
            subtitles: [],
            error: 'Failed to fetch subtitles'
        });
    }
});

/**
 * Download subtitle endpoint (returns SRT text)
 * Format: /download/12345-67890.srt
 */
app.get('/download/:idid-:altid.srt', async (req, res) => {
    try {
        const { idid, altid } = req.params;
        
        console.log(`[API] 📥 Downloading: ${idid}-${altid}`);
        
        const subtitleText = await downloadSubtitle(idid, altid);
        
        if (!subtitleText) {
            console.log(`[API] ❌ Subtitle not found or empty`);
            return res.status(404).send('Subtitle not found');
        }
        
        console.log(`[API] ✅ Subtitle ready - Length: ${subtitleText.length} chars`);
        console.log(`[API] 📝 First 200 chars: ${subtitleText.substring(0, 200)}`);
        console.log(`[API] 🔤 Contains Turkish chars: ${/[çğıöşüÇĞİÖŞÜ]/.test(subtitleText)}`);
        console.log(`[API] ⚠️ Contains broken chars: ${/[ÄÃÅ][°±¼§¶\u009f\u009e\u0087\u009c\u0096]/.test(subtitleText)}`);
        
        res.set({
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=86400', // 24 hours
            'Access-Control-Allow-Origin': '*'
        });
        
        res.send(subtitleText);
        
    } catch (error) {
        console.error(`[API] ❌ Download error: ${error.message}`);
        res.status(500).send('Failed to download subtitle');
    }
});

/**
 * Preview subtitle content (for debugging)
 * Format: /preview/12345-67890
 */
app.get('/preview/:idid-:altid', async (req, res) => {
    try {
        const { idid, altid } = req.params;
        
        console.log(`[API] 👀 Previewing: ${idid}-${altid}`);
        
        const subtitleText = await downloadSubtitle(idid, altid);
        
        if (!subtitleText) {
            return res.status(404).json({ error: 'Subtitle not found' });
        }
        
        const lines = subtitleText.split('\n');
        
        res.json({
            success: true,
            stats: {
                totalLength: subtitleText.length,
                totalLines: lines.length,
                hasTurkishChars: /[çğıöşüÇĞİÖŞÜ]/.test(subtitleText),
                encoding: 'UTF-8'
            },
            preview: {
                first50Lines: lines.slice(0, 50).join('\n'),
                last10Lines: lines.slice(-10).join('\n')
            }
        });
        
    } catch (error) {
        console.error(`[API] Preview error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Cache stats (for debugging)
 */
app.get('/cache/stats', (req, res) => {
    res.json({
        keys: cache.keys().length,
        stats: cache.getStats()
    });
});

/**
 * Clear cache
 */
app.get('/cache/clear', (req, res) => {
    cache.flushAll();
    res.json({ message: 'Cache cleared' });
});

/**
 * Test Turkish character encoding
 */
app.get('/test/encoding', (req, res) => {
    const testText = `
Test Türkçe Karakterler:
- Normal: çğıöşüÇĞİÖŞÜ
- Bozuk: Ã§ÄŸÄ±Ã¶Å\u009fÃ¼Ã\u0087Ä\u009eÄ°Ã\u0096Å\u009eÃ\u009c
- Kelimeler: GÄ°RÄ°Å\u009f, KonuÅ\u009fabilir, MÃ¼rettebat, BÃ¶yle
`;
    
    res.set({
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    });
    
    res.send(testText);
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(`[Error] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
});

// ÖNCE (sadece localhost):
app.listen(PORT, () => {
    console.log(`...`);
});

// SONRA (tüm network):
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════╗
║  Turkcealtyazi Subtitle Backend           ║
║  Port: ${PORT}                            ║
║  Local: http://localhost:${PORT}          ║
║  Network: http://192.168.1.16:${PORT}     ║
║  Status: Running ✓                         ║
╚════════════════════════════════════════════╝
    `);
});
