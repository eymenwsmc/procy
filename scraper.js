const axios = require('axios');
const cheerio = require('cheerio');

// Configure axios defaults
axios.defaults.withCredentials = false;
axios.defaults.maxRedirects = 5;
axios.defaults.validateStatus = (status) => status >= 200 && status < 300;

// Multiple realistic user agents for rotation
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
];

// Get random user agent
const getRandomUserAgent = () => {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
};

// Realistic browser headers to avoid 403 - Google'dan gelmiş gibi göster
const getBrowserHeaders = () => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.google.com/',
    'Origin': 'https://www.google.com',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
    'DNT': '1'
});

// Random delay to mimic human behavior
const randomDelay = (min = 500, max = 1500) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
};

// Retry with exponential backoff
async function retryRequest(requestFn, maxRetries = 5, initialDelay = 2000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // Random delay before each request (except first)
            if (i > 0) {
                await randomDelay(1000, 3000);
            }
            return await requestFn();
        } catch (error) {
            const isLastAttempt = i === maxRetries - 1;
            const is403 = error.response && error.response.status === 403;
            const is429 = error.response && error.response.status === 429;
            
            if ((is403 || is429) && !isLastAttempt) {
                const delay = initialDelay * Math.pow(2, i);
                console.log(`[Scraper] ${error.response.status} detected, retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            
            if (!isLastAttempt) {
                // Retry other errors too (network issues, etc.)
                const delay = initialDelay * Math.pow(1.5, i);
                console.log(`[Scraper] Error: ${error.message}, retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
}

/**
 * Step 1: Find main page URL for movie/series
 */
async function findMainPage(imdbId) {
    try {
        const cleanId = imdbId.replace('tt', '');
        const searchUrl = `https://turkcealtyazi.org/things_.php?t=99&term=${cleanId}`;
        
        console.log(`[Scraper] Finding main page: ${searchUrl}`);
        
        const response = await retryRequest(() => 
            axios.get(searchUrl, {
                headers: getBrowserHeaders(),
                timeout: 30000,
                maxRedirects: 5
            })
        );
        
        // Response is JSON array: [{url: "/mov/123/title.html", ...}]
        if (response.data && Array.isArray(response.data) && response.data.length > 0) {
            const mainPageUrl = `https://turkcealtyazi.org${response.data[0].url}`;
            console.log(`[Scraper] Main page found: ${mainPageUrl}`);
            return mainPageUrl;
        }
        
        console.log(`[Scraper] No main page found in response`);
        return null;
    } catch (error) {
        console.error(`[Scraper] Error finding main page: ${error.message}`);
        return null;
    }
}

/**
 * Step 2: Extract subtitle IDs from subtitle page
 */
async function extractSubtitleIds(subtitlePageUrl) {
    try {
        console.log(`[Scraper] Extracting IDs from: ${subtitlePageUrl}`);
        
        const response = await retryRequest(() =>
            axios.get(subtitlePageUrl, {
                headers: getBrowserHeaders(),
                timeout: 30000,
                maxRedirects: 5
            })
        );
        
        const $ = cheerio.load(response.data);
        const subIds = [];
        
        // Find forms with action="/ind"
        $('form[action="/ind"] > div').each((i, section) => {
            const idid = $(section).children('input[name="idid"]').attr('value');
            const altid = $(section).children('input[name="altid"]').attr('value');
            
            if (idid && altid) {
                subIds.push({ idid, altid });
            }
        });
        
        console.log(`[Scraper] Found ${subIds.length} subtitle IDs`);
        return subIds;
        
    } catch (error) {
        console.error(`[Scraper] Error extracting IDs: ${error.message}`);
        return [];
    }
}

/**
 * Main scraper function
 * Searches subtitles by IMDb ID
 */
async function searchSubtitles(imdbId, type, season, episode) {
    try {
        console.log(`[Scraper] Searching: ${imdbId}, type: ${type}, S${season}E${episode}`);
        
        const subtitles = [];
        
        // Step 1: Find main page
        const mainPageUrl = await findMainPage(imdbId);
        if (!mainPageUrl) {
            console.log(`[Scraper] No main page found`);
            return [];
        }
        
        // Step 2: Scrape subtitle list from main page
        const response = await retryRequest(() =>
            axios.get(mainPageUrl, {
                headers: getBrowserHeaders(),
                timeout: 30000,
                maxRedirects: 5
            })
        );
        
        const $ = cheerio.load(response.data);
        const subtitlePages = [];
        
        if (type === 'movie') {
            // For movies: Get Turkish subtitles with CD = 1
            $('.altyazi-list-wrapper > div > div').each((i, section) => {
                const subPageUrl = $(section).children('.alisim').children('.fl').children('a').attr('href');
                const subLang = $(section).children('.aldil').children('span').attr('class');
                const cd = parseInt($(section).children('.alcd').text().trim()) || 1;
                const releaseName = $(section).children('.alisim').children('.fl').children('a').text().trim();
                
                if (subLang === 'flagtr' && subPageUrl && cd === 1) {
                    subtitlePages.push({
                        url: 'https://turkcealtyazi.org' + subPageUrl,
                        releaseName: releaseName || `Subtitle ${i + 1}`
                    });
                }
            });
        } else {
            // For series: Get Turkish subtitles for specific season/episode
            $('.altyazi-list-wrapper > div > div').each((i, section) => {
                const subPageUrl = $(section).children('.alisim').children('.fl').children('a').attr('href');
                const subLang = $(section).children('.aldil').children('span').attr('class');
                const seasonText = $(section).children('.alcd').children('b').first().text().trim();
                const episodeText = $(section).children('.alcd').children('b').last().text().trim();
                const releaseName = $(section).children('.alisim').children('.fl').children('a').text().trim();
                
                let seasonNumber = parseInt(seasonText.replace(/^0+/, '')) || 0;
                let episodeNumber = episodeText;
                
                if (episodeNumber !== 'Paket' && episodeNumber !== 'paket') {
                    episodeNumber = parseInt(episodeText.replace(/^0+/, '')) || 0;
                }
                
                if (subLang === 'flagtr' && subPageUrl && season === seasonNumber) {
                    if (episode === episodeNumber || episodeNumber === 'Paket' || episodeNumber === 'paket') {
                        subtitlePages.push({
                            url: 'https://turkcealtyazi.org' + subPageUrl,
                            releaseName: releaseName || `S${season}E${episode} ${i + 1}`
                        });
                    }
                }
            });
        }
        
        console.log(`[Scraper] Found ${subtitlePages.length} subtitle pages`);
        
        // Step 3: Extract IDs from each subtitle page and create download URLs
        for (const subPage of subtitlePages) {
            const ids = await extractSubtitleIds(subPage.url);
            
            if (ids.length > 0) {
                const { idid, altid } = ids[0]; // Use first ID
                // Use relative URL for Android emulator compatibility
                const downloadUrl = `/download/${idid}-${altid}.srt`;
                
                subtitles.push({
                    id: `${subPage.releaseName}.srt`,
                    url: downloadUrl,
                    lang: 'tur'
                });
                
                console.log(`[Scraper] Added: ${subPage.releaseName} → ${downloadUrl}`);
            }
        }
        
        console.log(`[Scraper] Total found: ${subtitles.length} subtitles`);
        return subtitles;
        
    } catch (error) {
        console.error(`[Scraper] Error: ${error.message}`);
        return [];
    }
}

/**
 * Download and extract subtitle file
 */
async function downloadSubtitle(idid, altid) {
    try {
        console.log(`[Scraper] Downloading: ${idid}-${altid}`);
        
        // Use POST method (working method from reference code)
        const response = await retryRequest(() =>
            axios({
                url: 'https://turkcealtyazi.org/ind',
                method: 'POST',
                headers: {
                    ...getBrowserHeaders(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': 'https://turkcealtyazi.org/',
                    'Origin': 'https://turkcealtyazi.org'
                },
                data: `idid=${idid}&altid=${altid}`,
                responseType: 'arraybuffer',
                timeout: 40000,
                maxRedirects: 5
            })
        );
        
        console.log(`[Scraper] Download successful, size: ${response.data.length} bytes`);
        console.log(`[Scraper] Content-Type: ${response.headers['content-type']}`);
        
        // Check if it's already SRT text (not ZIP)
        const contentType = response.headers['content-type'] || '';
        const dataStr = response.data.toString('utf8', 0, Math.min(100, response.data.length));
        
        console.log(`[Scraper] First 100 bytes: ${dataStr}`);
        
        // If starts with "1" or contains "-->", it's already SRT
        if (dataStr.includes('-->') || /^\d+\s*$/m.test(dataStr)) {
            console.log(`[Scraper] ✅ Direct SRT detected!`);
            return response.data.toString('utf8');
        }
        
        // Try to extract from ZIP
        try {
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(response.data);
            const zipEntries = zip.getEntries();
            
            console.log(`[Scraper] ZIP entries: ${zipEntries.length}`);
            
            // Find first .srt file
            for (const entry of zipEntries) {
                console.log(`[Scraper] Entry: ${entry.entryName}`);
                if (entry.entryName.endsWith('.srt')) {
                    console.log(`[Scraper] ✅ Found SRT in ZIP: ${entry.entryName}`);
                    return entry.getData().toString('utf8');
                }
            }
            
            console.log(`[Scraper] No SRT found in ZIP`);
            return null;
        } catch (zipError) {
            console.log(`[Scraper] ZIP extraction failed: ${zipError.message}`);
            console.log(`[Scraper] Trying as raw text...`);
            
            // Fallback: return as text
            const text = response.data.toString('utf8');
            if (text.includes('-->')) {
                console.log(`[Scraper] ✅ Raw text is SRT!`);
                return text;
            }
            
            console.log(`[Scraper] ❌ Not a valid SRT`);
            return null;
        }
        
    } catch (error) {
        console.error(`[Scraper] Download error: ${error.message}`);
        throw error;
    }
}

module.exports = {
    searchSubtitles,
    downloadSubtitle
};
