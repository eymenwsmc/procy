const axios = require('axios');
const cheerio = require('cheerio');
const chardet = require('chardet');

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

const AdmZip = require('adm-zip');
const iconv = require('iconv-lite');

// Get random user agent
const getRandomUserAgent = () => {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
};

// BRIGHTDATA_KEY tanımını kaldırdık çünkü kullanmıyoruz

const getBrowserHeaders = () => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://turkcealtyazi.org/',
    'Origin': 'https://turkcealtyazi.org',
    'Connection': 'keep-alive'
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

async function findMainPage(imdbId) {
    try {
        console.log(`[Scraper] Finding main page: https://turkcealtyazi.org/things_.php?t=99&term=${imdbId}`);
        
        const searchUrl = `https://turkcealtyazi.org/things_.php?t=99&term=${imdbId}`;

        const response = await scraperApiRequest(searchUrl, {
            method: 'GET',
            headers: getBrowserHeaders(),
            timeout: 20000,
        });

        // JSON parse et
        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

        let mainPageUrl = null;

        if (Array.isArray(data) && data.length > 0 && data[0].url) {
            mainPageUrl = 'https://turkcealtyazi.org' + data[0].url;
        }

        console.log(`[Scraper] Main page found: ${mainPageUrl}`);
        return mainPageUrl;

    } catch (error) {
        console.error(`[Scraper] findMainPage error: ${error.message}`);
        return null;
    }
}


/**
 * Step 2: Extract subtitle IDs from subtitle page
 */
