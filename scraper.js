const axios = require('axios');
const cheerio = require('cheerio');

// Configure axios defaults
axios.defaults.withCredentials = false;
axios.defaults.maxRedirects = 5;
axios.defaults.validateStatus = (status) => status >= 200 && status < 300;

const SCRAPER_API_URL = process.env.PROXY_URL || 'https://api.scraperapi.com';
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

const BRIGHTDATA_KEY = process.env.BRIGHTDATA_KEY || 'b9c0f981e2e1cd7becfbef43d8f83d3e6045dcc9c395ea49a46f31ed7e730afc'; // verdiğin key
// Örnek default superproxy host/port; hesabına göre değiştir
const BRIGHTDATA_PROXY_HOST = process.env.BRIGHTDATA_PROXY_HOST || 'brd.superproxy.io';
const BRIGHTDATA_PROXY_PORT = process.env.BRIGHTDATA_PROXY_PORT || '33335';

// Eğer özel bir proxy URL kullanmak istersen (ör. zone veya özel kullanıcı), BURAYA koy:
// format: 'http://username:password@host:port'
// veya set et: process.env.BRIGHTDATA_PROXY_URL
const BRIGHTDATA_PROXY_URL = process.env.BRIGHTDATA_PROXY_URL ||
  `http://${encodeURIComponent(BRIGHTDATA_KEY)}:@${BRIGHTDATA_PROXY_HOST}:${BRIGHTDATA_PROXY_PORT}`;

const useProxy = !!process.env.PROXY_KEY;
const proxyAxios = useProxy
  ? axios.create({
      baseURL: process.env.PROXY_URL || 'https://api.scraperapi.com',
      params: { api_key: process.env.PROXY_KEY },
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    })
  : axios;

// Get random user agent
const getRandomUserAgent = () => {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
};

