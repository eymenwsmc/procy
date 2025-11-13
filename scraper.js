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

const SCRAPER_API_KEY = '54bd854e8155103b70fd5da4e233c51c';

const { HttpsProxyAgent } = require('https-proxy-agent');
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
    // ZenRows primary, ScraperAPI fallback
    const ZENROWS_API_KEY = process.env.ZENROWS_API_KEY || 'ba2154ab98c0edafda0f44451780179b4ed519a3';
    const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '54bd854e8155103b70fd5da4e233c51c';
    
    try {
        console.log(`[ZenRows Search] Requesting: ${url}`);

        // ZenRows ile GET request
        const response = await axios.get("https://api.zenrows.com/v1/", {
            params: {
                url: url,
                apikey: ZENROWS_API_KEY,
                js_render: 'false',
                premium_proxy: 'true',
                proxy_country: 'tr'
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
            throw new Error("Boş yanıt alındı (ZenRows)");
        }

        console.log(`[ZenRows Search] ✅ Başarılı - Response length: ${response.data.length}`);
        return response;

    } catch (zenrowsErr) {
        console.error(`[ZenRows Search] Error: ${zenrowsErr.message}`);
        
        // Fallback: ScraperAPI dene
        console.log(`[Search Fallback] ScraperAPI deneniyor...`);
        try {
            const response = await axios.get("http://api.scraperapi.com/", {
                params: {
                    api_key: SCRAPER_API_KEY,
                    url: url,
                    render: false,
                    country_code: "tr",
                    ultra_premium: "true",
                    session_number: Math.floor(Math.random() * 1000)
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

            console.log(`[ScraperAPI Search] ✅ Fallback başarılı - Response length: ${response.data.length}`);
            return response;

        } catch (scraperErr) {
            console.error(`[ScraperAPI Search] Fallback error: ${scraperErr.message}`);
            throw new Error(`Tüm search proxy'leri başarısız: ZenRows: ${zenrowsErr.message} | ScraperAPI: ${scraperErr.message}`);
        }
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
            const entries = zip.getEntries();
            
            console.log(`[Encoding] ZIP içinde ${entries.length} dosya bulundu:`);
            entries.forEach((entry, index) => {
                console.log(`[Encoding] ${index + 1}. ${entry.entryName} (${entry.header.size} bytes)`);
            });
            
            // SRT dosyasını bul
            const srtEntry = entries.find(e => e.entryName.toLowerCase().endsWith('.srt'));
            if (srtEntry) {
                console.log(`[Encoding] SRT dosyası bulundu: ${srtEntry.entryName}`);
                const srtBuffer = srtEntry.getData();
                console.log(`[Encoding] ZIP içinden SRT çıkarıldı: ${srtBuffer.length} bytes`);
                return decodeWithMultipleEncodings(srtBuffer);
            } else {
                console.warn(`[Encoding] ZIP içinde SRT dosyası bulunamadı!`);
                // Eğer SRT yoksa, ilk dosyayı dene
                if (entries.length > 0) {
                    console.log(`[Encoding] İlk dosya deneniyor: ${entries[0].entryName}`);
                    const firstBuffer = entries[0].getData();
                    return decodeWithMultipleEncodings(firstBuffer);
                }
            }
        } catch (err) {
            console.warn('ZIP açma hatası:', err.message);
            console.warn('ZIP buffer ilk 50 byte:', buffer.slice(0, 50).toString('hex'));
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
    // ScraperAPI ile POST request
    const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '54bd854e8155103b70fd5da4e233c51c';
    console.log(`[Download via ScraperAPI] ScraperAPI ile indiriliyor: ${idid}-${altid}`);
    
    const postData = `idid=${idid}&altid=${altid}`;
    const targetUrl = 'https://turkcealtyazi.org/ind';

    try {
        console.log(`[ScraperAPI] POST request gönderiliyor...`);
        console.log(`[ScraperAPI] Target: ${targetUrl}`);
        console.log(`[ScraperAPI] Data: ${postData}`);
        console.log(`[ScraperAPI] API Key: ${SCRAPER_API_KEY.substring(0, 8)}...`);
        
        // ScraperAPI ile GET request - POST data URL'de
        const fullUrl = `${targetUrl}?${postData}`;
        console.log(`[ScraperAPI] Full URL: ${fullUrl}`);
        
        const response = await axios.get('http://api.scraperapi.com/', {
            params: {
                api_key: SCRAPER_API_KEY,
                url: fullUrl,
                country_code: 'tr',
                ultra_premium: 'true',
                render: 'false',
                session_number: Math.floor(Math.random() * 1000)
            },
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': '*/*',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
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
        
        console.log(`[Download via ScraperAPI] ✅ ScraperAPI başarılı - SRT boyutu: ${srtText.length} chars`);
        return srtText;

    } catch (err) {
        console.error('ScraperAPI ile indirme hatası:', err.message);
        if (err.response) {
            console.error('ScraperAPI response status:', err.response.status);
            console.error('ScraperAPI response data:', err.response.data ? err.response.data.toString().substring(0, 200) : 'No data');
        }
        
        throw new Error(`ScraperAPI başarısız: ${err.message}`);
    }
}

async function downloadSubtitleViaWebShare(idid, altid) {
    // WebShare.io ücretsiz proxy (1GB/ay)
    console.log(`[Download via WebShare] WebShare proxy ile deneniyor: ${idid}-${altid}`);
    
    const postData = `idid=${idid}&altid=${altid}`;
    const targetUrl = 'https://turkcealtyazi.org/ind';

    try {
        // WebShare ücretsiz endpoint'i
        const response = await axios.post('https://proxy.webshare.io/api/v2/proxy/list/', null, {
            headers: {
                'Authorization': 'Token xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' // Ücretsiz token
            },
            timeout: 10000
        });

        // Fallback: Direkt CORS proxy dene
        console.log(`[WebShare] CORS proxy deneniyor...`);
        
        const corsResponse = await axios.post(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, postData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': getRandomUserAgent(),
                'Accept': '*/*'
            },
            responseType: 'arraybuffer',
            timeout: 30000
        });

        const buffer = Buffer.from(corsResponse.data);
        console.log(`[Download via WebShare] Buffer boyutu: ${buffer.byteLength}`);
        
        if (buffer.byteLength < 100) {
            throw new Error(`Buffer çok küçük: ${buffer.byteLength} bytes`);
        }
        
        const srtText = extractSrt(buffer);
        
        if (!srtText || srtText.length < 50) {
            throw new Error(`SRT içeriği boş veya çok kısa`);
        }
        
        console.log(`[Download via WebShare] ✅ CORS proxy başarılı - SRT boyutu: ${srtText.length} chars`);
        return srtText;

    } catch (err) {
        console.error('WebShare proxy ile indirme hatası:', err.message);
        throw new Error(`WebShare proxy başarısız: ${err.message}`);
    }
}

async function downloadSubtitleViaZenRows(idid, altid) {
    // ZenRows ücretsiz scraping API (1000 request/ay)
    console.log(`[Download via ZenRows] ZenRows ile deneniyor: ${idid}-${altid}`);
    
    const postData = `idid=${idid}&altid=${altid}`;
    const targetUrl = 'https://turkcealtyazi.org/ind';

    try {
        // ZenRows ücretsiz API
        const ZENROWS_API_KEY = process.env.ZENROWS_API_KEY || 'ba2154ab98c0edafda0f44451780179b4ed519a3';
        
        console.log(`[ZenRows] API Key: ${ZENROWS_API_KEY.substring(0, 8)}...`);
        console.log(`[ZenRows] Target: ${targetUrl}`);
        console.log(`[ZenRows] POST Data: ${postData}`);
        
        const response = await axios.post('https://api.zenrows.com/v1/', postData, {
            params: {
                url: targetUrl,
                apikey: ZENROWS_API_KEY,
                js_render: 'false',
                premium_proxy: 'true',
                proxy_country: 'tr'
            },
            data: postData,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            responseType: 'arraybuffer',
            timeout: 30000
        });

        const buffer = Buffer.from(response.data);
        console.log(`[Download via ZenRows] Buffer boyutu: ${buffer.byteLength}`);
        
        const srtText = extractSrt(buffer);
        
        if (!srtText || srtText.length < 50) {
            throw new Error(`SRT içeriği boş veya çok kısa`);
        }
        
        console.log(`[Download via ZenRows] ✅ ZenRows başarılı - SRT boyutu: ${srtText.length} chars`);
        return srtText;

    } catch (err) {
        console.error('ZenRows ile indirme hatası:', err.message);
        throw new Error(`ZenRows başarısız: ${err.message}`);
    }
}

async function downloadSubtitleViaScrapfly(idid, altid) {
    // Scrapfly ücretsiz API (1000 request/ay)
    console.log(`[Download via Scrapfly] Scrapfly ile deneniyor: ${idid}-${altid}`);
    
    const postData = `idid=${idid}&altid=${altid}`;
    const targetUrl = 'https://turkcealtyazi.org/ind';

    try {
        // Scrapfly POST request
        const response = await axios.post('https://api.scrapfly.io/scrape', null, {
            params: {
                key: 'your-free-scrapfly-key', // Ücretsiz key gerekli
                url: targetUrl,
                country: 'TR',
                render_js: 'false',
                asp: 'true'
            },
            data: postData,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            responseType: 'arraybuffer',
            timeout: 30000
        });

        const buffer = Buffer.from(response.data);
        console.log(`[Download via Scrapfly] Buffer boyutu: ${buffer.byteLength}`);
        
        const srtText = extractSrt(buffer);
        
        if (!srtText || srtText.length < 50) {
            throw new Error(`SRT içeriği boş veya çok kısa`);
        }
        
        console.log(`[Download via Scrapfly] ✅ Scrapfly başarılı - SRT boyutu: ${srtText.length} chars`);
        return srtText;

    } catch (err) {
        console.error('Scrapfly ile indirme hatası:', err.message);
        throw new Error(`Scrapfly başarısız: ${err.message}`);
    }
}

async function downloadSubtitle(idid, altid) {
    // Çoklu fallback stratejisi
    console.log(`[Download] Çoklu proxy stratejisi başlatılıyor: ${idid}-${altid}`);
    
    const methods = [
        { name: 'ZenRows', func: downloadSubtitleViaZenRows },
        { name: 'ScraperAPI', func: downloadSubtitleViaAlternativeProxy },
        { name: 'WebShare/CORS', func: downloadSubtitleViaWebShare },
        { name: 'Scrapfly', func: downloadSubtitleViaScrapfly }
    ];
    
    const errors = [];
    
    for (const method of methods) {
        try {
            console.log(`[Download] ${method.name} deneniyor...`);
            return await method.func(idid, altid);
        } catch (err) {
            console.error(`${method.name} başarısız:`, err.message);
            errors.push(`${method.name}: ${err.message}`);
        }
    }
    
    // Tüm yöntemler başarısız
    console.error(`[Download] ❌ Tüm proxy servisleri başarısız`);
    throw new Error(`Tüm indirme yöntemleri başarısız: ${errors.join(' | ')}`);
}
// Helper: SRT veya ZIP içinden SRT çıkar

module.exports = {
    searchSubtitles,
    downloadSubtitle
};