async function extractSubtitleIds(subtitlePageUrl) {
    try {
        console.log(`[Scraper] Extracting IDs from: ${subtitlePageUrl}`);
        
        // 🔹 ScraperAPI üzerinden isteği gönder
        const response = await retryRequest(() =>
            scraperApiRequest(subtitlePageUrl, {
                headers: getBrowserHeaders(),
                timeout: 30000
            })
        );

        const $ = cheerio.load(response.data);
        const subIds = [];
        
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


async function scraperApiRequest(url, options = {}) {
    const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '54bd854e8155103b70fd5da4e233c51c';
    try {
        console.log(`[ScraperAPI] Requesting: ${url}`);

        const response = await axios.get("http://api.scraperapi.com/", {
            params: {
                api_key: SCRAPER_API_KEY,
                url: url,
                render: false,
                country_code: "tr",
                premium: "true"
            },
            headers: {
                ...(options.headers || {}),
                "User-Agent": getRandomUserAgent(),
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            },
            timeout: options.timeout || 30000,
            responseType: "text"
        });

        if (!response.data) {
            throw new Error("Boş yanıt alındı (ScraperAPI)");
        }

        return response;

    } catch (err) {
        console.error(`[ScraperAPI] Error: ${err.message}`);
        if (err.response) {
            console.error(`[ScraperAPI] Status: ${err.response.status}`);
        }
        throw err;
    }
}



 
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
        
        // Step 2: Scrape subtitle list from main page (ScraperAPI eklendi)
        const response = await retryRequest(() =>
            scraperApiRequest(mainPageUrl) // burada ScraperAPI kullanıyoruz
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
        
        // Step 3: Extract IDs from each subtitle page
        for (const subPage of subtitlePages) {
            const ids = await extractSubtitleIds(subPage.url);
            
            if (ids.length > 0) {
                const { idid, altid } = ids[0];
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
function extractSrt(buffer) {
    console.log(`[Encoding] Buffer boyutu: ${buffer.length}, İlk 4 byte: [${buffer.slice(0, 4).join(', ')}]`);
    
    // ZIP mi kontrol et
    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;
    if (isZip) {
        try {
            console.log(`[Encoding] ZIP dosyası tespit edildi`);
            const zip = new AdmZip(buffer);
            const entry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
            if (entry) {
                const srtBuffer = entry.getData();
                console.log(`[Encoding] ZIP içinden SRT çıkarıldı: ${srtBuffer.length} bytes`);
                return decodeWithMultipleEncodings(srtBuffer);
            }
        } catch (err) {
            console.warn('ZIP açma hatası:', err.message);
        }
    }
    
    // ZIP değilse direkt decode
    return decodeWithMultipleEncodings(buffer);
}

function decodeWithMultipleEncodings(buffer) {
    // Türkçe karakterler için deneme sırası
    const encodings = [
        'windows-1254',  // Türkçe Windows
        'iso-8859-9',    // Latin-5 (Türkçe)
        'utf-8',         // UTF-8
        'cp1254',        // Code Page 1254
        'latin1'         // Son çare
    ];
    
    for (const encoding of encodings) {
        try {
            const decoded = iconv.decode(buffer, encoding);
            
            // Türkçe karakter kontrolü - doğru decode edilmiş mi?
            const turkishChars = /[çğıöşüÇĞİÖŞÜ]/;
            const hasValidTurkish = turkishChars.test(decoded);
            
            // Bozuk karakter kontrolü
            const hasBrokenChars = /[ÄÄ°Ã¼Ã§Ä±Å\u00ff\u00fe\u00fd]/g.test(decoded);
            
            console.log(`[Encoding] ${encoding} denendi - Türkçe: ${hasValidTurkish}, Bozuk: ${hasBrokenChars}`);
            
            if (hasValidTurkish && !hasBrokenChars) {
                console.log(`[Encoding] ✅ Başarılı encoding: ${encoding}`);
                return cleanupSubtitle(decoded);
            }
            
            // Eğer bozuk karakterler varsa ama Türkçe karakterler de varsa, temizlemeyi dene
            if (hasValidTurkish && hasBrokenChars) {
                console.log(`[Encoding] ⚠️ ${encoding} ile kısmen başarılı, temizleniyor...`);
                const cleaned = fixBrokenTurkishChars(decoded);
                if (cleaned !== decoded) {
                    console.log(`[Encoding] ✅ Temizleme başarılı: ${encoding}`);
                    return cleanupSubtitle(cleaned);
                }
            }
            
        } catch (err) {
            console.warn(`[Encoding] ${encoding} başarısız: ${err.message}`);
        }
    }
    
    // Hiçbiri işe yaramazsa, son çare olarak windows-1254 kullan
    console.warn(`[Encoding] ⚠️ Tüm encoding'ler başarısız, windows-1254 zorlanıyor`);
    try {
        const fallback = iconv.decode(buffer, 'windows-1254');
        return cleanupSubtitle(fixBrokenTurkishChars(fallback));
    } catch (err) {
        console.error(`[Encoding] ❌ Son çare de başarısız: ${err.message}`);
        return buffer.toString('utf8'); // En son çare
    }
}

function fixBrokenTurkishChars(text) {
    console.log(`[Fix] Karakter düzeltme başlıyor, metin uzunluğu: ${text.length}`);
    
    // Yaygın bozuk Türkçe karakter eşleştirmeleri (UTF-8 -> Windows-1254 çifte encoding sorunu)
    const fixes = {
        // Küçük harfler
        'Ã§': 'ç',      // ç
        'Ã¼': 'ü',      // ü
        'Ä±': 'ı',      // ı
        'Ã¶': 'ö',      // ö
        'ÄŸ': 'ğ',      // ğ
        'Å\u009f': 'ş', // ş
        
        // Büyük harfler
        'Ä°': 'İ',      // İ
        'Ã\u0087': 'Ç', // Ç
        'Ã\u009c': 'Ü', // Ü
        'Ã\u0096': 'Ö', // Ö
        'Ä\u009e': 'Ğ', // Ğ
        'Å\u009e': 'Ş', // Ş
        
        // Alternatif bozuk formlar
        'Ã¢': 'â',
        'Ã®': 'î',
        'Ã´': 'ô',
        'Ã»': 'û',
        
        // Özel durumlar (örneğinizdeki kelimeler)
        'GÄ°RÄ°Å\u009f': 'GİRİŞ',
        'GÄ°RÄ°Ş': 'GİRİŞ',
        'KonuÅ\u009f': 'Konuş',
        'KonuÅŸ': 'Konuş',
        'kÄ±r': 'kır',
        'MÃ¼rettebat': 'Mürettebat',
        'aÃ§': 'aç',
        'BÃ¶yle': 'Böyle',
        'yakÄ±n': 'yakın',
        'oyalanÄ±rsak': 'oyalanırsak',
        'sÄ±kÄ±': 'sıkı',
        'penÃ§esine': 'pençesine',
        'alÄ±r': 'alır',
        
        // Daha genel pattern'ler
        'Ä±Å\u009f': 'ış',
        'Ä±r': 'ır',
        'Ã¼n': 'ün',
        'Ã¶r': 'ör',
        'Ã§e': 'çe',
        'ÄŸe': 'ğe',
        'Å\u009fe': 'şe'
    };
    
    let fixed = text;
    let changeCount = 0;
    
    // İlk önce özel kelime düzeltmeleri
    for (const [broken, correct] of Object.entries(fixes)) {
        const beforeLength = fixed.length;
        fixed = fixed.replace(new RegExp(broken, 'g'), correct);
        if (fixed.length !== beforeLength || fixed !== text) {
            changeCount++;
        }
    }
    
    // Daha genel karakter düzeltmeleri (regex pattern'ler)
    const patterns = [
        // Ä± -> ı (her yerde)
        { pattern: /Ä±/g, replacement: 'ı' },
        // Ä° -> İ (her yerde)  
        { pattern: /Ä°/g, replacement: 'İ' },
        // ÄŸ -> ğ (her yerde)
        { pattern: /ÄŸ/g, replacement: 'ğ' },
        // Ã§ -> ç (her yerde)
        { pattern: /Ã§/g, replacement: 'ç' },
        // Ã¼ -> ü (her yerde)
        { pattern: /Ã¼/g, replacement: 'ü' },
        // Ã¶ -> ö (her yerde)
        { pattern: /Ã¶/g, replacement: 'ö' },
        // Å\u009f -> ş (her yerde)
        { pattern: /Å\u009f/g, replacement: 'ş' },
        // Å\u009e -> Ş (her yerde)
        { pattern: /Å\u009e/g, replacement: 'Ş' }
    ];
    
    for (const {pattern, replacement} of patterns) {
        const matches = fixed.match(pattern);
        if (matches) {
            fixed = fixed.replace(pattern, replacement);
            changeCount += matches.length;
        }
    }
    
    console.log(`[Fix] ${changeCount} karakter düzeltmesi yapıldı`);
    
    // Son kontrol - hala bozuk karakterler var mı?
    const stillBroken = /[ÄÃÅ][°±¼§¶\u009f\u009e\u0087\u009c\u0096]/g.test(fixed);
    if (stillBroken) {
        console.warn(`[Fix] ⚠️ Hala bozuk karakterler mevcut`);
    } else {
        console.log(`[Fix] ✅ Tüm karakterler düzeltildi`);
    }
    
    return fixed;
}

function cleanupSubtitle(text) {
    // BOM kaldır
    if (text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1);
    }
    
    // Satır sonlarını normalize et
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Fazla boşlukları temizle
    text = text.replace(/\n{3,}/g, '\n\n');
    
    return text.trim();
}

// extractSrtSafe fonksiyonu kaldırıldı - kullanılmıyor ve fs dependency gerektiriyor


// Kullanılmayan import'ları kaldırdık (fs, StreamZip, CookieJar, wrapper, https, url)
// Render.com'da sadece proxy kullandığımız için bunlara ihtiyaç yok

// ... (diğer fonksiyonlar)
async function downloadSubtitleViaProxy(idid, altid) {
    const SCRAPINGBEE_KEY = process.env.SCRAPINGBEE_API_KEY || "5ILBVRJ2DVDK8B9M1QVOGHLY9DQAWNOX9R7368205HXXGJWMS6CSYZSJ4CJKLF8MVB08F1NRQVSAOXF3";
    const postData = `idid=${idid}&altid=${altid}`;
    const targetUrl = 'https://turkcealtyazi.org/ind';

    try {
        console.log(`[Download via ScrapingBee] Subtitle indiriliyor: ${idid}-${altid}`);
        
        // ScrapingBee ile POST request - doğru format
        const response = await axios.post("https://app.scrapingbee.com/api/v1/", postData, {
            params: {
                api_key: SCRAPINGBEE_KEY,
                url: targetUrl,
                render_js: false,
                country_code: "tr",
                premium_proxy: "true",
                block_resources: "true",
                // Forward headers
                forward_headers: "true"
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': getRandomUserAgent(),
                'Accept': '*/*',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://turkcealtyazi.org/',
                'Origin': 'https://turkcealtyazi.org',
                'X-Target-Method': 'POST'
            },
            responseType: 'arraybuffer',
            timeout: 45000
        });

        const buffer = Buffer.from(response.data);
        console.log(`[Download via ScrapingBee] İndirilen buffer boyutu: ${buffer.byteLength}`);
        console.log(`[Download via ScrapingBee] Response status: ${response.status}`);
        
        if (response.status !== 200) {
            throw new Error(`ScrapingBee HTTP error: ${response.status}`);
        }
        
        if (buffer.byteLength < 100) {
            throw new Error(`Buffer çok küçük (${buffer.byteLength} bytes)`);
        }
        
        const srtText = extractSrt(buffer);
        
        if (!srtText || srtText.length < 50) {
            throw new Error(`SRT içeriği boş veya çok kısa (${srtText ? srtText.length : 0} chars)`);
        }
        
        console.log(`[Download via ScrapingBee] ✅ Başarılı - SRT boyutu: ${srtText.length} chars`);
        return srtText;

    } catch (err) {
        console.error('ScrapingBee ile indirme hatası:', err.message);
        if (err.response) {
            console.error('ScrapingBee response status:', err.response.status);
            console.error('ScrapingBee response headers:', err.response.headers);
        }
        throw err;
    }
}

async function downloadSubtitleViaAlternativeProxy(idid, altid) {
    // ScraperAPI primary proxy olarak kullan
    const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '54bd854e8155103b70fd5da4e233c51c';
    const postData = `idid=${idid}&altid=${altid}`;
    const targetUrl = 'https://turkcealtyazi.org/ind';

    try {
        console.log(`[Download via ScraperAPI] Primary proxy ile indiriliyor: ${idid}-${altid}`);
        
        // ScraperAPI doğru format - GET request with POST data as body
        const response = await axios({
            method: 'POST',
            url: 'http://api.scraperapi.com/',
            params: {
                api_key: SCRAPER_API_KEY,
                url: targetUrl,
                country_code: 'tr',
                premium: 'true',
                render: 'false',
                keep_headers: 'true'
            },
            data: postData,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': getRandomUserAgent(),
                'Accept': '*/*',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://turkcealtyazi.org/',
                'Origin': 'https://turkcealtyazi.org'
            },
            responseType: 'arraybuffer',
            timeout: 45000
        });

        const buffer = Buffer.from(response.data);
        console.log(`[Download via ScraperAPI] İndirilen buffer boyutu: ${buffer.byteLength}`);
        console.log(`[Download via ScraperAPI] Response status: ${response.status}`);
        
        if (response.status !== 200) {
            throw new Error(`ScraperAPI HTTP error: ${response.status}`);
        }
        
        if (buffer.byteLength < 100) {
            throw new Error(`Buffer çok küçük (${buffer.byteLength} bytes)`);
        }
        
        const srtText = extractSrt(buffer);
        
        if (!srtText || srtText.length < 50) {
            throw new Error(`SRT içeriği boş veya çok kısa (${srtText ? srtText.length : 0} chars)`);
        }
        
        console.log(`[Download via ScraperAPI] ✅ Primary başarılı - SRT boyutu: ${srtText.length} chars`);
        return srtText;

    } catch (err) {
        console.error('ScraperAPI ile indirme hatası:', err.message);
        if (err.response) {
            console.error('ScraperAPI response status:', err.response.status);
            console.error('ScraperAPI response headers:', err.response.headers);
        }
        throw err;
    }
}

async function downloadSubtitle(idid, altid) {
    // ScraperAPI'yi primary, ScrapingBee'yi fallback yap
    console.log(`[Download] ScraperAPI primary olarak kullanılıyor: ${idid}-${altid}`);
    
    try {
        // Önce ScraperAPI dene
        return await downloadSubtitleViaAlternativeProxy(idid, altid);
    } catch (scraperApiErr) {
        console.error('ScraperAPI ile indirme başarısız:', scraperApiErr.message);
        
        // Fallback olarak ScrapingBee dene
        console.log(`[Download] Fallback: ScrapingBee deneniyor...`);
        try {
            return await downloadSubtitleViaProxy(idid, altid);
        } catch (scrapingBeeErr) {
            console.error('ScrapingBee de başarısız:', scrapingBeeErr.message);
            throw new Error(`Tüm proxy yöntemleri başarısız: ScraperAPI: ${scraperApiErr.message} | ScrapingBee: ${scrapingBeeErr.message}`);
        }
    }
}
// Helper: SRT veya ZIP içinden SRT çıkar

module.exports = {
    searchSubtitles,
    downloadSubtitle
};