const BRIGHTDATA_PROXY = `http://${encodeURIComponent(BRIGHTDATA_KEY)}:@brd.superproxy.io:33335`;

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
    const SCRAPINGBEE_KEY = "5ILBVRJ2DVDK8B9M1QVOGHLY9DQAWNOX9R7368205HXXGJWMS6CSYZSJ4CJKLF8MVB08F1NRQVSAOXF3";
    try {
        console.log(`[ScrapingBee] Requesting: ${url}`);

        const response = await axios.get("https://app.scrapingbee.com/api/v1/", {
            params: {
                api_key: SCRAPINGBEE_KEY,
                url: url,
                render_js: false,
                country_code: "tr", // Türkiye IP’leri bazen daha stabil
                premium_proxy: "true"
            },
            headers: {
                ...(options.headers || {}),
                "User-Agent": getRandomUserAgent(),
                "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            },
            timeout: options.timeout || 20000,
            responseType: "text"
        });

        if (!response.data) {
            throw new Error("Boş yanıt alındı (ScrapingBee)");
        }

        response.data = response.data.toString("utf8");
        return response;

    } catch (err) {
        console.error(`[ScrapingBee] Error: ${err.message}`);
        if (err.response) {
            console.error(`[ScrapingBee] Status: ${err.response.status}`);
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

const iconv = require('iconv-lite'); // unutma, npm i iconv-lite

/**
 * Download and extract subtitle file
 */
function extractSrt(buffer) {
    // ZIP mi kontrol et
    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;
    if (isZip) {
        try {
            const zip = new AdmZip(buffer);
            const entry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
            if (entry) {
                // ZIP içi için ilk deneme: windows-1254
                return iconv.decode(entry.getData(), 'windows-1254'); 
            }
        } catch (err) {
            console.warn('ZIP açma hatası, ham data Recode ile deneniyor:', err.message);
        }
    }
    
try {
        let detectedEncoding = chardet.detect(buffer);
        console.log(`[Encoding Detector] Detected: ${detectedEncoding}`);
        
        // En yaygın ve doğru Türkçe kodlamalara öncelik ver
        let finalEncoding = 'windows-1254'; 
        if (detectedEncoding && detectedEncoding.toLowerCase().includes('utf-8')) {
            finalEncoding = 'utf8';
        } else if (detectedEncoding && detectedEncoding.toLowerCase().includes('iso-8859-9')) {
            finalEncoding = 'iso-8859-9';
        }
        
        // Final decode
        return iconv.decode(buffer, finalEncoding);
        
    } catch (e) {
        console.warn('[Encoding Detector] Detection failed, falling back to Recode.');
        
        // Eğer tespit başarısız olursa, son çare Recode
        const faultyString = iconv.decode(buffer, 'latin1'); 
        const correctedBuffer = iconv.encode(faultyString, 'windows-1254');
        return iconv.decode(correctedBuffer, 'utf8');
    }
}

async function extractSrtSafe(buffer) {
    // ZIP mi kontrol et
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
        // Geçici dosyaya yaz
        const tempZip = './temp.zip';
        fs.writeFileSync(tempZip, buffer);

        return new Promise((resolve, reject) => {
            const zip = new StreamZip({ file: tempZip, storeEntries: true });

            zip.on('ready', () => {
                const entries = Object.values(zip.entries());
                const srtEntry = entries.find(e => e.name.endsWith('.srt'));
                if (!srtEntry) {
                    zip.close();
                    return reject(new Error('SRT bulunamadı ZIP içinde'));
                }

                zip.stream(srtEntry.name, (err, stream) => {
                    if (err) return reject(err);

                    const chunks = [];
                    stream.on('data', chunk => chunks.push(chunk));
                    stream.on('end', () => {
                        zip.close();
                        fs.unlinkSync(tempZip);
                        // windows-1254 decode
                        resolve(iconv.decode(Buffer.concat(chunks), 'windows-1254'));
                    });
                });
            });

            zip.on('error', err => {
                fs.unlinkSync(tempZip);
                reject(err);
            });
        });
    }

    // ZIP değilse direkt decode
return iconv.decode(buffer, 'utf8');}


const fs = require('fs');

const StreamZip = require('node-stream-zip');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// Yeni CookieJar oluştur ve Axios'a entegre et
const jar = new CookieJar();
const client = wrapper(axios.create({
    jar,
    // Diğer genel ayarlar
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 300,
}));

// Subtitle indir
// Subtitle indir
const https = require('https');
const url = require('url'); // Gerekirse URL parsing için

// ... (diğer fonksiyonlar)
async function downloadSubtitle(idid, altid) {
    const postData = `idid=${idid}&altid=${altid}`;
    const targetUrl = 'https://turkcealtyazi.org/ind';

    try {
        console.log(`[Download via Client] Subtitle indiriliyor: ${idid}-${altid}`);
        
        // Bu istek, önceki GET isteklerinde toplanan çerezleri otomatik olarak gönderecek.
        const response = await client.post(targetUrl, postData, {
            headers: {
                'User-Agent': getRandomUserAgent(), 
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://turkcealtyazi.org/',
                // Sitenin isteyebileceği ek başlıklar
                'X-Requested-With': 'XMLHttpRequest', // AJAX isteği taklidi
                'Connection': 'keep-alive',
            },
            
            // Veri tipini Buffer olarak almalıyız
            responseType: 'arraybuffer', 
            timeout: 40000
        });

        const buffer = Buffer.from(response.data);
        console.log(`[Download via Client] İndirilen ham buffer boyutu: ${buffer.byteLength}`);

        if (response.status === 403 || buffer.byteLength < 500) {
            throw new Error(`Download failed with status: ${response.status} or tiny buffer.`);
        }
        
        // Karakter kodlama çözümü (Recode Mantığı)
        // extractSrt(buffer) fonksiyonunuzun içinde bu mantık KESİNLİKLE olmalı:
        /*
        const faultyString = iconv.decode(buffer, 'latin1'); 
        const correctedBuffer = iconv.encode(faultyString, 'windows-1254');
        return iconv.decode(correctedBuffer, 'utf8');
        */
        const srtText = extractSrt(buffer); 
        return srtText;

    } catch (err) {
        console.error('Subtitle indirilemedi (Çerez ile):', err.message);
        throw err;
    }
}
// Helper: SRT veya ZIP içinden SRT çıkar

module.exports = {
    searchSubtitles,
    downloadSubtitle
};
